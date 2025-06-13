package services

import (
	"context"
	"fmt"
	"log"

	"github.com/heysnelling/computesdk/pkg/api/chronicle"
	projections "github.com/heysnelling/computesdk/pkg/models/projections"
	"gorm.io/gorm"
)

type ComputeService struct {
	db         *gorm.DB
	repository chronicle.Repository
}

func NewComputeService(db *gorm.DB) *ComputeService {
	repository, err := chronicle.BootstrapRepository(db, "compute")
	if err != nil {
		log.Printf("WARNING: Failed to bootstrap repository: %v", err)
		return &ComputeService{db: db}
	}

	return &ComputeService{
		db:         db,
		repository: repository,
	}
}

func (s *ComputeService) GetCompute(ctx context.Context, id string) (*projections.Compute, error) {
	// Read from projection table for fast queries
	var computeProjection projections.Compute
	if err := s.db.Where("id = ?", id).First(&computeProjection).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, fmt.Errorf("compute not found")
		}
		return nil, err
	}

	return &computeProjection, nil
}

func (s *ComputeService) CreateCompute(ctx context.Context, creates map[string]any) (*projections.Compute, error) {
	// Create new compute chronicle
	compute := chronicle.NewChronicle("compute", s.repository)

	// Track creation with initial data
	err := compute.TrackCreate(creates)
	if err != nil {
		return nil, err
	}

	// Save to chronicle first (source of truth)
	if err := compute.Save(ctx); err != nil {
		return nil, err
	}

	// Create projection from chronicle state
	var computeModel projections.Compute
	if err := compute.StateAll(&computeModel); err != nil {
		return nil, err
	}

	// Set metadata from chronicle
	computeModel.ID = string(compute.GetID())
	computeModel.CreatedAt = compute.CreatedAt()
	computeModel.UpdatedAt = compute.UpdatedAt()

	// Update projection (best effort)
	if err := s.db.Create(&computeModel).Error; err != nil {
		log.Printf("WARNING: Failed to update projection for compute %s: %v", compute.GetID(), err)
	}

	return &computeModel, nil
}

func (s *ComputeService) UpdateCompute(ctx context.Context, id string, updates map[string]any) (*projections.Compute, error) {
	// Load existing compute from chronicle
	compute, err := chronicle.LoadByStringID(ctx, s.repository, id, "compute")
	if err != nil {
		return nil, err
	}

	// Check if deleted
	if compute.IsDeleted() {
		return nil, fmt.Errorf("compute not found")
	}

	// Track changes in chronicle
	if err := compute.TrackChange("Updated", updates); err != nil {
		return nil, err
	}

	// Save changes to chronicle first (source of truth)
	if err := compute.Save(ctx); err != nil {
		return nil, err
	}

	// Update projection from chronicle state
	var computeModel projections.Compute
	if err := compute.StateAll(&computeModel); err != nil {
		return nil, err
	}

	// Set metadata from chronicle
	computeModel.ID = string(compute.GetID())
	computeModel.CreatedAt = compute.CreatedAt()
	computeModel.UpdatedAt = compute.UpdatedAt()

	// Update projection (best effort)
	if err := s.db.Save(&computeModel).Error; err != nil {
		log.Printf("WARNING: Failed to update projection for compute %s: %v", compute.GetID(), err)
	}

	return &computeModel, nil
}

func (s *ComputeService) DeleteCompute(ctx context.Context, id string, reason string) (*projections.Compute, error) {
	// Load existing compute from chronicle
	compute, err := chronicle.LoadByStringID(ctx, s.repository, id, "compute")
	if err != nil {
		return nil, err
	}

	// Check if already deleted
	if compute.IsDeleted() {
		return nil, fmt.Errorf("compute not found")
	}

	// Get current state before deletion
	var computeModel projections.Compute
	if err := compute.StateAll(&computeModel); err != nil {
		return nil, err
	}
	computeModel.ID = string(compute.GetID())
	computeModel.CreatedAt = compute.CreatedAt()
	computeModel.UpdatedAt = compute.UpdatedAt()

	// Track deletion in chronicle first (source of truth)
	if err := compute.TrackDelete(reason); err != nil {
		return nil, err
	}

	// Save deletion event to chronicle
	if err := compute.Save(ctx); err != nil {
		return nil, err
	}

	// Delete projection (best effort)
	if err := s.db.Delete(&projections.Compute{}, "id = ?", id).Error; err != nil {
		log.Printf("WARNING: Failed to delete projection for compute %s: %v", id, err)
	}

	return &computeModel, nil
}

func (s *ComputeService) ListComputes(ctx context.Context) ([]*projections.Compute, error) {
	// Read from projection table for fast queries
	var computes []*projections.Compute
	if err := s.db.Find(&computes).Error; err != nil {
		return nil, err
	}

	return computes, nil
}
