package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/flowboard/flowboard/backend/internal/api"
	"github.com/flowboard/flowboard/backend/internal/auth"
	"github.com/flowboard/flowboard/backend/internal/config"
	"github.com/flowboard/flowboard/backend/internal/realtime"
	"github.com/flowboard/flowboard/backend/internal/store"
)

// harness bundles a running test server with the pieces a test needs to poke at.
type harness struct {
	t      *testing.T
	server *httptest.Server
	store  *store.Store
	hub    *realtime.Hub
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	db, err := store.Open(context.Background(), store.Options{
		Path:         filepath.Join(t.TempDir(), "api-test.db"),
		MaxOpenConns: 4,
	})
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	tokens, err := auth.NewTokenIssuer([]byte("integration-test-secret"), 30*time.Minute)
	if err != nil {
		t.Fatalf("token issuer: %v", err)
	}
	hub := realtime.NewHub()
	cfg := config.Config{
		Env:            "test",
		AllowedOrigins: []string{"*"},
		AccessTTL:      30 * time.Minute,
		RefreshTTL:     time.Hour,
		JWTSecret:      []byte("integration-test-secret"),
	}
	server := api.New(api.Options{
		Store:  db,
		Tokens: tokens,
		Hub:    hub,
		Config: cfg,
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})

	httpServer := httptest.NewServer(server.Handler())
	t.Cleanup(func() {
		httpServer.Close()
		hub.Close()
		db.Close()
	})
	return &harness{t: t, server: httpServer, store: db, hub: hub}
}

// do issues a request and decodes the JSON response into out (when non-nil).
func (h *harness) do(method, path, token string, body any, out any) *http.Response {
	h.t.Helper()
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			h.t.Fatalf("marshal body: %v", err)
		}
		reader = bytes.NewReader(encoded)
	}
	req, err := http.NewRequest(method, h.server.URL+path, reader)
	if err != nil {
		h.t.Fatalf("new request: %v", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		h.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	if out != nil {
		payload, err := io.ReadAll(resp.Body)
		if err != nil {
			h.t.Fatalf("read body: %v", err)
		}
		if len(payload) > 0 {
			if err := json.Unmarshal(payload, out); err != nil {
				h.t.Fatalf("decode %s %s response %q: %v", method, path, string(payload), err)
			}
		}
	}
	return resp
}

type sessionPayload struct {
	User         store.User `json:"user"`
	AccessToken  string     `json:"accessToken"`
	RefreshToken string     `json:"refreshToken"`
	ExpiresIn    int        `json:"expiresIn"`
}

func (h *harness) register(email, name, password string) sessionPayload {
	h.t.Helper()
	var session sessionPayload
	resp := h.do(http.MethodPost, "/api/v1/auth/register", "", map[string]string{
		"email": email, "name": name, "password": password,
	}, &session)
	if resp.StatusCode != http.StatusOK {
		h.t.Fatalf("register returned %d", resp.StatusCode)
	}
	if session.AccessToken == "" || session.RefreshToken == "" {
		h.t.Fatalf("register did not return tokens: %+v", session)
	}
	return session
}

func TestHealthAndMetaArePublic(t *testing.T) {
	h := newHarness(t)

	var health map[string]any
	if resp := h.do(http.MethodGet, "/healthz", "", nil, &health); resp.StatusCode != http.StatusOK {
		t.Fatalf("healthz returned %d", resp.StatusCode)
	}
	if health["status"] != "ok" {
		t.Fatalf("unexpected health payload: %+v", health)
	}

	var ready map[string]any
	if resp := h.do(http.MethodGet, "/readyz", "", nil, &ready); resp.StatusCode != http.StatusOK {
		t.Fatalf("readyz returned %d", resp.StatusCode)
	}

	var meta struct {
		Priorities []string `json:"priorities"`
		Templates  []struct {
			ID string `json:"id"`
		} `json:"templates"`
	}
	if resp := h.do(http.MethodGet, "/api/v1/meta", "", nil, &meta); resp.StatusCode != http.StatusOK {
		t.Fatalf("meta returned %d", resp.StatusCode)
	}
	if len(meta.Priorities) != 4 || len(meta.Templates) != 4 {
		t.Fatalf("meta is incomplete: %+v", meta)
	}
}

func TestProtectedRoutesRequireAToken(t *testing.T) {
	h := newHarness(t)
	for _, path := range []string{"/api/v1/boards", "/api/v1/auth/me", "/api/v1/stats"} {
		resp := h.do(http.MethodGet, path, "", nil, nil)
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("%s returned %d, want 401", path, resp.StatusCode)
		}
	}
	resp := h.do(http.MethodGet, "/api/v1/boards", "not-a-real-token", nil, nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("garbage token returned %d, want 401", resp.StatusCode)
	}
}

