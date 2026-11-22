-- +goose Up
CREATE TABLE species (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scientific_name text NOT NULL CHECK (btrim(scientific_name) <> ''),
    common_name     text,
    notes           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz
);
-- case-insensitive, so "Quercus suber" and "quercus suber" can't both exist
CREATE UNIQUE INDEX species_name_unique ON species (lower(scientific_name)) WHERE deleted_at IS NULL;
CREATE TRIGGER species_updated_at BEFORE UPDATE ON species FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- +goose Down
DROP TABLE species;
