-- +goose Up
-- "Plot 1" and "plot 1" are the same plot to a person (species names already work this way).
DROP INDEX plot_name_unique;
CREATE UNIQUE INDEX plot_name_unique ON plot (field_id, lower(name)) WHERE deleted_at IS NULL;

-- +goose Down
DROP INDEX plot_name_unique;
CREATE UNIQUE INDEX plot_name_unique ON plot (field_id, name) WHERE deleted_at IS NULL;
