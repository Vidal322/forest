package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// PurgeTables are the tables whose tombstones PurgeTombstones removes, in the
// order it visits them: rows that point at others go first, so a tombstone
// whose only referrers are old tombstones too is freed in the same run.
// field and field_image are left out: the app never deletes them (and a
// field_image row owns a photo file on disk).
var PurgeTables = []string{"activity", "task", "tree", "zone", "plot", "species", "watering_rule"}

// PurgedTable is what PurgeTombstones did to one table.
type PurgedTable struct {
	Table  string
	Purged int
	// Kept counts old tombstones left in place because a row still points at
	// them (a RESTRICT foreign key), by constraint name.
	Kept map[string]int
	// Cascaded counts rows removed or unlinked along with purged activities:
	// "activity_zone", "activity_species" (deleted) and "tree.planting_activity_id",
	// "task.resolved_by_activity_id" (set to NULL). Empty for other tables.
	Cascaded map[string]int
}

// KeptTotal is the number of old tombstones kept in this table.
func (p PurgedTable) KeptTotal() int {
	n := 0
	for _, c := range p.Kept {
		n += c
	}
	return n
}

var errPurgeDryRun = errors.New("dry run")

// PurgeTombstones hard-deletes rows soft-deleted before cutoff, in one
// transaction (rolled back when dryRun). Deleting an activity removes its
// activity_zone / activity_species rows and clears tree.planting_activity_id
// and task.resolved_by_activity_id (the foreign keys say so). A tombstone that
// a row still references through a RESTRICT foreign key (a deleted species
// with live trees, a deleted zone in a live activity's history) is skipped and
// counted in Kept, never forced.
//
// Once a tombstone is purged, a late create of its id makes a new row; a late
// edit of a purged activity or task (it has a base_version) still gets
// ErrDeleted, because PutActivity / PutTask refuse an edit of a missing row.
//
// Lock order: this visits tables child first (activity → task → tree → zone →
// plot), the reverse of the store's plot → zone → task/trees, which is what
// lets a whole deleted plot go in one run. It selects only tombstones FOR
// UPDATE, but deleting them also locks live rows (the foreign key checks, and
// the live trees and tasks whose planting / resolving activity it clears), so
// an edit running at the same moment can deadlock with it. Postgres then
// aborts one of the two: if it is the purge, the whole transaction rolls back
// (nothing half done) and it can be run again; if it is the edit, that write
// fails with a server error and the phone shows it. So `make purge` is meant
// to run with the API stopped (the README says so).
func (s *Store) PurgeTombstones(ctx context.Context, cutoff time.Time, dryRun bool) ([]PurgedTable, error) {
	var out []PurgedTable
	err := s.inTx(ctx, func(tx *Store) error {
		out = out[:0]
		for _, table := range PurgeTables {
			res, err := tx.purgeTable(ctx, table, cutoff)
			if err != nil {
				return fmt.Errorf("purge %s: %w", table, err)
			}
			out = append(out, res)
		}
		if dryRun {
			return errPurgeDryRun
		}
		return nil
	})
	if errors.Is(err, errPurgeDryRun) {
		err = nil
	}
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Store) purgeTable(ctx context.Context, table string, cutoff time.Time) (PurgedTable, error) {
	res := PurgedTable{Table: table, Kept: map[string]int{}, Cascaded: map[string]int{}}
	ident := pgx.Identifier{table}.Sanitize()
	rows, err := s.db.Query(ctx, `SELECT id FROM `+ident+` WHERE deleted_at < $1 ORDER BY deleted_at, id FOR UPDATE`, cutoff)
	if err != nil {
		return res, err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return res, err
	}
	for _, id := range ids {
		var cascaded map[string]int
		if table == "activity" {
			if cascaded, err = s.activityLinks(ctx, id); err != nil {
				return res, err
			}
		}
		// One savepoint per row: a RESTRICT violation undoes only this row.
		err := s.inTx(ctx, func(tx *Store) error {
			_, err := tx.db.Exec(ctx, `DELETE FROM `+ident+` WHERE id = $1`, id)
			return err
		})
		var pgErr *pgconn.PgError
		switch {
		case err == nil:
			res.Purged++
			for k, n := range cascaded {
				res.Cascaded[k] += n
			}
		case errors.As(err, &pgErr) && pgErr.Code == "23503": // foreign_key_violation
			res.Kept[pgErr.ConstraintName]++
		default:
			return res, err
		}
	}
	return res, nil
}

// activityLinks counts the rows that go (or lose their link) with activity id.
func (s *Store) activityLinks(ctx context.Context, id uuid.UUID) (map[string]int, error) {
	var zones, species, trees, tasks int
	err := s.db.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM activity_zone WHERE activity_id = $1),
		(SELECT count(*) FROM activity_species WHERE activity_id = $1),
		(SELECT count(*) FROM tree WHERE planting_activity_id = $1),
		(SELECT count(*) FROM task WHERE resolved_by_activity_id = $1)`, id).Scan(&zones, &species, &trees, &tasks)
	if err != nil {
		return nil, err
	}
	return map[string]int{
		"activity_zone":                zones,
		"activity_species":             species,
		"tree.planting_activity_id":    trees,
		"task.resolved_by_activity_id": tasks,
	}, nil
}
