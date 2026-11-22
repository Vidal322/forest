-- +goose Up
-- One real-world event (e.g. "watered Z2, Z5, Z9 today") = one activity row,
-- linked to its zones. Soft-deleted rows are tombstones for offline sync.
CREATE TABLE activity (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- may be generated on the device
    field_id     uuid NOT NULL REFERENCES field (id) ON DELETE RESTRICT,
    type         activity_type NOT NULL,
    performed_on date NOT NULL,
    notes        text,
    version      integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    deleted_at   timestamptz
);
CREATE INDEX activity_timeline ON activity (field_id, type, performed_on DESC);
CREATE TRIGGER activity_version BEFORE UPDATE ON activity FOR EACH ROW EXECUTE FUNCTION bump_version();

-- Quantity lives per zone ("100 covas in Z1, 80 in Z2").
-- The API ensures every activity has at least one zone.
CREATE TABLE activity_zone (
    activity_id uuid NOT NULL REFERENCES activity (id) ON DELETE CASCADE,
    zone_id     uuid NOT NULL REFERENCES zone (id) ON DELETE RESTRICT,
    quantity    integer CHECK (quantity > 0),
    unit        quantity_unit,
    PRIMARY KEY (activity_id, zone_id),
    CONSTRAINT activity_zone_quantity_unit CHECK ((quantity IS NULL) = (unit IS NULL))
);
CREATE INDEX activity_zone_zone ON activity_zone (zone_id);

-- Species / seed mix of a sowing or planting (the API rejects it for other types).
CREATE TABLE activity_species (
    activity_id uuid NOT NULL REFERENCES activity (id) ON DELETE CASCADE,
    species_id  uuid NOT NULL REFERENCES species (id) ON DELETE RESTRICT,
    quantity    integer CHECK (quantity > 0),
    unit        quantity_unit,
    notes       text,
    PRIMARY KEY (activity_id, species_id),
    CONSTRAINT activity_species_quantity_unit CHECK ((quantity IS NULL) = (unit IS NULL))
);
CREATE INDEX activity_species_species ON activity_species (species_id);

-- +goose Down
DROP TABLE activity_species;
DROP TABLE activity_zone;
DROP TABLE activity;
