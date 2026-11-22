package httpapi

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"forest/internal/store"
)

func TestTasksAPI(t *testing.T) {
	h := newFieldRouter(t)
	if rec := upload(t, h, "Quinta", pngBytes(t, 300, 200)); rec.Code != 201 {
		t.Fatalf("setup: %d", rec.Code)
	}
	plotID := uuid.NewString()
	send(t, h, http.MethodPut, "/api/plots/"+plotID, `{"name":"P","geom":`+squareJSON+`}`)

	id := uuid.NewString()
	rec := send(t, h, http.MethodPut, "/api/tasks/"+id, `{"plot_id":"`+plotID+`","title":"Melhorar caminho","kind":"improve_path"}`)
	if rec.Code != 201 {
		t.Fatalf("create: %d %s", rec.Code, rec.Body)
	}
	rec = send(t, h, http.MethodPut, "/api/tasks/"+id, `{"plot_id":"`+plotID+`","title":"Melhorar caminho","kind":"improve_path","status":"done","base_version":9}`)
	var conflict struct {
		Error   struct{ Code string }
		Current store.Task
	}
	if err := json.NewDecoder(rec.Body).Decode(&conflict); err != nil || rec.Code != 409 || conflict.Current.Status != "open" {
		t.Fatalf("conflict: %d %+v %v", rec.Code, conflict, err)
	}
	rec = send(t, h, http.MethodGet, "/api/tasks?open=1&plot_id="+plotID, "")
	var list []store.Task
	if err := json.NewDecoder(rec.Body).Decode(&list); err != nil || len(list) != 1 {
		t.Fatalf("list: %d %v", len(list), err)
	}
	if rec = send(t, h, http.MethodGet, "/api/tasks?zone_id=nope", ""); rec.Code != 400 {
		t.Fatalf("bad id: %d", rec.Code)
	}
	if rec = send(t, h, http.MethodDelete, "/api/tasks/"+id, ""); rec.Code != 204 {
		t.Fatalf("delete: %d", rec.Code)
	}
}
