package compute

import "time"

type ComputeCreated struct {
	ComputeID   string    `json:"compute_id"`
	Environment string    `json:"environment"`
	CreatedAt   time.Time `json:"created_at"`
}

func (e ComputeCreated) EventType() string {
	return "ComputeCreated"
}

type ComputeTerminated struct {
	Reason    string `json:"reason" binding:"max=500"`
	ComputeID string `json:"id,omitempty"`
}

func (e ComputeTerminated) EventType() string {
	return "ComputeTerminated"
}
