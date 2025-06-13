package chronicle

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

// MockRepository is a mock implementation of the Repository interface
type MockRepository struct {
	mock.Mock
}

func (m *MockRepository) Save(ctx context.Context, aggregate Aggregate) error {
	args := m.Called(ctx, aggregate)
	return args.Error(0)
}

func (m *MockRepository) Load(ctx context.Context, aggregateID AggregateID, aggregateType AggregateType) (Chronicle, error) {
	args := m.Called(ctx, aggregateID, aggregateType)
	if obj := args.Get(0); obj != nil {
		return obj.(Chronicle), args.Error(1)
	}
	return nil, args.Error(1)
}

func (m *MockRepository) GetEvents(ctx context.Context, aggregateID AggregateID, aggregateType AggregateType) ([]Event, error) {
	args := m.Called(ctx, aggregateID, aggregateType)
	return args.Get(0).([]Event), args.Error(1)
}

// TestChronicleUsage demonstrates how to use the Chronicle framework with the new Track* API
func TestChronicleUsage(t *testing.T) {
	// Create a mock repository
	repo := new(MockRepository)

	// Set up expectations for Save
	repo.On("Save", mock.Anything, mock.AnythingOfType("*chronicle.GenericChronicle")).Return(nil)

	// Example 1: Basic lifecycle with domain events
	t.Run("Compute Resource Lifecycle", func(t *testing.T) {
		// Create a new compute chronicle
		compute := NewChronicle("compute", repo)

		// Track creation with initial data
		assert.NoError(t, compute.TrackCreate(map[string]any{
			"name":     "test-compute",
			"status":   "provisioning",
			"cpuCores": 4,
			"memoryGB": 16,
		}))
		assert.Equal(t, 1, compute.GetVersion()) // Version incremented
		assert.NoError(t, compute.Save(context.Background()))

		// Track provisioning completed
		assert.NoError(t, compute.TrackChange("ProvisioningCompleted", map[string]any{
			"status":    "running",
			"ipAddress": "10.0.1.5",
			"startTime": "2024-01-15T10:00:00Z",
		}))
		assert.Equal(t, 2, compute.GetVersion())
		assert.NoError(t, compute.Save(context.Background()))

		// Track configuration change
		assert.NoError(t, compute.TrackChange("ConfigurationUpdated", map[string]any{
			"cpuCores": 8,
			"memoryGB": 32,
			"reason":   "scaled up for increased load",
		}))
		assert.NoError(t, compute.Save(context.Background()))

		// Verify the events were applied
		assert.Equal(t, 3, compute.GetVersion())
	})

	// Example 2: Event batching - multiple events before save
	t.Run("Event Batching", func(t *testing.T) {
		// Create a new chronicle
		resource := NewChronicle("resource", repo)

		// Track creation with initial data
		assert.NoError(t, resource.TrackCreate(map[string]any{
			"name":        "shared-storage",
			"storageType": "nfs",
		}))

		// Add multiple changes before saving
		assert.NoError(t, resource.TrackChange("PermissionsUpdated", map[string]any{
			"permissions": map[string]string{
				"user-123": "read-write",
				"user-456": "read-only",
			},
		}))

		assert.NoError(t, resource.TrackChange("QuotaSet", map[string]any{
			"quotaGB": 1000,
			"alertAt": 900,
		}))

		// All events saved in one transaction
		assert.NoError(t, resource.Save(context.Background()))
		assert.Equal(t, 3, resource.GetVersion())
	})

	// Example 3: Deletion with context
	t.Run("Chronicle Deletion", func(t *testing.T) {
		// Create a new chronicle
		tempResource := NewChronicle("temp-resource", repo)

		// Track creation with initial data
		assert.NoError(t, tempResource.TrackCreate(map[string]any{
			"name": "temp-file",
			"path": "/tmp/processing/file123",
		}))
		assert.NoError(t, tempResource.Save(context.Background()))

		// Track some operations
		assert.NoError(t, tempResource.TrackChange("ProcessingCompleted", map[string]any{
			"recordsProcessed": 10000,
			"duration":         "5m30s",
		}))
		assert.NoError(t, tempResource.Save(context.Background()))

		// Track deletion
		assert.NoError(t, tempResource.TrackDelete("cleanup after successful processing"))
		assert.NoError(t, tempResource.Save(context.Background()))

		// Verify it's marked as deleted
		assert.True(t, tempResource.IsDeleted())
		assert.Equal(t, 3, tempResource.GetVersion())

		// Should not be able to delete again
		err := tempResource.TrackDelete("trying to delete again")
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "already deleted")
	})

	// Example 4: Error cases
	t.Run("Error Cases", func(t *testing.T) {
		chronicle := NewChronicle("test", repo)

		// Cannot track changes before creation
		err := chronicle.TrackChange("SomeChange", map[string]any{"foo": "bar"})
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "cannot record changes on unsaved chronicle")

		// Cannot create twice
		assert.NoError(t, chronicle.TrackCreate(map[string]any{"name": "test"}))
		err = chronicle.TrackCreate(map[string]any{"name": "test2"})
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "chronicle already exists")

		// Verify state access works
		var name string
		err = chronicle.State("name", &name)
		assert.NoError(t, err)
		assert.Equal(t, "test", name)
	})

	// Verify our expectations were met
	repo.AssertExpectations(t)
}

