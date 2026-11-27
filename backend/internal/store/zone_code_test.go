package store_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"forest/internal/dbtest"
	"forest/internal/store"
)

func TestZoneCodes(t *testing.T) {
	s, _ := freshStore(t)
	ctx := t.Context()
	newField(t, s)
	a := newPlot(t, s, "Plot Codes A", square(0, 0, 100))
	b := newPlot(t, s, "Plot Codes B", square(200, 0, 100))
	put := func(id uuid.UUID, in store.ZoneInput) store.Zone {
		t.Helper()
		z, _, err := s.PutZone(ctx, id, in)
		if err != nil {
			t.Fatal(err)
		}
		return z
	}
	inA := store.ZoneInput{PlotID: a.ID, Geom: square(10, 10, 20)}
	inB := store.ZoneInput{PlotID: b.ID, Geom: square(210, 10, 20)}

	// per plot, in the order they are made
	z1, z2, zb := uuid.New(), uuid.New(), uuid.New()
	if got := put(z1, inA).Code; got != "Z1" {
		t.Fatalf("first zone of A: %q", got)
	}
	if got := put(z2, inA).Code; got != "Z2" {
		t.Fatalf("second zone of A: %q", got)
	}
	if got := put(zb, inB).Code; got != "Z1" {
		t.Fatalf("first zone of B: %q", got)
	}

	// the same PUT again, or an edit, keeps the code (and burns no number)
	if got := put(z1, inA).Code; got != "Z1" {
		t.Fatalf("same content: %q", got)
	}
	edited := inA
	edited.Label = ptr("Clareira")
	if got := put(z1, edited).Code; got != "Z1" {
		t.Fatalf("edit: %q", got)
	}

	// a deleted zone keeps its code: the next zone gets the next number
	if err := s.DeleteZone(ctx, z2); err != nil {
		t.Fatal(err)
	}
	z3 := uuid.New()
	if got := put(z3, inA).Code; got != "Z3" {
		t.Fatalf("after a delete: %q", got)
	}

	// a zone moved to another plot gets the next code there; its old one is not given out again
	if got := put(z1, inB).Code; got != "Z2" {
		t.Fatalf("moved to B: %q", got)
	}
	if got := put(uuid.New(), inA).Code; got != "Z4" {
		t.Fatalf("after a move out of A: %q", got)
	}

	// the client can't set it: it isn't part of the input, and the database owns the column
	var ve *store.ValidationError
	if _, _, err := s.PutZone(ctx, uuid.New(), store.ZoneInput{PlotID: uuid.New(), Geom: square(10, 10, 5)}); !errors.As(err, &ve) {
		t.Fatalf("unknown plot: %v", err)
	}
	if got := put(uuid.New(), inA).Code; got != "Z5" {
		t.Fatalf("after a rejected zone: %q", got)
	}

	// giving out codes is not an edit of the plot
	after, err := s.GetPlot(ctx, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !after.UpdatedAt.Equal(a.UpdatedAt) {
		t.Fatalf("plot updated_at moved: %v -> %v", a.UpdatedAt, after.UpdatedAt)
	}
}

// Concurrent writers in one plot queue up on the plot's counter: distinct codes, no deadlock.
// They need their own connections, so the rows are committed, under a soft-deleted field the
// app never shows, and removed afterwards.
func TestZoneCodesConcurrent(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	var fieldID, plotID uuid.UUID
	err := pool.QueryRow(ctx, `
		INSERT INTO field (name, frame_width, frame_height, deleted_at) VALUES ($1, 1000, 700, now()) RETURNING id`,
		dbtest.Name("Test zone codes")).Scan(&fieldID)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for _, q := range []string{
			`DELETE FROM zone WHERE plot_id IN (SELECT id FROM plot WHERE field_id = $1)`,
			`DELETE FROM plot WHERE field_id = $1`,
			`DELETE FROM field WHERE id = $1`,
		} {
			if _, err := pool.Exec(context.Background(), q, fieldID); err != nil {
				t.Errorf("cleanup: %v", err)
			}
		}
	})
	err = pool.QueryRow(ctx, `
		INSERT INTO plot (field_id, name, geom) VALUES ($1, 'P', 'POLYGON((0 0,100 0,100 100,0 100,0 0))') RETURNING id`,
		fieldID).Scan(&plotID)
	if err != nil {
		t.Fatal(err)
	}

	const n = 8
	run := func(write func() error) []error {
		var wg sync.WaitGroup
		start := make(chan struct{})
		errs := make([]error, n)
		for i := range n {
			wg.Go(func() {
				<-start
				errs[i] = write()
			})
		}
		close(start)
		wg.Wait()
		return errs
	}

	// the database alone: plain inserts, each in its own transaction
	for i, err := range run(func() error {
		_, err := pool.Exec(ctx, `INSERT INTO zone (plot_id, geom) VALUES ($1, 'POLYGON((10 10,20 10,20 20,10 20,10 10))')`, plotID)
		return err
	}) {
		if err != nil {
			t.Fatalf("insert %d: %v", i, err)
		}
	}
	var numbers []int
	rows, err := pool.Query(ctx, `SELECT number FROM zone WHERE plot_id = $1 ORDER BY number`, plotID)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var k int
		if err := rows.Scan(&k); err != nil {
			t.Fatal(err)
		}
		numbers = append(numbers, k)
	}
	if want := []int{1, 2, 3, 4, 5, 6, 7, 8}; !slices.Equal(numbers, want) {
		t.Fatalf("numbers %v, want %v", numbers, want)
	}

	// through the store: each PutZone locks the plot before its insert bumps the counter, so
	// none deadlocks. (Its field is soft-deleted, so the zone can't be read back afterwards:
	// each write ends in ErrNotFound and is rolled back. A deadlock would be a different error.)
	s := store.New(pool)
	for i, err := range run(func() error {
		_, _, err := s.PutZone(ctx, uuid.New(), store.ZoneInput{PlotID: plotID, Geom: square(10, 10, 10)})
		return err
	}) {
		if !errors.Is(err, store.ErrNotFound) {
			t.Fatalf("PutZone %d: %v", i, err)
		}
	}
}

