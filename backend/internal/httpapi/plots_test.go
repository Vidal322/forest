package httpapi

import (
	"encoding/json"
	"net/http"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	"forest/internal/store"
)

const squareJSON = `{"type":"Polygon","coordinates":[[[0,0],[100,0],[100,100],[0,100],[0,0]]]}`

func TestPlotsAndZonesAPI(t *testing.T) {
	h := newFieldRouter(t)

	plotID := uuid.NewString()
	rec := send(t, h, http.MethodPut, "/api/plots/"+plotID, `{"name":"Plot 1","geom":`+squareJSON+`}`)
	if code, _ := decodeFieldError(t, rec); rec.Code != http.StatusConflict || code != "no_field" {
		t.Fatalf("before setup: %d %s", rec.Code, code)
	}

	if rec := upload(t, h, "Quinta", pngBytes(t, 300, 200)); rec.Code != http.StatusCreated {
		t.Fatalf("setup: %d", rec.Code)
	}
	if rec = send(t, h, http.MethodPut, "/api/plots/"+plotID, `{"name":"Plot 1","geom":`+squareJSON+`,"declared_area_ha":6.2}`); rec.Code != 201 {
		t.Fatalf("plot: %d %s", rec.Code, rec.Body)
	}

	zoneID := uuid.NewString()
	zone := `{"plot_id":"` + plotID + `","label":"Z1","kind":"cultivation","geom":{"type":"Polygon","coordinates":[[[10,10],[30,10],[30,30],[10,30]]]}}`
	if rec = send(t, h, http.MethodPut, "/api/zones/"+zoneID, zone); rec.Code != 201 {
		t.Fatalf("zone: %d %s", rec.Code, rec.Body)
	}
	var z store.Zone
	if err := json.NewDecoder(rec.Body).Decode(&z); err != nil || z.NeedsWater == nil || z.Geom.Coordinates[0][4] != (store.Point{10, 10}) {
		t.Fatalf("zone body: %+v %v", z, err)
	}

	rec = send(t, h, http.MethodGet, "/api/zones", "")
	var zones []store.Zone
	if err := json.NewDecoder(rec.Body).Decode(&zones); err != nil || len(zones) != 1 {
		t.Fatalf("zones: %d %v", len(zones), err)
	}

	outside := `{"plot_id":"` + plotID + `","geom":{"type":"Polygon","coordinates":[[[90,90],[150,90],[150,150],[90,150]]]}}`
	rec = send(t, h, http.MethodPut, "/api/zones/"+uuid.NewString(), outside)
	if code, field := decodeFieldError(t, rec); rec.Code != 422 || code != "invalid" || field != "geom" {
		t.Fatalf("outside: %d %s %s", rec.Code, code, field)
	}

	if rec = send(t, h, http.MethodDelete, "/api/plots/"+plotID, ""); rec.Code != 204 {
		t.Fatalf("delete plot: %d", rec.Code)
	}
	rec = send(t, h, http.MethodGet, "/api/zones", "")
	if err := json.NewDecoder(rec.Body).Decode(&zones); err != nil || len(zones) != 0 {
		t.Fatalf("zones after plot delete: %d %v", len(zones), err)
	}
}