func TestRegistrationValidation(t *testing.T) {
	h := newHarness(t)
	var payload struct {
		Error struct {
			Code   string            `json:"code"`
			Fields map[string]string `json:"fields"`
		} `json:"error"`
	}
	resp := h.do(http.MethodPost, "/api/v1/auth/register", "", map[string]string{
		"email": "not-an-email", "name": "", "password": "short",
	}, &payload)
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d", resp.StatusCode)
	}
	for _, field := range []string{"email", "name", "password"} {
		if payload.Error.Fields[field] == "" {
			t.Fatalf("missing validation message for %q: %+v", field, payload.Error.Fields)
		}
	}
}

func TestLoginRefreshAndLogout(t *testing.T) {
	h := newHarness(t)
	h.register("user@example.com", "User", "supersecret")

	var session sessionPayload
	resp := h.do(http.MethodPost, "/api/v1/auth/login", "", map[string]string{
		"email": "user@example.com", "password": "supersecret",
	}, &session)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login returned %d", resp.StatusCode)
	}

	// Wrong password and unknown account must be indistinguishable.
	var failure struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	resp = h.do(http.MethodPost, "/api/v1/auth/login", "", map[string]string{
		"email": "user@example.com", "password": "wrong-password",
	}, &failure)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("bad login returned %d, want 401", resp.StatusCode)
	}
	wrongPasswordMessage := failure.Error.Message

	var unknownUser struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	resp = h.do(http.MethodPost, "/api/v1/auth/login", "", map[string]string{
		"email": "nobody@example.com", "password": "wrong-password",
	}, &unknownUser)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unknown account returned %d, want 401", resp.StatusCode)
	}
	if unknownUser.Error.Message != wrongPasswordMessage {
		t.Fatalf("login errors differ and leak account existence: %q vs %q",
			wrongPasswordMessage, unknownUser.Error.Message)
	}

	var refreshed sessionPayload
	resp = h.do(http.MethodPost, "/api/v1/auth/refresh", "", map[string]string{
		"refreshToken": session.RefreshToken,
	}, &refreshed)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("refresh returned %d", resp.StatusCode)
	}
	if refreshed.RefreshToken == session.RefreshToken {
		t.Fatal("refresh did not rotate the token")
	}

	// The rotated-away token must no longer work.
	resp = h.do(http.MethodPost, "/api/v1/auth/refresh", "", map[string]string{
		"refreshToken": session.RefreshToken,
	}, nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("reused refresh token returned %d, want 401", resp.StatusCode)
	}

	resp = h.do(http.MethodPost, "/api/v1/auth/logout", "", map[string]string{
		"refreshToken": refreshed.RefreshToken,
	}, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("logout returned %d", resp.StatusCode)
	}
	resp = h.do(http.MethodPost, "/api/v1/auth/refresh", "", map[string]string{
		"refreshToken": refreshed.RefreshToken,
	}, nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("refresh after logout returned %d, want 401", resp.StatusCode)
	}
}

