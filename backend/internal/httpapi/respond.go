package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"forest/internal/store"
)

// errorBody is the single error shape every endpoint returns:
//
//	{"error": {"code": "not_found", "message": "…", "field": "scientific_name"}}
//
// `code` is stable and machine-readable (the frontend maps it to friendly text);
// `message` is a short English hint; `field` names the input at fault, if any.
type errorBody struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message,omitempty"`
		Field   string `json:"field,omitempty"`
	} `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	var b errorBody
	b.Error.Code = code
	b.Error.Message = message
	writeJSON(w, status, b)
}

func writeFieldError(w http.ResponseWriter, status int, code, field, message string) {
	var b errorBody
	b.Error.Code = code
	b.Error.Message = message
	b.Error.Field = field
	writeJSON(w, status, b)
}

// maxBody caps request bodies; JSON entries are small (photos use their own limit).
const maxBody = 1 << 20

// decodeJSON reads one JSON object into v, rejecting unknown fields and trailing data.
// On failure it has already written a 400 and returns false.
func decodeJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody))
	dec.DisallowUnknownFields()
	err := dec.Decode(v)
	if err == nil && dec.Decode(&struct{}{}) != io.EOF {
		err = errors.New("unexpected data after the JSON object")
	}
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeError(w, http.StatusRequestEntityTooLarge, "too_large", "request body too large")
			return false
		}
		writeError(w, http.StatusBadRequest, "bad_json", fmt.Sprintf("invalid JSON body: %v", err))
		return false
	}
	return true
}

// idParam parses the {id} URL parameter. On failure it has written a 400.
func idParam(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil || id == uuid.Nil {
		writeError(w, http.StatusBadRequest, "bad_id", "id must be a UUID")
		return uuid.Nil, false
	}
	return id, true
}

// writeStoreError maps store errors to HTTP responses; anything unknown is a logged 500.
func writeStoreError(w http.ResponseWriter, r *http.Request, log *slog.Logger, err error) {
	var ve *store.ValidationError
	var ce *store.ConflictError
	var pgErr *pgconn.PgError
	switch {
	case errors.Is(err, context.Canceled) && r.Context().Err() != nil:
		// The client went away (e.g. lost signal mid-request): nobody to answer, nothing to alarm about.
		log.DebugContext(r.Context(), "request cancelled", "request_id", RequestID(r.Context()))
		writeError(w, 499, "cancelled", "request cancelled")
	case errors.As(err, &ve):
		writeFieldError(w, http.StatusUnprocessableEntity, "invalid", ve.Field, ve.Message)
	case errors.As(err, &ce):
		writeFieldError(w, http.StatusConflict, "duplicate", ce.Field, ce.Message)
	case errors.Is(err, store.ErrNoField):
		writeError(w, http.StatusConflict, "no_field", "set up the field first")
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "no such entry")
	case errors.Is(err, store.ErrDeleted):
		writeError(w, http.StatusGone, "deleted", "this entry was deleted")
	case errors.Is(err, store.ErrVersionConflict):
		writeError(w, http.StatusConflict, "version_conflict", "changed since you loaded it")
	case errors.As(err, &pgErr) && isBadInput(pgErr.Code):
		// Input the store didn't catch but the database refused (bad characters, a CHECK,
		// an unknown referenced id): the client's data is wrong, not the server.
		log.WarnContext(r.Context(), "database rejected input", "code", pgErr.Code,
			"constraint", pgErr.ConstraintName, "detail", pgErr.Message, "request_id", RequestID(r.Context()))
		writeError(w, http.StatusUnprocessableEntity, "invalid", "the database rejected this value")
	default:
		log.ErrorContext(r.Context(), "store error", "err", err, "request_id", RequestID(r.Context()))
		writeError(w, http.StatusInternalServerError, "internal", "unexpected server error")
	}
}

// isBadInput: SQLSTATEs caused by the data sent, not by the server.
func isBadInput(code string) bool {
	switch code {
	case "22021", // invalid byte sequence (e.g. NUL in text)
		"22P02", // invalid text representation
		"22023", // invalid parameter value (e.g. malformed GeoJSON)
		"22003", // numeric value out of range
		"23502", // not-null violation
		"23503", // foreign key violation (unknown referenced id)
		"23514": // check violation
		return true
	}
	return false
}
