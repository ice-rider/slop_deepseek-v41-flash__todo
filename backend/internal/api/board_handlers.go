package api

import (
	"net/http"
	"strings"

	"github.com/flowboard/flowboard/backend/internal/httpx"
	"github.com/flowboard/flowboard/backend/internal/realtime"
	"github.com/flowboard/flowboard/backend/internal/store"
)

// -- payloads ---------------------------------------------------------------

type createBoardRequest struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Color       string `json:"color"`
	Template    string `json:"template"`
}

type updateBoardRequest struct {
	Title       *string `json:"title"`
	Description *string `json:"description"`
	Color       *string `json:"color"`
	Starred     *bool   `json:"starred"`
	Archived    *bool   `json:"archived"`
}

type createColumnRequest struct {
	Title    string `json:"title"`
	Color    string `json:"color"`
	WIPLimit int    `json:"wipLimit"`
	IsDone   bool   `json:"isDone"`
}

type updateColumnRequest struct {
	Title    *string `json:"title"`
	Color    *string `json:"color"`
	WIPLimit *int    `json:"wipLimit"`
	IsDone   *bool   `json:"isDone"`
}

type reorderColumnsRequest struct {
	IDs []string `json:"ids"`
}

type reorderBoardRequest struct {
	Columns []reorderColumn `json:"columns"`
}

type reorderColumn struct {
	ID      string   `json:"id"`
	CardIDs []string `json:"cardIds"`
}

type addMemberRequest struct {
	Email string `json:"email"`
	Role  string `json:"role"`
}

type labelRequest struct {
	Name  string `json:"name"`
	Color string `json:"color"`
}

type updateLabelRequest struct {
	Name  *string `json:"name"`
	Color *string `json:"color"`
}

// -- boards -----------------------------------------------------------------

func (s *Server) handleListBoards(w http.ResponseWriter, r *http.Request) {
	user := userFrom(r.Context())
	includeArchived := r.URL.Query().Get("archived") == "true"
	boards, err := s.store.ListBoards(r.Context(), user.ID, includeArchived)
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	httpx.JSON(w, r, http.StatusOK, map[string]any{"boards": boards})
}

