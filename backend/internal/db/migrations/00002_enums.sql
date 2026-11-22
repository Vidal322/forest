-- +goose Up
CREATE TYPE zone_kind     AS ENUM ('cultivation', 'path', 'other');
CREATE TYPE activity_type AS ENUM ('sowing', 'planting', 'watering', 'fertilizing', 'other');
CREATE TYPE quantity_unit AS ENUM ('holes', 'seeds', 'trees', 'litres', 'kg');
CREATE TYPE tree_status   AS ENUM ('alive', 'dead', 'removed');
CREATE TYPE task_kind     AS ENUM ('sow', 'plant', 'water', 'fertilize', 'add_nests', 'improve_path', 'other');
CREATE TYPE task_status   AS ENUM ('open', 'in_progress', 'done', 'cancelled');

-- +goose Down
DROP TYPE task_status;
DROP TYPE task_kind;
DROP TYPE tree_status;
DROP TYPE quantity_unit;
DROP TYPE activity_type;
DROP TYPE zone_kind;
