package httpapi

import "net/http"

// GET /api/planted-stats?from=YYYY-MM-DD&to=YYYY-MM-DD: covas sown and trees planted in that
// range (both days included), per plot and per species.
func (h *handlers) plantedStats(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	st, err := h.store.GetPlantedStats(r.Context(), q.Get("from"), q.Get("to"))
	if err != nil {
		writeStoreError(w, r, h.log, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}
