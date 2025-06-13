package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// DataServicesConfig holds the configuration for connecting to various data services.
type DataServicesConfig struct {
	// Database configuration - supports both MySQL and PostgreSQL
	DatabaseType string // "mysql" or "postgres"

	// MySQL config (legacy)
	MySQLHost     string
	MySQLPort     int
	MySQLUser     string
	MySQLPassword string
	MySQLDatabase string

	// PostgreSQL config
	PostgresHost     string
	PostgresPort     int
	PostgresUser     string
	PostgresPassword string
	PostgresDatabase string

	// S3 (SeaweedFS)
	S3Endpoint        string
	S3AccessKeyID     string
	S3SecretAccessKey string
	S3UsePathStyle    bool
}

// LoadDataServicesConfigFromEnv loads the data service configurations from environment variables.
func LoadDataServicesConfigFromEnv() (*DataServicesConfig, error) {
	cfg := &DataServicesConfig{}
	var err error

	// Determine database type
	cfg.DatabaseType = os.Getenv("DATABASE_TYPE")
	if cfg.DatabaseType == "" {
		// Default to MySQL for backward compatibility
		cfg.DatabaseType = "mysql"
	}

	// Load database config based on type
	if cfg.DatabaseType == "postgres" {
		// PostgreSQL configuration
		cfg.PostgresHost = os.Getenv("POSTGRES_HOST")
		if cfg.PostgresHost == "" {
			return nil, fmt.Errorf("POSTGRES_HOST environment variable not set or empty")
		}

		postgresPortStr := os.Getenv("POSTGRES_PORT")
		if postgresPortStr == "" {
			postgresPortStr = "5432" // Default PostgreSQL port
		}
		cfg.PostgresPort, err = strconv.Atoi(postgresPortStr)
		if err != nil {
			return nil, fmt.Errorf("invalid POSTGRES_PORT environment variable '%s': %w", postgresPortStr, err)
		}

		cfg.PostgresUser = os.Getenv("POSTGRES_USER")
		if cfg.PostgresUser == "" {
			return nil, fmt.Errorf("POSTGRES_USER environment variable not set or empty")
		}

		cfg.PostgresPassword = os.Getenv("POSTGRES_PASSWORD")
		// Password can be empty, though not recommended

		cfg.PostgresDatabase = os.Getenv("POSTGRES_DATABASE")
		if cfg.PostgresDatabase == "" {
			return nil, fmt.Errorf("POSTGRES_DATABASE environment variable not set or empty")
		}
	} else {
		// MySQL (legacy) configuration
		cfg.MySQLHost = os.Getenv("MYSQL_HOST")
		if cfg.MySQLHost == "" {
			return nil, fmt.Errorf("MYSQL_HOST environment variable not set or empty")
		}

		mysqlPortStr := os.Getenv("MYSQL_PORT")
		if mysqlPortStr == "" {
			mysqlPortStr = "3306" // Default MySQL port
		}
		cfg.MySQLPort, err = strconv.Atoi(mysqlPortStr)
		if err != nil {
			return nil, fmt.Errorf("invalid MYSQL_PORT environment variable '%s': %w", mysqlPortStr, err)
		}

		cfg.MySQLUser = os.Getenv("MYSQL_USER")
		cfg.MySQLPassword = os.Getenv("MYSQL_PASSWORD")
		cfg.MySQLDatabase = os.Getenv("MYSQL_DATABASE")
		if cfg.MySQLDatabase == "" {
			return nil, fmt.Errorf("MYSQL_DATABASE environment variable not set or empty")
		}
	}

	// S3 (SeaweedFS)
	cfg.S3Endpoint = os.Getenv("S3_ENDPOINT")
	if cfg.S3Endpoint == "" {
		return nil, fmt.Errorf("S3_ENDPOINT environment variable not set or empty")
	}
	cfg.S3AccessKeyID = os.Getenv("S3_ACCESS_KEY_ID")
	cfg.S3SecretAccessKey = os.Getenv("S3_SECRET_ACCESS_KEY")
	cfg.S3UsePathStyle = strings.ToLower(os.Getenv("S3_USE_PATH_STYLE")) == "true"

	return cfg, nil
}