// The migration numbers existing zones per plot in creation order, deleted ones
// included, and sets each plot's counter to the last number it gave out. Its
// backfill statements run here on temporary copies of the two tables (temporary
// tables come first in the search path), so the real ones are left alone.
func TestZoneCodeBackfill(t *testing.T) {
	tx := dbtest.Tx(t)
	ctx := t.Context()
	files, err := filepath.Glob("../db/migrations/*_zone_code.sql")
	if err != nil || len(files) != 1 {
		t.Fatalf("migration file: %v %v", files, err)
	}
	src, err := os.ReadFile(files[0])
	if err != nil {
		t.Fatal(err)
	}
	_, rest, ok := strings.Cut(string(src), "-- Existing zones")
	backfill, _, ok2 := strings.Cut(rest, "ALTER TABLE zone ALTER COLUMN number SET NOT NULL")
	if !ok || !ok2 {
		t.Fatal("backfill statements not found in the migration")
	}
	_, backfill, _ = strings.Cut(backfill, "\n") // the rest of the comment line

	for _, q := range []string{
		`CREATE TEMP TABLE plot (id uuid PRIMARY KEY, last_zone_number integer NOT NULL DEFAULT 0) ON COMMIT DROP`,
		`CREATE TEMP TABLE zone (id uuid PRIMARY KEY, plot_id uuid NOT NULL, created_at timestamptz NOT NULL,
		                         deleted_at timestamptz, number integer) ON COMMIT DROP`,
	} {
		if _, err := tx.Exec(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	p1, p2, empty := uuid.New(), uuid.New(), uuid.New()
	day := time.Date(2026, 3, 1, 9, 0, 0, 0, time.UTC)
	type zone struct {
		plot    uuid.UUID
		created time.Time
		deleted bool
		want    int
	}
	zones := map[uuid.UUID]zone{
		uuid.New(): {p1, day.Add(2 * time.Hour), false, 3},
		uuid.New(): {p1, day, true, 1}, // deleted: keeps a number
		uuid.New(): {p1, day.Add(time.Hour), false, 2},
		uuid.New(): {p2, day.Add(5 * time.Hour), false, 1},
		uuid.New(): {p1, day.Add(3 * time.Hour), false, 4},
	}
	for _, id := range []uuid.UUID{p1, p2, empty} {
		if _, err := tx.Exec(ctx, `INSERT INTO plot (id) VALUES ($1)`, id); err != nil {
			t.Fatal(err)
		}
	}
	for id, z := range zones {
		if _, err := tx.Exec(ctx, `INSERT INTO zone (id, plot_id, created_at, deleted_at) VALUES ($1, $2, $3, CASE WHEN $4 THEN now() END)`,
			id, z.plot, z.created, z.deleted); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := tx.Exec(ctx, backfill); err != nil {
		t.Fatalf("backfill: %v", err)
	}
	for id, z := range zones {
		var got int
		if err := tx.QueryRow(ctx, `SELECT number FROM pg_temp.zone WHERE id = $1`, id).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if got != z.want {
			t.Errorf("zone created %v in plot %v: number %d, want %d", z.created, z.plot, got, z.want)
		}
	}
	for id, want := range map[uuid.UUID]int{p1: 4, p2: 1, empty: 0} {
		var got int
		if err := tx.QueryRow(ctx, `SELECT last_zone_number FROM pg_temp.plot WHERE id = $1`, id).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Errorf("plot counter %d, want %d", got, want)
		}
	}
}
