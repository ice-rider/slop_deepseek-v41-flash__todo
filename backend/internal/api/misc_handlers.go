package api

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/flowboard/flowboard/backend/internal/httpx"
	"github.com/flowboard/flowboard/backend/internal/realtime"
	"github.com/flowboard/flowboard/backend/internal/store"
)

// -- service endpoints -------------------------------------------------------

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, r, http.StatusOK, map[string]any{
		"status":  "ok",
		"version": Version,
		"uptime":  time.Since(s.startedAt).Round(time.Second).String(),
	})
}

// handleReady verifies dependencies before a load balancer sends traffic.
func (s *Server) handleReady(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := contextWithTimeout(r, 3*time.Second)
	defer cancel()
	if err := s.store.DB().PingContext(ctx); err != nil {
		httpx.JSON(w, r, http.StatusServiceUnavailable, map[string]any{
			"status": "degraded",
			"error":  "database unavailable",
		})
		return
	}
	boards, subscribers := s.hub.Counts()
	httpx.JSON(w, r, http.StatusOK, map[string]any{
		"status":           "ready",
		"version":          Version,
		"activeBoards":     boards,
		"eventSubscribers": subscribers,
	})
}

// handleMeta describes the API surface so the frontend can stay declarative.
func (s *Server) handleMeta(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, r, http.StatusOK, map[string]any{
		"name":       "FlowBoard API",
		"version":    Version,
		"commit":     Commit,
		"builtAt":    BuildTime,
		"env":        s.cfg.Env,
		"startedAt":  s.startedAt,
		"priorities": []string{"low", "medium", "high", "urgent"},
		"templates": []map[string]string{
			{"id": "kanban", "name": "Classic kanban", "description": "Backlog → To do → In progress → Review → Done"},
			{"id": "sprint", "name": "Sprint board", "description": "Sprint backlog → In progress → Blocked → Done"},
			{"id": "personal", "name": "Personal planner", "description": "Today → This week → Someday → Done"},
			{"id": "blank", "name": "Simple list", "description": "To do → Done"},
		},
		"roles": []string{"owner", "editor", "viewer"},
	})
}

// -- views -------------------------------------------------------------------

func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	user := userFrom(r.Context())
	filter, err := parseCardFilter(r, user.ID)
	if err != nil {
		httpx.FailFields(w, r, map[string]string{"filter": err.Error()})
		return
	}
	hits, err := s.store.SearchCards(r.Context(), user.ID, filter)
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	httpx.JSON(w, r, http.StatusOK, map[string]any{
		"cards": hits,
		"count": len(hits),
	})
}

func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	user := userFrom(r.Context())
	boardID := strings.TrimSpace(r.URL.Query().Get("boardId"))
	if boardID != "" {
		if _, ok := s.authorizeBoard(w, r, boardID, false); !ok {
			return
		}
	}
	stats, err := s.store.Stats(r.Context(), user.ID, boardID)
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	httpx.JSON(w, r, http.StatusOK, map[string]any{"stats": stats})
}

func (s *Server) handleDashboard(w http.ResponseWriter, r *http.Request) {
	user := userFrom(r.Context())
	stats, err := s.store.Stats(r.Context(), user.ID, "")
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	sections, err := s.store.DashboardFeed(r.Context(), user.ID, 8)
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	boards, err := s.store.ListBoards(r.Context(), user.ID, false)
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	httpx.JSON(w, r, http.StatusOK, map[string]any{
		"stats":    stats,
		"sections": sections,
		"boards":   boards,
	})
}

