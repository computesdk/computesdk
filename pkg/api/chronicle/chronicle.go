package chronicle

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"reflect"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Chronicle is the main interface for working with any event-sourced entity
type Chronicle interface {
	// Core aggregate methods
	GetID() AggregateID
	GetType() AggregateType
	GetVersion() int

	// State access (read-only)
	State(key string, target any) error
	StateAll(target any) error

	// Event tracking (write-only)
	TrackCreate(initialData map[string]any) error
	TrackChange(eventType string, eventData map[string]any) error
	TrackDelete(reason string) error

	// Persistence
	Save(ctx context.Context) error
	Reload(ctx context.Context) error

	// Metadata
	CreatedAt() time.Time
	UpdatedAt() time.Time
	IsDeleted() bool
}

// GenericChronicle is the default implementation of the Chronicle interface
type GenericChronicle struct {
	*BaseAggregate
	repository Repository
	properties map[string]any
}

// NewChronicle creates a new Chronicle instance of the specified type
func NewChronicle(chronicleType string, repository Repository) Chronicle {
	id := AggregateID(uuid.New().String())
	aggType := AggregateType(chronicleType)

	return &GenericChronicle{
		BaseAggregate: NewBaseAggregate(id, aggType),
		repository:    repository,
		properties:    make(map[string]any),
	}
}

// State retrieves a single value from the chronicle's current state
func (c *GenericChronicle) State(key string, target any) error {
	val, exists := c.properties[key]
	if !exists {
		return fmt.Errorf("key '%s' not found in state", key)
	}

	return setState(val, target)
}

// StateAll populates a struct with all chronicle state
func (c *GenericChronicle) StateAll(target any) error {
	// Marshal properties to JSON then unmarshal to target
	// This handles type conversions nicely
	data, err := json.Marshal(c.properties)
	if err != nil {
		return fmt.Errorf("failed to marshal state: %w", err)
	}

	if err := json.Unmarshal(data, target); err != nil {
		return fmt.Errorf("failed to unmarshal state: %w", err)
	}

	return nil
}

// GetType returns the type of this chronicle
func (c *GenericChronicle) GetType() AggregateType {
	return c.Type
}

// CreatedAt returns when this chronicle was created
func (c *GenericChronicle) CreatedAt() time.Time {
	return c.BaseAggregate.CreatedAt
}

// UpdatedAt returns when this chronicle was last updated
func (c *GenericChronicle) UpdatedAt() time.Time {
	return c.BaseAggregate.UpdatedAt
}

// Save persists all uncommitted events to the repository
func (c *GenericChronicle) Save(ctx context.Context) error {
	return c.repository.Save(ctx, c)
}

// TrackCreate initializes a new chronicle with a creation event
func (c *GenericChronicle) TrackCreate(initialData map[string]any) error {
	if c.Version != 0 {
		return errors.New("chronicle already exists")
	}

	// Build creation event data
	eventData := map[string]any{
		"initialData": initialData,
	}

	// Marshal event data
	data, err := json.Marshal(eventData)
	if err != nil {
		return err
	}

	// Create the event
	event := c.AddEvent("Created", data)

	// Apply the event to update state immediately
	c.Apply(event, true)

	// Event will be persisted when Save() is called
	return nil
}

// TrackChange adds a domain-specific event to the chronicle
func (c *GenericChronicle) TrackChange(eventType string, eventData map[string]any) error {
	if c.Version == 0 {
		return errors.New("cannot record changes on unsaved chronicle")
	}

	// Marshal event data
	data, err := json.Marshal(eventData)
	if err != nil {
		return err
	}

	// Add the domain event
	event := c.AddEvent(eventType, data)

	// Apply the event to update state immediately
	c.Apply(event, true)

	// Event will be persisted when Save() is called
	return nil
}

// TrackDelete marks the chronicle as deleted with context
func (c *GenericChronicle) TrackDelete(reason string) error {
	if c.IsDeleted() {
		return errors.New("chronicle is already deleted")
	}

	// Build deletion event data
	eventData := map[string]any{
		"reason": reason,
	}

	// Marshal event data
	data, err := json.Marshal(eventData)
	if err != nil {
		return err
	}

	// Create the deleted event
	event := c.AddEvent("Deleted", data)

	// Apply the event to update state immediately
	c.Apply(event, true)

	// Event will be persisted when Save() is called
	return nil
}

// Reload refreshes the chronicle state from the event store
func (c *GenericChronicle) Reload(ctx context.Context) error {
	// Load the chronicle from the repository
	loaded, err := c.repository.Load(ctx, c.ID, c.Type)
	if err != nil {
		return err
	}

	// Type assertion to get the concrete type
	genericLoaded, ok := loaded.(*GenericChronicle)
	if !ok {
		return errors.New("loaded chronicle is not a GenericChronicle")
	}

	// Update properties
	c.Version = genericLoaded.Version
	c.properties = genericLoaded.properties
	c.BaseAggregate.CreatedAt = genericLoaded.BaseAggregate.CreatedAt
	c.BaseAggregate.UpdatedAt = genericLoaded.BaseAggregate.UpdatedAt

	return nil
}

