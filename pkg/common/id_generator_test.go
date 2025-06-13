package common

import (
	"strings"
	"testing"
)

func TestGeneratePublicIDWithPrefix(t *testing.T) {
	prefix := "test_"
	id, err := GeneratePrefixedID(prefix)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.HasPrefix(id, prefix) {
		t.Errorf("expected id to have prefix %q, got %q", prefix, id)
	}
	if len(id) <= len(prefix) {
		t.Errorf("expected id length > prefix length, got %d", len(id))
	}

	// Check uniqueness across multiple calls
	id2, err := GeneratePrefixedID(prefix)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id == id2 {
		t.Errorf("expected unique ids, got duplicate: %q", id)
	}
}