func TestBoardLifecycleOverHTTP(t *testing.T) {
	h := newHarness(t)
	session := h.register("board@example.com", "Board Owner", "supersecret")

	var created struct {
		Board    store.Board         `json:"board"`
		Snapshot store.BoardSnapshot `json:"snapshot"`
	}
	resp := h.do(http.MethodPost, "/api/v1/boards", session.AccessToken, map[string]any{
		"title": "Launch", "description": "Ship it", "template": "kanban", "color": "indigo",
	}, &created)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create board returned %d", resp.StatusCode)
	}
	if len(created.Snapshot.Columns) != 5 {
		t.Fatalf("expected 5 template columns, got %d", len(created.Snapshot.Columns))
	}
	inProgress := created.Snapshot.Columns[2]

	var cardEnvelope struct {
		Card store.Card `json:"card"`
	}
	due := time.Now().UTC().Add(48 * time.Hour).Format(time.RFC3339)
	resp = h.do(http.MethodPost, "/api/v1/columns/"+inProgress.ID+"/cards", session.AccessToken, map[string]any{
		"title": "Write the docs", "priority": 2, "dueDate": due,
	}, &cardEnvelope)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create card returned %d", resp.StatusCode)
	}
	card := cardEnvelope.Card
	if card.Priority != store.PriorityHigh {
		t.Fatalf("priority not applied: %d", card.Priority)
	}
	if card.DueDate == nil {
		t.Fatal("due date was not applied")
	}

	// Patch the card with an explicit null assignee, which must be accepted.
	var patched struct {
		Card store.Card `json:"card"`
	}
	resp = h.do(http.MethodPatch, "/api/v1/cards/"+card.ID, session.AccessToken, map[string]any{
		"title": "Write better docs", "assigneeId": nil,
	}, &patched)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("patch card returned %d", resp.StatusCode)
	}
	if patched.Card.Title != "Write better docs" {
		t.Fatalf("title was not updated: %+v", patched.Card)
	}

	// Move it to Done.
	var moved struct {
		Card store.Card `json:"card"`
	}
	done := created.Snapshot.Columns[4]
	resp = h.do(http.MethodPost, "/api/v1/cards/"+card.ID+"/move", session.AccessToken, map[string]any{
		"columnId": done.ID, "position": 0,
	}, &moved)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("move card returned %d", resp.StatusCode)
	}
	if moved.Card.ColumnID != done.ID || moved.Card.CompletedAt == nil {
		t.Fatalf("unexpected move result: %+v", moved.Card)
	}

	// The board snapshot must reflect the move.
	var snapshot store.BoardSnapshot
	resp = h.do(http.MethodGet, "/api/v1/boards/"+created.Board.ID, session.AccessToken, nil, &snapshot)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get board returned %d", resp.StatusCode)
	}
	if len(snapshot.Cards) != 1 || snapshot.Cards[0].ColumnID != done.ID {
		t.Fatalf("snapshot does not reflect the move: %+v", snapshot.Cards)
	}
	if len(snapshot.Members) != 1 || len(snapshot.Activity) == 0 {
		t.Fatalf("snapshot is missing members or activity: %+v", snapshot)
	}

	// Stats endpoint.
	var statsEnvelope struct {
		Stats store.Stats `json:"stats"`
	}
	resp = h.do(http.MethodGet, "/api/v1/boards/"+created.Board.ID+"/stats", session.AccessToken, nil, &statsEnvelope)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("stats returned %d", resp.StatusCode)
	}
	if statsEnvelope.Stats.TotalCards != 1 || statsEnvelope.Stats.CompletedCards != 1 {
		t.Fatalf("unexpected stats: %+v", statsEnvelope.Stats)
	}

	// Delete the board and confirm it is gone.
	resp = h.do(http.MethodDelete, "/api/v1/boards/"+created.Board.ID, session.AccessToken, nil, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete board returned %d", resp.StatusCode)
	}
	resp = h.do(http.MethodGet, "/api/v1/boards/"+created.Board.ID, session.AccessToken, nil, nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("deleted board returned %d, want 404", resp.StatusCode)
	}
}

