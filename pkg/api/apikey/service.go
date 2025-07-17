package apikey

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/heysnelling/computesdk/pkg/api/events"
	"github.com/heysnelling/computesdk/pkg/common"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type APIKeyService struct {
	eventStore  events.EventStore
	summaryRepo *SummaryRepository
}

func NewService(db *gorm.DB) *APIKeyService {
	return &APIKeyService{
		eventStore:  events.NewGormEventStore(db),
		summaryRepo: NewSummaryRepository(db),
	}
}

func (s *APIKeyService) CreateAPIKey(ctx context.Context, req *CreateAPIKeyRequest) (*APIKeySummary, error) {
	apiKeyID := common.GeneratePrefixedID("key_")

	// Generate the actual API key
	fullAPIKey, err := generateAPIKey()
	if err != nil {
		return nil, fmt.Errorf("failed to generate API key: %w", err)
	}

	// Hash the key for storage
	keyHash, err := hashAPIKey(fullAPIKey)
	if err != nil {
		return nil, fmt.Errorf("failed to hash API key: %w", err)
	}

	// Extract prefix for display
	keyPrefix := extractKeyPrefix(fullAPIKey)

	// Set default permissions if none provided
	permissions := req.Permissions
	if len(permissions) == 0 {
		permissions = []string{"compute:create", "compute:manage"}
	}

	// Set default metadata if none provided
	metadata := req.Metadata
	if metadata == nil {
		metadata = make(map[string]string)
	}

	// Calculate expiration if provided
	var expiresAt *time.Time
	if req.ExpiresIn != nil {
		expiry := time.Now().Add(time.Duration(*req.ExpiresIn) * time.Second)
		expiresAt = &expiry
	}

	// 1. Create event for audit trail
	event := APIKeyCreated{
		APIKeyID:    apiKeyID,
		Name:        req.Name,
		KeyHash:     keyHash,
		KeyPrefix:   keyPrefix,
		Permissions: permissions,
		Metadata:    metadata,
		CreatedAt:   time.Now(),
	}

	err = s.eventStore.Append(ctx, apiKeyID, event)
	if err != nil {
		return nil, fmt.Errorf("failed to store API key created event: %w", err)
	}

	// 2. Build aggregate and create summary
	aggregate, err := s.GetAggregateAPIKey(ctx, apiKeyID)
	if err != nil {
		return nil, fmt.Errorf("failed to get API key aggregate: %w", err)
	}

	summary := aggregate.ToSummary()
	summary.FullKey = fullAPIKey // Only returned on creation

	// Set expiration in summary if provided
	if expiresAt != nil {
		// We need to update the summary to include expiration
		// For now, we'll handle this in the summary directly
		summary.UpdatedAt = time.Now()
	}

	return s.summaryRepo.Create(ctx, summary)
}

func (s *APIKeyService) ValidateAPIKey(ctx context.Context, apiKey string) (*APIKeySummary, error) {
	// Create SHA256 hash for comparison
	hash := sha256.Sum256([]byte(apiKey))

	// Get all active API keys and check each one
	summaries, err := s.summaryRepo.List(ctx, stringPtr("active"), 1000, 0)
	if err != nil {
		return nil, fmt.Errorf("failed to query API keys: %w", err)
	}

	for _, summary := range summaries {
		// Compare the bcrypt hash with our key
		if err := bcrypt.CompareHashAndPassword([]byte(summary.KeyHash), hash[:]); err == nil {
			// Found matching key
			// Update last used timestamp (async to avoid blocking)
			go func() {
				s.updateLastUsed(context.Background(), summary.ID)
			}()

			return &summary, nil
		}
	}

	return nil, fmt.Errorf("invalid API key")
}

func (s *APIKeyService) RevokeAPIKey(ctx context.Context, apiKeyID string, req *RevokeAPIKeyRequest) (*APIKeySummary, error) {
	// Check if API key exists and is active
	summary, err := s.summaryRepo.Get(ctx, apiKeyID)
	if err != nil {
		return nil, fmt.Errorf("API key not found: %w", err)
	}

	if summary.Status != "active" {
		return nil, fmt.Errorf("API key %s is not active (status: %s)", apiKeyID, summary.Status)
	}

	// Create revocation event
	event := APIKeyRevoked{
		APIKeyID:  apiKeyID,
		Reason:    req.Reason,
		RevokedAt: time.Now(),
	}

	err = s.eventStore.Append(ctx, apiKeyID, event)
	if err != nil {
		return nil, fmt.Errorf("failed to store API key revoked event: %w", err)
	}

	// Update aggregate and summary
	aggregate, err := s.GetAggregateAPIKey(ctx, apiKeyID)
	if err != nil {
		return nil, fmt.Errorf("failed to get API key aggregate: %w", err)
	}

	summary = aggregate.ToSummary()
	return s.summaryRepo.Update(ctx, summary)
}

func (s *APIKeyService) GetAPIKey(ctx context.Context, apiKeyID string) (*APIKeySummary, error) {
	return s.summaryRepo.Get(ctx, apiKeyID)
}

func (s *APIKeyService) ListAPIKeys(ctx context.Context, status *string, limit, offset int) ([]APIKeySummary, error) {
	return s.summaryRepo.List(ctx, status, limit, offset)
}

func (s *APIKeyService) GetAggregateAPIKey(ctx context.Context, apiKeyID string) (*APIKeyAggregate, error) {
	events, err := s.eventStore.GetEvents(ctx, apiKeyID)
	if err != nil {
		return nil, err
	}

	if len(events) == 0 {
		return nil, fmt.Errorf("API key not found: %s", apiKeyID)
	}

	apiKeyAggregate := &APIKeyAggregate{}

	if err := apiKeyAggregate.Apply(events); err != nil {
		return nil, err
	}

	return apiKeyAggregate, nil
}

func (s *APIKeyService) updateLastUsed(ctx context.Context, apiKeyID string) {
	// Create usage event
	event := APIKeyUsed{
		APIKeyID: apiKeyID,
		UsedAt:   time.Now(),
	}

	// Store event (ignore errors for usage tracking)
	s.eventStore.Append(ctx, apiKeyID, event)

	// Update summary last used timestamp
	s.summaryRepo.UpdateLastUsed(ctx, apiKeyID, event.UsedAt)
}

// generateAPIKey creates a new API key with the format: csk_live_<32_hex_chars>
func generateAPIKey() (string, error) {
	// Generate 16 random bytes (32 hex characters)
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}

	// Format as API key
	return fmt.Sprintf("csk_live_%s", hex.EncodeToString(bytes)), nil
}

// hashAPIKey creates a bcrypt hash of the API key for secure storage
func hashAPIKey(apiKey string) (string, error) {
	// Use SHA256 first to ensure consistent length for bcrypt
	hash := sha256.Sum256([]byte(apiKey))

	// Then bcrypt the hash
	bcryptHash, err := bcrypt.GenerateFromPassword(hash[:], bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}

	return string(bcryptHash), nil
}

// extractKeyPrefix extracts the display prefix from an API key (first 16 chars + ...)
func extractKeyPrefix(apiKey string) string {
	if len(apiKey) <= 16 {
		return apiKey
	}
	return apiKey[:16] + "..."
}

// stringPtr returns a pointer to a string
func stringPtr(s string) *string {
	return &s
}
