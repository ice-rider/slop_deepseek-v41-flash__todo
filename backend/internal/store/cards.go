package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Nullable carries tri-state patch semantics: absent, explicit null, or value.
type Nullable[T any] struct {
	Set   bool
	Value *T
}

// CardInput describes a new card.
type CardInput struct {
	Title       string
	Description string
	Priority    int
	DueDate     *time.Time
	AssigneeID  *string
	CoverColor  string
	LabelIDs    []string
}

// CardPatch carries optional card mutations.
type CardPatch struct {
	Title       *string
	Description *string
	Priority    *int
	DueDate     Nullable[time.Time]
	AssigneeID  Nullable[string]
	CoverColor  *string
	Archived    *bool
	LabelIDs    *[]string
}

// ColumnOrder is one column's worth of card ordering in a bulk reorder.
type ColumnOrder struct {
	ColumnID string
	CardIDs  []string
}

// -- reads ------------------------------------------------------------------

const cardColumns = `c.id, c.board_id, c.column_id, c.title, c.description, c.position, c.priority,
	c.due_date, c.assignee_id, c.cover_color, c.archived, c.created_by, c.created_at, c.updated_at, c.completed_at`

func scanCardRow(row rowScanner) (*Card, error) {
	var (
		c                    Card
		dueDate, completedAt sql.NullInt64
		assigneeID           sql.NullString
		archived             int
		createdAt, updatedAt int64
		priority             int
	)
	if err := row.Scan(
		&c.ID, &c.BoardID, &c.ColumnID, &c.Title, &c.Description, &c.Position, &priority,
		&dueDate, &assigneeID, &c.CoverColor, &archived, &c.CreatedBy, &createdAt, &updatedAt, &completedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("scan card: %w", err)
	}
	c.Priority = normalizePriority(priority)
	c.DueDate = tsPtr(dueDate)
	c.CompletedAt = tsPtr(completedAt)
	c.AssigneeID = ptrOrNil(assigneeID)
	c.Archived = archived == 1
	c.CreatedAt = ts(createdAt)
	c.UpdatedAt = ts(updatedAt)
	return &c, nil
}

// CardByID loads a single card.
func (s *Store) CardByID(ctx context.Context, cardID string) (*Card, error) {
	return scanCardRow(s.db.QueryRowContext(ctx, `SELECT `+cardColumns+` FROM cards c WHERE c.id = ?`, cardID))
}

// BoardSnapshot assembles everything needed to render a board in one round-trip.
func (s *Store) BoardSnapshot(ctx context.Context, boardID string, includeArchived bool) (*BoardSnapshot, error) {
	board, err := s.BoardByID(ctx, boardID)
	if err != nil {
		return nil, err
	}
	columns, err := s.Columns(ctx, boardID)
	if err != nil {
		return nil, err
	}
	labels, err := s.Labels(ctx, boardID)
	if err != nil {
		return nil, err
	}
	members, err := s.Members(ctx, boardID)
	if err != nil {
		return nil, err
	}
	activity, err := s.Activity(ctx, boardID, 40)
	if err != nil {
		return nil, err
	}
	cards, err := s.boardCards(ctx, boardID, includeArchived)
	if err != nil {
		return nil, err
	}
	return &BoardSnapshot{
		Board:    *board,
		Columns:  columns,
		Cards:    cards,
		Labels:   labels,
		Members:  members,
		Activity: activity,
	}, nil
}

