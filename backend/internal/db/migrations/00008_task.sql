-- +goose Up
CREATE TABLE task (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plot_id                 uuid REFERENCES plot (id) ON DELETE RESTRICT,
    zone_id                 uuid REFERENCES zone (id) ON DELETE RESTRICT,
    resolved_by_activity_id uuid REFERENCES activity (id) ON DELETE SET NULL,
    title                   text NOT NULL CHECK (btrim(title) <> ''),
    description             text,
    kind                    task_kind NOT NULL DEFAULT 'other',
    status                  task_status NOT NULL DEFAULT 'open',
    due_on                  date,
    completed_at            timestamptz,
    version                 integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    deleted_at              timestamptz,
    CONSTRAINT task_on_plot_or_zone CHECK (num_nonnulls(plot_id, zone_id) = 1),
    CONSTRAINT task_completed_when_closed CHECK ((status IN ('done', 'cancelled')) = (completed_at IS NOT NULL))
);
CREATE INDEX task_status ON task (status);
CREATE INDEX task_plot ON task (plot_id);
CREATE INDEX task_zone ON task (zone_id);
CREATE INDEX task_resolved_by ON task (resolved_by_activity_id);
CREATE TRIGGER task_version BEFORE UPDATE ON task FOR EACH ROW EXECUTE FUNCTION bump_version();

-- +goose Down
DROP TABLE task;
