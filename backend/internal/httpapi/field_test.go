package httpapi

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5"

	"forest/internal/dbtest"
	"forest/internal/photo"
	"forest/internal/store"
)

// newFieldRouter: a router on a test transaction where any real field is hidden,
// with a temporary photo directory.
func newFieldRouter(t *testing.T) http.Handler {
	t.Helper()
	h, _ := newFieldRouterTx(t)
	return h
}

// newFieldRouterTx is newFieldRouter that also returns its transaction, for tests
// that look at rows the API does not expose.
func newFieldRouterTx(t *testing.T) (http.Handler, pgx.Tx) {
	t.Helper()
	tx := dbtest.Tx(t)
	if _, err := tx.Exec(t.Context(), `UPDATE field SET deleted_at = now() WHERE deleted_at IS NULL`); err != nil {
		t.Fatal(err)
	}
	photos, err := photo.NewDir(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return NewRouter(Deps{Log: slog.New(slog.DiscardHandler), Store: store.New(tx), Photos: photos}), tx
}

func pngBytes(t *testing.T, w, h int) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, w, h))); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func upload(t *testing.T, h http.Handler, name string, file []byte) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	_ = mw.WriteField("name", name)
	if file != nil {
		fw, _ := mw.CreateFormFile("photo", "field.png")
		_, _ = fw.Write(file)
	}
	_ = mw.Close()
	req := httptest.NewRequest(http.MethodPost, "/api/field", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestFieldSetupFlow(t *testing.T) {
	h := newFieldRouter(t)

	if rec := send(t, h, http.MethodGet, "/api/field", ""); rec.Code != 404 {
		t.Fatalf("before setup: %d", rec.Code)
	} else if code, _ := decodeFieldError(t, rec); code != "no_field" {
		t.Fatalf("code %q", code)
	}

	rec := upload(t, h, "Quinta", pngBytes(t, 320, 240))
	if rec.Code != http.StatusCreated {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body)
	}
	var f store.Field
	if err := json.NewDecoder(rec.Body).Decode(&f); err != nil {
		t.Fatal(err)
	}
	if f.Name != "Quinta" || f.FrameWidth != 320 || f.FrameHeight != 240 || f.Photo == nil {
		t.Fatalf("field: %+v", f)
	}

	img := send(t, h, http.MethodGet, "/api/photos/"+f.Photo.Key, "")
	if img.Code != 200 || img.Header().Get("Content-Type") != "image/jpeg" ||
		img.Header().Get("Cache-Control") != "public, max-age=31536000, immutable" {
		t.Fatalf("photo: %d %v", img.Code, img.Header())
	}
	if _, err := (func() (image.Image, error) { i, _, err := image.Decode(img.Body); return i, err })(); err != nil {
		t.Fatalf("photo is not an image: %v", err)
	}

	if rec := upload(t, h, "Again", pngBytes(t, 10, 10)); rec.Code != http.StatusConflict {
		t.Fatalf("second setup: %d", rec.Code)
	} else if code, _ := decodeFieldError(t, rec); code != "field_exists" {
		t.Fatalf("second setup code %q", code)
	}

	// PUT replaces everything: a missing interval is an error, not a silent reset
	if rec := send(t, h, http.MethodPut, "/api/field", `{"name":"Quinta"}`); rec.Code != 422 {
		t.Fatalf("partial PUT: %d", rec.Code)
	}

	rec = send(t, h, http.MethodPut, "/api/field",
		`{"name":"Quinta do Vale","calibration_line":{"type":"LineString","coordinates":[[0,0],[300,400]]},"calibration_length_m":100,"default_water_interval_days":5}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("update: %d %s", rec.Code, rec.Body)
	}
	if err := json.NewDecoder(rec.Body).Decode(&f); err != nil || f.MetresPerUnit == nil || *f.MetresPerUnit != 0.2 {
		t.Fatalf("calibrated field: %+v %v", f, err)
	}
}

func TestFieldUploadErrors(t *testing.T) {
	h := newFieldRouter(t)
	cases := []struct {
		name   string
		file   []byte
		status int
		code   string
	}{
		{"no photo", nil, 422, "invalid"},
		{"not an image", []byte("hello"), 422, "not_an_image"},
	}
	for _, c := range cases {
		rec := upload(t, h, "Quinta", c.file)
		if code, field := decodeFieldError(t, rec); rec.Code != c.status || code != c.code || field != "photo" {
			t.Errorf("%s: %d %s %s", c.name, rec.Code, code, field)
		}
	}
	if rec := upload(t, h, " ", pngBytes(t, 10, 10)); rec.Code != 422 {
		t.Errorf("blank name: %d", rec.Code)
	}
	rec := send(t, h, http.MethodPost, "/api/field", `{"name":"x"}`)
	if code, _ := decodeFieldError(t, rec); rec.Code != 400 || code != "bad_upload" {
		t.Errorf("json instead of multipart: %d %s", rec.Code, code)
	}
	for _, key := range []string{"nope.jpg", "..%2F..%2Fetc%2Fpasswd"} {
		if rec := send(t, h, http.MethodGet, "/api/photos/"+key, ""); rec.Code != 404 {
			t.Errorf("photo %q: %d", key, rec.Code)
		}
	}
}