func (s *Store) boardCards(ctx context.Context, boardID string, includeArchived bool) ([]Card, error) {
	archivedFilter := "AND c.archived = 0"
	if includeArchived {
		archivedFilter = ""
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT `+cardColumns+`,
		       COALESCE(u.name, '') AS assignee_name,
		       (SELECT COUNT(*) FROM checklist_items ci WHERE ci.card_id = c.id) AS checklist_total,
		       (SELECT COUNT(*) FROM checklist_items ci WHERE ci.card_id = c.id AND ci.done = 1) AS checklist_done,
		       (SELECT COUNT(*) FROM comments cm WHERE cm.card_id = c.id) AS comment_count
		FROM cards c
		LEFT JOIN users u ON u.id = c.assignee_id
		WHERE c.board_id = ? `+archivedFilter+`
		ORDER BY c.position, c.created_at`, boardID)
	if err != nil {
		return nil, fmt.Errorf("list board cards: %w", err)
	}
	defer rows.Close()

	cards := []Card{}
	byID := map[string]int{}
	for rows.Next() {
		var (
			c                    Card
			dueDate, completedAt sql.NullInt64
			assigneeID           sql.NullString
			archived             int
			createdAt, updatedAt int64
			priority             int
		)
		if err := rows.Scan(
			&c.ID, &c.BoardID, &c.ColumnID, &c.Title, &c.Description, &c.Position, &priority,
			&dueDate, &assigneeID, &c.CoverColor, &archived, &c.CreatedBy, &createdAt, &updatedAt, &completedAt,
			&c.AssigneeName, &c.Checklist.Total, &c.Checklist.Done, &c.CommentCount,
		); err != nil {
			return nil, fmt.Errorf("scan board card: %w", err)
		}
		c.Priority = normalizePriority(priority)
		c.DueDate = tsPtr(dueDate)
		c.CompletedAt = tsPtr(completedAt)
		c.AssigneeID = ptrOrNil(assigneeID)
		c.Archived = archived == 1
		c.CreatedAt = ts(createdAt)
		c.UpdatedAt = ts(updatedAt)
		c.LabelIDs = []string{}
		byID[c.ID] = len(cards)
		cards = append(cards, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(cards) == 0 {
		return cards, nil
	}

	// One extra query attaches every label so the card face is self-sufficient.
	labelRows, err := s.db.QueryContext(ctx, `
		SELECT cl.card_id, cl.label_id
		FROM card_labels cl
		JOIN cards c ON c.id = cl.card_id
		WHERE c.board_id = ?`, boardID)
	if err != nil {
		return nil, fmt.Errorf("list card labels: %w", err)
	}
	defer labelRows.Close()
	for labelRows.Next() {
		var cardID, labelID string
		if err := labelRows.Scan(&cardID, &labelID); err != nil {
			return nil, fmt.Errorf("scan card label: %w", err)
		}
		if idx, ok := byID[cardID]; ok {
			cards[idx].LabelIDs = append(cards[idx].LabelIDs, labelID)
		}
	}
	return cards, labelRows.Err()
}

// CardDetail returns the full drawer payload for one card.
func (s *Store) CardDetail(ctx context.Context, cardID string) (*CardDetail, error) {
	card, err := s.CardByID(ctx, cardID)
	if err != nil {
		return nil, err
	}
	board, err := s.BoardByID(ctx, card.BoardID)
	if err != nil {
		return nil, err
	}
	column, err := s.ColumnByID(ctx, card.ColumnID)
	if err != nil {
		return nil, err
	}
	labels, err := s.cardLabels(ctx, cardID)
	if err != nil {
		return nil, err
	}
	checklist, err := s.Checklist(ctx, cardID)
	if err != nil {
		return nil, err
	}
	comments, err := s.Comments(ctx, cardID)
	if err != nil {
		return nil, err
	}
	activity, err := s.CardActivity(ctx, cardID, 30)
	if err != nil {
		return nil, err
	}

	detail := &CardDetail{
		Card:      *card,
		Labels:    labels,
		Checklist: checklist,
		Comments:  comments,
		Activity:  activity,
		Board:     *board,
		Column:    *column,
	}
	if card.AssigneeID != nil {
		if u, err := s.UserByID(ctx, *card.AssigneeID); err == nil {
			detail.Assignee = u
		}
	}
	detail.Card.LabelIDs = make([]string, 0, len(labels))
	for _, l := range labels {
		detail.Card.LabelIDs = append(detail.Card.LabelIDs, l.ID)
	}
	detail.Card.Checklist.Total = len(checklist)
	detail.Card.Checklist.Done = 0
	for _, item := range checklist {
		if item.Done {
			detail.Card.Checklist.Done++
		}
	}
	detail.Card.CommentCount = len(comments)
	detail.Card.AssigneeName = ""
	if detail.Assignee != nil {
		detail.Card.AssigneeName = detail.Assignee.Name
	}
	return detail, nil
}

func (s *Store) cardLabels(ctx context.Context, cardID string) ([]Label, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT l.id, l.board_id, l.name, l.color
		FROM card_labels cl JOIN labels l ON l.id = cl.label_id
		WHERE cl.card_id = ?
		ORDER BY l.name COLLATE NOCASE`, cardID)
	if err != nil {
		return nil, fmt.Errorf("list card labels: %w", err)
	}
	defer rows.Close()
	out := []Label{}
	for rows.Next() {
		var l Label
		if err := rows.Scan(&l.ID, &l.BoardID, &l.Name, &l.Color); err != nil {
			return nil, fmt.Errorf("scan card label: %w", err)
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// -- writes -----------------------------------------------------------------

// CreateCard appends a card to a column, enforcing that column's WIP limit.
func (s *Store) CreateCard(ctx context.Context, columnID string, in CardInput, actorID string) (*Card, error) {
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return nil, fmt.Errorf("%w: card title is required", ErrInvalidInput)
	}
	column, err := s.ColumnByID(ctx, columnID)
	if err != nil {
		return nil, err
	}
	now := s.now()
	card := &Card{
		ID:          newID(),
		BoardID:     column.BoardID,
		ColumnID:    column.ID,
		Title:       title,
		Description: strings.TrimSpace(in.Description),
		Priority:    normalizePriority(in.Priority),
		DueDate:     in.DueDate,
		AssigneeID:  in.AssigneeID,
		CoverColor:  in.CoverColor,
		CreatedBy:   actorID,
		CreatedAt:   ts(ms(now)),
		UpdatedAt:   ts(ms(now)),
	}
	if column.IsDone {
		card.CompletedAt = &card.CreatedAt
	}

	err = s.withTx(ctx, func(tx *sql.Tx) error {
		var count int
		if err := tx.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM cards WHERE column_id = ? AND archived = 0`, columnID).Scan(&count); err != nil {
			return fmt.Errorf("count column cards: %w", err)
		}
		if column.WIPLimit > 0 && count >= column.WIPLimit {
			return fmt.Errorf("%w: %s already holds %d card(s)", ErrWIPLimit, column.Title, count)
		}
		var maxPos sql.NullInt64
		if err := tx.QueryRowContext(ctx,
			`SELECT MAX(position) FROM cards WHERE column_id = ?`, columnID).Scan(&maxPos); err != nil {
			return fmt.Errorf("read max card position: %w", err)
		}
		if maxPos.Valid {
			card.Position = int(maxPos.Int64) + 1
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO cards (id, board_id, column_id, title, description, position, priority, due_date,
			                   assignee_id, cover_color, archived, created_by, created_at, updated_at, completed_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
			card.ID, card.BoardID, card.ColumnID, card.Title, card.Description, card.Position, int(card.Priority),
			optTime(card.DueDate), card.AssigneeID, card.CoverColor, card.CreatedBy, ms(now), ms(now), optTime(card.CompletedAt),
		); err != nil {
			return fmt.Errorf("insert card: %w", err)
		}
		if in.LabelIDs != nil {
			if err := s.setCardLabelsTx(ctx, tx, card.ID, card.BoardID, in.LabelIDs); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `UPDATE boards SET updated_at = ? WHERE id = ?`, ms(now), card.BoardID); err != nil {
			return fmt.Errorf("touch board: %w", err)
		}
		return s.recordActivityTx(ctx, tx, card.BoardID, &card.ID, actorID, "card.created", card.Title)
	})
	if err != nil {
		return nil, err
	}
	return card, nil
}

// UpdateCard applies a partial update.
func (s *Store) UpdateCard(ctx context.Context, cardID string, patch CardPatch, actorID string) (*Card, error) {
	current, err := s.CardByID(ctx, cardID)
	if err != nil {
		return nil, err
	}
	sets := []string{}
	args := []any{}
	summary := ""

	if patch.Title != nil {
		title := strings.TrimSpace(*patch.Title)
		if title == "" {
			return nil, fmt.Errorf("%w: card title must not be blank", ErrInvalidInput)
		}
		sets = append(sets, "title = ?")
		args = append(args, title)
	}
	if patch.Description != nil {
		sets = append(sets, "description = ?")
		args = append(args, strings.TrimSpace(*patch.Description))
	}
	if patch.Priority != nil {
		sets = append(sets, "priority = ?")
		args = append(args, normalizePriority(*patch.Priority))
	}
	if patch.DueDate.Set {
		sets = append(sets, "due_date = ?")
		args = append(args, optTime(patch.DueDate.Value))
	}
	if patch.AssigneeID.Set {
		if patch.AssigneeID.Value != nil && *patch.AssigneeID.Value != "" {
			if _, err := s.UserByID(ctx, *patch.AssigneeID.Value); err != nil {
				return nil, fmt.Errorf("%w: assignee does not exist", ErrInvalidInput)
			}
			sets = append(sets, "assignee_id = ?")
			args = append(args, *patch.AssigneeID.Value)
		} else {
			sets = append(sets, "assignee_id = NULL")
		}
	}
	if patch.CoverColor != nil {
		sets = append(sets, "cover_color = ?")
		args = append(args, *patch.CoverColor)
	}
	if patch.Archived != nil {
		sets = append(sets, "archived = ?")
		args = append(args, boolToInt(*patch.Archived))
		summary = "archived this card"
		if !*patch.Archived {
			summary = "restored this card"
		}
	}
	if len(sets) == 0 && patch.LabelIDs == nil {
		return current, nil
	}

	now := ms(s.now())
	if len(sets) > 0 {
		sets = append(sets, "updated_at = ?")
		args = append(args, now, cardID)
	}
	err = s.withTx(ctx, func(tx *sql.Tx) error {
		if len(sets) > 0 {
			res, err := tx.ExecContext(ctx, `UPDATE cards SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...)
			if err != nil {
				return fmt.Errorf("update card: %w", err)
			}
			if n, _ := res.RowsAffected(); n == 0 {
				return ErrNotFound
			}
		}
		if patch.LabelIDs != nil {
			if err := s.setCardLabelsTx(ctx, tx, cardID, current.BoardID, *patch.LabelIDs); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `UPDATE cards SET updated_at = ? WHERE id = ?`, now, cardID); err != nil {
				return fmt.Errorf("touch card: %w", err)
			}
		}
		if _, err := tx.ExecContext(ctx, `UPDATE boards SET updated_at = ? WHERE id = ?`, now, current.BoardID); err != nil {
			return fmt.Errorf("touch board: %w", err)
		}
		verb := "card.updated"
		if summary != "" {
			verb = "card.archived"
			if patch.Archived != nil && !*patch.Archived {
				verb = "card.restored"
			}
		}
		return s.recordActivityTx(ctx, tx, current.BoardID, &cardID, actorID, verb, summary)
	})
	if err != nil {
		return nil, err
	}
	return s.CardByID(ctx, cardID)
}

