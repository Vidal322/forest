package store

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// ExportZone is one zone of an exported activity, by name (never its shape).
type ExportZone struct {
	Plot     string  `json:"plot"`
	Code     string  `json:"code"`
	Label    *string `json:"label"`
	Kind     string  `json:"kind"`
	Quantity *int    `json:"quantity"`
	Unit     *string `json:"unit"`
}

// ExportSpecies is one species of an exported activity, by name.
type ExportSpecies struct {
	ScientificName string  `json:"scientific_name"`
	CommonName     *string `json:"common_name"`
	Quantity       *int    `json:"quantity"`
	Unit           *string `json:"unit"`
}

// ExportActivity is one activity as the CSV export shows it: names instead of ids.
type ExportActivity struct {
	PerformedOn string
	Type        string
	Notes       *string
	Zones       []ExportZone    // by plot name, then zone label
	Species     []ExportSpecies // by scientific name
}

// ExportActivities returns every live activity of the field, oldest first, with
// the names of its zones, plots and species. Zones and species deleted since
// keep their names here: the log is history. It also returns the field's today,
// for the file name.
func (s *Store) ExportActivities(ctx context.Context) (list []ExportActivity, today string, err error) {
	if err := s.db.QueryRow(ctx, `SELECT to_char(field_today(), 'YYYY-MM-DD')`).Scan(&today); err != nil {
		return nil, "", err
	}
	rows, err := s.db.Query(ctx, `
		SELECT to_char(a.performed_on, 'YYYY-MM-DD'), a.type::text, a.notes,
		       COALESCE((SELECT json_agg(json_build_object('plot', p.name, 'code', 'Z' || z.number, 'label', z.label, 'kind', z.kind,
		                                                   'quantity', az.quantity, 'unit', az.unit)
		                                 ORDER BY lower(p.name), p.id, lower(z.label) NULLS LAST, z.id)
		                   FROM activity_zone az
		                   JOIN zone z ON z.id = az.zone_id
		                   JOIN plot p ON p.id = z.plot_id
		                  WHERE az.activity_id = a.id), '[]'),
		       COALESCE((SELECT json_agg(json_build_object('scientific_name', sp.scientific_name, 'common_name', sp.common_name,
		                                                   'quantity', asp.quantity, 'unit', asp.unit)
		                                 ORDER BY lower(sp.scientific_name), sp.id)
		                   FROM activity_species asp
		                   JOIN species sp ON sp.id = asp.species_id
		                  WHERE asp.activity_id = a.id), '[]')
		  FROM activity a
		  JOIN field f ON f.id = a.field_id AND f.deleted_at IS NULL
		 WHERE a.deleted_at IS NULL
		 ORDER BY a.performed_on, a.created_at, a.id`)
	if err != nil {
		return nil, "", err
	}
	list, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (ExportActivity, error) {
		var a ExportActivity
		err := r.Scan(&a.PerformedOn, &a.Type, &a.Notes,
			geomJSON[[]ExportZone]{&a.Zones}, geomJSON[[]ExportSpecies]{&a.Species})
		return a, err
	})
	return list, today, err
}
