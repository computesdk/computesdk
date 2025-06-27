package chronicle

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

// TestBaseAggregate tests the functionality of the BaseAggregate
func TestBaseAggregate(t *testing.T) {
	// Create a new aggregate
	agg := NewBaseAggregate("test-id", "TestAggregate")

	// Verify initial state
	assert.Equal(t, AggregateID("test-id"), agg.GetID())
	assert.Equal(t, AggregateType("TestAggregate"), agg.GetType())
	assert.Equal(t, 0, agg.GetVersion())
	assert.Empty(t, agg.GetUncommittedEvents())
	assert.False(t, agg.CreatedAt.IsZero())
	assert.False(t, agg.UpdatedAt.IsZero())

	// Test adding an event
	event := agg.AddEvent("TestEvent", []byte(`{"test":"data"}`))

	// Verify the event was created correctly
	assert.Equal(t, AggregateID("test-id"), event.GetAggregateID())
	assert.Equal(t, AggregateType("TestAggregate"), event.GetAggregateType())
	assert.Equal(t, "TestEvent", event.GetEventType())
	assert.Equal(t, 1, event.GetVersion())
	assert.Equal(t, []byte(`{"test":"data"}`), event.GetData())
	assert.False(t, event.GetCreatedAt().IsZero())

	// Verify the aggregate state was updated
	assert.Equal(t, 1, agg.GetVersion())
	assert.Len(t, agg.GetUncommittedEvents(), 1)
	assert.False(t, agg.UpdatedAt.IsZero())

	// Test clearing events
	agg.ClearUncommittedEvents()
	assert.Empty(t, agg.GetUncommittedEvents())
	assert.Equal(t, 1, agg.GetVersion(), "Version should remain unchanged after clearing events")

	// Test applying an existing event (rehydration case)
	historicalEvent := &BaseEvent{
		AggregateID:   "test-id",
		AggregateType: "TestAggregate",
		EventType:     "HistoricalEvent",
		Version:       2,
		Data:          []byte(`{"historical":"data"}`),
		CreatedAt:     time.Now().Add(-1 * time.Hour), // Event from the past
	}

	agg.Apply(historicalEvent, false) // false = not a new event

	// Verify aggregate state after applying historical event
	assert.Equal(t, 2, agg.GetVersion(), "Version should be updated to match the historical event")
	assert.Empty(t, agg.GetUncommittedEvents(), "Historical events shouldn't be added to uncommitted events")
}
