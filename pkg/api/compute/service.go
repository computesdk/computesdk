// Package compute
package compute

import (
	"context"
	"time"

	"github.com/heysnelling/computesdk/pkg/api/events"
	"github.com/matoous/go-nanoid/v2"
)

type ComputeService struct {
	eventStore events.EventStore
}

func NewService(eventStore events.EventStore) *ComputeService {
	return &ComputeService{
		eventStore: eventStore,
	}
}

func (s *ComputeService) CreateCompute(ctx context.Context, req *CreateComputeRequest) (*Compute, error) {
	id, err := gonanoid.New()
	if err != nil {
		return nil, err
	}

	event := ComputeCreated{
		Environment: req.Environment,
		ComputeID:   "compute_" + id,
		CreatedAt:   time.Now(),
	}

	err = s.eventStore.Append(ctx, "compute_"+id, event)
	if err != nil {
		return nil, err
	}

	return s.GetCompute(ctx, id)
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

func (s *ComputeService) TerminateCompute(ctx context.Context, req *TerminateComputeRequest) (*Compute, error) {
	event := ComputeTerminated{
		ComputeID: req.ComputeID,
		Reason:    req.Reason,
	}

	err := s.eventStore.Append(ctx, event.ComputeID, event)
	if err != nil {
		return nil, err
	}

	return s.GetCompute(ctx, event.ComputeID)
}

func (s *ComputeService) ListComputes(ctx context.Context) ([]*Compute, error) {
	return nil, nil
}
