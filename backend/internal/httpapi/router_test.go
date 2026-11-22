package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

func newTestRouter(logOut io.Writer) http.Handler {
	if logOut == nil {
		logOut = io.Discard
	}
	return NewRouter(Deps{Log: slog.New(slog.NewJSONHandler(logOut, &slog.HandlerOptions{Level: slog.LevelDebug}))})
}

func do(t *testing.T, h http.Handler, method, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(method, path, nil))
	return rec
}

func decodeError(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var b errorBody
	if err := json.NewDecoder(rec.Body).Decode(&b); err != nil {
		t.Fatalf("body is not the JSON error shape: %v", err)
	}
	return b.Error.Code
}

func TestHealthz(t *testing.T) {
	rec := do(t, newTestRouter(nil), http.MethodGet, "/healthz")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("content-type = %q", ct)
	}
	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil || body["status"] != "ok" {
		t.Fatalf("body = %v, err = %v", body, err)
	}
}

func TestHealthzHead(t *testing.T) {
	if rec := do(t, newTestRouter(nil), http.MethodHead, "/healthz"); rec.Code != http.StatusOK {
		t.Fatalf("HEAD status = %d, want 200", rec.Code)
	}
}

func TestUnknownRouteIsJSON404(t *testing.T) {
	rec := do(t, newTestRouter(nil), http.MethodGet, "/nope")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	if code := decodeError(t, rec); code != "not_found" {
		t.Fatalf("error code = %q", code)
	}
}

func TestWrongMethodIsJSON405(t *testing.T) {
	rec := do(t, newTestRouter(nil), http.MethodPost, "/healthz")
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", rec.Code)
	}
	if code := decodeError(t, rec); code != "method_not_allowed" {
		t.Fatalf("error code = %q", code)
	}
}

func TestResponseHeaders(t *testing.T) {
	rec := do(t, newTestRouter(nil), http.MethodGet, "/healthz")
	if id := rec.Header().Get("X-Request-Id"); len(id) != 16 {
		t.Fatalf("X-Request-Id = %q, want 16 hex chars", id)
	}
	if rec.Header().Get("X-Content-Type-Options") != "nosniff" || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("missing security headers: %v", rec.Header())
	}
}

func TestClientRequestIDIsIgnored(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	req.Header.Set("X-Request-Id", "spoofed")
	rec := httptest.NewRecorder()
	newTestRouter(nil).ServeHTTP(rec, req)
	if rec.Header().Get("X-Request-Id") == "spoofed" {
		t.Fatal("client-supplied request id must not be trusted")
	}
}

func TestRequestLogLine(t *testing.T) {
	var buf bytes.Buffer
	rec := do(t, newTestRouter(&buf), http.MethodGet, "/nope")

	var line map[string]any
	if err := json.Unmarshal(buf.Bytes(), &line); err != nil {
		t.Fatalf("log is not one JSON line: %q", buf.String())
	}
	if line["msg"] != "request" || line["level"] != "WARN" || line["status"] != float64(404) || line["path"] != "/nope" {
		t.Fatalf("unexpected log line: %v", line)
	}
	if line["request_id"] != rec.Header().Get("X-Request-Id") {
		t.Fatalf("log request_id %v != response header %q", line["request_id"], rec.Header().Get("X-Request-Id"))
	}
}

func TestPanicBecomesJSON500AndIsLogged(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewJSONHandler(&buf, nil))
	h := requestID(requestLogger(log)(recoverer(log)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("boom")
	}))))

	rec := do(t, h, http.MethodGet, "/x")
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	if code := decodeError(t, rec); code != "internal" {
		t.Fatalf("error code = %q", code)
	}
	if !bytes.Contains(buf.Bytes(), []byte(`"msg":"panic"`)) || !bytes.Contains(buf.Bytes(), []byte(`"status":500`)) {
		t.Fatalf("panic not logged as expected: %s", buf.String())
	}
}
