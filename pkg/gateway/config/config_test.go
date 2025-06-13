package config

import (
	"os"
	"testing"
)

func TestLoadDefaultConfig(t *testing.T) {
	// Clear any existing environment variables that might affect the test
	os.Unsetenv("PORT")
	os.Unsetenv("COMPUTE_NAMESPACE")
	os.Unsetenv("KUBECONFIG")
	os.Unsetenv("WS_READ_BUFFER_SIZE")
	os.Unsetenv("WS_WRITE_BUFFER_SIZE")
	os.Unsetenv("POD_DEFAULT_PORT")

	// Load the config with default values
	config := Load()

	// Check default values
	if config.Port != "8080" {
		t.Errorf("Expected default PORT to be '8080', got '%s'", config.Port)
	}
	if config.Namespace != "computesdk-workloads" {
		t.Errorf("Expected default COMPUTE_NAMESPACE to be 'computesdk-workloads', got '%s'", config.Namespace)
	}
	if config.KubeconfigPath != "" {
		t.Errorf("Expected default KUBECONFIG to be empty, got '%s'", config.KubeconfigPath)
	}
	if config.ReadBufferSize != 1024 {
		t.Errorf("Expected default WS_READ_BUFFER_SIZE to be 1024, got %d", config.ReadBufferSize)
	}
	if config.WriteBufferSize != 1024 {
		t.Errorf("Expected default WS_WRITE_BUFFER_SIZE to be 1024, got %d", config.WriteBufferSize)
	}
	if config.PodDefaultPort != 8080 {
		t.Errorf("Expected default POD_DEFAULT_PORT to be 8080, got %d", config.PodDefaultPort)
	}
}

func TestLoadCustomConfig(t *testing.T) {
	// Set custom environment variables
	os.Setenv("PORT", "9090")
	os.Setenv("COMPUTE_NAMESPACE", "custom-namespace")
	os.Setenv("KUBECONFIG", "/path/to/kubeconfig")
	os.Setenv("WS_READ_BUFFER_SIZE", "2048")
	os.Setenv("WS_WRITE_BUFFER_SIZE", "4096")
	os.Setenv("POD_DEFAULT_PORT", "3000")

	// Load the config with custom values
	config := Load()

	// Check custom values
	if config.Port != "9090" {
		t.Errorf("Expected PORT to be '9090', got '%s'", config.Port)
	}
	if config.Namespace != "custom-namespace" {
		t.Errorf("Expected COMPUTE_NAMESPACE to be 'custom-namespace', got '%s'", config.Namespace)
	}
	if config.KubeconfigPath != "/path/to/kubeconfig" {
		t.Errorf("Expected KUBECONFIG to be '/path/to/kubeconfig', got '%s'", config.KubeconfigPath)
	}
	if config.ReadBufferSize != 2048 {
		t.Errorf("Expected WS_READ_BUFFER_SIZE to be 2048, got %d", config.ReadBufferSize)
	}
	if config.WriteBufferSize != 4096 {
		t.Errorf("Expected WS_WRITE_BUFFER_SIZE to be 4096, got %d", config.WriteBufferSize)
	}
	if config.PodDefaultPort != 3000 {
		t.Errorf("Expected POD_DEFAULT_PORT to be 3000, got %d", config.PodDefaultPort)
	}

	// Clean up environment variables after test
	os.Unsetenv("PORT")
	os.Unsetenv("COMPUTE_NAMESPACE")
	os.Unsetenv("KUBECONFIG")
	os.Unsetenv("WS_READ_BUFFER_SIZE")
	os.Unsetenv("WS_WRITE_BUFFER_SIZE")
	os.Unsetenv("POD_DEFAULT_PORT")
}

func TestInvalidBufferSizeValues(t *testing.T) {
	// Test with invalid integer values
	os.Setenv("WS_READ_BUFFER_SIZE", "not-an-integer")
	os.Setenv("WS_WRITE_BUFFER_SIZE", "also-not-an-integer")
	os.Setenv("POD_DEFAULT_PORT", "invalid-port")

	// Load the config
	config := Load()

	// Check that defaults are used when invalid values are provided
	if config.ReadBufferSize != 1024 {
		t.Errorf("Expected invalid WS_READ_BUFFER_SIZE to fall back to 1024, got %d", config.ReadBufferSize)
	}
	if config.WriteBufferSize != 1024 {
		t.Errorf("Expected invalid WS_WRITE_BUFFER_SIZE to fall back to 1024, got %d", config.WriteBufferSize)
	}
	if config.PodDefaultPort != 8080 {
		t.Errorf("Expected invalid POD_DEFAULT_PORT to fall back to 8080, got %d", config.PodDefaultPort)
	}

	// Clean up environment variables after test
	os.Unsetenv("WS_READ_BUFFER_SIZE")
	os.Unsetenv("WS_WRITE_BUFFER_SIZE")
	os.Unsetenv("POD_DEFAULT_PORT")
}

func TestHelperFunctions(t *testing.T) {
	// Test getEnvOrDefault
	os.Setenv("TEST_ENV_VAR", "test-value")
	result := getEnvOrDefault("TEST_ENV_VAR", "default-value")
	if result != "test-value" {
		t.Errorf("Expected getEnvOrDefault to return 'test-value', got '%s'", result)
	}

	result = getEnvOrDefault("NON_EXISTENT_VAR", "default-value")
	if result != "default-value" {
		t.Errorf("Expected getEnvOrDefault to return 'default-value', got '%s'", result)
	}

	// Test getEnvAsIntOrDefault
	os.Setenv("TEST_INT_VAR", "42")
	intResult := getEnvAsIntOrDefault("TEST_INT_VAR", 10)
	if intResult != 42 {
		t.Errorf("Expected getEnvAsIntOrDefault to return 42, got %d", intResult)
	}

	intResult = getEnvAsIntOrDefault("NON_EXISTENT_INT_VAR", 10)
	if intResult != 10 {
		t.Errorf("Expected getEnvAsIntOrDefault to return 10, got %d", intResult)
	}

	// Test with invalid integer
	os.Setenv("INVALID_INT_VAR", "not-an-int")
	intResult = getEnvAsIntOrDefault("INVALID_INT_VAR", 10)
	if intResult != 10 {
		t.Errorf("Expected getEnvAsIntOrDefault to return default 10 for invalid int, got %d", intResult)
	}

	// Clean up environment variables
	os.Unsetenv("TEST_ENV_VAR")
	os.Unsetenv("TEST_INT_VAR")
	os.Unsetenv("INVALID_INT_VAR")
}
