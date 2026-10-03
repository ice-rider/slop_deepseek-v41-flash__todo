package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// CreateUser inserts a new account, failing with ErrConflict on duplicate email.
func (s *Store) CreateUser(ctx context.Context, email, name, passwordHash, avatarColor string) (*User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	name = strings.TrimSpace(name)
	if email == "" || name == "" {
		return nil, fmt.Errorf("%w: email and name are required", ErrInvalidInput)
	}
	if avatarColor == "" {
		avatarColor = "#6366f1"
	}
	now := s.now()
	u := &User{
		ID:          newID(),
		Email:       email,
		Name:        name,
		AvatarColor: avatarColor,
		CreatedAt:   ts(ms(now)),
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO users (id, email, name, password_hash, avatar_color, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		u.ID, u.Email, u.Name, passwordHash, u.AvatarColor, ms(now), ms(now),
	)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, fmt.Errorf("%w: an account with that email already exists", ErrConflict)
		}
		return nil, fmt.Errorf("insert user: %w", err)
	}
	return u, nil
}

// UserByEmail looks up an account for login.
func (s *Store) UserByEmail(ctx context.Context, email string) (*UserRecord, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, email, name, password_hash, avatar_color, created_at
		FROM users WHERE email = ? COLLATE NOCASE`, strings.ToLower(strings.TrimSpace(email)))
	return scanUserRecord(row)
}

// UserByID fetches a single account.
func (s *Store) UserByID(ctx context.Context, id string) (*User, error) {
	rec, err := s.userRecordByID(ctx, id)
	if err != nil {
		return nil, err
	}
	return &rec.User, nil
}

func (s *Store) userRecordByID(ctx context.Context, id string) (*UserRecord, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, email, name, password_hash, avatar_color, created_at
		FROM users WHERE id = ?`, id)
	return scanUserRecord(row)
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanUserRecord(row rowScanner) (*UserRecord, error) {
	var (
		rec       UserRecord
		createdAt int64
	)
	if err := row.Scan(&rec.ID, &rec.Email, &rec.Name, &rec.PasswordHash, &rec.AvatarColor, &createdAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("scan user: %w", err)
	}
	rec.CreatedAt = ts(createdAt)
	return &rec, nil
}

// UpdateUser patches mutable profile fields. Nil arguments are left untouched.
func (s *Store) UpdateUser(ctx context.Context, id string, name, avatarColor, passwordHash *string) (*User, error) {
	sets := []string{}
	args := []any{}
	if name != nil {
		trimmed := strings.TrimSpace(*name)
		if trimmed == "" {
			return nil, fmt.Errorf("%w: name must not be blank", ErrInvalidInput)
		}
		sets = append(sets, "name = ?")
		args = append(args, trimmed)
	}
	if avatarColor != nil {
		sets = append(sets, "avatar_color = ?")
		args = append(args, *avatarColor)
	}
	if passwordHash != nil {
		sets = append(sets, "password_hash = ?")
		args = append(args, *passwordHash)
	}
	if len(sets) == 0 {
		return s.UserByID(ctx, id)
	}
	sets = append(sets, "updated_at = ?")
	args = append(args, ms(s.now()), id)

	res, err := s.db.ExecContext(ctx, `UPDATE users SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...)
	if err != nil {
		return nil, fmt.Errorf("update user: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrNotFound
	}
	return s.UserByID(ctx, id)
}

// PasswordHash returns the stored hash for a user.
func (s *Store) PasswordHash(ctx context.Context, userID string) (string, error) {
	rec, err := s.userRecordByID(ctx, userID)
	if err != nil {
		return "", err
	}
	return rec.PasswordHash, nil
}

// ListUsers returns a directory used for assigning cards. Results are capped.
func (s *Store) ListUsers(ctx context.Context, query string, limit int) ([]User, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	args := []any{}
	where := ""
	if q := strings.TrimSpace(query); q != "" {
		where = "WHERE (name LIKE ? OR email LIKE ?)"
		like := "%" + q + "%"
		args = append(args, like, like)
	}
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, email, name, avatar_color, created_at
		FROM users `+where+`
		ORDER BY name COLLATE NOCASE
		LIMIT ?`, args...)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	defer rows.Close()

	out := make([]User, 0, limit)
	for rows.Next() {
		var (
			u         User
			createdAt int64
		)
		if err := rows.Scan(&u.ID, &u.Email, &u.Name, &u.AvatarColor, &createdAt); err != nil {
			return nil, fmt.Errorf("scan user row: %w", err)
		}
		u.CreatedAt = ts(createdAt)
		out = append(out, u)
	}
	return out, rows.Err()
}

// -- refresh tokens ---------------------------------------------------------

// RefreshToken is a persisted, hash-addressed session token.
type RefreshToken struct {
	ID        string
	UserID    string
	TokenHash string
	ExpiresAt time.Time
	RevokedAt *time.Time
}

// SaveRefreshToken stores the hash of an issued refresh token.
func (s *Store) SaveRefreshToken(ctx context.Context, userID, tokenHash, userAgent string, expiresAt time.Time) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, user_agent, created_at)
		VALUES (?, ?, ?, ?, ?, ?)`,
		newID(), userID, tokenHash, ms(expiresAt), userAgent, ms(s.now()),
	)
	if err != nil {
		return fmt.Errorf("insert refresh token: %w", err)
	}
	return nil
}

// RefreshTokenByHash loads a token row by its hash.
func (s *Store) RefreshTokenByHash(ctx context.Context, tokenHash string) (*RefreshToken, error) {
	var (
		rt        RefreshToken
		expiresAt int64
		revokedAt sql.NullInt64
	)
	err := s.db.QueryRowContext(ctx, `
		SELECT id, user_id, token_hash, expires_at, revoked_at
		FROM refresh_tokens WHERE token_hash = ?`, tokenHash,
	).Scan(&rt.ID, &rt.UserID, &rt.TokenHash, &expiresAt, &revokedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("scan refresh token: %w", err)
	}
	rt.ExpiresAt = ts(expiresAt)
	rt.RevokedAt = tsPtr(revokedAt)
	return &rt, nil
}

// RevokeRefreshToken marks a single token as revoked (logout).
func (s *Store) RevokeRefreshToken(ctx context.Context, tokenHash string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`,
		ms(s.now()), tokenHash)
	if err != nil {
		return fmt.Errorf("revoke refresh token: %w", err)
	}
	return nil
}

// RevokeAllUserTokens invalidates every session for a user (password change).
func (s *Store) RevokeAllUserTokens(ctx context.Context, userID string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`,
		ms(s.now()), userID)
	if err != nil {
		return fmt.Errorf("revoke user tokens: %w", err)
	}
	return nil
}

// PurgeExpiredTokens deletes stale rows; called periodically by the server.
func (s *Store) PurgeExpiredTokens(ctx context.Context) (int64, error) {
	res, err := s.db.ExecContext(ctx, `DELETE FROM refresh_tokens WHERE expires_at < ? OR revoked_at IS NOT NULL`, ms(s.now()))
	if err != nil {
		return 0, fmt.Errorf("purge refresh tokens: %w", err)
	}
	n, _ := res.RowsAffected()
	return n, nil
}

// CountUsers reports how many accounts exist (used to decide demo seeding).
func (s *Store) CountUsers(ctx context.Context) (int, error) {
	var n int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&n); err != nil {
		return 0, fmt.Errorf("count users: %w", err)
	}
	return n, nil
}
