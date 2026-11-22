package photo

import (
	"bytes"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
)

func testPNG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	img.Set(1, 1, color.RGBA{R: 200, A: 255})
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// A JPEG with an EXIF APP1 segment carrying a fake GPS marker right after SOI.
func jpegWithExif(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, image.NewGray(image.Rect(0, 0, 40, 30)), nil); err != nil {
		t.Fatal(err)
	}
	b := buf.Bytes()
	payload := append([]byte("Exif\x00\x00"), []byte("GPSLatitude=38.7223;GPSLongitude=-9.1393")...)
	seg := []byte{0xFF, 0xE1, 0, 0}
	binary.BigEndian.PutUint16(seg[2:], uint16(len(payload)+2)) //nolint:gosec // small constant payload
	seg = append(seg, payload...)
	return append(append(append([]byte{}, b[:2]...), seg...), b[2:]...)
}

func TestCleanStripsMetadata(t *testing.T) {
	in := jpegWithExif(t)
	if !bytes.Contains(in, []byte("GPSLatitude")) {
		t.Fatal("fixture should contain the marker")
	}
	out, w, h, err := Clean(in)
	if err != nil {
		t.Fatal(err)
	}
	if w != 40 || h != 30 {
		t.Fatalf("size %dx%d", w, h)
	}
	if bytes.Contains(out, []byte("GPS")) || bytes.Contains(out, []byte("Exif")) {
		t.Fatal("metadata survived cleaning")
	}
	if _, err := jpeg.Decode(bytes.NewReader(out)); err != nil {
		t.Fatalf("output is not a JPEG: %v", err)
	}
}

func TestCleanPNG(t *testing.T) {
	_, w, h, err := Clean(testPNG(t, 120, 80))
	if err != nil || w != 120 || h != 80 {
		t.Fatalf("%dx%d %v", w, h, err)
	}
}

func TestCleanRejects(t *testing.T) {
	if _, _, _, err := Clean([]byte("hello")); !errors.Is(err, ErrNotAnImage) {
		t.Fatalf("text: %v", err)
	}
	// header claims a huge image: refused before decoding a single pixel
	huge := testPNG(t, 1, 1)
	binary.BigEndian.PutUint32(huge[16:20], 20000)                           // IHDR width
	binary.BigEndian.PutUint32(huge[29:33], crc32.ChecksumIEEE(huge[12:29])) // fix the chunk CRC
	if _, _, _, err := Clean(huge); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("huge: %v", err)
	}
}

func TestReadLimited(t *testing.T) {
	if _, err := ReadLimited(bytes.NewReader(make([]byte, 11)), 10); err == nil {
		t.Fatal("want an error over the limit")
	}
	if b, err := ReadLimited(bytes.NewReader(make([]byte, 10)), 10); err != nil || len(b) != 10 {
		t.Fatal(err)
	}
}

func TestDir(t *testing.T) {
	d, err := NewDir(filepath.Join(t.TempDir(), "photos"))
	if err != nil {
		t.Fatal(err)
	}
	key := uuid.NewString() + ".jpg"
	if err := d.Save(key, []byte("x")); err != nil {
		t.Fatal(err)
	}
	f, err := d.Open(key)
	if err != nil {
		t.Fatal(err)
	}
	_ = f.Close()
	for _, bad := range []string{"../etc/passwd", "x.jpg", key + "/..", ""} {
		if _, err := d.Open(bad); !errors.Is(err, ErrBadKey) {
			t.Errorf("%q: %v", bad, err)
		}
	}
	if err := d.Remove(key); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(d.path, key)); !os.IsNotExist(err) {
		t.Fatal("not removed")
	}
}

// jpegWithOrientation builds a w×h JPEG (left half black, right half white) tagged with
// an EXIF orientation.
func jpegWithOrientation(t *testing.T, w, h int, orientation byte) []byte {
	t.Helper()
	img := image.NewGray(image.Rect(0, 0, w, h))
	for y := range h {
		for x := w / 2; x < w; x++ {
			img.SetGray(x, y, color.Gray{Y: 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 100}); err != nil {
		t.Fatal(err)
	}
	// TIFF (little endian) with one IFD0 entry: 0x0112 SHORT 1 = orientation
	tiff := []byte{'I', 'I', 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0}
	payload := append([]byte("Exif\x00\x00"), tiff...)
	seg := []byte{0xFF, 0xE1, 0, 0}
	binary.BigEndian.PutUint16(seg[2:], uint16(len(payload)+2)) //nolint:gosec // small constant payload
	seg = append(seg, payload...)
	b := buf.Bytes()
	return append(append(append([]byte{}, b[:2]...), seg...), b[2:]...)
}

func TestCleanTurnsPhoneJPEGsUpright(t *testing.T) {
	in := jpegWithOrientation(t, 40, 20, 6) // shown rotated 90° clockwise
	if got := jpegOrientation(in); got != 6 {
		t.Fatalf("orientation parsed as %d", got)
	}
	out, w, h, err := Clean(in)
	if err != nil {
		t.Fatal(err)
	}
	if w != 20 || h != 40 {
		t.Fatalf("size %dx%d, want 20x40 (upright)", w, h)
	}
	img, err := jpeg.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatal(err)
	}
	// left half (black) rotated clockwise ends up on top
	top, bottom := gray(img.At(10, 5)), gray(img.At(10, 35))
	if top > 60 || bottom < 200 {
		t.Fatalf("not rotated clockwise: top=%d bottom=%d", top, bottom)
	}
}

func TestCleanFlattensTransparencyOnWhite(t *testing.T) {
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewNRGBA(image.Rect(0, 0, 8, 8))); err != nil { // fully transparent
		t.Fatal(err)
	}
	out, _, _, err := Clean(buf.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	img, _ := jpeg.Decode(bytes.NewReader(out))
	if g := gray(img.At(4, 4)); g < 240 {
		t.Fatalf("transparent pixel became %d, want white", g)
	}
}

func gray(c color.Color) uint8 { return color.GrayModel.Convert(c).(color.Gray).Y }
