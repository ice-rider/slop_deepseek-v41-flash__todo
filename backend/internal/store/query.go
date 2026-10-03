package store

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// CardFilter describes a cross-board card query.
type CardFilter struct {
	Query           string
	BoardID         string
	LabelIDs        []string
	Priorities      []int
	AssigneeID      string
	Unassigned      bool
	DueBefore       *time.Time
	DueAfter        *time.Time
	OverdueOnly     bool
	HasDueDate      *bool
	IncludeArchived bool
	CompletedOnly   bool
	Limit           int
	Offset          int
	// Sort accepts "", "due", "created", "updated", "priority" or "title".
	Sort string
}

// SearchHit is a card plus the board/column context needed to render it in a
// flat list (search results, "My work", dashboard rails).
type SearchHit struct {
	Card
	BoardTitle   string `json:"boardTitle"`
	BoardColor   string `json:"boardColor"`
	ColumnTitle  string `json:"columnTitle"`
	ColumnIsDone bool   `json:"columnIsDone"`
}

// SearchCards runs a filtered query limited to boards the user can access.
func (s *Store) SearchCards(ctx context.Context, userID string, f CardFilter) ([]SearchHit, error) {
	limit := f.Limit
	if limit <= 0 || limit > 200 {
		limit = 60
	}
	if f.Offset < 0 {
		f.Offset = 0
	}

	order, err := orderClause(f.Sort)
	if err != nil {
		return nil, err
	}

	// The membership join is the first placeholder in the statement, so its
	// arguments must be collected separately and prepended.
	joinArgs := []any{userID}

	where := []string{"(b.owner_id = ? OR bm.user_id IS NOT NULL)"}
	whereArgs := []any{userID}
	if !f.IncludeArchived {
		where = append(where, "c.archived = 0")
	}
	if f.BoardID != "" {
		where = append(where, "c.board_id = ?")
		whereArgs = append(whereArgs, f.BoardID)
	}
	if q := strings.TrimSpace(f.Query); q != "" {
		where = append(where, "(c.title LIKE ? OR c.description LIKE ?)")
		like := "%" + q + "%"
		whereArgs = append(whereArgs, like, like)
	}
	if len(f.Priorities) > 0 {
		placeholders := make([]string, 0, len(f.Priorities))
		for _, p := range f.Priorities {
			placeholders = append(placeholders, "?")
			whereArgs = append(whereArgs, normalizePriority(p))
		}
		where = append(where, "c.priority IN ("+strings.Join(placeholders, ", ")+")")
	}
	if f.Unassigned {
		where = append(where, "c.assignee_id IS NULL")
	} else if f.AssigneeID != "" {
		where = append(where, "c.assignee_id = ?")
		whereArgs = append(whereArgs, f.AssigneeID)
	}
	if len(f.LabelIDs) > 0 {
		placeholders := make([]string, 0, len(f.LabelIDs))
		for _, id := range f.LabelIDs {
			placeholders = append(placeholders, "?")
			whereArgs = append(whereArgs, id)
		}
		where = append(where, `EXISTS (
			SELECT 1 FROM card_labels clf
			WHERE clf.card_id = c.id AND clf.label_id IN (`+strings.Join(placeholders, ", ")+`))`)
	}
	if f.DueBefore != nil {
		where = append(where, "c.due_date IS NOT NULL AND c.due_date < ?")
		whereArgs = append(whereArgs, ms(*f.DueBefore))
	}
	if f.DueAfter != nil {
		where = append(where, "c.due_date IS NOT NULL AND c.due_date >= ?")
		whereArgs = append(whereArgs, ms(*f.DueAfter))
	}
	if f.OverdueOnly {
		where = append(where, "c.due_date IS NOT NULL AND c.due_date < ? AND c.completed_at IS NULL")
		whereArgs = append(whereArgs, ms(s.now()))
	}
	if f.HasDueDate != nil {
		if *f.HasDueDate {
			where = append(where, "c.due_date IS NOT NULL")
		} else {
			where = append(where, "c.due_date IS NULL")
		}
	}
	if f.CompletedOnly {
		where = append(where, "c.completed_at IS NOT NULL")
	}

	args := make([]any, 0, len(joinArgs)+len(whereArgs)+2)
	args = append(args, joinArgs...)
	args = append(args, whereArgs...)
	args = append(args, limit, f.Offset)

	rows, err := s.db.QueryContext(ctx, `
		SELECT `+cardColumns+`,
		       COALESCE(u.name, '') AS assignee_name,
		       (SELECT COUNT(*) FROM checklist_items ci WHERE ci.card_id = c.id),
		       (SELECT COUNT(*) FROM checklist_items ci WHERE ci.card_id = c.id AND ci.done = 1),
		       (SELECT COUNT(*) FROM comments cc WHERE cc.card_id = c.id),
		       b.title, b.color, col.title, col.is_done
		FROM cards c
		JOIN boards b ON b.id = c.board_id
		JOIN board_columns col ON col.id = c.column_id
		LEFT JOIN board_members bm ON bm.board_id = b.id AND bm.user_id = ?
		LEFT JOIN users u ON u.id = c.assignee_id
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY `+order+`
		LIMIT ? OFFSET ?`, args...)
	if err != nil {
		return nil, fmt.Errorf("search cards: %w", err)
	}
	defer rows.Close()

	out := []SearchHit{}
	for rows.Next() {
		var (
			hit                  SearchHit
			dueDate, completedAt sql.NullInt64
			assigneeID           sql.NullString
			archived             int
			createdAt, updatedAt int64
			priority             int
			isDone               int
		)
		if err := rows.Scan(
			&hit.ID, &hit.BoardID, &hit.ColumnID, &hit.Title, &hit.Description, &hit.Position, &priority,
			&dueDate, &assigneeID, &hit.CoverColor, &archived, &hit.CreatedBy, &createdAt, &updatedAt, &completedAt,
			&hit.AssigneeName, &hit.Checklist.Total, &hit.Checklist.Done, &hit.CommentCount,
			&hit.BoardTitle, &hit.BoardColor, &hit.ColumnTitle, &isDone,
		); err != nil {
			return nil, fmt.Errorf("scan search hit: %w", err)
		}
		hit.Priority = normalizePriority(priority)
		hit.DueDate = tsPtr(dueDate)
		hit.CompletedAt = tsPtr(completedAt)
		hit.AssigneeID = ptrOrNil(assigneeID)
		hit.Archived = archived == 1
		hit.CreatedAt = ts(createdAt)
		hit.UpdatedAt = ts(updatedAt)
		hit.ColumnIsDone = isDone == 1
		hit.LabelIDs = []string{}
		out = append(out, hit)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Attach labels for the returned page in one extra query.
	if len(out) > 0 {
		placeholders := make([]string, 0, len(out))
		labelArgs := make([]any, 0, len(out))
		index := map[string]int{}
		for i := range out {
			placeholders = append(placeholders, "?")
			labelArgs = append(labelArgs, out[i].ID)
			index[out[i].ID] = i
		}
		labelRows, err := s.db.QueryContext(ctx, `
			SELECT card_id, label_id FROM card_labels
			WHERE card_id IN (`+strings.Join(placeholders, ", ")+`)`, labelArgs...)
		if err != nil {
			return nil, fmt.Errorf("attach search labels: %w", err)
		}
		defer labelRows.Close()
		for labelRows.Next() {
			var cardID, labelID string
			if err := labelRows.Scan(&cardID, &labelID); err != nil {
				return nil, fmt.Errorf("scan search label: %w", err)
			}
			if i, ok := index[cardID]; ok {
				out[i].LabelIDs = append(out[i].LabelIDs, labelID)
			}
		}
		if err := labelRows.Err(); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func orderClause(sort string) (string, error) {
	switch sort {
	case "", "due":
		return `CASE WHEN c.due_date IS NULL THEN 1 ELSE 0 END, c.due_date, c.priority DESC, c.created_at`, nil
	case "created":
		return "c.created_at DESC", nil
	case "updated":
		return "c.updated_at DESC", nil
	case "priority":
		return "c.priority DESC, CASE WHEN c.due_date IS NULL THEN 1 ELSE 0 END, c.due_date", nil
	case "title":
		return "c.title COLLATE NOCASE", nil
	case "position":
		return "c.position", nil
	default:
		return "", fmt.Errorf("%w: unknown sort %q", ErrInvalidInput, sort)
	}
}

// Stats computes dashboard metrics for every board a user can access, or for a
// single board when boardID is set.
func (s *Store) Stats(ctx context.Context, userID, boardID string) (*Stats, error) {
	stats := &Stats{
		ByPriority:     map[string]int{"low": 0, "medium": 0, "high": 0, "urgent": 0},
		ByColumn:       []ColumnCount{},
		ByBoard:        []BoardCount{},
		CompletedByDay: []DayCount{},
	}

	// baseFromArgs holds the placeholders that appear in the JOIN/WHERE of the
	// shared FROM clause, in statement order.
	baseFromArgs := []any{userID, userID}
	boardFilter := ""
	if boardID != "" {
		boardFilter = " AND c.board_id = ?"
		baseFromArgs = append(baseFromArgs, boardID)
	}
	base := `
		FROM cards c
		JOIN boards b ON b.id = c.board_id
		JOIN board_columns col ON col.id = c.column_id
		LEFT JOIN board_members bm ON bm.board_id = b.id AND bm.user_id = ?
		WHERE (b.owner_id = ? OR bm.user_id IS NOT NULL) AND c.archived = 0` + boardFilter

	now := s.now()
	startOfDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	endOfDay := startOfDay.Add(24 * time.Hour)
	endOfWeek := startOfDay.AddDate(0, 0, 7)

	totalsArgs := append([]any{ms(now), ms(startOfDay), ms(endOfDay), ms(startOfDay), ms(endOfWeek)}, baseFromArgs...)
	if err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*),
		       COALESCE(SUM(CASE WHEN c.completed_at IS NOT NULL THEN 1 ELSE 0 END), 0),
		       COALESCE(SUM(CASE WHEN c.due_date IS NOT NULL AND c.due_date < ? AND c.completed_at IS NULL THEN 1 ELSE 0 END), 0),
		       COALESCE(SUM(CASE WHEN c.due_date >= ? AND c.due_date < ? AND c.completed_at IS NULL THEN 1 ELSE 0 END), 0),
		       COALESCE(SUM(CASE WHEN c.due_date >= ? AND c.due_date < ? AND c.completed_at IS NULL THEN 1 ELSE 0 END), 0),
		       COALESCE(SUM(CASE WHEN c.assignee_id IS NULL AND c.completed_at IS NULL THEN 1 ELSE 0 END), 0)
		`+base, totalsArgs...,
	).Scan(
		&stats.TotalCards, &stats.CompletedCards, &stats.OverdueCards,
		&stats.DueToday, &stats.DueThisWeek, &stats.Unassigned,
	); err != nil {
		return nil, fmt.Errorf("card totals: %w", err)
	}

	priorityRows, err := s.db.QueryContext(ctx, `
		SELECT c.priority, COUNT(*) `+base+` GROUP BY c.priority`, baseFromArgs...)
	if err != nil {
		return nil, fmt.Errorf("priority breakdown: %w", err)
	}
	for priorityRows.Next() {
		var (
			priority int
			count    int
		)
		if err := priorityRows.Scan(&priority, &count); err != nil {
			priorityRows.Close()
			return nil, fmt.Errorf("scan priority breakdown: %w", err)
		}
		stats.ByPriority[priorityLabel(priority)] = count
	}
	priorityRows.Close()

	columnRows, err := s.db.QueryContext(ctx, `
		SELECT col.id, col.title, COUNT(c.id) `+base+`
		GROUP BY col.id, col.title ORDER BY col.position`, baseFromArgs...)
	if err != nil {
		return nil, fmt.Errorf("column breakdown: %w", err)
	}
	for columnRows.Next() {
		var cc ColumnCount
		if err := columnRows.Scan(&cc.ColumnID, &cc.Title, &cc.Count); err != nil {
			columnRows.Close()
			return nil, fmt.Errorf("scan column breakdown: %w", err)
		}
		stats.ByColumn = append(stats.ByColumn, cc)
	}
	columnRows.Close()

	boardRows, err := s.db.QueryContext(ctx, `
		SELECT b.id, b.title, COUNT(c.id)
		FROM boards b
		LEFT JOIN board_members bm ON bm.board_id = b.id AND bm.user_id = ?
		LEFT JOIN cards c ON c.board_id = b.id AND c.archived = 0
		WHERE b.owner_id = ? OR bm.user_id IS NOT NULL
		GROUP BY b.id, b.title
		ORDER BY COUNT(c.id) DESC, b.title COLLATE NOCASE
		LIMIT 8`, userID, userID)
	if err != nil {
		return nil, fmt.Errorf("board breakdown: %w", err)
	}
	for boardRows.Next() {
		var bc BoardCount
		if err := boardRows.Scan(&bc.BoardID, &bc.Title, &bc.Count); err != nil {
			boardRows.Close()
			return nil, fmt.Errorf("scan board breakdown: %w", err)
		}
		stats.ByBoard = append(stats.ByBoard, bc)
	}
	boardRows.Close()

	// Completion trend for the last 14 days, including days with no activity.
	const days = 14
	since := startOfDay.AddDate(0, 0, -(days - 1))
	trendArgs := append(append([]any{}, baseFromArgs...), ms(since))
	trendRows, err := s.db.QueryContext(ctx, `
		SELECT c.completed_at `+base+` AND c.completed_at >= ?`, trendArgs...)
	if err != nil {
		return nil, fmt.Errorf("completion trend: %w", err)
	}
	buckets := map[string]int{}
	for trendRows.Next() {
		var completedAt sql.NullInt64
		if err := trendRows.Scan(&completedAt); err != nil {
			trendRows.Close()
			return nil, fmt.Errorf("scan completion trend: %w", err)
		}
		if completedAt.Valid {
			buckets[ts(completedAt.Int64).Format("2006-01-02")]++
		}
	}
	trendRows.Close()
	for i := 0; i < days; i++ {
		day := since.AddDate(0, 0, i).Format("2006-01-02")
		stats.CompletedByDay = append(stats.CompletedByDay, DayCount{Date: day, Count: buckets[day]})
	}

	return stats, nil
}

func priorityLabel(p int) string {
	switch normalizePriority(p) {
	case PriorityUrgent:
		return "urgent"
	case PriorityHigh:
		return "high"
	case PriorityMedium:
		return "medium"
	default:
		return "low"
	}
}

// DashboardFeed returns the card rails shown on the dashboard.
func (s *Store) DashboardFeed(ctx context.Context, userID string, limit int) (map[string][]SearchHit, error) {
	if limit <= 0 || limit > 25 {
		limit = 8
	}
	now := s.now()
	startOfDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	endOfWeek := startOfDay.AddDate(0, 0, 7)

	sections := map[string][]SearchHit{}

	overdue, err := s.SearchCards(ctx, userID, CardFilter{OverdueOnly: true, Limit: limit})
	if err != nil {
		return nil, err
	}
	sections["overdue"] = overdue

	dueSoon, err := s.SearchCards(ctx, userID, CardFilter{
		DueAfter: &startOfDay, DueBefore: &endOfWeek, Limit: limit,
	})
	if err != nil {
		return nil, err
	}
	sections["dueSoon"] = dueSoon

	assigned, err := s.SearchCards(ctx, userID, CardFilter{AssigneeID: userID, Limit: limit, Sort: "priority"})
	if err != nil {
		return nil, err
	}
	sections["assigned"] = assigned

	recent, err := s.SearchCards(ctx, userID, CardFilter{Limit: limit, Sort: "updated"})
	if err != nil {
		return nil, err
	}
	sections["recent"] = recent

	return sections, nil
}
