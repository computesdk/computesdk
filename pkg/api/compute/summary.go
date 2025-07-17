package compute

import (
	"context"
	"time"

	"github.com/heysnelling/computesdk/pkg/api/database"
	"gorm.io/gorm"
)

type ComputeSummary struct {
	ID         string     `json:"id" gorm:"primaryKey;type:varchar(255)"`
	APIKeyID   string     `json:"api_key_id" gorm:"index;type:varchar(255);not null"`
	Status     string     `json:"status" gorm:"type:varchar(50);not null"`
	IPAddress  string     `json:"ip_address,omitempty" gorm:"type:varchar(255)"`
	PodName    string     `json:"pod_name,omitempty" gorm:"type:varchar(255)"`
	PodURL     string     `json:"pod_url,omitempty" gorm:"type:varchar(255)"`
	CreatedAt  time.Time  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt  time.Time  `json:"updated_at" gorm:"autoUpdateTime"`
	StartedAt  *time.Time `json:"started_at,omitempty" gorm:"type:timestamp"`
	LastActive *time.Time `json:"last_active,omitempty" gorm:"type:timestamp"`
}

func init() {
	database.RegisterMigrations(func(db *gorm.DB) error {
		return database.AutoMigrateModels(db, &ComputeSummary{})
	})
}

// TableName specifies the table name for GORM
func (ComputeSummary) TableName() string {
	return "compute_summaries"
}

// SummaryRepository handles projection queries and updates
type SummaryRepository struct {
	db *gorm.DB
}

// NewSummaryRepository creates a new projection repository
func NewSummaryRepository(db *gorm.DB) *SummaryRepository {
	return &SummaryRepository{db: db}
}

// Create inserts a new compute summary
func (r *SummaryRepository) Create(ctx context.Context, summary *ComputeSummary) (*ComputeSummary, error) {
	if err := r.db.WithContext(ctx).Create(summary).Error; err != nil {
		return nil, err
	}

	return summary, nil
}

// Update updates an existing compute summary
func (r *SummaryRepository) Update(ctx context.Context, summary *ComputeSummary) (*ComputeSummary, error) {
	if err := r.db.WithContext(ctx).Save(summary).Error; err != nil {
		return nil, err
	}

	return summary, nil
}

func (r *SummaryRepository) Get(ctx context.Context, computeID string) (*ComputeSummary, error) {
	computeSummary := ComputeSummary{ID: computeID}

	if err := r.db.WithContext(ctx).First(&computeSummary).Error; err != nil {
		return nil, err
	}

	return &computeSummary, nil
}

func (r *SummaryRepository) ListByAPIKey(ctx context.Context, apiKeyID string, limit, offset int) ([]ComputeSummary, error) {
	var summaries []ComputeSummary
	query := r.db.WithContext(ctx).Order("created_at desc")

	query = query.Where(ComputeSummary{APIKeyID: apiKeyID})

	if err := query.Limit(limit).Offset(offset).Find(&summaries).Error; err != nil {
		return nil, err
	}

	return summaries, nil
}
