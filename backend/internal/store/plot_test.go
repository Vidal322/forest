package store_test

import (
	"errors"
	"math"
	"testing"

	"github.com/google/uuid"

	"forest/internal/store"
)

func square(x, y, size float64) store.Polygon {
	return store.Polygon{Type: "Polygon", Coordinates: [][]store.Point{{{x, y}, {x + size, y}, {x + size, y + size}, {x, y + size}, {x, y}}}}
}

func newPlot(t *testing.T, s *store.Store, name string, geom store.Polygon) store.Plot {
	t.Helper()
	p, _, err := s.PutPlot(t.Context(), uuid.New(), store.PlotInput{Name: name, Geom: geom})
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestPlotsNeedAField(t *testing.T) {
	s, _ := freshStore(t)
	_, _, err := s.PutPlot(t.Context(), uuid.New(), store.PlotInput{Name: "P", Geom: square(0, 0, 10)})
	if !errors.Is(err, store.ErrNoField) {
		t.Fatalf("got %v", err)
	}
}

func TestPlotLifecycle(t *testing.T) {
	s, _ := freshStore(t)
	ctx := t.Context()
	newField(t, s)
	id := uuid.New()
	ha := 6.2
	// an open ring is closed by the store
	open := store.Polygon{Type: "Polygon", Coordinates: [][]store.Point{{{0, 0}, {100, 0}, {100, 100}, {0, 100}}}}
	p, created, err := s.PutPlot(ctx, id, store.PlotInput{Name: " Plot 1 ", Geom: open, DeclaredAreaHa: &ha})
	if err != nil || !created {
		t.Fatalf("create: %v %v", created, err)
	}
	ring := p.Geom.Coordinates[0]
	if p.Name != "Plot 1" || len(ring) != 5 || ring[0] != ring[4] || p.AreaHa != nil || *p.DeclaredAreaHa != 6.2 {
		t.Fatalf("plot: %+v", p)
	}

	// calibrate: 1 unit = 2 m → 100×100 units = 200 m × 200 m = 4 ha
	l := 200.0
	if _, err := s.UpdateField(ctx, store.FieldInput{Name: "Q", DefaultWaterIntervalDays: 7,
		CalibrationLine: store.NewLine(store.Point{0, 0}, store.Point{100, 0}), CalibrationLengthM: &l}); err != nil {
		t.Fatal(err)
	}
	if p, err = s.GetPlot(ctx, id); err != nil || p.AreaHa == nil || math.Abs(*p.AreaHa-4) > 1e-9 {
		t.Fatalf("area: %v %v", p.AreaHa, err)
	}

	if _, _, err := s.PutPlot(ctx, uuid.New(), store.PlotInput{Name: "PLOT 1", Geom: square(200, 0, 50)}); err == nil {
		t.Fatal("duplicate name accepted")
	} else if ce := new(store.ConflictError); !errors.As(err, &ce) || ce.Field != "name" {
		t.Fatalf("duplicate: %v", err)
	}

	if err := s.DeletePlot(ctx, id); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.PutPlot(ctx, id, store.PlotInput{Name: "Plot 1", Geom: square(0, 0, 10)}); !errors.Is(err, store.ErrDeleted) {
		t.Fatalf("edit deleted: %v", err)
	}
}

func TestPlotGeometryValidation(t *testing.T) {
	s, _ := freshStore(t)
	newField(t, s)
	bowtie := store.Polygon{Type: "Polygon", Coordinates: [][]store.Point{{{0, 0}, {100, 100}, {100, 0}, {0, 100}, {0, 0}}}}
	for name, g := range map[string]store.Polygon{
		"self-crossing": bowtie,
		"two corners":   {Type: "Polygon", Coordinates: [][]store.Point{{{0, 0}, {10, 0}}}},
		"flat":          {Type: "Polygon", Coordinates: [][]store.Point{{{0, 0}, {10, 0}, {20, 0}}}},
		"hole":          {Type: "Polygon", Coordinates: [][]store.Point{square(0, 0, 10).Coordinates[0], square(2, 2, 2).Coordinates[0]}},
		"wrong type":    {Type: "Point"},
		"NaN":           {Type: "Polygon", Coordinates: [][]store.Point{{{math.NaN(), 0}, {10, 0}, {10, 10}}}},
	} {
		_, _, err := s.PutPlot(t.Context(), uuid.New(), store.PlotInput{Name: "P " + name, Geom: g})
		var ve *store.ValidationError
		if !errors.As(err, &ve) || ve.Field != "geom" {
			t.Errorf("%s: want a geom validation error, got %v", name, err)
		}
	}
}

func TestZones(t *testing.T) {
	s, _ := freshStore(t)
	ctx := t.Context()
	newField(t, s)
	plot := newPlot(t, s, "Plot A", square(0, 0, 100))
	other := newPlot(t, s, "Plot B", square(200, 0, 100))

	id := uuid.New()
	z, created, err := s.PutZone(ctx, id, store.ZoneInput{PlotID: plot.ID, Label: ptr("Ninhos"), Geom: square(10, 10, 20)})
	if err != nil || !created {
		t.Fatalf("create: %v %v", created, err)
	}
	if z.Kind != "cultivation" || *z.Label != "Ninhos" || z.NeedsWater == nil || *z.NeedsWater || z.CurrentIntervalDays != 7 {
		t.Fatalf("new zone: %+v", z)
	}

	// a path never needs water
	p, _, err := s.PutZone(ctx, uuid.New(), store.ZoneInput{PlotID: plot.ID, Kind: "path", Geom: square(50, 50, 10)})
	if err != nil || p.NeedsWater != nil {
		t.Fatalf("path: %+v %v", p, err)
	}

	// on the plot's edge (within 1 unit) is fine, outside is not
	if _, _, err := s.PutZone(ctx, uuid.New(), store.ZoneInput{PlotID: plot.ID, Geom: square(0, 0, 100.5)}); err != nil {
		t.Fatalf("edge: %v", err)
	}
	var ve *store.ValidationError
	if _, _, err := s.PutZone(ctx, uuid.New(), store.ZoneInput{PlotID: plot.ID, Geom: square(90, 90, 30)}); !errors.As(err, &ve) || ve.Field != "geom" {
		t.Fatalf("outside: %v", err)
	}
	// moving the zone to another plot means it must fit that plot
	if _, _, err := s.PutZone(ctx, id, store.ZoneInput{PlotID: other.ID, Geom: square(210, 10, 20)}); err != nil {
		t.Fatalf("move: %v", err)
	}
	if _, _, err := s.PutZone(ctx, uuid.New(), store.ZoneInput{PlotID: uuid.New(), Geom: square(10, 10, 5)}); !errors.As(err, &ve) || ve.Field != "plot_id" {
		t.Fatalf("unknown plot: %v", err)
	}
	if _, _, err := s.PutZone(ctx, uuid.New(), store.ZoneInput{PlotID: plot.ID, Kind: "lake", Geom: square(10, 10, 5)}); !errors.As(err, &ve) || ve.Field != "kind" {
		t.Fatalf("bad kind: %v", err)
	}

	list, err := s.ListZones(ctx)
	if err != nil || len(list) != 3 {
		t.Fatalf("list: %d %v", len(list), err)
	}

	// deleting the plot takes its zones with it
	if err := s.DeletePlot(ctx, plot.ID); err != nil {
		t.Fatal(err)
	}
	if list, _ = s.ListZones(ctx); len(list) != 1 || list[0].ID != id {
		t.Fatalf("after plot delete: %+v", list)
	}
	if err := s.DeleteZone(ctx, id); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteZone(ctx, id); err != nil {
		t.Fatalf("second delete: %v", err)
	}
	if _, _, err := s.PutZone(ctx, id, store.ZoneInput{PlotID: other.ID, Geom: square(210, 10, 20)}); !errors.Is(err, store.ErrDeleted) {
		t.Fatalf("edit deleted zone: %v", err)
	}
}

func TestPlotReshapeKeepsZonesInside(t *testing.T) {
	s, _ := freshStore(t)
	ctx := t.Context()
	newField(t, s)
	plot := newPlot(t, s, "Plot R", square(0, 0, 100))
	if _, _, err := s.PutZone(ctx, uuid.New(), store.ZoneInput{PlotID: plot.ID, Label: ptr("Clareira"), Geom: square(60, 60, 30)}); err != nil {
		t.Fatal(err)
	}
	_, _, err := s.PutPlot(ctx, plot.ID, store.PlotInput{Name: "Plot R", Geom: square(0, 0, 50)})
	var ve *store.ValidationError
	if !errors.As(err, &ve) || ve.Field != "geom" {
		t.Fatalf("shrinking past a zone: %v", err)
	}
	if _, _, err := s.PutPlot(ctx, plot.ID, store.PlotInput{Name: "Plot R", Geom: square(0, 0, 120)}); err != nil {
		t.Fatalf("growing: %v", err)
	}
}

func TestLateZoneEditsAfterDeletes(t *testing.T) {
	s, _ := freshStore(t)
	ctx := t.Context()
	newField(t, s)
	plot := newPlot(t, s, "Plot L", square(0, 0, 100))
	zoneID := uuid.New()
	if _, _, err := s.PutZone(ctx, zoneID, store.ZoneInput{PlotID: plot.ID, Geom: square(10, 10, 10)}); err != nil {
		t.Fatal(err)
	}
	if err := s.DeletePlot(ctx, plot.ID); err != nil {
		t.Fatal(err)
	}
	// queued offline before the delete reached the server: gone, not invalid
	if _, _, err := s.PutZone(ctx, zoneID, store.ZoneInput{PlotID: plot.ID, Geom: square(10, 10, 10)}); !errors.Is(err, store.ErrDeleted) {
		t.Fatalf("edit of a cascaded zone: %v", err)
	}
	if _, _, err := s.PutZone(ctx, uuid.New(), store.ZoneInput{PlotID: plot.ID, Geom: square(10, 10, 10)}); !errors.Is(err, store.ErrDeleted) {
		t.Fatalf("new zone in a deleted plot: %v", err)
	}
	if err := s.DeletePlot(ctx, plot.ID); err != nil {
		t.Fatalf("second delete: %v", err)
	}
}
