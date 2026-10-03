// Package httpx holds transport-level helpers: JSON rendering, error
// envelopes, and the middleware chain.
package httpx

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// ErrorBody is the uniform error envelope returned by every endpoint.
type ErrorBody struct {
	Error ErrorDetail `json:"error"`
}

// ErrorDetail describes a failure in a machine-readable way.
type ErrorDetail struct {
	Code      string            `json:"code"`
	Message   string            `json:"message"`
	Fields    map[string]string `json:"fields,omitempty"`
	RequestID string            `json:"requestId,omitempty"`
}

// API error codes shared with the frontend.
const (
	CodeBadRequest   = "bad_request"
	CodeUnauthorized = "unauthorized"
	CodeForbidden    = "forbidden"
	CodeNotFound     = "not_found"
	CodeConflict     = "conflict"
	CodeValidation   = "validation_failed"
	CodeRateLimited  = "rate_limited"
	CodeInternal     = "internal_error"
	CodeWIPLimit     = "wip_limit_reached"
)

// MaxBodyBytes caps request bodies at 1 MiB.
const MaxBodyBytes = 1 << 20

// JSON writes a JSON response with the given status code.
func JSON(w http.ResponseWriter, r *http.Request, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	if payload == nil || status == http.StatusNoContent {
		return
	}
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(payload); err != nil {
		// The status line is already written; log-worthy but unrecoverable.
		slog.ErrorContext(r.Context(), "encode response", "error", err, "path", r.URL.Path)
	}
}

// Fail writes a structured error envelope.
func Fail(w http.ResponseWriter, r *http.Request, status int, code, message string) {
	JSON(w, r, status, ErrorBody{Error: ErrorDetail{
		Code:      code,
		Message:   message,
		RequestID: RequestIDFrom(r.Context()),
	}})
}

// FailFields writes a validation error with per-field messages.
func FailFields(w http.ResponseWriter, r *http.Request, fields map[string]string) {
	JSON(w, r, http.StatusUnprocessableEntity, ErrorBody{Error: ErrorDetail{
		Code:      CodeValidation,
		Message:   "Some fields need attention.",
		Fields:    fields,
		RequestID: RequestIDFrom(r.Context()),
	}})
}

// DecodeJSON reads a JSON body with a size limit and strict field checking.
func DecodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	if ct := r.Header.Get("Content-Type"); ct != "" {
		if mediaType := strings.TrimSpace(strings.Split(ct, ";")[0]); mediaType != "application/json" {
			return fmt.Errorf("expected application/json, got %s", mediaType)
		}
	}
	r.Body = http.MaxBytesReader(w, r.Body, MaxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		var maxErr *http.MaxBytesError
		var syntaxErr *json.SyntaxError
		var typeErr *json.UnmarshalTypeError
		switch {
		case errors.As(err, &maxErr):
			return fmt.Errorf("request body exceeds %d bytes", MaxBodyBytes)
		case errors.As(err, &syntaxErr):
			return fmt.Errorf("malformed JSON at byte %d", syntaxErr.Offset)
		case errors.As(err, &typeErr):
			return fmt.Errorf("field %q expects %s", typeErr.Field, typeErr.Type)
		case errors.Is(err, io.EOF):
			return errors.New("request body is empty")
		default:
			return err
		}
	}
	// Reject trailing garbage so a typo cannot silently truncate a payload.
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("request body must contain a single JSON object")
	}
	return nil
}

// -- request context --------------------------------------------------------

type contextKey string

const (
	ctxRequestID contextKey = "requestID"
	ctxLogger    contextKey = "logger"
)

// RequestIDFrom returns the request correlation id, if any.
func RequestIDFrom(ctx context.Context) string {
	if v, ok := ctx.Value(ctxRequestID).(string); ok {
		return v
	}
	return ""
}

// LoggerFrom returns the request-scoped logger.
func LoggerFrom(ctx context.Context) *slog.Logger {
	if v, ok := ctx.Value(ctxLogger).(*slog.Logger); ok {
		return v
	}
	return slog.Default()
}

// WithRequestID stores a correlation id on the context.
func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, ctxRequestID, id)
}

// -- middleware -------------------------------------------------------------

// Middleware is a standard HTTP decorator.
type Middleware func(http.Handler) http.Handler

// Chain applies middleware so the first argument runs outermost.
func Chain(h http.Handler, middlewares ...Middleware) http.Handler {
	for i := len(middlewares) - 1; i >= 0; i-- {
		h = middlewares[i](h)
	}
	return h
}

type statusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func (r *statusRecorder) Write(b []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	n, err := r.ResponseWriter.Write(b)
	r.bytes += n
	return n, err
}

