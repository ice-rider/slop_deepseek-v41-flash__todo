package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

// BoardTemplate describes the starter columns offered when creating a board.
type BoardTemplate string

// Supported board templates.
const (
	TemplateKanban   BoardTemplate = "kanban"
	TemplateSprint   BoardTemplate = "sprint"
	TemplatePersonal BoardTemplate = "personal"
	TemplateBlank    BoardTemplate = "blank"
)

type templateColumn struct {
	Title    string
	Color    string
	WIPLimit int
	IsDone   bool
}

var boardTemplates = map[BoardTemplate][]templateColumn{
	TemplateKanban: {
		{Title: "Backlog", Color: "slate"},
		{Title: "To do", Color: "sky"},
		{Title: "In progress", Color: "amber", WIPLimit: 4},
		{Title: "Review", Color: "violet", WIPLimit: 3},
		{Title: "Done", Color: "emerald", IsDone: true},
	},
	TemplateSprint: {
		{Title: "Sprint backlog", Color: "slate"},
		{Title: "In progress", Color: "amber", WIPLimit: 3},
		{Title: "Blocked", Color: "rose"},
		{Title: "Done", Color: "emerald", IsDone: true},
	},
	TemplatePersonal: {
		{Title: "Today", Color: "sky", WIPLimit: 5},
		{Title: "This week", Color: "violet"},
		{Title: "Someday", Color: "slate"},
		{Title: "Done", Color: "emerald", IsDone: true},
	},
	TemplateBlank: {
		{Title: "To do", Color: "sky"},
		{Title: "Done", Color: "emerald", IsDone: true},
	},
}

// CreateBoard inserts a board together with its starter columns.
func (s *Store) CreateBoard(ctx context.Context, ownerID, title, description, color string, template BoardTemplate) (*Board, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		return nil, fmt.Errorf("%w: board title is required", ErrInvalidInput)
	}
	if color == "" {
		color = "indigo"
	}
	cols, ok := boardTemplates[template]
	if !ok {
		cols = boardTemplates[TemplateKanban]
	}

	board := &Board{
		ID:          newID(),
		OwnerID:     ownerID,
		Title:       title,
		Description: strings.TrimSpace(description),
		Color:       color,
		Role:        RoleOwner,
	}
	now := s.now()
	board.CreatedAt = ts(ms(now))
	board.UpdatedAt = board.CreatedAt

	err := s.withTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO boards (id, owner_id, title, description, color, starred, archived, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`,
			board.ID, board.OwnerID, board.Title, board.Description, board.Color, ms(now), ms(now),
		); err != nil {
			return fmt.Errorf("insert board: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO board_members (board_id, user_id, role, created_at) VALUES (?, ?, ?, ?)`,
			board.ID, ownerID, RoleOwner, ms(now),
		); err != nil {
			return fmt.Errorf("insert owner membership: %w", err)
		}
		for i, col := range cols {
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO board_columns (id, board_id, title, color, wip_limit, position, is_done, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				newID(), board.ID, col.Title, col.Color, col.WIPLimit, i, boolToInt(col.IsDone), ms(now),
			); err != nil {
				return fmt.Errorf("insert board column: %w", err)
			}
		}
		return s.recordActivityTx(ctx, tx, board.ID, nil, ownerID, "board.created", "created this board")
	})
	if err != nil {
		return nil, err
	}
	return board, nil
}

// BoardByID loads a board without an access check (callers must use BoardAccess).
func (s *Store) BoardByID(ctx context.Context, boardID string) (*Board, error) {
	var (
		b                    Board
		createdAt, updatedAt int64
		starred, archived    int
	)
	err := s.db.QueryRowContext(ctx, `
		SELECT id, owner_id, title, description, color, starred, archived, created_at, updated_at
		FROM boards WHERE id = ?`, boardID,
	).Scan(&b.ID, &b.OwnerID, &b.Title, &b.Description, &b.Color, &starred, &archived, &createdAt, &updatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("scan board: %w", err)
	}
	b.Starred = starred == 1
	b.Archived = archived == 1
	b.CreatedAt = ts(createdAt)
	b.UpdatedAt = ts(updatedAt)
	return &b, nil
}

