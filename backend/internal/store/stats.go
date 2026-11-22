package store

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// PlotStats are the numbers the stats screen shows for one plot.
type PlotStats struct {
	PlotID         uuid.UUID `json:"plot_id"`
	Name           string    `json:"name"`
	AreaHa         *float64  `json:"area_ha"` // nil until the scale is set
	DeclaredAreaHa *float64  `json:"declared_area_ha"`
	ZoneCount      int       `json:"zone_count"`      // all live zones, paths included
	TreeCount      int       `json:"tree_count"`      // individual trees recorded, alive
	DeadTreeCount  int       `json:"dead_tree_count"` // individual trees recorded, dead
	SpeciesCount   int       `json:"species_count"`
	LastWateredOn  *string   `json:"last_watered_on"`
	OpenTaskCount  int       `json:"open_task_count"`
	// totals from the activity log (quantities entered when logging)
	HolesSown        int `json:"holes_sown"`
	TreesPlanted     int `json:"trees_planted"`
	LitresWatered    int `json:"litres_watered"`
	WateringsLast30d int `json:"waterings_last_30d"`
	ZonesNeedWater   int `json:"zones_need_water"`
}

// ListPlotStats returns stats for every live plot (from the plot_stats view plus log totals).
func (s *Store) ListPlotStats(ctx context.Context) ([]PlotStats, error) {
	rows, err := s.db.Query(ctx, `
		WITH log AS (
			SELECT z.plot_id,
			       COALESCE(sum(az.quantity) FILTER (WHERE a.type = 'sowing' AND az.unit = 'holes'), 0)    AS holes_sown,
			       COALESCE(sum(az.quantity) FILTER (WHERE a.type = 'planting' AND az.unit = 'trees'), 0)  AS trees_planted,
			       COALESCE(sum(az.quantity) FILTER (WHERE a.type = 'watering' AND az.unit = 'litres'), 0) AS litres_watered,
			       count(DISTINCT a.id) FILTER (WHERE a.type = 'watering' AND a.performed_on > field_today() - 30) AS waterings_30d,
			       max(a.performed_on) FILTER (WHERE a.type = 'watering') AS last_watered_on
			  FROM activity_zone az
			  JOIN activity a ON a.id = az.activity_id AND a.deleted_at IS NULL
			  JOIN zone z     ON z.id = az.zone_id AND z.deleted_at IS NULL
			 GROUP BY z.plot_id
		), zs AS (
			SELECT plot_id, count(*) AS zones, count(*) FILTER (WHERE needs_water) AS dry
			  FROM zone_status GROUP BY plot_id
		)
		SELECT ps.plot_id, ps.name, ps.area_ha::float8, ps.declared_area_ha::float8,
		       COALESCE(zs.zones, 0), ps.tree_count, ps.dead_tree_count, ps.species_count,
		       to_char(log.last_watered_on, 'YYYY-MM-DD'), ps.open_task_count,
		       COALESCE(log.holes_sown, 0), COALESCE(log.trees_planted, 0), COALESCE(log.litres_watered, 0),
		       COALESCE(log.waterings_30d, 0), COALESCE(zs.dry, 0)
		  FROM plot_stats ps
		  LEFT JOIN log ON log.plot_id = ps.plot_id
		  LEFT JOIN zs  ON zs.plot_id = ps.plot_id
		 ORDER BY lower(ps.name), ps.plot_id`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (PlotStats, error) {
		var p PlotStats
		var zones, trees, dead, species, tasks, holes, planted, litres, waterings, dry int64
		err := r.Scan(&p.PlotID, &p.Name, &p.AreaHa, &p.DeclaredAreaHa, &zones, &trees, &dead, &species,
			&p.LastWateredOn, &tasks, &holes, &planted, &litres, &waterings, &dry)
		p.ZoneCount, p.TreeCount, p.DeadTreeCount, p.SpeciesCount = int(zones), int(trees), int(dead), int(species)
		p.OpenTaskCount, p.HolesSown, p.TreesPlanted, p.LitresWatered = int(tasks), int(holes), int(planted), int(litres)
		p.WateringsLast30d, p.ZonesNeedWater = int(waterings), int(dry)
		return p, err
	})
}
