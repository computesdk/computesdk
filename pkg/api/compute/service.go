// Package compute
package compute

import (
	"context"
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

	compute, err := s.GetCompute(ctx, computeID)
	if err != nil {
		return nil, err
	}

	summary := compute.ToSummary("123")
	return s.summaryRepo.Create(summary)
}

func (s *ComputeService) GetCompute(ctx context.Context, computeID string) (*Compute, error) {
	events, err := s.eventStore.GetEvents(ctx, computeID)
	if err != nil {
		return nil, err
	}

	compute := &Compute{}
	compute.Apply(events)
	return compute, nil
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

	compute, err := s.GetCompute(ctx, event.ComputeID)
	if err != nil {
		return nil, err
	}

	summary := compute.ToSummary("123")
	return s.summaryRepo.Update(summary)
}

func (s *ComputeService) ListComputes(ctx context.Context, ownerID *string) ([]ComputeSummary, error) {
	return s.summaryRepo.List(ownerID, 25, 0)
}
