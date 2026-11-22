package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// ZoneKinds: cultivation zones get watered; paths and other zones never "need water".
var ZoneKinds = []string{"cultivation", "path", "other"}

// Zone is an area inside a plot that is worked on, with its state derived from
// the activity log (zone_status view) — never stored.
type Zone struct {
	ID        uuid.UUID `json:"id"`
	PlotID    uuid.UUID `json:"plot_id"`
	Label     *string   `json:"label"`
	Kind      string    `json:"kind"`
	Geom      Polygon   `json:"geom"`
	Notes     *string   `json:"notes"`
	AreaHa    *float64  `json:"area_ha"`
	UpdatedAt time.Time `json:"updated_at"`

	LastSownOn          *string `json:"last_sown_on"`
	LastPlantedOn       *string `json:"last_planted_on"`
	LastWateredOn       *string `json:"last_watered_on"`
	CurrentIntervalDays int     `json:"current_interval_days"`
	OpenTaskCount       int     `json:"open_task_count"`
	NeedsWater          *bool   `json:"needs_water"` // nil for paths and other non-cultivation zones
}

// ZoneInput is what a client sets on a zone.
type ZoneInput struct {
	PlotID uuid.UUID `json:"plot_id"`
	Label  *string   `json:"label"`
	Kind   string    `json:"kind"`
	Geom   Polygon   `json:"geom"`
	Notes  *string   `json:"notes"`
}

func (in ZoneInput) normalize() (ZoneInput, error) {
	var err error
	if in.PlotID == uuid.Nil {
		return in, invalid("plot_id", "choose the plot this zone belongs to")
	}
	if in.Label, err = optionalText("label", in.Label, 100); err != nil {
		return in, err
	}
	if in.Kind == "" {
		in.Kind = "cultivation"
	}
	known := false
	for _, k := range ZoneKinds {
		known = known || in.Kind == k
	}
	if !known {
		return in, invalid("kind", "must be cultivation, path or other")
	}
	if err = in.Geom.normalize("geom"); err != nil {
		return in, err
	}
	if in.Notes, err = optionalText("notes", in.Notes, 2000); err != nil {
		return in, err
	}
	return in, nil
}

const zoneSelect = `
	SELECT z.id, z.plot_id, z.label, z.kind::text, ST_AsGeoJSON(z.geom), z.notes,
	       (ST_Area(z.geom) * f.metres_per_unit ^ 2 / 10000)::float8, z.updated_at,
	       to_char(st.last_sown_on, 'YYYY-MM-DD'), to_char(st.last_planted_on, 'YYYY-MM-DD'),
	       to_char(st.last_watered_on, 'YYYY-MM-DD'), st.current_interval_days, st.open_task_count, st.needs_water
	  FROM zone z
	  JOIN zone_status st ON st.zone_id = z.id
	  JOIN field f ON f.id = st.field_id`

func scanZone(row pgx.Row) (Zone, error) {
	var z Zone
	var openTasks int64
	err := row.Scan(&z.ID, &z.PlotID, &z.Label, &z.Kind, geomJSON[Polygon]{&z.Geom}, &z.Notes, &z.AreaHa, &z.UpdatedAt,
		&z.LastSownOn, &z.LastPlantedOn, &z.LastWateredOn, &z.CurrentIntervalDays, &openTasks, &z.NeedsWater)
	z.OpenTaskCount = int(openTasks)
	return z, err
}

// ListZones returns every live zone (of live plots) with its derived state.
func (s *Store) ListZones(ctx context.Context) ([]Zone, error) {
	rows, err := s.db.Query(ctx, zoneSelect+` ORDER BY z.created_at, z.id`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Zone, error) { return scanZone(r) })
}

// GetZone returns one live zone with its derived state.
func (s *Store) GetZone(ctx context.Context, id uuid.UUID) (Zone, error) {
	z, err := scanZone(s.db.QueryRow(ctx, zoneSelect+` WHERE z.id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return z, ErrNotFound
	}
	return z, err
}

// PutZone creates or replaces the zone with this client-chosen id. The zone must
// lie inside its plot (1 unit of tolerance for taps on the plot's edge).
func (s *Store) PutZone(ctx context.Context, id uuid.UUID, in ZoneInput) (z Zone, created bool, err error) {
	if in, err = in.normalize(); err != nil {
		return z, false, err
	}
	err = s.inTx(ctx, func(tx *Store) error {
		if err := tx.checkGeom(ctx, "geom", &in.Geom); err != nil {
			return err
		}
		// A late offline edit of a deleted zone: gone, not a validation problem.
		var zoneDeleted bool
		err := tx.db.QueryRow(ctx, `SELECT deleted_at IS NOT NULL FROM zone WHERE id = $1`, id).Scan(&zoneDeleted)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if zoneDeleted {
			return ErrDeleted
		}
		// The plot must be live; FOR SHARE keeps it from being deleted or reshaped meanwhile.
		var inside, plotDeleted bool
		err = tx.db.QueryRow(ctx, `
			SELECT ST_Within(ST_SetSRID(ST_GeomFromGeoJSON($2), 0), ST_Buffer(p.geom, 1)), p.deleted_at IS NOT NULL
			  FROM plot p WHERE p.id = $1 FOR SHARE`,
			in.PlotID, in.Geom.json()).Scan(&inside, &plotDeleted)
		if errors.Is(err, pgx.ErrNoRows) {
			return invalid("plot_id", "is not a known plot")
		}
		if err != nil {
			return err
		}
		if plotDeleted {
			return ErrDeleted // its plot was deleted meanwhile: the zone goes with it
		}
		if !inside {
			return invalid("geom", "must be inside its plot: keep every corner within the plot's outline")
		}
		err = tx.db.QueryRow(ctx, `
			INSERT INTO zone (id, plot_id, label, kind, geom, notes)
			VALUES ($1, $2, $3, $4::zone_kind, ST_SetSRID(ST_Force2D(ST_GeomFromGeoJSON($5)), 0), $6)
			ON CONFLICT (id) DO UPDATE
			   SET plot_id = EXCLUDED.plot_id, label = EXCLUDED.label, kind = EXCLUDED.kind,
			       geom = EXCLUDED.geom, notes = EXCLUDED.notes
			 WHERE zone.deleted_at IS NULL
			RETURNING (xmax = 0)`,
			id, in.PlotID, in.Label, in.Kind, in.Geom.json(), in.Notes).Scan(&created)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrDeleted
		}
		if err != nil {
			return err
		}
		z, err = tx.GetZone(ctx, id)
		return err
	})
	return z, created, err
}

// DeleteZone soft-deletes a zone and its tasks; its activity history stays. Idempotent.
func (s *Store) DeleteZone(ctx context.Context, id uuid.UUID) error {
	return s.inTx(ctx, func(tx *Store) error {
		var existed bool
		err := tx.db.QueryRow(ctx, `
			WITH upd AS (UPDATE zone SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id)
			SELECT EXISTS (SELECT 1 FROM upd) OR EXISTS (SELECT 1 FROM zone WHERE id = $1)`, id).Scan(&existed)
		if err != nil {
			return err
		}
		if !existed {
			return ErrNotFound
		}
		_, err = tx.db.Exec(ctx, `UPDATE task SET deleted_at = now() WHERE zone_id = $1 AND deleted_at IS NULL`, id)
		return err
	})
}