func TestCrossUserAccessIsDenied(t *testing.T) {
	h := newHarness(t)
	owner := h.register("owner@example.com", "Owner", "supersecret")
	intruder := h.register("intruder@example.com", "Intruder", "supersecret")

	var created struct {
		Board    store.Board         `json:"board"`
		Snapshot store.BoardSnapshot `json:"snapshot"`
	}
	h.do(http.MethodPost, "/api/v1/boards", owner.AccessToken, map[string]any{"title": "Private"}, &created)

	resp := h.do(http.MethodGet, "/api/v1/boards/"+created.Board.ID, intruder.AccessToken, nil, nil)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("intruder read returned %d, want 403", resp.StatusCode)
	}
	resp = h.do(http.MethodPost, "/api/v1/boards/"+created.Board.ID+"/columns", intruder.AccessToken, map[string]any{"title": "Nope"}, nil)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("intruder write returned %d, want 403", resp.StatusCode)
	}

	// Share the board and confirm the new member can read but not delete.
	resp = h.do(http.MethodPost, "/api/v1/boards/"+created.Board.ID+"/members", owner.AccessToken, map[string]any{
		"email": "intruder@example.com", "role": "viewer",
	}, nil)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("add member returned %d", resp.StatusCode)
	}
	resp = h.do(http.MethodGet, "/api/v1/boards/"+created.Board.ID, intruder.AccessToken, nil, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("member read returned %d, want 200", resp.StatusCode)
	}
	resp = h.do(http.MethodPost, "/api/v1/columns/"+created.Snapshot.Columns[0].ID+"/cards", intruder.AccessToken, map[string]any{"title": "Sneaky"}, nil)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("viewer write returned %d, want 403", resp.StatusCode)
	}
	resp = h.do(http.MethodDelete, "/api/v1/boards/"+created.Board.ID, intruder.AccessToken, nil, nil)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("non-owner delete returned %d, want 403", resp.StatusCode)
	}
}

func TestWIPLimitReturnsConflict(t *testing.T) {
	h := newHarness(t)
	session := h.register("wip@example.com", "WIP", "supersecret")

	var created struct {
		Board store.Board `json:"board"`
	}
	h.do(http.MethodPost, "/api/v1/boards", session.AccessToken, map[string]any{"title": "WIP board"}, &created)

	var column struct {
		Column store.Column `json:"column"`
	}
	resp := h.do(http.MethodPost, "/api/v1/boards/"+created.Board.ID+"/columns", session.AccessToken, map[string]any{
		"title": "Limited", "wipLimit": 1,
	}, &column)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create column returned %d", resp.StatusCode)
	}

	h.do(http.MethodPost, "/api/v1/columns/"+column.Column.ID+"/cards", session.AccessToken, map[string]any{"title": "First"}, nil)
	var failure struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	resp = h.do(http.MethodPost, "/api/v1/columns/"+column.Column.ID+"/cards", session.AccessToken, map[string]any{"title": "Second"}, &failure)
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("second card returned %d, want 409", resp.StatusCode)
	}
	if failure.Error.Code != "wip_limit_reached" {
		t.Fatalf("unexpected error code %q", failure.Error.Code)
	}
}

func TestSearchAndDashboard(t *testing.T) {
	h := newHarness(t)
	session := h.register("search@example.com", "Searcher", "supersecret")

	var created struct {
		Snapshot store.BoardSnapshot `json:"snapshot"`
	}
	h.do(http.MethodPost, "/api/v1/boards", session.AccessToken, map[string]any{"title": "Findable"}, &created)
	columnID := created.Snapshot.Columns[0].ID

	h.do(http.MethodPost, "/api/v1/columns/"+columnID+"/cards", session.AccessToken, map[string]any{
		"title": "Refactor the search index", "priority": 3,
	}, nil)
	h.do(http.MethodPost, "/api/v1/columns/"+columnID+"/cards", session.AccessToken, map[string]any{
		"title": "Unrelated chore", "priority": 0,
	}, nil)

	var results struct {
		Cards []store.SearchHit `json:"cards"`
		Count int               `json:"count"`
	}
	resp := h.do(http.MethodGet, "/api/v1/search?q=search&priority=urgent", session.AccessToken, nil, &results)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("search returned %d", resp.StatusCode)
	}
	if results.Count != 1 || results.Cards[0].Title != "Refactor the search index" {
		t.Fatalf("unexpected search results: %+v", results)
	}

	// A bad filter value must be reported as a validation problem.
	resp = h.do(http.MethodGet, "/api/v1/search?due=whenever", session.AccessToken, nil, nil)
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("bad filter returned %d, want 422", resp.StatusCode)
	}

	var dashboard struct {
		Stats    store.Stats                  `json:"stats"`
		Sections map[string][]store.SearchHit `json:"sections"`
		Boards   []store.BoardSummary         `json:"boards"`
	}
	resp = h.do(http.MethodGet, "/api/v1/dashboard", session.AccessToken, nil, &dashboard)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("dashboard returned %d", resp.StatusCode)
	}
	if dashboard.Stats.TotalCards != 2 {
		t.Fatalf("dashboard stats wrong: %+v", dashboard.Stats)
	}
	if len(dashboard.Sections["recent"]) != 2 {
		t.Fatalf("dashboard recent rail wrong: %+v", dashboard.Sections["recent"])
	}
	if len(dashboard.Boards) != 1 {
		t.Fatalf("dashboard boards wrong: %+v", dashboard.Boards)
	}
}

