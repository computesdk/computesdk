// Package session is domain
package session

import (
	"time"

	"github.com/heysnelling/computesdk/pkg/api/events"
)

type SessionAggregate struct {
	ID           string         `json:"id"`
	Status       string         `json:"status"`
	Config       map[string]any `json:"config"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
	ExpiresAt    *time.Time     `json:"expires_at,omitempty"`
	TerminatedAt *time.Time     `json:"terminated_at,omitempty"`
}

func (s *SessionAggregate) Apply(events []events.Event) error {
	for _, event := range events {
		var data map[string]any
		event.UnmarshalData(&data)

		switch event.Type {
		case "SessionStarted":
			s.ID = data["session_id"].(string)
			s.Config = data["config"].(map[string]interface{})
			s.Status = "active"
			s.CreatedAt = event.Timestamp
			if expiresAt, ok := data["expires_at"].(string); ok {
				if parsedTime, err := time.Parse(time.RFC3339, expiresAt); err == nil {
					s.ExpiresAt = &parsedTime
				}
			}

		case "SessionTerminated":
			s.Status = "terminated"
			terminatedAt := event.Timestamp
			s.TerminatedAt = &terminatedAt

		case "SessionRenewed":
			if newExpiresAt, ok := data["new_expires_at"].(string); ok {
				if parsedTime, err := time.Parse(time.RFC3339, newExpiresAt); err == nil {
					s.ExpiresAt = &parsedTime
				}
			}
		}

		s.UpdatedAt = event.Timestamp
	}
	return nil
}

// ToSummary converts the aggregate to a summary projection
func (s *SessionAggregate) ToSummary() *SessionSummary {
	return &SessionSummary{
		ID:           s.ID,
		Status:       s.Status,
		Config:       s.Config,
		CreatedAt:    s.CreatedAt,
		UpdatedAt:    s.UpdatedAt,
		ExpiresAt:    s.ExpiresAt,
		TerminatedAt: s.TerminatedAt,
	}
}
