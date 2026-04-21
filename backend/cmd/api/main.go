package main

import (
	"fmt"
	"github.com/Vidal322/forest/internal/config"
	"github.com/Vidal322/forest/internal/db"
	"github.com/joho/godotenv"
	"log"
	"net/http"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Fatal("Error loading .env file")
	}
	cfg := config.Load()
	conn, err := db.New(cfg)
	if err != nil {
		log.Fatal(err)
	}
	defer conn.Close()

	if err := db.RunMigrations(conn); err != nil {
		log.Fatal(err)
	}

	http.HandleFunc("/", handler)
	log.Fatal(http.ListenAndServe(":"+cfg.ServerPort, nil))
}

func handler(w http.ResponseWriter, r *http.Request) {
	fmt.Fprint(w, "Hello, World!")
}
