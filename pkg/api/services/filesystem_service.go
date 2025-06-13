package services

import (
	"context"
	"fmt"
	"log"

	"github.com/heysnelling/computesdk/pkg/api/chronicle"
	projections "github.com/heysnelling/computesdk/pkg/models/projections"
	"gorm.io/gorm"
)

type FilesystemService struct {
	db         *gorm.DB
	repository chronicle.Repository
}

func NewFilesystemService(db *gorm.DB) *FilesystemService {
	repository, err := chronicle.BootstrapRepository(db, "filesystem")
	if err != nil {
		log.Printf("WARNING: Failed to bootstrap repository: %v", err)
		return &FilesystemService{db: db}
	}

	return &FilesystemService{
		db:         db,
		repository: repository,
	}
}

func (s *FilesystemService) GetFilesystem(ctx context.Context, id string) (*projections.FileSystem, error) {
	// Read from projection table for fast queries
	var filesystemProjection projections.FileSystem
	if err := s.db.Where("id = ?", id).First(&filesystemProjection).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, fmt.Errorf("filesystem not found")
		}
		return nil, err
	}

	return &filesystemProjection, nil
}

func (s *FilesystemService) CreateFilesystem(ctx context.Context, creates map[string]any) (*projections.FileSystem, error) {
	// Create new filesystem chronicle
	filesystem := chronicle.NewChronicle("filesystem", s.repository)

	// Track creation with initial data
	err := filesystem.TrackCreate(creates)
	if err != nil {
		return nil, err
	}

	// Save to chronicle first (source of truth)
	if err := filesystem.Save(ctx); err != nil {
		return nil, err
	}

	// Create projection from chronicle state
	var filesystemModel projections.FileSystem
	if err := filesystem.StateAll(&filesystemModel); err != nil {
		return nil, err
	}

	// Set metadata from chronicle
	filesystemModel.ID = string(filesystem.GetID())
	filesystemModel.CreatedAt = filesystem.CreatedAt()
	filesystemModel.UpdatedAt = filesystem.UpdatedAt()

	// Update projection (best effort)
	if err := s.db.Create(&filesystemModel).Error; err != nil {
		log.Printf("WARNING: Failed to update projection for filesystem %s: %v", filesystem.GetID(), err)
	}

	return &filesystemModel, nil
}

func (s *FilesystemService) UpdateFilesystem(ctx context.Context, id string, updates map[string]any) (*projections.FileSystem, error) {
	// Load existing filesystem from chronicle
	filesystem, err := chronicle.LoadByStringID(ctx, s.repository, id, "filesystem")
	if err != nil {
		return nil, err
	}

	// Check if deleted
	if filesystem.IsDeleted() {
		return nil, fmt.Errorf("filesystem not found")
	}

	// Track changes in chronicle
	if err := filesystem.TrackChange("Updated", updates); err != nil {
		return nil, err
	}

	// Save changes to chronicle first (source of truth)
	if err := filesystem.Save(ctx); err != nil {
		return nil, err
	}

	// Update projection from chronicle state
	var filesystemModel projections.FileSystem
	if err := filesystem.StateAll(&filesystemModel); err != nil {
		return nil, err
	}

	// Set metadata from chronicle
	filesystemModel.ID = string(filesystem.GetID())
	filesystemModel.CreatedAt = filesystem.CreatedAt()
	filesystemModel.UpdatedAt = filesystem.UpdatedAt()

	// Update projection (best effort)
	if err := s.db.Save(&filesystemModel).Error; err != nil {
		log.Printf("WARNING: Failed to update projection for filesystem %s: %v", filesystem.GetID(), err)
	}

	return &filesystemModel, nil
}

func (s *FilesystemService) DeleteFilesystem(ctx context.Context, id string, reason string) (*projections.FileSystem, error) {
	// Load existing filesystem from chronicle
	filesystem, err := chronicle.LoadByStringID(ctx, s.repository, id, "filesystem")
	if err != nil {
		return nil, err
	}

	// Check if already deleted
	if filesystem.IsDeleted() {
		return nil, fmt.Errorf("filesystem not found")
	}

	// Get current state before deletion
	var filesystemModel projections.FileSystem
	if err := filesystem.StateAll(&filesystemModel); err != nil {
		return nil, err
	}
	filesystemModel.ID = string(filesystem.GetID())
	filesystemModel.CreatedAt = filesystem.CreatedAt()
	filesystemModel.UpdatedAt = filesystem.UpdatedAt()

	// Track deletion in chronicle first (source of truth)
	if err := filesystem.TrackDelete(reason); err != nil {
		return nil, err
	}

	// Save deletion event to chronicle
	if err := filesystem.Save(ctx); err != nil {
		return nil, err
	}

	// Delete projection (best effort)
	if err := s.db.Delete(&projections.FileSystem{}, "id = ?", id).Error; err != nil {
		log.Printf("WARNING: Failed to delete projection for filesystem %s: %v", id, err)
	}

	return &filesystemModel, nil
}

func (s *FilesystemService) ListFilesystems(ctx context.Context) ([]*projections.FileSystem, error) {
	// Read from projection table for fast queries
	var filesystems []*projections.FileSystem
	if err := s.db.Find(&filesystems).Error; err != nil {
		return nil, err
	}

	return filesystems, nil
}
