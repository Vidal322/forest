-- +goose Up
CREATE TABLE plot (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    field_id         uuid NOT NULL REFERENCES field (id) ON DELETE RESTRICT,
    name             text NOT NULL CHECK (btrim(name) <> ''),
    geom             geometry(Polygon, 0) NOT NULL
                         CHECK (ST_SRID(geom) = 0 AND ST_IsValid(geom) AND NOT ST_IsEmpty(geom)),
    declared_area_ha numeric CHECK (declared_area_ha > 0 AND declared_area_ha < 100000),  -- hectares written on the old map
    notes            text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    deleted_at       timestamptz
);
CREATE UNIQUE INDEX plot_name_unique ON plot (field_id, name) WHERE deleted_at IS NULL;
CREATE INDEX plot_geom ON plot USING gist (geom);
CREATE TRIGGER plot_updated_at BEFORE UPDATE ON plot FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Zones may overlap each other; each belongs to exactly one plot
-- (the API checks the zone lies inside it — a CHECK can't look at another table).
CREATE TABLE zone (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plot_id    uuid NOT NULL REFERENCES plot (id) ON DELETE RESTRICT,
    label      text,
    kind       zone_kind NOT NULL DEFAULT 'cultivation',
    geom       geometry(Polygon, 0) NOT NULL
                   CHECK (ST_SRID(geom) = 0 AND ST_IsValid(geom) AND NOT ST_IsEmpty(geom)),
    notes      text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);
CREATE INDEX zone_plot ON zone (plot_id);
CREATE INDEX zone_geom ON zone USING gist (geom);
CREATE TRIGGER zone_updated_at BEFORE UPDATE ON zone FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- +goose Down
DROP TABLE zone;
DROP TABLE plot;