// MoveCard repositions a card, optionally into a different column.
// position is the desired zero-based index in the destination column and is
// clamped to the valid range.
func (s *Store) MoveCard(ctx context.Context, cardID, targetColumnID string, position int, actorID string) (*Card, error) {
	card, err := s.CardByID(ctx, cardID)
	if err != nil {
		return nil, err
	}
	if targetColumnID == "" {
		targetColumnID = card.ColumnID
	}
	target, err := s.ColumnByID(ctx, targetColumnID)
	if err != nil {
		return nil, err
	}
	if target.BoardID != card.BoardID {
		return nil, fmt.Errorf("%w: cannot move a card to another board", ErrInvalidInput)
	}

	source := card.ColumnID
	var summary string
	err = s.withTx(ctx, func(tx *sql.Tx) error {
		ids, err := cardIDsTx(ctx, tx, target.ID, cardID)
		if err != nil {
			return err
		}
		if source != target.ID {
			// WIP limits only gate cards entering a column.
			var inColumn int
			if err := tx.QueryRowContext(ctx,
				`SELECT COUNT(*) FROM cards WHERE column_id = ? AND archived = 0`, target.ID).Scan(&inColumn); err != nil {
				return fmt.Errorf("count target cards: %w", err)
			}
			if target.WIPLimit > 0 && inColumn >= target.WIPLimit {
				return fmt.Errorf("%w: %s is limited to %d card(s)", ErrWIPLimit, target.Title, target.WIPLimit)
			}
		}
		idx := position
		if idx < 0 {
			idx = 0
		}
		if idx > len(ids) {
			idx = len(ids)
		}
		ordered := make([]string, 0, len(ids)+1)
		ordered = append(ordered, ids[:idx]...)
		ordered = append(ordered, cardID)
		ordered = append(ordered, ids[idx:]...)

		now := ms(s.now())
		for i, id := range ordered {
			var err error
			if id == cardID {
				completed := sql.NullInt64{}
				if target.IsDone {
					if card.CompletedAt != nil {
						completed = sql.NullInt64{Int64: ms(*card.CompletedAt), Valid: true}
					} else {
						completed = sql.NullInt64{Int64: now, Valid: true}
					}
				}
				_, err = tx.ExecContext(ctx, `
					UPDATE cards SET column_id = ?, position = ?, updated_at = ?, completed_at = ? WHERE id = ?`,
					target.ID, i, now, completed, cardID)
			} else {
				_, err = tx.ExecContext(ctx, `UPDATE cards SET position = ? WHERE id = ?`, i, id)
			}
			if err != nil {
				return fmt.Errorf("reposition card: %w", err)
			}
		}
		if source != target.ID {
			if err := normalizeCardPositionsTx(ctx, tx, source); err != nil {
				return err
			}
			summary = fmt.Sprintf("moved to %s", target.Title)
		}
		if _, err := tx.ExecContext(ctx, `UPDATE boards SET updated_at = ? WHERE id = ?`, now, card.BoardID); err != nil {
			return fmt.Errorf("touch board: %w", err)
		}
		return s.recordActivityTx(ctx, tx, card.BoardID, &cardID, actorID, "card.moved", summary)
	})
	if err != nil {
		return nil, err
	}
	return s.CardByID(ctx, cardID)
}

