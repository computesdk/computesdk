package database

import (
	"fmt"
	"log"

	"gorm.io/gorm"
)

// MigrationFunc is a function that registers models for migration
type MigrationFunc func(*gorm.DB) error

// migrationRegistry holds all registered migration functions
var migrationRegistry []MigrationFunc

// RegisterMigrations registers a migration function to be run
func RegisterMigrations(fn MigrationFunc) {
	migrationRegistry = append(migrationRegistry, fn)
}

// RunMigrations executes all registered migrations
func RunMigrations(db *gorm.DB) error {
	log.Println("Starting database migrations...")
	
	for i, migrationFunc := range migrationRegistry {
		if err := migrationFunc(db); err != nil {
			return fmt.Errorf("migration %d failed: %w", i+1, err)
		}
	}
	
	log.Printf("Successfully completed %d migrations", len(migrationRegistry))
	return nil
}

// AutoMigrateModels is a helper function for migrating models
func AutoMigrateModels(db *gorm.DB, models ...interface{}) error {
	if err := db.AutoMigrate(models...); err != nil {
		return fmt.Errorf("auto migration failed: %w", err)
	}
	return nil
}