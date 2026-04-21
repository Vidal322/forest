-- +goose Up
CREATE TABLE species (
	id          SERIAL PRIMARY KEY,
	name        TEXT NOT NULL,
	description TEXT,
	image_url   TEXT
);

-- +goose Down
DROP TABLE species;
