package store

import (
	"context"
	"errors"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// ErrNoField: plots and zones need the field (and its frame) to exist first.
var ErrNoField = errors.New("field not set up")

// Plot is a named area of the field (the green outlines on the old map).
type Plot struct {
	ID             uuid.UUID `json:"id"`
	Name           string    `json:"name"`
	Geom           Polygon   `json:"geom"`
	DeclaredAreaHa *float64  `json:"declared_area_ha"` // the hectares written on the old map
	Notes          *string   `json:"notes"`
	AreaHa         *float64  `json:"area_ha"` // measured from the outline; nil until the scale is set
	UpdatedAt      time.Time `json:"updated_at"`
}

// PlotInput is what a client sets on a plot.
type PlotInput struct {
	Name           string   `json:"name"`
	Geom           Polygon  `json:"geom"`
	DeclaredAreaHa *float64 `json:"declared_area_ha"`
	Notes          *string  `json:"notes"`
}

func (in PlotInput) normalize() (PlotInput, error) {
	var err error
	if in.Name, err = requiredText("name", in.Name, 100); err != nil {
		return in, err
	}
	if err = in.Geom.normalize("geom"); err != nil {
		return in, err
	}
	if a := in.DeclaredAreaHa; a != nil && (math.IsNaN(*a) || *a <= 0 || *a >= 100_000) {
		return in, invalid("declared_area_ha", "tem de ser um número de hectares acima de 0")
	}
	if in.Notes, err = optionalText("notes", in.Notes, 2000); err != nil {
		return in, err
	}
	return in, nil
}

const plotSelect = `
	SELECT p.id, p.name, ST_AsGeoJSON(p.geom), p.declared_area_ha::float8, p.notes,
	       (ST_Area(p.geom) * f.metres_per_unit ^ 2 / 10000)::float8, p.updated_at
	  FROM plot p
	  JOIN field f ON f.id = p.field_id AND f.deleted_at IS NULL
	 WHERE p.deleted_at IS NULL`

func scanPlot(row pgx.Row) (Plot, error) {
	var p Plot
	err := row.Scan(&p.ID, &p.Name, geomJSON[Polygon]{&p.Geom}, &p.DeclaredAreaHa, &p.Notes, &p.AreaHa, &p.UpdatedAt)
	return p, err
}

// ListPlots returns the live plots of the field, by name.
func (s *Store) ListPlots(ctx context.Context) ([]Plot, error) {
	rows, err := s.db.Query(ctx, plotSelect+` ORDER BY lower(p.name), p.id`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Plot, error) { return scanPlot(r) })
}

