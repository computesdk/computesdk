package chronicle

import (
	"github.com/heysnelling/computesdk/pkg/database"
	"gorm.io/gorm"
)

func MigrateModels(db *gorm.DB) error {
	return db.AutoMigrate(&EventRecord{})
}

// init registers chronicle models for migration
func init() {
	database.RegisterMigrations(MigrateModels)
}