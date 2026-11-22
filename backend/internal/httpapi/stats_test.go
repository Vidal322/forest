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
