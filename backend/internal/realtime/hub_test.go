package realtime

import (
	"testing"
	"time"
)

func TestPublishRoutesByBoard(t *testing.T) {
	hub := NewHub()
	boardSub := hub.Subscribe("user-1", "board-a")
	globalSub := hub.Subscribe("user-1", "")
	defer boardSub.Close()
	defer globalSub.Close()

	hub.Publish(Event{Type: TypeCardCreated, BoardID: "board-a"})
	hub.Publish(Event{Type: TypeCardCreated, BoardID: "board-b"})

	// The board subscriber sees only its own board's event.
	select {
	case ev := <-boardSub.C:
		if ev.BoardID != "board-a" {
			t.Fatalf("board subscriber received %q", ev.BoardID)
		}
	case <-time.After(time.Second):
		t.Fatal("board subscriber received nothing")
	}

	// The global subscriber sees both events.
	seen := 0
	deadline := time.After(time.Second)
	for seen < 2 {
		select {
		case <-globalSub.C:
			seen++
		case <-deadline:
			t.Fatalf("global subscriber only saw %d of 2 events", seen)
		}
	}

	select {
	case ev := <-boardSub.C:
		t.Fatalf("board subscriber leaked event from %q", ev.BoardID)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestCloseStopsDelivery(t *testing.T) {
	hub := NewHub()
	sub := hub.Subscribe("user-1", "board-a")
	sub.Close()
	sub.Close() // must be idempotent

	hub.Publish(Event{Type: TypeCardUpdated, BoardID: "board-a"})
	boards, subscribers := hub.Counts()
	if boards != 0 || subscribers != 0 {
		t.Fatalf("expected empty hub, got boards=%d subscribers=%d", boards, subscribers)
	}
}

func TestSlowSubscriberCollapsesToResync(t *testing.T) {
	hub := NewHub()
	sub := hub.Subscribe("user-1", "board-a")
	defer sub.Close()

	// Fill the buffer plus one so the overflow path is exercised.
	for i := 0; i < subscriberBuffer+3; i++ {
		hub.Publish(Event{Type: TypeCardUpdated, BoardID: "board-a"})
	}

	sawResync := false
	for len(sub.C) > 0 {
		ev := <-sub.C
		if ev.Type == TypeResync {
			sawResync = true
		}
	}
	if !sawResync {
		t.Fatal("expected a resync event for the lagging subscriber")
	}
}

func TestHubCloseTerminatesSubscribers(t *testing.T) {
	hub := NewHub()
	sub := hub.Subscribe("user-1", "board-a")
	hub.Close()
	select {
	case _, open := <-sub.C:
		if open {
			t.Fatal("expected the subscription channel to be closed")
		}
	case <-time.After(time.Second):
		t.Fatal("subscription channel was not closed")
	}
}
