// Package api exposes the FlowBoard HTTP interface.
package api

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/flowboard/flowboard/backend/internal/auth"
	"github.com/flowboard/flowboard/backend/internal/config"
	"github.com/flowboard/flowboard/backend/internal/httpx"
	"github.com/flowboard/flowboard/backend/internal/realtime"
	"github.com/flowboard/flowboard/backend/internal/store"
)

// Build metadata, injected with -ldflags at image build time.
var (
	Version   = "dev"
	Commit    = "none"
	BuildTime = "unknown"
)

// Server wires the store, token issuer and event hub into an HTTP handler.
type Server struct {
	store  *store.Store
	tokens *auth.TokenIssuer
	hub    *realtime.Hub
	cfg    config.Config
	logger *slog.Logger

	authLimiter  *httpx.RateLimiter
	writeLimiter *httpx.RateLimiter
	startedAt    time.Time
}

// Options configures New.
type Options struct {
	Store  *store.Store
	Tokens *auth.TokenIssuer
	Hub    *realtime.Hub
	Config config.Config
	Logger *slog.Logger
}

// New builds a Server.
func New(opts Options) *Server {
	logger := opts.Logger
	if logger == nil {
		logger = slog.Default()
	}
	hub := opts.Hub
	if hub == nil {
		hub = realtime.NewHub()
	}
	return &Server{
		store:        opts.Store,
		tokens:       opts.Tokens,
		hub:          hub,
		cfg:          opts.Config,
		logger:       logger,
		authLimiter:  httpx.NewRateLimiter(20, time.Minute),
		writeLimiter: httpx.NewRateLimiter(600, time.Minute),
		startedAt:    time.Now().UTC(),
	}
}

// Hub exposes the event hub (used by the demo seeder and tests).
func (s *Server) Hub() *realtime.Hub { return s.hub }

// Handler returns the fully wired HTTP handler.
func (s *Server) Handler() http.Handler {
	// The API mux carries a request timeout; the SSE endpoint is registered on
	// the outer mux because a timeout would tear down long-lived streams.
	apiMux := http.NewServeMux()
	s.registerRoutes(apiMux)

	apiWithTimeout := httpx.Chain(apiMux, httpx.Timeout(20*time.Second))

	root := http.NewServeMux()
	root.HandleFunc("GET /healthz", s.handleHealth)
	root.HandleFunc("GET /readyz", s.handleReady)
	root.Handle("GET /api/v1/events", s.withAuth(s.handleEvents))
	root.Handle("/", apiWithTimeout)

	return httpx.Chain(root,
		httpx.RequestID,
		httpx.Logger(s.logger),
		httpx.Recover,
		httpx.SecurityHeaders,
		httpx.CORS(s.cfg.AllowedOrigins),
	)
}

