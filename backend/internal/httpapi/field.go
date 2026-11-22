package httpapi

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"forest/internal/photo"
	"forest/internal/store"
)

// maxPhotoBytes caps a photo upload (satellite screenshots are a few MB).
const maxPhotoBytes = 30 << 20

func (h *handlers) getField(w http.ResponseWriter, r *http.Request) {
	f, err := h.store.GetField(r.Context())
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "no_field", "the field is not set up yet")
		return
	}
	if err != nil {
		writeStoreError(w, r, h.log, err)
		return
	}
	writeJSON(w, http.StatusOK, f)
}

// slowTransfer: photo uploads and downloads over a weak mobile link can take minutes.
const slowTransfer = 5 * time.Minute

// POST /api/field (multipart: name, photo): set up the field from its first photo.
func (h *handlers) createField(w http.ResponseWriter, r *http.Request) {
	// Refuse a second setup before reading (and decoding) a large upload for nothing.
	if _, err := h.store.GetField(r.Context()); err == nil {
		writeError(w, http.StatusConflict, "field_exists", "the field is already set up")
		return
	} else if !errors.Is(err, store.ErrNotFound) {
		writeStoreError(w, r, h.log, err)
		return
	}
	rc := http.NewResponseController(w)
	_ = rc.SetReadDeadline(time.Now().Add(slowTransfer))
	_ = rc.SetWriteDeadline(time.Now().Add(slowTransfer))

	name, data, ok := h.readPhotoUpload(w, r)
	if !ok {
		return
	}
	if strings.TrimSpace(name) == "" {
		writeFieldError(w, http.StatusUnprocessableEntity, "invalid", "name", "is required")
		return
	}
	clean, width, height, err := photo.Clean(data)
	if err != nil {
		h.writePhotoError(w, r, err)
		return
	}
	key := uuid.NewString() + ".jpg"
	if err := h.photos.Save(key, clean); err != nil {
		writeStoreError(w, r, h.log, err)
		return
	}
	// Not cancelled by a client that hangs up mid-commit: otherwise the row could be
	// committed while we delete the photo it points to.
	f, err := h.store.CreateField(context.WithoutCancel(r.Context()), name, key, width, height)
	if err != nil {
		_ = h.photos.Remove(key) // don't leave an orphan file behind
		if errors.Is(err, store.ErrFieldExists) {
			writeError(w, http.StatusConflict, "field_exists", "the field is already set up")
			return
		}
		writeStoreError(w, r, h.log, err)
		return
	}
	writeJSON(w, http.StatusCreated, f)
}

// readPhotoUpload streams a multipart body with a "name" text part and a "photo" file part.
func (h *handlers) readPhotoUpload(w http.ResponseWriter, r *http.Request) (name string, data []byte, ok bool) {
	r.Body = http.MaxBytesReader(w, r.Body, maxPhotoBytes+64<<10)
	mr, err := r.MultipartReader()
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_upload", "expected a multipart/form-data upload")
		return "", nil, false
	}
	for {
		part, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			h.writeUploadReadError(w, err)
			return "", nil, false
		}
		switch part.FormName() {
		case "name":
			b, err := photo.ReadLimited(part, 1000)
			if errors.Is(err, photo.ErrFileTooLarge) {
				writeFieldError(w, http.StatusUnprocessableEntity, "invalid", "name", "is too long")
				return "", nil, false
			}
			if err != nil {
				h.writeUploadReadError(w, err)
				return "", nil, false
			}
			name = strings.TrimSpace(string(b))
		case "photo":
			data, err = photo.ReadLimited(part, maxPhotoBytes)
			if err != nil {
				h.writeUploadReadError(w, err)
				return "", nil, false
			}
		}
		_ = part.Close()
	}
	if data == nil {
		writeFieldError(w, http.StatusUnprocessableEntity, "invalid", "photo", "choose a photo to upload")
		return "", nil, false
	}
	return name, data, true
}

func (h *handlers) writeUploadReadError(w http.ResponseWriter, err error) {
	var tooBig *http.MaxBytesError
	if errors.As(err, &tooBig) || errors.Is(err, photo.ErrFileTooLarge) {
		writeFieldError(w, http.StatusRequestEntityTooLarge, "too_large", "photo", "the photo is larger than 30 MB")
		return
	}
	writeError(w, http.StatusBadRequest, "bad_upload", "could not read the upload")
}

func (h *handlers) writePhotoError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, photo.ErrNotAnImage):
		writeFieldError(w, http.StatusUnprocessableEntity, "not_an_image", "photo", err.Error())
	case errors.Is(err, photo.ErrTooLarge):
		writeFieldError(w, http.StatusUnprocessableEntity, "too_large", "photo", err.Error())
	default:
		writeStoreError(w, r, h.log, err)
	}
}

func (h *handlers) updateField(w http.ResponseWriter, r *http.Request) {
	var in store.FieldInput
	if !decodeJSON(w, r, &in) {
		return
	}
	f, err := h.store.UpdateField(r.Context(), in)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "no_field", "the field is not set up yet")
		return
	}
	if err != nil {
		writeStoreError(w, r, h.log, err)
		return
	}
	writeJSON(w, http.StatusOK, f)
}

// GET /api/photos/{key}: photos never change under a key, so they cache forever
// (the service worker keeps them for offline use).
func (h *handlers) getPhoto(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "key")
	f, err := h.photos.Open(key)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "no such photo")
		return
	}
	defer func() { _ = f.Close() }()
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(slowTransfer))
	st, err := f.Stat()
	if err != nil {
		writeStoreError(w, r, h.log, err)
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	http.ServeContent(w, r, key, st.ModTime(), f)
}
