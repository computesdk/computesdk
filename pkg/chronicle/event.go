package chronicle

import (
	"time"
)

// Event defines the interface for all domain events
type Event interface {
	// GetAggregateID returns the ID of the aggregate this event belongs to
	GetAggregateID() AggregateID

	// GetAggregateType returns the type of the aggregate this event belongs to
	GetAggregateType() AggregateType

	// GetEventType returns the type of this event
	GetEventType() string

	// GetVersion returns the version of the aggregate after this event is applied
	GetVersion() int

	// GetData returns the event data as bytes
	GetData() []byte

	// GetCreatedAt returns when this event was created
	GetCreatedAt() time.Time
}

// BaseEvent provides a common implementation for all events
type BaseEvent struct {
	AggregateID   AggregateID
	AggregateType AggregateType
	EventType     string
	Version       int
	Data          []byte
	CreatedAt     time.Time
}

// NewEvent creates a new event
func NewEvent(aggregateID AggregateID, aggregateType AggregateType, eventType string, version int, data []byte) *BaseEvent {
	return &BaseEvent{
		AggregateID:   aggregateID,
		AggregateType: aggregateType,
		EventType:     eventType,
		Version:       version,
		Data:          data,
		CreatedAt:     time.Now(),
	}
}

// GetAggregateID returns the ID of the aggregate this event belongs to
func (e *BaseEvent) GetAggregateID() AggregateID {
	return e.AggregateID
}

// GetAggregateType returns the type of the aggregate this event belongs to
func (e *BaseEvent) GetAggregateType() AggregateType {
	return e.AggregateType
}

// GetEventType returns the type of this event
func (e *BaseEvent) GetEventType() string {
	return e.EventType
}

// GetVersion returns the version of the aggregate after this event is applied
func (e *BaseEvent) GetVersion() int {
	return e.Version
}

// GetData returns the event data as bytes
func (e *BaseEvent) GetData() []byte {
	return e.Data
}

// GetCreatedAt returns when this event was created
func (e *BaseEvent) GetCreatedAt() time.Time {
	return e.CreatedAt
}