// BoardRole resolves the caller's role on a board, or ErrNotFound when the
// board does not exist and ErrForbidden when the caller has no access.
func (s *Store) BoardRole(ctx context.Context, boardID, userID string) (string, error) {
	var (
		ownerID string
		role    sql.NullString
	)
	err := s.db.QueryRowContext(ctx, `
		SELECT b.owner_id, bm.role
		FROM boards b
		LEFT JOIN board_members bm ON bm.board_id = b.id AND bm.user_id = ?
		WHERE b.id = ?`, userID, boardID,
	).Scan(&ownerID, &role)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", ErrNotFound
		}
		return "", fmt.Errorf("resolve board role: %w", err)
	}
	if role.Valid && role.String != "" {
		return role.String, nil
	}
	if ownerID == userID {
		return RoleOwner, nil
	}
	return "", ErrForbidden
}

// RequireWriter returns the caller's role, rejecting read-only viewers.
func (s *Store) RequireWriter(ctx context.Context, boardID, userID string) (string, error) {
	role, err := s.BoardRole(ctx, boardID, userID)
	if err != nil {
		return "", err
	}
	if role == RoleViewer {
		return "", fmt.Errorf("%w: viewers cannot modify this board", ErrForbidden)
	}
	return role, nil
}

// ListBoards returns every board the user owns or collaborates on.
func (s *Store) ListBoards(ctx context.Context, userID string, includeArchived bool) ([]BoardSummary, error) {
	archivedFilter := "AND b.archived = 0"
	if includeArchived {
		archivedFilter = ""
	}
	nowMS := ms(s.now())
	rows, err := s.db.QueryContext(ctx, `
		SELECT b.id, b.owner_id, b.title, b.description, b.color, b.starred, b.archived,
		       b.created_at, b.updated_at,
		       COALESCE(bm.role, CASE WHEN b.owner_id = ? THEN 'owner' ELSE 'viewer' END) AS role,
		       (SELECT COUNT(*) FROM board_columns c WHERE c.board_id = b.id),
		       (SELECT COUNT(*) FROM cards k WHERE k.board_id = b.id AND k.archived = 0),
		       (SELECT COUNT(*) FROM cards k JOIN board_columns c ON c.id = k.column_id
		         WHERE k.board_id = b.id AND k.archived = 0 AND c.is_done = 1),
		       (SELECT COUNT(*) FROM cards k JOIN board_columns c ON c.id = k.column_id
		         WHERE k.board_id = b.id AND k.archived = 0 AND c.is_done = 0
		           AND k.due_date IS NOT NULL AND k.due_date < ?)
		FROM boards b
		LEFT JOIN board_members bm ON bm.board_id = b.id AND bm.user_id = ?
		WHERE (b.owner_id = ? OR bm.user_id IS NOT NULL) `+archivedFilter+`
		ORDER BY b.starred DESC, b.updated_at DESC`,
		userID, nowMS, userID, userID)
	if err != nil {
		return nil, fmt.Errorf("list boards: %w", err)
	}
	defer rows.Close()

	out := []BoardSummary{}
	for rows.Next() {
		var (
			b                    BoardSummary
			createdAt, updatedAt int64
			starred, archived    int
		)
		if err := rows.Scan(
			&b.ID, &b.OwnerID, &b.Title, &b.Description, &b.Color, &starred, &archived,
			&createdAt, &updatedAt, &b.Role,
			&b.ColumnCount, &b.CardCount, &b.DoneCount, &b.OverdueCount,
		); err != nil {
			return nil, fmt.Errorf("scan board summary: %w", err)
		}
		b.Starred = starred == 1
		b.Archived = archived == 1
		b.CreatedAt = ts(createdAt)
		b.UpdatedAt = ts(updatedAt)
		out = append(out, b)
	}
	return out, rows.Err()
}

// BoardPatch carries optional board mutations.
type BoardPatch struct {
	Title       *string
	Description *string
	Color       *string
	Starred     *bool
	Archived    *bool
}