// DeleteCard permanently removes a card. Archived cards are kept by the API
// layer when the caller prefers a soft delete.
func (s *Store) DeleteCard(ctx context.Context, cardID string, actorID string) error {
	card, err := s.CardByID(ctx, cardID)
	if err != nil {
		return err
	}
	return s.withTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM cards WHERE id = ?`, cardID); err != nil {
			return fmt.Errorf("delete card: %w", err)
		}
		if err := normalizeCardPositionsTx(ctx, tx, card.ColumnID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE boards SET updated_at = ? WHERE id = ?`, ms(s.now()), card.BoardID); err != nil {
			return fmt.Errorf("touch board: %w", err)
		}
		return s.recordActivityTx(ctx, tx, card.BoardID, nil, actorID, "card.deleted", card.Title)
	})
}

// ReorderBoard persists a full drag-and-drop outcome in one transaction.
func (s *Store) ReorderBoard(ctx context.Context, boardID string, order []ColumnOrder, actorID string) error {
	if len(order) == 0 {
		return fmt.Errorf("%w: no ordering supplied", ErrInvalidInput)
	}
	return s.withTx(ctx, func(tx *sql.Tx) error {
		boardColumns, err := columnsTx(ctx, tx, boardID)
		if err != nil {
			return err
		}
		columnByID := make(map[string]Column, len(boardColumns))
		for _, col := range boardColumns {
			columnByID[col.ID] = col
		}
		seen := map[string]bool{}
		now := ms(s.now())

		// WIP limits only gate *growth*: a column that is already over its
		// limit (say the limit was lowered afterwards) must stay reorderable.
		currentCounts := map[string]int{}
		countRows, err := tx.QueryContext(ctx,
			`SELECT column_id, COUNT(*) FROM cards WHERE board_id = ? AND archived = 0 GROUP BY column_id`, boardID)
		if err != nil {
			return fmt.Errorf("count board cards: %w", err)
		}
		for countRows.Next() {
			var (
				columnID string
				count    int
			)
			if err := countRows.Scan(&columnID, &count); err != nil {
				countRows.Close()
				return fmt.Errorf("scan board card count: %w", err)
			}
			currentCounts[columnID] = count
		}
		countRows.Close()

		for _, entry := range order {
			col, ok := columnByID[entry.ColumnID]
			if !ok {
				return fmt.Errorf("%w: column %s is not on this board", ErrInvalidInput, entry.ColumnID)
			}
			if col.WIPLimit > 0 && len(entry.CardIDs) > col.WIPLimit && len(entry.CardIDs) > currentCounts[col.ID] {
				return fmt.Errorf("%w: %s is limited to %d card(s)", ErrWIPLimit, col.Title, col.WIPLimit)
			}
			for i, cardID := range entry.CardIDs {
				if seen[cardID] {
					return fmt.Errorf("%w: card %s listed twice", ErrInvalidInput, cardID)
				}
				seen[cardID] = true
				res, err := tx.ExecContext(ctx, `
					UPDATE cards SET column_id = ?, position = ?, updated_at = ?,
					       completed_at = CASE
					           WHEN ? = 1 AND completed_at IS NULL THEN ?
					           WHEN ? = 0 THEN NULL
					           ELSE completed_at END
					WHERE id = ? AND board_id = ?`,
					col.ID, i, now, boolToInt(col.IsDone), now, boolToInt(col.IsDone), cardID, boardID)
				if err != nil {
					return fmt.Errorf("reorder card: %w", err)
				}
				if n, _ := res.RowsAffected(); n == 0 {
					return fmt.Errorf("%w: card %s is not on this board", ErrInvalidInput, cardID)
				}
			}
		}
		if _, err := tx.ExecContext(ctx, `UPDATE boards SET updated_at = ? WHERE id = ?`, now, boardID); err != nil {
			return fmt.Errorf("touch board: %w", err)
		}
		return s.recordActivityTx(ctx, tx, boardID, nil, actorID, "board.reordered", "")
	})
}

