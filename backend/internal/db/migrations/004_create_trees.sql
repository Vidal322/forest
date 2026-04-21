-- +goose Up
CREATE TABLE trees (
	id         SERIAL PRIMARY KEY,
	species_id INT NOT NULL REFERENCES species(id),
	session_id INT NOT NULL REFERENCES sessions(id),
	x          FLOAT NOT NULL,
	y          FLOAT NOT NULL,
	planted_at TIMESTAMP NOT NULL
);

-- +goose Down
DROP TABLE trees;