// GetPlot returns one live plot.
func (s *Store) GetPlot(ctx context.Context, id uuid.UUID) (Plot, error) {
	p, err := scanPlot(s.db.QueryRow(ctx, plotSelect+` AND p.id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return p, ErrNotFound
	}
	return p, err
}

// checkGeom asks PostGIS whether the outline is valid, in words a person can act on.
func (s *Store) checkGeom(ctx context.Context, field string, g *Polygon) error {
	var reason string
	if err := s.db.QueryRow(ctx, `SELECT ST_IsValidReason(ST_SetSRID(ST_GeomFromGeoJSON($1), 0))`, g.json()).Scan(&reason); err != nil {
		return err
	}
	if reason != "Valid Geometry" {
		return invalid(field, "cruza-se a si próprio: move os cantos para que as linhas não se cruzem")
	}
	return nil
}

func (s *Store) fieldID(ctx context.Context) (uuid.UUID, error) {
	var id uuid.UUID
	err := s.db.QueryRow(ctx, `SELECT id FROM field WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return id, ErrNoField
	}
	return id, err
}

// PutPlot creates or replaces the plot with this client-chosen id.
func (s *Store) PutPlot(ctx context.Context, id uuid.UUID, in PlotInput) (p Plot, created bool, err error) {
	if in, err = in.normalize(); err != nil {
		return p, false, err
	}
	err = s.inTx(ctx, func(tx *Store) error {
		fieldID, err := tx.fieldID(ctx)
		if err != nil {
			return err
		}
		if err := tx.checkGeom(ctx, "geom", &in.Geom); err != nil {
			return err
		}
		// Reshaping must keep every zone inside (lock the plot first, like PutZone does).
		var outside *string
		err = tx.db.QueryRow(ctx, `
			WITH p AS (SELECT id FROM plot WHERE id = $1 AND deleted_at IS NULL FOR UPDATE)
			SELECT COALESCE(z.label, 'uma zona') FROM zone z JOIN p ON p.id = z.plot_id
			 WHERE z.deleted_at IS NULL
			   AND NOT ST_Within(z.geom, ST_Buffer(ST_SetSRID(ST_GeomFromGeoJSON($2), 0), 1))
			 LIMIT 1`, id, in.Geom.json()).Scan(&outside)
		if err == nil && outside != nil {
			return invalid("geom", "deixaria %s fora da parcela: inclui todas as zonas dela", quoteLabel(*outside))
		}
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		var gotID uuid.UUID
		err = tx.db.QueryRow(ctx, `
			INSERT INTO plot (id, field_id, name, geom, declared_area_ha, notes)
			VALUES ($1, $2, $3, ST_SetSRID(ST_Force2D(ST_GeomFromGeoJSON($4)), 0), $5, $6)
			ON CONFLICT (id) DO UPDATE
			   SET name = EXCLUDED.name, geom = EXCLUDED.geom,
			       declared_area_ha = EXCLUDED.declared_area_ha, notes = EXCLUDED.notes
			 WHERE plot.deleted_at IS NULL
			RETURNING id, (xmax = 0)`,
			id, fieldID, in.Name, in.Geom.json(), in.DeclaredAreaHa, in.Notes).Scan(&gotID, &created)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			return ErrDeleted
		case isUniqueViolation(err, "plot_name_unique"):
			return &ConflictError{Field: "name", Message: "já existe outra parcela com este nome"}
		case err != nil:
			return err
		}
		p, err = tx.GetPlot(ctx, id)
		return err
	})
	return p, created, err
}

// DeletePlot soft-deletes a plot together with its zones and tasks (history stays).
// The plot row is locked first — the same order PutZone uses — so a zone saved
// at the same moment either lands before (and is deleted too) or is refused.
func (s *Store) DeletePlot(ctx context.Context, id uuid.UUID) error {
	return s.inTx(ctx, func(tx *Store) error {
		var deletedAt *time.Time
		err := tx.db.QueryRow(ctx, `SELECT deleted_at FROM plot WHERE id = $1 FOR UPDATE`, id).Scan(&deletedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil || deletedAt != nil {
			return err // already deleted: nothing to do
		}
		if _, err := tx.db.Exec(ctx, `UPDATE plot SET deleted_at = now() WHERE id = $1`, id); err != nil {
			return err
		}
		// lock order plot → zone → task, as PutZone/PutTask take them
		if _, err := tx.db.Exec(ctx, `UPDATE zone SET deleted_at = now() WHERE plot_id = $1 AND deleted_at IS NULL`, id); err != nil {
			return err
		}
		// a new statement sees tasks committed while we waited for the zones
		if _, err := tx.db.Exec(ctx, `UPDATE task SET deleted_at = now() WHERE deleted_at IS NULL
			AND (plot_id = $1 OR zone_id IN (SELECT id FROM zone WHERE plot_id = $1))`, id); err != nil {
			return err
		}
		_, err = tx.db.Exec(ctx, `UPDATE tree SET deleted_at = now() WHERE deleted_at IS NULL AND plot_id = $1`, id)
		return err
	})
}

func quoteLabel(l string) string {
	if l == "uma zona" {
		return l
	}
	return "“" + l + "”"
}
