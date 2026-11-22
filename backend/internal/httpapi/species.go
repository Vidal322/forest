package httpapi

import (
	"net/http"

	"forest/internal/store"
)

func (h *handlers) listSpecies(w http.ResponseWriter, r *http.Request) {
	list, err := h.store.ListSpecies(r.Context())
	if err != nil {
		writeStoreError(w, r, h.log, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// PUT /api/species/{id}: create or replace, with an id chosen by the client.
func (h *handlers) putSpecies(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r)
	if !ok {
		return
	}
	var in store.SpeciesInput
	if !decodeJSON(w, r, &in) {
		return
	}
	sp, created, err := h.store.PutSpecies(r.Context(), id, in)
	if err != nil {
		writeStoreError(w, r, h.log, err)
		return
	}
	writeJSON(w, putStatus(created), sp)
}

func (h *handlers) deleteSpecies(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r)
	if !ok {
		return
	}
	if err := h.store.DeleteSpecies(r.Context(), id); err != nil {
		writeStoreError(w, r, h.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
