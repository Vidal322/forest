package httpapi

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"forest/internal/store"
)

func TestActivitiesAPI(t *testing.T) {
	h := newFieldRouter(t)
	if rec := upload(t, h, "Quinta", pngBytes(t, 300, 200)); rec.Code != 201 {
		t.Fatalf("setup: %d", rec.Code)
	}
	plotID, zoneID := uuid.NewString(), uuid.NewString()
	send(t, h, http.MethodPut, "/api/plots/"+plotID, `{"name":"P","geom":`+squareJSON+`}`)
	if rec := send(t, h, http.MethodPut, "/api/zones/"+zoneID, `{"plot_id":"`+plotID+`","geom":{"type":"Polygon","coordinates":[[[10,10],[30,10],[30,30],[10,30]]]}}`); rec.Code != 201 {
		t.Fatalf("zone: %d %s", rec.Code, rec.Body)
	}
	loc, _ := time.LoadLocation("Europe/Lisbon")
	today := time.Now().In(loc).Format(time.DateOnly)

	id := uuid.NewString()
	body := `{"type":"watering","performed_on":"` + today + `","zones":[{"zone_id":"` + zoneID + `"}]}`
	rec := send(t, h, http.MethodPut, "/api/activities/"+id, body)
	if rec.Code != 201 {
		t.Fatalf("create: %d %s", rec.Code, rec.Body)
	}
	var a store.Activity
	if err := json.NewDecoder(rec.Body).Decode(&a); err != nil || a.Version != 1 || a.Species == nil {
		t.Fatalf("body: %+v %v", a, err)
	}
	if rec = send(t, h, http.MethodPut, "/api/activities/"+id, body); rec.Code != 200 {
		t.Fatalf("retry: %d", rec.Code)
	}

	// stale edit → 409 with the current copy
	stale := `{"type":"watering","performed_on":"` + today + `","notes":"x","base_version":7,"zones":[{"zone_id":"` + zoneID + `"}]}`
	rec = send(t, h, http.MethodPut, "/api/activities/"+id, stale)
	var conflict struct {
		Error   struct{ Code string }
		Current store.Activity
	}
	if err := json.NewDecoder(rec.Body).Decode(&conflict); err != nil || rec.Code != 409 || conflict.Error.Code != "version_conflict" || conflict.Current.ID.String() != id {
		t.Fatalf("conflict: %d %+v %v", rec.Code, conflict, err)
	}

	rec = send(t, h, http.MethodGet, "/api/activities?zone_id="+zoneID, "")
	var list []store.Activity
	if err := json.NewDecoder(rec.Body).Decode(&list); err != nil || len(list) != 1 {
		t.Fatalf("list: %d %v", len(list), err)
	}
	rec = send(t, h, http.MethodGet, "/api/activities?plot_id="+plotID, "")
	if err := json.NewDecoder(rec.Body).Decode(&list); err != nil || len(list) != 1 {
		t.Fatalf("plot list: %d %v", len(list), err)
	}
	rec = send(t, h, http.MethodGet, "/api/activities?plot_id="+uuid.NewString(), "")
	if err := json.NewDecoder(rec.Body).Decode(&list); err != nil || len(list) != 0 {
		t.Fatalf("other plot list: %d %v", len(list), err)
	}
	for _, bad := range []string{"?zone_id=x", "?plot_id=x", "?since=yesterday", "?limit=0"} {
		if rec := send(t, h, http.MethodGet, "/api/activities"+bad, ""); rec.Code != 400 {
			t.Errorf("%s: %d", bad, rec.Code)
		}
	}
	if rec = send(t, h, http.MethodDelete, "/api/activities/"+id, ""); rec.Code != 204 {
		t.Fatalf("delete: %d", rec.Code)
	}
	if rec = send(t, h, http.MethodPut, "/api/activities/"+id, body); rec.Code != 410 {
		t.Fatalf("put after delete: %d", rec.Code)
	}
}
