-- +goose Up
CREATE TABLE sessions (
	id         SERIAL PRIMARY KEY,
	region_id  INT NOT NULL REFERENCES regions(id),
	planted_at TIMESTAMP NOT NULL,
	notes      TEXT
);

-- +goose Down
DROP TABLE sessions;
