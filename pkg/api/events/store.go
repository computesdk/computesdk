package events

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"gorm.io/gorm"
)

type DomainEvent interface {
	EventType() string
}

type EventStore interface {
	Append(ctx context.Context, aggregateID string, event DomainEvent) error
	GetEvents(ctx context.Context, aggregateID string) ([]Event, error)
	GetAllEvents(ctx context.Context) ([]Event, error)
}

type GormEventStore struct {
	db *gorm.DB
}

func NewGormEventStore(db *gorm.DB) *GormEventStore {
	return &GormEventStore{db: db}
}

func (s *GormEventStore) Migrate() error {
	return s.db.AutoMigrate(&Event{})
}

func (s *GormEventStore) Append(ctx context.Context, aggregateID string, event DomainEvent) error {
	eventType := event.EventType()
	dataJSON, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("failed to marshal event data: %w", err)
	}

	eventRecord := Event{
		EventID:     generateEventID(),
		AggregateID: aggregateID,
		Type:        eventType,
		Data:        string(dataJSON),
		Timestamp:   time.Now(),
	}

	return s.db.WithContext(ctx).Create(&eventRecord).Error
}

func (s *GormEventStore) GetAllEvents(ctx context.Context) ([]Event, error) {
	var events []Event
	err := s.db.WithContext(ctx).Order("timestamp ASC").Find(&events).Error

	return events, err
}

func (s *GormEventStore) GetEvents(ctx context.Context, aggregateID string) ([]Event, error) {
	var events []Event
	err := s.db.WithContext(ctx).
		Where("aggregate_id = ?", aggregateID).
		Order("timestamp ASC").
		Find(&events).Error

	return events, err
}

func generateEventID() string {
	return fmt.Sprintf("%d", time.Now().UnixNano())
}
