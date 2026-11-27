package httpapi

import (
	"errors"
	"net/http"

	"github.com/google/uuid"

	"forest/internal/store"
)

// GET /api/tasks?open=1&zone_id=…&plot_id=…
func (h *handlers) listTasks(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f := store.TaskFilter{OpenOnly: q.Get("open") == "1" || q.Get("open") == "true"}
	for key, dst := range map[string]**uuid.UUID{"zone_id": &f.ZoneID, "plot_id": &f.PlotID} {
		if v := q.Get(key); v != "" {
			id, err := uuid.Parse(v)
			if err != nil {
				writeError(w, http.StatusBadRequest, "bad_id", key+" tem de ser um UUID")
				return
			}
			*dst = &id
		}
	}
	list, err := h.store.ListTasks(r.Context(), f)
	if err != nil {
		writeStoreError(w, r, h.log, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

type taskConflictBody struct {
	errorBody
	Current store.Task `json:"current"`
}

func (h *handlers) putTask(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r)
	if !ok {
		return
	}
	var in store.TaskInput
	if !decodeJSON(w, r, &in) {
		return
	}
	t, created, err := h.store.PutTask(r.Context(), id, in)
	var vc *store.TaskConflictError
	if errors.As(err, &vc) {
		var b taskConflictBody
		b.Error.Code = "version_conflict"
		b.Error.Message = "esta tarefa foi alterada depois de começares a editar"
		b.Current = vc.Current
		writeJSON(w, http.StatusConflict, b)
		return
	}
	if err != nil {
		writeStoreError(w, r, h.log, err)
		return
	}
	writeJSON(w, putStatus(created), t)
}