// Flush lets SSE handlers reach the underlying flusher through the recorder.
func (r *statusRecorder) Flush() {
	if f, ok := r.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// RequestID tags every request with an id, honouring an inbound X-Request-ID.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimSpace(r.Header.Get("X-Request-ID"))
		if id == "" || len(id) > 64 {
			id = uuid.NewString()
		}
		w.Header().Set("X-Request-ID", id)
		next.ServeHTTP(w, r.WithContext(WithRequestID(r.Context(), id)))
	})
}

// Logger emits one structured access log line per request.
func Logger(base *slog.Logger) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w}
			logger := base.With(
				"requestId", RequestIDFrom(r.Context()),
				"method", r.Method,
				"path", r.URL.Path,
			)
			ctx := context.WithValue(r.Context(), ctxLogger, logger)
			next.ServeHTTP(rec, r.WithContext(ctx))

			status := rec.status
			if status == 0 {
				status = http.StatusOK
			}
			level := slog.LevelInfo
			switch {
			case status >= 500:
				level = slog.LevelError
			case status >= 400:
				level = slog.LevelWarn
			}
			logger.Log(ctx, level, "http request",
				"status", status,
				"bytes", rec.bytes,
				"durationMs", time.Since(start).Milliseconds(),
				"remote", ClientIP(r),
			)
		})
	}
}

// Recover converts panics into 500 responses instead of dropping connections.
func Recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				if rec == http.ErrAbortHandler {
					panic(rec)
				}
				LoggerFrom(r.Context()).Error("panic recovered",
					"panic", fmt.Sprint(rec),
					"path", r.URL.Path,
				)
				Fail(w, r, http.StatusInternalServerError, CodeInternal, "Something went wrong on our side.")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// CORS applies an allow-list based cross-origin policy. Allowed origins are
// exact matches; "*" allows any origin (development convenience only).
func CORS(allowed []string) Middleware {
	allowAll := false
	allowedSet := map[string]bool{}
	for _, origin := range allowed {
		if origin == "*" {
			allowAll = true
		}
		allowedSet[strings.ToLower(strings.TrimSpace(origin))] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin != "" {
				_, ok := allowedSet[strings.ToLower(origin)]
				if ok || allowAll {
					w.Header().Set("Access-Control-Allow-Origin", origin)
					w.Header().Set("Vary", "Origin")
					w.Header().Set("Access-Control-Allow-Credentials", "true")
					w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
					w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Request-ID, Last-Event-ID")
					w.Header().Set("Access-Control-Expose-Headers", "X-Request-ID")
					w.Header().Set("Access-Control-Max-Age", "600")
				}
			}
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// SecurityHeaders sets conservative defaults; nginx adds the edge-level ones.
func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		next.ServeHTTP(w, r)
	})
}

// ClientIP extracts the caller's address, trusting X-Forwarded-For only when
// the server is explicitly configured to sit behind a proxy.
func ClientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	return host
}

// -- rate limiting ----------------------------------------------------------

// RateLimiter is a fixed-window limiter keyed by an arbitrary string.
type RateLimiter struct {
	mu      sync.Mutex
	windows map[string]*window
	limit   int
	period  time.Duration
}

type window struct {
	count int
	reset time.Time
}

// NewRateLimiter builds a limiter allowing limit requests per period per key.
func NewRateLimiter(limit int, period time.Duration) *RateLimiter {
	rl := &RateLimiter{
		windows: map[string]*window{},
		limit:   limit,
		period:  period,
	}
	return rl
}

// Allow reports whether the key may proceed, and how long until the window resets.
func (rl *RateLimiter) Allow(key string) (bool, time.Duration) {
	now := time.Now()
	rl.mu.Lock()
	defer rl.mu.Unlock()

	// Opportunistic cleanup keeps the map from growing without bound.
	if len(rl.windows) > 4096 {
		for k, w := range rl.windows {
			if now.After(w.reset) {
				delete(rl.windows, k)
			}
		}
	}
	w, ok := rl.windows[key]
	if !ok || now.After(w.reset) {
		rl.windows[key] = &window{count: 1, reset: now.Add(rl.period)}
		return true, 0
	}
	if w.count >= rl.limit {
		return false, time.Until(w.reset)
	}
	w.count++
	return true, 0
}

// RateLimit rejects callers that exceed the limiter's budget.
func RateLimit(rl *RateLimiter, keyFn func(*http.Request) string) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := keyFn(r)
			ok, retryAfter := rl.Allow(key)
			if !ok {
				w.Header().Set("Retry-After", fmt.Sprintf("%d", int(retryAfter.Seconds())+1))
				Fail(w, r, http.StatusTooManyRequests, CodeRateLimited, "Too many requests — slow down a moment.")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// Timeout bounds handler execution.
func Timeout(d time.Duration) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(r.Context(), d)
			defer cancel()
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
