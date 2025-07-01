// Package compute is domain
package compute

import (
	"time"

	"github.com/heysnelling/computesdk/pkg/api/events"
)

type Compute struct {
	ID          string     `json:"id"`
	Status      string     `json:"status"`
	Environment string     `json:"environment"`
	IPAddress   string     `json:"ip_address,omitempty"`
	PodName     string     `json:"pod_name,omitempty"`
	PodURL      string     `json:"pod_url,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
	StartedAt   *time.Time `json:"started_at,omitempty"`
	LastActive  *time.Time `json:"last_active,omitempty"`
}

func (c *Compute) Apply(events []events.Event) error {
	for _, event := range events {
		var data map[string]any
		event.UnmarshalData(&data)

		switch event.Type {
		case "ComputeCreated":
			c.ID = data["compute_id"].(string)
			c.Environment = data["environment"].(string)
			c.Status = "initializing"
			c.CreatedAt = event.Timestamp

		case "ComputeStarted":
			c.Status = "running"
			c.IPAddress = data["ip_address"].(string)
		}

		c.UpdatedAt = event.Timestamp
	}

	return nil
}
