package database

import (
	"fmt"
	"log"
	"os"

	"github.com/lib/pq"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var DB *gorm.DB

// Config holds database configuration
type Config struct {
	Host     string
	Port     string
	User     string
	Password string
	Database string
	Schema   string
}

// GetConfigFromEnv reads database configuration from environment variables
func GetConfigFromEnv() Config {
	return Config{
		Host:     os.Getenv("POSTGRES_HOST"),
		Port:     os.Getenv("POSTGRES_PORT"),
		User:     os.Getenv("POSTGRES_USER"),
		Password: os.Getenv("POSTGRES_PASSWORD"),
		Database: os.Getenv("POSTGRES_DATABASE"),
		Schema:   getSchemaNameFromEnv(),
	}
}

// getSchemaNameFromEnv returns the schema name based on the service
func getSchemaNameFromEnv() string {
	// Allow override via environment variable
	if schema := os.Getenv("POSTGRES_SCHEMA"); schema != "" {
		return schema
	}
	// Default to API schema
	return "computesdk_api"
}

// Initialize creates a new database connection
func Initialize(config Config) (*gorm.DB, error) {
	dsn := fmt.Sprintf("host=%s user=%s password=%s dbname=%s port=%s sslmode=disable TimeZone=UTC search_path=%s,public",
		config.Host,
		config.User,
		config.Password,
		config.Database,
		config.Port,
		pq.QuoteIdentifier(config.Schema),
	)

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		// Consider adding logger.Default.LogMode(logger.Info) for more GORM logs during dev
	})
	if err != nil {
		log.Printf("ERROR: Failed to connect to PostgreSQL database: %v", err)
		return nil, fmt.Errorf("failed to connect to PostgreSQL database: %w", err)
	}

	// Create the dedicated schema if it doesn't exist
	createSchemaSQL := fmt.Sprintf("CREATE SCHEMA IF NOT EXISTS %s", pq.QuoteIdentifier(config.Schema))
	if err := db.Exec(createSchemaSQL).Error; err != nil {
		log.Printf("ERROR: Failed to create schema '%s': %v", config.Schema, err)
		return nil, fmt.Errorf("failed to create schema %s: %w", config.Schema, err)
	}
	log.Printf("Successfully ensured schema '%s' exists and search_path is set for the connection.", config.Schema)

	DB = db
	log.Println("Successfully connected to the database.")
	return db, nil
}

// GetDB returns the current database connection
func GetDB() *gorm.DB {
	return DB
}