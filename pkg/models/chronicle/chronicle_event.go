package chronicle

import (
	"time"

	"github.com/heysnelling/computesdk/pkg/database"
	"gorm.io/gorm"
)

// EventRecord is the database model for storing events
type ChronicleEvent struct {
	ID            string `gorm:"primaryKey"`
	AggregateID   string `gorm:"index"`
	AggregateType string `gorm:"index"`
	EventType     string `gorm:"index"`
	Version       int    `gorm:"index"`
	Data          []byte
	CreatedAt     time.Time `gorm:"index"`
}

func init() {
	database.RegisterMigrations(func(db *gorm.DB) error {
		return database.AutoMigrateModels(db, &ChronicleEvent{})
	})
}