func TestRealtimeStreamBroadcastsChanges(t *testing.T) {
	h := newHarness(t)
	session := h.register("stream@example.com", "Streamer", "supersecret")

	var created struct {
		Board    store.Board         `json:"board"`
		Snapshot store.BoardSnapshot `json:"snapshot"`
	}
	h.do(http.MethodPost, "/api/v1/boards", session.AccessToken, map[string]any{"title": "Live board"}, &created)

	// EventSource cannot set headers, so the token also travels as a query param.
	req, err := http.NewRequest(http.MethodGet,
		h.server.URL+"/api/v1/events?boardId="+created.Board.ID+"&access_token="+session.AccessToken, nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("connect to stream: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("stream returned %d", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/event-stream") {
		t.Fatalf("unexpected content type %q", ct)
	}

	events := make(chan string, 8)
	go func() {
		buf := make([]byte, 4096)
		var acc string
		for {
			n, err := resp.Body.Read(buf)
			if n > 0 {
				acc += string(buf[:n])
				for {
					idx := strings.Index(acc, "\n\n")
					if idx < 0 {
						break
					}
					frame := acc[:idx]
					acc = acc[idx+2:]
					if name, ok := eventName(frame); ok {
						events <- name
					}
				}
			}
			if err != nil {
				return
			}
		}
	}()

	waitForEvent := func(want string, timeout time.Duration) {
		t.Helper()
		deadline := time.After(timeout)
		for {
			select {
			case got := <-events:
				if got == want {
					return
				}
			case <-deadline:
				t.Fatalf("timed out waiting for %q", want)
			}
		}
	}

	waitForEvent("hello", 3*time.Second)

	createResp := h.do(http.MethodPost, "/api/v1/columns/"+created.Snapshot.Columns[0].ID+"/cards", session.AccessToken,
		map[string]any{"title": "Streamed card"}, nil)
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("card creation returned %d", createResp.StatusCode)
	}
	waitForEvent("card.created", 5*time.Second)

	h.do(http.MethodPost, "/api/v1/boards", session.AccessToken, map[string]any{"title": "Second board"}, nil)
	// A board-scoped stream must not surface another board's events.
	select {
	case got := <-events:
		if got != "resync" {
			t.Fatalf("board-scoped stream leaked event %q", got)
		}
	case <-time.After(300 * time.Millisecond):
	}
}

func eventName(frame string) (string, bool) {
	for _, line := range strings.Split(frame, "\n") {
		if after, ok := strings.CutPrefix(line, "event: "); ok {
			return strings.TrimSpace(after), true
		}
	}
	return "", false
}

func TestRateLimiterRejectsLoginBruteForce(t *testing.T) {
	h := newHarness(t)
	h.register("rate@example.com", "Rate", "supersecret")

	var lastStatus int
	for i := 0; i < 25; i++ {
		resp := h.do(http.MethodPost, "/api/v1/auth/login", "", map[string]string{
			"email": "rate@example.com", "password": fmt.Sprintf("guess-%d", i),
		}, nil)
		lastStatus = resp.StatusCode
		if lastStatus == http.StatusTooManyRequests {
			return
		}
	}
	t.Fatalf("expected to be rate limited, last status was %d", lastStatus)
}
