package projections

import (
	"time"

	"github.com/go-playground/validator/v10"
	"github.com/heysnelling/computesdk/pkg/database"
	"gorm.io/gorm"
)

// Compute represents a compute unit instance projection
type Compute struct {
	ID          string     `json:"id" gorm:"primaryKey;type:varchar(255)" validate:"required,uuid"`
	Status      string     `json:"status" gorm:"type:varchar(50);not null" validate:"required,oneof=initializing provisioning running terminated"`
	Environment string     `json:"environment" gorm:"type:varchar(50);not null" validate:"required,oneof=production staging development"`
	IPAddress   string     `json:"ip_address,omitempty" gorm:"type:varchar(255)" validate:"omitempty,ip"`
	PodName     string     `json:"pod_name,omitempty" gorm:"type:varchar(255)" validate:"omitempty,max=255"`
	PodURL      string     `json:"pod_url,omitempty" gorm:"type:varchar(255)" validate:"omitempty,url,max=255"`
	CreatedAt   time.Time  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt   time.Time  `json:"updated_at" gorm:"autoUpdateTime"`
	StartedAt   *time.Time `json:"started_at,omitempty" gorm:"type:timestamp"`
	LastActive  *time.Time `json:"last_active,omitempty" gorm:"type:timestamp"`
}

var validate = validator.New()

// BeforeCreate hook for validation
func (c *Compute) BeforeCreate(tx *gorm.DB) error {
	return validate.Struct(c)
}

// BeforeUpdate hook for validation
func (c *Compute) BeforeUpdate(tx *gorm.DB) error {
	return validate.Struct(c)
}

func init() {
	database.RegisterMigrations(func(db *gorm.DB) error {
		return database.AutoMigrateModels(db, &Compute{})
	})
}
