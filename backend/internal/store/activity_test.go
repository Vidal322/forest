package store_test

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"forest/internal/dbtest"
	"forest/internal/store"
)

type activityWorld struct {
	s            *store.Store
	zoneA, zoneB uuid.UUID
	species      uuid.UUID
	today        string
}

func newActivityWorld(t *testing.T) activityWorld {
	t.Helper()
	s, _ := freshStore(t)
	ctx := t.Context()
	newField(t, s)
	plot := newPlot(t, s, "Plot Act", square(0, 0, 100))
	a, _, err := s.PutZone(ctx, uuid.New(), store.ZoneInput{PlotID: plot.ID, Label: ptr("A"), Geom: square(10, 10, 10)})
	if err != nil {
		t.Fatal(err)
	}
	b, _, err := s.PutZone(ctx, uuid.New(), store.ZoneInput{PlotID: plot.ID, Label: ptr("B"), Geom: square(30, 30, 10)})
	if err != nil {
		t.Fatal(err)
	}
	sp, _, err := s.PutSpecies(ctx, uuid.New(), store.SpeciesInput{ScientificName: dbtest.Name("Test Quercus act")})
	if err != nil {
		t.Fatal(err)
	}
	return activityWorld{s: s, zoneA: a.ID, zoneB: b.ID, species: sp.ID, today: fieldDay(t, 0)}
}

// fieldDay is today+offset in the field's timezone (the server's field_today()).
func fieldDay(t *testing.T, offset int) string {
	t.Helper()
	loc, err := time.LoadLocation("Europe/Lisbon")
	if err != nil {
		t.Fatal(err)
	}
	return time.Now().In(loc).AddDate(0, 0, offset).Format(time.DateOnly)
}

func TestActivityCreateRetryUpdate(t *testing.T) {
	w := newActivityWorld(t)
	ctx := t.Context()
	id := uuid.New()
	sowing := store.ActivityInput{
		Type: "sowing", PerformedOn: w.today, Notes: ptr("Ninhos"),
		Zones:   []store.ActivityZone{{ZoneID: w.zoneB, Quantity: ptr(80), Unit: ptr("holes")}, {ZoneID: w.zoneA, Quantity: ptr(100), Unit: ptr("holes")}},
		Species: []store.ActivitySpecies{{SpeciesID: w.species}},
	}
	a, created, err := w.s.PutActivity(ctx, id, sowing)
	if err != nil || !created || a.Version != 1 || len(a.Zones) != 2 || len(a.Species) != 1 {
		t.Fatalf("create: %+v %v %v", a, created, err)
	}

	// the same request again (lost answer, retried): no-op, still version 1
	if a, created, err = w.s.PutActivity(ctx, id, sowing); err != nil || created || a.Version != 1 {
		t.Fatalf("retry: %+v %v %v", a, created, err)
	}

	// an edit from version 1: only the zones change, and the version still moves on
	edit := sowing
	edit.Zones = []store.ActivityZone{{ZoneID: w.zoneA, Quantity: ptr(100), Unit: ptr("holes")}}
	edit.BaseVersion = ptr(1)
	if a, _, err = w.s.PutActivity(ctx, id, edit); err != nil || a.Version != 2 || len(a.Zones) != 1 {
		t.Fatalf("edit: %+v %v", a, err)
	}

	// a stale edit (made offline from version 1) conflicts and carries the current copy
	stale := sowing
	stale.Notes = ptr("other words")
	stale.BaseVersion = ptr(1)
	_, _, err = w.s.PutActivity(ctx, id, stale)
	var vc *store.VersionConflictError
	if !errors.As(err, &vc) || !errors.Is(err, store.ErrVersionConflict) || vc.Current.Version != 2 {
		t.Fatalf("stale edit: %v", err)
	}

	// status is derived from the log
	z, err := w.s.GetZone(ctx, w.zoneA)
	if err != nil || z.LastSownOn == nil || *z.LastSownOn != w.today {
		t.Fatalf("zone after sowing: %+v %v", z, err)
	}

	if err := w.s.DeleteActivity(ctx, id); err != nil {
		t.Fatal(err)
	}
	if _, _, err := w.s.PutActivity(ctx, id, edit); !errors.Is(err, store.ErrDeleted) {
		t.Fatalf("edit after delete: %v", err)
	}
	if z, _ = w.s.GetZone(ctx, w.zoneA); z.LastSownOn != nil {
		t.Fatalf("deleted activity still counts: %+v", z)
	}
}

