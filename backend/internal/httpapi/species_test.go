package httpapi

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"forest/internal/dbtest"
	"forest/internal/store"
)

// newDBRouter is a router backed by a rolled-back transaction.
func newDBRouter(t *testing.T) http.Handler {
	t.Helper()
	return NewRouter(Deps{Log: slog.New(slog.DiscardHandler), Store: store.New(dbtest.Tx(t))})
}

func send(t *testing.T, h http.Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var r io.Reader
	if body != "" {
		r = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, r)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func decodeFieldError(t *testing.T, rec *httptest.ResponseRecorder) (code, field string) {
	t.Helper()
	var b errorBody
	if err := json.NewDecoder(rec.Body).Decode(&b); err != nil {
		t.Fatalf("not the JSON error shape: %v", err)
	}
	return b.Error.Code, b.Error.Field
}

func TestSpeciesLifecycle(t *testing.T) {
	h := newDBRouter(t)
	id := uuid.NewString()
	name := dbtest.Name("Test Arbutus")

	rec := send(t, h, http.MethodPut, "/api/species/"+id, `{"scientific_name":"`+name+`","common_name":"medronheiro"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rec.Code, rec.Body)
	}
	var sp store.Species
	if err := json.NewDecoder(rec.Body).Decode(&sp); err != nil || sp.ID.String() != id || *sp.CommonName != "medronheiro" {
		t.Fatalf("create body: %+v %v", sp, err)
	}

	rec = send(t, h, http.MethodPut, "/api/species/"+id, `{"scientific_name":"`+name+`","common_name":"medronho"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("update: %d %s", rec.Code, rec.Body)
	}

	rec = send(t, h, http.MethodGet, "/api/species", "")
	var list []store.Species
	if err := json.NewDecoder(rec.Body).Decode(&list); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, s := range list {
		found = found || (s.ID.String() == id && *s.CommonName == "medronho")
	}
	if !found {
		t.Fatalf("updated species not listed: %+v", list)
	}

	if rec = send(t, h, http.MethodDelete, "/api/species/"+id, ""); rec.Code != http.StatusNoContent {
		t.Fatalf("delete: %d", rec.Code)
	}
	rec = send(t, h, http.MethodPut, "/api/species/"+id, `{"scientific_name":"`+name+`"}`)
	if code, _ := decodeFieldError(t, rec); rec.Code != http.StatusGone || code != "deleted" {
		t.Fatalf("edit after delete: %d %s", rec.Code, code)
	}
}

func TestSpeciesErrors(t *testing.T) {
	h := newDBRouter(t)
	cases := []struct {
		name, method, path, body string
		status                   int
		code, field              string
	}{
		{"bad id", http.MethodPut, "/api/species/nope", `{"scientific_name":"X"}`, 400, "bad_id", ""},
		{"nil id", http.MethodPut, "/api/species/" + uuid.Nil.String(), `{"scientific_name":"X"}`, 400, "bad_id", ""},
		{"bad json", http.MethodPut, "/api/species/" + uuid.NewString(), `{`, 400, "bad_json", ""},
		{"unknown field", http.MethodPut, "/api/species/" + uuid.NewString(), `{"scientific_name":"X","colour":"red"}`, 400, "bad_json", ""},
		{"trailing data", http.MethodPut, "/api/species/" + uuid.NewString(), `{"scientific_name":"X"} {}`, 400, "bad_json", ""},
		{"NUL byte", http.MethodPut, "/api/species/" + uuid.NewString(), `{"scientific_name":"Test nul\u0000x"}`, 422, "invalid", "scientific_name"},
		{"blank name", http.MethodPut, "/api/species/" + uuid.NewString(), `{"scientific_name":"  "}`, 422, "invalid", "scientific_name"},
		{"delete unknown", http.MethodDelete, "/api/species/" + uuid.NewString(), ``, 404, "not_found", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := send(t, h, c.method, c.path, c.body)
			code, field := decodeFieldError(t, rec)
			if rec.Code != c.status || code != c.code || field != c.field {
				t.Fatalf("got %d %q %q, want %d %q %q", rec.Code, code, field, c.status, c.code, c.field)
			}
		})
	}
}

func TestSpeciesDuplicateName(t *testing.T) {
	h := newDBRouter(t)
	name := dbtest.Name("Test Dup quercus")
	send(t, h, http.MethodPut, "/api/species/"+uuid.NewString(), `{"scientific_name":"`+name+`"}`)
	id := uuid.NewString()
	rec := send(t, h, http.MethodPut, "/api/species/"+id, `{"scientific_name":"`+strings.ToUpper(name)+`"}`)
	if code, field := decodeFieldError(t, rec); rec.Code != 409 || code != "duplicate" || field != "scientific_name" {
		t.Fatalf("got %d %s %s", rec.Code, code, field)
	}
	// fix the name and retry, like the app does
	if rec = send(t, h, http.MethodPut, "/api/species/"+id, `{"scientific_name":"`+name+` 2"}`); rec.Code != http.StatusCreated {
		t.Fatalf("retry: %d %s", rec.Code, rec.Body)
	}
}

func TestReadyz(t *testing.T) {
	if rec := send(t, newDBRouter(t), http.MethodGet, "/readyz", ""); rec.Code != http.StatusOK {
		t.Fatalf("readyz: %d", rec.Code)
	}
}
