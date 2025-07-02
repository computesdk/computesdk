// Package compute
package compute

import (
	"context"
	"fmt"
	"time"

	"github.com/heysnelling/computesdk/pkg/api/events"
	"github.com/heysnelling/computesdk/pkg/common"
	"gorm.io/gorm"
)

type ComputeService struct {
	eventStore  events.EventStore
	summaryRepo *SummaryRepository
}

func NewService(db *gorm.DB) *ComputeService {
	return &ComputeService{
		eventStore:  events.NewGormEventStore(db),
		summaryRepo: NewSummaryRepository(db),
	}
}

func (s *ComputeService) CreateCompute(ctx context.Context, req *CreateComputeRequest) (*ComputeSummary, error) {
	computeID, err := common.GeneratePrefixedID("compute_")
	if err != nil {
		return nil, err
	}

	event := ComputeCreated{
		Environment: req.Environment,
		ComputeID:   computeID,
		CreatedAt:   time.Now(),
	}

	err = s.eventStore.Append(ctx, computeID, event)
	if err != nil {
		return nil, err
	}

	compute, err := s.GetAggregateCompute(ctx, event.ComputeID)
	if err != nil {
		return nil, err
	}

	summary := compute.ToSummary("123")
	return s.summaryRepo.Create(ctx, summary)
}

func (s *ComputeService) TerminateCompute(ctx context.Context, req *TerminateComputeRequest) (*ComputeSummary, error) {
	event := ComputeTerminated{
		ComputeID: req.ComputeID,
		Reason:    req.Reason,
	}

	err := s.eventStore.Append(ctx, event.ComputeID, event)
	if err != nil {
		return nil, err
	}

	compute, err := s.GetAggregateCompute(ctx, event.ComputeID)
	if err != nil {
		return nil, err
	}

	summary := compute.ToSummary("123")
	return s.summaryRepo.Update(ctx, summary)
}

func (s *ComputeService) ListComputes(ctx context.Context, ownerID *string) ([]ComputeSummary, error) {
	return s.summaryRepo.List(ctx, ownerID, 25, 0)
}

func (s *ComputeService) GetCompute(ctx context.Context, computeID string) (*ComputeSummary, error) {
	return s.summaryRepo.Get(ctx, computeID)
}

func (s *ComputeService) GetAggregateCompute(ctx context.Context, computeID string) (*ComputeAggregate, error) {
	events, err := s.eventStore.GetEvents(ctx, computeID)
	if err != nil {
		return nil, err
	}

	if len(events) == 0 {
		return nil, fmt.Errorf("compute not found: %s", computeID)
	}

	computeAggregate := &ComputeAggregate{}

	if err := computeAggregate.Apply(events); err != nil {
		return nil, err
	}

	return computeAggregate, nil
}