func TestZonesAsOfAPI(t *testing.T) {
	h := newFieldRouter(t)
	if rec := upload(t, h, "Quinta", pngBytes(t, 300, 200)); rec.Code != http.StatusCreated {
		t.Fatalf("setup: %d", rec.Code)
	}
	plotID, zoneID := uuid.NewString(), uuid.NewString()
	send(t, h, http.MethodPut, "/api/plots/"+plotID, `{"name":"P","geom":`+squareJSON+`}`)
	if rec := send(t, h, http.MethodPut, "/api/zones/"+zoneID, `{"plot_id":"`+plotID+`","geom":{"type":"Polygon","coordinates":[[[10,10],[30,10],[30,30],[10,30]]]}}`); rec.Code != 201 {
		t.Fatalf("zone: %d %s", rec.Code, rec.Body)
	}
	loc, _ := time.LoadLocation("Europe/Lisbon")
	now := time.Now().In(loc)
	day := func(offset int) string { return now.AddDate(0, 0, offset).Format(time.DateOnly) }
	if rec := send(t, h, http.MethodPut, "/api/activities/"+uuid.NewString(),
		`{"type":"sowing","performed_on":"`+day(-3)+`","zones":[{"zone_id":"`+zoneID+`"}]}`); rec.Code != 201 {
		t.Fatalf("sowing: %d %s", rec.Code, rec.Body)
	}

	lastSown := func(query string) *string {
		t.Helper()
		rec := send(t, h, http.MethodGet, "/api/zones"+query, "")
		var zones []store.Zone
		if err := json.NewDecoder(rec.Body).Decode(&zones); rec.Code != 200 || err != nil || len(zones) != 1 {
			t.Fatalf("%s: %d %v %s", query, rec.Code, err, rec.Body)
		}
		return zones[0].LastSownOn
	}
	if s := lastSown(""); s == nil || *s != day(-3) {
		t.Fatalf("today: %v", s)
	}
	if s := lastSown("?as_of=" + day(-3)); s == nil || *s != day(-3) {
		t.Fatalf("day of sowing: %v", s)
	}
	if s := lastSown("?as_of=" + day(-4)); s != nil {
		t.Fatalf("before sowing: %v", *s)
	}
	for _, bad := range []string{day(3), "yesterday"} {
		rec := send(t, h, http.MethodGet, "/api/zones?as_of="+bad, "")
		if code, field := decodeFieldError(t, rec); rec.Code != 422 || code != "invalid" || field != "as_of" {
			t.Fatalf("%s: %d %s %s", bad, rec.Code, code, field)
		}
	}
}

func TestZoneCodesAPI(t *testing.T) {
	h := newFieldRouter(t)
	if rec := upload(t, h, "Quinta", pngBytes(t, 300, 200)); rec.Code != http.StatusCreated {
		t.Fatalf("setup: %d", rec.Code)
	}
	plotID := uuid.NewString()
	if rec := send(t, h, http.MethodPut, "/api/plots/"+plotID, `{"name":"Plot codes","geom":`+squareJSON+`}`); rec.Code != 201 {
		t.Fatalf("plot: %d %s", rec.Code, rec.Body)
	}
	body := `{"plot_id":"` + plotID + `","geom":{"type":"Polygon","coordinates":[[[10,10],[30,10],[30,30],[10,30]]]}}`
	put := func(id string, wantStatus int) string {
		t.Helper()
		rec := send(t, h, http.MethodPut, "/api/zones/"+id, body)
		var z store.Zone
		if err := json.NewDecoder(rec.Body).Decode(&z); rec.Code != wantStatus || err != nil {
			t.Fatalf("put zone: %d %v", rec.Code, err)
		}
		return z.Code
	}
	first, second := uuid.NewString(), uuid.NewString()
	if c := put(first, 201); c != "Z1" {
		t.Fatalf("first: %q", c)
	}
	if c := put(second, 201); c != "Z2" {
		t.Fatalf("second: %q", c)
	}
	if c := put(first, 200); c != "Z1" { // a repeated offline PUT keeps it
		t.Fatalf("same PUT: %q", c)
	}
	if rec := send(t, h, http.MethodDelete, "/api/zones/"+second, ""); rec.Code != 204 {
		t.Fatalf("delete: %d", rec.Code)
	}
	if c := put(uuid.NewString(), 201); c != "Z3" { // Z2 is not given out again
		t.Fatalf("after delete: %q", c)
	}

	// the client never sets it
	rec := send(t, h, http.MethodPut, "/api/zones/"+uuid.NewString(), `{"code":"Z9",`+body[1:])
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("client code: %d %s", rec.Code, rec.Body)
	}

	rec = send(t, h, http.MethodGet, "/api/zones", "")
	var zones []store.Zone
	if err := json.NewDecoder(rec.Body).Decode(&zones); err != nil {
		t.Fatal(err)
	}
	var codes []string
	for _, z := range zones {
		codes = append(codes, z.Code)
	}
	slices.Sort(codes) // one test transaction: every zone has the same created_at
	if !slices.Equal(codes, []string{"Z1", "Z3"}) {
		t.Fatalf("listed codes: %v", codes)
	}
}
