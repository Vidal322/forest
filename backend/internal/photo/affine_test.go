package photo

import (
	"errors"
	"math"
	"testing"
)

func TestFitAffineRecoversTransform(t *testing.T) {
	// a newer photo at half the resolution, shifted by (100, 50) and slightly rotated
	ang := 3 * math.Pi / 180
	want := Affine{2 * math.Cos(ang), -2 * math.Sin(ang), 100, 2 * math.Sin(ang), 2 * math.Cos(ang), 50}
	var pairs []PointPair
	for _, p := range [][2]float64{{10, 10}, {400, 30}, {380, 300}, {20, 280}} {
		x, y := want.Apply(p[0], p[1])
		pairs = append(pairs, PointPair{Photo: p, Frame: [2]float64{x, y}})
	}
	got, residual, err := FitAffine(pairs, 500)
	if err != nil {
		t.Fatal(err)
	}
	for i := range got {
		if math.Abs(got[i]-want[i]) > 1e-6 {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
	if residual > 1e-6 {
		t.Fatalf("residual %v", residual)
	}
}

func TestFitAffineResidualShowsSloppyClicks(t *testing.T) {
	pairs := []PointPair{
		{Photo: [2]float64{0, 0}, Frame: [2]float64{0, 0}},
		{Photo: [2]float64{100, 0}, Frame: [2]float64{100, 0}},
		{Photo: [2]float64{0, 100}, Frame: [2]float64{0, 100}},
		{Photo: [2]float64{100, 100}, Frame: [2]float64{104, 100}}, // 4 px off
	}
	_, residual, err := FitAffine(pairs, 141)
	if err != nil || residual < 0.5 || residual > 4 {
		t.Fatalf("residual %v %v", residual, err)
	}
}

func TestFitAffineRefusesBadPoints(t *testing.T) {
	line := []PointPair{
		{Photo: [2]float64{0, 0}, Frame: [2]float64{0, 0}},
		{Photo: [2]float64{10, 10}, Frame: [2]float64{10, 10}},
		{Photo: [2]float64{20, 20}, Frame: [2]float64{20, 20}},
	}
	if _, _, err := FitAffine(line, 100); !errors.Is(err, ErrAlignment) {
		t.Fatalf("collinear: %v", err)
	}
	if _, _, err := FitAffine(line[:2], 100); !errors.Is(err, ErrAlignment) {
		t.Fatalf("two points: %v", err)
	}
	// nearly flat: 3600 px long, the third point 5 px off the line, in a 5000 px photo
	flat := []PointPair{
		{Photo: [2]float64{100, 100}, Frame: [2]float64{100, 100}},
		{Photo: [2]float64{3700, 100}, Frame: [2]float64{3700, 100}},
		{Photo: [2]float64{1900, 105}, Frame: [2]float64{1900, 107}},
	}
	if _, _, err := FitAffine(flat, 5000); !errors.Is(err, ErrAlignment) {
		t.Fatalf("nearly flat: %v", err)
	}
	// the same good triangle is accepted wherever it lies in a big photo
	for _, off := range []float64{0, 2000, 11000} {
		tri := []PointPair{
			{Photo: [2]float64{off, off}, Frame: [2]float64{off, off}},
			{Photo: [2]float64{off + 2000, off}, Frame: [2]float64{off + 2000, off}},
			{Photo: [2]float64{off, off + 2000}, Frame: [2]float64{off, off + 2000}},
		}
		if _, _, err := FitAffine(tri, 16000); err != nil {
			t.Fatalf("triangle at %v: %v", off, err)
		}
	}
}

func TestFitAffineRefusesSwappedAndDistorted(t *testing.T) {
	// mirrored: two landmarks matched to each other's places
	swapped := []PointPair{
		{Photo: [2]float64{0, 0}, Frame: [2]float64{0, 0}},
		{Photo: [2]float64{100, 0}, Frame: [2]float64{0, 100}},
		{Photo: [2]float64{0, 100}, Frame: [2]float64{100, 0}},
	}
	if _, _, err := FitAffine(swapped, 141); !errors.Is(err, ErrMirrored) {
		t.Fatalf("swapped: %v", err)
	}
	// one landmark far off: a strong shear
	sheared := []PointPair{
		{Photo: [2]float64{0, 0}, Frame: [2]float64{0, 0}},
		{Photo: [2]float64{100, 0}, Frame: [2]float64{100, 0}},
		{Photo: [2]float64{0, 100}, Frame: [2]float64{300, 100}},
	}
	if _, _, err := FitAffine(sheared, 141); !errors.Is(err, ErrDistorted) {
		t.Fatalf("sheared: %v", err)
	}
}
