// Package store is the persistence layer. It owns the SQLite schema and
// exposes intention-revealing methods to the API layer; no SQL leaks upward.
package store

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite" // pure-Go SQLite driver, no cgo required
)

//go:embed migrations/*.sql
var migrationFS embed.FS

// Sentinel errors the API layer maps onto HTTP status codes.
var (
	ErrNotFound      = errors.New("resource not found")
	ErrConflict      = errors.New("resource already exists")
	ErrForbidden     = errors.New("operation not permitted")
	ErrInvalidInput  = errors.New("invalid input")
	ErrWIPLimit      = errors.New("work-in-progress limit reached")
	ErrLastColumn    = errors.New("a board needs at least one column")
	ErrLastOwnerRole = errors.New("a board needs at least one owner")
)

// Store wraps the SQL connection pool.
type Store struct {
	db  *sql.DB
	now func() time.Time
}

// Options configures Open.
type Options struct {
	// Path is the SQLite database file, or ":memory:".
	Path string
	// MaxOpenConns caps the pool. SQLite allows a single writer, so a small
	// pool plus WAL keeps readers concurrent without busy loops.
	MaxOpenConns int
}

// Open creates the database (if needed) and applies pending migrations.
func Open(ctx context.Context, opts Options) (*Store, error) {
	if opts.MaxOpenConns <= 0 {
		opts.MaxOpenConns = 4
	}
	dsn, err := dsnFor(opts.Path)
	if err != nil {
		return nil, err
	}
	if opts.Path != ":memory:" && !strings.HasPrefix(opts.Path, "file::memory:") {
		if dir := filepath.Dir(opts.Path); dir != "" && dir != "." {
			if err := os.MkdirAll(dir, 0o755); err != nil {
				return nil, fmt.Errorf("create database directory: %w", err)
			}
		}
	}

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(opts.MaxOpenConns)
	db.SetMaxIdleConns(opts.MaxOpenConns)
	db.SetConnMaxLifetime(0)

	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping sqlite: %w", err)
	}

	s := &Store{db: db, now: time.Now}
	if err := s.migrate(ctx); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

// DB exposes the raw handle for health checks.
func (s *Store) DB() *sql.DB { return s.db }

// Close releases the connection pool.
func (s *Store) Close() error { return s.db.Close() }

// SetClock overrides the time source (used by tests).
func (s *Store) SetClock(now func() time.Time) {
	if now != nil {
		s.now = now
	}
}

func dsnFor(path string) (string, error) {
	pragmas := []string{
		"_pragma=busy_timeout(5000)",
		"_pragma=foreign_keys(1)",
		"_pragma=journal_mode(WAL)",
		"_pragma=synchronous(NORMAL)",
		"_txlock=immediate",
	}
	switch {
	case path == ":memory:", strings.HasPrefix(path, "file::memory:"):
		return "file:flowboard?mode=memory&cache=shared&" + strings.Join(pragmas, "&"), nil
	case strings.HasPrefix(path, "file:"):
		return path + "&" + strings.Join(pragmas, "&"), nil
	case strings.TrimSpace(path) == "":
		return "", fmt.Errorf("database path must not be empty")
	default:
		return "file:" + url.PathEscape(filepath.ToSlash(path)) + "?" + strings.Join(pragmas, "&"), nil
	}
}

func (s *Store) migrate(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			name       TEXT PRIMARY KEY,
			applied_at INTEGER NOT NULL
		)`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	applied := map[string]bool{}
	rows, err := s.db.QueryContext(ctx, `SELECT name FROM schema_migrations`)
	if err != nil {
		return fmt.Errorf("read schema_migrations: %w", err)
	}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			rows.Close()
			return fmt.Errorf("scan schema_migrations: %w", err)
		}
		applied[name] = true
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("iterate schema_migrations: %w", err)
	}
	rows.Close()

	entries, err := fs.Glob(migrationFS, "migrations/*.sql")
	if err != nil {
		return fmt.Errorf("list migrations: %w", err)
	}
	sort.Strings(entries)

	for _, entry := range entries {
		name := filepath.Base(entry)
		if applied[name] {
			continue
		}
		body, err := migrationFS.ReadFile(entry)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", name, err)
		}
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("begin migration %s: %w", name, err)
		}
		if _, err := tx.ExecContext(ctx, string(body)); err != nil {
			tx.Rollback()
			return fmt.Errorf("apply migration %s: %w", name, err)
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)`,
			name, ms(s.now()),
		); err != nil {
			tx.Rollback()
			return fmt.Errorf("record migration %s: %w", name, err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit migration %s: %w", name, err)
		}
	}
	return nil
}

// -- small helpers shared by every store file -------------------------------

func newID() string { return uuid.NewString() }

// ms converts a time to epoch milliseconds, normalised to UTC.
func ms(t time.Time) int64 { return t.UTC().UnixMilli() }

// ts converts stored epoch milliseconds back into a UTC time.
func ts(v int64) time.Time { return time.UnixMilli(v).UTC() }

// tsPtr converts a nullable millisecond column into *time.Time.
func tsPtr(v sql.NullInt64) *time.Time {
	if !v.Valid {
		return nil
	}
	t := ts(v.Int64)
	return &t
}

// optTime converts an optional time into a driver argument.
func optTime(t *time.Time) any {
	if t == nil {
		return nil
	}
	return ms(*t)
}

func ptrOrNil(v sql.NullString) *string {
	if !v.Valid || v.String == "" {
		return nil
	}
	out := v.String
	return &out
}

// withTx runs fn inside a transaction, rolling back on error.
func (s *Store) withTx(ctx context.Context, fn func(tx *sql.Tx) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer func() {
		// Rollback after a successful commit is a no-op.
		_ = tx.Rollback()
	}()
	if err := fn(tx); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}
	return nil
}

func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "unique constraint") || strings.Contains(msg, "constraint failed: unique")
}

// normalizePriority clamps a priority to the supported 0..3 range.
func normalizePriority(p int) Priority {
	if p < 0 {
		return PriorityLow
	}
	if p > int(PriorityUrgent) {
		return PriorityUrgent
	}
	return Priority(p)
}
