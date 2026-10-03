package auth

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// ErrInvalidToken is returned for malformed, expired or forged tokens.
var ErrInvalidToken = errors.New("auth: invalid or expired token")

// Claims is the access-token payload.
type Claims struct {
	UserID string `json:"-"`
	Email  string `json:"email"`
	Name   string `json:"name"`
	jwt.RegisteredClaims
}

// TokenIssuer mints and validates access tokens.
type TokenIssuer struct {
	secret   []byte
	issuer   string
	audience string
	ttl      time.Duration
}

// NewTokenIssuer builds an issuer. The secret must not be empty.
func NewTokenIssuer(secret []byte, ttl time.Duration) (*TokenIssuer, error) {
	if len(secret) == 0 {
		return nil, errors.New("auth: jwt secret must not be empty")
	}
	if ttl <= 0 {
		return nil, errors.New("auth: access token TTL must be positive")
	}
	return &TokenIssuer{
		secret:   secret,
		issuer:   "flowboard",
		audience: "flowboard-web",
		ttl:      ttl,
	}, nil
}

// TTL reports the access-token lifetime.
func (t *TokenIssuer) TTL() time.Duration { return t.ttl }

// Issue mints a signed HS256 access token for a user.
func (t *TokenIssuer) Issue(userID, email, name string, now time.Time) (string, time.Time, error) {
	expiresAt := now.Add(t.ttl)
	claims := Claims{
		Email: email,
		Name:  name,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			Issuer:    t.issuer,
			Audience:  jwt.ClaimStrings{t.audience},
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now.Add(-30 * time.Second)),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			ID:        mustRandomID(),
		},
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(t.secret)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("auth: sign token: %w", err)
	}
	return signed, expiresAt, nil
}

// Parse validates a token and returns its claims.
func (t *TokenIssuer) Parse(raw string) (*Claims, error) {
	claims := &Claims{}
	_, err := jwt.ParseWithClaims(raw, claims, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("%w: unexpected signing method %v", ErrInvalidToken, token.Header["alg"])
		}
		return t.secret, nil
	},
		jwt.WithIssuer(t.issuer),
		jwt.WithAudience(t.audience),
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithLeeway(15*time.Second),
	)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidToken, err)
	}
	claims.UserID = claims.Subject
	if claims.UserID == "" {
		return nil, fmt.Errorf("%w: missing subject", ErrInvalidToken)
	}
	return claims, nil
}

// HashToken returns the hex SHA-256 digest used to store refresh tokens. Only
// the digest is persisted, so a database leak cannot be replayed.
func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func mustRandomID() string {
	id, err := RandomToken(12)
	if err != nil {
		return "flowboard"
	}
	return id
}
