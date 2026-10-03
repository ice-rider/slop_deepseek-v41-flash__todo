// Package seed populates a fresh database with a realistic demo workspace so
// the first login is not an empty screen.
package seed

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/flowboard/flowboard/backend/internal/auth"
	"github.com/flowboard/flowboard/backend/internal/store"
)

// DemoEmail and DemoPassword are the credentials printed on first boot.
const (
	DemoEmail    = "demo@flowboard.app"
	DemoPassword = "demo1234"
	DemoName     = "Demo User"
)

// EnsureDemo creates the demo account and boards when the database is empty.
// It is idempotent: an existing demo account is left untouched.
func EnsureDemo(ctx context.Context, s *store.Store, logger *slog.Logger) error {
	count, err := s.CountUsers(ctx)
	if err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	if logger != nil {
		logger.Info("seeding demo workspace", "email", DemoEmail)
	}

	hash, err := auth.HashPassword(DemoPassword)
	if err != nil {
		return err
	}
	user, err := s.CreateUser(ctx, DemoEmail, DemoName, hash, "#6366f1")
	if err != nil {
		if errors.Is(err, store.ErrConflict) {
			return nil
		}
		return err
	}

	for _, spec := range demoBoards {
		if err := buildBoard(ctx, s, user, spec); err != nil {
			return err
		}
	}
	return nil
}

type cardSpec struct {
	column      string
	title       string
	description string
	priority    int
	dueInDays   int // negative is overdue, 99 means "no due date"
	labels      []string
	checklist   []string
	doneItems   int
	comments    []string
	assignSelf  bool
}

type boardSpec struct {
	title       string
	description string
	color       string
	template    store.BoardTemplate
	extraLabels []string
	cards       []cardSpec
}

var demoBoards = []boardSpec{
	{
		title:       "Product launch",
		description: "Everything needed to ship FlowBoard 1.0 — marketing, docs and release chores.",
		color:       "indigo",
		template:    store.TemplateKanban,
		extraLabels: []string{"marketing", "docs", "release"},
		cards: []cardSpec{
			{
				column: "To do", title: "Write the launch blog post",
				description: "Cover the kanban workflow, keyboard shortcuts and the **realtime** sync.\n\n- [ ] outline\n- [ ] draft\n- [ ] screenshots",
				priority:    2, dueInDays: 4, labels: []string{"marketing", "docs"},
				checklist: []string{"Outline the story", "Draft 800 words", "Capture screenshots"},
			},
			{
				column: "To do", title: "Record a 2 minute product tour",
				priority: 1, dueInDays: 9, labels: []string{"marketing"},
				checklist: []string{"Write the script", "Record voice-over"},
			},
			{
				column: "In progress", title: "Ship the Docker compose stack",
				description: "nginx reverse proxy in front of the API, database on an internal-only network.",
				priority:    3, dueInDays: 1, labels: []string{"release"},
				checklist: []string{"Write Dockerfiles", "Isolate the data network", "Health checks"}, doneItems: 1,
				comments: []string{"TLS still needs a decision before the release cut."},
			},
			{
				column: "In progress", title: "Polish drag-and-drop accessibility",
				priority: 2, dueInDays: -1, labels: []string{"release"},
				checklist: []string{"Keyboard sensor", "Screen-reader announcements", "Focus ring"}, doneItems: 2,
			},
			{
				column: "Review", title: "API reference for /api/v1",
				description: "Every endpoint, with request and response examples.",
				priority:    1, dueInDays: 2, labels: []string{"docs"},
			},
			{
				column: "Backlog", title: "Investigate calendar sync",
				priority: 0, dueInDays: 99, labels: []string{"docs"},
			},
			{
				column: "Backlog", title: "Dark mode contrast audit",
				priority: 1, dueInDays: 99,
			},
			{
				column: "Done", title: "Design the card layout",
				priority: 2, dueInDays: -6, labels: []string{"marketing"},
				checklist: []string{"Wireframes", "Component spec", "Design review"}, doneItems: 3,
			},
		},
	},
	{
		title:       "Personal week",
		description: "A lighter board for the week ahead — errands, admin and reading.",
		color:       "emerald",
		template:    store.TemplatePersonal,
		extraLabels: []string{"errand", "reading"},
		cards: []cardSpec{
			{
				column: "Today", title: "Renew the domain name",
				priority: 3, dueInDays: 0, labels: []string{"errand"}, assignSelf: true,
			},
			{
				column: "Today", title: "Reply to the design feedback thread",
				priority: 2, dueInDays: 0, assignSelf: true,
			},
			{
				column: "This week", title: "Finish reading _Shape Up_",
				priority: 0, dueInDays: 5, labels: []string{"reading"},
				checklist: []string{"Chapter 4", "Chapter 5"}, doneItems: 1,
			},
			{
				column: "Someday", title: "Plan the autumn cycling trip",
				priority: 0, dueInDays: 99,
			},
			{
				column: "Done", title: "Book the dentist appointment",
				priority: 1, dueInDays: -2,
			},
		},
	},
}

func buildBoard(ctx context.Context, s *store.Store, user *store.User, spec boardSpec) error {
	board, err := s.CreateBoard(ctx, user.ID, spec.title, spec.description, spec.color, spec.template)
	if err != nil {
		return err
	}
	columns, err := s.Columns(ctx, board.ID)
	if err != nil {
		return err
	}
	byTitle := map[string]store.Column{}
	for _, col := range columns {
		byTitle[col.Title] = col
	}

	labels := map[string]store.Label{}
	for _, name := range spec.extraLabels {
		label, err := s.CreateLabel(ctx, board.ID, name, labelColor(name))
		if err != nil && !errors.Is(err, store.ErrConflict) {
			return err
		}
		if err == nil {
			labels[name] = *label
		}
	}

	now := time.Now().UTC()
	for _, card := range spec.cards {
		column, ok := byTitle[card.column]
		if !ok {
			continue
		}
		var due *time.Time
		if card.dueInDays != 99 {
			day := time.Date(now.Year(), now.Month(), now.Day(), 17, 0, 0, 0, time.UTC).AddDate(0, 0, card.dueInDays)
			due = &day
		}
		labelIDs := make([]string, 0, len(card.labels))
		for _, name := range card.labels {
			if label, ok := labels[name]; ok {
				labelIDs = append(labelIDs, label.ID)
			}
		}
		var assignee *string
		if card.assignSelf {
			assignee = &user.ID
		}
		created, err := s.CreateCard(ctx, column.ID, store.CardInput{
			Title:       card.title,
			Description: card.description,
			Priority:    card.priority,
			DueDate:     due,
			AssigneeID:  assignee,
			LabelIDs:    labelIDs,
		}, user.ID)
		if err != nil {
			return err
		}
		for i, item := range card.checklist {
			createdItem, err := s.AddChecklistItem(ctx, created.ID, item, user.ID)
			if err != nil {
				return err
			}
			if i < card.doneItems {
				done := true
				if _, err := s.UpdateChecklistItem(ctx, createdItem.ID, nil, &done, user.ID); err != nil {
					return err
				}
			}
		}
		for _, body := range card.comments {
			if _, err := s.AddComment(ctx, created.ID, user.ID, body); err != nil {
				return err
			}
		}
	}
	return nil
}

func labelColor(name string) string {
	palette := []string{"sky", "violet", "amber", "rose", "emerald", "cyan", "orange", "fuchsia"}
	sum := 0
	for _, r := range name {
		sum += int(r)
	}
	return palette[sum%len(palette)]
}
