package compute

import "time"

type ComputeCreated struct {
	ComputeID string    `json:"compute_id"`
	CreatedAt time.Time `json:"created_at"`
}

func (e ComputeCreated) EventType() string {
	return "ComputeCreated"
}

type ComputeStarted struct {
	ComputeID string    `json:"compute_id"`
	IPAddress string    `json:"ip_address"`
	PodName   string    `json:"pod_name"`
	StartedAt time.Time `json:"started_at"`
}

func (e ComputeStarted) EventType() string {
	return "ComputeStarted"
}

type ComputeTerminated struct {
	Reason    string `json:"reason" binding:"max=500"`
	ComputeID string `json:"id,omitempty"`
}

func (e ComputeTerminated) EventType() string {
	return "ComputeTerminated"
}
