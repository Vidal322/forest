// Package httpapi wires the HTTP routes of the Forest API.
package httpapi

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"forest/internal/photo"
	"forest/internal/store"
)

// Deps are the shared dependencies handlers need. It grows as slices are
// added (database pool, storage, …) without changing NewRouter's signature.
type Deps struct {
	Log    *slog.Logger
	Store  *store.Store // nil only in tests that don't touch the database
	Photos *photo.Dir   // where field photos are kept
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
		if d.Photos == nil {
			panic("httpapi: Deps.Photos is required with a Store")
		}
		h := &handlers{log: d.Log, store: d.Store, photos: d.Photos}
		// Readiness: the database answers too.
		r.Get("/readyz", h.ready)
		r.Route("/api", func(r chi.Router) {
			r.Get("/species", h.listSpecies)
			r.Put("/species/{id}", h.putSpecies)
			r.Delete("/species/{id}", h.deleteSpecies)

			r.Get("/field", h.getField)
			r.Post("/field", h.createField)
			r.Put("/field", h.updateField)
			r.Get("/photos/{key}", h.getPhoto)

			listPlots, putPlot, deletePlot := h.plotRoutes()
			r.Get("/plots", listPlots)
			r.Put("/plots/{id}", putPlot)
			r.Delete("/plots/{id}", deletePlot)

			listZones, putZone, deleteZone := h.zoneRoutes()
			r.Get("/zones", listZones)
			r.Put("/zones/{id}", putZone)
			r.Delete("/zones/{id}", deleteZone)

			r.Get("/activities", h.listActivities)
			r.Put("/activities/{id}", h.putActivity)
			r.Delete("/activities/{id}", deleteHandler(h, h.store.DeleteActivity))
		})
	}

	return r
}

func health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
