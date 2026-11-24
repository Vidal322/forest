// Command purge hard-deletes tombstones (soft-deleted rows) older than N days.
// Usage: make purge days=90 [dry=1]
package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"maps"
	"os"
	"slices"
	"strings"
	"time"

	"forest/internal/config"
	"forest/internal/db"
	"forest/internal/store"
)

// minDays guards the offline sync: a phone may still hold a queued edit of a
// deleted entry. Its tombstone answers 410; once purged, that edit would
// create the entry again. No phone stays offline anywhere near this long.
const minDays = 30

func main() {
	if err := run(os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "purge:", err)
		os.Exit(1)
	}
}

func run(args []string, out io.Writer) error {
	days, dryRun, err := parseArgs(args)
	if err != nil {
		return err
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx := context.Background()
	pool, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	cutoff := time.Now().AddDate(0, 0, -days)
	res, err := store.New(pool).PurgeTombstones(ctx, cutoff, dryRun)
	if err != nil {
		return err
	}
	_, err = io.WriteString(out, report(res, days, cutoff, dryRun))
	return err
}

func parseArgs(args []string) (days int, dryRun bool, err error) {
	fs := flag.NewFlagSet("purge", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	fs.IntVar(&days, "days", 90, "purge rows deleted more than this many days ago")
	fs.BoolVar(&dryRun, "dry-run", false, "report what would be purged, change nothing")
	if err := fs.Parse(args); err != nil {
		return 0, false, err
	}
	if fs.NArg() > 0 {
		return 0, false, fmt.Errorf("unexpected argument %q", fs.Arg(0))
	}
	if days < minDays {
		return 0, false, fmt.Errorf("days must be at least %d: a phone could still be syncing an edit of something deleted more recently", minDays)
	}
	return days, dryRun, nil
}

func report(res []store.PurgedTable, days int, cutoff time.Time, dryRun bool) string {
	var w strings.Builder
	verb := "Purged"
	if dryRun {
		verb = "Dry run (nothing changed), would purge"
	}
	fmt.Fprintf(&w, "%s tombstones deleted more than %d days ago (before %s):\n", verb, days, cutoff.Format(time.DateOnly))
	kept := 0
	for _, r := range res {
		line := fmt.Sprintf("  %-14s %4d purged", r.Table, r.Purged)
		if n := r.KeptTotal(); n > 0 {
			kept += n
			line += fmt.Sprintf(", %d kept (still referenced: %s)", n, counts(r.Kept))
		}
		if c := nonZero(r.Cascaded); len(c) > 0 {
			line += fmt.Sprintf("; with them: %s", counts(c))
		}
		fmt.Fprintln(&w, line)
	}
	if kept > 0 {
		fmt.Fprintf(&w, "%d old tombstone(s) kept because live rows still point at them; they go once those rows do.\n", kept)
	}
	return w.String()
}

func nonZero(m map[string]int) map[string]int {
	out := map[string]int{}
	for k, n := range m {
		if n > 0 {
			out[k] = n
		}
	}
	return out
}

// counts formats {"a": 2, "b": 1} as "a 2, b 1" (sorted by key).
func counts(m map[string]int) string {
	parts := make([]string, 0, len(m))
	for _, k := range slices.Sorted(maps.Keys(m)) {
		parts = append(parts, fmt.Sprintf("%s %d", k, m[k]))
	}
	return strings.Join(parts, ", ")
}
