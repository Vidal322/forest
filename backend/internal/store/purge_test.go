package store_test

import (
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"forest/internal/dbtest"
	"forest/internal/store"
)

// Test tombstones are dated 2000: real data is never that old, so the counts
// below are exact even though the test shares the database.
var (
	oldDeletion = time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)
	purgeCutoff = time.Date(2001, 1, 1, 0, 0, 0, 0, time.UTC)
)

func TestPurgeTombstones(t *testing.T) {
	s, tx := freshStore(t)
	ctx := t.Context()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := tx.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	tombstone := func(table string, id uuid.UUID, at time.Time) {
		t.Helper()
		exec(`UPDATE `+pgx.Identifier{table}.Sanitize()+` SET deleted_at = $2 WHERE id = $1`, id, at)
	}
	species := func(prefix string) uuid.UUID {
		t.Helper()
		sp, _, err := s.PutSpecies(ctx, uuid.New(), store.SpeciesInput{ScientificName: dbtest.Name(prefix)})
		if err != nil {
			t.Fatal(err)
		}
		return sp.ID
	}
	zone := func(plot uuid.UUID, geom store.Polygon) uuid.UUID {
		t.Helper()
		z, _, err := s.PutZone(ctx, uuid.New(), store.ZoneInput{PlotID: plot, Geom: geom})
		if err != nil {
			t.Fatal(err)
		}
		return z.ID
	}
	activity := func(field, zone uuid.UUID, typ string) uuid.UUID {
		t.Helper()
		id := uuid.New()
		exec(`INSERT INTO activity (id, field_id, type, performed_on) VALUES ($1, $2, $3, '2000-01-01')`, id, field, typ)
		exec(`INSERT INTO activity_zone (activity_id, zone_id) VALUES ($1, $2)`, id, zone)
		return id
	}
	tree := func(plot, species uuid.UUID, planting *uuid.UUID) uuid.UUID {
		t.Helper()
		id := uuid.New()
		exec(`INSERT INTO tree (id, plot_id, species_id, planting_activity_id) VALUES ($1, $2, $3, $4)`, id, plot, species, planting)
		return id
	}
	task := func(zone uuid.UUID, resolvedBy *uuid.UUID) uuid.UUID {
		t.Helper()
		id := uuid.New()
		exec(`INSERT INTO task (id, zone_id, title, resolved_by_activity_id) VALUES ($1, $2, 'Test purge', $3)`, id, zone, resolvedBy)
		return id
	}

	field := newField(t, s)
	plot := newPlot(t, s, dbtest.Name("Plot purge"), square(0, 0, 100))
	liveZone := zone(plot.ID, square(10, 10, 10))
	liveSpecies := species("Test purge live")

	// An old activity with zone + species rows, linked from a live tree and a live task.
	oldActivity := activity(field.ID, liveZone, "planting")
	exec(`INSERT INTO activity_species (activity_id, species_id) VALUES ($1, $2)`, oldActivity, liveSpecies)
	plantedTree := tree(plot.ID, liveSpecies, &oldActivity)
	resolvedTask := task(liveZone, &oldActivity)
	tombstone("activity", oldActivity, oldDeletion)

	// A recent delete stays a tombstone.
	recentActivity := activity(field.ID, liveZone, "watering")
	tombstone("activity", recentActivity, time.Now())

	// An old species still used by a live tree is kept; an unused one goes.
	usedSpecies := species("Test purge used")
	tree(plot.ID, usedSpecies, nil)
	tombstone("species", usedSpecies, oldDeletion)
	freeSpecies := species("Test purge free")
	tombstone("species", freeSpecies, oldDeletion)

	// An old zone still in a live activity's history is kept.
	historyZone := zone(plot.ID, square(40, 40, 10))
	activity(field.ID, historyZone, "watering")
	tombstone("zone", historyZone, oldDeletion)

	// A whole old plot (zone, task, tree) goes in one run, children first.
	oldPlot := newPlot(t, s, dbtest.Name("Plot purge old"), square(200, 200, 50))
	oldZone := zone(oldPlot.ID, square(210, 210, 10))
	oldTask := task(oldZone, nil)
	oldTree := tree(oldPlot.ID, liveSpecies, nil)
	for table, id := range map[string]uuid.UUID{"plot": oldPlot.ID, "zone": oldZone, "task": oldTask, "tree": oldTree} {
		tombstone(table, id, oldDeletion)
	}

	rule := uuid.New()
	exec(`INSERT INTO watering_rule (id, field_id, name, from_month, to_month, interval_days) VALUES ($1, $2, 'Test purge', 6, 8, 3)`, rule, field.ID)
	tombstone("watering_rule", rule, oldDeletion)

	type want struct {
		purged int
		kept   map[string]int
	}
	wants := map[string]want{
		"activity":      {1, nil},
		"task":          {1, nil},
		"tree":          {1, nil},
		"zone":          {1, map[string]int{"activity_zone_zone_id_fkey": 1}},
		"plot":          {1, nil},
		"species":       {1, map[string]int{"tree_species_id_fkey": 1}},
		"watering_rule": {1, nil},
	}
	check := func(res []store.PurgedTable) {
		t.Helper()
		var tables []string
		for _, r := range res {
			tables = append(tables, r.Table)
			w := wants[r.Table]
			if r.Purged != w.purged || r.KeptTotal() != len(w.kept) {
				t.Errorf("%s: purged %d kept %v, want %d kept %v", r.Table, r.Purged, r.Kept, w.purged, w.kept)
			}
			for c, n := range w.kept {
				if r.Kept[c] != n {
					t.Errorf("%s: kept %v, want %v", r.Table, r.Kept, w.kept)
				}
			}
			if r.Table == "activity" {
				for k, n := range map[string]int{"activity_zone": 1, "activity_species": 1, "tree.planting_activity_id": 1, "task.resolved_by_activity_id": 1} {
					if r.Cascaded[k] != n {
						t.Errorf("activity cascaded %v, want %s = %d", r.Cascaded, k, n)
					}
				}
			}
		}
		if !slices.Equal(tables, store.PurgeTables) {
			t.Errorf("tables %v, want %v", tables, store.PurgeTables)
		}
	}
	exists := func(table string, id uuid.UUID) bool {
		t.Helper()
		var ok bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT FROM `+pgx.Identifier{table}.Sanitize()+` WHERE id = $1)`, id).Scan(&ok); err != nil {
			t.Fatal(err)
		}
		return ok
	}

	// A dry run reports the same but changes nothing.
	res, err := s.PurgeTombstones(ctx, purgeCutoff, true)
	if err != nil {
		t.Fatal(err)
	}
	check(res)
	if !exists("activity", oldActivity) || !exists("plot", oldPlot.ID) {
		t.Fatal("dry run deleted rows")
	}

	res, err = s.PurgeTombstones(ctx, purgeCutoff, false)
	if err != nil {
		t.Fatal(err)
	}
	check(res)

	for table, id := range map[string]uuid.UUID{
		"activity": oldActivity, "species": freeSpecies, "plot": oldPlot.ID, "zone": oldZone,
		"task": oldTask, "tree": oldTree, "watering_rule": rule,
	} {
		if exists(table, id) {
			t.Errorf("%s %s should be purged", table, id)
		}
	}
	for table, id := range map[string]uuid.UUID{
		"activity": recentActivity, "species": usedSpecies, "zone": historyZone,
		"tree": plantedTree, "task": resolvedTask,
	} {
		if !exists(table, id) {
			t.Errorf("%s %s should be kept", table, id)
		}
	}
	var joins int
	if err := tx.QueryRow(ctx, `SELECT (SELECT count(*) FROM activity_zone WHERE activity_id = $1)
		+ (SELECT count(*) FROM activity_species WHERE activity_id = $1)`, oldActivity).Scan(&joins); err != nil {
		t.Fatal(err)
	}
	var planting, resolvedBy *uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT planting_activity_id FROM tree WHERE id = $1`, plantedTree).Scan(&planting); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `SELECT resolved_by_activity_id FROM task WHERE id = $1`, resolvedTask).Scan(&resolvedBy); err != nil {
		t.Fatal(err)
	}
	if joins != 0 || planting != nil || resolvedBy != nil {
		t.Errorf("activity links left: %d join rows, tree planting %v, task resolved by %v", joins, planting, resolvedBy)
	}

	// Kept tombstones still refuse late writes; a purged id is free for a new row.
	if _, _, err := s.PutSpecies(ctx, usedSpecies, store.SpeciesInput{ScientificName: dbtest.Name("Test purge late")}); !errors.Is(err, store.ErrDeleted) {
		t.Errorf("late write to a kept tombstone: %v, want ErrDeleted", err)
	}
	if _, created, err := s.PutSpecies(ctx, freeSpecies, store.SpeciesInput{ScientificName: dbtest.Name("Test purge late")}); err != nil || !created {
		t.Errorf("late write to a purged id: created=%v err=%v, want a new row", created, err)
	}

	// Nothing left to do on a second run.
	res, err = s.PurgeTombstones(ctx, purgeCutoff, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range res {
		if r.Purged != 0 {
			t.Errorf("second run purged %d from %s", r.Purged, r.Table)
		}
	}
}

// Every soft-deletable table is purged, except the two the app never deletes.
func TestPurgeCoversEveryTombstoneTable(t *testing.T) {
	tx := dbtest.Tx(t)
	rows, err := tx.Query(t.Context(), `SELECT table_name::text FROM information_schema.columns
		WHERE table_schema = current_schema() AND column_name = 'deleted_at'
		  AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_type = 'BASE TABLE')
		  AND table_name NOT IN ('field', 'field_image')
		ORDER BY 1`)
	if err != nil {
		t.Fatal(err)
	}
	got, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		t.Fatal(err)
	}
	want := slices.Sorted(slices.Values(store.PurgeTables))
	if !slices.Equal(got, want) {
		t.Fatalf("tables with deleted_at %v, PurgeTables %v", got, want)
	}
}
