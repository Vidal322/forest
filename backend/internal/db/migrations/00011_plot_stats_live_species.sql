-- +goose Up
-- species_count: a deleted species no longer counts, also through its trees
-- (the activity branch already ignored deleted species).
CREATE OR REPLACE VIEW plot_stats AS
SELECT p.id AS plot_id, p.field_id, p.name,
       ST_Area(p.geom) * f.metres_per_unit ^ 2 / 10000 AS area_ha,   -- NULL until calibrated
       p.declared_area_ha,
       (SELECT count(*) FROM tree t WHERE t.plot_id = p.id AND t.deleted_at IS NULL AND t.status = 'alive') AS tree_count,
       (SELECT count(*) FROM tree t WHERE t.plot_id = p.id AND t.deleted_at IS NULL AND t.status = 'dead')  AS dead_tree_count,
       (SELECT count(DISTINCT s.species_id) FROM (
            SELECT t.species_id FROM tree t
              JOIN species sp ON sp.id = t.species_id AND sp.deleted_at IS NULL
             WHERE t.plot_id = p.id AND t.deleted_at IS NULL AND t.status = 'alive'
            UNION
            SELECT asp.species_id
              FROM activity_species asp
              JOIN species sp       ON sp.id = asp.species_id AND sp.deleted_at IS NULL
              JOIN activity a       ON a.id = asp.activity_id AND a.deleted_at IS NULL
                                   AND a.type IN ('sowing', 'planting')
              JOIN activity_zone az ON az.activity_id = a.id
              JOIN zone z           ON z.id = az.zone_id AND z.plot_id = p.id AND z.deleted_at IS NULL
        ) s) AS species_count,
       (SELECT max(a.performed_on)
          FROM activity a
          JOIN activity_zone az ON az.activity_id = a.id
          JOIN zone z           ON z.id = az.zone_id AND z.plot_id = p.id AND z.deleted_at IS NULL
         WHERE a.type = 'watering' AND a.deleted_at IS NULL) AS last_watered_on,
       (SELECT count(*) FROM task t
          LEFT JOIN zone z ON z.id = t.zone_id AND z.deleted_at IS NULL
         WHERE (t.plot_id = p.id OR z.plot_id = p.id)
           AND t.deleted_at IS NULL AND t.status IN ('open', 'in_progress')) AS open_task_count
  FROM plot p
  JOIN field f ON f.id = p.field_id AND f.deleted_at IS NULL
 WHERE p.deleted_at IS NULL;

-- +goose Down
CREATE OR REPLACE VIEW plot_stats AS
SELECT p.id AS plot_id, p.field_id, p.name,
       ST_Area(p.geom) * f.metres_per_unit ^ 2 / 10000 AS area_ha,   -- NULL until calibrated
       p.declared_area_ha,
       (SELECT count(*) FROM tree t WHERE t.plot_id = p.id AND t.deleted_at IS NULL AND t.status = 'alive') AS tree_count,
       (SELECT count(*) FROM tree t WHERE t.plot_id = p.id AND t.deleted_at IS NULL AND t.status = 'dead')  AS dead_tree_count,
       (SELECT count(DISTINCT s.species_id) FROM (
            SELECT t.species_id FROM tree t
             WHERE t.plot_id = p.id AND t.deleted_at IS NULL AND t.status = 'alive'
            UNION
            SELECT asp.species_id
              FROM activity_species asp
              JOIN species sp       ON sp.id = asp.species_id AND sp.deleted_at IS NULL
              JOIN activity a       ON a.id = asp.activity_id AND a.deleted_at IS NULL
                                   AND a.type IN ('sowing', 'planting')
              JOIN activity_zone az ON az.activity_id = a.id
              JOIN zone z           ON z.id = az.zone_id AND z.plot_id = p.id AND z.deleted_at IS NULL
        ) s) AS species_count,
       (SELECT max(a.performed_on)
          FROM activity a
          JOIN activity_zone az ON az.activity_id = a.id
          JOIN zone z           ON z.id = az.zone_id AND z.plot_id = p.id AND z.deleted_at IS NULL
         WHERE a.type = 'watering' AND a.deleted_at IS NULL) AS last_watered_on,
       (SELECT count(*) FROM task t
          LEFT JOIN zone z ON z.id = t.zone_id AND z.deleted_at IS NULL
         WHERE (t.plot_id = p.id OR z.plot_id = p.id)
           AND t.deleted_at IS NULL AND t.status IN ('open', 'in_progress')) AS open_task_count
  FROM plot p
  JOIN field f ON f.id = p.field_id AND f.deleted_at IS NULL
 WHERE p.deleted_at IS NULL;
