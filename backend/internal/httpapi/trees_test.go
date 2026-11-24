package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"forest/internal/dbtest"
	"forest/internal/store"
)

// treeWorld: a field with one plot, one zone and one species, ready for counting.
type treeWorld struct {
	h                       http.Handler
	tx                      pgx.Tx
	plotID, zoneID, species string
}

func newTreeWorld(t *testing.T) treeWorld {
	t.Helper()
	h, tx := newFieldRouterTx(t)
	w := treeWorld{h: h, tx: tx, plotID: uuid.NewString(), zoneID: uuid.NewString(), species: uuid.NewString()}
	if rec := upload(t, h, "Quinta", pngBytes(t, 300, 200)); rec.Code != http.StatusCreated {
		t.Fatalf("field: %d %s", rec.Code, rec.Body)
	}
	w.mustPut(t, "/api/plots/"+w.plotID, `{"name":"`+dbtest.Name("Plot")+`","geom":`+squareJSON+`}`)
	w.mustPut(t, "/api/zones/"+w.zoneID, `{"plot_id":"`+w.plotID+`","geom":{"type":"Polygon","coordinates":[[[10,10],[30,10],[30,30],[10,30]]]}}`)
	w.mustPut(t, "/api/species/"+w.species, `{"scientific_name":"`+dbtest.Name("Test tree")+`"}`)
	return w
}

func (w treeWorld) mustPut(t *testing.T, path, body string) {
	t.Helper()
	if rec := send(t, w.h, http.MethodPut, path, body); rec.Code != http.StatusCreated {
		t.Fatalf("PUT %s: %d %s", path, rec.Code, rec.Body)
	}
}

func (w treeWorld) setCounts(t *testing.T, zoneID, speciesID, body string) *httptest.ResponseRecorder {
	t.Helper()
	return send(t, w.h, http.MethodPut, "/api/zones/"+zoneID+"/trees/"+speciesID, body)
}

// counts returns GET /api/tree-counts, checking every entry has exactly the documented keys.
func (w treeWorld) counts(t *testing.T) []store.TreeCount {
	t.Helper()
	rec := send(t, w.h, http.MethodGet, "/api/tree-counts", "")
	if rec.Code != http.StatusOK || !strings.HasPrefix(rec.Header().Get("Content-Type"), "application/json") {
		t.Fatalf("list: %d %q %s", rec.Code, rec.Header().Get("Content-Type"), rec.Body)
	}
	var raw []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil || raw == nil {
		t.Fatalf("list body is not a JSON array: %s %v", rec.Body, err)
	}
	for _, e := range raw {
		assertKeys(t, e)
	}
	var out []store.TreeCount
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return out
}

// count is the entry of one zone and species in the list (0/0 when absent).
func (w treeWorld) count(t *testing.T, zoneID, speciesID string) (alive, dead int, found bool) {
	t.Helper()
	for _, c := range w.counts(t) {
		if c.ZoneID.String() == zoneID && c.SpeciesID.String() == speciesID {
			return c.Alive, c.Dead, true
		}
	}
	return 0, 0, false
}

