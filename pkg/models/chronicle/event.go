package chronicle

import (
	"time"
)

// EventRecord is the database model for storing events
type EventRecord struct {
	ID            string `gorm:"primaryKey"`
	AggregateID   string `gorm:"index"`
	AggregateType string `gorm:"index"`
	EventType     string `gorm:"index"`
	Version       int    `gorm:"index"`
	Data          []byte
	CreatedAt     time.Time `gorm:"index"`
}

// TableName specifies the table name for the EventRecord
func (EventRecord) TableName() string {
	return "chronicle_events"
}