func (s *Server) registerRoutes(mux *http.ServeMux) {
	// -- authentication --
	mux.HandleFunc("POST /api/v1/auth/register", s.handleRegister)
	mux.HandleFunc("POST /api/v1/auth/login", s.handleLogin)
	mux.HandleFunc("POST /api/v1/auth/refresh", s.handleRefresh)
	mux.HandleFunc("POST /api/v1/auth/logout", s.handleLogout)
	mux.Handle("GET /api/v1/auth/me", s.withAuth(s.handleMe))
	mux.Handle("PATCH /api/v1/users/me", s.withAuth(s.handleUpdateMe))
	mux.Handle("GET /api/v1/users", s.withAuth(s.handleListUsers))
	mux.Handle("GET /api/v1/users/{userID}", s.withAuth(s.handleGetUser))

	// -- boards --
	mux.Handle("GET /api/v1/boards", s.withAuth(s.handleListBoards))
	mux.Handle("POST /api/v1/boards", s.withAuth(s.handleCreateBoard))
	mux.Handle("GET /api/v1/boards/{boardID}", s.withAuth(s.handleGetBoard))
	mux.Handle("PATCH /api/v1/boards/{boardID}", s.withAuth(s.handleUpdateBoard))
	mux.Handle("DELETE /api/v1/boards/{boardID}", s.withAuth(s.handleDeleteBoard))
	mux.Handle("GET /api/v1/boards/{boardID}/activity", s.withAuth(s.handleBoardActivity))
	mux.Handle("GET /api/v1/boards/{boardID}/stats", s.withAuth(s.handleBoardStats))
	mux.Handle("POST /api/v1/boards/{boardID}/reorder", s.withAuth(s.handleReorderBoard))
	mux.Handle("POST /api/v1/boards/{boardID}/members", s.withAuth(s.handleAddMember))
	mux.Handle("DELETE /api/v1/boards/{boardID}/members/{userID}", s.withAuth(s.handleRemoveMember))

	// -- columns --
	mux.Handle("POST /api/v1/boards/{boardID}/columns", s.withAuth(s.handleCreateColumn))
	mux.Handle("POST /api/v1/boards/{boardID}/columns/reorder", s.withAuth(s.handleReorderColumns))
	mux.Handle("PATCH /api/v1/columns/{columnID}", s.withAuth(s.handleUpdateColumn))
	mux.Handle("DELETE /api/v1/columns/{columnID}", s.withAuth(s.handleDeleteColumn))
	mux.Handle("POST /api/v1/columns/{columnID}/cards", s.withAuth(s.handleCreateCard))

	// -- cards --
	mux.Handle("GET /api/v1/cards/{cardID}", s.withAuth(s.handleGetCard))
	mux.Handle("PATCH /api/v1/cards/{cardID}", s.withAuth(s.handleUpdateCard))
	mux.Handle("DELETE /api/v1/cards/{cardID}", s.withAuth(s.handleDeleteCard))
	mux.Handle("POST /api/v1/cards/{cardID}/move", s.withAuth(s.handleMoveCard))
	mux.Handle("POST /api/v1/cards/{cardID}/labels", s.withAuth(s.handleAttachLabel))
	mux.Handle("DELETE /api/v1/cards/{cardID}/labels/{labelID}", s.withAuth(s.handleDetachLabel))
	mux.Handle("POST /api/v1/cards/{cardID}/checklist", s.withAuth(s.handleAddChecklistItem))
	mux.Handle("POST /api/v1/cards/{cardID}/comments", s.withAuth(s.handleAddComment))

	// -- labels, checklist, comments --
	mux.Handle("POST /api/v1/boards/{boardID}/labels", s.withAuth(s.handleCreateLabel))
	mux.Handle("PATCH /api/v1/labels/{labelID}", s.withAuth(s.handleUpdateLabel))
	mux.Handle("DELETE /api/v1/labels/{labelID}", s.withAuth(s.handleDeleteLabel))
	mux.Handle("PATCH /api/v1/checklist/{itemID}", s.withAuth(s.handleUpdateChecklistItem))
	mux.Handle("DELETE /api/v1/checklist/{itemID}", s.withAuth(s.handleDeleteChecklistItem))
	mux.Handle("PATCH /api/v1/comments/{commentID}", s.withAuth(s.handleUpdateComment))
	mux.Handle("DELETE /api/v1/comments/{commentID}", s.withAuth(s.handleDeleteComment))

	// -- views --
	mux.Handle("GET /api/v1/search", s.withAuth(s.handleSearch))
	mux.Handle("GET /api/v1/stats", s.withAuth(s.handleStats))
	mux.Handle("GET /api/v1/dashboard", s.withAuth(s.handleDashboard))
	mux.Handle("GET /api/v1/meta", http.HandlerFunc(s.handleMeta))
}

// -- authentication plumbing -------------------------------------------------

type ctxKey string

const ctxUserKey ctxKey = "flowboard.user"

// withAuth rejects unauthenticated requests and injects the caller into context.
func (s *Server) withAuth(next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw := bearerToken(r)
		if raw == "" {
			httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeUnauthorized, "Authentication required.")
			return
		}
		claims, err := s.tokens.Parse(raw)
		if err != nil {
			httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeUnauthorized, "Your session has expired. Please sign in again.")
			return
		}
		user, err := s.store.UserByID(r.Context(), claims.UserID)
		if err != nil {
			if errors.Is(err, store.ErrNotFound) {
				httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeUnauthorized, "This account no longer exists.")
				return
			}
			s.failStore(w, r, err)
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), ctxUserKey, user)))
	})
}

// bearerToken reads the access token from the Authorization header, falling
// back to the query string for browser APIs that cannot set headers
// (EventSource).
func bearerToken(r *http.Request) string {
	header := r.Header.Get("Authorization")
	if header != "" {
		parts := strings.SplitN(header, " ", 2)
		if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
			if token := strings.TrimSpace(parts[1]); token != "" {
				return token
			}
		}
	}
	return strings.TrimSpace(r.URL.Query().Get("access_token"))
}

func userFrom(ctx context.Context) *store.User {
	if u, ok := ctx.Value(ctxUserKey).(*store.User); ok {
		return u
	}
	return nil
}

// -- authorization helpers ---------------------------------------------------

