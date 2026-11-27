package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"forest/internal/store"
)

// PUT /api/zones/{id}/trees/{species_id} {"alive": n, "dead": m}
func (h *handlers) putTreeCounts(w http.ResponseWriter, r *http.Request) {
	zoneID, ok := idParam(w, r)
	if !ok {
		return
	}
	speciesID, err := uuid.Parse(chi.URLParam(r, "species_id"))
	if err != nil || speciesID == uuid.Nil {
		writeError(w, http.StatusBadRequest, "bad_id", "o id da espécie tem de ser um UUID")
		return
	}
	var in store.TreeCountInput
	if !decodeJSON(w, r, &in) {
		return
	}
	c, err := h.store.SetTreeCounts(r.Context(), zoneID, speciesID, in)
	if err != nil {
		writeStoreError(w, r, h.log, err)
		return
	}
	writeJSON(w, http.StatusOK, c)
}
