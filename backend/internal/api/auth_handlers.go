package api

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/flowboard/flowboard/backend/internal/auth"
	"github.com/flowboard/flowboard/backend/internal/httpx"
	"github.com/flowboard/flowboard/backend/internal/store"
)

// -- request/response payloads ----------------------------------------------

type registerRequest struct {
	Email    string `json:"email"`
	Name     string `json:"name"`
	Password string `json:"password"`
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type refreshRequest struct {
	RefreshToken string `json:"refreshToken"`
}

type updateMeRequest struct {
	Name        *string `json:"name"`
	AvatarColor *string `json:"avatarColor"`
	Password    *string `json:"password"`
}

type sessionResponse struct {
	User         *store.User `json:"user"`
	AccessToken  string      `json:"accessToken"`
	RefreshToken string      `json:"refreshToken"`
	TokenType    string      `json:"tokenType"`
	ExpiresIn    int         `json:"expiresIn"`
	ExpiresAt    time.Time   `json:"expiresAt"`
}

// validateEmail performs a deliberately light check: the authoritative test is
// whether mail actually arrives, and over-strict regexes reject valid addresses.
func validateEmail(email string) string {
	email = strings.TrimSpace(email)
	if email == "" {
		return "Email is required."
	}
	at := strings.LastIndex(email, "@")
	if at <= 0 || at == len(email)-1 || !strings.Contains(email[at+1:], ".") {
		return "Enter a valid email address."
	}
	if len(email) > 254 {
		return "Email is too long."
	}
	return ""
}

func (s *Server) issueSession(w http.ResponseWriter, r *http.Request, user *store.User) {
	now := time.Now().UTC()
	access, expiresAt, err := s.tokens.Issue(user.ID, user.Email, user.Name, now)
	if err != nil {
		s.logger.Error("issue access token", "error", err)
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternal, "Could not start your session.")
		return
	}
	refresh, err := auth.RandomToken(32)
	if err != nil {
		s.logger.Error("generate refresh token", "error", err)
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternal, "Could not start your session.")
		return
	}
	refreshExpiry := now.Add(s.cfg.RefreshTTL)
	if err := s.store.SaveRefreshToken(r.Context(), user.ID, auth.HashToken(refresh), r.UserAgent(), refreshExpiry); err != nil {
		s.failStore(w, r, err)
		return
	}
	httpx.JSON(w, r, http.StatusOK, sessionResponse{
		User:         user,
		AccessToken:  access,
		RefreshToken: refresh,
		TokenType:    "Bearer",
		ExpiresIn:    int(time.Until(expiresAt).Seconds()),
		ExpiresAt:    expiresAt,
	})
}

// handleRegister creates an account and immediately signs the user in.
func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	if !s.allow(w, r, s.authLimiter, "register:"+clientKey(r)) {
		return
	}
	var req registerRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.Fail(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
		return
	}
	fields := map[string]string{}
	if msg := validateEmail(req.Email); msg != "" {
		fields["email"] = msg
	}
	if strings.TrimSpace(req.Name) == "" {
		fields["name"] = "Please tell us your name."
	}
	if len(req.Password) < 8 {
		fields["password"] = "Use at least 8 characters."
	}
	if len(fields) > 0 {
		httpx.FailFields(w, r, fields)
		return
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		httpx.FailFields(w, r, map[string]string{"password": "That password cannot be used."})
		return
	}
	user, err := s.store.CreateUser(r.Context(), req.Email, req.Name, hash, avatarColorFor(req.Name))
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	s.issueSession(w, r, user)
}

// handleLogin exchanges credentials for a session.
func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if !s.allow(w, r, s.authLimiter, "login:"+clientKey(r)) {
		return
	}
	var req loginRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.Fail(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(req.Email) == "" || req.Password == "" {
		httpx.FailFields(w, r, map[string]string{
			"email":    "Email is required.",
			"password": "Password is required.",
		})
		return
	}

	record, err := s.store.UserByEmail(r.Context(), req.Email)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			// Equalise timing so account enumeration is harder.
			auth.DummyVerify()
			httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeUnauthorized, "Email or password is incorrect.")
			return
		}
		s.failStore(w, r, err)
		return
	}
	if err := auth.VerifyPassword(req.Password, record.PasswordHash); err != nil {
		httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeUnauthorized, "Email or password is incorrect.")
		return
	}
	s.issueSession(w, r, &record.User)
}

