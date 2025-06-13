package chronicle

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/heysnelling/computesdk/pkg/models/chronicle"
	"gorm.io/gorm"
)

// EventStore defines the interface for storing and retrieving events
type EventStore interface {
	// SaveEvents persists events to the store
	SaveEvents(ctx context.Context, events []Event) error

	// GetEvents retrieves all events for an aggregate
	GetEvents(ctx context.Context, aggregateID AggregateID, aggregateType AggregateType) ([]Event, error)

	// GetEventsByType retrieves events of a specific type
	GetEventsByType(ctx context.Context, eventType string) ([]Event, error)

	// GetAllEvents retrieves all events, optionally with pagination
	GetAllEvents(ctx context.Context, offset, limit int) ([]Event, error)
}


// PostgresEventStore implements the EventStore interface using PostgreSQL
type PostgresEventStore struct {
	db *gorm.DB
}

// NewPostgresEventStore creates a new PostgreSQL event store
func NewPostgresEventStore(db *gorm.DB) (*PostgresEventStore, error) {
	// Create the events table if it doesn't exist
	err := db.AutoMigrate(&chronicle.EventRecord{})
	if err != nil {
		return nil, fmt.Errorf("failed to migrate events table: %w", err)
	}

	return &PostgresEventStore{
		db: db,
	}, nil
}

// SaveEvents persists events to the store
func (s *PostgresEventStore) SaveEvents(ctx context.Context, events []Event) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		for _, event := range events {
			// Convert to database record
			record := &chronicle.EventRecord{
				ID:            uuid.New().String(),
				AggregateID:   string(event.GetAggregateID()),
				AggregateType: string(event.GetAggregateType()),
				EventType:     event.GetEventType(),
				Version:       event.GetVersion(),
				Data:          event.GetData(),
				CreatedAt:     event.GetCreatedAt(),
			}

			// Check for concurrency issues - ensure no event exists with same aggregate ID and version
			var count int64
			if err := tx.Model(&chronicle.EventRecord{}).
				Where("aggregate_id = ? AND version = ?", record.AggregateID, record.Version).
				Count(&count).Error; err != nil {
				return err
			}

			if count > 0 {
				return ErrConcurrencyConflict
			}

			// Save the event
			if err := tx.Create(record).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// GetEvents retrieves all events for an aggregate
func (s *PostgresEventStore) GetEvents(ctx context.Context, aggregateID AggregateID, aggregateType AggregateType) ([]Event, error) {
	var records []chronicle.EventRecord

	err := s.db.Where("aggregate_id = ? AND aggregate_type = ?", string(aggregateID), string(aggregateType)).
		Order("version ASC").
		Find(&records).Error

	if err != nil {
		return nil, err
	}

	return s.recordsToEvents(records)
}

// GetEventsByType retrieves events of a specific type
func (s *PostgresEventStore) GetEventsByType(ctx context.Context, eventType string) ([]Event, error) {
	var records []chronicle.EventRecord

	err := s.db.Where("event_type = ?", eventType).
		Order("created_at ASC").
		Find(&records).Error

	if err != nil {
		return nil, err
	}

	return s.recordsToEvents(records)
}

// GetAllEvents retrieves all events, optionally with pagination
func (s *PostgresEventStore) GetAllEvents(ctx context.Context, offset, limit int) ([]Event, error) {
	var records []chronicle.EventRecord

	query := s.db.Order("created_at ASC")

	if limit > 0 {
		query = query.Offset(offset).Limit(limit)
	}

	err := query.Find(&records).Error
	if err != nil {
		return nil, err
	}

	return s.recordsToEvents(records)
}

// recordsToEvents converts database records to domain events
func (s *PostgresEventStore) recordsToEvents(records []chronicle.EventRecord) ([]Event, error) {
	events := make([]Event, len(records))

	for i, record := range records {
		events[i] = &BaseEvent{
			AggregateID:   AggregateID(record.AggregateID),
			AggregateType: AggregateType(record.AggregateType),
			EventType:     record.EventType,
			Version:       record.Version,
			Data:          record.Data,
			CreatedAt:     record.CreatedAt,
		}
	}

	return events, nil
}
