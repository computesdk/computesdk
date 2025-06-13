package services

import (
	"context"
	"fmt"
	"log"

	"github.com/heysnelling/computesdk/pkg/api/chronicle"
	projections "github.com/heysnelling/computesdk/pkg/models/projections"
	"gorm.io/gorm"
)

type GroupService struct {
	db         *gorm.DB
	repository chronicle.Repository
}

func NewGroupService(db *gorm.DB) *GroupService {
	repository, err := chronicle.BootstrapRepository(db, "group")
	if err != nil {
		log.Printf("WARNING: Failed to bootstrap repository: %v", err)
		return &GroupService{db: db}
	}

	return &GroupService{
		db:         db,
		repository: repository,
	}
}

func (s *GroupService) GetGroup(ctx context.Context, id string) (*projections.Group, error) {
	// Read from projection table for fast queries
	var groupProjection projections.Group
	if err := s.db.Where("id = ?", id).First(&groupProjection).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, fmt.Errorf("group not found")
		}
		return nil, err
	}

	return &groupProjection, nil
}

func (s *GroupService) CreateGroup(ctx context.Context, creates map[string]any) (*projections.Group, error) {
	// Create new group chronicle
	group := chronicle.NewChronicle("group", s.repository)

	// Track creation with initial data
	err := group.TrackCreate(creates)
	if err != nil {
		return nil, err
	}

	// Save to chronicle first (source of truth)
	if err := group.Save(ctx); err != nil {
		return nil, err
	}

	// Create projection from chronicle state
	var groupModel projections.Group
	if err := group.StateAll(&groupModel); err != nil {
		return nil, err
	}

	// Set metadata from chronicle
	groupModel.ID = string(group.GetID())
	groupModel.CreatedAt = group.CreatedAt()
	groupModel.UpdatedAt = group.UpdatedAt()

	// Update projection (best effort)
	if err := s.db.Create(&groupModel).Error; err != nil {
		log.Printf("WARNING: Failed to update projection for group %s: %v", group.GetID(), err)
	}

	return &groupModel, nil
}

func (s *GroupService) UpdateGroup(ctx context.Context, id string, updates map[string]any) (*projections.Group, error) {
	// Load existing group from chronicle
	group, err := chronicle.LoadByStringID(ctx, s.repository, id, "group")
	if err != nil {
		return nil, err
	}

	// Check if deleted
	if group.IsDeleted() {
		return nil, fmt.Errorf("group not found")
	}

	// Track changes in chronicle
	if err := group.TrackChange("Updated", updates); err != nil {
		return nil, err
	}

	// Save changes to chronicle first (source of truth)
	if err := group.Save(ctx); err != nil {
		return nil, err
	}

	// Update projection from chronicle state
	var groupModel projections.Group
	if err := group.StateAll(&groupModel); err != nil {
		return nil, err
	}

	// Set metadata from chronicle
	groupModel.ID = string(group.GetID())
	groupModel.CreatedAt = group.CreatedAt()
	groupModel.UpdatedAt = group.UpdatedAt()

	// Update projection (best effort)
	if err := s.db.Save(&groupModel).Error; err != nil {
		log.Printf("WARNING: Failed to update projection for group %s: %v", group.GetID(), err)
	}

	return &groupModel, nil
}

func (s *GroupService) DeleteGroup(ctx context.Context, id string, reason string) (*projections.Group, error) {
	// Load existing group from chronicle
	group, err := chronicle.LoadByStringID(ctx, s.repository, id, "group")
	if err != nil {
		return nil, err
	}

	// Check if already deleted
	if group.IsDeleted() {
		return nil, fmt.Errorf("group not found")
	}

	// Get current state before deletion
	var groupModel projections.Group
	if err := group.StateAll(&groupModel); err != nil {
		return nil, err
	}
	groupModel.ID = string(group.GetID())
	groupModel.CreatedAt = group.CreatedAt()
	groupModel.UpdatedAt = group.UpdatedAt()

	// Track deletion in chronicle first (source of truth)
	if err := group.TrackDelete(reason); err != nil {
		return nil, err
	}

	// Save deletion event to chronicle
	if err := group.Save(ctx); err != nil {
		return nil, err
	}

	// Delete projection (best effort)
	if err := s.db.Delete(&projections.Group{}, "id = ?", id).Error; err != nil {
		log.Printf("WARNING: Failed to delete projection for group %s: %v", id, err)
	}

	return &groupModel, nil
}

func (s *GroupService) ListGroups(ctx context.Context) ([]*projections.Group, error) {
	// Read from projection table for fast queries
	var groups []*projections.Group
	if err := s.db.Find(&groups).Error; err != nil {
		return nil, err
	}

	return groups, nil
}