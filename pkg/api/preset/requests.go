// Package preset
package preset

type CreatePresetRequest struct {
	Name        string         `json:"name" binding:"required,min=1,max=100"`
	Description string         `json:"description" binding:"max=500"`
	Config      map[string]any `json:"config" binding:"required"`
	IsPublic    bool           `json:"is_public"`
}

type DeletePresetRequest struct {
	Reason   string `json:"reason" binding:"max=500"`
	PresetID string `json:"preset_id,omitempty"`
}