// parseCardFilter turns query parameters into a store filter.
func parseCardFilter(r *http.Request, userID string) (store.CardFilter, error) {
	q := r.URL.Query()
	filter := store.CardFilter{
		Query:           strings.TrimSpace(q.Get("q")),
		BoardID:         strings.TrimSpace(q.Get("boardId")),
		Sort:            strings.TrimSpace(q.Get("sort")),
		IncludeArchived: q.Get("archived") == "true",
	}
	if raw := strings.TrimSpace(q.Get("limit")); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit <= 0 || limit > 200 {
			return filter, errors.New("limit must be between 1 and 200")
		}
		filter.Limit = limit
	}
	if raw := strings.TrimSpace(q.Get("offset")); raw != "" {
		offset, err := strconv.Atoi(raw)
		if err != nil || offset < 0 {
			return filter, errors.New("offset must be zero or greater")
		}
		filter.Offset = offset
	}
	for _, raw := range q["priority"] {
		for _, part := range strings.Split(raw, ",") {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			if level, ok := priorityFromString(part); ok {
				filter.Priorities = append(filter.Priorities, level)
				continue
			}
			return filter, fmt.Errorf("unknown priority %q", part)
		}
	}
	for _, raw := range q["label"] {
		for _, part := range strings.Split(raw, ",") {
			if part = strings.TrimSpace(part); part != "" {
				filter.LabelIDs = append(filter.LabelIDs, part)
			}
		}
	}
	switch assignee := strings.TrimSpace(q.Get("assignee")); assignee {
	case "":
	case "me":
		filter.AssigneeID = userID
	case "unassigned", "none":
		filter.Unassigned = true
	default:
		filter.AssigneeID = assignee
	}
	if done := strings.TrimSpace(q.Get("completed")); done != "" {
		filter.CompletedOnly = done == "true"
	}

	now := time.Now().UTC()
	startOfDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	switch due := strings.TrimSpace(q.Get("due")); due {
	case "":
	case "overdue":
		filter.OverdueOnly = true
	case "today":
		end := startOfDay.Add(24 * time.Hour)
		filter.DueAfter, filter.DueBefore = &startOfDay, &end
	case "week":
		end := startOfDay.AddDate(0, 0, 7)
		filter.DueAfter, filter.DueBefore = &startOfDay, &end
	case "none":
		no := false
		filter.HasDueDate = &no
	case "any":
		yes := true
		filter.HasDueDate = &yes
	default:
		return filter, fmt.Errorf("unknown due filter %q", due)
	}
	return filter, nil
}

func priorityFromString(value string) (int, bool) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "0", "low":
		return int(store.PriorityLow), true
	case "1", "medium", "normal":
		return int(store.PriorityMedium), true
	case "2", "high":
		return int(store.PriorityHigh), true
	case "3", "urgent", "critical":
		return int(store.PriorityUrgent), true
	default:
		return 0, false
	}
}

// -- server-sent events ------------------------------------------------------

// handleEvents streams board changes to a browser. Clients reconnect
// automatically; a resync event tells them to refetch authoritative state.
func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	user := userFrom(r.Context())
	boardID := strings.TrimSpace(r.URL.Query().Get("boardId"))
	if boardID != "" {
		if _, ok := s.authorizeBoard(w, r, boardID, false); !ok {
			return
		}
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternal, "Streaming is not supported by this connection.")
		return
	}

	header := w.Header()
	header.Set("Content-Type", "text/event-stream; charset=utf-8")
	header.Set("Cache-Control", "no-cache, no-transform")
	header.Set("Connection", "keep-alive")
	// nginx buffers proxied responses by default, which would defeat SSE.
	header.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	subscription := s.hub.Subscribe(user.ID, boardID)
	defer subscription.Close()

	writeEvent := func(event realtime.Event) bool {
		if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event.Type, mustJSON(event)); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}

	// The opening frame tells the client the stream is live and which user it
	// belongs to, so the UI can show the realtime indicator immediately.
	if !writeEvent(realtime.Event{Type: "hello", BoardID: boardID, ActorID: user.ID, ActorName: user.Name, At: time.Now().UTC()}) {
		return
	}

	heartbeat := time.NewTicker(20 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case event, open := <-subscription.C:
			if !open {
				return
			}
			if !writeEvent(event) {
				return
			}
		case <-heartbeat.C:
			// A comment frame keeps intermediaries from closing an idle stream.
			if _, err := fmt.Fprint(w, ": keep-alive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}
