package main

import (
	"strings"
	"testing"
	"time"

	"forest/internal/store"
)

func TestParseArgs(t *testing.T) {
	days, dry, err := parseArgs(nil)
	if err != nil || days != 90 || dry {
		t.Fatalf("defaults: %d %v %v", days, dry, err)
	}
	days, dry, err = parseArgs([]string{"-days=120", "-dry-run"})
	if err != nil || days != 120 || !dry {
		t.Fatalf("flags: %d %v %v", days, dry, err)
	}
	for _, args := range [][]string{{"-days=29"}, {"-days=0"}, {"-days=-5"}, {"-days=x"}, {"extra"}} {
		if _, _, err := parseArgs(args); err == nil {
			t.Errorf("%v: want an error", args)
		}
	}
}

func TestReport(t *testing.T) {
	got := report([]store.PurgedTable{
		{Table: "activity", Purged: 2, Cascaded: map[string]int{"activity_zone": 3, "activity_species": 0}},
		{Table: "species", Purged: 1, Kept: map[string]int{"tree_species_id_fkey": 2}},
	}, 90, time.Date(2026, 8, 26, 0, 0, 0, 0, time.UTC), false)
	for _, want := range []string{
		"before 2026-08-26",
		"activity          2 purged; with them: activity_zone 3\n",
		"species           1 purged, 2 kept (still referenced: tree_species_id_fkey 2)",
		"2 old tombstone(s) kept",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("report misses %q:\n%s", want, got)
		}
	}
}
