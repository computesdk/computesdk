// Package session
package session

type CreateSessionRequest struct {
	Config    map[string]any `json:"config"`
	ExpiresIn *int           `json:"expires_in,omitempty"` // seconds, optional
}

type TerminateSessionRequest struct {
	Reason    string `json:"reason" binding:"max=500"`
	SessionID string `json:"id,omitempty"`
}

type RenewSessionRequest struct {
	ExpiresIn *int `json:"expires_in,omitempty"` // seconds, optional - if not provided, use default TTL
}
