package httpapi

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestStaticAppServesTheBuiltFrontend(t *testing.T) {
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html>app</html>"), 0o600)
	_ = os.MkdirAll(filepath.Join(dir, "assets"), 0o750)
	_ = os.WriteFile(filepath.Join(dir, "assets", "index-abc.js"), []byte("js"), 0o600)
	h := NewRouter(Deps{Log: slog.New(slog.DiscardHandler), StaticDir: dir})

	get := func(p string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, p, nil))
		return rec
	}
	if rec := get("/zones/abc"); rec.Code != 200 || rec.Body.String() != "<html>app</html>" || rec.Header().Get("Cache-Control") != "no-cache" {
		t.Fatalf("app route: %d %q %v", rec.Code, rec.Body, rec.Header())
	}
	if rec := get("/assets/index-abc.js"); rec.Code != 200 || rec.Header().Get("Cache-Control") != "public, max-age=31536000, immutable" {
		t.Fatalf("asset: %d %v", rec.Code, rec.Header())
	}
	if rec := get("/api/nope"); rec.Code != 404 || rec.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("unknown API path must stay a JSON 404: %d", rec.Code)
	}
	if rec := get("/../../etc/passwd"); rec.Body.String() != "<html>app</html>" {
		t.Fatalf("path traversal: %q", rec.Body)
	}
}
