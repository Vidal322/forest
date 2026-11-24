package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"

	"forest/internal/store"
)

// GET /api/activities?zone_id=…&plot_id=…&since=YYYY-MM-DD&limit=N — newest first.
func (h *handlers) listActivities(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	var f store.ActivityFilter
	if v := q.Get("zone_id"); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			writeError(w, http.StatusBadRequest, "bad_id", "zone_id must be a UUID")
			return
		}
		f.ZoneID = &id
	}
	if v := q.Get("plot_id"); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			writeError(w, http.StatusBadRequest, "bad_id", "plot_id must be a UUID")
			return
		}
		f.PlotID = &id
	}
	if v := q.Get("since"); v != "" {
		if _, err := time.Parse(time.DateOnly, v); err != nil {
			writeError(w, http.StatusBadRequest, "bad_query", "since must be YYYY-MM-DD")
			return
		}
		f.Since = &v
	}
	if v := q.Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			writeError(w, http.StatusBadRequest, "bad_query", "limit must be a positive number")
			return
		}
		f.Limit = n
	}
	list, err := h.store.ListActivities(r.Context(), f)
	if err != nil {
		writeStoreError(w, r, h.log, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// conflictBody is a version conflict: the error plus the server's current copy,
// so the app can show "yours" and "theirs" side by side.
type conflictBody struct {
	errorBody
	Current store.Activity `json:"current"`
}

func (h *handlers) putActivity(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r)
	if !ok {
		return
	}
	var in store.ActivityInput
	if !decodeJSON(w, r, &in) {
		return
	}
	a, created, err := h.store.PutActivity(r.Context(), id, in)
	var vc *store.VersionConflictError
	if errors.As(err, &vc) {
		var b conflictBody
		b.Error.Code = "version_conflict"
		b.Error.Message = "this entry was changed since your edit started"
		b.Current = vc.Current
		writeJSON(w, http.StatusConflict, b)
		return
	}
	if err != nil {
		writeStoreError(w, r, h.log, err)
		return
	}
	writeJSON(w, putStatus(created), a)
}
