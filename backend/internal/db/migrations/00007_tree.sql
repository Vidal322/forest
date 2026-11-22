-- +goose Up
CREATE TABLE tree (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plot_id              uuid NOT NULL REFERENCES plot (id) ON DELETE RESTRICT,
    species_id           uuid NOT NULL REFERENCES species (id) ON DELETE RESTRICT,
    planting_activity_id uuid REFERENCES activity (id) ON DELETE SET NULL,  -- API: must be a planting
    tag                  text,
    position             geometry(Point, 0)   -- optional; its zone(s) are derived, never stored
                             CHECK (ST_SRID(position) = 0 AND NOT ST_IsEmpty(position)),
    planted_on           date,
    status               tree_status NOT NULL DEFAULT 'alive',
    notes                text,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    deleted_at           timestamptz
);
CREATE INDEX tree_plot_species ON tree (plot_id, species_id);
CREATE INDEX tree_planting ON tree (planting_activity_id);
CREATE INDEX tree_position ON tree USING gist (position);
CREATE TRIGGER tree_updated_at BEFORE UPDATE ON tree FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- +goose Down
DROP TABLE tree;
