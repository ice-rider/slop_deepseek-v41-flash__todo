package store_test

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/flowboard/flowboard/backend/internal/store"
)

func newStore(t *testing.T) *store.Store {
	t.Helper()
	db, err := store.Open(context.Background(), store.Options{
		Path:         filepath.Join(t.TempDir(), "flowboard-test.db"),
		MaxOpenConns: 4,
	})
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func newUser(t *testing.T, s *store.Store, email string) *store.User {
	t.Helper()
	user, err := s.CreateUser(context.Background(), email, "Test User", "$argon2id$fake", "#123456")
	if err != nil {
		t.Fatalf("create user %s: %v", email, err)
	}
	return user
}

func boardWithCards(t *testing.T, s *store.Store) (*store.User, *store.Board, []store.Column) {
	t.Helper()
	ctx := context.Background()
	user := newUser(t, s, "owner@example.com")
	board, err := s.CreateBoard(ctx, user.ID, "Test board", "", "indigo", store.TemplateKanban)
	if err != nil {
		t.Fatalf("create board: %v", err)
	}
	columns, err := s.Columns(ctx, board.ID)
	if err != nil {
		t.Fatalf("list columns: %v", err)
	}
	return user, board, columns
}

func TestCreateBoardAppliesTemplate(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	_, board, columns := boardWithCards(t, s)

	if len(columns) != 5 {
		t.Fatalf("kanban template should create 5 columns, got %d", len(columns))
	}
	if columns[0].Title != "Backlog" || !columns[4].IsDone {
		t.Fatalf("unexpected template columns: %+v", columns)
	}
	for i, col := range columns {
		if col.Position != i {
			t.Fatalf("column %d has position %d", i, col.Position)
		}
	}
	members, err := s.Members(ctx, board.ID)
	if err != nil {
		t.Fatalf("members: %v", err)
	}
	if len(members) != 1 || members[0].Role != store.RoleOwner {
		t.Fatalf("expected the creator to be the sole owner, got %+v", members)
	}
}

func TestCreateBoardRejectsBlankTitle(t *testing.T) {
	s := newStore(t)
	user := newUser(t, s, "blank@example.com")
	_, err := s.CreateBoard(context.Background(), user.ID, "   ", "", "", store.TemplateKanban)
	if !errors.Is(err, store.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestCardMoveReordersDensely(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	user, _, columns := boardWithCards(t, s)

	first, err := s.CreateCard(ctx, columns[0].ID, store.CardInput{Title: "First"}, user.ID)
	if err != nil {
		t.Fatalf("create first card: %v", err)
	}
	second, err := s.CreateCard(ctx, columns[0].ID, store.CardInput{Title: "Second"}, user.ID)
	if err != nil {
		t.Fatalf("create second card: %v", err)
	}
	third, err := s.CreateCard(ctx, columns[0].ID, store.CardInput{Title: "Third"}, user.ID)
	if err != nil {
		t.Fatalf("create third card: %v", err)
	}
	if first.Position != 0 || second.Position != 1 || third.Position != 2 {
		t.Fatalf("append order wrong: %d %d %d", first.Position, second.Position, third.Position)
	}

	// Move the last card to the top of the same column.
	moved, err := s.MoveCard(ctx, third.ID, columns[0].ID, 0, user.ID)
	if err != nil {
		t.Fatalf("move card: %v", err)
	}
	if moved.Position != 0 {
		t.Fatalf("expected position 0, got %d", moved.Position)
	}

	snapshot, err := s.BoardSnapshot(ctx, columns[0].BoardID, false)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	var order []string
	for _, card := range snapshot.Cards {
		if card.ColumnID == columns[0].ID {
			order = append(order, card.Title)
		}
	}
	want := []string{"Third", "First", "Second"}
	if len(order) != len(want) {
		t.Fatalf("expected %d cards, got %v", len(want), order)
	}
	for i := range want {
		if order[i] != want[i] {
			t.Fatalf("order = %v, want %v", order, want)
		}
	}
}

func TestMoveIntoDoneColumnStampsCompletion(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	user, _, columns := boardWithCards(t, s)
	backlog, done := columns[0], columns[4]

	card, err := s.CreateCard(ctx, backlog.ID, store.CardInput{Title: "Ship it"}, user.ID)
	if err != nil {
		t.Fatalf("create card: %v", err)
	}
	if card.CompletedAt != nil {
		t.Fatal("a card created in a non-done column should not be completed")
	}
	moved, err := s.MoveCard(ctx, card.ID, done.ID, 0, user.ID)
	if err != nil {
		t.Fatalf("move to done: %v", err)
	}
	if moved.CompletedAt == nil {
		t.Fatal("moving into a done column should set completedAt")
	}

	back, err := s.MoveCard(ctx, card.ID, backlog.ID, 0, user.ID)
	if err != nil {
		t.Fatalf("move back: %v", err)
	}
	if back.CompletedAt != nil {
		t.Fatal("moving out of a done column should clear completedAt")
	}
}

func TestWIPLimitBlocksEntry(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	user, board, _ := boardWithCards(t, s)

	limited, err := s.CreateColumn(ctx, board.ID, store.ColumnInput{Title: "Limited", WIPLimit: 1}, user.ID)
	if err != nil {
		t.Fatalf("create column: %v", err)
	}
	if _, err := s.CreateCard(ctx, limited.ID, store.CardInput{Title: "Only one"}, user.ID); err != nil {
		t.Fatalf("first card should fit: %v", err)
	}
	if _, err := s.CreateCard(ctx, limited.ID, store.CardInput{Title: "Too many"}, user.ID); !errors.Is(err, store.ErrWIPLimit) {
		t.Fatalf("expected ErrWIPLimit on create, got %v", err)
	}

	source, err := s.CreateColumn(ctx, board.ID, store.ColumnInput{Title: "Unlimited"}, user.ID)
	if err != nil {
		t.Fatalf("create source column: %v", err)
	}
	incoming, err := s.CreateCard(ctx, source.ID, store.CardInput{Title: "Incoming"}, user.ID)
	if err != nil {
		t.Fatalf("create incoming card: %v", err)
	}
	if _, err := s.MoveCard(ctx, incoming.ID, limited.ID, 0, user.ID); !errors.Is(err, store.ErrWIPLimit) {
		t.Fatalf("expected ErrWIPLimit on move, got %v", err)
	}
}

func TestReorderBoardPersistsFullLayout(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	user, board, columns := boardWithCards(t, s)

	a, _ := s.CreateCard(ctx, columns[0].ID, store.CardInput{Title: "A"}, user.ID)
	b, _ := s.CreateCard(ctx, columns[0].ID, store.CardInput{Title: "B"}, user.ID)
	c, _ := s.CreateCard(ctx, columns[1].ID, store.CardInput{Title: "C"}, user.ID)

	// Drag A and C into the done column, B stays in the backlog.
	err := s.ReorderBoard(ctx, board.ID, []store.ColumnOrder{
		{ColumnID: columns[0].ID, CardIDs: []string{b.ID}},
		{ColumnID: columns[4].ID, CardIDs: []string{c.ID, a.ID}},
	}, user.ID)
	if err != nil {
		t.Fatalf("reorder: %v", err)
	}

	snapshot, err := s.BoardSnapshot(ctx, board.ID, false)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	positions := map[string]struct {
		column string
		pos    int
	}{}
	for _, card := range snapshot.Cards {
		positions[card.Title] = struct {
			column string
			pos    int
		}{card.ColumnID, card.Position}
	}
	if positions["B"].column != columns[0].ID || positions["B"].pos != 0 {
		t.Fatalf("B ended up wrong: %+v", positions["B"])
	}
	if positions["C"].column != columns[4].ID || positions["C"].pos != 0 {
		t.Fatalf("C ended up wrong: %+v", positions["C"])
	}
	if positions["A"].column != columns[4].ID || positions["A"].pos != 1 {
		t.Fatalf("A ended up wrong: %+v", positions["A"])
	}
}

func TestReorderBoardRejectsWIPOverflow(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	user, board, columns := boardWithCards(t, s)

	limited, err := s.CreateColumn(ctx, board.ID, store.ColumnInput{Title: "Limited", WIPLimit: 1}, user.ID)
	if err != nil {
		t.Fatalf("create column: %v", err)
	}
	a, _ := s.CreateCard(ctx, columns[0].ID, store.CardInput{Title: "A"}, user.ID)
	b, _ := s.CreateCard(ctx, columns[0].ID, store.CardInput{Title: "B"}, user.ID)

	err = s.ReorderBoard(ctx, board.ID, []store.ColumnOrder{
		{ColumnID: limited.ID, CardIDs: []string{a.ID, b.ID}},
	}, user.ID)
	if !errors.Is(err, store.ErrWIPLimit) {
		t.Fatalf("expected ErrWIPLimit, got %v", err)
	}
}

func TestDeleteColumnRelocatesCards(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	user, board, columns := boardWithCards(t, s)

	card, err := s.CreateCard(ctx, columns[1].ID, store.CardInput{Title: "Rescue me"}, user.ID)
	if err != nil {
		t.Fatalf("create card: %v", err)
	}
	if err := s.DeleteColumn(ctx, columns[1].ID, columns[2].ID, user.ID); err != nil {
		t.Fatalf("delete column: %v", err)
	}
	reloaded, err := s.CardByID(ctx, card.ID)
	if err != nil {
		t.Fatalf("card should survive: %v", err)
	}
	if reloaded.ColumnID != columns[2].ID {
		t.Fatalf("card was not relocated: %s", reloaded.ColumnID)
	}
	remaining, err := s.Columns(ctx, board.ID)
	if err != nil {
		t.Fatalf("columns: %v", err)
	}
	if len(remaining) != 4 {
		t.Fatalf("expected 4 columns, got %d", len(remaining))
	}
	for i, col := range remaining {
		if col.Position != i {
			t.Fatalf("positions not normalised after delete: %+v", remaining)
		}
	}
}

func TestCannotDeleteLastColumn(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	user, board, err := func() (*store.User, *store.Board, error) {
		u := newUser(t, s, "solo@example.com")
		b, err := s.CreateBoard(ctx, u.ID, "Solo", "", "", store.TemplateBlank)
		return u, b, err
	}()
	if err != nil {
		t.Fatalf("create board: %v", err)
	}
	columns, _ := s.Columns(ctx, board.ID)
	if err := s.DeleteColumn(ctx, columns[0].ID, "", user.ID); err != nil {
		t.Fatalf("first deletion should succeed: %v", err)
	}
	last, _ := s.Columns(ctx, board.ID)
	if err := s.DeleteColumn(ctx, last[0].ID, "", user.ID); !errors.Is(err, store.ErrLastColumn) {
		t.Fatalf("expected ErrLastColumn, got %v", err)
	}
}

func TestBoardRolesGateWrites(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	owner, board, columns := boardWithCards(t, s)
	viewer := newUser(t, s, "viewer@example.com")

	if _, err := s.AddMemberByEmail(ctx, board.ID, viewer.Email, store.RoleViewer, owner.ID); err != nil {
		t.Fatalf("add viewer: %v", err)
	}
	if _, err := s.RequireWriter(ctx, board.ID, viewer.ID); !errors.Is(err, store.ErrForbidden) {
		t.Fatalf("viewer should be blocked from writing, got %v", err)
	}
	if _, err := s.RequireWriter(ctx, board.ID, owner.ID); err != nil {
		t.Fatalf("owner should be allowed to write: %v", err)
	}

	editor := newUser(t, s, "editor@example.com")
	if _, err := s.AddMemberByEmail(ctx, board.ID, editor.Email, store.RoleEditor, owner.ID); err != nil {
		t.Fatalf("add editor: %v", err)
	}
	if _, err := s.RequireWriter(ctx, board.ID, editor.ID); err != nil {
		t.Fatalf("editor should be allowed to write: %v", err)
	}
	if _, err := s.CreateCard(ctx, columns[0].ID, store.CardInput{Title: "Editor card"}, editor.ID); err != nil {
		t.Fatalf("editor could not create a card: %v", err)
	}

	stranger := newUser(t, s, "stranger@example.com")
	if _, err := s.BoardRole(ctx, board.ID, stranger.ID); !errors.Is(err, store.ErrForbidden) {
		t.Fatalf("stranger should be forbidden, got %v", err)
	}
}

func TestOwnerCannotBeRemoved(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	owner, board, _ := boardWithCards(t, s)
	if err := s.RemoveMember(ctx, board.ID, owner.ID, owner.ID); !errors.Is(err, store.ErrForbidden) {
		t.Fatalf("expected ErrForbidden, got %v", err)
	}
}

func TestLabelsChecklistAndComments(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	user, board, columns := boardWithCards(t, s)

	label, err := s.CreateLabel(ctx, board.ID, "backend", "sky")
	if err != nil {
		t.Fatalf("create label: %v", err)
	}
	if _, err := s.CreateLabel(ctx, board.ID, "backend", "sky"); !errors.Is(err, store.ErrConflict) {
		t.Fatalf("duplicate label should conflict, got %v", err)
	}

	card, err := s.CreateCard(ctx, columns[0].ID, store.CardInput{
		Title:    "Card with extras",
		LabelIDs: []string{label.ID},
	}, user.ID)
	if err != nil {
		t.Fatalf("create card: %v", err)
	}

	item, err := s.AddChecklistItem(ctx, card.ID, "Write the handler", user.ID)
	if err != nil {
		t.Fatalf("add checklist item: %v", err)
	}
	done := true
	if _, err := s.UpdateChecklistItem(ctx, item.ID, nil, &done, user.ID); err != nil {
		t.Fatalf("complete checklist item: %v", err)
	}
	if _, err := s.AddComment(ctx, card.ID, user.ID, "Looks good to me."); err != nil {
		t.Fatalf("add comment: %v", err)
	}

	detail, err := s.CardDetail(ctx, card.ID)
	if err != nil {
		t.Fatalf("card detail: %v", err)
	}
	if len(detail.Labels) != 1 || detail.Labels[0].Name != "backend" {
		t.Fatalf("labels not attached: %+v", detail.Labels)
	}
	if detail.Card.Checklist.Total != 1 || detail.Card.Checklist.Done != 1 {
		t.Fatalf("checklist counts wrong: %+v", detail.Card.Checklist)
	}
	if len(detail.Comments) != 1 || detail.Card.CommentCount != 1 {
		t.Fatalf("comments not attached: %+v", detail.Comments)
	}
	if len(detail.Activity) == 0 {
		t.Fatal("expected an audit trail for the card")
	}

	// Labels from another board must not be attachable.
	other := newUser(t, s, "other@example.com")
	otherBoard, _ := s.CreateBoard(ctx, other.ID, "Other", "", "", store.TemplateBlank)
	foreign, _ := s.CreateLabel(ctx, otherBoard.ID, "foreign", "rose")
	if err := s.AddCardLabel(ctx, card.ID, foreign.ID); !errors.Is(err, store.ErrInvalidInput) {
		t.Fatalf("foreign label should be rejected, got %v", err)
	}
}

func TestCommentEditingIsAuthorOnly(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	user, _, columns := boardWithCards(t, s)
	other := newUser(t, s, "other@example.com")

	card, _ := s.CreateCard(ctx, columns[0].ID, store.CardInput{Title: "Discuss"}, user.ID)
	comment, err := s.AddComment(ctx, card.ID, user.ID, "Original body")
	if err != nil {
		t.Fatalf("add comment: %v", err)
	}
	if _, err := s.UpdateComment(ctx, comment.ID, other.ID, "hijacked"); !errors.Is(err, store.ErrForbidden) {
		t.Fatalf("expected ErrForbidden, got %v", err)
	}
	if err := s.DeleteComment(ctx, comment.ID, other.ID); !errors.Is(err, store.ErrForbidden) {
		t.Fatalf("expected ErrForbidden, got %v", err)
	}
	if _, err := s.UpdateComment(ctx, comment.ID, user.ID, "Edited body"); err != nil {
		t.Fatalf("author should be able to edit: %v", err)
	}
}

func TestSearchAndStats(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	user, board, columns := boardWithCards(t, s)

	today := time.Now().UTC()
	overdue := today.AddDate(0, 0, -3)
	soon := today.AddDate(0, 0, 2)

	if _, err := s.CreateCard(ctx, columns[0].ID, store.CardInput{
		Title: "Fix the login bug", Priority: 3, DueDate: &overdue, AssigneeID: &user.ID,
	}, user.ID); err != nil {
		t.Fatalf("create overdue card: %v", err)
	}
	if _, err := s.CreateCard(ctx, columns[0].ID, store.CardInput{
		Title: "Write release notes", Priority: 1, DueDate: &soon,
	}, user.ID); err != nil {
		t.Fatalf("create due-soon card: %v", err)
	}
	if _, err := s.CreateCard(ctx, columns[4].ID, store.CardInput{
		Title: "Archive the old docs", Priority: 0,
	}, user.ID); err != nil {
		t.Fatalf("create done card: %v", err)
	}

	byText, err := s.SearchCards(ctx, user.ID, store.CardFilter{Query: "login"})
	if err != nil {
		t.Fatalf("search by text: %v", err)
	}
	if len(byText) != 1 || byText[0].Title != "Fix the login bug" {
		t.Fatalf("unexpected text search result: %+v", byText)
	}
	if byText[0].BoardTitle != "Test board" || byText[0].ColumnTitle == "" {
		t.Fatalf("search hit is missing board context: %+v", byText[0])
	}

	overdueHits, err := s.SearchCards(ctx, user.ID, store.CardFilter{OverdueOnly: true})
	if err != nil {
		t.Fatalf("search overdue: %v", err)
	}
	if len(overdueHits) != 1 || overdueHits[0].Title != "Fix the login bug" {
		t.Fatalf("unexpected overdue result: %+v", overdueHits)
	}

	urgent, err := s.SearchCards(ctx, user.ID, store.CardFilter{Priorities: []int{int(store.PriorityUrgent)}})
	if err != nil {
		t.Fatalf("search by priority: %v", err)
	}
	if len(urgent) != 1 {
		t.Fatalf("expected 1 urgent card, got %d", len(urgent))
	}

	mine, err := s.SearchCards(ctx, user.ID, store.CardFilter{AssigneeID: user.ID})
	if err != nil {
		t.Fatalf("search assigned: %v", err)
	}
	if len(mine) != 1 {
		t.Fatalf("expected 1 assigned card, got %d", len(mine))
	}

	stats, err := s.Stats(ctx, user.ID, board.ID)
	if err != nil {
		t.Fatalf("stats: %v", err)
	}
	if stats.TotalCards != 3 {
		t.Fatalf("totalCards = %d, want 3", stats.TotalCards)
	}
	if stats.CompletedCards != 1 {
		t.Fatalf("completedCards = %d, want 1", stats.CompletedCards)
	}
	if stats.OverdueCards != 1 {
		t.Fatalf("overdueCards = %d, want 1", stats.OverdueCards)
	}
	if stats.ByPriority["urgent"] != 1 {
		t.Fatalf("priority breakdown wrong: %+v", stats.ByPriority)
	}
	if len(stats.CompletedByDay) != 14 {
		t.Fatalf("expected a 14 day trend, got %d points", len(stats.CompletedByDay))
	}

	// Another user must not see these cards.
	other := newUser(t, s, "outsider@example.com")
	outsiderHits, err := s.SearchCards(ctx, other.ID, store.CardFilter{})
	if err != nil {
		t.Fatalf("outsider search: %v", err)
	}
	if len(outsiderHits) != 0 {
		t.Fatalf("outsider saw %d cards", len(outsiderHits))
	}
}

func TestArchivedCardsAreHiddenByDefault(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	user, board, columns := boardWithCards(t, s)

	card, _ := s.CreateCard(ctx, columns[0].ID, store.CardInput{Title: "Temporary"}, user.ID)
	archived := true
	if _, err := s.UpdateCard(ctx, card.ID, store.CardPatch{Archived: &archived}, user.ID); err != nil {
		t.Fatalf("archive card: %v", err)
	}

	snapshot, err := s.BoardSnapshot(ctx, board.ID, false)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if len(snapshot.Cards) != 0 {
		t.Fatalf("archived card leaked into the default snapshot: %+v", snapshot.Cards)
	}
	withArchived, err := s.BoardSnapshot(ctx, board.ID, true)
	if err != nil {
		t.Fatalf("snapshot with archived: %v", err)
	}
	if len(withArchived.Cards) != 1 {
		t.Fatalf("expected the archived card when requested, got %d", len(withArchived.Cards))
	}
}

func TestRefreshTokenLifecycle(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	user := newUser(t, s, "session@example.com")

	hash := "hash-value"
	expiry := time.Now().UTC().Add(time.Hour)
	if err := s.SaveRefreshToken(ctx, user.ID, hash, "test-agent", expiry); err != nil {
		t.Fatalf("save refresh token: %v", err)
	}
	record, err := s.RefreshTokenByHash(ctx, hash)
	if err != nil {
		t.Fatalf("load refresh token: %v", err)
	}
	if record.UserID != user.ID || record.RevokedAt != nil {
		t.Fatalf("unexpected token record: %+v", record)
	}
	if err := s.RevokeRefreshToken(ctx, hash); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	record, _ = s.RefreshTokenByHash(ctx, hash)
	if record.RevokedAt == nil {
		t.Fatal("token was not marked revoked")
	}
	removed, err := s.PurgeExpiredTokens(ctx)
	if err != nil {
		t.Fatalf("purge: %v", err)
	}
	if removed != 1 {
		t.Fatalf("expected 1 purged token, got %d", removed)
	}
}

func TestAuditTrailRecordsMutations(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	user, board, columns := boardWithCards(t, s)

	card, _ := s.CreateCard(ctx, columns[0].ID, store.CardInput{Title: "Audited"}, user.ID)
	if _, err := s.MoveCard(ctx, card.ID, columns[1].ID, 0, user.ID); err != nil {
		t.Fatalf("move: %v", err)
	}
	if _, err := s.UpdateCard(ctx, card.ID, store.CardPatch{Title: strPtr("Renamed")}, user.ID); err != nil {
		t.Fatalf("update: %v", err)
	}

	activity, err := s.Activity(ctx, board.ID, 50)
	if err != nil {
		t.Fatalf("activity: %v", err)
	}
	verbs := map[string]int{}
	for _, entry := range activity {
		verbs[entry.Verb]++
		if entry.ActorName == "" {
			t.Fatalf("activity entry is missing the actor name: %+v", entry)
		}
	}
	for _, want := range []string{"card.created", "card.moved", "card.updated"} {
		if verbs[want] == 0 {
			t.Fatalf("missing %q in audit trail: %+v", want, verbs)
		}
	}
}

func strPtr(v string) *string { return &v }