// rows fingerprints every tree row (deleted ones too) of the zone and species, so a
// no-op can be told apart from rows being removed and re-added.
func (w treeWorld) rows(t *testing.T, zoneID, speciesID string) string {
	t.Helper()
	var s string
	err := w.tx.QueryRow(t.Context(), `
		SELECT count(*) || ':' || coalesce(string_agg(id::text || status::text || (deleted_at IS NULL)::text, ',' ORDER BY id), '')
		  FROM tree WHERE zone_id = $1 AND species_id = $2`, zoneID, speciesID).Scan(&s)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func assertKeys(t *testing.T, e map[string]any) {
	t.Helper()
	keys := make([]string, 0, len(e))
	for k := range e {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	if want := []string{"alive", "dead", "species_id", "zone_id"}; !reflect.DeepEqual(keys, want) {
		t.Fatalf("keys %v, want %v", keys, want)
	}
}

func TestTreeCountsAPI(t *testing.T) {
	w := newTreeWorld(t)

	rec := w.setCounts(t, w.zoneID, w.species, `{"alive":5,"dead":1}`)
	if rec.Code != http.StatusOK || !strings.HasPrefix(rec.Header().Get("Content-Type"), "application/json") {
		t.Fatalf("set: %d %s", rec.Code, rec.Body)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	assertKeys(t, body)
	if body["zone_id"] != w.zoneID || body["species_id"] != w.species || body["alive"] != 5.0 || body["dead"] != 1.0 {
		t.Fatalf("set body: %v", body)
	}
	if a, d, ok := w.count(t, w.zoneID, w.species); !ok || a != 5 || d != 1 {
		t.Fatalf("listed: %d/%d %v", a, d, ok)
	}

	// The outbox retries: the same target again changes nothing, not even row ids.
	before := w.rows(t, w.zoneID, w.species)
	if !strings.HasPrefix(before, "6:") {
		t.Fatalf("rows after set: %s", before)
	}
	again := w.setCounts(t, w.zoneID, w.species, `{"alive":5,"dead":1}`)
	if again.Code != http.StatusOK || again.Body.String() != rec.Body.String() {
		t.Fatalf("same again: %d %s", again.Code, again.Body)
	}
	if after := w.rows(t, w.zoneID, w.species); after != before {
		t.Fatalf("same content rewrote rows:\n%s\n%s", before, after)
	}

	// One tree died: it is marked dead, not replaced by a new row.
	if rec = w.setCounts(t, w.zoneID, w.species, `{"alive":4,"dead":2}`); rec.Code != http.StatusOK {
		t.Fatalf("one died: %d %s", rec.Code, rec.Body)
	}
	if a, d, _ := w.count(t, w.zoneID, w.species); a != 4 || d != 2 {
		t.Fatalf("after a death: %d/%d", a, d)
	}
	if n := w.rows(t, w.zoneID, w.species); !strings.HasPrefix(n, "6:") {
		t.Fatalf("a death added or removed rows: %s", n)
	}

	// Zero both: the entry leaves the list.
	if rec = w.setCounts(t, w.zoneID, w.species, `{"alive":0,"dead":0}`); rec.Code != http.StatusOK {
		t.Fatalf("zero: %d %s", rec.Code, rec.Body)
	}
	if _, _, ok := w.count(t, w.zoneID, w.species); ok {
		t.Fatal("a zone with no trees of a species is still listed")
	}
}

func TestTreeCountsAPIRejectsBadInput(t *testing.T) {
	w := newTreeWorld(t)
	if rec := w.setCounts(t, w.zoneID, w.species, `{"alive":3,"dead":0}`); rec.Code != http.StatusOK {
		t.Fatalf("set: %d %s", rec.Code, rec.Body)
	}
	nilID := uuid.Nil.String()
	for _, c := range []struct {
		name, zone, species, body string
		status                    int
		code, field               string
	}{
		{"bad zone id", "nope", w.species, `{"alive":1}`, 400, "bad_id", ""},
		{"nil zone id", nilID, w.species, `{"alive":1}`, 400, "bad_id", ""},
		{"bad species id", w.zoneID, "nope", `{"alive":1}`, 400, "bad_id", ""},
		{"nil species id", w.zoneID, nilID, `{"alive":1}`, 400, "bad_id", ""},
		{"unknown zone", uuid.NewString(), w.species, `{"alive":1}`, 404, "not_found", ""},
		{"unknown species", w.zoneID, uuid.NewString(), `{"alive":1}`, 422, "invalid", "species_id"},
		{"negative alive", w.zoneID, w.species, `{"alive":-1,"dead":0}`, 422, "invalid", "alive"},
		{"negative dead", w.zoneID, w.species, `{"alive":1,"dead":-1}`, 422, "invalid", "dead"},
		{"too many", w.zoneID, w.species, `{"alive":10001,"dead":0}`, 422, "invalid", "alive"},
		{"fraction", w.zoneID, w.species, `{"alive":1.5,"dead":0}`, 400, "bad_json", ""},
		{"text count", w.zoneID, w.species, `{"alive":"1","dead":0}`, 400, "bad_json", ""},
		{"unknown key", w.zoneID, w.species, `{"alive":1,"dead":0,"removed":1}`, 400, "bad_json", ""},
		{"not JSON", w.zoneID, w.species, `alive=1`, 400, "bad_json", ""},
	} {
		t.Run(c.name, func(t *testing.T) {
			rec := w.setCounts(t, c.zone, c.species, c.body)
			if code, field := decodeFieldError(t, rec); rec.Code != c.status || code != c.code || field != c.field {
				t.Fatalf("%d %s %s, want %d %s %s", rec.Code, code, field, c.status, c.code, c.field)
			}
		})
	}
	if a, d, _ := w.count(t, w.zoneID, w.species); a != 3 || d != 0 {
		t.Fatalf("a rejected request changed the counts: %d/%d", a, d)
	}
}

func TestTreeCountsAPIDeletedTargets(t *testing.T) {
	w := newTreeWorld(t)
	other := uuid.NewString()
	w.mustPut(t, "/api/species/"+other, `{"scientific_name":"`+dbtest.Name("Test tree")+`"}`)
	for _, sp := range []string{w.species, other} {
		if rec := w.setCounts(t, w.zoneID, sp, `{"alive":2,"dead":1}`); rec.Code != http.StatusOK {
			t.Fatalf("set: %d %s", rec.Code, rec.Body)
		}
	}

	// A deleted species: no new counts, and its trees leave the list.
	if rec := send(t, w.h, http.MethodDelete, "/api/species/"+other, ""); rec.Code != http.StatusNoContent {
		t.Fatalf("delete species: %d", rec.Code)
	}
	rec := w.setCounts(t, w.zoneID, other, `{"alive":3,"dead":1}`)
	if code, field := decodeFieldError(t, rec); rec.Code != 422 || code != "invalid" || field != "species_id" {
		t.Fatalf("deleted species: %d %s %s", rec.Code, code, field)
	}
	if _, _, ok := w.count(t, w.zoneID, other); ok {
		t.Fatal("a deleted species is still listed")
	}
	if a, d, _ := w.count(t, w.zoneID, w.species); a != 2 || d != 1 {
		t.Fatalf("other species changed: %d/%d", a, d)
	}

	// A deleted zone: a late write is gone (410), and its counts leave the list.
	if rec = send(t, w.h, http.MethodDelete, "/api/zones/"+w.zoneID, ""); rec.Code != http.StatusNoContent {
		t.Fatalf("delete zone: %d", rec.Code)
	}
	rec = w.setCounts(t, w.zoneID, w.species, `{"alive":3,"dead":1}`)
	if code, _ := decodeFieldError(t, rec); rec.Code != http.StatusGone || code != "deleted" {
		t.Fatalf("deleted zone: %d %s", rec.Code, code)
	}
	if _, _, ok := w.count(t, w.zoneID, w.species); ok {
		t.Fatal("a deleted zone is still listed")
	}

	// A zone whose plot was deleted: gone too.
	plot2, zone2 := uuid.NewString(), uuid.NewString()
	w.mustPut(t, "/api/plots/"+plot2, `{"name":"`+dbtest.Name("Plot")+`","geom":{"type":"Polygon","coordinates":[[[150,0],[250,0],[250,100],[150,100],[150,0]]]}}`)
	w.mustPut(t, "/api/zones/"+zone2, `{"plot_id":"`+plot2+`","geom":{"type":"Polygon","coordinates":[[[160,10],[180,10],[180,30],[160,30]]]}}`)
	if rec = w.setCounts(t, zone2, w.species, `{"alive":1,"dead":0}`); rec.Code != http.StatusOK {
		t.Fatalf("set zone 2: %d %s", rec.Code, rec.Body)
	}
	if rec = send(t, w.h, http.MethodDelete, "/api/plots/"+plot2, ""); rec.Code != http.StatusNoContent {
		t.Fatalf("delete plot: %d", rec.Code)
	}
	rec = w.setCounts(t, zone2, w.species, `{"alive":2,"dead":0}`)
	if code, _ := decodeFieldError(t, rec); rec.Code != http.StatusGone || code != "deleted" {
		t.Fatalf("zone of a deleted plot: %d %s", rec.Code, code)
	}
	if _, _, ok := w.count(t, zone2, w.species); ok {
		t.Fatal("a zone of a deleted plot is still listed")
	}
}

func TestTreeCountsAPIEmptyListIsAnArray(t *testing.T) {
	w := newTreeWorld(t)
	if _, err := w.tx.Exec(t.Context(), `UPDATE tree SET deleted_at = now() WHERE deleted_at IS NULL`); err != nil {
		t.Fatal(err)
	}
	rec := send(t, w.h, http.MethodGet, "/api/tree-counts", "")
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != "[]" {
		t.Fatalf("empty list: %d %s", rec.Code, rec.Body)
	}
}
