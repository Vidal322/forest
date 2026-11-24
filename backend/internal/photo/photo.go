// Package photo cleans uploaded field photos and keeps them on disk.
//
// Cleaning = decode the pixels and encode them again as a fresh JPEG. Nothing of
// the original file survives: no EXIF, no GPS, no XMP, no camera or app metadata.
// That is the privacy promise of the app (no real-world location, ever).
package photo

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	_ "image/png" // register decoders for image.Decode
	"io"

	_ "golang.org/x/image/webp"
)

// Limits keep a malicious or accidental huge image from exhausting memory:
// DecodeConfig reads only the header, so the size is checked before decoding.
const (
	MaxSide   = 12000
	MaxPixels = 40_000_000
)

// one decode at a time: each can take a few hundred MB; uploads are rare
var decoding = make(chan struct{}, 1)

// ErrNotAnImage: the upload is not a PNG, JPEG or WebP image.
var ErrNotAnImage = errors.New("not a PNG, JPEG or WebP image")

// ErrFileTooLarge: the upload has more bytes than allowed.
var ErrFileTooLarge = errors.New("file too large")

// ErrTooLarge: the image has more pixels than MaxSide/MaxPixels allow.
var ErrTooLarge = fmt.Errorf("image larger than %d px per side or %d megapixels", MaxSide, MaxPixels/1_000_000)

// Cleaned is an upload made safe to keep: the photo as a fresh JPEG, its size, and
// the smaller copy the map shows (nil when the photo is already small enough).
type Cleaned struct {
	JPEG          []byte
	Display       []byte
	Width, Height int
}

// Clean decodes an image and returns it re-encoded as JPEG, with its size and its
// display copy. JPEGs are first turned upright according to their EXIF orientation,
// and transparency is flattened onto white.
func Clean(data []byte) (Cleaned, error) {
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return Cleaned{}, ErrNotAnImage
	}
	if cfg.Width <= 0 || cfg.Height <= 0 {
		return Cleaned{}, ErrNotAnImage
	}
	if cfg.Width > MaxSide || cfg.Height > MaxSide || cfg.Width*cfg.Height > MaxPixels {
		return Cleaned{}, ErrTooLarge
	}
	decoding <- struct{}{}
	defer func() { <-decoding }()
	img, format, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return Cleaned{}, ErrNotAnImage
	}
	o := 1
	if format == "jpeg" {
		o = jpegOrientation(data)
	}
	upright := orient(img, o)
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, upright, &jpeg.Options{Quality: 88}); err != nil {
		return Cleaned{}, err
	}
	display, err := displayCopy(upright)
	if err != nil {
		return Cleaned{}, err
	}
	b := upright.Bounds()
	return Cleaned{JPEG: buf.Bytes(), Display: display, Width: b.Dx(), Height: b.Dy()}, nil
}

// ReadLimited reads at most limit bytes from r; more is an error.
func ReadLimited(r io.Reader, limit int64) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(r, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, ErrFileTooLarge
	}
	return data, nil
}
