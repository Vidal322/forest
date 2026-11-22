// Package config loads runtime settings from environment variables.
package config

import (
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"
)

// Config holds every setting the API needs. Values come from the environment
// so the same binary runs locally and in production.
type Config struct {
	HTTPAddr        string        // FOREST_HTTP_ADDR, default ":8080"
	LogLevel        slog.Level    // FOREST_LOG_LEVEL: debug|info|warn|error, default info
	ShutdownTimeout time.Duration // FOREST_SHUTDOWN_TIMEOUT, default 10s
	DatabaseURL     string        // DATABASE_URL, required
	DataDir         string        // FOREST_DATA_DIR, default "data": uploaded photos live in <dir>/photos
	StaticDir       string        // FOREST_STATIC_DIR: the built frontend to serve (optional)
}

// Load reads the configuration from the environment.
func Load() (Config, error) {
	return load(os.Getenv)
}

func load(getenv func(string) string) (Config, error) {
	cfg := Config{
		HTTPAddr:        ":8080",
		LogLevel:        slog.LevelInfo,
		ShutdownTimeout: 10 * time.Second,
		DataDir:         "data",
	}
	if v := getenv("FOREST_DATA_DIR"); v != "" {
		cfg.DataDir = v
	}
	cfg.StaticDir = getenv("FOREST_STATIC_DIR")

	if v := getenv("FOREST_HTTP_ADDR"); v != "" {
		cfg.HTTPAddr = v
	}

	if v := getenv("FOREST_LOG_LEVEL"); v != "" {
		if err := cfg.LogLevel.UnmarshalText([]byte(strings.ToUpper(v))); err != nil {
			return Config{}, fmt.Errorf("FOREST_LOG_LEVEL: %w", err)
		}
	}

	if v := getenv("FOREST_SHUTDOWN_TIMEOUT"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return Config{}, fmt.Errorf("FOREST_SHUTDOWN_TIMEOUT: %w", err)
		}
		if d <= 0 {
			return Config{}, fmt.Errorf("FOREST_SHUTDOWN_TIMEOUT: must be positive, got %s", d)
		}
		cfg.ShutdownTimeout = d
	}

	cfg.DatabaseURL = getenv("DATABASE_URL")
	if cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL is not set (cp .env.example .env)")
	}

	return cfg, nil
}
