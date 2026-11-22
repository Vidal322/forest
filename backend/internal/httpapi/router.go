// Package httpapi wires the HTTP routes of the Forest API.
package httpapi

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// Deps are the shared dependencies handlers need. It grows as slices are
// added (database pool, storage, …) without changing NewRouter's signature.
type Deps struct {
	Log *slog.Logger
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

	// Liveness: the process is up. (A /readyz that pings the database comes with the DB step.)
	r.Get("/healthz", health)
	r.Head("/healthz", health)

	return r
}

func health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
