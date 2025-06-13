package projections

import (
	"time"
)

// Secret represents a secure key-value storage projection
type Secret struct {
	ID        string    `json:"id" gorm:"primaryKey;type:varchar(255)"`
	Key       string    `json:"key" gorm:"type:varchar(100);not null;uniqueIndex"`
	Value     string    `json:"-" gorm:"type:text;not null"` // Encrypted value, never exposed in JSON
	Metadata  any       `json:"metadata" gorm:"type:jsonb"`   // Type, tags, expiry, description, etc.
	CreatedAt time.Time `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt time.Time `json:"updated_at" gorm:"autoUpdateTime"`
}
