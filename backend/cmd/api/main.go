// Command api runs the Forest HTTP API.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"forest/internal/config"
	"forest/internal/httpapi"
)

func main() {
	if err := run(); err != nil {
		slog.Error("api stopped", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.LogLevel}))
	slog.SetDefault(log)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	ln, err := (&net.ListenConfig{}).Listen(ctx, "tcp", cfg.HTTPAddr)
	if err != nil {
		return err
	}
	log.Info("listening", "addr", ln.Addr().String())

	handler := httpapi.NewRouter(httpapi.Deps{Log: log})
	// After the first signal, stop catching signals so a second Ctrl-C kills the process.
	go func() { <-ctx.Done(); stop() }()
	return serve(ctx, ln, handler, cfg.ShutdownTimeout, log)
}

// serve runs handler on ln until ctx is cancelled, then shuts down gracefully:
// in-flight requests get up to timeout to finish, after which connections are closed.
func serve(ctx context.Context, ln net.Listener, handler http.Handler, timeout time.Duration, log *slog.Logger) error {
	// Handlers see this context cancelled when shutdown starts (useful for long syncs).
	baseCtx, cancelBase := context.WithCancel(context.Background())
	defer cancelBase()

	srv := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
		BaseContext:       func(net.Listener) context.Context { return baseCtx },
		ErrorLog:          slog.NewLogLogger(log.Handler(), slog.LevelWarn),
	}

	errCh := make(chan error, 1)
	go func() { errCh <- srv.Serve(ln) }()

	select {
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
	}

	log.Info("shutting down", "timeout", timeout.String())
	shutdownCtx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	err := srv.Shutdown(shutdownCtx)
	cancelBase()
	if err != nil {
		_ = srv.Close() // deadline hit: drop the remaining connections
		return err
	}
	return nil
}
