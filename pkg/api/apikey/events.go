package apikey

import "time"

type APIKeyCreated struct {
	APIKeyID    string            `json:"api_key_id"`
	Name        string            `json:"name"`
	KeyHash     string            `json:"key_hash"`
	KeyPrefix   string            `json:"key_prefix"`
	Permissions []string          `json:"permissions"`
	Metadata    map[string]string `json:"metadata"`
	CreatedAt   time.Time         `json:"created_at"`
}

func (e APIKeyCreated) EventType() string {
	return "APIKeyCreated"
}

type APIKeyRevoked struct {
	APIKeyID  string    `json:"api_key_id"`
	Reason    string    `json:"reason"`
	RevokedAt time.Time `json:"revoked_at"`
}

func (e APIKeyRevoked) EventType() string {
	return "APIKeyRevoked"
}

type APIKeyUsed struct {
	APIKeyID string    `json:"api_key_id"`
	UsedAt   time.Time `json:"used_at"`
}

func (e APIKeyUsed) EventType() string {
	return "APIKeyUsed"
}
