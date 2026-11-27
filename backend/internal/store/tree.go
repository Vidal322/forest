package store

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// TreeCount is how many recorded trees of one species stand in a zone.
type TreeCount struct {
	ZoneID    uuid.UUID `json:"zone_id"`
	SpeciesID uuid.UUID `json:"species_id"`
	Alive     int       `json:"alive"`
	Dead      int       `json:"dead"`
}

// TreeCountInput sets the counts for one species in one zone.
type TreeCountInput struct {
	Alive int `json:"alive"`
	Dead  int `json:"dead"`
}

const maxTreesPerSpecies = 10_000

// treesInZone: live trees of a species counted in this zone (zone_id set by
// SetTreeCounts). Trees with a measured position are never touched here.
const treesInZone = `
	FROM tree t
	WHERE t.deleted_at IS NULL AND t.zone_id = $1 AND t.species_id = $2`

// ListTreeCounts returns alive/dead counts per zone and species (zones may overlap:
// a tree in two zones counts in both).
func (s *Store) ListTreeCounts(ctx context.Context) ([]TreeCount, error) {
	rows, err := s.db.Query(ctx, `
		SELECT z.id, t.species_id,
		       count(*) FILTER (WHERE t.status = 'alive'), count(*) FILTER (WHERE t.status = 'dead')
		  FROM tree t
		  JOIN zone z ON z.deleted_at IS NULL AND (
		           t.zone_id = z.id
		           -- trees with a measured position: in every zone that contains it
		           OR (t.zone_id IS NULL AND t.position IS NOT NULL AND z.plot_id = t.plot_id AND ST_Contains(z.geom, t.position)))
		  JOIN plot p ON p.id = z.plot_id AND p.deleted_at IS NULL
		  JOIN species sp ON sp.id = t.species_id AND sp.deleted_at IS NULL
		 WHERE t.deleted_at IS NULL AND t.status IN ('alive', 'dead')
		 GROUP BY z.id, t.species_id
		 ORDER BY z.id, t.species_id`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (TreeCount, error) {
		var c TreeCount
		var alive, dead int64
		err := r.Scan(&c.ZoneID, &c.SpeciesID, &alive, &dead)
		c.Alive, c.Dead = int(alive), int(dead)
		return c, err
	})
}

// SetTreeCounts makes the zone hold exactly `in.Alive` alive and `in.Dead` dead trees
// of the species. Setting a target (not adding a delta) makes a retried request
// harmless. Trees that went from alive to dead are marked dead (history kept); new
// trees are recorded on the zone; extra ones are removed (a correction). Only trees
// counted this way are changed, never ones recorded with a position.
func (s *Store) SetTreeCounts(ctx context.Context, zoneID, speciesID uuid.UUID, in TreeCountInput) (TreeCount, error) {
	for field, n := range map[string]int{"alive": in.Alive, "dead": in.Dead} {
		if n < 0 || n > maxTreesPerSpecies {
			return TreeCount{}, invalid(field, "tem de ser um número inteiro de 0 a %d", maxTreesPerSpecies)
		}
	}
	out := TreeCount{ZoneID: zoneID, SpeciesID: speciesID}
	err := s.inTx(ctx, func(tx *Store) error {
		// lock order plot → zone → trees, like every other write
		var plotOK, zoneOK bool
		err := tx.db.QueryRow(ctx, `SELECT deleted_at IS NULL FROM plot
			WHERE id = (SELECT plot_id FROM zone WHERE id = $1) FOR SHARE`, zoneID).Scan(&plotOK)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if err := tx.db.QueryRow(ctx, `SELECT deleted_at IS NULL FROM zone WHERE id = $1 FOR SHARE`, zoneID).Scan(&zoneOK); err != nil {
			return err
		}
		if !plotOK || !zoneOK {
			return ErrDeleted
		}
		var speciesOK bool
		if err := tx.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM species WHERE id = $1 AND deleted_at IS NULL FOR SHARE)`, speciesID).Scan(&speciesOK); err != nil {
			return err
		}
		if !speciesOK {
			return invalid("species_id", "não existe ou foi apagada")
		}
		// serialise count changes for this zone+species
		if _, err := tx.db.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1::text || $2::text, 1))`, zoneID, speciesID); err != nil {
			return err
		}
		var alive, dead int
		if err := tx.db.QueryRow(ctx, `SELECT count(*) FILTER (WHERE t.status = 'alive'), count(*) FILTER (WHERE t.status = 'dead') `+treesInZone,
			zoneID, speciesID).Scan(&alive, &dead); err != nil {
			return err
		}
		// 1. alive → dead, as far as both changes agree (a tree died)
		if died := min(max(alive-in.Alive, 0), max(in.Dead-dead, 0)); died > 0 {
			if _, err := tx.db.Exec(ctx, `UPDATE tree SET status = 'dead' WHERE id IN (
				SELECT t.id `+treesInZone+` AND t.status = 'alive' ORDER BY t.created_at DESC, t.id LIMIT $3)`,
				zoneID, speciesID, died); err != nil {
				return err
			}
			alive, dead = alive-died, dead+died
		}
		// 2. add or remove the rest
		for _, st := range []struct {
			status     string
			have, want int
		}{{"alive", alive, in.Alive}, {"dead", dead, in.Dead}} {
			switch {
			case st.want > st.have:
				if _, err := tx.db.Exec(ctx, `
					INSERT INTO tree (plot_id, zone_id, species_id, status)
					SELECT z.plot_id, z.id, $2, $3::tree_status
					  FROM zone z, generate_series(1, $4) WHERE z.id = $1`,
					zoneID, speciesID, st.status, st.want-st.have); err != nil {
					return err
				}
			case st.want < st.have:
				if _, err := tx.db.Exec(ctx, `UPDATE tree SET deleted_at = now() WHERE id IN (
					SELECT t.id `+treesInZone+` AND t.status = $3::tree_status ORDER BY t.created_at DESC, t.id LIMIT $4)`,
					zoneID, speciesID, st.status, st.have-st.want); err != nil {
					return err
				}
			}
		}
		out.Alive, out.Dead = in.Alive, in.Dead
		return nil
	})
	return out, err
}
