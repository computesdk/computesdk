# Model

```go
package models

import (
	"encoding/json" // For FileManifest if unmarshalled, and ResourceEvent
	"fmt"
	"path"    // For joining S3 key components
	"strings" // For string manipulation
	"time"

	gonanoid "github.com/jaevor/go-nanoid"
	"gorm.io/gorm"
)

// BaseModelWithPublicID provides a standard GORM model (uint ID, Timestamps, SoftDelete)
// and an additional unique, prefixed PublicID (string) for external use.
type BaseModelWithPublicID struct {
	ID        uint           `gorm:"primaryKey"`
	PublicID  string         `gorm:"uniqueIndex;not null;size:50"` // Prefixed NanoID, e.g., fs_xxxx
	CreatedAt time.Time
	UpdatedAt time.Time
	DeletedAt gorm.DeletedAt `gorm:"index"`
}

// --- User (for auditing) ---
type User struct {
	BaseModelWithPublicID
	Username string `gorm:"uniqueIndex"`
}

func (u *User) BeforeCreate(tx *gorm.DB) (err error) {
	if u.PublicID == "" {
		nanoId, errGen := gonanoid.New()
		if errGen != nil {
			return errGen
		}
		u.PublicID = "usr_" + nanoId
	}
	return
}

// --- Filesystem ---
// Represents a collection of files that can be made available to a compute instance.
// It's structured as a single archive file (e.g., tar.gz) stored in S3, with an accompanying JSON manifest
// describing the contents of that archive for browsing/inspection without downloading the full archive.
type Filesystem struct {
	BaseModelWithPublicID
	Name                 string `gorm:"uniqueIndex;not null"`
	Description          string
	S3ArchiveBucket      string `gorm:";not null"`              // S3 Bucket where the filesystem archive is stored.
	S3ArchiveKey         string `gorm:";not null"`              // S3 Key for the filesystem archive (e.g., "path/to/filesystem.tar.gz").
	ArchiveChecksum      string `gorm:"size:128"`             // Checksum of the archive (e.g., "sha256:abcdef123...") for integrity.
	ArchiveType          string `gorm:"default:'tar.gz';size:20"` // Type of the archive, e.g., "tar.gz", "zip".
	UncompressedSizeMB   int    `gorm:"comment:Approximate uncompressed size in Megabytes"`
	FileManifestJSON     string `gorm:"type:json"`            // JSON string detailing the directory structure and files within the archive.
}

func (fs *Filesystem) BeforeCreate(tx *gorm.DB) (err error) {
	if fs.PublicID == "" {
		nanoId, errGen := gonanoid.New()
		if errGen != nil {
			return errGen
		}
		fs.PublicID = "fs_" + nanoId
	}
	// Consider adding validation for S3ArchiveBucket, S3ArchiveKey, ArchiveType here.
	// FileManifestJSON might be populated by a separate process after archive inspection.
	return
}

// --- Secret ---
type Secret struct {
	BaseModelWithPublicID
	Name          string `gorm:"uniqueIndex;not null"`
	Description   string
	WorkOSVaultID string `gorm:"uniqueIndex;not null"` // Assumes WorkOS Vault for secret storage
}

func (s *Secret) BeforeCreate(tx *gorm.DB) (err error) {
	if s.PublicID == "" {
		nanoId, errGen := gonanoid.New()
		if errGen != nil {
			return errGen
		}
		s.PublicID = "sec_" + nanoId
	}
	return
}

// --- Group ---
type Group struct {
	BaseModelWithPublicID
	Name                 string            `gorm:"uniqueIndex;not null"`
	Description          string
	ComputeInstances     []ComputeInstance `gorm:"foreignKey:GroupID"`
	AvailableFilesystems []*Filesystem     `gorm:"many2many:group_filesystems;"`
	AvailableSecrets     []*Secret         `gorm:"many2many:group_secrets;"`
}

func (g *Group) BeforeCreate(tx *gorm.DB) (err error) {
	if g.PublicID == "" {
		nanoId, errGen := gonanoid.New()
		if errGen != nil {
			return errGen
		}
		g.PublicID = "grp_" + nanoId
	}
	return
}

// --- ComputeInstance ---
type ComputeInstance struct {
	BaseModelWithPublicID
	Name         string `gorm:"not null"`
	Description  string
	ImageName    string
	Command      string
	Environment  string
	GroupID      uint // Foreign key to Group.ID (internal uint PK)
	Group        Group
	FilesystemID *uint // Foreign key to Filesystem.ID (internal uint PK, optional)
	Filesystem   *Filesystem
}

func (ci *ComputeInstance) BeforeCreate(tx *gorm.DB) (err error) {
	if ci.PublicID == "" {
		nanoId, errGen := gonanoid.New()
		if errGen != nil {
			return errGen
		}
		ci.PublicID = "ci_" + nanoId
	}
	return
}

// --- InstanceSecretMapping ---
// This table maps Secrets to ComputeInstances
type InstanceSecretMapping struct {
	BaseModelWithPublicID         // Provides ID uint (PK) and PublicID string (ism_xxxx)
	ComputeInstanceID uint   `gorm:"index;not null"` // Foreign key to ComputeInstance.ID (internal uint PK)
	SecretID          uint   `gorm:"index;not null"` // Foreign key to Secret.ID (internal uint PK)
	ExposeAsEnv       string `gorm:"comment:The environment variable name the secret will be exposed as"`

	// Optional: Define unique constraint on ComputeInstanceID and SecretID if needed
	// `gorm:"uniqueIndex:idx_instance_secret_internal_ids"` on both fields respectively.
}

func (ism *InstanceSecretMapping) BeforeCreate(tx *gorm.DB) (err error) {
	if ism.PublicID == "" {
		nanoId, errGen := gonanoid.New()
		if errGen != nil {
			return errGen
		}
		ism.PublicID = "ism_" + nanoId
	}
	return
}

// --- ResourceEvent (for Auditing) ---
type ResourceEvent struct {
	BaseModelWithPublicID        // Provides ID uint (PK) and PublicID string (rev_xxxx)
	Timestamp    time.Time `gorm:"index"`
	ActorID      *uint     `gorm:"index"`          // Foreign key to User.ID (internal uint PK, optional)
	Actor        *User
	ResourceType string    `gorm:"index"`
	ResourceID   string    `gorm:"index;size:50"` // PublicID of the affected resource (e.g., grp_xxxx, fs_yyyy)
	Action       string    `gorm:"index;not null"`
	Details      *string   `gorm:"type:json"`
	Reason       string
}

func (re *ResourceEvent) BeforeCreate(tx *gorm.DB) (err error) {
	if re.PublicID == "" {
		nanoId, errGen := gonanoid.New()
		if errGen != nil {
			return errGen
		}
		re.PublicID = "rev_" + nanoId
	}
	return
}

// Helper to set JSON details for ResourceEvent
func (re *ResourceEvent) SetDetails(data interface{}) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}
	detailsStr := string(jsonData)
	re.Details = &detailsStr
	return nil
}
```