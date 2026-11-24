package store_test

import (
	"errors"
	"slices"
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

func TestPlotStatsWateringCoverageAndWeeklyActivity(t *testing.T) {
	w := newActivityWorld(t)
	ctx := t.Context()
	plotID := func(zone uuid.UUID) uuid.UUID {
		z, err := w.s.GetZone(ctx, zone)
		if err != nil {
			t.Fatal(err)
		}
		return z.PlotID
	}(w.zoneA)
	path, _, err := w.s.PutZone(ctx, uuid.New(), store.ZoneInput{PlotID: plotID, Label: ptr("Path"), Kind: "path", Geom: square(50, 50, 10)})
	if err != nil {
		t.Fatal(err)
	}
	empty := newPlot(t, w.s, "Plot Empty stats", square(200, 200, 50))
	log := func(typ string, day string, zones ...uuid.UUID) uuid.UUID {
		t.Helper()
		id := uuid.New()
		in := store.ActivityInput{Type: typ, PerformedOn: day}
		for _, z := range zones {
			in.Zones = append(in.Zones, store.ActivityZone{ZoneID: z})
		}
		if _, _, err := w.s.PutActivity(ctx, id, in); err != nil {
			t.Fatal(err)
		}
		return id
	}
	log("watering", fieldDay(t, -6), w.zoneA)     // watered within the last 7 days; week 7
	log("watering", fieldDay(t, -7), w.zoneB)     // one day too old for coverage; week 6
	log("watering", w.today, path.ID)             // paths don't count for coverage, but are activity; week 7
	log("sowing", w.today, w.zoneA, w.zoneB)      // one activity on two zones counts once; week 7
	log("fertilizing", fieldDay(t, -55), w.zoneA) // oldest week
	log("fertilizing", fieldDay(t, -56), w.zoneA) // outside the 8 weeks
	gone := log("watering", w.today, w.zoneB)     // deleted: neither watered nor counted
	if err := w.s.DeleteActivity(ctx, gone); err != nil {
		t.Fatal(err)
	}

	stats, err := w.s.ListPlotStats(ctx)
	if err != nil || len(stats) != 2 {
		t.Fatalf("%+v %v", stats, err)
	}
	byID := map[uuid.UUID]store.PlotStats{}
	for _, p := range stats {
		byID[p.PlotID] = p
	}
	p := byID[plotID]
	if p.CultivationZones != 2 || p.ZonesWatered7d != 1 {
		t.Fatalf("coverage: %d of %d", p.ZonesWatered7d, p.CultivationZones)
	}
	if want := []int{1, 0, 0, 0, 0, 0, 1, 3}; !slices.Equal(p.ActivitiesPerWeek, want) {
		t.Fatalf("weeks: %v, want %v", p.ActivitiesPerWeek, want)
	}
	e := byID[empty.ID]
	if e.CultivationZones != 0 || e.ZonesWatered7d != 0 || !slices.Equal(e.ActivitiesPerWeek, make([]int, 8)) {
		t.Fatalf("empty plot: %+v", e)
	}
}

func TestPlantedStats(t *testing.T) {
	w := newActivityWorld(t)
	ctx := t.Context()
	plot2 := newPlot(t, w.s, dbtest.Name("Plot Planted"), square(200, 200, 100))
	zoneC, _, err := w.s.PutZone(ctx, uuid.New(), store.ZoneInput{PlotID: plot2.ID, Label: ptr("C"), Geom: square(210, 210, 10)})
	if err != nil {
		t.Fatal(err)
	}
	mix, _, err := w.s.PutSpecies(ctx, uuid.New(), store.SpeciesInput{ScientificName: dbtest.Name("Test Arbutus planted")})
	if err != nil {
		t.Fatal(err)
	}
	seedOnly, _, err := w.s.PutSpecies(ctx, uuid.New(), store.SpeciesInput{ScientificName: dbtest.Name("Test Pinus seeds only")})
	if err != nil {
		t.Fatal(err)
	}
	q, p := w.species, mix.ID
	log := func(typ string, day int, zones []store.ActivityZone, species ...store.ActivitySpecies) uuid.UUID {
		t.Helper()
		id := uuid.New()
		if _, _, err := w.s.PutActivity(ctx, id, store.ActivityInput{Type: typ, PerformedOn: fieldDay(t, day), Zones: zones, Species: species}); err != nil {
			t.Fatal(err)
		}
		return id
	}
	zq := func(zone uuid.UUID, n int, unit string) store.ActivityZone {
		return store.ActivityZone{ZoneID: zone, Quantity: ptr(n), Unit: ptr(unit)}
	}
	// a sowing of a mix over both plots: each species "has" all 140 covas
	log("sowing", -10, []store.ActivityZone{zq(w.zoneA, 100, "holes"), zq(zoneC.ID, 40, "holes")},
		store.ActivitySpecies{SpeciesID: q}, store.ActivitySpecies{SpeciesID: p, Quantity: ptr(500), Unit: ptr("seeds")})
	log("sowing", -40, []store.ActivityZone{zq(w.zoneA, 999, "holes")}, store.ActivitySpecies{SpeciesID: q}) // before the range
	// one species without its own count: it gets the planting's whole count
	log("planting", -5, []store.ActivityZone{zq(w.zoneB, 30, "trees")}, store.ActivitySpecies{SpeciesID: q})
	// counts per species
	log("planting", -3, []store.ActivityZone{zq(zoneC.ID, 20, "trees")},
		store.ActivitySpecies{SpeciesID: q, Quantity: ptr(12), Unit: ptr("trees")}, store.ActivitySpecies{SpeciesID: p, Quantity: ptr(8), Unit: ptr("trees")})
	// a mix without counts per species: counted for the plot only
	log("planting", -2, []store.ActivityZone{zq(w.zoneA, 10, "trees")}, store.ActivitySpecies{SpeciesID: q}, store.ActivitySpecies{SpeciesID: p})
	gone := log("sowing", -1, []store.ActivityZone{zq(w.zoneA, 500, "holes")}, store.ActivitySpecies{SpeciesID: q})
	if err := w.s.DeleteActivity(ctx, gone); err != nil {
		t.Fatal(err)
	}
	log("watering", -1, []store.ActivityZone{zq(w.zoneA, 50, "litres")})
	// sown by seeds, not covas: nothing counted, so the species isn't listed
	log("sowing", -4, []store.ActivityZone{zq(w.zoneB, 300, "seeds")}, store.ActivitySpecies{SpeciesID: seedOnly.ID})

	check := func(plots map[uuid.UUID][2]int, species map[uuid.UUID][2]int) {
		t.Helper()
		st, err := w.s.GetPlantedStats(ctx, fieldDay(t, -20), fieldDay(t, 0))
		if err != nil {
			t.Fatal(err)
		}
		if st.From != fieldDay(t, -20) || st.To != fieldDay(t, 0) {
			t.Fatalf("range: %s – %s", st.From, st.To)
		}
		gotPlots := map[uuid.UUID][2]int{}
		for _, pl := range st.Plots {
			gotPlots[pl.PlotID] = [2]int{pl.HolesSown, pl.TreesPlanted}
		}
		for id, want := range plots {
			if got, ok := gotPlots[id]; !ok || got != want {
				t.Errorf("plot %s: got %v (listed %v), want %v", id, got, ok, want)
			}
		}
		gotSpecies := map[uuid.UUID][2]int{}
		for _, sp := range st.Species {
			gotSpecies[sp.SpeciesID] = [2]int{sp.HolesSown, sp.TreesPlanted}
		}
		for id, want := range species {
			if got, ok := gotSpecies[id]; !ok || got != want {
				t.Errorf("species %s: got %v (listed %v), want %v", id, got, ok, want)
			}
		}
		if got, ok := gotSpecies[seedOnly.ID]; ok {
			t.Errorf("species sown only by seeds is listed: %v", got)
		}
	}
	za, err := w.s.GetZone(ctx, w.zoneA)
	if err != nil {
		t.Fatal(err)
	}
	plot1 := za.PlotID
	check(map[uuid.UUID][2]int{plot1: {100, 40}, plot2.ID: {40, 20}}, map[uuid.UUID][2]int{q: {140, 42}, p: {140, 8}})

	// a deleted zone's work no longer counts, and the plot stays listed with zeros
	if err := w.s.DeleteZone(ctx, zoneC.ID); err != nil {
		t.Fatal(err)
	}
	check(map[uuid.UUID][2]int{plot1: {100, 40}, plot2.ID: {0, 0}}, map[uuid.UUID][2]int{q: {100, 30}, p: {100, 0}})

	var ve *store.ValidationError
	if _, err := w.s.GetPlantedStats(ctx, "2026-09-30", "2026-09-01"); !errors.As(err, &ve) {
		t.Fatalf("reversed range: %v", err)
	}
	if _, err := w.s.GetPlantedStats(ctx, "", "2026-09-01"); !errors.As(err, &ve) {
		t.Fatalf("missing start: %v", err)
	}
}