func cardIDsTx(ctx context.Context, tx *sql.Tx, columnID, excludeCardID string) ([]string, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT id FROM cards
		WHERE column_id = ? AND archived = 0 AND id <> ?
		ORDER BY position, created_at`, columnID, excludeCardID)
	if err != nil {
		return nil, fmt.Errorf("list column card ids: %w", err)
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan card id: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func normalizeCardPositionsTx(ctx context.Context, tx *sql.Tx, columnID string) error {
	rows, err := tx.QueryContext(ctx,
		`SELECT id FROM cards WHERE column_id = ? ORDER BY position, created_at`, columnID)
	if err != nil {
		return fmt.Errorf("list cards for normalization: %w", err)
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return fmt.Errorf("scan card id: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for i, id := range ids {
		if _, err := tx.ExecContext(ctx, `UPDATE cards SET position = ? WHERE id = ?`, i, id); err != nil {
			return fmt.Errorf("normalize card positions: %w", err)
		}
	}
	return nil
}

func (s *Store) setCardLabelsTx(ctx context.Context, tx *sql.Tx, cardID, boardID string, labelIDs []string) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM card_labels WHERE card_id = ?`, cardID); err != nil {
		return fmt.Errorf("clear card labels: %w", err)
	}
	for _, labelID := range labelIDs {
		var ok int
		if err := tx.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM labels WHERE id = ? AND board_id = ?`, labelID, boardID).Scan(&ok); err != nil {
			return fmt.Errorf("verify label: %w", err)
		}
		if ok == 0 {
			return fmt.Errorf("%w: label %s is not on this board", ErrInvalidInput, labelID)
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT OR IGNORE INTO card_labels (card_id, label_id) VALUES (?, ?)`, cardID, labelID); err != nil {
			return fmt.Errorf("attach label: %w", err)
		}
	}
	return nil
}

