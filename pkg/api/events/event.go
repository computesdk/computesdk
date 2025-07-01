// Package events is a package for the event source system
package events

import (
	"encoding/json"
	"time"

	"gorm.io/gorm"
)

type Event struct {
	ID          uint           `json:"id" gorm:"primaryKey"`
	EventID     string         `json:"event_id" gorm:"uniqueIndex;type:varchar(255)"`
	AggregateID string         `json:"stream_id" gorm:"index;type:varchar(255)"` // e.g., compute ID
	Type        string         `json:"type" gorm:"type:varchar(100);not null"`   // e.g., "ComputeCreated"
	Data        string         `json:"data" gorm:"type:text"`                    // JSON string
	Timestamp   time.Time      `json:"timestamp" gorm:"not null"`
	CreatedAt   time.Time      `json:"created_at" gorm:"autoCreateTime"`
	DeletedAt   gorm.DeletedAt `gorm:"index"`
}

func (Event) TableName() string {
	return "events"
}

func (e *Event) UnmarshalData(v any) error {
	return json.Unmarshal([]byte(e.Data), v)
}

func (e *Event) GetDataAsMap() (map[string]any, error) {
	var data map[string]any
	err := json.Unmarshal([]byte(e.Data), &data)
	return data, err
}
