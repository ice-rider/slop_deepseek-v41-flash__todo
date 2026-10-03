package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

// contextWithTimeout derives a bounded context from a request.
func contextWithTimeout(r *http.Request, d time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(r.Context(), d)
}

// mustJSON serialises a value for an SSE data frame, degrading to a resync
// instruction if the payload somehow cannot be encoded.
func mustJSON(value any) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		return `{"type":"resync"}`
	}
	return string(encoded)
}
