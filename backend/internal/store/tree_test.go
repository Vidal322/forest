package store_test

import (
	"errors"
	"testing"

	"github.com/google/uuid"

	"forest/internal/store"
)

func TestTreeCounts(t *testing.T) {
	w := newActivityWorld(t)
	ctx := t.Context()
	set := func(alive, dead int) {
		t.Helper()
		if _, err := w.s.SetTreeCounts(ctx, w.zoneA, w.species, store.TreeCountInput{Alive: alive, Dead: dead}); err != nil {
			t.Fatal(err)
		}
	}
	count := func() (int, int) {
		t.Helper()
		list, err := w.s.ListTreeCounts(ctx)
		if err != nil {
			t.Fatal(err)
		}
		for _, c := range list {
			if c.ZoneID == w.zoneA && c.SpeciesID == w.species {
				return c.Alive, c.Dead
			}
		}
		return 0, 0
	}
	set(12, 0)
	set(12, 0) // retried: nothing changes
	if a, d := count(); a != 12 || d != 0 {
		t.Fatalf("after planting: %d/%d", a, d)
	}
	set(10, 2) // two died
	if a, d := count(); a != 10 || d != 2 {
		t.Fatalf("after deaths: %d/%d", a, d)
	}
	stats, _ := w.s.ListPlotStats(ctx)
	if stats[0].TreeCount != 10 || stats[0].DeadTreeCount != 2 {
		t.Fatalf("plot stats: %+v", stats[0])
	}
	set(9, 2) // a correction
	if a, d := count(); a != 9 || d != 2 {
		t.Fatalf("after correction: %d/%d", a, d)
	}
	var ve *store.ValidationError
	if _, err := w.s.SetTreeCounts(ctx, w.zoneA, w.species, store.TreeCountInput{Alive: -1}); !errors.As(err, &ve) {
		t.Fatalf("negative: %v", err)
	}
	if _, err := w.s.SetTreeCounts(ctx, w.zoneA, uuid.New(), store.TreeCountInput{Alive: 1}); !errors.As(err, &ve) {
		t.Fatalf("unknown species: %v", err)
	}
	if err := w.s.DeleteZone(ctx, w.zoneB); err != nil {
		t.Fatal(err)
	}
	if _, err := w.s.SetTreeCounts(ctx, w.zoneB, w.species, store.TreeCountInput{Alive: 1}); !errors.Is(err, store.ErrDeleted) {
		t.Fatalf("deleted zone: %v", err)
	}
}

func TestTreeCountsInOverlappingZones(t *testing.T) {
	w := newActivityWorld(t)
	ctx := t.Context()
	plots, _ := w.s.ListPlots(ctx)
	// zone C lies inside zone A (re-sowing part of an old area)
	c, _, err := w.s.PutZone(ctx, uuid.New(), store.ZoneInput{PlotID: plots[0].ID, Geom: square(12, 12, 4)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.s.SetTreeCounts(ctx, w.zoneA, w.species, store.TreeCountInput{Alive: 10}); err != nil {
		t.Fatal(err)
	}
	if _, err := w.s.SetTreeCounts(ctx, c.ID, w.species, store.TreeCountInput{Alive: 0, Dead: 0}); err != nil {
		t.Fatal(err)
	}
	list, _ := w.s.ListTreeCounts(ctx)
	if len(list) != 1 || list[0].ZoneID != w.zoneA || list[0].Alive != 10 {
		t.Fatalf("zone C's counts touched zone A's trees: %+v", list)
	}
	// a tree that died and came back (a counting mistake)
	if _, err := w.s.SetTreeCounts(ctx, w.zoneA, w.species, store.TreeCountInput{Alive: 8, Dead: 2}); err != nil {
		t.Fatal(err)
	}
	if _, err := w.s.SetTreeCounts(ctx, w.zoneA, w.species, store.TreeCountInput{Alive: 10, Dead: 0}); err != nil {
		t.Fatal(err)
	}
	stats, _ := w.s.ListPlotStats(ctx)
	if stats[0].TreeCount != 10 || stats[0].DeadTreeCount != 0 {
		t.Fatalf("plot stats: %+v", stats[0])
	}
	// deleting the zone takes its counted trees out of the plot's numbers
	if err := w.s.DeleteZone(ctx, w.zoneA); err != nil {
		t.Fatal(err)
	}
	if stats, _ = w.s.ListPlotStats(ctx); stats[0].TreeCount != 0 {
		t.Fatalf("after zone delete: %+v", stats[0])
	}
}
