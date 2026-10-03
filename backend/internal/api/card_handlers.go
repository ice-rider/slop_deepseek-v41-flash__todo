package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/flowboard/flowboard/backend/internal/httpx"
	"github.com/flowboard/flowboard/backend/internal/realtime"
	"github.com/flowboard/flowboard/backend/internal/store"
)

// Payloads. Nullable JSON fields use json.RawMessage so the handler can tell
// "field absent" (leave unchanged) from "explicit null" (clear the value).

type createCardRequest struct {
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Priority    int      `json:"priority"`
	DueDate     *string  `json:"dueDate"`
	AssigneeID  *string  `json:"assigneeId"`
	CoverColor  string   `json:"coverColor"`
	LabelIDs    []string `json:"labelIds"`
}

type updateCardRequest struct {
	Title       *string         `json:"title"`
	Description *string         `json:"description"`
	Priority    *int            `json:"priority"`
	DueDate     json.RawMessage `json:"dueDate"`
	AssigneeID  json.RawMessage `json:"assigneeId"`
	CoverColor  *string         `json:"coverColor"`
	Archived    *bool           `json:"archived"`
	LabelIDs    *[]string       `json:"labelIds"`
}

type moveCardRequest struct {
	ColumnID string `json:"columnId"`
	Position int    `json:"position"`
}

type attachLabelRequest struct {
	LabelID string `json:"labelId"`
}

type checklistItemRequest struct {
	Text string `json:"text"`
}

type updateChecklistItemRequest struct {
	Text *string `json:"text"`
	Done *bool   `json:"done"`
}

type commentRequest struct {
	Body string `json:"body"`
}

// parseNullableTime decodes an optional timestamp field that may be absent,
// null, an empty string, or an RFC3339 string.
func parseNullableTime(raw json.RawMessage) (store.Nullable[time.Time], error) {
	result := store.Nullable[time.Time]{}
	if len(raw) == 0 {
		return result, nil
	}
	trimmed := bytes.TrimSpace(raw)
	result.Set = true
	if bytes.Equal(trimmed, []byte("null")) {
		return result, nil
	}
	var asString string
	if err := json.Unmarshal(trimmed, &asString); err != nil {
		return result, fmt.Errorf("dueDate must be an ISO-8601 string or null")
	}
	asString = strings.TrimSpace(asString)
	if asString == "" {
		return result, nil
	}
	parsed, err := parseFlexibleTime(asString)
	if err != nil {
		return result, fmt.Errorf("dueDate must be an ISO-8601 timestamp")
	}
	result.Value = &parsed
	return result, nil
}

// parseNullableID decodes an optional identifier field.
func parseNullableID(raw json.RawMessage) (store.Nullable[string], error) {
	result := store.Nullable[string]{}
	if len(raw) == 0 {
		return result, nil
	}
	trimmed := bytes.TrimSpace(raw)
	result.Set = true
	if bytes.Equal(trimmed, []byte("null")) {
		return result, nil
	}
	var asString string
	if err := json.Unmarshal(trimmed, &asString); err != nil {
		return result, fmt.Errorf("expected a string id or null")
	}
	asString = strings.TrimSpace(asString)
	if asString == "" {
		return result, nil
	}
	result.Value = &asString
	return result, nil
}

// parseFlexibleTime accepts RFC3339 and the date-only form that browsers send
// from an <input type="date"> control.
func parseFlexibleTime(value string) (time.Time, error) {
	if t, err := time.Parse(time.RFC3339, value); err == nil {
		return t.UTC(), nil
	}
	if t, err := time.Parse("2006-01-02", value); err == nil {
		return t.UTC(), nil
	}
	return time.Time{}, fmt.Errorf("unrecognised timestamp %q", value)
}

// -- cards ------------------------------------------------------------------

