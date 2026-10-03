// Package config loads runtime configuration from the environment.
//
// Every setting has a working default so the binary can be started with zero
// configuration for local development, while production deploys (see
// deploy/docker-compose.yml) override the security-relevant values.
package config

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config is the fully resolved application configuration.
type Config struct {
	// Env is "development" or "production".
	Env string
	// Addr is the TCP address the HTTP server listens on.
	Addr string
	// DatabasePath is the SQLite file path (or ":memory:").
	DatabasePath string
	// TrustedProxies enables interpretation of X-Forwarded-* headers.
	TrustedProxies bool

	JWTSecret  []byte
	AccessTTL  time.Duration
	RefreshTTL time.Duration

	// AllowedOrigins is the CORS allow-list. "*" allows any origin.
	AllowedOrigins []string

	// SeedDemo creates a demo account plus a sample board on first boot.
	SeedDemo bool

	// ShutdownGrace bounds in-flight request draining on SIGTERM.
	ShutdownGrace time.Duration
}

// IsProduction reports whether the server runs in production mode.
func (c Config) IsProduction() bool { return c.Env == "production" }

// Load reads configuration from the process environment.
func Load() (Config, error) {
	cfg := Config{
		Env:            env("FLOWBOARD_ENV", "development"),
		Addr:           env("FLOWBOARD_ADDR", ":8080"),
		DatabasePath:   env("FLOWBOARD_DB_PATH", "./data/flowboard.db"),
		TrustedProxies: envBool("FLOWBOARD_TRUSTED_PROXIES", true),
		AccessTTL:      envDuration("FLOWBOARD_ACCESS_TTL", 30*time.Minute),
		RefreshTTL:     envDuration("FLOWBOARD_REFRESH_TTL", 30*24*time.Hour),
		AllowedOrigins: envList("FLOWBOARD_ALLOWED_ORIGINS", []string{"http://localhost:5173", "http://localhost:8080"}),
		SeedDemo:       envBool("FLOWBOARD_SEED_DEMO", true),
		ShutdownGrace:  envDuration("FLOWBOARD_SHUTDOWN_GRACE", 15*time.Second),
	}

	secret := os.Getenv("FLOWBOARD_JWT_SECRET")
	switch {
	case secret != "":
		cfg.JWTSecret = []byte(secret)
	case cfg.IsProduction():
		return Config{}, fmt.Errorf("FLOWBOARD_JWT_SECRET must be set when FLOWBOARD_ENV=production")
	default:
		// Ephemeral secret: tokens do not survive a restart, which is exactly the
		// behaviour we want for throwaway local runs.
		buf := make([]byte, 32)
		if _, err := rand.Read(buf); err != nil {
			return Config{}, fmt.Errorf("generate ephemeral jwt secret: %w", err)
		}
		cfg.JWTSecret = []byte(hex.EncodeToString(buf))
	}

	if cfg.AccessTTL <= 0 || cfg.RefreshTTL <= 0 {
		return Config{}, fmt.Errorf("token TTLs must be positive")
	}
	return cfg, nil
}

// Redacted returns a log-safe description of the configuration.
func (c Config) Redacted() map[string]any {
	return map[string]any{
		"env":             c.Env,
		"addr":            c.Addr,
		"database":        c.DatabasePath,
		"trustedProxies":  c.TrustedProxies,
		"accessTtl":       c.AccessTTL.String(),
		"refreshTtl":      c.RefreshTTL.String(),
		"allowedOrigins":  c.AllowedOrigins,
		"seedDemo":        c.SeedDemo,
		"jwtSecretIsSet":  len(c.JWTSecret) > 0,
		"shutdownGraceMs": c.ShutdownGrace.Milliseconds(),
	}
}

func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(v)
	if err != nil {
		return fallback
	}
	return parsed
}

func envDuration(key string, fallback time.Duration) time.Duration {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(v)
	if err != nil {
		return fallback
	}
	return parsed
}

func envList(key string, fallback []string) []string {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if trimmed := strings.TrimSpace(p); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	if len(out) == 0 {
		return fallback
	}
	return out
}