// AddCardLabel attaches one label to a card.
func (s *Store) AddCardLabel(ctx context.Context, cardID, labelID string) error {
	card, err := s.CardByID(ctx, cardID)
	if err != nil {
		return err
	}
	var ok int
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM labels WHERE id = ? AND board_id = ?`, labelID, card.BoardID).Scan(&ok); err != nil {
		return fmt.Errorf("verify label: %w", err)
	}
	if ok == 0 {
		return fmt.Errorf("%w: label is not on this board", ErrInvalidInput)
	}
	if _, err := s.db.ExecContext(ctx,
		`INSERT OR IGNORE INTO card_labels (card_id, label_id) VALUES (?, ?)`, cardID, labelID); err != nil {
		return fmt.Errorf("attach label: %w", err)
	}
	return nil
}

// RemoveCardLabel detaches one label from a card.
func (s *Store) RemoveCardLabel(ctx context.Context, cardID, labelID string) error {
	if _, err := s.db.ExecContext(ctx,
		`DELETE FROM card_labels WHERE card_id = ? AND label_id = ?`, cardID, labelID); err != nil {
		return fmt.Errorf("detach label: %w", err)
	}
	return nil
}

// -- checklist --------------------------------------------------------------

// Checklist lists a card's subtasks in order.
func (s *Store) Checklist(ctx context.Context, cardID string) ([]ChecklistItem, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, card_id, text, done, position, created_at
		FROM checklist_items WHERE card_id = ? ORDER BY position, created_at`, cardID)
	if err != nil {
		return nil, fmt.Errorf("list checklist: %w", err)
	}
	defer rows.Close()
	out := []ChecklistItem{}
	for rows.Next() {
		var (
			item      ChecklistItem
			done      int
			createdAt int64
		)
		if err := rows.Scan(&item.ID, &item.CardID, &item.Text, &done, &item.Position, &createdAt); err != nil {
			return nil, fmt.Errorf("scan checklist item: %w", err)
		}
		item.Done = done == 1
		item.CreatedAt = ts(createdAt)
		out = append(out, item)
	}
	return out, rows.Err()
}

