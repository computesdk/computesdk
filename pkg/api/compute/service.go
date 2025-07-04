// Package compute
package compute

import (
	"context"
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/heysnelling/computesdk/pkg/api/events"
	"github.com/heysnelling/computesdk/pkg/api/middleware"
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

func (s *ComputeService) CreateCompute(c *gin.Context, req *CreateComputeRequest) (*ComputeSummary, error) {
	ctx := c.Request.Context()
	sessionID := middleware.GetSessionID(c)
	if sessionID == "" {
		return nil, fmt.Errorf("session ID not found in context")
	}

	computeID := common.GeneratePrefixedID("compute_")

	event := ComputeCreated{
		Environment: req.Environment,
		ComputeID:   computeID,
		CreatedAt:   time.Now(),
	}

	err := s.eventStore.Append(ctx, computeID, event)
	if err != nil {
		return nil, err
	}

	compute, err := s.GetAggregateCompute(ctx, event.ComputeID)
	if err != nil {
		return nil, err
	}

	summary := compute.ToSummary(sessionID)
	return s.summaryRepo.Create(ctx, summary)
}

func (s *ComputeService) TerminateCompute(c *gin.Context, req *TerminateComputeRequest) (*ComputeSummary, error) {
	ctx := c.Request.Context()
	sessionID := middleware.GetSessionID(c)
	if sessionID == "" {
		return nil, fmt.Errorf("session ID not found in context")
	}

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

	summary := compute.ToSummary(sessionID)
	return s.summaryRepo.Update(ctx, summary)
}

func (s *ComputeService) ListComputes(c *gin.Context) ([]ComputeSummary, error) {
	ctx := c.Request.Context()
	sessionID := middleware.GetSessionID(c)
	if sessionID == "" {
		return nil, fmt.Errorf("session ID not found in context")
	}

	return s.summaryRepo.List(ctx, &sessionID, 25, 0)
}

func (s *ComputeService) GetCompute(c *gin.Context, computeID string) (*ComputeSummary, error) {
	ctx := c.Request.Context()
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