func (s *Server) handleCreateCard(w http.ResponseWriter, r *http.Request) {
	columnID := r.PathValue("columnID")
	boardID, ok := s.authorizeColumnBoard(w, r, columnID, true)
	if !ok {
		return
	}
	if !s.allow(w, r, s.writeLimiter, "write:"+clientKey(r)) {
		return
	}
	var req createCardRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.Fail(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(req.Title) == "" {
		httpx.FailFields(w, r, map[string]string{"title": "Cards need a title."})
		return
	}
	var due *time.Time
	if req.DueDate != nil && strings.TrimSpace(*req.DueDate) != "" {
		parsed, err := parseFlexibleTime(strings.TrimSpace(*req.DueDate))
		if err != nil {
			httpx.FailFields(w, r, map[string]string{"dueDate": "Due date must be an ISO-8601 timestamp."})
			return
		}
		due = &parsed
	}
	user := userFrom(r.Context())
	card, err := s.store.CreateCard(r.Context(), columnID, store.CardInput{
		Title:       req.Title,
		Description: req.Description,
		Priority:    req.Priority,
		DueDate:     due,
		AssigneeID:  req.AssigneeID,
		CoverColor:  req.CoverColor,
		LabelIDs:    req.LabelIDs,
	}, user.ID)
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	s.publish(realtime.Event{
		Type:      realtime.TypeCardCreated,
		BoardID:   boardID,
		CardID:    card.ID,
		ActorID:   user.ID,
		ActorName: user.Name,
		Summary:   card.Title,
		At:        time.Now().UTC(),
	})
	httpx.JSON(w, r, http.StatusCreated, map[string]any{"card": card})
}

func (s *Server) handleGetCard(w http.ResponseWriter, r *http.Request) {
	cardID := r.PathValue("cardID")
	if _, ok := s.authorizeCardBoard(w, r, cardID, false); !ok {
		return
	}
	detail, err := s.store.CardDetail(r.Context(), cardID)
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	httpx.JSON(w, r, http.StatusOK, map[string]any{"card": detail})
}

func (s *Server) handleUpdateCard(w http.ResponseWriter, r *http.Request) {
	cardID := r.PathValue("cardID")
	boardID, ok := s.authorizeCardBoard(w, r, cardID, true)
	if !ok {
		return
	}
	var req updateCardRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.Fail(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
		return
	}
	if req.Title != nil && strings.TrimSpace(*req.Title) == "" {
		httpx.FailFields(w, r, map[string]string{"title": "Card title cannot be blank."})
		return
	}
	due, err := parseNullableTime(req.DueDate)
	if err != nil {
		httpx.FailFields(w, r, map[string]string{"dueDate": err.Error()})
		return
	}
	assignee, err := parseNullableID(req.AssigneeID)
	if err != nil {
		httpx.FailFields(w, r, map[string]string{"assigneeId": err.Error()})
		return
	}
	user := userFrom(r.Context())
	card, err := s.store.UpdateCard(r.Context(), cardID, store.CardPatch{
		Title:       req.Title,
		Description: req.Description,
		Priority:    req.Priority,
		DueDate:     due,
		AssigneeID:  assignee,
		CoverColor:  req.CoverColor,
		Archived:    req.Archived,
		LabelIDs:    req.LabelIDs,
	}, user.ID)
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	s.publish(realtime.Event{
		Type:      realtime.TypeCardUpdated,
		BoardID:   boardID,
		CardID:    card.ID,
		ActorID:   user.ID,
		ActorName: user.Name,
		Summary:   card.Title,
		At:        time.Now().UTC(),
	})
	httpx.JSON(w, r, http.StatusOK, map[string]any{"card": card})
}

func (s *Server) handleDeleteCard(w http.ResponseWriter, r *http.Request) {
	cardID := r.PathValue("cardID")
	boardID, ok := s.authorizeCardBoard(w, r, cardID, true)
	if !ok {
		return
	}
	user := userFrom(r.Context())
	if r.URL.Query().Get("hard") == "true" {
		if err := s.store.DeleteCard(r.Context(), cardID, user.ID); err != nil {
			s.failStore(w, r, err)
			return
		}
	} else {
		archived := true
		if _, err := s.store.UpdateCard(r.Context(), cardID, store.CardPatch{Archived: &archived}, user.ID); err != nil {
			s.failStore(w, r, err)
			return
		}
	}
	s.publish(realtime.Event{
		Type:      realtime.TypeCardDeleted,
		BoardID:   boardID,
		CardID:    cardID,
		ActorID:   user.ID,
		ActorName: user.Name,
		At:        time.Now().UTC(),
	})
	httpx.JSON(w, r, http.StatusNoContent, nil)
}

func (s *Server) handleMoveCard(w http.ResponseWriter, r *http.Request) {
	cardID := r.PathValue("cardID")
	boardID, ok := s.authorizeCardBoard(w, r, cardID, true)
	if !ok {
		return
	}
	var req moveCardRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.Fail(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
		return
	}
	user := userFrom(r.Context())
	card, err := s.store.MoveCard(r.Context(), cardID, strings.TrimSpace(req.ColumnID), req.Position, user.ID)
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	s.publish(realtime.Event{
		Type:      realtime.TypeCardMoved,
		BoardID:   boardID,
		CardID:    card.ID,
		ActorID:   user.ID,
		ActorName: user.Name,
		Data:      map[string]any{"columnId": card.ColumnID, "position": card.Position},
		At:        time.Now().UTC(),
	})
	httpx.JSON(w, r, http.StatusOK, map[string]any{"card": card})
}

// -- labels on cards --------------------------------------------------------

func (s *Server) handleAttachLabel(w http.ResponseWriter, r *http.Request) {
	cardID := r.PathValue("cardID")
	boardID, ok := s.authorizeCardBoard(w, r, cardID, true)
	if !ok {
		return
	}
	var req attachLabelRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.Fail(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(req.LabelID) == "" {
		httpx.FailFields(w, r, map[string]string{"labelId": "A label id is required."})
		return
	}
	if err := s.store.AddCardLabel(r.Context(), cardID, req.LabelID); err != nil {
		s.failStore(w, r, err)
		return
	}
	s.publishLabelChange(r, boardID, cardID)
	detail, err := s.store.CardDetail(r.Context(), cardID)
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	httpx.JSON(w, r, http.StatusOK, map[string]any{"card": detail})
}

func (s *Server) handleDetachLabel(w http.ResponseWriter, r *http.Request) {
	cardID := r.PathValue("cardID")
	boardID, ok := s.authorizeCardBoard(w, r, cardID, true)
	if !ok {
		return
	}
	if err := s.store.RemoveCardLabel(r.Context(), cardID, r.PathValue("labelID")); err != nil {
		s.failStore(w, r, err)
		return
	}
	s.publishLabelChange(r, boardID, cardID)
	detail, err := s.store.CardDetail(r.Context(), cardID)
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	httpx.JSON(w, r, http.StatusOK, map[string]any{"card": detail})
}

func (s *Server) publishLabelChange(r *http.Request, boardID, cardID string) {
	user := userFrom(r.Context())
	s.publish(realtime.Event{
		Type:      realtime.TypeCardUpdated,
		BoardID:   boardID,
		CardID:    cardID,
		ActorID:   user.ID,
		ActorName: user.Name,
		At:        time.Now().UTC(),
	})
}

// -- checklist --------------------------------------------------------------

func (s *Server) handleAddChecklistItem(w http.ResponseWriter, r *http.Request) {
	cardID := r.PathValue("cardID")
	boardID, ok := s.authorizeCardBoard(w, r, cardID, true)
	if !ok {
		return
	}
	var req checklistItemRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.Fail(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(req.Text) == "" {
		httpx.FailFields(w, r, map[string]string{"text": "Add some text for this subtask."})
		return
	}
	user := userFrom(r.Context())
	item, err := s.store.AddChecklistItem(r.Context(), cardID, req.Text, user.ID)
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	s.publishChecklistChange(r, boardID, cardID)
	httpx.JSON(w, r, http.StatusCreated, map[string]any{"item": item})
}

func (s *Server) handleUpdateChecklistItem(w http.ResponseWriter, r *http.Request) {
	itemID := r.PathValue("itemID")
	boardID, err := s.store.ChecklistBoardID(r.Context(), itemID)
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	if _, ok := s.authorizeBoard(w, r, boardID, true); !ok {
		return
	}
	var req updateChecklistItemRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.Fail(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
		return
	}
	if req.Text == nil && req.Done == nil {
		httpx.FailFields(w, r, map[string]string{"text": "Nothing to update."})
		return
	}
	user := userFrom(r.Context())
	item, err := s.store.UpdateChecklistItem(r.Context(), itemID, req.Text, req.Done, user.ID)
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	s.publishChecklistChange(r, boardID, item.CardID)
	httpx.JSON(w, r, http.StatusOK, map[string]any{"item": item})
}

func (s *Server) handleDeleteChecklistItem(w http.ResponseWriter, r *http.Request) {
	itemID := r.PathValue("itemID")
	boardID, err := s.store.ChecklistBoardID(r.Context(), itemID)
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	if _, ok := s.authorizeBoard(w, r, boardID, true); !ok {
		return
	}
	if err := s.store.DeleteChecklistItem(r.Context(), itemID); err != nil {
		s.failStore(w, r, err)
		return
	}
	s.publishChecklistChange(r, boardID, "")
	httpx.JSON(w, r, http.StatusNoContent, nil)
}

func (s *Server) publishChecklistChange(r *http.Request, boardID, cardID string) {
	user := userFrom(r.Context())
	s.publish(realtime.Event{
		Type:      realtime.TypeChecklistChanged,
		BoardID:   boardID,
		CardID:    cardID,
		ActorID:   user.ID,
		ActorName: user.Name,
		At:        time.Now().UTC(),
	})
}

// -- comments ---------------------------------------------------------------

func (s *Server) handleAddComment(w http.ResponseWriter, r *http.Request) {
	cardID := r.PathValue("cardID")
	boardID, ok := s.authorizeCardBoard(w, r, cardID, true)
	if !ok {
		return
	}
	var req commentRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.Fail(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(req.Body) == "" {
		httpx.FailFields(w, r, map[string]string{"body": "Write something first."})
		return
	}
	user := userFrom(r.Context())
	comment, err := s.store.AddComment(r.Context(), cardID, user.ID, req.Body)
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	s.publish(realtime.Event{
		Type:      realtime.TypeCommentAdded,
		BoardID:   boardID,
		CardID:    cardID,
		ActorID:   user.ID,
		ActorName: user.Name,
		Summary:   truncate(comment.Body, 80),
		At:        time.Now().UTC(),
	})
	httpx.JSON(w, r, http.StatusCreated, map[string]any{"comment": comment})
}

func (s *Server) handleUpdateComment(w http.ResponseWriter, r *http.Request) {
	commentID := r.PathValue("commentID")
	boardID, err := s.store.CommentBoardID(r.Context(), commentID)
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	if _, ok := s.authorizeBoard(w, r, boardID, true); !ok {
		return
	}
	var req commentRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.Fail(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
		return
	}
	user := userFrom(r.Context())
	comment, err := s.store.UpdateComment(r.Context(), commentID, user.ID, req.Body)
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	s.publish(realtime.Event{
		Type:    realtime.TypeCommentAdded,
		BoardID: boardID,
		CardID:  comment.CardID,
		ActorID: user.ID,
		At:      time.Now().UTC(),
	})
	httpx.JSON(w, r, http.StatusOK, map[string]any{"comment": comment})
}

func (s *Server) handleDeleteComment(w http.ResponseWriter, r *http.Request) {
	commentID := r.PathValue("commentID")
	boardID, err := s.store.CommentBoardID(r.Context(), commentID)
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	if _, ok := s.authorizeBoard(w, r, boardID, true); !ok {
		return
	}
	user := userFrom(r.Context())
	if err := s.store.DeleteComment(r.Context(), commentID, user.ID); err != nil {
		s.failStore(w, r, err)
		return
	}
	s.publish(realtime.Event{
		Type:    realtime.TypeCommentAdded,
		BoardID: boardID,
		ActorID: user.ID,
		At:      time.Now().UTC(),
	})
	httpx.JSON(w, r, http.StatusNoContent, nil)
}

func truncate(value string, max int) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) <= max {
		return string(runes)
	}
	return strings.TrimSpace(string(runes[:max])) + "…"
}
