package main

import (
	"context"
	"io"
	"log/slog"
	"net"
	"net/http"
	"testing"
	"time"
)

var quiet = slog.New(slog.DiscardHandler)

// An in-flight request finishes, then serve returns nil.
func TestServeGracefulShutdown(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{})
	handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(started)
		time.Sleep(200 * time.Millisecond)
		_, _ = io.WriteString(w, "done")
	})

	ctx, cancel := context.WithCancel(context.Background())
	served := make(chan error, 1)
	go func() { served <- serve(ctx, ln, handler, 2*time.Second, quiet) }()

	got := make(chan string, 1)
	go func() {
		res, err := http.Get("http://" + ln.Addr().String())
		if err != nil {
			got <- "error: " + err.Error()
			return
		}
		defer func() { _ = res.Body.Close() }()
		b, _ := io.ReadAll(res.Body)
		got <- string(b)
	}()

	<-started
	cancel() // shutdown begins while the request is still running

	if body := <-got; body != "done" {
		t.Fatalf("in-flight request: got %q, want %q", body, "done")
	}
	if err := <-served; err != nil {
		t.Fatalf("serve returned %v, want nil", err)
	}
}

// A request that outlives the timeout is cut off and serve reports the deadline.
func TestServeShutdownTimeout(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{})
	release := make(chan struct{})
	defer close(release)
	handler := http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		close(started)
		<-release
	})

	ctx, cancel := context.WithCancel(context.Background())
	served := make(chan error, 1)
	go func() { served <- serve(ctx, ln, handler, 50*time.Millisecond, quiet) }()
	go func() {
		if res, err := http.Get("http://" + ln.Addr().String()); err == nil {
			_ = res.Body.Close()
		}
	}()

	<-started
	cancel()
	select {
	case err := <-served:
		if err == nil {
			t.Fatal("expected a deadline error")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("serve did not return after the shutdown timeout")
	}
}
