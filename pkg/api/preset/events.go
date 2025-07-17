// Package preset
package preset

import "time"

// PresetCreated event is emitted when a new preset is created
type PresetCreated struct {
	PresetID    string         `json:"preset_id"`
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Config      map[string]any `json:"config"`
	CreatedBy   string         `json:"created_by"`
	CreatedAt   time.Time      `json:"created_at"`
	IsPublic    bool           `json:"is_public"`
}

// EventType returns the type of this event
func (e PresetCreated) EventType() string {
	return "PresetCreated"
}

// PresetDeleted event is emitted when a preset is deleted
type PresetDeleted struct {
	PresetID  string    `json:"preset_id"`
	Reason    string    `json:"reason,omitempty" binding:"max=500"`
	DeletedBy string    `json:"deleted_by"`
	DeletedAt time.Time `json:"deleted_at"`
}

// EventType returns the type of this event
func (e PresetDeleted) EventType() string {
	return "PresetDeleted"
}
