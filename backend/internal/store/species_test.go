package store_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"

	"forest/internal/dbtest"
	"forest/internal/store"
)

func ptr[T any](v T) *T { return &v }

func TestPutSpeciesCreatesThenUpdates(t *testing.T) {
	s := store.New(dbtest.Tx(t))
	ctx := t.Context()
	id := uuid.New()

	name := dbtest.Name("Test Quercus")

	sp, created, err := s.PutSpecies(ctx, id, store.SpeciesInput{ScientificName: "  " + name + " ", CommonName: ptr("sobreiro"), Notes: ptr("  ")})
	if err != nil || !created {
		t.Fatalf("create: created=%v err=%v", created, err)
	}
	if sp.ID != id || sp.ScientificName != name || *sp.CommonName != "sobreiro" || sp.Notes != nil {
		t.Fatalf("not normalised: %+v", sp)
	}

	// same id again = update (a retried offline create is harmless)
	sp, created, err = s.PutSpecies(ctx, id, store.SpeciesInput{ScientificName: name, Notes: ptr("cork oak")})
	if err != nil || created {
		t.Fatalf("update: created=%v err=%v", created, err)
	}
	if sp.CommonName != nil || *sp.Notes != "cork oak" {
		t.Fatalf("update not applied: %+v", sp)
	}

	got, err := s.GetSpecies(ctx, id)
	if err != nil || got.ScientificName != name {
		t.Fatalf("get: %+v %v", got, err)
	}
}

func TestPutSpeciesValidation(t *testing.T) {
	s := store.New(dbtest.Tx(t))
	for name, in := range map[string]store.SpeciesInput{
		"blank name":    {ScientificName: "   "},
		"NUL in name":   {ScientificName: "Test nul\x00x"},
		"NUL in notes":  {ScientificName: dbtest.Name("Test"), Notes: ptr("a\x00b")},
		"bad UTF-8":     {ScientificName: "Test \xff"},
		"name too long": {ScientificName: strings.Repeat("a", 201)},
	} {
		_, _, err := s.PutSpecies(t.Context(), uuid.New(), in)
		var ve *store.ValidationError
		if !errors.As(err, &ve) {
			t.Errorf("%s: want a validation error, got %v", name, err)
		}
	}
}

func TestPutSpeciesDuplicateNameIgnoresCase(t *testing.T) {
	s := store.New(dbtest.Tx(t))
	ctx := t.Context()
	name := dbtest.Name("Test dup alba")
	if _, _, err := s.PutSpecies(ctx, uuid.New(), store.SpeciesInput{ScientificName: name}); err != nil {
		t.Fatal(err)
	}
	_, _, err := s.PutSpecies(ctx, uuid.New(), store.SpeciesInput{ScientificName: strings.ToUpper(name)})
	var ce *store.ConflictError
	if !errors.As(err, &ce) || ce.Field != "scientific_name" {
		t.Fatalf("want conflict, got %v", err)
	}
	// the store stays usable after the database refused a statement
	if _, _, err := s.PutSpecies(ctx, uuid.New(), store.SpeciesInput{ScientificName: name + " b"}); err != nil {
		t.Fatalf("after a conflict: %v", err)
	}
}

func TestDeletedSpeciesIsATombstone(t *testing.T) {
	s := store.New(dbtest.Tx(t))
	ctx := t.Context()
	id := uuid.New()
	tomb := dbtest.Name("Test tomb alba")
	if _, _, err := s.PutSpecies(ctx, id, store.SpeciesInput{ScientificName: tomb}); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteSpecies(ctx, id); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteSpecies(ctx, id); err != nil {
		t.Fatalf("second delete must be a no-op, got %v", err)
	}
	if _, err := s.GetSpecies(ctx, id); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("get deleted: %v", err)
	}
	if _, _, err := s.PutSpecies(ctx, id, store.SpeciesInput{ScientificName: tomb}); !errors.Is(err, store.ErrDeleted) {
		t.Fatalf("a late edit must not resurrect it, got %v", err)
	}
	// the name is free again for a new species
	if _, _, err := s.PutSpecies(ctx, uuid.New(), store.SpeciesInput{ScientificName: tomb}); err != nil {
		t.Fatalf("name should be reusable after delete: %v", err)
	}
	list, err := s.ListSpecies(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, sp := range list {
		if sp.ID == id {
			t.Fatal("deleted species listed")
		}
	}
}

func TestDeleteUnknownSpecies(t *testing.T) {
	s := store.New(dbtest.Tx(t))
	if err := s.DeleteSpecies(t.Context(), uuid.New()); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("got %v", err)
	}
}
