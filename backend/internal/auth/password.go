// Package auth implements password hashing and stateless access tokens.
package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

// Password hashing parameters. These follow the OWASP argon2id baseline:
// 19 MiB of memory, 2 iterations, 1 degree of parallelism.
const (
	argonTime    uint32 = 2
	argonMemory  uint32 = 19 * 1024
	argonThreads uint8  = 1
	argonKeyLen  uint32 = 32
	argonSaltLen        = 16
)

// ErrInvalidHash is returned when a stored hash is not in the expected PHC form.
var ErrInvalidHash = errors.New("auth: password hash is not in PHC format")

// ErrPasswordMismatch is returned when verification fails.
var ErrPasswordMismatch = errors.New("auth: password does not match")

// HashPassword derives an argon2id hash and returns it in PHC string format:
//
//	$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>
func HashPassword(password string) (string, error) {
	if len(password) < 8 {
		return "", fmt.Errorf("auth: password must be at least 8 characters")
	}
	if len(password) > 1024 {
		return "", fmt.Errorf("auth: password must be at most 1024 bytes")
	}
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("auth: read salt: %w", err)
	}
	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemory, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	), nil
}

// VerifyPassword compares a candidate password against a stored PHC hash.
func VerifyPassword(password, encoded string) error {
	params, salt, key, err := decodeHash(encoded)
	if err != nil {
		return err
	}
	candidate := argon2.IDKey([]byte(password), salt, params.time, params.memory, params.threads, uint32(len(key)))
	if subtle.ConstantTimeCompare(key, candidate) != 1 {
		return ErrPasswordMismatch
	}
	return nil
}

type argonParams struct {
	memory  uint32
	time    uint32
	threads uint8
}

func decodeHash(encoded string) (argonParams, []byte, []byte, error) {
	parts := strings.Split(strings.TrimSpace(encoded), "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return argonParams{}, nil, nil, ErrInvalidHash
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil {
		return argonParams{}, nil, nil, ErrInvalidHash
	}
	if version != argon2.Version {
		return argonParams{}, nil, nil, fmt.Errorf("auth: unsupported argon2 version %d", version)
	}
	var p argonParams
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &p.memory, &p.time, &p.threads); err != nil {
		return argonParams{}, nil, nil, ErrInvalidHash
	}
	salt, err := base64.RawStdEncoding.Strict().DecodeString(parts[4])
	if err != nil {
		return argonParams{}, nil, nil, ErrInvalidHash
	}
	key, err := base64.RawStdEncoding.Strict().DecodeString(parts[5])
	if err != nil {
		return argonParams{}, nil, nil, ErrInvalidHash
	}
	if len(salt) == 0 || len(key) == 0 {
		return argonParams{}, nil, nil, ErrInvalidHash
	}
	return p, salt, key, nil
}

// DummyVerify burns roughly the same CPU as a real verification so that failed
// logins for unknown accounts do not leak timing information.
func DummyVerify() {
	_ = argon2.IDKey([]byte("flowboard-timing-equalizer"), []byte("0123456789abcdef"), argonTime, argonMemory, argonThreads, argonKeyLen)
}

// RandomToken returns a URL-safe token with n bytes of entropy.
func RandomToken(n int) (string, error) {
	if n <= 0 {
		n = 32
	}
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("auth: read random bytes: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
