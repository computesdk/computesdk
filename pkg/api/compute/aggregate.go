// Package compute is domain
package compute

import (
	"time"

	"github.com/heysnelling/computesdk/pkg/api/events"
)

type ComputeAggregate struct {
	ID         string     `json:"id"`
	Status     string     `json:"status"`
	IPAddress  string     `json:"ip_address,omitempty"`
	PodName    string     `json:"pod_name,omitempty"`
	PodURL     string     `json:"pod_url,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
	StartedAt  *time.Time `json:"started_at,omitempty"`
	LastActive *time.Time `json:"last_active,omitempty"`
}

func (c *ComputeAggregate) Apply(events []events.Event) error {
	for _, event := range events {
		var data map[string]any
		event.UnmarshalData(&data)

		switch event.Type {
		case "ComputeCreated":
			c.ID = data["compute_id"].(string)
			c.Status = "initializing"
			c.CreatedAt = event.Timestamp

		case "ComputeStarted":
			c.Status = "running"
			c.IPAddress = data["ip_address"].(string)
			c.PodName = data["pod_name"].(string)
			if startedAt, ok := data["started_at"].(string); ok {
				if parsed, err := time.Parse(time.RFC3339, startedAt); err == nil {
					c.StartedAt = &parsed
				}
			}

		case "ComputeTerminated":
			c.Status = "terminated"
		}

		c.UpdatedAt = event.Timestamp
	}

	return nil
}

// ToSummary converts the aggregate to a summary projection
func (c *ComputeAggregate) ToSummary(apiKeyID string) *ComputeSummary {
	return &ComputeSummary{
		ID:         c.ID,
		APIKeyID:   apiKeyID,
		Status:     c.Status,
		IPAddress:  c.IPAddress,
		PodName:    c.PodName,
		PodURL:     c.PodURL,
		CreatedAt:  c.CreatedAt,
		UpdatedAt:  c.UpdatedAt,
		StartedAt:  c.StartedAt,
		LastActive: c.LastActive,
	}
}
