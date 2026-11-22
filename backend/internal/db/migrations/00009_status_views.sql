-- +goose Up
-- Watering interval in effect on a given day: the matching seasonal rule, else
-- the field default. Ties: narrowest month range, then oldest rule, then id —
-- fully deterministic, and the PWA uses the same order offline.
-- +goose StatementBegin
CREATE FUNCTION water_interval_days(p_field uuid, p_day date) RETURNS integer
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
        (SELECT r.interval_days
           FROM watering_rule r
          WHERE r.field_id = p_field
            AND r.deleted_at IS NULL
            AND CASE WHEN r.from_month <= r.to_month
                     THEN extract(month FROM p_day) BETWEEN r.from_month AND r.to_month
                     ELSE extract(month FROM p_day) >= r.from_month OR extract(month FROM p_day) <= r.to_month
                END
          ORDER BY (r.to_month - r.from_month + 12) % 12, r.created_at, r.id
          LIMIT 1),
        (SELECT f.default_water_interval_days FROM field f WHERE f.id = p_field)
    )
$$;
-- +goose StatementEnd

-- Zone state is derived from the activity log, never stored.
-- Everything soft-deleted (field, plot, zone, activity, task) is ignored.
CREATE VIEW zone_status AS
WITH last AS (
    SELECT az.zone_id,
           max(a.performed_on) FILTER (WHERE a.type = 'sowing')   AS last_sown_on,
           max(a.performed_on) FILTER (WHERE a.type = 'planting') AS last_planted_on,
           max(a.performed_on) FILTER (WHERE a.type = 'watering') AS last_watered_on
      FROM activity_zone az
      JOIN activity a ON a.id = az.activity_id AND a.deleted_at IS NULL
     GROUP BY az.zone_id
), base AS (
    SELECT z.id AS zone_id, z.plot_id, p.field_id, z.kind,
           l.last_sown_on, l.last_planted_on, l.last_watered_on,
           water_interval_days(p.field_id, field_today()) AS current_interval_days,
           (SELECT count(*) FROM task t
             WHERE t.zone_id = z.id AND t.deleted_at IS NULL
               AND t.status IN ('open', 'in_progress')) AS open_task_count
      FROM zone z
      JOIN plot p  ON p.id = z.plot_id AND p.deleted_at IS NULL
      JOIN field f ON f.id = p.field_id AND f.deleted_at IS NULL
      LEFT JOIN last l ON l.zone_id = z.id
     WHERE z.deleted_at IS NULL
)
SELECT base.*,
       CASE
           WHEN kind <> 'cultivation' THEN NULL                        -- paths never need water
           WHEN GREATEST(last_watered_on, last_sown_on, last_planted_on) IS NULL THEN false  -- nothing there yet
           ELSE field_today() - GREATEST(last_watered_on, last_sown_on, last_planted_on) >= current_interval_days
       END AS needs_water
  FROM base;

-- Same rule as zone_status: only live zones count. A soft-deleted zone's
-- history is kept in the tables, but no longer feeds the plot's numbers.
CREATE VIEW plot_stats AS
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

-- +goose Down
DROP VIEW plot_stats;
DROP VIEW zone_status;
DROP FUNCTION water_interval_days(uuid, date);