// AddChecklistItem appends a subtask.
func (s *Store) AddChecklistItem(ctx context.Context, cardID, text string, actorID string) (*ChecklistItem, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, fmt.Errorf("%w: checklist text is required", ErrInvalidInput)
	}
	card, err := s.CardByID(ctx, cardID)
	if err != nil {
		return nil, err
	}
	item := &ChecklistItem{ID: newID(), CardID: cardID, Text: text}
	err = s.withTx(ctx, func(tx *sql.Tx) error {
		var maxPos sql.NullInt64
		if err := tx.QueryRowContext(ctx,
			`SELECT MAX(position) FROM checklist_items WHERE card_id = ?`, cardID).Scan(&maxPos); err != nil {
			return fmt.Errorf("read checklist position: %w", err)
		}
		if maxPos.Valid {
			item.Position = int(maxPos.Int64) + 1
		}
		now := ms(s.now())
		item.CreatedAt = ts(now)
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO checklist_items (id, card_id, text, done, position, created_at)
			VALUES (?, ?, ?, 0, ?, ?)`, item.ID, item.CardID, item.Text, item.Position, now); err != nil {
			return fmt.Errorf("insert checklist item: %w", err)
		}
		return s.recordActivityTx(ctx, tx, card.BoardID, &cardID, actorID, "checklist.added", text)
	})
	if err != nil {
		return nil, err
	}
	return item, nil
}

// UpdateChecklistItem patches a subtask's text or completion.
func (s *Store) UpdateChecklistItem(ctx context.Context, itemID string, text *string, done *bool, actorID string) (*ChecklistItem, error) {
	sets := []string{}
	args := []any{}
	if text != nil {
		trimmed := strings.TrimSpace(*text)
		if trimmed == "" {
			return nil, fmt.Errorf("%w: checklist text must not be blank", ErrInvalidInput)
		}
		sets = append(sets, "text = ?")
		args = append(args, trimmed)
	}
	if done != nil {
		sets = append(sets, "done = ?")
		args = append(args, boolToInt(*done))
	}
	if len(sets) == 0 {
		return s.checklistItemByID(ctx, itemID)
	}
	args = append(args, itemID)
	if _, err := s.db.ExecContext(ctx, `UPDATE checklist_items SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...); err != nil {
		return nil, fmt.Errorf("update checklist item: %w", err)
	}
	return s.checklistItemByID(ctx, itemID)
}

func (s *Store) checklistItemByID(ctx context.Context, itemID string) (*ChecklistItem, error) {
	var (
		item      ChecklistItem
		done      int
		createdAt int64
	)
	err := s.db.QueryRowContext(ctx, `
		SELECT id, card_id, text, done, position, created_at FROM checklist_items WHERE id = ?`, itemID).
		Scan(&item.ID, &item.CardID, &item.Text, &done, &item.Position, &createdAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("scan checklist item: %w", err)
	}
	item.Done = done == 1
	item.CreatedAt = ts(createdAt)
	return &item, nil
}

// DeleteChecklistItem removes a subtask.
func (s *Store) DeleteChecklistItem(ctx context.Context, itemID string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM checklist_items WHERE id = ?`, itemID)
	if err != nil {
		return fmt.Errorf("delete checklist item: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// -- comments ---------------------------------------------------------------

// Comments lists a card's discussion oldest-first.
func (s *Store) Comments(ctx context.Context, cardID string) ([]Comment, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT c.id, c.card_id, c.author_id, u.name, c.body, c.created_at, c.updated_at
		FROM comments c JOIN users u ON u.id = c.author_id
		WHERE c.card_id = ?
		ORDER BY c.created_at`, cardID)
	if err != nil {
		return nil, fmt.Errorf("list comments: %w", err)
	}
	defer rows.Close()
	out := []Comment{}
	for rows.Next() {
		var (
			cm                   Comment
			createdAt, updatedAt int64
		)
		if err := rows.Scan(&cm.ID, &cm.CardID, &cm.AuthorID, &cm.AuthorName, &cm.Body, &createdAt, &updatedAt); err != nil {
			return nil, fmt.Errorf("scan comment: %w", err)
		}
		cm.CreatedAt = ts(createdAt)
		cm.UpdatedAt = ts(updatedAt)
		out = append(out, cm)
	}
	return out, rows.Err()
}

