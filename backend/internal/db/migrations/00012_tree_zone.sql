-- +goose Up
-- Trees counted per zone ("12 alive, 2 dead sobreiros here") have no measured
-- position: their zone is the only location known, so it is stored. Deriving it
-- from a made-up point would mix up overlapping zones. Trees with a real position
-- keep zone_id NULL and their zone is still derived from the position.
ALTER TABLE tree ADD COLUMN zone_id uuid REFERENCES zone (id) ON DELETE RESTRICT;
CREATE INDEX tree_zone_species ON tree (zone_id, species_id) WHERE deleted_at IS NULL;

-- +goose Down
DROP INDEX tree_zone_species;
ALTER TABLE tree DROP COLUMN zone_id;
