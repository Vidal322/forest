package store_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"

	"forest/internal/store"
)

func TestTaskLifecycle(t *testing.T) {
	w := newActivityWorld(t)
	ctx := t.Context()
	id := uuid.New()
	in := store.TaskInput{ZoneID: &w.zoneA, Title: " Falta semear ", Kind: "sow", DueOn: ptr(w.today)}
	task, created, err := w.s.PutTask(ctx, id, in)
	if err != nil || !created || task.Title != "Falta semear" || task.Status != "open" || task.CompletedAt != nil || task.Version != 1 {
		t.Fatalf("create: %+v %v %v", task, created, err)
	}
	z, _ := w.s.GetZone(ctx, w.zoneA)
	if z.OpenTaskCount != 1 {
		t.Fatalf("open task count: %d", z.OpenTaskCount)
	}

	// retry = no-op
	if task, created, err = w.s.PutTask(ctx, id, in); err != nil || created || task.Version != 1 {
		t.Fatalf("retry: %+v %v", task, err)
	}
	// close it, from version 1
	done := in
	done.Title = "Falta semear"
	done.Status = "done"
	done.BaseVersion = ptr(1)
	if task, _, err = w.s.PutTask(ctx, id, done); err != nil || task.CompletedAt == nil || task.Version != 2 {
		t.Fatalf("close: %+v %v", task, err)
	}
	// stale edit
	stale := done
	stale.Status = "open"
	_, _, err = w.s.PutTask(ctx, id, stale)
	var tc *store.TaskConflictError
	if !errors.As(err, &tc) || tc.Current.Status != "done" {
		t.Fatalf("stale: %v", err)
	}
	// reopen from the current version clears completed_at
	stale.BaseVersion = ptr(2)
	if task, _, err = w.s.PutTask(ctx, id, stale); err != nil || task.CompletedAt != nil {
		t.Fatalf("reopen: %+v %v", task, err)
	}

	open, _ := w.s.ListTasks(ctx, store.TaskFilter{OpenOnly: true, ZoneID: &w.zoneA})
	if len(open) != 1 {
		t.Fatalf("list: %d", len(open))
	}

	// deleting the zone takes its tasks along
	if err := w.s.DeleteZone(ctx, w.zoneA); err != nil {
		t.Fatal(err)
	}
	if all, _ := w.s.ListTasks(ctx, store.TaskFilter{}); len(all) != 0 {
		t.Fatalf("tasks of a deleted zone still listed: %+v", all)
	}
	stale.BaseVersion = ptr(3)
	if _, _, err := w.s.PutTask(ctx, id, stale); !errors.Is(err, store.ErrDeleted) {
		t.Fatalf("edit of a cascaded task: %v", err)
	}
}

func TestTaskValidation(t *testing.T) {
	w := newActivityWorld(t)
	for name, in := range map[string]store.TaskInput{
		"no target":    {Title: "x"},
		"both targets": {Title: "x", ZoneID: &w.zoneA, PlotID: &w.zoneB},
		"no title":     {ZoneID: &w.zoneA, Title: " "},
		"bad kind":     {ZoneID: &w.zoneA, Title: "x", Kind: "dance"},
		"bad status":   {ZoneID: &w.zoneA, Title: "x", Status: "maybe"},
		"bad date":     {ZoneID: &w.zoneA, Title: "x", DueOn: ptr("soon")},
		"unknown zone": {ZoneID: ptr(uuid.New()), Title: "x"},
	} {
		var ve *store.ValidationError
		if _, _, err := w.s.PutTask(t.Context(), uuid.New(), in); !errors.As(err, &ve) {
			t.Errorf("%s: want validation error, got %v", name, err)
		}
	}
}

func TestTaskOrder(t *testing.T) {
	w := newActivityWorld(t)
	ctx := t.Context()
	put := func(title, status string, due *string) {
		t.Helper()
		if _, _, err := w.s.PutTask(ctx, uuid.New(), store.TaskInput{ZoneID: &w.zoneA, Title: title, Status: status, DueOn: due}); err != nil {
			t.Fatal(err)
		}
	}
	put("later", "open", ptr("2030-01-02"))
	put("undated", "open", nil)
	put("soon", "open", ptr("2030-01-01"))
	put("closed first", "done", ptr("2020-01-01"))
	put("closed last", "done", ptr("2010-01-01")) // closed after the other one
	list, err := w.s.ListTasks(ctx, store.TaskFilter{ZoneID: &w.zoneA})
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, x := range list {
		got = append(got, x.Title)
	}
	want := []string{"soon", "later", "undated", "closed last", "closed first"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("order: %v, want %v", got, want)
	}
}