// UpdateBoard applies a partial update.
func (s *Store) UpdateBoard(ctx context.Context, boardID string, patch BoardPatch, actorID string) (*Board, error) {
	sets := []string{}
	args := []any{}
	if patch.Title != nil {
		title := strings.TrimSpace(*patch.Title)
		if title == "" {
			return nil, fmt.Errorf("%w: board title must not be blank", ErrInvalidInput)
		}
		sets = append(sets, "title = ?")
		args = append(args, title)
	}
	if patch.Description != nil {
		sets = append(sets, "description = ?")
		args = append(args, strings.TrimSpace(*patch.Description))
	}
	if patch.Color != nil {
		sets = append(sets, "color = ?")
		args = append(args, *patch.Color)
	}
	if patch.Starred != nil {
		sets = append(sets, "starred = ?")
		args = append(args, boolToInt(*patch.Starred))
	}
	if patch.Archived != nil {
		sets = append(sets, "archived = ?")
		args = append(args, boolToInt(*patch.Archived))
	}
	if len(sets) == 0 {
		return s.BoardByID(ctx, boardID)
	}
	now := ms(s.now())
	sets = append(sets, "updated_at = ?")
	args = append(args, now, boardID)

	err := s.withTx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `UPDATE boards SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...)
		if err != nil {
			return fmt.Errorf("update board: %w", err)
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		verb := "board.updated"
		switch {
		case patch.Starred != nil && *patch.Starred:
			verb = "board.starred"
		case patch.Starred != nil && !*patch.Starred:
			verb = "board.unstarred"
		case patch.Archived != nil && *patch.Archived:
			verb = "board.archived"
		case patch.Archived != nil && !*patch.Archived:
			verb = "board.restored"
		}
		return s.recordActivityTx(ctx, tx, boardID, nil, actorID, verb, "")
	})
	if err != nil {
		return nil, err
	}
	return s.BoardByID(ctx, boardID)
}

// DeleteBoard removes a board and everything inside it.
func (s *Store) DeleteBoard(ctx context.Context, boardID string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM boards WHERE id = ?`, boardID)
	if err != nil {
		return fmt.Errorf("delete board: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// TouchBoard bumps updated_at so board lists sort by recent activity.
func (s *Store) TouchBoard(ctx context.Context, boardID string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE boards SET updated_at = ? WHERE id = ?`, ms(s.now()), boardID)
	if err != nil {
		return fmt.Errorf("touch board: %w", err)
	}
	return nil
}

// -- columns ----------------------------------------------------------------

// Columns lists a board's columns in display order.
func (s *Store) Columns(ctx context.Context, boardID string) ([]Column, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, board_id, title, color, wip_limit, position, is_done, created_at
		FROM board_columns WHERE board_id = ? ORDER BY position, created_at`, boardID)
	if err != nil {
		return nil, fmt.Errorf("list columns: %w", err)
	}
	defer rows.Close()
	return scanColumns(rows)
}

func scanColumns(rows *sql.Rows) ([]Column, error) {
	out := []Column{}
	for rows.Next() {
		var (
			c         Column
			isDone    int
			createdAt int64
		)
		if err := rows.Scan(&c.ID, &c.BoardID, &c.Title, &c.Color, &c.WIPLimit, &c.Position, &isDone, &createdAt); err != nil {
			return nil, fmt.Errorf("scan column: %w", err)
		}
		c.IsDone = isDone == 1
		c.CreatedAt = ts(createdAt)
		out = append(out, c)
	}
	return out, rows.Err()
}

// ColumnByID loads one column.
func (s *Store) ColumnByID(ctx context.Context, columnID string) (*Column, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, board_id, title, color, wip_limit, position, is_done, created_at
		FROM board_columns WHERE id = ?`, columnID)
	var (
		c         Column
		isDone    int
		createdAt int64
	)
	if err := row.Scan(&c.ID, &c.BoardID, &c.Title, &c.Color, &c.WIPLimit, &c.Position, &isDone, &createdAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("scan column: %w", err)
	}
	c.IsDone = isDone == 1
	c.CreatedAt = ts(createdAt)
	return &c, nil
}

// ColumnInput describes a new column.
type ColumnInput struct {
	Title    string
	Color    string
	WIPLimit int
	IsDone   bool
}

// CreateColumn appends a column to the end of a board.
func (s *Store) CreateColumn(ctx context.Context, boardID string, in ColumnInput, actorID string) (*Column, error) {
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return nil, fmt.Errorf("%w: column title is required", ErrInvalidInput)
	}
	if in.Color == "" {
		in.Color = "slate"
	}
	if in.WIPLimit < 0 {
		return nil, fmt.Errorf("%w: WIP limit cannot be negative", ErrInvalidInput)
	}
	now := s.now()
	col := &Column{
		ID:        newID(),
		BoardID:   boardID,
		Title:     title,
		Color:     in.Color,
		WIPLimit:  in.WIPLimit,
		IsDone:    in.IsDone,
		CreatedAt: ts(ms(now)),
	}
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		var maxPos sql.NullInt64
		if err := tx.QueryRowContext(ctx,
			`SELECT MAX(position) FROM board_columns WHERE board_id = ?`, boardID).Scan(&maxPos); err != nil {
			return fmt.Errorf("read max column position: %w", err)
		}
		col.Position = 0
		if maxPos.Valid {
			col.Position = int(maxPos.Int64) + 1
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO board_columns (id, board_id, title, color, wip_limit, position, is_done, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			col.ID, col.BoardID, col.Title, col.Color, col.WIPLimit, col.Position, boolToInt(col.IsDone), ms(now),
		); err != nil {
			return fmt.Errorf("insert column: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `UPDATE boards SET updated_at = ? WHERE id = ?`, ms(now), boardID); err != nil {
			return fmt.Errorf("touch board: %w", err)
		}
		return s.recordActivityTx(ctx, tx, boardID, nil, actorID, "column.created", col.Title)
	})
	if err != nil {
		return nil, err
	}
	return col, nil
}

// ColumnPatch carries optional column mutations.
type ColumnPatch struct {
	Title    *string
	Color    *string
	WIPLimit *int
	IsDone   *bool
	Position *int
}

// UpdateColumn applies a partial update.
func (s *Store) UpdateColumn(ctx context.Context, columnID string, patch ColumnPatch, actorID string) (*Column, error) {
	sets := []string{}
	args := []any{}
	if patch.Title != nil {
		title := strings.TrimSpace(*patch.Title)
		if title == "" {
			return nil, fmt.Errorf("%w: column title must not be blank", ErrInvalidInput)
		}
		sets = append(sets, "title = ?")
		args = append(args, title)
	}
	if patch.Color != nil {
		sets = append(sets, "color = ?")
		args = append(args, *patch.Color)
	}
	if patch.WIPLimit != nil {
		if *patch.WIPLimit < 0 {
			return nil, fmt.Errorf("%w: WIP limit cannot be negative", ErrInvalidInput)
		}
		sets = append(sets, "wip_limit = ?")
		args = append(args, *patch.WIPLimit)
	}
	if patch.IsDone != nil {
		sets = append(sets, "is_done = ?")
		args = append(args, boolToInt(*patch.IsDone))
	}
	if patch.Position != nil {
		sets = append(sets, "position = ?")
		args = append(args, *patch.Position)
	}
	if len(sets) == 0 {
		return s.ColumnByID(ctx, columnID)
	}
	args = append(args, columnID)

	var boardID string
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		if err := tx.QueryRowContext(ctx, `SELECT board_id FROM board_columns WHERE id = ?`, columnID).Scan(&boardID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrNotFound
			}
			return fmt.Errorf("lookup column board: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `UPDATE board_columns SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...); err != nil {
			return fmt.Errorf("update column: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `UPDATE boards SET updated_at = ? WHERE id = ?`, ms(s.now()), boardID); err != nil {
			return fmt.Errorf("touch board: %w", err)
		}
		return s.recordActivityTx(ctx, tx, boardID, nil, actorID, "column.updated", "")
	})
	if err != nil {
		return nil, err
	}
	return s.ColumnByID(ctx, columnID)
}

