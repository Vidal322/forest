-- +goose Up
-- Zone codes ("Z1", "Z2"…): a short name painted on the map, given out per plot
-- by the database and never reused. zone.number is the code's number (the API
-- answers code = 'Z' || number); plot.last_zone_number is the last one given out
-- in that plot. A deleted zone keeps its number, and so does a zone that is
-- edited; a zone moved to another plot gets the next number there. Like
-- `version`, clients never set it.
ALTER TABLE plot ADD COLUMN last_zone_number integer NOT NULL DEFAULT 0 CHECK (last_zone_number >= 0);
ALTER TABLE zone ADD COLUMN number integer CHECK (number > 0);

-- Existing zones (deleted ones too: they keep theirs) in creation order, per plot.
UPDATE zone z SET number = n.number
  FROM (SELECT id, row_number() OVER (PARTITION BY plot_id ORDER BY created_at, id) AS number FROM zone) n
 WHERE n.id = z.id;
UPDATE plot p SET last_zone_number = COALESCE((SELECT max(number) FROM zone WHERE plot_id = p.id), 0);

ALTER TABLE zone ALTER COLUMN number SET NOT NULL;
CREATE UNIQUE INDEX zone_plot_number ON zone (plot_id, number);

-- Bumping the counter is bookkeeping, not an edit of the plot: its updated_at stays.
DROP TRIGGER plot_updated_at ON plot;
CREATE TRIGGER plot_updated_at BEFORE UPDATE ON plot FOR EACH ROW
    WHEN (OLD.last_zone_number = NEW.last_zone_number) EXECUTE FUNCTION set_updated_at();

-- The next number of the zone's plot, on insert and when the zone moves to
-- another plot; any other update keeps the number it has. Bumping the counter
-- locks the plot row, so concurrent inserts in one plot queue up and get
-- distinct numbers (the store takes that lock first: plot, then zone).
-- INSERT … ON CONFLICT runs BEFORE INSERT triggers even when the row exists and
-- the statement turns into an update: such a row keeps its number (taking a new
-- one would burn it and leave a gap).
-- +goose StatementBegin
CREATE FUNCTION set_zone_number() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    existing integer;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.plot_id = OLD.plot_id THEN
        NEW.number := OLD.number;
        RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' THEN
        SELECT number INTO existing FROM zone WHERE id = NEW.id;
        IF FOUND THEN
            NEW.number := existing; -- ON CONFLICT: the update path decides
            RETURN NEW;
        END IF;
    END IF;
    UPDATE plot SET last_zone_number = last_zone_number + 1
     WHERE id = NEW.plot_id
    RETURNING last_zone_number INTO NEW.number;
    RETURN NEW; -- no such plot: number stays NULL and NOT NULL rejects the row
END
$$;
-- +goose StatementEnd
CREATE TRIGGER zone_number BEFORE INSERT OR UPDATE ON zone FOR EACH ROW EXECUTE FUNCTION set_zone_number();

-- +goose Down
DROP TRIGGER zone_number ON zone;
DROP FUNCTION set_zone_number();
DROP TRIGGER plot_updated_at ON plot;
CREATE TRIGGER plot_updated_at BEFORE UPDATE ON plot FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP INDEX zone_plot_number;
ALTER TABLE zone DROP COLUMN number;
ALTER TABLE plot DROP COLUMN last_zone_number;
