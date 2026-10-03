package auth

import (
	"strings"
	"testing"
	"time"
)

func TestHashPasswordRoundTrip(t *testing.T) {
	hash, err := HashPassword("correct horse battery")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if !strings.HasPrefix(hash, "$argon2id$v=19$") {
		t.Fatalf("unexpected PHC prefix: %q", hash)
	}
	if err := VerifyPassword("correct horse battery", hash); err != nil {
		t.Fatalf("VerifyPassword rejected the correct password: %v", err)
	}
	if err := VerifyPassword("wrong password", hash); err == nil {
		t.Fatal("VerifyPassword accepted an incorrect password")
	}
}

func TestHashPasswordRejectsShortSecrets(t *testing.T) {
	if _, err := HashPassword("short"); err == nil {
		t.Fatal("expected short passwords to be rejected")
	}
}

func TestHashPasswordIsSalted(t *testing.T) {
	first, err := HashPassword("same password twice")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	second, err := HashPassword("same password twice")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if first == second {
		t.Fatal("identical passwords produced identical hashes; salt is not random")
	}
}

func TestVerifyPasswordRejectsGarbage(t *testing.T) {
	for _, encoded := range []string{"", "not-a-hash", "$argon2id$v=19$broken", "$bcrypt$whatever$"} {
		if err := VerifyPassword("whatever", encoded); err == nil {
			t.Fatalf("expected %q to be rejected", encoded)
		}
	}
}

func TestTokenIssueAndParse(t *testing.T) {
	issuer, err := NewTokenIssuer([]byte("test-secret-value"), time.Minute)
	if err != nil {
		t.Fatalf("NewTokenIssuer: %v", err)
	}
	now := time.Now()
	token, expiresAt, err := issuer.Issue("user-1", "user@example.com", "User One", now)
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	if !expiresAt.After(now) {
		t.Fatalf("expiry %v is not after issue time %v", expiresAt, now)
	}
	claims, err := issuer.Parse(token)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if claims.UserID != "user-1" || claims.Email != "user@example.com" || claims.Name != "User One" {
		t.Fatalf("unexpected claims: %+v", claims)
	}
}

func TestTokenRejectsWrongSecret(t *testing.T) {
	issuer, _ := NewTokenIssuer([]byte("secret-one"), time.Minute)
	other, _ := NewTokenIssuer([]byte("secret-two"), time.Minute)
	token, _, err := issuer.Issue("user-1", "a@b.co", "A", time.Now())
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	if _, err := other.Parse(token); err == nil {
		t.Fatal("a token signed with another secret was accepted")
	}
}

func TestTokenRejectsExpired(t *testing.T) {
	issuer, _ := NewTokenIssuer([]byte("secret"), time.Minute)
	past := time.Now().Add(-2 * time.Hour)
	token, _, err := issuer.Issue("user-1", "a@b.co", "A", past)
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	if _, err := issuer.Parse(token); err == nil {
		t.Fatal("an expired token was accepted")
	}
}

func TestNewTokenIssuerValidatesInput(t *testing.T) {
	if _, err := NewTokenIssuer(nil, time.Minute); err == nil {
		t.Fatal("empty secret should be rejected")
	}
	if _, err := NewTokenIssuer([]byte("secret"), 0); err == nil {
		t.Fatal("zero TTL should be rejected")
	}
}

func TestHashTokenIsStableAndOpaque(t *testing.T) {
	token, err := RandomToken(32)
	if err != nil {
		t.Fatalf("RandomToken: %v", err)
	}
	if len(token) < 32 {
		t.Fatalf("token looks too short: %q", token)
	}
	first := HashToken(token)
	if first != HashToken(token) {
		t.Fatal("HashToken is not deterministic")
	}
	if strings.Contains(first, token) {
		t.Fatal("HashToken leaked the raw token")
	}
}