func (s *Server) handleCreateBoard(w http.ResponseWriter, r *http.Request) {
	if !s.allow(w, r, s.writeLimiter, "write:"+clientKey(r)) {
		return
	}
	user := userFrom(r.Context())
	var req createBoardRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.Fail(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(req.Title) == "" {
		httpx.FailFields(w, r, map[string]string{"title": "Give your board a name."})
		return
	}
	board, err := s.store.CreateBoard(r.Context(), user.ID, req.Title, req.Description, req.Color, store.BoardTemplate(req.Template))
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	// Seed the starter columns promised by the template.
	snap, err := s.store.BoardSnapshot(r.Context(), board.ID, false)
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	s.publishBoard(realtime.TypeBoardCreated, board.ID, user.ID, user.Name, board.Title)
	httpx.JSON(w, r, http.StatusCreated, map[string]any{"board": board, "snapshot": snap})
}

func (s *Server) handleGetBoard(w http.ResponseWriter, r *http.Request) {
	boardID := r.PathValue("boardID")
	if _, ok := s.authorizeBoard(w, r, boardID, false); !ok {
		return
	}
	includeArchived := r.URL.Query().Get("archived") == "true"
	snap, err := s.store.BoardSnapshot(r.Context(), boardID, includeArchived)
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	httpx.JSON(w, r, http.StatusOK, snap)
}

func (s *Server) handleUpdateBoard(w http.ResponseWriter, r *http.Request) {
	boardID := r.PathValue("boardID")
	if _, ok := s.authorizeBoard(w, r, boardID, true); !ok {
		return
	}
	var req updateBoardRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.Fail(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
		return
	}
	if req.Title != nil && strings.TrimSpace(*req.Title) == "" {
		httpx.FailFields(w, r, map[string]string{"title": "Board name cannot be blank."})
		return
	}
	user := userFrom(r.Context())
	board, err := s.store.UpdateBoard(r.Context(), boardID, store.BoardPatch{
		Title:       req.Title,
		Description: req.Description,
		Color:       req.Color,
		Starred:     req.Starred,
		Archived:    req.Archived,
	}, user.ID)
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	s.publishBoard(realtime.TypeBoardUpdated, boardID, user.ID, user.Name, board.Title)
	httpx.JSON(w, r, http.StatusOK, map[string]any{"board": board})
}

func (s *Server) handleDeleteBoard(w http.ResponseWriter, r *http.Request) {
	boardID := r.PathValue("boardID")
	role, ok := s.authorizeBoard(w, r, boardID, true)
	if !ok {
		return
	}
	if role != store.RoleOwner {
		httpx.Fail(w, r, http.StatusForbidden, httpx.CodeForbidden, "Only the board owner can delete it.")
		return
	}
	user := userFrom(r.Context())
	if err := s.store.DeleteBoard(r.Context(), boardID); err != nil {
		s.failStore(w, r, err)
		return
	}
	s.publishBoard(realtime.TypeBoardDeleted, boardID, user.ID, user.Name, "")
	httpx.JSON(w, r, http.StatusNoContent, nil)
}

func (s *Server) handleBoardActivity(w http.ResponseWriter, r *http.Request) {
	boardID := r.PathValue("boardID")
	if _, ok := s.authorizeBoard(w, r, boardID, false); !ok {
		return
	}
	activity, err := s.store.Activity(r.Context(), boardID, 80)
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	httpx.JSON(w, r, http.StatusOK, map[string]any{"activity": activity})
}

func (s *Server) handleBoardStats(w http.ResponseWriter, r *http.Request) {
	boardID := r.PathValue("boardID")
	if _, ok := s.authorizeBoard(w, r, boardID, false); !ok {
		return
	}
	stats, err := s.store.Stats(r.Context(), userFrom(r.Context()).ID, boardID)
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	httpx.JSON(w, r, http.StatusOK, map[string]any{"stats": stats})
}

// handleReorderBoard persists a whole drag-and-drop outcome atomically.
func (s *Server) handleReorderBoard(w http.ResponseWriter, r *http.Request) {
	boardID := r.PathValue("boardID")
	if _, ok := s.authorizeBoard(w, r, boardID, true); !ok {
		return
	}
	var req reorderBoardRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.Fail(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
		return
	}
	order := make([]store.ColumnOrder, 0, len(req.Columns))
	for _, col := range req.Columns {
		if strings.TrimSpace(col.ID) == "" {
			httpx.FailFields(w, r, map[string]string{"columns": "Every column entry needs an id."})
			return
		}
		order = append(order, store.ColumnOrder{ColumnID: col.ID, CardIDs: col.CardIDs})
	}
	user := userFrom(r.Context())
	if err := s.store.ReorderBoard(r.Context(), boardID, order, user.ID); err != nil {
		s.failStore(w, r, err)
		return
	}
	s.publishBoard(realtime.TypeBoardReordered, boardID, user.ID, user.Name, "")
	snap, err := s.store.BoardSnapshot(r.Context(), boardID, false)
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	httpx.JSON(w, r, http.StatusOK, snap)
}

// -- members ----------------------------------------------------------------

func (s *Server) handleAddMember(w http.ResponseWriter, r *http.Request) {
	boardID := r.PathValue("boardID")
	role, ok := s.authorizeBoard(w, r, boardID, true)
	if !ok {
		return
	}
	if role != store.RoleOwner {
		httpx.Fail(w, r, http.StatusForbidden, httpx.CodeForbidden, "Only the board owner can manage members.")
		return
	}
	var req addMemberRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.Fail(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(req.Email) == "" {
		httpx.FailFields(w, r, map[string]string{"email": "Enter the email of an existing FlowBoard account."})
		return
	}
	user := userFrom(r.Context())
	member, err := s.store.AddMemberByEmail(r.Context(), boardID, req.Email, req.Role, user.ID)
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	s.publishBoard(realtime.TypeMemberChanged, boardID, user.ID, user.Name, member.Name)
	httpx.JSON(w, r, http.StatusCreated, map[string]any{"member": member})
}

func (s *Server) handleRemoveMember(w http.ResponseWriter, r *http.Request) {
	boardID := r.PathValue("boardID")
	role, ok := s.authorizeBoard(w, r, boardID, true)
	if !ok {
		return
	}
	if role != store.RoleOwner {
		httpx.Fail(w, r, http.StatusForbidden, httpx.CodeForbidden, "Only the board owner can manage members.")
		return
	}
	user := userFrom(r.Context())
	if err := s.store.RemoveMember(r.Context(), boardID, r.PathValue("userID"), user.ID); err != nil {
		s.failStore(w, r, err)
		return
	}
	s.publishBoard(realtime.TypeMemberChanged, boardID, user.ID, user.Name, "")
	httpx.JSON(w, r, http.StatusNoContent, nil)
}

// -- columns ----------------------------------------------------------------

func (s *Server) handleCreateColumn(w http.ResponseWriter, r *http.Request) {
	boardID := r.PathValue("boardID")
	if _, ok := s.authorizeBoard(w, r, boardID, true); !ok {
		return
	}
	var req createColumnRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.Fail(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(req.Title) == "" {
		httpx.FailFields(w, r, map[string]string{"title": "Columns need a name."})
		return
	}
	user := userFrom(r.Context())
	column, err := s.store.CreateColumn(r.Context(), boardID, store.ColumnInput{
		Title:    req.Title,
		Color:    req.Color,
		WIPLimit: req.WIPLimit,
		IsDone:   req.IsDone,
	}, user.ID)
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	s.publishBoard(realtime.TypeColumnCreated, boardID, user.ID, user.Name, column.Title)
	httpx.JSON(w, r, http.StatusCreated, map[string]any{"column": column})
}

func (s *Server) handleUpdateColumn(w http.ResponseWriter, r *http.Request) {
	columnID := r.PathValue("columnID")
	boardID, ok := s.authorizeColumnBoard(w, r, columnID, true)
	if !ok {
		return
	}
	var req updateColumnRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.Fail(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
		return
	}
	if req.Title != nil && strings.TrimSpace(*req.Title) == "" {
		httpx.FailFields(w, r, map[string]string{"title": "Column name cannot be blank."})
		return
	}
	user := userFrom(r.Context())
	column, err := s.store.UpdateColumn(r.Context(), columnID, store.ColumnPatch{
		Title:    req.Title,
		Color:    req.Color,
		WIPLimit: req.WIPLimit,
		IsDone:   req.IsDone,
	}, user.ID)
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	s.publishBoard(realtime.TypeColumnUpdated, boardID, user.ID, user.Name, column.Title)
	httpx.JSON(w, r, http.StatusOK, map[string]any{"column": column})
}

func (s *Server) handleDeleteColumn(w http.ResponseWriter, r *http.Request) {
	columnID := r.PathValue("columnID")
	boardID, ok := s.authorizeColumnBoard(w, r, columnID, true)
	if !ok {
		return
	}
	user := userFrom(r.Context())
	moveTo := r.URL.Query().Get("moveTo")
	if err := s.store.DeleteColumn(r.Context(), columnID, moveTo, user.ID); err != nil {
		s.failStore(w, r, err)
		return
	}
	s.publishBoard(realtime.TypeColumnDeleted, boardID, user.ID, user.Name, "")
	httpx.JSON(w, r, http.StatusNoContent, nil)
}

func (s *Server) handleReorderColumns(w http.ResponseWriter, r *http.Request) {
	boardID := r.PathValue("boardID")
	if _, ok := s.authorizeBoard(w, r, boardID, true); !ok {
		return
	}
	var req reorderColumnsRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.Fail(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
		return
	}
	user := userFrom(r.Context())
	if err := s.store.ReorderColumns(r.Context(), boardID, req.IDs, user.ID); err != nil {
		s.failStore(w, r, err)
		return
	}
	s.publishBoard(realtime.TypeBoardReordered, boardID, user.ID, user.Name, "")
	httpx.JSON(w, r, http.StatusOK, map[string]any{"ok": true})
}

// -- labels -----------------------------------------------------------------

func (s *Server) handleCreateLabel(w http.ResponseWriter, r *http.Request) {
	boardID := r.PathValue("boardID")
	if _, ok := s.authorizeBoard(w, r, boardID, true); !ok {
		return
	}
	var req labelRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.Fail(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		httpx.FailFields(w, r, map[string]string{"name": "Labels need a name."})
		return
	}
	label, err := s.store.CreateLabel(r.Context(), boardID, req.Name, req.Color)
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	user := userFrom(r.Context())
	s.publishBoard(realtime.TypeLabelChanged, boardID, user.ID, user.Name, label.Name)
	httpx.JSON(w, r, http.StatusCreated, map[string]any{"label": label})
}

func (s *Server) handleUpdateLabel(w http.ResponseWriter, r *http.Request) {
	labelID := r.PathValue("labelID")
	boardID, err := s.store.LabelBoardID(r.Context(), labelID)
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	if _, ok := s.authorizeBoard(w, r, boardID, true); !ok {
		return
	}
	var req updateLabelRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.Fail(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
		return
	}
	label, err := s.store.UpdateLabel(r.Context(), labelID, req.Name, req.Color)
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	user := userFrom(r.Context())
	s.publishBoard(realtime.TypeLabelChanged, boardID, user.ID, user.Name, label.Name)
	httpx.JSON(w, r, http.StatusOK, map[string]any{"label": label})
}

func (s *Server) handleDeleteLabel(w http.ResponseWriter, r *http.Request) {
	labelID := r.PathValue("labelID")
	boardID, err := s.store.LabelBoardID(r.Context(), labelID)
	if err != nil {
		s.failStore(w, r, err)
		return
	}
	if _, ok := s.authorizeBoard(w, r, boardID, true); !ok {
		return
	}
	if err := s.store.DeleteLabel(r.Context(), labelID); err != nil {
		s.failStore(w, r, err)
		return
	}
	user := userFrom(r.Context())
	s.publishBoard(realtime.TypeLabelChanged, boardID, user.ID, user.Name, "")
	httpx.JSON(w, r, http.StatusNoContent, nil)
}
