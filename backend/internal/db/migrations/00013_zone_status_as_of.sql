-- +goose Up
-- Zone state on any day ("show the map as of 12 Oct"): the same rule as the
-- zone_status view, computed from the activities performed up to that day and
-- the watering interval in effect then. zone_status itself is this function for
-- field_today(), so the two can never disagree.
--
-- The zones are today's live zones (outlines are not versioned), and
-- open_task_count is today's count: tasks keep no history of their status.
-- +goose StatementBegin
CREATE FUNCTION zone_status_on(p_day date)
RETURNS TABLE (zone_id uuid, plot_id uuid, field_id uuid, kind zone_kind,
               last_sown_on date, last_planted_on date, last_watered_on date,
               current_interval_days integer, open_task_count bigint, needs_water boolean)
LANGUAGE sql STABLE AS $$
WITH last AS (
    SELECT az.zone_id,
           max(a.performed_on) FILTER (WHERE a.type = 'sowing')   AS last_sown_on,
           max(a.performed_on) FILTER (WHERE a.type = 'planting') AS last_planted_on,
           max(a.performed_on) FILTER (WHERE a.type = 'watering') AS last_watered_on
      FROM activity_zone az
      JOIN activity a ON a.id = az.activity_id AND a.deleted_at IS NULL
     WHERE a.performed_on <= p_day
     GROUP BY az.zone_id
), base AS (
    SELECT z.id AS zone_id, z.plot_id, p.field_id, z.kind,
           l.last_sown_on, l.last_planted_on, l.last_watered_on,
           water_interval_days(p.field_id, p_day) AS current_interval_days,
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
           ELSE p_day - GREATEST(last_watered_on, last_sown_on, last_planted_on) >= current_interval_days
       END AS needs_water
  FROM base
$$;
-- +goose StatementEnd

CREATE OR REPLACE VIEW zone_status AS
SELECT * FROM zone_status_on(field_today());

-- +goose Down
-- +goose StatementBegin
CREATE OR REPLACE VIEW zone_status AS
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
           WHEN kind <> 'cultivation' THEN NULL
           WHEN GREATEST(last_watered_on, last_sown_on, last_planted_on) IS NULL THEN false
           ELSE field_today() - GREATEST(last_watered_on, last_sown_on, last_planted_on) >= current_interval_days
       END AS needs_water
  FROM base;
-- +goose StatementEnd
DROP FUNCTION zone_status_on(date);
