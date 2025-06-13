package projections

import (
	"time"
)

// Group represents a user group projection
type Group struct {
	ID          string    `json:"id" gorm:"primaryKey;type:varchar(255)"`
	Name        string    `json:"name" gorm:"type:varchar(255);"`
	Description string    `json:"description" gorm:"type:text"`
	CreatedAt   time.Time `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt   time.Time `json:"updated_at" gorm:"autoUpdateTime"`
}
