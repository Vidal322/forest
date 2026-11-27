package httpapi

import (
	"mime"
	"net/http"
	"os"
	"path"
	"strings"
)

// staticApp serves the built PWA (frontend/dist) from the same origin as the API, so one
// HTTPS address is enough on a phone. Unknown paths get index.html (client-side routes).
// The service worker and index.html must never be cached, hashed assets forever.
func init() {
	// Go doesn't know the PWA manifest type; browsers want it for "Add to home screen"
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
}

func staticApp(dir string) http.Handler {
	files := http.FileServer(http.Dir(dir))
	root, rootErr := os.OpenRoot(dir) // lookups can't leave dir, whatever the path
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "método não permitido")
			return
		}
		clean := path.Clean("/" + r.URL.Path)
		var st os.FileInfo
		err := rootErr
		if err == nil {
			st, err = root.Stat(strings.TrimPrefix(clean, "/"))
		}
		if err != nil || st.IsDir() || clean == "/index.html" {
			// a route of the app (/tasks, /zones/…): the app itself handles it
			// (served directly: FileServer would redirect /index.html to /)
			w.Header().Set("Cache-Control", "no-cache")
			serveIndex(w, r, root, rootErr)
			return
		}
		switch {
		case strings.HasPrefix(clean, "/assets/"):
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		default:
			w.Header().Set("Cache-Control", "no-cache")
		}
		files.ServeHTTP(w, r)
	})
}

func serveIndex(w http.ResponseWriter, r *http.Request, root *os.Root, rootErr error) {
	if rootErr != nil {
		writeError(w, http.StatusNotFound, "not_found", "a aplicação não foi compilada")
		return
	}
	f, err := root.Open("index.html")
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "a aplicação não foi compilada")
		return
	}
	defer func() { _ = f.Close() }()
	st, err := f.Stat()
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "a aplicação não foi compilada")
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	http.ServeContent(w, r, "index.html", st.ModTime(), f)
}
