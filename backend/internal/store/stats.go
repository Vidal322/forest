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
	// watering coverage: live cultivation zones, and how many of them were watered in the last 7 days (today included)
	CultivationZones int `json:"cultivation_zones"`
	ZonesWatered7d   int `json:"zones_watered_7d"`
	// activities logged on the plot's zones per 7-day week, last 8 weeks, oldest first (the last one ends today)
	ActivitiesPerWeek []int `json:"activities_per_week"`
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
		), cov AS (
			SELECT z.plot_id, count(*) AS cultivation,
			       count(*) FILTER (WHERE EXISTS (
			           SELECT 1 FROM activity_zone az
			             JOIN activity a ON a.id = az.activity_id AND a.deleted_at IS NULL
			            WHERE az.zone_id = z.id AND a.type = 'watering'
			              AND a.performed_on > field_today() - 7 AND a.performed_on <= field_today())) AS watered
			  FROM zone z
			 WHERE z.deleted_at IS NULL AND z.kind = 'cultivation'
			 GROUP BY z.plot_id
		), recent AS (
			-- week 7 = the last 7 days, week 0 = 50 to 56 days ago
			SELECT DISTINCT z.plot_id, a.id, 7 - (field_today() - a.performed_on) / 7 AS week
			  FROM activity_zone az
			  JOIN activity a ON a.id = az.activity_id AND a.deleted_at IS NULL
			  JOIN zone z     ON z.id = az.zone_id AND z.deleted_at IS NULL
			 WHERE a.performed_on > field_today() - 56 AND a.performed_on <= field_today()
		), weekly AS (
			SELECT ps.plot_id,
			       array_agg((SELECT count(*) FROM recent r WHERE r.plot_id = ps.plot_id AND r.week = w.i) ORDER BY w.i) AS weeks
			  FROM plot_stats ps CROSS JOIN generate_series(0, 7) AS w(i)
			 GROUP BY ps.plot_id
		)
		SELECT ps.plot_id, ps.name, ps.area_ha::float8, ps.declared_area_ha::float8,
		       COALESCE(zs.zones, 0), ps.tree_count, ps.dead_tree_count, ps.species_count,
		       to_char(log.last_watered_on, 'YYYY-MM-DD'), ps.open_task_count,
		       COALESCE(log.holes_sown, 0), COALESCE(log.trees_planted, 0), COALESCE(log.litres_watered, 0),
		       COALESCE(log.waterings_30d, 0), COALESCE(zs.dry, 0),
		       COALESCE(cov.cultivation, 0), COALESCE(cov.watered, 0), weekly.weeks
		  FROM plot_stats ps
		  LEFT JOIN log    ON log.plot_id = ps.plot_id
		  LEFT JOIN zs     ON zs.plot_id = ps.plot_id
		  LEFT JOIN cov    ON cov.plot_id = ps.plot_id
		  JOIN weekly      ON weekly.plot_id = ps.plot_id
		 ORDER BY lower(ps.name), ps.plot_id`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (PlotStats, error) {
		var p PlotStats
		var zones, trees, dead, species, tasks, holes, planted, litres, waterings, dry, cultivation, watered int64
		var weeks []int64
		err := r.Scan(&p.PlotID, &p.Name, &p.AreaHa, &p.DeclaredAreaHa, &zones, &trees, &dead, &species,
			&p.LastWateredOn, &tasks, &holes, &planted, &litres, &waterings, &dry, &cultivation, &watered, &weeks)
		p.ZoneCount, p.TreeCount, p.DeadTreeCount, p.SpeciesCount = int(zones), int(trees), int(dead), int(species)
		p.OpenTaskCount, p.HolesSown, p.TreesPlanted, p.LitresWatered = int(tasks), int(holes), int(planted), int(litres)
		p.WateringsLast30d, p.ZonesNeedWater = int(waterings), int(dry)
		p.CultivationZones, p.ZonesWatered7d = int(cultivation), int(watered)
		p.ActivitiesPerWeek = make([]int, len(weeks))
		for i, n := range weeks {
			p.ActivitiesPerWeek[i] = int(n)
		}
		return p, err
	})
}

// SpeciesStats say where a species is used: in how many zones, how many of its
// trees are alive, and when it was last sown and planted.
type SpeciesStats struct {
	SpeciesID      uuid.UUID `json:"species_id"`
	ZoneCount      int       `json:"zone_count"`       // live zones with its living trees or a sowing/planting of it
	AliveTreeCount int       `json:"alive_tree_count"` // trees recorded alive, in live plots
	LastSownOn     *string   `json:"last_sown_on"`
	LastPlantedOn  *string   `json:"last_planted_on"`
}

// ListSpeciesStats returns usage stats for every live species (alphabetical, like the catalogue).
// Deleted activities, zones and plots don't count.
func (s *Store) ListSpeciesStats(ctx context.Context) ([]SpeciesStats, error) {
	rows, err := s.db.Query(ctx, `
		WITH live_zone AS (
			SELECT z.* FROM zone z JOIN plot p ON p.id = z.plot_id AND p.deleted_at IS NULL WHERE z.deleted_at IS NULL
		), logged AS (
			-- sowings and plantings of the species, with the live zones they were done in
			SELECT asp.species_id, a.type, a.performed_on, z.id AS zone_id
			  FROM activity_species asp
			  JOIN activity a       ON a.id = asp.activity_id AND a.deleted_at IS NULL AND a.type IN ('sowing', 'planting')
			  JOIN activity_zone az ON az.activity_id = a.id
			  JOIN live_zone z      ON z.id = az.zone_id
		), tree_zone AS (
			-- zones holding its living trees (counted on the zone, or inside it by position)
			SELECT t.species_id, z.id AS zone_id
			  FROM tree t
			  JOIN live_zone z ON t.zone_id = z.id
			              OR (t.zone_id IS NULL AND t.position IS NOT NULL AND z.plot_id = t.plot_id AND ST_Contains(z.geom, t.position))
			 WHERE t.deleted_at IS NULL AND t.status = 'alive'
		), alive AS (
			SELECT t.species_id, count(*) AS n
			  FROM tree t JOIN plot p ON p.id = t.plot_id AND p.deleted_at IS NULL
			 WHERE t.deleted_at IS NULL AND t.status = 'alive'
			 GROUP BY t.species_id
		)
		SELECT sp.id,
		       (SELECT count(*) FROM (SELECT zone_id FROM logged WHERE species_id = sp.id
		                              UNION SELECT zone_id FROM tree_zone WHERE species_id = sp.id) u),
		       COALESCE(alive.n, 0),
		       (SELECT to_char(max(performed_on), 'YYYY-MM-DD') FROM logged WHERE species_id = sp.id AND type = 'sowing'),
		       (SELECT to_char(max(performed_on), 'YYYY-MM-DD') FROM logged WHERE species_id = sp.id AND type = 'planting')
		  FROM species sp
		  LEFT JOIN alive ON alive.species_id = sp.id
		 WHERE sp.deleted_at IS NULL
		 ORDER BY lower(sp.scientific_name), sp.id`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (SpeciesStats, error) {
		var st SpeciesStats
		var zones, alive int64
		err := r.Scan(&st.SpeciesID, &zones, &alive, &st.LastSownOn, &st.LastPlantedOn)
		st.ZoneCount, st.AliveTreeCount = int(zones), int(alive)
		return st, err
	})
}
