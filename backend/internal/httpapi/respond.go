package httpapi

import (
	"encoding/json"
	"net/http"
)

// errorBody is the single error shape every endpoint returns:
//
//	{"error": {"code": "not_found", "message": "…"}}
//
// `code` is stable and machine-readable (the frontend maps it to friendly text);
// `message` is a short English hint for developers.
type errorBody struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message,omitempty"`
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
