package store_test

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"forest/internal/dbtest"
	"forest/internal/store"
)

func TestPlotStats(t *testing.T) {
	w := newActivityWorld(t)
	ctx := t.Context()
	if _, _, err := w.s.PutActivity(ctx, uuid.New(), store.ActivityInput{Type: "sowing", PerformedOn: w.today,
		Zones:   []store.ActivityZone{{ZoneID: w.zoneA, Quantity: ptr(100), Unit: ptr("holes")}, {ZoneID: w.zoneB, Quantity: ptr(80), Unit: ptr("holes")}},
		Species: []store.ActivitySpecies{{SpeciesID: w.species}}}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := w.s.PutActivity(ctx, uuid.New(), store.ActivityInput{Type: "watering", PerformedOn: w.today,
		Zones: []store.ActivityZone{{ZoneID: w.zoneA, Quantity: ptr(50), Unit: ptr("litres")}}}); err != nil {
		t.Fatal(err)
	}
	stats, err := w.s.ListPlotStats(ctx)
	if err != nil || len(stats) != 1 {
		t.Fatalf("stats: %+v %v", stats, err)
	}
	p := stats[0]
	if p.ZoneCount != 2 || p.HolesSown != 180 || p.LitresWatered != 50 || p.WateringsLast30d != 1 || p.SpeciesCount != 1 ||
		p.LastWateredOn == nil || *p.LastWateredOn != w.today {
		t.Fatalf("plot stats: %+v", p)
	}
}

func TestWateringRules(t *testing.T) {
	w := newActivityWorld(t)
	ctx := t.Context()
	id := uuid.New()
	month := mustMonth(t, w.today)
	if _, created, err := w.s.PutWateringRule(ctx, id, store.WateringRuleInput{Name: "This month", FromMonth: month, ToMonth: month, IntervalDays: 3}); err != nil || !created {
		t.Fatalf("create: %v %v", created, err)
	}
	z, _ := w.s.GetZone(ctx, w.zoneA)
	if z.CurrentIntervalDays != 3 {
		t.Fatalf("rule not applied: %d", z.CurrentIntervalDays)
	}
	var ve *store.ValidationError
	if _, _, err := w.s.PutWateringRule(ctx, uuid.New(), store.WateringRuleInput{Name: "x", FromMonth: 13, ToMonth: 1, IntervalDays: 3}); !errors.As(err, &ve) {
		t.Fatalf("bad month: %v", err)
	}
	if err := w.s.DeleteWateringRule(ctx, id); err != nil {
		t.Fatal(err)
	}
	if z, _ = w.s.GetZone(ctx, w.zoneA); z.CurrentIntervalDays != 7 {
		t.Fatalf("after delete: %d", z.CurrentIntervalDays)
	}
	if list, _ := w.s.ListWateringRules(ctx); len(list) != 0 {
		t.Fatalf("list: %+v", list)
	}
}

func mustMonth(t *testing.T, day string) int {
	t.Helper()
	d, err := time.Parse(time.DateOnly, day)
	if err != nil {
		t.Fatal(err)
	}
	return int(d.Month())
}

func TestPlotStatsIgnoresDeletedAndOldEntries(t *testing.T) {
	w := newActivityWorld(t)
	ctx := t.Context()
	log := func(typ string, day string, zones ...store.ActivityZone) uuid.UUID {
		t.Helper()
		id := uuid.New()
		if _, _, err := w.s.PutActivity(ctx, id, store.ActivityInput{Type: typ, PerformedOn: day, Zones: zones}); err != nil {
			t.Fatal(err)
		}
		return id
	}
	gone := log("sowing", w.today, store.ActivityZone{ZoneID: w.zoneA, Quantity: ptr(500), Unit: ptr("holes")})
	if err := w.s.DeleteActivity(ctx, gone); err != nil {
		t.Fatal(err)
	}
	log("sowing", w.today, store.ActivityZone{ZoneID: w.zoneA, Quantity: ptr(40), Unit: ptr("seeds")}) // seeds aren't covas
	log("watering", fieldDay(t, -30), store.ActivityZone{ZoneID: w.zoneA})                             // just outside 30 days
	log("watering", fieldDay(t, -29), store.ActivityZone{ZoneID: w.zoneB})

	stats, err := w.s.ListPlotStats(ctx)
	if err != nil || len(stats) != 1 {
		t.Fatalf("%+v %v", stats, err)
	}
	p := stats[0]
	if p.HolesSown != 0 || p.WateringsLast30d != 1 || p.LastWateredOn == nil || *p.LastWateredOn != fieldDay(t, -29) {
		t.Fatalf("stats: %+v", p)
	}
}

func TestWateringRuleOverlapsAndWrap(t *testing.T) {
	w := newActivityWorld(t)
	ctx := t.Context()
	winter, summer, july := uuid.New(), uuid.New(), uuid.New()
	for id, in := range map[uuid.UUID]store.WateringRuleInput{
		winter: {Name: "Winter", FromMonth: 11, ToMonth: 2, IntervalDays: 14},
		summer: {Name: "Summer", FromMonth: 6, ToMonth: 9, IntervalDays: 4},
		july:   {Name: "July", FromMonth: 7, ToMonth: 7, IntervalDays: 2},
	} {
		if _, _, err := w.s.PutWateringRule(ctx, id, in); err != nil {
			t.Fatal(err)
		}
	}
	rules, _ := w.s.ListWateringRules(ctx)
	got := map[uuid.UUID]int{}
	for _, r := range rules {
		got[r.ID] = len(r.OverlapsWith)
	}
	if got[winter] != 0 || got[summer] != 1 || got[july] != 1 {
		t.Fatalf("overlaps: %v", got)
	}
	if err := w.s.DeleteWateringRule(ctx, winter); err != nil {
		t.Fatal(err)
	}
	if _, _, err := w.s.PutWateringRule(ctx, winter, store.WateringRuleInput{Name: "Winter", FromMonth: 11, ToMonth: 2, IntervalDays: 14}); !errors.Is(err, store.ErrDeleted) {
		t.Fatalf("edit deleted rule: %v", err)
	}
	if err := w.s.DeleteWateringRule(ctx, uuid.New()); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("delete unknown: %v", err)
	}
}

