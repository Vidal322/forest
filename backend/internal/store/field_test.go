package store_test

import (
	"errors"
	"math"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"forest/internal/dbtest"
	"forest/internal/store"
)

// freshStore is a store on a test transaction in which any real field is hidden
// (soft-deleted until the rollback), so the test can set up its own.
func freshStore(t *testing.T) (*store.Store, pgx.Tx) {
	t.Helper()
	tx := dbtest.Tx(t)
	if _, err := tx.Exec(t.Context(), `UPDATE field SET deleted_at = now() WHERE deleted_at IS NULL`); err != nil {
		t.Fatal(err)
	}
	return store.New(tx), tx
}

func newField(t *testing.T, s *store.Store) store.Field {
	t.Helper()
	f, err := s.CreateField(t.Context(), "Quinta test", uuid.NewString()+".jpg", 1000, 700)
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func TestFieldSetup(t *testing.T) {
	s, _ := freshStore(t)
	ctx := t.Context()
	if _, err := s.GetField(ctx); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("before setup: %v", err)
	}
	f := newField(t, s)
	if f.FrameWidth != 1000 || f.FrameHeight != 700 || f.MetresPerUnit != nil || f.DefaultWaterIntervalDays != 7 {
		t.Fatalf("new field: %+v", f)
	}
	if f.Photo == nil || f.Photo.AffineToFrame != [6]float64{1, 0, 0, 0, 1, 0} || f.Photo.Width != 1000 {
		t.Fatalf("first photo must define the frame with the identity transform: %+v", f.Photo)
	}
	if _, err := s.CreateField(ctx, "Again", uuid.NewString()+".jpg", 10, 10); !errors.Is(err, store.ErrFieldExists) {
		t.Fatalf("second field: %v", err)
	}
}

func TestFieldCalibration(t *testing.T) {
	s, _ := freshStore(t)
	ctx := t.Context()
	newField(t, s)

	length := 150.0
	f, err := s.UpdateField(ctx, store.FieldInput{
		Name:                     "Quinta",
		CalibrationLine:          store.NewLine(store.Point{180, 640}, store.Point{480, 240}), // 500 units long
		CalibrationLengthM:       &length,
		DefaultWaterIntervalDays: 7,
	})
	if err != nil {
		t.Fatal(err)
	}
	if f.MetresPerUnit == nil || math.Abs(*f.MetresPerUnit-0.3) > 1e-9 {
		t.Fatalf("metres per unit = %v, want 0.3", f.MetresPerUnit)
	}
	if f.CalibrationLine == nil || f.CalibrationLine.Type != "LineString" ||
		f.CalibrationLine.Coordinates[0] != (store.Point{180, 640}) || f.CalibrationLine.Coordinates[1] != (store.Point{480, 240}) {
		t.Fatalf("calibration not stored: %+v", f)
	}

	// clearing the calibration
	if f, err = s.UpdateField(ctx, store.FieldInput{Name: "Quinta", DefaultWaterIntervalDays: 10}); err != nil {
		t.Fatal(err)
	}
	if f.CalibrationLine != nil || f.MetresPerUnit != nil || f.DefaultWaterIntervalDays != 10 {
		t.Fatalf("not cleared: %+v", f)
	}
}

func TestFieldValidation(t *testing.T) {
	s, _ := freshStore(t)
	newField(t, s)
	l := 10.0
	zero := 0.0
	for name, in := range map[string]store.FieldInput{
		"no name":         {Name: " "},
		"line, no length": {Name: "Q", DefaultWaterIntervalDays: 7, CalibrationLine: store.NewLine(store.Point{0, 0}, store.Point{10, 0})},
		"length, no line": {Name: "Q", DefaultWaterIntervalDays: 7, CalibrationLengthM: &l},
		"zero length":     {Name: "Q", DefaultWaterIntervalDays: 7, CalibrationLine: store.NewLine(store.Point{0, 0}, store.Point{10, 0}), CalibrationLengthM: &zero},
		"line too short":  {Name: "Q", DefaultWaterIntervalDays: 7, CalibrationLine: store.NewLine(store.Point{5, 5}, store.Point{5.5, 5}), CalibrationLengthM: &l},
		"NaN":             {Name: "Q", DefaultWaterIntervalDays: 7, CalibrationLine: store.NewLine(store.Point{math.NaN(), 0}, store.Point{10, 0}), CalibrationLengthM: &l},
		"interval":        {Name: "Q", DefaultWaterIntervalDays: 400},
		"no interval":     {Name: "Q"},
		"3-point line":    {Name: "Q", DefaultWaterIntervalDays: 7, CalibrationLine: &store.LineString{Type: "LineString", Coordinates: []store.Point{{0, 0}, {10, 0}, {20, 0}}}, CalibrationLengthM: &l},
	} {
		var ve *store.ValidationError
		if _, err := s.UpdateField(t.Context(), in); !errors.As(err, &ve) {
			t.Errorf("%s: want validation error, got %v", name, err)
		}
	}
}

func TestUpdateFieldBeforeSetup(t *testing.T) {
	s, _ := freshStore(t)
	if _, err := s.UpdateField(t.Context(), store.FieldInput{Name: "Q", DefaultWaterIntervalDays: 7}); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("got %v", err)
	}
}
