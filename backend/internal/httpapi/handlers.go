package httpapi

import (
	"log/slog"
	"net/http"

	"forest/internal/store"
)

type handlers struct {
	log   *slog.Logger
	store *store.Store
}

func (h *handlers) ready(w http.ResponseWriter, r *http.Request) {
	if err := h.store.Ping(r.Context()); err != nil {
		h.log.WarnContext(r.Context(), "not ready", "err", err)
		writeError(w, http.StatusServiceUnavailable, "db_unavailable", "database not reachable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// putStatus is 201 for a create and 200 for an update of an existing id.
func putStatus(created bool) int {
	if created {
		return http.StatusCreated
	}
	return http.StatusOK
}
