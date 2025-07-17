// Package preset is domain
package preset

import (
	"time"

	"github.com/heysnelling/computesdk/pkg/api/events"
)

type PresetAggregate struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Config      map[string]any `json:"config"`
	CreatedBy   string         `json:"created_by"`
	IsPublic    bool           `json:"is_public"`
	Status      string         `json:"status"` // "active" or "deleted"
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   *time.Time     `json:"deleted_at,omitempty"`
}

func (p *PresetAggregate) Apply(events []events.Event) error {
	for _, event := range events {
		var data map[string]any
		event.UnmarshalData(&data)

		switch event.Type {
		case "PresetCreated":
			p.ID = data["preset_id"].(string)
			p.Name = data["name"].(string)
			p.Description = data["description"].(string)
			p.Config = data["config"].(map[string]any)
			p.CreatedBy = data["created_by"].(string)
			p.IsPublic = data["is_public"].(bool)
			p.Status = "active"
			p.CreatedAt = event.Timestamp

		case "PresetDeleted":
			p.Status = "deleted"
			deletedAt := event.Timestamp
			p.DeletedAt = &deletedAt
		}

		p.UpdatedAt = event.Timestamp
	}

	return nil
}

// ToSummary converts the aggregate to a summary projection
func (p *PresetAggregate) ToSummary() *PresetSummary {
	return &PresetSummary{
		ID:          p.ID,
		Name:        p.Name,
		Description: p.Description,
		Config:      p.Config,
		CreatedBy:   p.CreatedBy,
		IsPublic:    p.IsPublic,
		Status:      p.Status,
		CreatedAt:   p.CreatedAt,
		UpdatedAt:   p.UpdatedAt,
		DeletedAt:   p.DeletedAt,
	}
}
