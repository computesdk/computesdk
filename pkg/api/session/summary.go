package session

import (
	"context"
	"time"

	"github.com/heysnelling/computesdk/pkg/api/compute"
	"github.com/heysnelling/computesdk/pkg/api/database"
	"gorm.io/gorm"
)

type SessionSummary struct {
	ID           string         `json:"id" gorm:"primaryKey;type:varchar(255)"`
	Status       string         `json:"status" gorm:"type:varchar(50);not null"`
	Config       map[string]any `json:"config" gorm:"type:jsonb"`
	CreatedAt    time.Time      `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt    time.Time      `json:"updated_at" gorm:"autoUpdateTime"`
	ExpiresAt    *time.Time     `json:"expires_at,omitempty" gorm:"type:timestamp"`
	TerminatedAt *time.Time     `json:"terminated_at,omitempty" gorm:"type:timestamp"`
	ComputeCount int            `json:"compute_count" gorm:"default:0"`

	// Relationship
	Computes []compute.ComputeSummary `json:"computes,omitempty" gorm:"foreignKey:SessionID"`
}

func init() {
	database.RegisterMigrations(func(db *gorm.DB) error {
		return database.AutoMigrateModels(db, &SessionSummary{})
	})
}

// TableName specifies the table name for GORM
func (SessionSummary) TableName() string {
	return "session_summaries"
}

// SummaryRepository handles projection queries and updates
type SummaryRepository struct {
	db *gorm.DB
}

// NewSummaryRepository creates a new projection repository
func NewSummaryRepository(db *gorm.DB) *SummaryRepository {
	return &SummaryRepository{db: db}
}

// Create inserts a new session summary
func (r *SummaryRepository) Create(ctx context.Context, summary *SessionSummary) (*SessionSummary, error) {
	if err := r.db.WithContext(ctx).Create(summary).Error; err != nil {
		return nil, err
	}
	return summary, nil
}

// Update updates an existing session summary
func (r *SummaryRepository) Update(ctx context.Context, summary *SessionSummary) (*SessionSummary, error) {
	if err := r.db.WithContext(ctx).Save(summary).Error; err != nil {
		return nil, err
	}
	return summary, nil
}

func (r *SummaryRepository) Get(ctx context.Context, sessionID string) (*SessionSummary, error) {
	sessionSummary := SessionSummary{ID: sessionID}
	if err := r.db.WithContext(ctx).First(&sessionSummary).Error; err != nil {
		return nil, err
	}
	return &sessionSummary, nil
}

// GetWithComputes retrieves a session with its associated computes
func (r *SummaryRepository) GetWithComputes(ctx context.Context, sessionID string) (*SessionSummary, error) {
	var sessionSummary SessionSummary
	if err := r.db.WithContext(ctx).Preload("Computes").First(&sessionSummary, "id = ?", sessionID).Error; err != nil {
		return nil, err
	}
	return &sessionSummary, nil
}

func (r *SummaryRepository) List(ctx context.Context, status *string, limit, offset int) ([]SessionSummary, error) {
	var summaries []SessionSummary
	query := r.db.WithContext(ctx).Order("created_at desc")

	if status != nil {
		query = query.Where("status = ?", *status)
	}

	if err := query.Limit(limit).Offset(offset).Find(&summaries).Error; err != nil {
		return nil, err
	}
	return summaries, nil
}

// ListActive returns only active sessions that haven't expired
func (r *SummaryRepository) ListActive(ctx context.Context, limit, offset int) ([]SessionSummary, error) {
	var summaries []SessionSummary
	now := time.Now()

	query := r.db.WithContext(ctx).
		Where("status = ?", "active").
		Where("(expires_at IS NULL OR expires_at > ?)", now).
		Order("created_at desc")

	if err := query.Limit(limit).Offset(offset).Find(&summaries).Error; err != nil {
		return nil, err
	}
	return summaries, nil
}
