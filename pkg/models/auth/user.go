package auth

import (
	"time"

	"gorm.io/gorm"
)

type User struct {
	ID           uint           `gorm:"primarykey" json:"id"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
	DeletedAt    gorm.DeletedAt `gorm:"index" json:"deleted_at,omitempty"`
	Email        string         `gorm:"uniqueIndex;not null" json:"email"`
	PasswordHash string         `gorm:"not null" json:"-"`
	FirstName    string         `json:"first_name"`
	LastName     string         `json:"last_name"`
	IsActive     bool           `gorm:"default:true" json:"is_active"`
	Organizations []OrganizationMember `gorm:"foreignKey:UserID" json:"organizations,omitempty"`
}

type Organization struct {
	ID          uint           `gorm:"primarykey" json:"id"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"deleted_at,omitempty"`
	Name        string         `gorm:"uniqueIndex;not null" json:"name"`
	DisplayName string         `json:"display_name"`
	IsActive    bool           `gorm:"default:true" json:"is_active"`
	Members     []OrganizationMember `gorm:"foreignKey:OrganizationID" json:"members,omitempty"`
	APIKeys     []APIKey       `gorm:"foreignKey:OrganizationID" json:"api_keys,omitempty"`
}

type OrganizationMember struct {
	ID             uint      `gorm:"primarykey" json:"id"`
	CreatedAt      time.Time `json:"created_at"`
	UserID         uint      `gorm:"not null" json:"user_id"`
	OrganizationID uint      `gorm:"not null" json:"organization_id"`
	Role           string    `gorm:"not null;default:'member'" json:"role"`
	User           User         `gorm:"foreignKey:UserID" json:"user,omitempty"`
	Organization   Organization `gorm:"foreignKey:OrganizationID" json:"organization,omitempty"`
}

type APIKey struct {
	ID             uint           `gorm:"primarykey" json:"id"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"deleted_at,omitempty"`
	Name           string         `gorm:"not null" json:"name"`
	KeyHash        string         `gorm:"uniqueIndex;not null" json:"-"`
	KeyPrefix      string         `gorm:"not null" json:"key_prefix"`
	OrganizationID uint           `gorm:"not null" json:"organization_id"`
	Scopes         string         `json:"scopes"`
	ExpiresAt      *time.Time     `json:"expires_at,omitempty"`
	LastUsedAt     *time.Time     `json:"last_used_at,omitempty"`
	Organization   Organization   `gorm:"foreignKey:OrganizationID" json:"organization,omitempty"`
}

type ClaimableSession struct {
	ID             uint                  `gorm:"primarykey" json:"id"`
	CreatedAt      time.Time             `json:"created_at"`
	UpdatedAt      time.Time             `json:"updated_at"`
	SessionToken   string                `gorm:"uniqueIndex;not null" json:"session_token"`
	OrganizationID uint                  `gorm:"not null" json:"organization_id"`
	Email          string                `gorm:"index" json:"email,omitempty"`
	UserID         *uint                 `gorm:"index" json:"user_id,omitempty"`
	Metadata       string                `gorm:"type:jsonb" json:"metadata"`
	ExpiresAt      time.Time             `gorm:"not null" json:"expires_at"`
	ClaimedAt      *time.Time            `json:"claimed_at,omitempty"`
	Organization   Organization          `gorm:"foreignKey:OrganizationID" json:"organization,omitempty"`
	User           *User                 `gorm:"foreignKey:UserID" json:"user,omitempty"`
	Resources      []ClaimableResource   `gorm:"foreignKey:SessionID" json:"resources,omitempty"`
}

type ClaimableResource struct {
	ID           uint             `gorm:"primarykey" json:"id"`
	CreatedAt    time.Time        `json:"created_at"`
	SessionID    uint             `gorm:"not null;index" json:"session_id"`
	ResourceType string           `gorm:"not null" json:"resource_type"` // "Compute", "Filesystem", etc.
	ResourceID   string           `gorm:"not null" json:"resource_id"`   // "compute_123", "fs_abc", etc.
	Permissions  string           `gorm:"type:jsonb" json:"permissions"` // JSON array of permissions
	Session      ClaimableSession `gorm:"foreignKey:SessionID" json:"session,omitempty"`
}