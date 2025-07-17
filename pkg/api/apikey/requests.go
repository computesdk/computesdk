package apikey

type CreateAPIKeyRequest struct {
	Name        string            `json:"name,omitempty"`
	Permissions []string          `json:"permissions,omitempty"`
	Metadata    map[string]string `json:"metadata,omitempty"`
	ExpiresIn   *int64            `json:"expires_in,omitempty"` // seconds from now
}

type RevokeAPIKeyRequest struct {
	Reason string `json:"reason" binding:"max=500"`
}
