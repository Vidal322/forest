package main

import (
	"fmt"
	"github.com/Vidal322/forest/internal/config"
	"log"
	"net/http"
)

func main() {
	cfg := config.Load()
	http.HandleFunc("/", handler)
	log.Fatal(http.ListenAndServe(":"+cfg.ServerPort, nil))
}

func handler(w http.ResponseWriter, r *http.Request) {
	fmt.Fprint(w, "Hello, World!")
}
