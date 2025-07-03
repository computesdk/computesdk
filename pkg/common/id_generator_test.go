package common

import (
	"strings"
	"testing"
)

func TestGeneratePrefixedID(t *testing.T) {
	tests := []struct {
		name   string
		prefix string
	}{
		{"user prefix", "user"},
		{"order prefix", "order"},
		{"empty prefix", ""},
		{"long prefix", "very_long_prefix_name"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			id := GeneratePrefixedID(tt.prefix)

			// Check that ID is not empty
			if id == "" {
				t.Errorf("GeneratePrefixedID() returned empty string")
			}

			// Check that ID starts with prefix
			expectedPrefix := tt.prefix + "_"
			if tt.prefix == "" {
				expectedPrefix = "_"
			}
			if !strings.HasPrefix(id, expectedPrefix) {
				t.Errorf("GeneratePrefixedID() = %v, want prefix %v", id, expectedPrefix)
			}

			// Check that there's content after the prefix
			if len(id) <= len(expectedPrefix) {
				t.Errorf("GeneratePrefixedID() = %v, expected content after prefix", id)
			}
		})
	}
}

func TestGeneratePrefixedID_Uniqueness(t *testing.T) {
	// Generate multiple IDs and ensure they're unique
	ids := make(map[string]bool)
	prefix := "test"

	for range 1000 {
		id := GeneratePrefixedID(prefix)
		if ids[id] {
			t.Errorf("GeneratePrefixedID() generated duplicate ID: %v", id)
		}
		ids[id] = true
	}
}

func TestGeneratePrefixedID_Format(t *testing.T) {
	id := GeneratePrefixedID("user")

	// Should be in format: prefix_id
	parts := strings.Split(id, "_")
	if len(parts) != 2 {
		t.Errorf("GeneratePrefixedID() = %v, expected format 'prefix_id'", id)
	}

	if parts[0] != "user" {
		t.Errorf("GeneratePrefixedID() prefix = %v, want 'user'", parts[0])
	}

	if parts[1] == "" {
		t.Errorf("GeneratePrefixedID() ID part is empty")
	}
}
