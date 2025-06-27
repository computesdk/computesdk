package chronicle

import (
	"time"
)

// AggregateID represents the unique identifier for an aggregate
type AggregateID string

// AggregateType represents the type of an aggregate
type AggregateType string

// Aggregate defines the interface for all event-sourced aggregates
type Aggregate interface {
	// GetID returns the unique identifier of the aggregate
	GetID() AggregateID

	// GetType returns the type of the aggregate
	GetType() AggregateType

	// GetVersion returns the current version of the aggregate
	GetVersion() int

	// GetUncommittedEvents returns events that haven't been persisted yet
	GetUncommittedEvents() []Event

	// ClearUncommittedEvents clears the list of uncommitted events
	ClearUncommittedEvents()

	// Apply applies an event to the aggregate
	Apply(event Event, isNew bool)
}

// BaseAggregate provides a common implementation for all aggregates
type BaseAggregate struct {
	ID                AggregateID
	Type              AggregateType
	Version           int
	uncommittedEvents []Event
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

// NewBaseAggregate creates a new aggregate with the given ID and type
func NewBaseAggregate(id AggregateID, aggType AggregateType) *BaseAggregate {
	return &BaseAggregate{
		ID:                id,
		Type:              aggType,
		Version:           0,
		uncommittedEvents: make([]Event, 0),
		CreatedAt:         time.Now(),
		UpdatedAt:         time.Now(),
	}
}

// GetID returns the unique identifier of the aggregate
func (a *BaseAggregate) GetID() AggregateID {
	return a.ID
}

// GetType returns the type of the aggregate
func (a *BaseAggregate) GetType() AggregateType {
	return a.Type
}

// GetVersion returns the current version of the aggregate
func (a *BaseAggregate) GetVersion() int {
	return a.Version
}

// GetUncommittedEvents returns events that haven't been persisted yet
func (a *BaseAggregate) GetUncommittedEvents() []Event {
	return a.uncommittedEvents
}

// ClearUncommittedEvents clears the list of uncommitted events
func (a *BaseAggregate) ClearUncommittedEvents() {
	a.uncommittedEvents = make([]Event, 0)
}

// AddEvent adds a new event to the aggregate's list of uncommitted events and updates aggregate state
func (a *BaseAggregate) AddEvent(eventType string, data []byte) Event {
	// Increment version
	a.Version++

	// Create the event
	event := NewEvent(a.ID, a.Type, eventType, a.Version, data)

	// Add to uncommitted events
	a.uncommittedEvents = append(a.uncommittedEvents, event)

	// Update aggregate timestamp
	a.UpdatedAt = time.Now()

	return event
}

// Apply applies an event to the aggregate
// This base implementation only updates version for historical events
// Concrete aggregates should override this method to update their state
func (a *BaseAggregate) Apply(event Event, isNew bool) {
	// If it's a historical event (not new), update the version
	if !isNew && event.GetVersion() > a.Version {
		a.Version = event.GetVersion()
	}
}
