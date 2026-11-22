package httpapi

import (
	"bytes"
	"encoding/json"
	"math"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"forest/internal/store"
)

func uploadAligned(t *testing.T, h http.Handler, file []byte, alignment string) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, _ := mw.CreateFormFile("photo", "new.png")
	_, _ = fw.Write(file)
	_ = mw.WriteField("alignment", alignment)
	_ = mw.WriteField("captured_on", "2026-06-01")
	_ = mw.Close()
	req := httptest.NewRequest(http.MethodPost, "/api/field/photos", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestNewerPhotoIsAlignedToTheFrame(t *testing.T) {
	h := newFieldRouter(t)
	rec := upload(t, h, "Quinta", pngBytes(t, 300, 200))
	var f store.Field
	_ = json.NewDecoder(rec.Body).Decode(&f)
	first := f.Photo.ID

	// the newer photo has half the resolution: frame = 2 × photo
	alignment := `[{"photo":[10,10],"frame":[20,20]},{"photo":[140,10],"frame":[280,20]},{"photo":[10,90],"frame":[20,180]},{"photo":[140,90],"frame":[280,180]}]`
	rec = uploadAligned(t, h, pngBytes(t, 150, 100), alignment)
	if rec.Code != http.StatusCreated {
		t.Fatalf("add photo: %d %s", rec.Code, rec.Body)
	}
	var p store.PhotoInfo
	if err := json.NewDecoder(rec.Body).Decode(&p); err != nil || !p.IsCurrent || p.Width != 150 || p.CapturedOn == nil || *p.CapturedOn != "2026-06-01" {
		t.Fatalf("photo: %+v %v", p, err)
	}
	want := [6]float64{2, 0, 0, 0, 2, 0}
	for i := range want {
		if math.Abs(p.AffineToFrame[i]-want[i]) > 1e-6 {
			t.Fatalf("affine %v, want %v", p.AffineToFrame, want)
		}
	}

	// the field shows the new photo, with the same frame
	rec = send(t, h, http.MethodGet, "/api/field", "")
	_ = json.NewDecoder(rec.Body).Decode(&f)
	if f.Photo.ID != p.ID || f.FrameWidth != 300 {
		t.Fatalf("field: %+v", f)
	}
	rec = send(t, h, http.MethodGet, "/api/field/photos", "")
	var list []store.PhotoInfo
	if err := json.NewDecoder(rec.Body).Decode(&list); err != nil || len(list) != 2 {
		t.Fatalf("list: %d %v", len(list), err)
	}
	// back to the first photo
	if rec = send(t, h, http.MethodPut, "/api/field/photos/"+first.String()+"/current", ""); rec.Code != 200 {
		t.Fatalf("switch: %d %s", rec.Code, rec.Body)
	}
	rec = send(t, h, http.MethodGet, "/api/field", "")
	_ = json.NewDecoder(rec.Body).Decode(&f)
	if f.Photo.ID != first {
		t.Fatalf("current after switch: %v", f.Photo.ID)
	}

	// landmarks on one line, or off the photo, are refused
	for _, bad := range []string{
		`[{"photo":[0,0],"frame":[0,0]},{"photo":[10,10],"frame":[10,10]},{"photo":[20,20],"frame":[20,20]}]`,
		`[{"photo":[0,0],"frame":[0,0]},{"photo":[999,10],"frame":[10,10]},{"photo":[20,80],"frame":[20,20]}]`,
		`nope`,
		`[{"photo":[0,0]},{"photo":[100,0],"frame":[100,0]},{"photo":[0,90],"frame":[0,90]}]`,
	} {
		if rec = uploadAligned(t, h, pngBytes(t, 150, 100), bad); rec.Code != 422 {
			t.Errorf("%s: %d", bad, rec.Code)
		}
	}
}

func TestSetCurrentUnknownPhoto(t *testing.T) {
	h := newFieldRouter(t)
	upload(t, h, "Quinta", pngBytes(t, 300, 200))
	if rec := send(t, h, http.MethodPut, "/api/field/photos/7d1a8c3e-0000-4000-8000-000000000000/current", ""); rec.Code != 404 {
		t.Fatalf("unknown photo: %d", rec.Code)
	}
}
