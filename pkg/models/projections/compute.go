package projections

import (
	"time"
)

// Compute represents a compute unit instance projection
type Compute struct {
	ID          string     `json:"id" gorm:"primaryKey;type:varchar(255)"`
	Status      string     `json:"status" gorm:"type:varchar(50);not null"`      // initializing, provisioning, running, terminated
	Environment string     `json:"environment" gorm:"type:varchar(50);not null"` // production, staging, development
	IPAddress   string     `json:"ip_address,omitempty" gorm:"type:varchar(255)"`
	PodName     string     `json:"pod_name,omitempty" gorm:"type:varchar(255)"`
	PodURL      string     `json:"pod_url,omitempty" gorm:"type:varchar(255)"`
	CreatedAt   time.Time  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt   time.Time  `json:"updated_at" gorm:"autoUpdateTime"`
	StartedAt   *time.Time `json:"started_at,omitempty" gorm:"type:timestamp"`
	LastActive  *time.Time `json:"last_active,omitempty" gorm:"type:timestamp"`
}
