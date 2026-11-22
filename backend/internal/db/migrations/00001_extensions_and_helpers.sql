-- +goose Up
CREATE EXTENSION IF NOT EXISTS postgis;

-- "Today" (season + days since watering) is the field's local date, whatever
-- timezone a client session happens to use. (One field, in Portugal, for now;
-- this becomes a field.timezone column if fields elsewhere are ever needed.)
-- +goose StatementBegin
CREATE FUNCTION field_today() RETURNS date
LANGUAGE sql STABLE AS $$
    SELECT (now() AT TIME ZONE 'Europe/Lisbon')::date
$$;
-- +goose StatementEnd

-- updated_at moves only when something actually changed, so a repeated
-- offline upsert with identical content really is a no-op.
-- +goose StatementBegin
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW IS DISTINCT FROM OLD THEN
        NEW.updated_at := now();
    END IF;
    RETURN NEW;
END
$$;
-- +goose StatementEnd

-- For rows edited offline (activity, task): the database owns `version`.
-- Any real change — including a soft delete — bumps it, so a stale edit made
-- against an older version is always detectable. Callers never set version.
-- +goose StatementBegin
CREATE FUNCTION bump_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW IS DISTINCT FROM OLD THEN
        NEW.version := OLD.version + 1;
        NEW.updated_at := now();
    END IF;
    RETURN NEW;
END
$$;
-- +goose StatementEnd

-- +goose Down
DROP FUNCTION bump_version();
DROP FUNCTION set_updated_at();
DROP FUNCTION field_today();
-- PostGIS is left in place on purpose: other objects may depend on it.
