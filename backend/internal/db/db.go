package db

import (
	"database/sql"
	"fmt"
	"github.com/Vidal322/forest/internal/config"
	_ "github.com/lib/pq"
)

func New(cfg config.Config) (*sql.DB, error) {

	var dsn = fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable", cfg.DBHost, cfg.DBPort, cfg.DBUser, cfg.DBPassword, cfg.DBName)

	var db *sql.DB

	db, err := sql.Open("postgres", dsn)

	if err != nil {
		return nil, err
	}

	if err := db.Ping(); err != nil {
		return nil, err
	}

	return db, nil
}
