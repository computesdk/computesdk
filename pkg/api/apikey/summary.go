package apikey

import (
	"context"
	"time"

	"github.com/heysnelling/computesdk/pkg/api/database"
	"gorm.io/gorm"
)

type APIKeySummary struct {
	ID          string            `json:"id" gorm:"primaryKey;type:varchar(255)"`
	Name        string            `json:"name" gorm:"type:varchar(255)"`
	KeyHash     string            `json:"-" gorm:"type:varchar(255);uniqueIndex"` // Hidden from JSON
	KeyPrefix   string            `json:"key_prefix" gorm:"type:varchar(50)"`
	Permissions []string          `json:"permissions" gorm:"serializer:json"`
	Metadata    map[string]string `json:"metadata" gorm:"serializer:json"`
	Status      string            `json:"status" gorm:"type:varchar(50);not null"`
	CreatedAt   time.Time         `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt   time.Time         `json:"updated_at" gorm:"autoUpdateTime"`
	LastUsedAt  *time.Time        `json:"last_used_at,omitempty" gorm:"type:timestamp"`
	RevokedAt   *time.Time        `json:"revoked_at,omitempty" gorm:"type:timestamp"`
	FullKey     string            `json:"full_key,omitempty" gorm:"-"` // Only for creation response
}

func init() {
	database.RegisterMigrations(func(db *gorm.DB) error {
		return database.AutoMigrateModels(db, &APIKeySummary{})
	})
}

// TableName specifies the table name for GORM
func (APIKeySummary) TableName() string {
	return "api_key_summaries"
}

// SummaryRepository handles projection queries and updates
type SummaryRepository struct {
	db *gorm.DB
}

// NewSummaryRepository creates a new projection repository
func NewSummaryRepository(db *gorm.DB) *SummaryRepository {
	return &SummaryRepository{db: db}
}

// Create inserts a new API key summary
func (r *SummaryRepository) Create(ctx context.Context, summary *APIKeySummary) (*APIKeySummary, error) {
	if err := r.db.WithContext(ctx).Create(summary).Error; err != nil {
		return nil, err
	}

	return summary, nil
}

// Update updates an existing API key summary
func (r *SummaryRepository) Update(ctx context.Context, summary *APIKeySummary) (*APIKeySummary, error) {
	if err := r.db.WithContext(ctx).Save(summary).Error; err != nil {
		return nil, err
	}

	return summary, nil
}

func (r *SummaryRepository) Get(ctx context.Context, apiKeyID string) (*APIKeySummary, error) {
	apiKeySummary := APIKeySummary{ID: apiKeyID}

	if err := r.db.WithContext(ctx).First(&apiKeySummary).Error; err != nil {
		return nil, err
	}

	return &apiKeySummary, nil
}

func (r *SummaryRepository) GetByHash(ctx context.Context, keyHash string) (*APIKeySummary, error) {
	var summary APIKeySummary
	if err := r.db.WithContext(ctx).Where("key_hash = ? AND status = ?", keyHash, "active").First(&summary).Error; err != nil {
		return nil, err
	}
	return &summary, nil
}

func (r *SummaryRepository) List(ctx context.Context, status *string, limit, offset int) ([]APIKeySummary, error) {
	var summaries []APIKeySummary
	query := r.db.WithContext(ctx).Order("created_at desc")

	if status != nil {
		query = query.Where(APIKeySummary{Status: *status})
	}

	if err := query.Limit(limit).Offset(offset).Find(&summaries).Error; err != nil {
		return nil, err
	}

	return summaries, nil
}

func (r *SummaryRepository) UpdateLastUsed(ctx context.Context, apiKeyID string, lastUsedAt time.Time) error {
	return r.db.WithContext(ctx).Model(&APIKeySummary{}).
		Where("id = ?", apiKeyID).
		Update("last_used_at", lastUsedAt).Error
}