// TestStateAll tests the StateAll method
func TestStateAll(t *testing.T) {
	repo := new(MockRepository)
	repo.On("Save", mock.Anything, mock.AnythingOfType("*chronicle.GenericChronicle")).Return(nil)

	// Define a struct for compute state
	type ComputeState struct {
		Name     string `json:"name"`
		Status   string `json:"status"`
		CPUCores int    `json:"cpuCores"`
		MemoryGB int    `json:"memoryGB"`
	}

	// Create and populate a chronicle
	compute := NewChronicle("compute", repo)
	assert.NoError(t, compute.TrackCreate(map[string]any{
		"name":     "web-server-01",
		"status":   "running",
		"cpuCores": 8,
		"memoryGB": 32,
	}))

	// Read all state into struct
	var state ComputeState
	err := compute.StateAll(&state)
	assert.NoError(t, err)

	// Verify all fields
	assert.Equal(t, "web-server-01", state.Name)
	assert.Equal(t, "running", state.Status)
	assert.Equal(t, 8, state.CPUCores)
	assert.Equal(t, 32, state.MemoryGB)
}

// TestChronicleEventApplication tests how events are applied during replay
func TestChronicleEventApplication(t *testing.T) {
	repo := new(MockRepository)

	t.Run("Event Replay", func(t *testing.T) {
		// Create a chronicle and simulate event replay
		chronicle := &GenericChronicle{
			BaseAggregate: NewBaseAggregate("test-123", "resource"),
			repository:    repo,
			properties:    make(map[string]any),
		}

		// Simulate replaying a Created event
		createdEvent := &BaseEvent{
			EventType: "Created",
			Data: mustMarshal(map[string]any{
				"initialData": map[string]any{
					"name":   "test-resource",
					"status": "active",
				},
			}),
		}
		chronicle.Apply(createdEvent, false)

		// Verify initial data was applied
		var name string
		err := chronicle.State("name", &name)
		assert.NoError(t, err)
		assert.Equal(t, "test-resource", name)

		// Simulate replaying a change event
		changeEvent := &BaseEvent{
			EventType: "StatusChanged",
			Data: mustMarshal(map[string]any{
				"status": "inactive",
				"reason": "maintenance",
			}),
		}
		chronicle.Apply(changeEvent, false)

		// Verify change was merged
		var status string
		err = chronicle.State("status", &status)
		assert.NoError(t, err)
		assert.Equal(t, "inactive", status)

		var reason string
		err = chronicle.State("reason", &reason)
		assert.NoError(t, err)
		assert.Equal(t, "maintenance", reason)

		// Simulate deleted event
		deletedEvent := &BaseEvent{
			EventType: "Deleted",
			Data:      mustMarshal(map[string]any{"reason": "no longer needed"}),
		}
		chronicle.Apply(deletedEvent, false)

		// Verify it's marked as deleted
		assert.True(t, chronicle.IsDeleted())
	})
}

// Helper function for tests
func mustMarshal(v any) []byte {
	data, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return data
}

// Example showing real-world usage patterns
func ExampleChronicle() {
	// In real code, you would initialize the repository with a database connection
	// db := // ... your GORM connection
	// eventStore, _ := NewPostgresEventStore(db)
	// repo := NewEventStoreRepository(eventStore)
	// RegisterChronicleType(repo, "compute")

	// Example: Managing a compute instance lifecycle
	/*
		ctx := context.Background()

		// Create new compute instance
		compute := NewChronicle("compute", repo)
		compute.TrackCreate(map[string]any{
			"name":         "web-server-01",
			"region":       "us-east-1",
			"instanceType": "t3.medium",
		})
		compute.Save(ctx)

		computeID := compute.GetID()

		// Later: Track provisioning
		compute, _ = Load(ctx, repo, computeID, "compute")
		compute.TrackChange("ProvisioningStarted", map[string]any{
			"provider": "AWS",
			"ami":      "ami-12345",
		})
		compute.Save(ctx)

		// Track when ready
		compute.TrackChange("InstanceReady", map[string]any{
			"publicIP":  "54.1.2.3",
			"privateIP": "10.0.1.5",
			"status":    "running",
		})
		compute.Save(ctx)

		// Track configuration changes
		compute.TrackChange("SecurityGroupUpdated", map[string]any{
			"addedRules": []string{"allow-https"},
			"removedRules": []string{"allow-telnet"},
		})
		compute.Save(ctx)

		// Eventually delete
		compute.TrackDelete("decommissioned after migration")
		compute.Save(ctx)
	*/
}
