package projections

import (
	"time"
)

// FileSystem represents a filesystem resource projection
type FileSystem struct {
	ID        string    `json:"id" gorm:"primaryKey;type:varchar(255)"`
	Name      string    `json:"name" gorm:"type:varchar(255)"`
	Files     any       `json:"files" gorm:"type:jsonb"`
	Size      int64     `json:"size" gorm:"not null"` // Size in bytes
	CreatedAt time.Time `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt time.Time `json:"updated_at" gorm:"autoUpdateTime"`
}
