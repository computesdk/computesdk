// Package preset
package preset

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

type PresetService struct {
	eventStore  events.EventStore
	summaryRepo *SummaryRepository
}

func NewService(db *gorm.DB) *PresetService {
	return &PresetService{
		eventStore:  events.NewGormEventStore(db),
		summaryRepo: NewSummaryRepository(db),
	}
}

func (s *PresetService) CreatePreset(c *gin.Context, req *CreatePresetRequest) (*PresetSummary, error) {
	ctx := c.Request.Context()
	createdBy := middleware.GetAPIKeyID(c) // Use API key ID as creator
	if createdBy == "" {
		return nil, fmt.Errorf("API key not found in context")
	}

	presetID := common.GeneratePrefixedID("preset_")

	event := PresetCreated{
		PresetID:    presetID,
		Name:        req.Name,
		Description: req.Description,
		Config:      req.Config,
		CreatedBy:   createdBy,
		IsPublic:    req.IsPublic,
		CreatedAt:   time.Now(),
	}

	err := s.eventStore.Append(ctx, presetID, event)
	if err != nil {
		return nil, err
	}

	preset, err := s.GetAggregatePreset(ctx, event.PresetID)
	if err != nil {
		return nil, err
	}

	summary := preset.ToSummary()
	return s.summaryRepo.Create(ctx, summary)
}

func (s *PresetService) DeletePreset(c *gin.Context, req *DeletePresetRequest) (*PresetSummary, error) {
	ctx := c.Request.Context()
	deletedBy := middleware.GetAPIKeyID(c)
	if deletedBy == "" {
		return nil, fmt.Errorf("API key not found in context")
	}

	// First check if preset exists and user has permission to delete it
	summary, err := s.summaryRepo.Get(ctx, req.PresetID)
	if err != nil {
		return nil, err
	}

	// Optional: Check if user is the creator or has admin rights
	if summary.CreatedBy != deletedBy {
		// Check if user has admin permissions
		isAdmin := middleware.HasPermission(c, "preset:admin")
		if !isAdmin {
			return nil, fmt.Errorf("unauthorized: only the creator or an admin can delete this preset")
		}
	}

	event := PresetDeleted{
		PresetID:  req.PresetID,
		Reason:    req.Reason,
		DeletedBy: deletedBy,
		DeletedAt: time.Now(),
	}

	err = s.eventStore.Append(ctx, req.PresetID, event)
	if err != nil {
		return nil, err
	}

	preset, err := s.GetAggregatePreset(ctx, req.PresetID)
	if err != nil {
		return nil, err
	}

	summary = preset.ToSummary()
	return s.summaryRepo.Update(ctx, summary)
}

func (s *PresetService) GetPreset(c *gin.Context, presetID string) (*PresetSummary, error) {
	ctx := c.Request.Context()
	userID := middleware.GetAPIKeyID(c)

	// Get the preset
	preset, err := s.summaryRepo.Get(ctx, presetID)
	if err != nil {
		return nil, err
	}

	// Check access permissions (if not public, only creator can access)
	if !preset.IsPublic && preset.CreatedBy != userID {
		// Check if user has admin permissions
		isAdmin := middleware.HasPermission(c, "preset:admin")
		if !isAdmin {
			return nil, fmt.Errorf("unauthorized: this preset is private")
		}
	}

	return preset, nil
}

func (s *PresetService) ListPresets(c *gin.Context, isPublicOnly bool, limit, offset int) ([]PresetSummary, error) {
	ctx := c.Request.Context()
	userID := middleware.GetAPIKeyID(c)

	if isPublicOnly {
		isPublic := true
		status := "active"
		return s.summaryRepo.List(ctx, nil, &isPublic, &status, limit, offset)
	} else {
		// Return both user's presets and public presets
		return s.summaryRepo.ListAccessible(ctx, userID, limit, offset)
	}
}

func (s *PresetService) GetAggregatePreset(ctx context.Context, presetID string) (*PresetAggregate, error) {
	events, err := s.eventStore.GetEvents(ctx, presetID)
	if err != nil {
		return nil, err
	}

	if len(events) == 0 {
		return nil, fmt.Errorf("preset not found: %s", presetID)
	}

	presetAggregate := &PresetAggregate{}

	if err := presetAggregate.Apply(events); err != nil {
		return nil, err
	}

	return presetAggregate, nil
}
