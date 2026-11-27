package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"math"
	"net/http"
	"os"
	"slices"
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
		writeError(w, http.StatusNotFound, "no_field", "o terreno ainda não está configurado")
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
		writeError(w, http.StatusConflict, "field_exists", "o terreno já está configurado")
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
		writeFieldError(w, http.StatusUnprocessableEntity, "invalid", "name", "é obrigatório")
		return
	}
	clean, err := photo.Clean(data)
	if err != nil {
		h.writePhotoError(w, r, err)
		return
	}
	width, height := clean.Width, clean.Height
	key, ok := h.savePhoto(w, r, clean)
	if !ok {
		return
	}
	// Not cancelled by a client that hangs up mid-commit: otherwise the row could be
	// committed while we delete the photo it points to.
	f, err := h.store.CreateField(context.WithoutCancel(r.Context()), name, key, width, height)
	if err != nil {
		_ = h.photos.Remove(key) // don't leave an orphan file behind
		if errors.Is(err, store.ErrFieldExists) {
			writeError(w, http.StatusConflict, "field_exists", "o terreno já está configurado")
			return
		}
		writeStoreError(w, r, h.log, err)
		return
	}
	writeJSON(w, http.StatusCreated, f)
}

// savePhoto stores a cleaned photo and its display copy under a new key.
func (h *handlers) savePhoto(w http.ResponseWriter, r *http.Request, clean photo.Cleaned) (key string, ok bool) {
	key = uuid.NewString() + ".jpg"
	err := h.photos.Save(key, clean.JPEG)
	if err == nil && clean.Display != nil {
		err = h.photos.SaveDisplay(key, clean.Display)
	}
	if err != nil {
		_ = h.photos.Remove(key)
		writeStoreError(w, r, h.log, err)
		return "", false
	}
	return key, true
}

// readPhotoUpload streams a multipart body with a "name" text part and a "photo" file part.
func (h *handlers) readPhotoUpload(w http.ResponseWriter, r *http.Request) (name string, data []byte, ok bool) {
	fields, data, ok := h.readUpload(w, r, "name")
	return fields["name"], data, ok
}

// readUpload streams a multipart body: the named small text parts and a "photo" file part.
func (h *handlers) readUpload(w http.ResponseWriter, r *http.Request, textParts ...string) (fields map[string]string, data []byte, ok bool) {
	fields = map[string]string{}
	r.Body = http.MaxBytesReader(w, r.Body, maxPhotoBytes+64<<10)
	mr, err := r.MultipartReader()
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_upload", "o envio tem de ser multipart/form-data")
		return nil, nil, false
	}
	for {
		part, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			h.writeUploadReadError(w, err)
			return nil, nil, false
		}
		switch name := part.FormName(); {
		case name == "photo":
			data, err = photo.ReadLimited(part, maxPhotoBytes)
			if err != nil {
				h.writeUploadReadError(w, err)
				return nil, nil, false
			}
		case slices.Contains(textParts, name):
			b, err := photo.ReadLimited(part, 64<<10)
			if errors.Is(err, photo.ErrFileTooLarge) {
				writeFieldError(w, http.StatusUnprocessableEntity, "invalid", name, longText(name))
				return nil, nil, false
			}
			if err != nil {
				h.writeUploadReadError(w, err)
				return nil, nil, false
			}
			fields[name] = strings.TrimSpace(string(b))
		}
		_ = part.Close()
	}
	if data == nil {
		writeFieldError(w, http.StatusUnprocessableEntity, "invalid", "photo", "está em falta")
		return nil, nil, false
	}
	return fields, data, true
}

// longText: an upload's text part over the limit ("Os pontos de referência" are plural).
func longText(name string) string {
	if name == "alignment" {
		return "têm texto a mais"
	}
	return "tem texto a mais"
}

func (h *handlers) writeUploadReadError(w http.ResponseWriter, err error) {
	var tooBig *http.MaxBytesError
	if errors.As(err, &tooBig) || errors.Is(err, photo.ErrFileTooLarge) {
		writeFieldError(w, http.StatusRequestEntityTooLarge, "too_large", "photo", "tem mais de 30 MB")
		return
	}
	writeError(w, http.StatusBadRequest, "bad_upload", "não foi possível ler o envio")
}

func (h *handlers) writePhotoError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, photo.ErrNotAnImage):
		writeFieldError(w, http.StatusUnprocessableEntity, "not_an_image", "photo", "não é uma imagem PNG, JPEG ou WebP")
	case errors.Is(err, photo.ErrTooLarge):
		writeFieldError(w, http.StatusUnprocessableEntity, "too_large", "photo", fmt.Sprintf("tem mais de %d píxeis por lado ou %d megapíxeis", photo.MaxSide, photo.MaxPixels/1_000_000))
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
		writeError(w, http.StatusNotFound, "no_field", "o terreno ainda não está configurado")
		return
	}
	if err != nil {
		writeStoreError(w, r, h.log, err)
		return
	}
	writeJSON(w, http.StatusOK, f)
}