// authorizeBoard resolves the caller's role, writing an error response when
// access is denied. write=true additionally rejects read-only viewers.
func (s *Server) authorizeBoard(w http.ResponseWriter, r *http.Request, boardID string, write bool) (string, bool) {
	user := userFrom(r.Context())
	if user == nil {
		httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeUnauthorized, "Authentication required.")
		return "", false
	}
	var (
		role string
		err  error
	)
	if write {
		role, err = s.store.RequireWriter(r.Context(), boardID, user.ID)
	} else {
		role, err = s.store.BoardRole(r.Context(), boardID, user.ID)
	}
	if err != nil {
		s.failStore(w, r, err)
		return "", false
	}
	return role, true
}

// authorizeCardBoard resolves the board that owns a card, verifies access, and
// returns the board id so callers can address realtime events correctly.
func (s *Server) authorizeCardBoard(w http.ResponseWriter, r *http.Request, cardID string, write bool) (string, bool) {
	boardID, err := s.store.CardBoardID(r.Context(), cardID)
	if err != nil {
		s.failStore(w, r, err)
		return "", false
	}
	if _, ok := s.authorizeBoard(w, r, boardID, write); !ok {
		return "", false
	}
	return boardID, true
}

// authorizeColumnBoard resolves the board that owns a column, verifies access,
// and returns the board id.
func (s *Server) authorizeColumnBoard(w http.ResponseWriter, r *http.Request, columnID string, write bool) (string, bool) {
	boardID, err := s.store.ColumnBoardID(r.Context(), columnID)
	if err != nil {
		s.failStore(w, r, err)
		return "", false
	}
	if _, ok := s.authorizeBoard(w, r, boardID, write); !ok {
		return "", false
	}
	return boardID, true
}

// -- error mapping -----------------------------------------------------------

// failStore translates store sentinel errors into HTTP responses.
func (s *Server) failStore(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		httpx.Fail(w, r, http.StatusNotFound, httpx.CodeNotFound, "That item could not be found.")
	case errors.Is(err, store.ErrForbidden):
		httpx.Fail(w, r, http.StatusForbidden, httpx.CodeForbidden, messageOrDefault(err, "You do not have permission to do that."))
	case errors.Is(err, store.ErrConflict):
		httpx.Fail(w, r, http.StatusConflict, httpx.CodeConflict, messageOrDefault(err, "That already exists."))
	case errors.Is(err, store.ErrWIPLimit):
		httpx.Fail(w, r, http.StatusConflict, httpx.CodeWIPLimit, messageOrDefault(err, "This column is at its work-in-progress limit."))
	case errors.Is(err, store.ErrInvalidInput), errors.Is(err, store.ErrLastColumn), errors.Is(err, store.ErrLastOwnerRole):
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidation, messageOrDefault(err, "That change is not allowed."))
	case errors.Is(err, context.DeadlineExceeded):
		httpx.Fail(w, r, http.StatusGatewayTimeout, httpx.CodeInternal, "The request took too long.")
	default:
		httpx.LoggerFrom(r.Context()).Error("unhandled store error", "error", err, "path", r.URL.Path)
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternal, "Something went wrong on our side.")
	}
}

// messageOrDefault strips the sentinel prefix so users see the useful tail.
func messageOrDefault(err error, fallback string) string {
	msg := err.Error()
	if idx := strings.Index(msg, ": "); idx >= 0 {
		if tail := strings.TrimSpace(msg[idx+2:]); tail != "" {
			return strings.ToUpper(tail[:1]) + tail[1:]
		}
	}
	return fallback
}

// -- rate limiting -----------------------------------------------------------

func (s *Server) allow(w http.ResponseWriter, r *http.Request, limiter *httpx.RateLimiter, key string) bool {
	ok, retryAfter := limiter.Allow(key)
	if ok {
		return true
	}
	w.Header().Set("Retry-After", retryAfter.Round(time.Second).String())
	httpx.Fail(w, r, http.StatusTooManyRequests, httpx.CodeRateLimited, "Too many attempts. Please wait a moment and try again.")
	return false
}

// clientKey derives a rate-limit key from the caller's address.
func clientKey(r *http.Request) string {
	return httpx.ClientIP(r)
}

// -- events ------------------------------------------------------------------

func (s *Server) publish(event realtime.Event) {
	s.hub.Publish(event)
}

func (s *Server) publishBoard(eventType, boardID, actorID, actorName, summary string) {
	s.publish(realtime.Event{
		Type:      eventType,
		BoardID:   boardID,
		ActorID:   actorID,
		ActorName: actorName,
		Summary:   summary,
		At:        time.Now().UTC(),
	})
}
