package httpapi

import (
	"context"
	"net/http"

	"github.com/google/uuid"

	"forest/internal/store"
)

// list, put and delete are the same three handlers for every client-keyed entity.

func listHandler[T any](h *handlers, list func(context.Context) ([]T, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		items, err := list(r.Context())
		if err != nil {
			writeStoreError(w, r, h.log, err)
			return
		}
		writeJSON(w, http.StatusOK, items)
	}
}

func putHandler[In, Out any](h *handlers, put func(context.Context, uuid.UUID, In) (Out, bool, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := idParam(w, r)
		if !ok {
			return
		}
		var in In
		if !decodeJSON(w, r, &in) {
			return
		}
		out, created, err := put(r.Context(), id, in)
		if err != nil {
			writeStoreError(w, r, h.log, err)
			return
		}
		writeJSON(w, putStatus(created), out)
	}
}

func deleteHandler(h *handlers, del func(context.Context, uuid.UUID) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := idParam(w, r)
		if !ok {
			return
		}
		if err := del(r.Context(), id); err != nil {
			writeStoreError(w, r, h.log, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (h *handlers) plotRoutes() (list, put, del http.HandlerFunc) {
	return listHandler(h, h.store.ListPlots), putHandler(h, h.store.PutPlot), deleteHandler(h, h.store.DeletePlot)
}

func (h *handlers) zoneRoutes() (list, put, del http.HandlerFunc) {
	return h.listZones, putHandler[store.ZoneInput](h, h.store.PutZone), deleteHandler(h, h.store.DeleteZone)
}

// GET /api/zones lists the zones with today's state; ?as_of=YYYY-MM-DD gives the
// state as it stood on that day (the map's "show state as of").
func (h *handlers) listZones(w http.ResponseWriter, r *http.Request) {
	day := r.URL.Query().Get("as_of")
	if day == "" {
		listHandler(h, h.store.ListZones)(w, r)
		return
	}
	listHandler(h, func(ctx context.Context) ([]store.Zone, error) { return h.store.ListZonesOn(ctx, day) })(w, r)
}
