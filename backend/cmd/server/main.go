// Command server runs the FlowBoard API: a kanban backend with JWT auth,
// SQLite persistence and Server-Sent Events for realtime board updates.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/flowboard/flowboard/backend/internal/api"
	"github.com/flowboard/flowboard/backend/internal/auth"
	"github.com/flowboard/flowboard/backend/internal/config"
	"github.com/flowboard/flowboard/backend/internal/realtime"
	"github.com/flowboard/flowboard/backend/internal/seed"
	"github.com/flowboard/flowboard/backend/internal/store"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "fatal: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	logger := newLogger(cfg)
	slog.SetDefault(logger)

	logger.Info("starting FlowBoard",
		"version", api.Version,
		"commit", api.Commit,
		"go", runtime.Version(),
		"config", cfg.Redacted(),
	)

	// Signal-aware root context: SIGINT/SIGTERM start a graceful shutdown.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	db, err := store.Open(ctx, store.Options{Path: cfg.DatabasePath, MaxOpenConns: 4})
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer db.Close()

	if cfg.SeedDemo {
		if err := seed.EnsureDemo(ctx, db, logger); err != nil {
			return fmt.Errorf("seed demo workspace: %w", err)
		}
	}

	tokens, err := auth.NewTokenIssuer(cfg.JWTSecret, cfg.AccessTTL)
	if err != nil {
		return fmt.Errorf("configure token issuer: %w", err)
	}

	hub := realtime.NewHub()
	defer hub.Close()

	server := api.New(api.Options{
		Store:  db,
		Tokens: tokens,
		Hub:    hub,
		Config: cfg,
		Logger: logger,
	})

	// WriteTimeout is deliberately zero: it would sever SSE streams.
	httpServer := &http.Server{
		Addr:              cfg.Addr,
		Handler:           server.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      0,
		IdleTimeout:       2 * time.Minute,
		MaxHeaderBytes:    1 << 20,
		ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelWarn),
	}

	maintenance := startMaintenance(ctx, db, hub, logger)
	defer maintenance()

	serveErr := make(chan error, 1)
	go func() {
		logger.Info("http server listening", "addr", cfg.Addr)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErr <- fmt.Errorf("listen: %w", err)
			return
		}
		serveErr <- nil
	}()

	select {
	case err := <-serveErr:
		return err
	case <-ctx.Done():
		logger.Info("shutdown signal received", "grace", cfg.ShutdownGrace.String())
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownGrace)
	defer cancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("graceful shutdown: %w", err)
	}
	logger.Info("shutdown complete")
	return nil
}

// startMaintenance runs periodic housekeeping and returns a stop function.
func startMaintenance(ctx context.Context, db *store.Store, hub *realtime.Hub, logger *slog.Logger) func() {
	ticker := time.NewTicker(30 * time.Minute)
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				purgeCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
				removed, err := db.PurgeExpiredTokens(purgeCtx)
				cancel()
				if err != nil {
					logger.Warn("purge expired refresh tokens", "error", err)
					continue
				}
				boards, subscribers := hub.Counts()
				logger.Info("maintenance complete",
					"expiredTokensRemoved", removed,
					"activeBoards", boards,
					"eventSubscribers", subscribers,
				)
			}
		}
	}()
	return func() {
		ticker.Stop()
		<-done
	}
}

// newLogger builds the process logger: JSON in production for log shipping,
// human-readable text locally.
func newLogger(cfg config.Config) *slog.Logger {
	level := slog.LevelInfo
	if v := strings.TrimSpace(os.Getenv("FLOWBOARD_LOG_LEVEL")); v != "" {
		var parsed slog.Level
		if err := parsed.UnmarshalText([]byte(v)); err == nil {
			level = parsed
		}
	}
	opts := &slog.HandlerOptions{Level: level}
	if cfg.IsProduction() {
		return slog.New(slog.NewJSONHandler(os.Stdout, opts))
	}
	return slog.New(slog.NewTextHandler(os.Stdout, opts))
}
