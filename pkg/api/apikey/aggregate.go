package apikey

import (
	"time"

	"github.com/heysnelling/computesdk/pkg/api/events"
)

type APIKeyAggregate struct {
	ID          string
	Name        string
	KeyHash     string
	KeyPrefix   string
	Permissions []string
	Metadata    map[string]string
	Status      string
	CreatedAt   time.Time
	LastUsedAt  *time.Time
	RevokedAt   *time.Time
}

func (a *APIKeyAggregate) Apply(events []events.Event) error {
	for _, event := range events {
		var data map[string]any
		event.UnmarshalData(&data)

		switch event.Type {
		case "APIKeyCreated":
			a.ID = data["api_key_id"].(string)
			a.Name = data["name"].(string)
			a.KeyHash = data["key_hash"].(string)
			a.KeyPrefix = data["key_prefix"].(string)
			if permissions, ok := data["permissions"].([]interface{}); ok {
				a.Permissions = make([]string, len(permissions))
				for i, p := range permissions {
					a.Permissions[i] = p.(string)
				}
			}
			if metadata, ok := data["metadata"].(map[string]interface{}); ok {
				a.Metadata = make(map[string]string)
				for k, v := range metadata {
					a.Metadata[k] = v.(string)
				}
			}
			a.Status = "active"
			a.CreatedAt = event.Timestamp

		case "APIKeyRevoked":
			a.Status = "revoked"
			a.RevokedAt = &event.Timestamp

		case "APIKeyUsed":
			a.LastUsedAt = &event.Timestamp
		}
	}
	return nil
}

func (a *APIKeyAggregate) ToSummary() *APIKeySummary {
	return &APIKeySummary{
		ID:          a.ID,
		Name:        a.Name,
		KeyHash:     a.KeyHash,
		KeyPrefix:   a.KeyPrefix,
		Permissions: a.Permissions,
		Metadata:    a.Metadata,
		Status:      a.Status,
		CreatedAt:   a.CreatedAt,
		LastUsedAt:  a.LastUsedAt,
		RevokedAt:   a.RevokedAt,
	}
}
