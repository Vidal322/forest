package store_test

import (
	"errors"
	"testing"

	"github.com/google/uuid"

	"forest/internal/store"
)

func zoneOn(t *testing.T, w activityWorld, day string, id uuid.UUID) store.Zone {
	t.Helper()
	zones, err := w.s.ListZonesOn(t.Context(), day)
	if err != nil {
		t.Fatalf("as of %s: %v", day, err)
	}
	for _, z := range zones {
		if z.ID == id {
			return z
		}
	}
	t.Fatalf("as of %s: zone %s missing", day, id)
	return store.Zone{}
}

func TestZonesAsOf(t *testing.T) {
	w := newActivityWorld(t)
	ctx := t.Context()
	log := func(typ string, day string) {
		t.Helper()
		if _, _, err := w.s.PutActivity(ctx, uuid.New(), store.ActivityInput{Type: typ, PerformedOn: day,
			Zones: []store.ActivityZone{{ZoneID: w.zoneA}}}); err != nil {
			t.Fatal(err)
		}
	}
	sown, watered := fieldDay(t, -20), fieldDay(t, -10)
	log("sowing", sown)
	log("watering", watered)
	// a deleted watering never counts, on any day
	gone := uuid.New()
	if _, _, err := w.s.PutActivity(ctx, gone, store.ActivityInput{Type: "watering", PerformedOn: fieldDay(t, -12),
		Zones: []store.ActivityZone{{ZoneID: w.zoneA}}}); err != nil {
		t.Fatal(err)
	}
	if err := w.s.DeleteActivity(ctx, gone); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name          string
		day           string
		sown, watered *string
		needsWater    bool
	}{
		{"before anything", fieldDay(t, -25), nil, nil, false},
		{"day of sowing", sown, &sown, nil, false},
		{"8 days after sowing, not watered yet", fieldDay(t, -12), &sown, nil, true},
		{"day of watering", watered, &sown, &watered, false},
		{"today", w.today, &sown, &watered, true},
	}
	for _, c := range cases {
		z := zoneOn(t, w, c.day, w.zoneA)
		if !sameDay(z.LastSownOn, c.sown) || !sameDay(z.LastWateredOn, c.watered) || z.NeedsWater == nil || *z.NeedsWater != c.needsWater {
			t.Errorf("%s (%s): sown %v watered %v needs water %v", c.name, c.day, deref(z.LastSownOn), deref(z.LastWateredOn), deref(z.NeedsWater))
		}
	}

	// today's as-of state is exactly what the zone list says
	now, err := w.s.GetZone(ctx, w.zoneA)
	if err != nil {
		t.Fatal(err)
	}
	if got := zoneOn(t, w, w.today, w.zoneA); got.NeedsWater == nil || *got.NeedsWater != *now.NeedsWater ||
		got.CurrentIntervalDays != now.CurrentIntervalDays || !sameDay(got.LastWateredOn, now.LastWateredOn) {
		t.Fatalf("today as of %+v, list %+v", got, now)
	}

	var ve *store.ValidationError
	if _, err := w.s.ListZonesOn(ctx, fieldDay(t, 2)); !errors.As(err, &ve) || ve.Field != "as_of" {
		t.Fatalf("future: %v", err)
	}
	if _, err := w.s.ListZonesOn(ctx, "12/10/2026"); !errors.As(err, &ve) || ve.Field != "as_of" {
		t.Fatalf("bad date: %v", err)
	}
}

// The watering interval is the one in effect on the day looked at, not today's.
func TestZonesAsOfUsesThatSeasonsInterval(t *testing.T) {
	w := newActivityWorld(t)
	ctx := t.Context()
	then := fieldDay(t, -40) // always another month than today
	month := mustMonth(t, then)
	if _, _, err := w.s.PutWateringRule(ctx, uuid.New(), store.WateringRuleInput{Name: "Then", FromMonth: month, ToMonth: month, IntervalDays: 2}); err != nil {
		t.Fatal(err)
	}
	if z := zoneOn(t, w, then, w.zoneA); z.CurrentIntervalDays != 2 {
		t.Fatalf("then: %d", z.CurrentIntervalDays)
	}
	if z := zoneOn(t, w, w.today, w.zoneA); z.CurrentIntervalDays != 7 {
		t.Fatalf("today: %d", z.CurrentIntervalDays)
	}
}

func sameDay(a, b *string) bool { return (a == nil && b == nil) || (a != nil && b != nil && *a == *b) }

func deref[T any](p *T) any {
	if p == nil {
		return nil
	}
	return *p
}