// DeleteColumn removes a column, optionally relocating its cards.
// When targetColumnID is empty the cards are deleted along with the column.
func (s *Store) DeleteColumn(ctx context.Context, columnID, targetColumnID, actorID string) error {
	var boardID string
	var remaining int
	if err := s.db.QueryRowContext(ctx, `SELECT board_id FROM board_columns WHERE id = ?`, columnID).Scan(&boardID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return fmt.Errorf("lookup column board: %w", err)
	}
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM board_columns WHERE board_id = ?`, boardID).Scan(&remaining); err != nil {
		return fmt.Errorf("count columns: %w", err)
	}
	if remaining <= 1 {
		return fmt.Errorf("%w: cannot delete the last column", ErrLastColumn)
	}
	if targetColumnID != "" && targetColumnID == columnID {
		return fmt.Errorf("%w: cannot move cards into the column being deleted", ErrInvalidInput)
	}

	return s.withTx(ctx, func(tx *sql.Tx) error {
		if targetColumnID != "" {
			var ok int
			if err := tx.QueryRowContext(ctx,
				`SELECT COUNT(*) FROM board_columns WHERE id = ? AND board_id = ?`, targetColumnID, boardID).Scan(&ok); err != nil {
				return fmt.Errorf("verify target column: %w", err)
			}
			if ok == 0 {
				return fmt.Errorf("%w: target column not found on this board", ErrInvalidInput)
			}
			var maxPos sql.NullInt64
			if err := tx.QueryRowContext(ctx,
				`SELECT MAX(position) FROM cards WHERE column_id = ?`, targetColumnID).Scan(&maxPos); err != nil {
				return fmt.Errorf("read target max position: %w", err)
			}
			base := int64(0)
			if maxPos.Valid {
				base = maxPos.Int64 + 1
			}
			if _, err := tx.ExecContext(ctx, `
				UPDATE cards SET column_id = ?, position = position + ?, updated_at = ?
				WHERE column_id = ?`, targetColumnID, base, ms(s.now()), columnID); err != nil {
				return fmt.Errorf("relocate cards: %w", err)
			}
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM board_columns WHERE id = ?`, columnID); err != nil {
			return fmt.Errorf("delete column: %w", err)
		}
		return s.normalizeColumnPositionsTx(ctx, tx, boardID)
	})
}

