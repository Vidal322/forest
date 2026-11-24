// Package httpapi wires the HTTP routes of the Forest API.
package httpapi

import (
	"log/slog"
	"net/http"
	"strings"

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
	// StaticDir, if set, is the built frontend (frontend/dist), served for every non-API path.
	StaticDir string
}

// NewRouter returns the root handler with shared middleware and all routes.
func NewRouter(d Deps) http.Handler {
	r := chi.NewRouter()
	r.Use(requestID) // first: everything after can log the id
	r.Use(requestLogger(d.Log))
	r.Use(recoverer(d.Log)) // inside the logger, so panics are logged as 500s
	r.Use(secureHeaders)

	notFound := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusNotFound, "not_found", "no such endpoint")
	})
	r.NotFound(notFound)
	if d.StaticDir != "" {
		app := staticApp(d.StaticDir)
		r.NotFound(func(w http.ResponseWriter, req *http.Request) {
			if strings.HasPrefix(req.URL.Path, "/api/") {
				notFound(w, req)
				return
			}
			app.ServeHTTP(w, req)
		})
	}
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
			r.Get("/photos/{key}/display", h.getDisplayPhoto)
			r.Get("/field/photos", listHandler(h, h.store.ListPhotos))
			r.Post("/field/photos", h.addPhoto)
			r.Put("/field/photos/{id}/current", h.setCurrentPhoto)

			listPlots, putPlot, deletePlot := h.plotRoutes()
			r.Get("/plots", listPlots)
			r.Put("/plots/{id}", putPlot)
			r.Delete("/plots/{id}", deletePlot)

			listZones, putZone, deleteZone := h.zoneRoutes()
			r.Get("/zones", listZones)
			r.Put("/zones/{id}", putZone)
			r.Delete("/zones/{id}", deleteZone)
			r.Get("/tree-counts", listHandler(h, h.store.ListTreeCounts))
			r.Put("/zones/{id}/trees/{species_id}", h.putTreeCounts)

			r.Get("/activities", h.listActivities)
			r.Put("/activities/{id}", h.putActivity)
			r.Delete("/activities/{id}", deleteHandler(h, h.store.DeleteActivity))

			r.Get("/tasks", h.listTasks)
			r.Put("/tasks/{id}", h.putTask)
			r.Delete("/tasks/{id}", deleteHandler(h, h.store.DeleteTask))

			r.Get("/plot-stats", listHandler(h, h.store.ListPlotStats))
			r.Get("/species-stats", listHandler(h, h.store.ListSpeciesStats))
			r.Get("/planted-stats", h.plantedStats)

			r.Get("/export/activities.csv", h.exportActivitiesCSV)

			r.Get("/watering-rules", listHandler(h, h.store.ListWateringRules))
			r.Put("/watering-rules/{id}", putHandler(h, h.store.PutWateringRule))
			r.Delete("/watering-rules/{id}", deleteHandler(h, h.store.DeleteWateringRule))
		})
	}

	return r
}

func health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