// handleRefresh rotates a refresh token. The old token is revoked as part of
// the exchange, so a stolen token cannot be replayed after the legit client
// refreshes.
func (s *Server) handleRefresh(w http.ResponseWriter, r *http.Request) {
	if !s.allow(w, r, s.authLimiter, "refresh:"+clientKey(r)) {
		return
	}
	var req refreshRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.Fail(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(req.RefreshToken) == "" {
		httpx.FailFields(w, r, map[string]string{"refreshToken": "A refresh token is required."})
		return
	}
	hash := auth.HashToken(req.RefreshToken)
	record, err := s.store.RefreshTokenByHash(r.Context(), hash)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeUnauthorized, "Your session has expired. Please sign in again.")
			return
		}
		s.failStore(w, r, err)
		return
	}
	if record.RevokedAt != nil || time.Now().UTC().After(record.ExpiresAt) {
		httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeUnauthorized, "Your session has expired. Please sign in again.")
		return
	}
	user, err := s.store.UserByID(r.Context(), record.UserID)
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	if err := s.store.RevokeRefreshToken(r.Context(), hash); err != nil {
		s.failStore(w, r, err)
		return
	}
	s.issueSession(w, r, user)
}

// handleLogout revokes a refresh token. Access tokens expire on their own.
func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	var req refreshRequest
	if err := httpx.DecodeJSON(w, r, &req); err == nil && strings.TrimSpace(req.RefreshToken) != "" {
		if err := s.store.RevokeRefreshToken(r.Context(), auth.HashToken(req.RefreshToken)); err != nil {
			s.logger.Warn("revoke refresh token", "error", err)
		}
	}
	httpx.JSON(w, r, http.StatusNoContent, nil)
}

// handleMe returns the signed-in account.
func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, r, http.StatusOK, map[string]any{"user": userFrom(r.Context())})
}

// handleUpdateMe patches the signed-in account.
func (s *Server) handleUpdateMe(w http.ResponseWriter, r *http.Request) {
	user := userFrom(r.Context())
	var req updateMeRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.Fail(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
		return
	}
	fields := map[string]string{}
	if req.Name != nil && strings.TrimSpace(*req.Name) == "" {
		fields["name"] = "Name cannot be blank."
	}
	if req.Password != nil && len(*req.Password) < 8 {
		fields["password"] = "Use at least 8 characters."
	}
	if len(fields) > 0 {
		httpx.FailFields(w, r, fields)
		return
	}

	var hash *string
	if req.Password != nil {
		h, err := auth.HashPassword(*req.Password)
		if err != nil {
			httpx.FailFields(w, r, map[string]string{"password": "That password cannot be used."})
			return
		}
		hash = &h
	}
	updated, err := s.store.UpdateUser(r.Context(), user.ID, req.Name, req.AvatarColor, hash)
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	if hash != nil {
		// A password change ends every other session.
		if err := s.store.RevokeAllUserTokens(r.Context(), user.ID); err != nil {
			s.logger.Warn("revoke sessions after password change", "error", err)
		}
	}
	httpx.JSON(w, r, http.StatusOK, map[string]any{"user": updated})
}

// handleListUsers searches the account directory for card assignment.
func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	users, err := s.store.ListUsers(r.Context(), query, 25)
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	httpx.JSON(w, r, http.StatusOK, map[string]any{"users": users})
}

// handleGetUser returns a public profile.
func (s *Server) handleGetUser(w http.ResponseWriter, r *http.Request) {
	user, err := s.store.UserByID(r.Context(), r.PathValue("userID"))
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	httpx.JSON(w, r, http.StatusOK, map[string]any{"user": user})
}

// avatarColorFor picks a stable accent colour from a name.
func avatarColorFor(name string) string {
	palette := []string{"#6366f1", "#0ea5e9", "#14b8a6", "#f59e0b", "#ec4899", "#8b5cf6", "#ef4444", "#22c55e"}
	sum := 0
	for _, r := range strings.TrimSpace(name) {
		sum += int(r)
	}
	if sum < 0 {
		sum = -sum
	}
	return palette[sum%len(palette)]
}