func TestActivityValidation(t *testing.T) {
	w := newActivityWorld(t)
	tomorrow2 := fieldDay(t, 3)
	one := []store.ActivityZone{{ZoneID: w.zoneA}}
	for name, in := range map[string]store.ActivityInput{
		"bad type":         {Type: "dancing", PerformedOn: w.today, Zones: one},
		"bad date":         {Type: "watering", PerformedOn: "22/11/2026", Zones: one},
		"future":           {Type: "watering", PerformedOn: tomorrow2, Zones: one},
		"no zones":         {Type: "watering", PerformedOn: w.today},
		"zone twice":       {Type: "watering", PerformedOn: w.today, Zones: []store.ActivityZone{{ZoneID: w.zoneA}, {ZoneID: w.zoneA}}},
		"number, no unit":  {Type: "sowing", PerformedOn: w.today, Zones: []store.ActivityZone{{ZoneID: w.zoneA, Quantity: ptr(3)}}},
		"zero":             {Type: "sowing", PerformedOn: w.today, Zones: []store.ActivityZone{{ZoneID: w.zoneA, Quantity: ptr(0), Unit: ptr("holes")}}},
		"bad unit":         {Type: "sowing", PerformedOn: w.today, Zones: []store.ActivityZone{{ZoneID: w.zoneA, Quantity: ptr(3), Unit: ptr("buckets")}}},
		"species on water": {Type: "watering", PerformedOn: w.today, Zones: one, Species: []store.ActivitySpecies{{SpeciesID: w.species}}},
		"unknown zone":     {Type: "watering", PerformedOn: w.today, Zones: []store.ActivityZone{{ZoneID: uuid.New()}}},
		"unknown species":  {Type: "sowing", PerformedOn: w.today, Zones: one, Species: []store.ActivitySpecies{{SpeciesID: uuid.New()}}},
	} {
		var ve *store.ValidationError
		if _, _, err := w.s.PutActivity(t.Context(), uuid.New(), in); !errors.As(err, &ve) {
			t.Errorf("%s: want a validation error, got %v", name, err)
		}
	}
}

func TestListActivities(t *testing.T) {
	w := newActivityWorld(t)
	ctx := t.Context()
	yesterday := fieldDay(t, -1)
	if _, _, err := w.s.PutActivity(ctx, uuid.New(), store.ActivityInput{Type: "watering", PerformedOn: yesterday,
		Zones: []store.ActivityZone{{ZoneID: w.zoneA}, {ZoneID: w.zoneB}}}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := w.s.PutActivity(ctx, uuid.New(), store.ActivityInput{Type: "watering", PerformedOn: w.today,
		Zones: []store.ActivityZone{{ZoneID: w.zoneB}}}); err != nil {
		t.Fatal(err)
	}
	onlyA, err := w.s.ListActivities(ctx, store.ActivityFilter{ZoneID: &w.zoneA})
	if err != nil || len(onlyA) != 1 {
		t.Fatalf("zone filter: %d %v", len(onlyA), err)
	}
	onB, _ := w.s.ListActivities(ctx, store.ActivityFilter{ZoneID: &w.zoneB})
	if len(onB) != 2 || onB[0].PerformedOn != w.today {
		t.Fatalf("newest first: %+v", onB)
	}
	since, _ := w.s.ListActivities(ctx, store.ActivityFilter{ZoneID: &w.zoneB, Since: &w.today})
	if len(since) != 1 {
		t.Fatalf("since: %d", len(since))
	}
}

func TestEditOfUnknownActivityIsGone(t *testing.T) {
	w := newActivityWorld(t)
	_, _, err := w.s.PutActivity(t.Context(), uuid.New(), store.ActivityInput{Type: "watering", PerformedOn: w.today,
		Zones: []store.ActivityZone{{ZoneID: w.zoneA}}, BaseVersion: ptr(3)})
	if !errors.Is(err, store.ErrDeleted) {
		t.Fatalf("got %v", err)
	}
}
