package photo

import (
	"bytes"
	"errors"
	"image"
	"image/jpeg"
	"io/fs"
	"math"
	"os"
	"path/filepath"

	xdraw "golang.org/x/image/draw"
)

// DisplaySide is the longest side of the copy the map loads. A satellite screenshot
// can be 8000 px wide (tens of MB once decoded): too heavy for a phone on mobile data
// to download and keep in memory. The original stays on disk for calibration and
// alignment, and the frame is still its pixels: the map stretches the copy over the
// original's size, so every drawing lines up exactly.
const DisplaySide = 2048

const displayQuality = 82

// displaySize is the size of the display copy of a w×h photo, and false when the
// photo is small enough to be shown as it is.
func displaySize(w, h int) (dw, dh int, ok bool) {
	long := max(w, h)
	if long <= DisplaySide {
		return w, h, false
	}
	s := float64(DisplaySide) / float64(long)
	return max(1, int(math.Round(float64(w)*s))), max(1, int(math.Round(float64(h)*s))), true
}

// displayCopy returns img scaled down to DisplaySide as JPEG, or nil when img is
// already small enough.
func displayCopy(img image.Image) ([]byte, error) {
	b := img.Bounds()
	w, h, ok := displaySize(b.Dx(), b.Dy())
	if !ok {
		return nil, nil
	}
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), img, b, xdraw.Src, nil)
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: displayQuality}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// DisplayFromJPEG makes the display copy of a stored (cleaned, upright) photo, or
// returns nil when the photo is small enough to be shown as it is.
func DisplayFromJPEG(data []byte) ([]byte, error) {
	cfg, err := jpeg.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, ErrNotAnImage
	}
	if _, _, ok := displaySize(cfg.Width, cfg.Height); !ok {
		return nil, nil
	}
	if cfg.Width > MaxSide || cfg.Height > MaxSide || cfg.Width*cfg.Height > MaxPixels {
		return nil, ErrTooLarge
	}
	decoding <- struct{}{}
	defer func() { <-decoding }()
	img, err := jpeg.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, ErrNotAnImage
	}
	return displayCopy(img)
}

const displayDir = "display"

// SaveDisplay writes the display copy of the photo under key.
func (d *Dir) SaveDisplay(key string, data []byte) error {
	if !ValidKey(key) {
		return ErrBadKey
	}
	return saveAtomic(filepath.Join(d.path, displayDir), key, data)
}

// OpenDisplay opens the copy of the photo under key that the map shows: its display
// copy, or the photo itself when it is small enough. Photos stored before display
// copies existed get theirs made on this first request.
func (d *Dir) OpenDisplay(key string) (*os.File, error) {
	if !ValidKey(key) {
		return nil, ErrBadKey
	}
	path := filepath.Join(d.path, displayDir, key)
	f, err := os.Open(path) //nolint:gosec // key validated above
	if !errors.Is(err, fs.ErrNotExist) {
		return f, err
	}
	data, err := os.ReadFile(filepath.Join(d.path, key)) //nolint:gosec // key validated above
	if err != nil {
		return nil, err
	}
	display, err := DisplayFromJPEG(data)
	if err != nil {
		return nil, err
	}
	if display == nil {
		return d.Open(key)
	}
	if err := d.SaveDisplay(key, display); err != nil {
		return nil, err
	}
	return os.Open(path) //nolint:gosec // key validated above
}
