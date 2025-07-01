// Package compute
package compute

type CreateComputeRequest struct {
	Environment string `json:"environment" binding:"required,oneof=production staging development"`
}

type TerminateComputeRequest struct {
	Reason    string `json:"reason" binding:"max=500"`
	ComputeID string `json:"id,omitempty"`
}
