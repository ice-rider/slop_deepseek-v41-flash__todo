// Package realtime implements a small in-process publish/subscribe hub used to
// stream board changes to browsers over Server-Sent Events.
//
// The hub is intentionally unaware of authorization: callers subscribe to a
// single board (or to the global stream) only after the API layer has verified
// the caller's access to that board.
package realtime

import (
	"sync"
	"time"
)

// Event is a single change notification.
type Event struct {
	Type      string         `json:"type"`
	BoardID   string         `json:"boardId,omitempty"`
	CardID    string         `json:"cardId,omitempty"`
	ActorID   string         `json:"actorId,omitempty"`
	ActorName string         `json:"actorName,omitempty"`
	Summary   string         `json:"summary,omitempty"`
	Data      map[string]any `json:"data,omitempty"`
	At        time.Time      `json:"at"`
}

// Event type constants shared with the frontend contract.
const (
	TypeBoardCreated     = "board.created"
	TypeBoardUpdated     = "board.updated"
	TypeBoardDeleted     = "board.deleted"
	TypeBoardReordered   = "board.reordered"
	TypeColumnCreated    = "column.created"
	TypeColumnUpdated    = "column.updated"
	TypeColumnDeleted    = "column.deleted"
	TypeCardCreated      = "card.created"
	TypeCardUpdated      = "card.updated"
	TypeCardMoved        = "card.moved"
	TypeCardDeleted      = "card.deleted"
	TypeCommentAdded     = "comment.added"
	TypeChecklistChanged = "checklist.changed"
	TypeLabelChanged     = "label.changed"
	TypeMemberChanged    = "member.changed"
	// TypeResync tells a client it fell behind and should refetch.
	TypeResync = "resync"
)

const subscriberBuffer = 32

// Subscription is one consumer's view of the stream.
type Subscription struct {
	C       <-chan Event
	events  chan Event
	boardID string
	userID  string
	hub     *Hub
	once    sync.Once
}

// Close detaches the subscription. It is safe to call more than once.
func (s *Subscription) Close() {
	s.once.Do(func() {
		s.hub.remove(s)
	})
}

// BoardID reports which board this subscription follows ("" means all boards).
func (s *Subscription) BoardID() string { return s.boardID }

// UserID reports which user opened the subscription.
func (s *Subscription) UserID() string { return s.userID }

// Hub fans events out to subscribers.
type Hub struct {
	mu      sync.RWMutex
	byBoard map[string]map[*Subscription]struct{}
	global  map[*Subscription]struct{}
	closed  bool
}

// NewHub creates an empty hub.
func NewHub() *Hub {
	return &Hub{
		byBoard: map[string]map[*Subscription]struct{}{},
		global:  map[*Subscription]struct{}{},
	}
}

// Subscribe registers a consumer. An empty boardID subscribes to every event.
func (h *Hub) Subscribe(userID, boardID string) *Subscription {
	events := make(chan Event, subscriberBuffer)
	sub := &Subscription{
		C:       events,
		events:  events,
		boardID: boardID,
		userID:  userID,
		hub:     h,
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		close(sub.events)
		return sub
	}
	if boardID == "" {
		h.global[sub] = struct{}{}
		return sub
	}
	set, ok := h.byBoard[boardID]
	if !ok {
		set = map[*Subscription]struct{}{}
		h.byBoard[boardID] = set
	}
	set[sub] = struct{}{}
	return sub
}

func (h *Hub) remove(sub *Subscription) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.global, sub)
	if set, ok := h.byBoard[sub.boardID]; ok {
		delete(set, sub)
		if len(set) == 0 {
			delete(h.byBoard, sub.boardID)
		}
	}
}

// Publish delivers an event to every interested subscriber. Delivery never
// blocks: a subscriber whose buffer is full is sent a resync notice instead,
// which tells the browser to refetch authoritative state.
func (h *Hub) Publish(event Event) {
	if event.At.IsZero() {
		event.At = time.Now().UTC()
	}
	h.mu.RLock()
	targets := make([]*Subscription, 0, len(h.global)+8)
	for sub := range h.global {
		targets = append(targets, sub)
	}
	for sub := range h.byBoard[event.BoardID] {
		targets = append(targets, sub)
	}
	h.mu.RUnlock()

	for _, sub := range targets {
		select {
		case sub.events <- event:
		default:
			// Buffer exhausted: collapse to a single resync hint.
			select {
			case <-sub.events:
			default:
			}
			select {
			case sub.events <- Event{Type: TypeResync, BoardID: event.BoardID, At: event.At}:
			default:
			}
		}
	}
}

// Counts reports active subscribers, useful for diagnostics.
func (h *Hub) Counts() (boards int, subscribers int) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, set := range h.byBoard {
		boards++
		subscribers += len(set)
	}
	subscribers += len(h.global)
	return boards, subscribers
}

// Close terminates every subscription.
func (h *Hub) Close() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return
	}
	h.closed = true
	for sub := range h.global {
		close(sub.events)
	}
	h.global = map[*Subscription]struct{}{}
	for boardID, set := range h.byBoard {
		for sub := range set {
			close(sub.events)
		}
		delete(h.byBoard, boardID)
	}
}
