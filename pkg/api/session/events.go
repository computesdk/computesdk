package session

import "time"

type SessionStarted struct {
	SessionID string         `json:"session_id"`
	Config    map[string]any `json:"config"`
	ExpiresAt time.Time      `json:"expires_at"`
	CreatedAt time.Time      `json:"created_at"`
}

func (e SessionStarted) EventType() string {
	return "SessionStarted"
}

type SessionTerminated struct {
	SessionID string `json:"session_id"`
	Reason    string `json:"reason" binding:"max=500"`
}

func (e SessionTerminated) EventType() string {
	return "SessionTerminated"
}

type SessionRenewed struct {
	SessionID    string    `json:"session_id"`
	NewExpiresAt time.Time `json:"new_expires_at"`
	RenewedAt    time.Time `json:"renewed_at"`
}

func (e SessionRenewed) EventType() string {
	return "SessionRenewed"
}
