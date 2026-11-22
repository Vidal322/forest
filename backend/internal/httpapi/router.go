// Package httpapi wires the HTTP routes of the Forest API.
package httpapi

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"forest/internal/store"
)

// Deps are the shared dependencies handlers need. It grows as slices are
// added (database pool, storage, …) without changing NewRouter's signature.
type Deps struct {
	Log   *slog.Logger
	Store *store.Store // nil only in tests that don't touch the database
}

// NewRouter returns the root handler with shared middleware and all routes.
func NewRouter(d Deps) http.Handler {
	r := chi.NewRouter()
	r.Use(requestID) // first: everything after can log the id
	r.Use(requestLogger(d.Log))
	r.Use(recoverer(d.Log)) // inside the logger, so panics are logged as 500s
	r.Use(secureHeaders)

	r.NotFound(func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusNotFound, "not_found", "no such endpoint")
	})
	r.MethodNotAllowed(func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed for this endpoint")
	})

	// Liveness: the process is up.
	r.Get("/healthz", health)
	r.Head("/healthz", health)

	if d.Store != nil {
		h := &handlers{log: d.Log, store: d.Store}
		// Readiness: the database answers too.
		r.Get("/readyz", h.ready)
		r.Route("/api", func(r chi.Router) {
			r.Get("/species", h.listSpecies)
			r.Put("/species/{id}", h.putSpecies)
			r.Delete("/species/{id}", h.deleteSpecies)
		})
	}

	return r
}

func health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
