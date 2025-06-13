package proxy

import (
	"net/http"
	"testing"
)

func TestExtractComputeID(t *testing.T) {
	tests := []struct {
		name     string
		host     string
		path     string
		expected string
	}{
		{
			name:     "Port-prefixed hostname format",
			host:     "3000-abc123.preview.computesdk.com",
			path:     "/",
			expected: "abc123",
		},
		{
			name:     "Standard hostname format",
			host:     "def456.preview.computesdk.com",
			path:     "/",
			expected: "def456",
		},
		{
			name:     "Path format with port prefix",
			host:     "gateway.computesdk.com",
			path:     "/preview/8080-ghi789",
			expected: "ghi789",
		},
		{
			name:     "Path format without port prefix",
			host:     "gateway.computesdk.com",
			path:     "/preview/jkl012",
			expected: "jkl012",
		},
		{
			name:     "Invalid path format",
			host:     "gateway.computesdk.com",
			path:     "/api/something",
			expected: "",
		},
		{
			name:     "Invalid host format",
			host:     "gateway.computesdk.com",
			path:     "/",
			expected: "",
		},
		{
			name:     "Empty request",
			host:     "",
			path:     "",
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req, err := http.NewRequest("GET", "http://"+tt.host+tt.path, nil)
			if err != nil {
				t.Fatalf("Failed to create request: %v", err)
			}

			// For some cases we need to manually set the host as NewRequest may parse it differently
			req.Host = tt.host

			computeID := ExtractComputeID(req)
			if computeID != tt.expected {
				t.Errorf("ExtractComputeID() = %v, want %v", computeID, tt.expected)
			}
		})
	}
}
