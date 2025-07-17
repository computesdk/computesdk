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
	"github.com/heysnelling/computesdk/pkg/managers"
	"gorm.io/gorm"
)

type ComputeService struct {
	eventStore  events.EventStore
	summaryRepo *SummaryRepository
	computeMgr  managers.ComputeManager
	presetMgr   managers.PresetManager
}

func NewService(db *gorm.DB, computeMgr managers.ComputeManager, presetMgr managers.PresetManager) *ComputeService {
	return &ComputeService{
		eventStore:  events.NewGormEventStore(db),
		summaryRepo: NewSummaryRepository(db),
		computeMgr:  computeMgr,
		presetMgr:   presetMgr,
	}
}

func (s *ComputeService) CreateCompute(c *gin.Context, req *CreateComputeRequest) (*ComputeSummary, error) {
	ctx := c.Request.Context()

	// Get API key ID from context
	apiKeyID := middleware.GetAPIKeyID(c)
	if apiKeyID == "" {
		return nil, fmt.Errorf("API key not found in context")
	}
	computeID := common.GeneratePrefixedID("compute_")

	// 1. Create event for audit trail
	event := ComputeCreated{
		ComputeID: computeID,
		CreatedAt: time.Now(),
	}

	err := s.eventStore.Append(ctx, computeID, event)
	if err != nil {
		return nil, fmt.Errorf("failed to store compute created event: %w", err)
	}

	// 2. Create actual compute instance in Kubernetes (if manager available)
	if s.computeMgr != nil && s.presetMgr != nil {
		// Use provided preset or fall back to default
		presetID := req.PresetID
		if presetID == "" {
			presetID = managers.GetDefaultPreset()
		}

		// Validate that the preset exists
		_, err := s.presetMgr.GetPreset(ctx, presetID)
		if err != nil {
			return nil, fmt.Errorf("invalid preset %s: %w", presetID, err)
		}

		computeSpec := managers.ComputeSpec{
			ComputeID: computeID,
			PresetID:  presetID,
			Labels: map[string]string{
				"apiKeyId": apiKeyID,
			},
		}

		computeInfo, err := s.computeMgr.CreateCompute(ctx, computeSpec)
		if err != nil {
			// If Kubernetes creation fails, we should record this failure
			// For now, we'll return the error but the event is already stored
			return nil, fmt.Errorf("failed to create compute in Kubernetes: %w", err)
		}

		// 3. Create ComputeStarted event with actual pod information
		startedEvent := ComputeStarted{
			ComputeID: computeID,
			IPAddress: computeInfo.Network.PodIP,
			PodName:   computeInfo.PodName,
			StartedAt: time.Now(),
		}

		err = s.eventStore.Append(ctx, computeID, startedEvent)
		if err != nil {
			// Log error but don't fail the request since compute is already created
			// TODO: Implement proper error handling/compensation
			fmt.Printf("Warning: failed to store compute started event: %v\n", err)
		}
	} else {
		// Fallback: No Kubernetes integration available
		fmt.Printf("Warning: Kubernetes managers not available, compute %s created in events only\n", computeID)
	}
	// 4. Build aggregate and create summary
	compute, err := s.GetAggregateCompute(ctx, computeID)
	if err != nil {
		return nil, fmt.Errorf("failed to get compute aggregate: %w", err)
	}

	summary := compute.ToSummary(apiKeyID)
	return s.summaryRepo.Create(ctx, summary)
}

func (s *ComputeService) TerminateCompute(c *gin.Context, req *TerminateComputeRequest) (*ComputeSummary, error) {
	ctx := c.Request.Context()

	// Get API key ID from context
	apiKeyID := middleware.GetAPIKeyID(c)
	if apiKeyID == "" {
		return nil, fmt.Errorf("API key not found in context")
	}
	// 1. Delete actual compute instance from Kubernetes (if manager available)
	if s.computeMgr != nil {
		err := s.computeMgr.DeleteCompute(ctx, req.ComputeID)
		if err != nil {
			// Check if it's a "not found" error - that's okay for termination
			if !managers.IsComputeNotFound(err) {
				return nil, fmt.Errorf("failed to delete compute from Kubernetes: %w", err)
			}
		}
	} else {
		// Fallback: No Kubernetes integration available
		fmt.Printf("Warning: Kubernetes manager not available, compute %s terminated in events only\n", req.ComputeID)
	}

	// 2. Create termination event for audit trail
	event := ComputeTerminated{
		ComputeID: req.ComputeID,
		Reason:    req.Reason,
	}

	err := s.eventStore.Append(ctx, event.ComputeID, event)
	if err != nil {
		return nil, fmt.Errorf("failed to store compute terminated event: %w", err)
	}

	// 3. Update aggregate and summary
	compute, err := s.GetAggregateCompute(ctx, event.ComputeID)
	if err != nil {
		return nil, fmt.Errorf("failed to get compute aggregate: %w", err)
	}

	summary := compute.ToSummary(apiKeyID)
	return s.summaryRepo.Update(ctx, summary)
}

func (s *ComputeService) ListComputes(c *gin.Context) ([]ComputeSummary, error) {
	ctx := c.Request.Context()

	// Get API key ID from context
	apiKeyID := middleware.GetAPIKeyID(c)
	if apiKeyID == "" {
		return nil, fmt.Errorf("API key not found in context")
	}

	return s.summaryRepo.ListByAPIKey(ctx, apiKeyID, 25, 0)
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

// ListPresets lists available presets
func (s *ComputeService) ListPresets(c *gin.Context) (*PresetListResponse, error) {
	ctx := c.Request.Context()

	if s.presetMgr == nil {
		return nil, fmt.Errorf("preset manager not available")
	}

	presets, err := s.presetMgr.ListPresets(ctx, managers.PresetFilters{})
	if err != nil {
		return nil, err
	}

	return presetListToResponse(presets), nil
}

// GetPreset gets a specific preset by ID
func (s *ComputeService) GetPreset(c *gin.Context, presetID string) (*PresetResponse, error) {
	ctx := c.Request.Context()

	if s.presetMgr == nil {
		return nil, fmt.Errorf("preset manager not available")
	}

	preset, err := s.presetMgr.GetPreset(ctx, presetID)
	if err != nil {
		return nil, err
	}

	return presetInfoToResponse(preset), nil
}