func TestActivityUnitsMatchTheWork(t *testing.T) {
	w := newActivityWorld(t)
	var ve *store.ValidationError
	_, _, err := w.s.PutActivity(t.Context(), uuid.New(), store.ActivityInput{Type: "watering", PerformedOn: w.today,
		Zones: []store.ActivityZone{{ZoneID: w.zoneA, Quantity: ptr(3), Unit: ptr("kg")}}})
	if !errors.As(err, &ve) {
		t.Fatalf("kg of water: %v", err)
	}
}

func TestSpeciesStats(t *testing.T) {
	w := newActivityWorld(t)
	ctx := t.Context()
	other, _, err := w.s.PutSpecies(ctx, uuid.New(), store.SpeciesInput{ScientificName: dbtest.Name("Test Pinus stats")})
	if err != nil {
		t.Fatal(err)
	}
	log := func(typ, day string, zone uuid.UUID) uuid.UUID {
		t.Helper()
		id := uuid.New()
		if _, _, err := w.s.PutActivity(ctx, id, store.ActivityInput{Type: typ, PerformedOn: day,
			Zones: []store.ActivityZone{{ZoneID: zone}}, Species: []store.ActivitySpecies{{SpeciesID: w.species}}}); err != nil {
			t.Fatal(err)
		}
		return id
	}
	log("sowing", fieldDay(t, -10), w.zoneA)
	log("sowing", fieldDay(t, -5), w.zoneA)
	gone := log("sowing", fieldDay(t, -1), w.zoneA)
	if err := w.s.DeleteActivity(ctx, gone); err != nil {
		t.Fatal(err)
	}
	// trees counted in zone B, without a planting logged; the other species only has dead trees
	if _, err := w.s.SetTreeCounts(ctx, w.zoneB, w.species, store.TreeCountInput{Alive: 3, Dead: 1}); err != nil {
		t.Fatal(err)
	}
	if _, err := w.s.SetTreeCounts(ctx, w.zoneA, other.ID, store.TreeCountInput{Dead: 2}); err != nil {
		t.Fatal(err)
	}
	log("planting", fieldDay(t, -3), w.zoneB)

	stats, err := w.s.ListSpeciesStats(ctx)
	if err != nil {
		t.Fatal(err)
	}
	byID := map[uuid.UUID]store.SpeciesStats{}
	for _, st := range stats {
		byID[st.SpeciesID] = st
	}
	got := byID[w.species]
	if got.ZoneCount != 2 || got.AliveTreeCount != 3 || got.LastSownOn == nil || *got.LastSownOn != fieldDay(t, -5) ||
		got.LastPlantedOn == nil || *got.LastPlantedOn != fieldDay(t, -3) {
		t.Fatalf("used species: %+v", got)
	}
	unused, ok := byID[other.ID]
	if !ok || unused.ZoneCount != 0 || unused.AliveTreeCount != 0 || unused.LastSownOn != nil || unused.LastPlantedOn != nil {
		t.Fatalf("species with dead trees only: %+v (listed %v)", unused, ok)
	}

	if err := w.s.DeleteSpecies(ctx, other.ID); err != nil {
		t.Fatal(err)
	}
	stats, _ = w.s.ListSpeciesStats(ctx)
	for _, st := range stats {
		if st.SpeciesID == other.ID {
			t.Fatal("deleted species still listed")
		}
	}
}
