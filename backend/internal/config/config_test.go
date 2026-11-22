package config

import (
	"log/slog"
	"testing"
	"time"
)

const testDB = "postgres://localhost:5433/forest"

// env returns a getenv over m, with DATABASE_URL set unless m sets it (even to "").
func env(m map[string]string) func(string) string {
	return func(k string) string {
		if v, ok := m[k]; ok {
			return v
		}
		if k == "DATABASE_URL" {
			return testDB
		}
		return ""
	}
}

func TestLoadDefaults(t *testing.T) {
	cfg, err := load(env(nil))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.HTTPAddr != ":8080" || cfg.LogLevel != slog.LevelInfo || cfg.ShutdownTimeout != 10*time.Second || cfg.DatabaseURL != testDB {
		t.Fatalf("unexpected defaults: %+v", cfg)
	}
}

func TestLoadOverrides(t *testing.T) {
	cfg, err := load(env(map[string]string{
		"FOREST_HTTP_ADDR":        "127.0.0.1:9000",
		"FOREST_LOG_LEVEL":        "debug",
		"FOREST_SHUTDOWN_TIMEOUT": "3s",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.HTTPAddr != "127.0.0.1:9000" || cfg.LogLevel != slog.LevelDebug || cfg.ShutdownTimeout != 3*time.Second {
		t.Fatalf("overrides not applied: %+v", cfg)
	}
}

func TestLoadRejectsBadValues(t *testing.T) {
	for name, m := range map[string]map[string]string{
		"bad level":        {"FOREST_LOG_LEVEL": "loud"},
		"bad duration":     {"FOREST_SHUTDOWN_TIMEOUT": "soon"},
		"negative timeout": {"FOREST_SHUTDOWN_TIMEOUT": "-1s"},
		"no database":      {"DATABASE_URL": ""},
	} {
		if _, err := load(env(m)); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

func TestLoadLevelIsCaseInsensitive(t *testing.T) {
	for in, want := range map[string]slog.Level{"WARN": slog.LevelWarn, "Error": slog.LevelError, "info": slog.LevelInfo} {
		cfg, err := load(env(map[string]string{"FOREST_LOG_LEVEL": in}))
		if err != nil || cfg.LogLevel != want {
			t.Errorf("%q: got %v, %v; want %v", in, cfg.LogLevel, err, want)
		}
	}
}
