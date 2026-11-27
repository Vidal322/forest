package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Species is one entry of the species catalogue.
type Species struct {
	ID             uuid.UUID `json:"id"`
	ScientificName string    `json:"scientific_name"`
	CommonName     *string   `json:"common_name"`
	Notes          *string   `json:"notes"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// SpeciesInput is what a client may set on a species.
type SpeciesInput struct {
	ScientificName string  `json:"scientific_name"`
	CommonName     *string `json:"common_name"`
	Notes          *string `json:"notes"`
}

func (in SpeciesInput) normalize() (SpeciesInput, error) {
	var err error
	if in.ScientificName, err = requiredText("scientific_name", in.ScientificName, 200); err != nil {
		return in, err
	}
	if in.CommonName, err = optionalText("common_name", in.CommonName, 200); err != nil {
		return in, err
	}
	if in.Notes, err = optionalText("notes", in.Notes, 2000); err != nil {
		return in, err
	}
	return in, nil
}

const speciesCols = `id, scientific_name, common_name, notes, updated_at`

func scanSpecies(row pgx.Row) (Species, error) {
	var sp Species
	err := row.Scan(&sp.ID, &sp.ScientificName, &sp.CommonName, &sp.Notes, &sp.UpdatedAt)
	return sp, err
}

// ListSpecies returns every live species, alphabetically by scientific name.
func (s *Store) ListSpecies(ctx context.Context) ([]Species, error) {
	rows, err := s.db.Query(ctx, `SELECT `+speciesCols+` FROM species WHERE deleted_at IS NULL
		ORDER BY lower(scientific_name), id`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Species, error) { return scanSpecies(r) })
}

// GetSpecies returns one live species.
func (s *Store) GetSpecies(ctx context.Context, id uuid.UUID) (Species, error) {
	sp, err := scanSpecies(s.db.QueryRow(ctx, `SELECT `+speciesCols+` FROM species WHERE id = $1 AND deleted_at IS NULL`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return sp, ErrNotFound
	}
	return sp, err
}

// PutSpecies creates the species with this client-chosen id, or replaces it if it
// exists (upsert by id, so a retried offline create is harmless). created tells which.
func (s *Store) PutSpecies(ctx context.Context, id uuid.UUID, in SpeciesInput) (sp Species, created bool, err error) {
	if in, err = in.normalize(); err != nil {
		return sp, false, err
	}
	row := s.db.QueryRow(ctx, `
		INSERT INTO species (id, scientific_name, common_name, notes) VALUES ($1, $2, $3, $4)
		ON CONFLICT (id) DO UPDATE
		   SET scientific_name = EXCLUDED.scientific_name,
		       common_name     = EXCLUDED.common_name,
		       notes           = EXCLUDED.notes
		 WHERE species.deleted_at IS NULL
		RETURNING `+speciesCols+`, (xmax = 0) AS created`,
		id, in.ScientificName, in.CommonName, in.Notes)
	err = row.Scan(&sp.ID, &sp.ScientificName, &sp.CommonName, &sp.Notes, &sp.UpdatedAt, &created)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return sp, false, ErrDeleted // the id exists but is a tombstone
	case isUniqueViolation(err, "species_name_unique"):
		return sp, false, &ConflictError{Field: "scientific_name", Message: "já existe uma espécie com este nome"}
	}
	return sp, created, err
}

// DeleteSpecies soft-deletes a species. Its history (trees, sowings) is kept.
// Deleting an already deleted species is a no-op, so retries are safe.
func (s *Store) DeleteSpecies(ctx context.Context, id uuid.UUID) error {
	var deleted bool
	err := s.db.QueryRow(ctx, `
		WITH upd AS (UPDATE species SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id)
		SELECT EXISTS (SELECT 1 FROM upd) OR EXISTS (SELECT 1 FROM species WHERE id = $1)`, id).Scan(&deleted)
	if err != nil {
		return err
	}
	if !deleted {
		return ErrNotFound
	}
	return nil
}