// Apply updates the chronicle state based on an event
func (c *GenericChronicle) Apply(event Event, isNew bool) {
	// Call the base implementation to handle version updates
	c.BaseAggregate.Apply(event, isNew)

	// Apply based on event type
	switch event.GetEventType() {
	case "Created":
		// Parse creation event data
		var eventData map[string]any
		if err := json.Unmarshal(event.GetData(), &eventData); err == nil {
			// Extract initial data from the creation event
			if initialData, ok := eventData["initialData"].(map[string]any); ok {
				c.properties = initialData
			}
		}
	case "Deleted":
		// Mark as deleted by setting a special property
		c.properties["_deleted"] = true
		// Also merge any deletion context data
		var eventData map[string]any
		if err := json.Unmarshal(event.GetData(), &eventData); err == nil {
			for k, v := range eventData {
				c.properties[k] = v
			}
		}
	default:
		// For all other events, merge the data into properties
		// This handles domain-specific events from TrackChange
		var eventData map[string]any
		if err := json.Unmarshal(event.GetData(), &eventData); err == nil {
			for k, v := range eventData {
				c.properties[k] = v
			}
		}
	}
}

// IsDeleted returns whether this chronicle has been deleted
func (c *GenericChronicle) IsDeleted() bool {
	if deleted, ok := c.properties["_deleted"].(bool); ok {
		return deleted
	}
	return false
}

// Load loads a chronicle by ID and type
func Load(ctx context.Context, repository Repository, id AggregateID, chronicleType AggregateType) (Chronicle, error) {
	return repository.Load(ctx, id, chronicleType)
}

// LoadByStringID loads a chronicle by string ID and type
func LoadByStringID(ctx context.Context, repository Repository, id string, chronicleType string) (Chronicle, error) {
	return repository.Load(ctx, AggregateID(id), AggregateType(chronicleType))
}

// RegisterChronicleType registers a factory function for a specific chronicle type
func RegisterChronicleType(repository *EventStoreRepository, chronicleType string) {
	// Register a factory that creates a GenericChronicle
	repository.RegisterAggregate(AggregateType(chronicleType), func(id AggregateID, aggType AggregateType) Aggregate {
		// Create a GenericChronicle that implements both Aggregate and Chronicle interfaces
		chronicle := &GenericChronicle{
			BaseAggregate: NewBaseAggregate(id, aggType),
			repository:    repository,
			properties:    make(map[string]any),
		}

		return chronicle
	})
}

// setState uses reflection to set the target value from source
func setState(source any, target any) error {
	// Ensure target is a pointer
	targetVal := reflect.ValueOf(target)
	if targetVal.Kind() != reflect.Ptr {
		return fmt.Errorf("target must be a pointer")
	}
	if targetVal.IsNil() {
		return fmt.Errorf("target pointer is nil")
	}

	targetElem := targetVal.Elem()
	sourceVal := reflect.ValueOf(source)

	// Direct assignment if types match
	if sourceVal.Type().AssignableTo(targetElem.Type()) {
		targetElem.Set(sourceVal)
		return nil
	}

	// Try type conversion for common cases
	switch targetElem.Kind() {
	case reflect.String:
		switch v := source.(type) {
		case string:
			targetElem.SetString(v)
		case fmt.Stringer:
			targetElem.SetString(v.String())
		default:
			targetElem.SetString(fmt.Sprintf("%v", source))
		}
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		switch v := source.(type) {
		case int:
			targetElem.SetInt(int64(v))
		case int64:
			targetElem.SetInt(v)
		case float64:
			targetElem.SetInt(int64(v))
		default:
			return fmt.Errorf("cannot convert %T to %s", source, targetElem.Kind())
		}
	case reflect.Float32, reflect.Float64:
		switch v := source.(type) {
		case float64:
			targetElem.SetFloat(v)
		case float32:
			targetElem.SetFloat(float64(v))
		case int:
			targetElem.SetFloat(float64(v))
		default:
			return fmt.Errorf("cannot convert %T to %s", source, targetElem.Kind())
		}
	case reflect.Bool:
		switch v := source.(type) {
		case bool:
			targetElem.SetBool(v)
		default:
			return fmt.Errorf("cannot convert %T to bool", source)
		}
	default:
		// For complex types, try JSON marshaling
		data, err := json.Marshal(source)
		if err != nil {
			return fmt.Errorf("cannot convert %T to %s", source, targetElem.Kind())
		}
		return json.Unmarshal(data, target)
	}

	return nil
}

// BootstrapRepository initializes a Chronicle repository with PostgreSQL event store
func BootstrapRepository(db *gorm.DB, chronicleTypes ...string) (Repository, error) {
	// Initialize event store
	eventStore, err := NewPostgresEventStore(db)
	if err != nil {
		log.Printf("WARNING: Failed to initialize event store: %v", err)
		return nil, fmt.Errorf("failed to initialize event store: %w", err)
	}

	// Create repository
	repository := NewEventStoreRepository(eventStore)

	// Register all provided chronicle types
	for _, chronicleType := range chronicleTypes {
		RegisterChronicleType(repository, chronicleType)
	}

	return repository, nil
}
