package httpapi

import (
	"encoding/json"
	"net/http"
	"testing"

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
