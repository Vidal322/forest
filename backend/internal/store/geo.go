package store

import (
	"encoding/json"
	"fmt"
	"math"
)

// Geometries travel as GeoJSON geometry objects whose coordinates are frame units
// ([x, y] pixels of the first photo, y down) — never longitude/latitude.
// They are written with ST_SetSRID(ST_Force2D(ST_GeomFromGeoJSON($1)), 0).

// LineString is a GeoJSON LineString.
type LineString struct {
	Type        string  `json:"type"`
	Coordinates []Point `json:"coordinates"`
}

// Polygon is a GeoJSON Polygon with a single outer ring (no holes).
type Polygon struct {
	Type        string    `json:"type"`
	Coordinates [][]Point `json:"coordinates"`
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

// maxRingPoints keeps drawn shapes reasonable (a tap per vertex).
const maxRingPoints = 1000

// normalize checks the polygon and closes its ring if the client left it open.
func (p *Polygon) normalize(field string) error {
	if p.Type != "Polygon" {
		return invalid(field, "must be a GeoJSON Polygon")
	}
	if len(p.Coordinates) != 1 {
		return invalid(field, "must be a single outline without holes")
	}
	ring := p.Coordinates[0]
	for _, pt := range ring {
		if !validCoord(pt[0]) || !validCoord(pt[1]) {
			return invalid(field, "has an invalid coordinate")
		}
	}
	if len(ring) > 0 && ring[0] != ring[len(ring)-1] {
		ring = append(ring, ring[0])
	}
	if len(ring) < 4 { // 3 corners + the closing point
		return invalid(field, "needs at least 3 corners")
	}
	if len(ring) > maxRingPoints {
		return invalid(field, "has too many corners (max %d)", maxRingPoints)
	}
	if math.Abs(ringArea(ring)) < 1 {
		return invalid(field, "is too small: its corners are (almost) on a line")
	}
	p.Coordinates[0] = ring
	return nil
}

// ringArea is the signed shoelace area of a closed ring, in frame units².
func ringArea(ring []Point) float64 {
	a := 0.0
	for i := 0; i+1 < len(ring); i++ {
		a += ring[i][0]*ring[i+1][1] - ring[i+1][0]*ring[i][1]
	}
	return a / 2
}

func (p *Polygon) json() string {
	b, _ := json.Marshal(p) // only float64 arrays: cannot fail
	return string(b)
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