// GET /api/photos/{key}: the photo as uploaded (cleaned), for calibration and alignment.
// Photos never change under a key, so they cache forever (the service worker keeps
// them for offline use).
func (h *handlers) getPhoto(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "key")
	f, err := h.photos.Open(key)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "esta fotografia não existe")
		return
	}
	h.servePhoto(w, r, key, f)
}

// GET /api/photos/{key}/display: the copy the map shows, at most photo.DisplaySide px
// on its longest side (the photo itself when it is smaller).
func (h *handlers) getDisplayPhoto(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "key")
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(slowTransfer))
	f, err := h.photos.OpenDisplay(key)
	if errors.Is(err, photo.ErrBadKey) || errors.Is(err, fs.ErrNotExist) {
		writeError(w, http.StatusNotFound, "not_found", "esta fotografia não existe")
		return
	}
	if err != nil {
		writeStoreError(w, r, h.log, err)
		return
	}
	h.servePhoto(w, r, key, f)
}

func (h *handlers) servePhoto(w http.ResponseWriter, r *http.Request, key string, f *os.File) {
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

// POST /api/field/photos (multipart: photo, alignment = JSON [{photo:[x,y], frame:[x,y]}…],
// captured_on optional): add a newer photo, aligned to the frame, as the current one.
func (h *handlers) addPhoto(w http.ResponseWriter, r *http.Request) {
	if _, err := h.store.GetField(r.Context()); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusConflict, "no_field", "configura primeiro o terreno")
		return
	} else if err != nil {
		writeStoreError(w, r, h.log, err)
		return
	}
	rc := http.NewResponseController(w)
	_ = rc.SetReadDeadline(time.Now().Add(slowTransfer))
	_ = rc.SetWriteDeadline(time.Now().Add(slowTransfer))

	fields, data, ok := h.readUpload(w, r, "alignment", "captured_on")
	if !ok {
		return
	}
	// cheap checks first: decoding a photo is slow
	var in store.AlignmentInput
	if err := json.Unmarshal([]byte(fields["alignment"]), &in); err != nil {
		writeFieldError(w, http.StatusUnprocessableEntity, "invalid", "alignment", "não vieram como uma lista de pares de pontos")
		return
	}
	pairs, err := store.CheckAlignment(in)
	if err != nil {
		writeStoreError(w, r, h.log, err)
		return
	}
	var captured *string
	if v := fields["captured_on"]; v != "" {
		captured = &v
	}
	if err := store.CheckCapturedOn(captured); err != nil {
		writeStoreError(w, r, h.log, err)
		return
	}
	clean, err := photo.Clean(data)
	if err != nil {
		h.writePhotoError(w, r, err)
		return
	}
	width, height := clean.Width, clean.Height
	// landmarks were tapped on the photo as the browser showed it: upright, same size
	if err := store.CheckLandmarksOnPhoto(pairs, width, height); err != nil {
		writeStoreError(w, r, h.log, err)
		return
	}
	affine, residual, err := photo.FitAffine(pairs, math.Hypot(float64(width), float64(height)))
	if err != nil {
		msg := "têm de ser pelo menos 3, espalhados pela fotografia e não em linha"
		switch {
		case errors.Is(err, photo.ErrMirrored):
			msg = "parecem trocados entre as duas fotografias: marca-os pela mesma ordem"
		case errors.Is(err, photo.ErrDistorted):
			msg = "não encaixam: confirma que cada ponto é o mesmo sítio nas duas fotografias"
		}
		writeFieldError(w, http.StatusUnprocessableEntity, "invalid", "alignment", msg)
		return
	}
	key, ok := h.savePhoto(w, r, clean)
	if !ok {
		return
	}
	p, err := h.store.AddPhoto(context.WithoutCancel(r.Context()), store.NewPhoto{
		Key: key, Width: width, Height: height, Affine: affine, Points: pairs, Residual: residual, CapturedOn: captured,
	})
	if err != nil {
		_ = h.photos.Remove(key)
		writeStoreError(w, r, h.log, err)
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

// PUT /api/field/photos/{id}/current
func (h *handlers) setCurrentPhoto(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r)
	if !ok {
		return
	}
	p, err := h.store.SetCurrentPhoto(r.Context(), id)
	if err != nil {
		writeStoreError(w, r, h.log, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}
