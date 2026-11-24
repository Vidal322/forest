package photo

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
)

// halves is a w×h image whose left half is black and right half white.
func halves(w, h int) *image.Gray {
	img := image.NewGray(image.Rect(0, 0, w, h))
	for y := range h {
		for x := w / 2; x < w; x++ {
			img.SetGray(x, y, color.Gray{Y: 255})
		}
	}
	return img
}

func encodePNG(t *testing.T, img image.Image) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestDisplaySize(t *testing.T) {
	cases := []struct {
		w, h, dw, dh int
		ok           bool
	}{
		{2048, 1000, 2048, 1000, false},
		{100, 50, 100, 50, false},
		{4096, 3000, 2048, 1500, true},
		{3000, 6000, 1024, 2048, true},
		{9000, 3, 2048, 1, true},
	}
	for _, c := range cases {
		dw, dh, ok := displaySize(c.w, c.h)
		if dw != c.dw || dh != c.dh || ok != c.ok {
			t.Errorf("%dx%d: got %dx%d %v", c.w, c.h, dw, dh, ok)
		}
	}
}

func TestCleanMakesDisplayCopyOfLargePhotos(t *testing.T) {
	c, err := Clean(encodePNG(t, halves(4100, 2050)))
	if err != nil {
		t.Fatal(err)
	}
	if c.Width != 4100 || c.Height != 2050 {
		t.Fatalf("original size %dx%d", c.Width, c.Height)
	}
	img, err := jpeg.Decode(bytes.NewReader(c.Display))
	if err != nil {
		t.Fatalf("display copy is not a JPEG: %v", err)
	}
	if b := img.Bounds(); b.Dx() != 2048 || b.Dy() != 1024 {
		t.Fatalf("display size %dx%d", b.Dx(), b.Dy())
	}
	// same picture, scaled: the edge between the halves is still in the middle
	if l, r := gray(img.At(1000, 500)), gray(img.At(1048, 500)); l > 40 || r < 215 {
		t.Fatalf("display copy is not the photo scaled: left=%d right=%d", l, r)
	}
}

func TestOpenDisplay(t *testing.T) {
	d, err := NewDir(filepath.Join(t.TempDir(), "photos"))
	if err != nil {
		t.Fatal(err)
	}
	read := func(key string) image.Image {
		t.Helper()
		f, err := d.OpenDisplay(key)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = f.Close() }()
		b, _ := io.ReadAll(f)
		img, err := jpeg.Decode(bytes.NewReader(b))
		if err != nil {
			t.Fatal(err)
		}
		return img
	}

	// a small photo is its own display copy
	small, err := Clean(encodePNG(t, halves(300, 200)))
	if err != nil {
		t.Fatal(err)
	}
	key := uuid.NewString() + ".jpg"
	if err := d.Save(key, small.JPEG); err != nil {
		t.Fatal(err)
	}
	if b := read(key).Bounds(); b.Dx() != 300 || b.Dy() != 200 {
		t.Fatalf("small photo shown at %v", b)
	}
	if _, err := os.Stat(filepath.Join(d.path, displayDir, key)); !os.IsNotExist(err) {
		t.Fatal("a small photo should not get a copy on disk")
	}

	// a large photo stored before display copies existed gets one on first request
	large, err := Clean(encodePNG(t, halves(3000, 2500)))
	if err != nil {
		t.Fatal(err)
	}
	old := uuid.NewString() + ".jpg"
	if err := d.Save(old, large.JPEG); err != nil {
		t.Fatal(err)
	}
	if b := read(old).Bounds(); b.Dx() != 2048 || b.Dy() != 1707 {
		t.Fatalf("old photo display copy %v", b)
	}
	if _, err := os.Stat(filepath.Join(d.path, displayDir, old)); err != nil {
		t.Fatalf("display copy not kept: %v", err)
	}
	if b := read(old).Bounds(); b.Dx() != 2048 { // second request: from disk
		t.Fatalf("kept copy %v", b)
	}

	// the copy made on upload is the one served; the original is untouched
	key2 := uuid.NewString() + ".jpg"
	if err := d.Save(key2, large.JPEG); err != nil {
		t.Fatal(err)
	}
	if err := d.SaveDisplay(key2, large.Display); err != nil {
		t.Fatal(err)
	}
	if b := read(key2).Bounds(); b.Dx() != 2048 {
		t.Fatalf("uploaded copy %v", b)
	}
	f, _ := d.Open(key2)
	orig, _ := jpeg.DecodeConfig(f)
	_ = f.Close()
	if orig.Width != 3000 || orig.Height != 2500 {
		t.Fatalf("original %dx%d", orig.Width, orig.Height)
	}

	// removing a photo removes its copy too
	if err := d.Remove(key2); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(d.path, displayDir, key2)); !os.IsNotExist(err) {
		t.Fatal("display copy not removed")
	}

	if _, err := d.OpenDisplay("../x.jpg"); !errors.Is(err, ErrBadKey) {
		t.Fatalf("bad key: %v", err)
	}
	if _, err := d.OpenDisplay(uuid.NewString() + ".jpg"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("missing photo: %v", err)
	}
}
