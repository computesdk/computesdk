package config

import (
	"os"
	"strconv"
)

// Config holds the configuration for the gateway service
type Config struct {
	// Server configuration
	Port string

	// Kubernetes configuration
	Namespace      string
	KubeconfigPath string

	// WebSocket configuration
	ReadBufferSize  int
	WriteBufferSize int

	// Pod configuration
	PodDefaultPort int
}

// Load loads configuration from environment variables with defaults
func Load() *Config {
	config := &Config{
		Port:            getEnvOrDefault("PORT", "8080"),
		Namespace:       getEnvOrDefault("COMPUTE_NAMESPACE", "computesdk-workloads"),
		KubeconfigPath:  getEnvOrDefault("KUBECONFIG", ""),
		ReadBufferSize:  getEnvAsIntOrDefault("WS_READ_BUFFER_SIZE", 1024),
		WriteBufferSize: getEnvAsIntOrDefault("WS_WRITE_BUFFER_SIZE", 1024),
		PodDefaultPort:  getEnvAsIntOrDefault("POD_DEFAULT_PORT", 8080),
	}

	return config
}

// Helper functions for environment variables
func getEnvOrDefault(key, defaultValue string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return defaultValue
}

func getEnvAsIntOrDefault(key string, defaultValue int) int {
	if value, exists := os.LookupEnv(key); exists {
		if intValue, err := strconv.Atoi(value); err == nil {
			return intValue
		}
	}
	return defaultValue
}
