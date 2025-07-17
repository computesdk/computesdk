// Package compute
package compute

type CreateComputeRequest struct {
	PresetID string `json:"preset_id,omitempty"` // Optional - will use default if not provided
}

type TerminateComputeRequest struct {
	Reason    string `json:"reason" binding:"max=500"`
	ComputeID string `json:"id,omitempty"`
}