// ReorderColumns rewrites column positions to match the supplied ID order.
func (s *Store) ReorderColumns(ctx context.Context, boardID string, ids []string, actorID string) error {
	if len(ids) == 0 {
		return fmt.Errorf("%w: no column order supplied", ErrInvalidInput)
	}
	return s.withTx(ctx, func(tx *sql.Tx) error {
		existing, err := columnsTx(ctx, tx, boardID)
		if err != nil {
			return err
		}
		if len(existing) != len(ids) {
			return fmt.Errorf("%w: column order must list every column exactly once", ErrInvalidInput)
		}
		seen := map[string]bool{}
		for _, id := range ids {
			if seen[id] {
				return fmt.Errorf("%w: duplicate column id in order", ErrInvalidInput)
			}
			seen[id] = true
		}
		for _, col := range existing {
			if !seen[col.ID] {
				return fmt.Errorf("%w: unknown column id %s", ErrInvalidInput, col.ID)
			}
		}
		for i, id := range ids {
			if _, err := tx.ExecContext(ctx,
				`UPDATE board_columns SET position = ? WHERE id = ? AND board_id = ?`, i, id, boardID); err != nil {
				return fmt.Errorf("reorder columns: %w", err)
			}
		}
		if _, err := tx.ExecContext(ctx, `UPDATE boards SET updated_at = ? WHERE id = ?`, ms(s.now()), boardID); err != nil {
			return fmt.Errorf("touch board: %w", err)
		}
		return s.recordActivityTx(ctx, tx, boardID, nil, actorID, "column.reordered", "")
	})
}

func columnsTx(ctx context.Context, tx *sql.Tx, boardID string) ([]Column, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT id, board_id, title, color, wip_limit, position, is_done, created_at
		FROM board_columns WHERE board_id = ? ORDER BY position, created_at`, boardID)
	if err != nil {
		return nil, fmt.Errorf("list columns: %w", err)
	}
	defer rows.Close()
	return scanColumns(rows)
}

func (s *Store) normalizeColumnPositionsTx(ctx context.Context, tx *sql.Tx, boardID string) error {
	cols, err := columnsTx(ctx, tx, boardID)
	if err != nil {
		return err
	}
	for i, col := range cols {
		if col.Position == i {
			continue
		}
		if _, err := tx.ExecContext(ctx, `UPDATE board_columns SET position = ? WHERE id = ?`, i, col.ID); err != nil {
			return fmt.Errorf("normalize column positions: %w", err)
		}
	}
	return nil
}

// -- members ----------------------------------------------------------------

// Members lists everyone with access to a board.
func (s *Store) Members(ctx context.Context, boardID string) ([]Member, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT u.id, u.email, u.name, u.avatar_color, bm.role, bm.created_at
		FROM board_members bm
		JOIN users u ON u.id = bm.user_id
		WHERE bm.board_id = ?
		ORDER BY CASE bm.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, u.name COLLATE NOCASE`, boardID)
	if err != nil {
		return nil, fmt.Errorf("list members: %w", err)
	}
	defer rows.Close()

	out := []Member{}
	for rows.Next() {
		var (
			m        Member
			joinedAt int64
		)
		if err := rows.Scan(&m.UserID, &m.Email, &m.Name, &m.AvatarColor, &m.Role, &joinedAt); err != nil {
			return nil, fmt.Errorf("scan member: %w", err)
		}
		m.JoinedAt = ts(joinedAt)
		out = append(out, m)
	}
	return out, rows.Err()
}

