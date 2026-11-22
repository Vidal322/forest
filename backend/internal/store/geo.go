package store

import (
	"encoding/json"
	"fmt"
)

// Geometries travel as GeoJSON geometry objects whose coordinates are frame units
// ([x, y] pixels of the first photo, y down) — never longitude/latitude.
// They are written with ST_SetSRID(ST_Force2D(ST_GeomFromGeoJSON($1)), 0).

// LineString is a GeoJSON LineString.
type LineString struct {
	Type        string  `json:"type"`
	Coordinates []Point `json:"coordinates"`
}

// NewLine makes a two-point LineString.
func NewLine(a, b Point) *LineString {
	return &LineString{Type: "LineString", Coordinates: []Point{a, b}}
}

func (l *LineString) validate(field string, points int) error {
	if l.Type != "LineString" {
		return invalid(field, "must be a GeoJSON LineString")
	}
	if len(l.Coordinates) != points {
		return invalid(field, "must have exactly %d points", points)
	}
	for _, p := range l.Coordinates {
		if !validCoord(p[0]) || !validCoord(p[1]) {
			return invalid(field, "has an invalid coordinate")
		}
	}
	return nil
}

// geomJSON is a scan target for ST_AsGeoJSON(...) output.
type geomJSON[T any] struct{ v *T }

func (g geomJSON[T]) Scan(src any) error {
	switch s := src.(type) {
	case nil:
		return nil
	case string:
		return json.Unmarshal([]byte(s), g.v)
	case []byte:
		return json.Unmarshal(s, g.v)
	}
	return fmt.Errorf("geojson: unexpected %T", src)
}
