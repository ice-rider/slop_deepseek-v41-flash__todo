package store

import "time"

// Priority is the card urgency level.
type Priority int

// Supported card priorities.
const (
	PriorityLow Priority = iota
	PriorityMedium
	PriorityHigh
	PriorityUrgent
)

// Roles for board membership.
const (
	RoleOwner  = "owner"
	RoleEditor = "editor"
	RoleViewer = "viewer"
)

// User is an authenticated account.
type User struct {
	ID          string    `json:"id"`
	Email       string    `json:"email"`
	Name        string    `json:"name"`
	AvatarColor string    `json:"avatarColor"`
	CreatedAt   time.Time `json:"createdAt"`
}

// UserRecord carries the password hash and never leaves the store package.
type UserRecord struct {
	User
	PasswordHash string
}

// Board is a kanban board.
type Board struct {
	ID          string    `json:"id"`
	OwnerID     string    `json:"ownerId"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Color       string    `json:"color"`
	Starred     bool      `json:"starred"`
	Archived    bool      `json:"archived"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
	Role        string    `json:"role,omitempty"`
}

// Column is a vertical kanban pane.
type Column struct {
	ID        string    `json:"id"`
	BoardID   string    `json:"boardId"`
	Title     string    `json:"title"`
	Color     string    `json:"color"`
	WIPLimit  int       `json:"wipLimit"`
	Position  int       `json:"position"`
	IsDone    bool      `json:"isDone"`
	CreatedAt time.Time `json:"createdAt"`
}

// Card is a task.
type Card struct {
	ID          string     `json:"id"`
	BoardID     string     `json:"boardId"`
	ColumnID    string     `json:"columnId"`
	Title       string     `json:"title"`
	Description string     `json:"description"`
	Position    int        `json:"position"`
	Priority    Priority   `json:"priority"`
	DueDate     *time.Time `json:"dueDate"`
	AssigneeID  *string    `json:"assigneeId"`
	CoverColor  string     `json:"coverColor"`
	Archived    bool       `json:"archived"`
	CreatedBy   string     `json:"createdBy"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
	CompletedAt *time.Time `json:"completedAt"`

	// Denormalised fields filled in when reading a board snapshot so the
	// frontend can render a card face without extra round-trips.
	LabelIDs     []string `json:"labelIds,omitempty"`
	AssigneeName string   `json:"assigneeName,omitempty"`
	Checklist    struct {
		Total int `json:"total"`
		Done  int `json:"done"`
	} `json:"checklist"`
	CommentCount int `json:"commentCount"`
}

// Label is a coloured tag scoped to one board.
type Label struct {
	ID      string `json:"id"`
	BoardID string `json:"boardId"`
	Name    string `json:"name"`
	Color   string `json:"color"`
}

// ChecklistItem is a subtask of a card.
type ChecklistItem struct {
	ID        string    `json:"id"`
	CardID    string    `json:"cardId"`
	Text      string    `json:"text"`
	Done      bool      `json:"done"`
	Position  int       `json:"position"`
	CreatedAt time.Time `json:"createdAt"`
}

// Comment is a message attached to a card.
type Comment struct {
	ID         string    `json:"id"`
	CardID     string    `json:"cardId"`
	AuthorID   string    `json:"authorId"`
	AuthorName string    `json:"authorName"`
	Body       string    `json:"body"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

// Activity is an audit-trail entry.
type Activity struct {
	ID        string    `json:"id"`
	BoardID   string    `json:"boardId"`
	CardID    *string   `json:"cardId"`
	ActorID   string    `json:"actorId"`
	ActorName string    `json:"actorName"`
	Verb      string    `json:"verb"`
	Summary   string    `json:"summary"`
	CreatedAt time.Time `json:"createdAt"`
}

// Member is a collaborator on a board.
type Member struct {
	UserID      string    `json:"userId"`
	Email       string    `json:"email"`
	Name        string    `json:"name"`
	AvatarColor string    `json:"avatarColor"`
	Role        string    `json:"role"`
	JoinedAt    time.Time `json:"joinedAt"`
}

// BoardSnapshot is the full payload needed to render a board.
type BoardSnapshot struct {
	Board    Board      `json:"board"`
	Columns  []Column   `json:"columns"`
	Cards    []Card     `json:"cards"`
	Labels   []Label    `json:"labels"`
	Members  []Member   `json:"members"`
	Activity []Activity `json:"activity"`
}

// BoardSummary is the list-view projection of a board.
type BoardSummary struct {
	Board
	ColumnCount  int `json:"columnCount"`
	CardCount    int `json:"cardCount"`
	DoneCount    int `json:"doneCount"`
	OverdueCount int `json:"overdueCount"`
}

// CardDetail is the card drawer payload.
type CardDetail struct {
	Card
	Labels    []Label         `json:"labels"`
	Checklist []ChecklistItem `json:"checklist"`
	Comments  []Comment       `json:"comments"`
	Activity  []Activity      `json:"activity"`
	Assignee  *User           `json:"assignee"`
	Board     Board           `json:"board"`
	Column    Column          `json:"column"`
}

// Stats powers the dashboard.
type Stats struct {
	TotalCards     int            `json:"totalCards"`
	CompletedCards int            `json:"completedCards"`
	OverdueCards   int            `json:"overdueCards"`
	DueToday       int            `json:"dueToday"`
	DueThisWeek    int            `json:"dueThisWeek"`
	Unassigned     int            `json:"unassigned"`
	ByPriority     map[string]int `json:"byPriority"`
	ByColumn       []ColumnCount  `json:"byColumn"`
	ByBoard        []BoardCount   `json:"byBoard"`
	CompletedByDay []DayCount     `json:"completedByDay"`
}

// ColumnCount is a card count per column.
type ColumnCount struct {
	ColumnID string `json:"columnId"`
	Title    string `json:"title"`
	Count    int    `json:"count"`
}

// BoardCount is a card count per board.
type BoardCount struct {
	BoardID string `json:"boardId"`
	Title   string `json:"title"`
	Count   int    `json:"count"`
}

// DayCount is a completion count for one day.
type DayCount struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}