// AddMemberByEmail shares a board with an existing account.
func (s *Store) AddMemberByEmail(ctx context.Context, boardID, email, role, actorID string) (*Member, error) {
	switch role {
	case RoleEditor, RoleViewer:
	case "":
		role = RoleEditor
	default:
		return nil, fmt.Errorf("%w: role must be editor or viewer", ErrInvalidInput)
	}
	target, err := s.UserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, fmt.Errorf("%w: no account found for %s", ErrNotFound, email)
		}
		return nil, err
	}
	now := s.now()
	err = s.withTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO board_members (board_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
			ON CONFLICT (board_id, user_id) DO UPDATE SET role = excluded.role`,
			boardID, target.ID, role, ms(now),
		); err != nil {
			return fmt.Errorf("upsert member: %w", err)
		}
		return s.recordActivityTx(ctx, tx, boardID, nil, actorID, "member.added", target.Name)
	})
	if err != nil {
		return nil, err
	}
	return &Member{
		UserID:      target.ID,
		Email:       target.Email,
		Name:        target.Name,
		AvatarColor: target.AvatarColor,
		Role:        role,
		JoinedAt:    ts(ms(now)),
	}, nil
}

// RemoveMember revokes a collaborator's access.
func (s *Store) RemoveMember(ctx context.Context, boardID, userID, actorID string) error {
	var ownerID string
	if err := s.db.QueryRowContext(ctx, `SELECT owner_id FROM boards WHERE id = ?`, boardID).Scan(&ownerID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return fmt.Errorf("lookup board owner: %w", err)
	}
	if ownerID == userID {
		return fmt.Errorf("%w: the board owner cannot be removed", ErrForbidden)
	}
	return s.withTx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `DELETE FROM board_members WHERE board_id = ? AND user_id = ?`, boardID, userID)
		if err != nil {
			return fmt.Errorf("delete member: %w", err)
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		return s.recordActivityTx(ctx, tx, boardID, nil, actorID, "member.removed", "")
	})
}

// -- activity ---------------------------------------------------------------

func (s *Store) recordActivityTx(ctx context.Context, tx *sql.Tx, boardID string, cardID *string, actorID, verb, summary string) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO activity (id, board_id, card_id, actor_id, verb, summary, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		newID(), boardID, cardID, actorID, verb, summary, ms(s.now()))
	if err != nil {
		return fmt.Errorf("insert activity: %w", err)
	}
	return nil
}

// RecordActivity writes an activity entry outside any transaction.
func (s *Store) RecordActivity(ctx context.Context, boardID string, cardID *string, actorID, verb, summary string) error {
	return s.withTx(ctx, func(tx *sql.Tx) error {
		return s.recordActivityTx(ctx, tx, boardID, cardID, actorID, verb, summary)
	})
}

// Activity returns the most recent audit entries for a board.
func (s *Store) Activity(ctx context.Context, boardID string, limit int) ([]Activity, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT a.id, a.board_id, a.card_id, a.actor_id, u.name, a.verb, a.summary, a.created_at
		FROM activity a
		JOIN users u ON u.id = a.actor_id
		WHERE a.board_id = ?
		ORDER BY a.created_at DESC
		LIMIT ?`, boardID, limit)
	if err != nil {
		return nil, fmt.Errorf("list activity: %w", err)
	}
	defer rows.Close()
	return scanActivity(rows)
}

