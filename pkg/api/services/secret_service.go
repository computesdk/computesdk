package services

import (
	"context"
	"fmt"
	"log"

	"github.com/heysnelling/computesdk/pkg/api/chronicle"
	projections "github.com/heysnelling/computesdk/pkg/models/projections"
	"gorm.io/gorm"
)

type SecretService struct {
	db         *gorm.DB
	repository chronicle.Repository
}

func NewSecretService(db *gorm.DB) *SecretService {
	repository, err := chronicle.BootstrapRepository(db, "secret")
	if err != nil {
		log.Printf("WARNING: Failed to bootstrap repository: %v", err)
		return &SecretService{db: db}
	}

	return &SecretService{
		db:         db,
		repository: repository,
	}
}

func (s *SecretService) GetSecret(ctx context.Context, id string) (*projections.Secret, error) {
	// Read from projection table for fast queries
	var secretProjection projections.Secret
	if err := s.db.Where("id = ?", id).First(&secretProjection).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, fmt.Errorf("secret not found")
		}
		return nil, err
	}

	//TODO: add a decrypt method of the secret here

	return &secretProjection, nil
}

func (s *SecretService) CreateSecret(ctx context.Context, creates map[string]any) (*projections.Secret, error) {
	//TODO: add validation based on file system Struct

	// Create new secret chronicle
	secret := chronicle.NewChronicle("secret", s.repository)

	//TODO: add a encrypt method of the secret

	// Track creation with initial data
	err := secret.TrackCreate(creates)
	if err != nil {
		return nil, err
	}

	// Save to chronicle first (source of truth)
	if err := secret.Save(ctx); err != nil {
		return nil, err
	}

	// Create projection from chronicle state
	var secretModel projections.Secret
	if err := secret.StateAll(&secretModel); err != nil {
		return nil, err
	}

	// Set metadata from chronicle
	secretModel.ID = string(secret.GetID())
	secretModel.CreatedAt = secret.CreatedAt()
	secretModel.UpdatedAt = secret.UpdatedAt()

	// Update projection (best effort)
	if err := s.db.Create(&secretModel).Error; err != nil {
		log.Printf("WARNING: Failed to update projection for secret %s: %v", secret.GetID(), err)
	}

	return &secretModel, nil
}

func (s *SecretService) UpdateSecret(ctx context.Context, id string, updates map[string]any) (*projections.Secret, error) {
	//TODO: add validation based on file system Struct

	// Load existing secret from chronicle
	secret, err := chronicle.LoadByStringID(ctx, s.repository, id, "secret")
	if err != nil {
		return nil, err
	}

	// Check if deleted
	if secret.IsDeleted() {
		return nil, fmt.Errorf("secret not found")
	}

	//TODO: add a encrypt method of the secret

	// Track changes in chronicle
	if err := secret.TrackChange("Updated", updates); err != nil {
		return nil, err
	}

	// Save changes to chronicle first (source of truth)
	if err := secret.Save(ctx); err != nil {
		return nil, err
	}

	// Update projection from chronicle state
	var secretModel projections.Secret
	if err := secret.StateAll(&secretModel); err != nil {
		return nil, err
	}

	// Set metadata from chronicle
	secretModel.ID = string(secret.GetID())
	secretModel.CreatedAt = secret.CreatedAt()
	secretModel.UpdatedAt = secret.UpdatedAt()

	// Update projection (best effort)
	if err := s.db.Save(&secretModel).Error; err != nil {
		log.Printf("WARNING: Failed to update projection for secret %s: %v", secret.GetID(), err)
	}

	return &secretModel, nil
}

func (s *SecretService) DeleteSecret(ctx context.Context, id string, reason string) (*projections.Secret, error) {
	// Load existing secret from chronicle
	secret, err := chronicle.LoadByStringID(ctx, s.repository, id, "secret")
	if err != nil {
		return nil, err
	}

	// Check if already deleted
	if secret.IsDeleted() {
		return nil, fmt.Errorf("secret not found")
	}

	// Get current state before deletion
	var secretModel projections.Secret
	if err := secret.StateAll(&secretModel); err != nil {
		return nil, err
	}
	secretModel.ID = string(secret.GetID())
	secretModel.CreatedAt = secret.CreatedAt()
	secretModel.UpdatedAt = secret.UpdatedAt()

	// Track deletion in chronicle first (source of truth)
	if err := secret.TrackDelete(reason); err != nil {
		return nil, err
	}

	// Save deletion event to chronicle
	if err := secret.Save(ctx); err != nil {
		return nil, err
	}

	// Delete projection (best effort)
	if err := s.db.Delete(&projections.Secret{}, "id = ?", id).Error; err != nil {
		log.Printf("WARNING: Failed to delete projection for secret %s: %v", id, err)
	}

	return &secretModel, nil
}

func (s *SecretService) ListSecrets(ctx context.Context) ([]*projections.Secret, error) {
	// Read from projection table for fast queries
	var secrets []*projections.Secret
	if err := s.db.Find(&secrets).Error; err != nil {
		return nil, err
	}

	return secrets, nil
}
