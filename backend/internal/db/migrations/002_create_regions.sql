-- +goose Up
CREATE TABLE regions (
	id       SERIAL PRIMARY KEY,
	name     TEXT NOT NULL,
	center_x FLOAT NOT NULL,
	center_y FLOAT NOT NULL,
	radius   FLOAT NOT NULL
);

-- +goose Down
DROP TABLE regions;