func scanActivity(rows *sql.Rows) ([]Activity, error) {
	out := []Activity{}
	for rows.Next() {
		var (
			a         Activity
			cardID    sql.NullString
			createdAt int64
		)
		if err := rows.Scan(&a.ID, &a.BoardID, &cardID, &a.ActorID, &a.ActorName, &a.Verb, &a.Summary, &createdAt); err != nil {
			return nil, fmt.Errorf("scan activity: %w", err)
		}
		a.CardID = ptrOrNil(cardID)
		a.CreatedAt = ts(createdAt)
		out = append(out, a)
	}
	return out, rows.Err()
}

// CardActivity returns the audit trail for a single card.
func (s *Store) CardActivity(ctx context.Context, cardID string, limit int) ([]Activity, error) {
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT a.id, a.board_id, a.card_id, a.actor_id, u.name, a.verb, a.summary, a.created_at
		FROM activity a
		JOIN users u ON u.id = a.actor_id
		WHERE a.card_id = ?
		ORDER BY a.created_at DESC
		LIMIT ?`, cardID, limit)
	if err != nil {
		return nil, fmt.Errorf("list card activity: %w", err)
	}
	defer rows.Close()
	return scanActivity(rows)
}

// -- labels -----------------------------------------------------------------

// Labels lists a board's labels.
func (s *Store) Labels(ctx context.Context, boardID string) ([]Label, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, board_id, name, color FROM labels WHERE board_id = ? ORDER BY name COLLATE NOCASE`, boardID)
	if err != nil {
		return nil, fmt.Errorf("list labels: %w", err)
	}
	defer rows.Close()
	out := []Label{}
	for rows.Next() {
		var l Label
		if err := rows.Scan(&l.ID, &l.BoardID, &l.Name, &l.Color); err != nil {
			return nil, fmt.Errorf("scan label: %w", err)
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// CreateLabel adds a label to a board.
func (s *Store) CreateLabel(ctx context.Context, boardID, name, color string) (*Label, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, fmt.Errorf("%w: label name is required", ErrInvalidInput)
	}
	if color == "" {
		color = "slate"
	}
	l := &Label{ID: newID(), BoardID: boardID, Name: name, Color: color}
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO labels (id, board_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)`,
		l.ID, l.BoardID, l.Name, l.Color, ms(s.now())); err != nil {
		if isUniqueViolation(err) {
			return nil, fmt.Errorf("%w: that label already exists on this board", ErrConflict)
		}
		return nil, fmt.Errorf("insert label: %w", err)
	}
	return l, nil
}

// UpdateLabel patches a label.
func (s *Store) UpdateLabel(ctx context.Context, labelID string, name, color *string) (*Label, error) {
	sets := []string{}
	args := []any{}
	if name != nil {
		trimmed := strings.TrimSpace(*name)
		if trimmed == "" {
			return nil, fmt.Errorf("%w: label name must not be blank", ErrInvalidInput)
		}
		sets = append(sets, "name = ?")
		args = append(args, trimmed)
	}
	if color != nil {
		sets = append(sets, "color = ?")
		args = append(args, *color)
	}
	if len(sets) == 0 {
		return s.labelByID(ctx, labelID)
	}
	args = append(args, labelID)
	if _, err := s.db.ExecContext(ctx, `UPDATE labels SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...); err != nil {
		if isUniqueViolation(err) {
			return nil, fmt.Errorf("%w: that label already exists on this board", ErrConflict)
		}
		return nil, fmt.Errorf("update label: %w", err)
	}
	return s.labelByID(ctx, labelID)
}

func (s *Store) labelByID(ctx context.Context, labelID string) (*Label, error) {
	var l Label
	err := s.db.QueryRowContext(ctx,
		`SELECT id, board_id, name, color FROM labels WHERE id = ?`, labelID).
		Scan(&l.ID, &l.BoardID, &l.Name, &l.Color)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("scan label: %w", err)
	}
	return &l, nil
}

// DeleteLabel removes a label everywhere it is attached.
func (s *Store) DeleteLabel(ctx context.Context, labelID string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM labels WHERE id = ?`, labelID)
	if err != nil {
		return fmt.Errorf("delete label: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
