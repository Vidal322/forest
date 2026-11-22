-- +goose Up
-- A field is the photographed area plus its fake coordinate frame:
-- units = pixels of the FIRST photo, origin top-left, y down, SRID 0. No GPS, ever.
CREATE TABLE field (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name                        text NOT NULL CHECK (btrim(name) <> ''),
    frame_width                 integer NOT NULL CHECK (frame_width > 0),
    frame_height                integer NOT NULL CHECK (frame_height > 0),
    calibration_line            geometry(LineString, 0),
    calibration_length_m        numeric,
    metres_per_unit             numeric GENERATED ALWAYS AS
                                    (calibration_length_m / NULLIF(ST_Length(calibration_line), 0)::numeric) STORED,
    default_water_interval_days integer NOT NULL DEFAULT 7 CHECK (default_water_interval_days > 0),
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now(),
    deleted_at                  timestamptz,
    CONSTRAINT field_calibration_complete CHECK ((calibration_line IS NULL) = (calibration_length_m IS NULL)),
    -- numeric accepts NaN/Infinity and NaN > 0 is true, hence the upper bound
    CONSTRAINT field_calibration_positive CHECK (calibration_length_m > 0 AND calibration_length_m < 100000
                                                 AND ST_Length(calibration_line) > 0),
    -- geometry(…, 0) does NOT enforce SRID 0 (0 means "unknown" to PostGIS)
    CONSTRAINT field_calibration_srid CHECK (ST_SRID(calibration_line) = 0)
);
CREATE TRIGGER field_updated_at BEFORE UPDATE ON field FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Every photo of the field. The first one has the identity transform; newer ones
-- are aligned to it, so drawings never move when the photo changes.
-- affine_to_frame = {a,b,c,d,e,f}: x' = a·x + b·y + c, y' = d·x + e·y + f (photo px → frame).
-- float8[] maps straight to []float64 in Go; the CHECK rejects NULLs, NaN, ±Infinity and 2-D arrays.
CREATE TABLE field_image (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    field_id         uuid NOT NULL REFERENCES field (id) ON DELETE RESTRICT,
    image_key        text NOT NULL CHECK (btrim(image_key) <> ''),
    width_px         integer NOT NULL CHECK (width_px > 0),
    height_px        integer NOT NULL CHECK (height_px > 0),
    affine_to_frame  float8[] NOT NULL DEFAULT '{1,0,0,0,1,0}' CHECK (
                         array_ndims(affine_to_frame) = 1
                         AND cardinality(affine_to_frame) = 6
                         AND array_position(affine_to_frame, NULL) IS NULL
                         AND NOT ('NaN'::float8 = ANY (affine_to_frame))
                         AND NOT ('Infinity'::float8 = ANY (affine_to_frame))
                         AND NOT ('-Infinity'::float8 = ANY (affine_to_frame))),
    alignment_points jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(alignment_points) = 'array'),
    residual_px      numeric CHECK (residual_px >= 0 AND residual_px < 100000),
    captured_on      date,
    is_current       boolean NOT NULL DEFAULT false,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    deleted_at       timestamptz
);
CREATE INDEX field_image_field ON field_image (field_id);
CREATE UNIQUE INDEX field_image_one_current ON field_image (field_id) WHERE is_current AND deleted_at IS NULL;
CREATE TRIGGER field_image_updated_at BEFORE UPDATE ON field_image FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- How often zones need water, by season. Ranges may wrap past December (Nov–Feb).
CREATE TABLE watering_rule (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    field_id      uuid NOT NULL REFERENCES field (id) ON DELETE RESTRICT,
    name          text NOT NULL CHECK (btrim(name) <> ''),
    from_month    smallint NOT NULL CHECK (from_month BETWEEN 1 AND 12),
    to_month      smallint NOT NULL CHECK (to_month BETWEEN 1 AND 12),
    interval_days integer NOT NULL CHECK (interval_days > 0),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    deleted_at    timestamptz
);
CREATE INDEX watering_rule_field ON watering_rule (field_id);
CREATE TRIGGER watering_rule_updated_at BEFORE UPDATE ON watering_rule FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- +goose Down
DROP TABLE watering_rule;
DROP TABLE field_image;
DROP TABLE field;
