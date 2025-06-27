package chronicle

import (
	"context"
	"errors"
)

// Repository defines the interface for event storage and aggregate loading
type Repository interface {
	// Save persists all uncommitted events for an aggregate
	Save(ctx context.Context, aggregate Aggregate) error

	// Load rebuilds an aggregate from its event history and returns a Chronicle
	Load(ctx context.Context, aggregateID AggregateID, aggregateType AggregateType) (Chronicle, error)

	// GetEvents retrieves all events for an aggregate
	GetEvents(ctx context.Context, aggregateID AggregateID, aggregateType AggregateType) ([]Event, error)
}

// AggregateFactory is a function type for creating new aggregate instances
type AggregateFactory func(aggregateID AggregateID, aggregateType AggregateType) Aggregate

// ErrAggregateNotFound is returned when an aggregate cannot be found
var ErrAggregateNotFound = errors.New("aggregate not found")

// ErrConcurrencyConflict is returned when there's a version conflict during save
var ErrConcurrencyConflict = errors.New("concurrency conflict: aggregate has been modified")

// EventStoreRepository implements the Repository interface using an EventStore
type EventStoreRepository struct {
	eventStore EventStore
	factories  map[AggregateType]AggregateFactory
}

// NewEventStoreRepository creates a new EventStoreRepository
func NewEventStoreRepository(eventStore EventStore) *EventStoreRepository {
	return &EventStoreRepository{
		eventStore: eventStore,
		factories:  make(map[AggregateType]AggregateFactory),
	}
}

// RegisterAggregate registers a factory function for a specific aggregate type
func (r *EventStoreRepository) RegisterAggregate(aggregateType AggregateType, factory AggregateFactory) {
	r.factories[aggregateType] = factory
}

// Save persists all uncommitted events for an aggregate
func (r *EventStoreRepository) Save(ctx context.Context, aggregate Aggregate) error {
	// Get uncommitted events
	events := aggregate.GetUncommittedEvents()
	if len(events) == 0 {
		return nil
	}

	// Save to event store
	err := r.eventStore.SaveEvents(ctx, events)
	if err != nil {
		return err
	}

	// Clear uncommitted events from the aggregate
	aggregate.ClearUncommittedEvents()

	return nil
}

// Load rebuilds an aggregate from its event history and returns a Chronicle
func (r *EventStoreRepository) Load(ctx context.Context, aggregateID AggregateID, aggregateType AggregateType) (Chronicle, error) {
	// Find the factory for this aggregate type
	factory, ok := r.factories[aggregateType]
	if !ok {
		return nil, errors.New("no factory registered for aggregate type: " + string(aggregateType))
	}

	// Create a new aggregate instance
	aggregate := factory(aggregateID, aggregateType)

	// Get all events for this aggregate
	events, err := r.GetEvents(ctx, aggregateID, aggregateType)
	if err != nil {
		return nil, err
	}

	// If no events found, aggregate doesn't exist
	if len(events) == 0 {
		return nil, ErrAggregateNotFound
	}

	// Apply all events to rebuild the aggregate state
	for _, event := range events {
		aggregate.Apply(event, false)
	}

	// Cast to Chronicle interface
	chronicle, ok := aggregate.(Chronicle)
	if !ok {
		return nil, errors.New("factory did not produce a Chronicle-compatible aggregate")
	}

	return chronicle, nil
}

// GetEvents retrieves all events for an aggregate
func (r *EventStoreRepository) GetEvents(ctx context.Context, aggregateID AggregateID, aggregateType AggregateType) ([]Event, error) {
	return r.eventStore.GetEvents(ctx, aggregateID, aggregateType)
}
