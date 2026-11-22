package photo

import (
	"errors"
	"math"
)

// Affine maps photo pixels to frame units: x' = A·x + B·y + C, y' = D·x + E·y + F,
// stored as [A B C D E F] (field_image.affine_to_frame).
type Affine [6]float64

// Identity is the transform of the first photo (it *is* the frame).
var Identity = Affine{1, 0, 0, 0, 1, 0}

// Apply maps a photo point to the frame.
func (t Affine) Apply(x, y float64) (float64, float64) {
	return t[0]*x + t[1]*y + t[2], t[3]*x + t[4]*y + t[5]
}

// PointPair is one landmark clicked on both images: Photo on the new photo (px),
// Frame on the current map (frame units).
type PointPair struct {
	Photo [2]float64 `json:"photo"`
	Frame [2]float64 `json:"frame"`
}

// ErrAlignment: the points can't define a transform (too few, or on one line).
var ErrAlignment = errors.New("alignment needs at least 3 landmarks that are not on one line")

// ErrMirrored: the fit flips the photo over — landmarks were matched in the wrong order.
var ErrMirrored = errors.New("the landmarks seem swapped between the two photos")

// ErrDistorted: the fit stretches or shears far more than two photos of the same
// ground can differ — usually one landmark tapped in the wrong place.
var ErrDistorted = errors.New("the landmarks don't fit together; check each pair")

// minSpread: the landmarks must spread over at least this share of the photo
// (thinnest direction), or a small tap error tilts the whole photo.
const minSpread = 0.02

// FitAffine finds the least-squares affine transform from photo to frame, and the
// residual: the root-mean-square distance (frame units) between where the transform
// puts each landmark and where it was tapped (0 with exactly 3 landmarks).
// photoDiagonal is the photo's diagonal in pixels, used to judge the landmarks' spread.
func FitAffine(pairs []PointPair, photoDiagonal float64) (Affine, float64, error) {
	n := float64(len(pairs))
	if len(pairs) < 3 {
		return Affine{}, 0, ErrAlignment
	}
	// centre both point sets: the fit then only needs the 2×2 linear part
	var px, py, fx, fy float64
	for _, p := range pairs {
		px, py, fx, fy = px+p.Photo[0], py+p.Photo[1], fx+p.Frame[0], fy+p.Frame[1]
	}
	px, py, fx, fy = px/n, py/n, fx/n, fy/n
	var suu, suv, svv float64  // covariance of the photo points
	var a1, a2, b1, b2 float64 // cross terms with the frame points
	for _, p := range pairs {
		u, v := p.Photo[0]-px, p.Photo[1]-py
		x, y := p.Frame[0]-fx, p.Frame[1]-fy
		suu, suv, svv = suu+u*u, suv+u*v, svv+v*v
		a1, a2, b1, b2 = a1+x*u, a2+x*v, b1+y*u, b2+y*v
	}
	// shape: the smaller eigenvalue of the covariance = spread across the thinnest direction
	tr, det := (suu+svv)/n, (suu*svv-suv*suv)/(n*n)
	smallest := tr/2 - math.Sqrt(math.Max(tr*tr/4-det, 0))
	if !(math.Sqrt(math.Max(smallest, 0)) >= minSpread*photoDiagonal) {
		return Affine{}, 0, ErrAlignment
	}
	d := suu*svv - suv*suv
	// [a b; d e] = [Σxu Σxv; Σyu Σyv] · inverse([Σuu Σuv; Σuv Σvv])
	a := (a1*svv - a2*suv) / d
	b := (a2*suu - a1*suv) / d
	dd := (b1*svv - b2*suv) / d
	e := (b2*suu - b1*suv) / d
	t := Affine{a, b, fx - a*px - b*py, dd, e, fy - dd*px - e*py}

	if lin := a*e - b*dd; lin <= 0 || math.IsNaN(lin) {
		return Affine{}, 0, ErrMirrored
	} else if scale := math.Sqrt(lin); scale < 0.01 || scale > 100 {
		return Affine{}, 0, ErrDistorted
	}
	// singular values of the linear part: equal for a pure rotation + scale
	p2 := a*a + b*b + dd*dd + e*e
	q := math.Sqrt(math.Max(p2*p2-4*(a*e-b*dd)*(a*e-b*dd), 0))
	s1, s2 := math.Sqrt((p2+q)/2), math.Sqrt(math.Max((p2-q)/2, 0))
	if s2 == 0 || s1/s2 > 2 {
		return Affine{}, 0, ErrDistorted
	}

	var sum float64
	for _, p := range pairs {
		x, y := t.Apply(p.Photo[0], p.Photo[1])
		sum += (x-p.Frame[0])*(x-p.Frame[0]) + (y-p.Frame[1])*(y-p.Frame[1])
	}
	return t, math.Sqrt(sum / n), nil
}
