package httpapi

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"forest/internal/store"
)

func TestStatsAndWateringRulesAPI(t *testing.T) {
	h := newFieldRouter(t)
	if rec := upload(t, h, "Quinta", pngBytes(t, 300, 200)); rec.Code != 201 {
		t.Fatalf("setup: %d", rec.Code)
	}
	send(t, h, http.MethodPut, "/api/plots/"+uuid.NewString(), `{"name":"P","geom":`+squareJSON+`}`)
	rec := send(t, h, http.MethodGet, "/api/plot-stats", "")
	var stats []store.PlotStats
	if err := json.NewDecoder(rec.Body).Decode(&stats); err != nil || rec.Code != 200 || len(stats) != 1 || stats[0].Name != "P" {
		t.Fatalf("stats: %d %+v %v", rec.Code, stats, err)
	}
	spID := uuid.NewString()
	send(t, h, http.MethodPut, "/api/species/"+spID, `{"scientific_name":"Test Stats Quercus"}`)
	rec = send(t, h, http.MethodGet, "/api/species-stats", "")
	var spStats []store.SpeciesStats
	if err := json.NewDecoder(rec.Body).Decode(&spStats); err != nil || rec.Code != 200 {
		t.Fatalf("species stats: %d %v", rec.Code, err)
	}
	found := false
	for _, st := range spStats {
		found = found || (st.SpeciesID.String() == spID && st.ZoneCount == 0 && st.LastSownOn == nil)
	}
	if !found {
		t.Fatalf("new species missing from species stats: %+v", spStats)
	}

	id := uuid.NewString()
	if rec = send(t, h, http.MethodPut, "/api/watering-rules/"+id, `{"name":"Summer","from_month":6,"to_month":9,"interval_days":4}`); rec.Code != 201 {
		t.Fatalf("rule: %d %s", rec.Code, rec.Body)
	}
	if rec = send(t, h, http.MethodPut, "/api/watering-rules/"+uuid.NewString(), `{"name":"July","from_month":7,"to_month":7,"interval_days":2}`); rec.Code != 201 {
		t.Fatalf("rule 2: %d", rec.Code)
	}
	var r store.WateringRule
	if err := json.NewDecoder(rec.Body).Decode(&r); err != nil || len(r.OverlapsWith) != 1 || r.OverlapsWith[0].String() != id {
		t.Fatalf("overlap warning: %+v %v", r, err)
	}
	if rec = send(t, h, http.MethodPut, "/api/watering-rules/"+uuid.NewString(), `{"name":"x","from_month":0,"to_month":2,"interval_days":4}`); rec.Code != 422 {
		t.Fatalf("bad month: %d", rec.Code)
	}
	if rec = send(t, h, http.MethodDelete, "/api/watering-rules/"+id, ""); rec.Code != 204 {
		t.Fatalf("delete: %d", rec.Code)
	}
}

func TestPlantedStatsAPI(t *testing.T) {
	h := newFieldRouter(t)
	if rec := upload(t, h, "Quinta", pngBytes(t, 300, 200)); rec.Code != 201 {
		t.Fatalf("setup: %d", rec.Code)
	}
	plotID := uuid.NewString()
	send(t, h, http.MethodPut, "/api/plots/"+plotID, `{"name":"Planted P","geom":`+squareJSON+`}`)
	rec := send(t, h, http.MethodGet, "/api/planted-stats?from=2026-09-01&to=2026-09-30", "")
	var st store.PlantedStats
	if err := json.NewDecoder(rec.Body).Decode(&st); err != nil || rec.Code != 200 || st.From != "2026-09-01" || st.To != "2026-09-30" ||
		len(st.Plots) != 1 || st.Plots[0].PlotID.String() != plotID || st.Plots[0].HolesSown != 0 || st.Species == nil {
		t.Fatalf("planted stats: %d %+v %v", rec.Code, st, err)
	}
	for _, q := range []string{"", "?from=2026-09-01", "?from=2026-09-30&to=2026-09-01", "?from=1%20Sep&to=2026-09-30"} {
		if rec := send(t, h, http.MethodGet, "/api/planted-stats"+q, ""); rec.Code != 422 {
			t.Errorf("%q: %d %s", q, rec.Code, rec.Body)
		}
	}
}