// AddComment posts a message on a card.
func (s *Store) AddComment(ctx context.Context, cardID, authorID, body string) (*Comment, error) {
	body = strings.TrimSpace(body)
	if body == "" {
		return nil, fmt.Errorf("%w: comment body is required", ErrInvalidInput)
	}
	card, err := s.CardByID(ctx, cardID)
	if err != nil {
		return nil, err
	}
	cm := &Comment{ID: newID(), CardID: cardID, AuthorID: authorID, Body: body}
	now := ms(s.now())
	cm.CreatedAt = ts(now)
	cm.UpdatedAt = cm.CreatedAt
	err = s.withTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO comments (id, card_id, author_id, body, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?)`, cm.ID, cm.CardID, cm.AuthorID, cm.Body, now, now); err != nil {
			return fmt.Errorf("insert comment: %w", err)
		}
		return s.recordActivityTx(ctx, tx, card.BoardID, &cardID, authorID, "comment.added", "")
	})
	if err != nil {
		return nil, err
	}
	if u, err := s.UserByID(ctx, authorID); err == nil {
		cm.AuthorName = u.Name
	}
	return cm, nil
}

// UpdateComment edits a comment body; only the author may do so.
func (s *Store) UpdateComment(ctx context.Context, commentID, authorID, body string) (*Comment, error) {
	body = strings.TrimSpace(body)
	if body == "" {
		return nil, fmt.Errorf("%w: comment body must not be blank", ErrInvalidInput)
	}
	owner, err := s.commentAuthor(ctx, commentID)
	if err != nil {
		return nil, err
	}
	if owner != authorID {
		return nil, fmt.Errorf("%w: only the author can edit a comment", ErrForbidden)
	}
	if _, err := s.db.ExecContext(ctx,
		`UPDATE comments SET body = ?, updated_at = ? WHERE id = ?`, body, ms(s.now()), commentID); err != nil {
		return nil, fmt.Errorf("update comment: %w", err)
	}
	return s.commentByID(ctx, commentID)
}

// DeleteComment removes a comment; only the author may do so.
func (s *Store) DeleteComment(ctx context.Context, commentID, authorID string) error {
	owner, err := s.commentAuthor(ctx, commentID)
	if err != nil {
		return err
	}
	if owner != authorID {
		return fmt.Errorf("%w: only the author can delete a comment", ErrForbidden)
	}
	if _, err := s.db.ExecContext(ctx, `DELETE FROM comments WHERE id = ?`, commentID); err != nil {
		return fmt.Errorf("delete comment: %w", err)
	}
	return nil
}

func (s *Store) commentAuthor(ctx context.Context, commentID string) (string, error) {
	var authorID string
	err := s.db.QueryRowContext(ctx, `SELECT author_id FROM comments WHERE id = ?`, commentID).Scan(&authorID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", ErrNotFound
		}
		return "", fmt.Errorf("lookup comment author: %w", err)
	}
	return authorID, nil
}

func (s *Store) commentByID(ctx context.Context, commentID string) (*Comment, error) {
	var (
		cm                   Comment
		createdAt, updatedAt int64
	)
	err := s.db.QueryRowContext(ctx, `
		SELECT c.id, c.card_id, c.author_id, u.name, c.body, c.created_at, c.updated_at
		FROM comments c JOIN users u ON u.id = c.author_id
		WHERE c.id = ?`, commentID).
		Scan(&cm.ID, &cm.CardID, &cm.AuthorID, &cm.AuthorName, &cm.Body, &createdAt, &updatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("scan comment: %w", err)
	}
	cm.CreatedAt = ts(createdAt)
	cm.UpdatedAt = ts(updatedAt)
	return &cm, nil
}

// CardBoardID resolves the board that owns a card (used for authorization).
func (s *Store) CardBoardID(ctx context.Context, cardID string) (string, error) {
	var boardID string
	err := s.db.QueryRowContext(ctx, `SELECT board_id FROM cards WHERE id = ?`, cardID).Scan(&boardID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", ErrNotFound
		}
		return "", fmt.Errorf("lookup card board: %w", err)
	}
	return boardID, nil
}

// ColumnBoardID resolves the board that owns a column.
func (s *Store) ColumnBoardID(ctx context.Context, columnID string) (string, error) {
	var boardID string
	err := s.db.QueryRowContext(ctx, `SELECT board_id FROM board_columns WHERE id = ?`, columnID).Scan(&boardID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", ErrNotFound
		}
		return "", fmt.Errorf("lookup column board: %w", err)
	}
	return boardID, nil
}

// LabelBoardID resolves the board that owns a label.
func (s *Store) LabelBoardID(ctx context.Context, labelID string) (string, error) {
	var boardID string
	err := s.db.QueryRowContext(ctx, `SELECT board_id FROM labels WHERE id = ?`, labelID).Scan(&boardID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", ErrNotFound
		}
		return "", fmt.Errorf("lookup label board: %w", err)
	}
	return boardID, nil
}

// ChecklistBoardID resolves the board that owns a checklist item.
func (s *Store) ChecklistBoardID(ctx context.Context, itemID string) (string, error) {
	var boardID string
	err := s.db.QueryRowContext(ctx, `
		SELECT c.board_id FROM checklist_items ci JOIN cards c ON c.id = ci.card_id WHERE ci.id = ?`, itemID).Scan(&boardID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", ErrNotFound
		}
		return "", fmt.Errorf("lookup checklist board: %w", err)
	}
	return boardID, nil
}

// CommentBoardID resolves the board that owns a comment.
func (s *Store) CommentBoardID(ctx context.Context, commentID string) (string, error) {
	var boardID string
	err := s.db.QueryRowContext(ctx, `
		SELECT c.board_id FROM comments cm JOIN cards c ON c.id = cm.card_id WHERE cm.id = ?`, commentID).Scan(&boardID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", ErrNotFound
		}
		return "", fmt.Errorf("lookup comment board: %w", err)
	}
	return boardID, nil
}
