package preset

import (
	"context"
	"time"

	"github.com/heysnelling/computesdk/pkg/api/database"
	"gorm.io/gorm"
)

type PresetSummary struct {
	ID          string         `json:"id" gorm:"primaryKey;type:varchar(255)"`
	Name        string         `json:"name" gorm:"type:varchar(100);not null"`
	Description string         `json:"description" gorm:"type:text"`
	Config      map[string]any `json:"config" gorm:"type:jsonb"`
	CreatedBy   string         `json:"created_by" gorm:"type:varchar(255);index"`
	IsPublic    bool           `json:"is_public" gorm:"index"`
	Status      string         `json:"status" gorm:"type:varchar(50);not null;index"`
	CreatedAt   time.Time      `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt   time.Time      `json:"updated_at" gorm:"autoUpdateTime"`
	DeletedAt   *time.Time     `json:"deleted_at,omitempty" gorm:"index"`
}

func init() {
	database.RegisterMigrations(func(db *gorm.DB) error {
		return database.AutoMigrateModels(db, &PresetSummary{})
	})
}

// TableName specifies the table name for GORM
func (PresetSummary) TableName() string {
	return "preset_summaries"
}

// SummaryRepository handles projection queries and updates
type SummaryRepository struct {
	db *gorm.DB
}

// NewSummaryRepository creates a new projection repository
func NewSummaryRepository(db *gorm.DB) *SummaryRepository {
	return &SummaryRepository{db: db}
}

// Create inserts a new preset summary
func (r *SummaryRepository) Create(ctx context.Context, summary *PresetSummary) (*PresetSummary, error) {
	if err := r.db.WithContext(ctx).Create(summary).Error; err != nil {
		return nil, err
	}
	return summary, nil
}

// Update updates an existing preset summary
func (r *SummaryRepository) Update(ctx context.Context, summary *PresetSummary) (*PresetSummary, error) {
	if err := r.db.WithContext(ctx).Save(summary).Error; err != nil {
		return nil, err
	}
	return summary, nil
}

// Get retrieves a preset by ID
func (r *SummaryRepository) Get(ctx context.Context, presetID string) (*PresetSummary, error) {
	presetSummary := PresetSummary{ID: presetID}
	if err := r.db.WithContext(ctx).First(&presetSummary).Error; err != nil {
		return nil, err
	}
	return &presetSummary, nil
}

// List retrieves presets with optional filters
func (r *SummaryRepository) List(ctx context.Context, createdBy *string, isPublic *bool, status *string, limit, offset int) ([]PresetSummary, error) {
	var summaries []PresetSummary
	query := r.db.WithContext(ctx).Order("created_at desc")

	if createdBy != nil {
		query = query.Where("created_by = ?", *createdBy)
	}

	if isPublic != nil {
		query = query.Where("is_public = ?", *isPublic)
	}

	if status != nil {
		query = query.Where("status = ?", *status)
	}

	if err := query.Limit(limit).Offset(offset).Find(&summaries).Error; err != nil {
		return nil, err
	}
	return summaries, nil
}

// ListAccessible returns presets that are either created by the user or public
func (r *SummaryRepository) ListAccessible(ctx context.Context, userID string, limit, offset int) ([]PresetSummary, error) {
	var summaries []PresetSummary

	query := r.db.WithContext(ctx).
		Where("(created_by = ? OR is_public = ?)", userID, true).
		Where("status = ?", "active").
		Order("created_at desc")

	if err := query.Limit(limit).Offset(offset).Find(&summaries).Error; err != nil {
		return nil, err
	}
	return summaries, nil
}
