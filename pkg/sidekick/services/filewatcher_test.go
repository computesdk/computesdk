package services_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/heysnelling/computesdk/pkg/sidekick/services"
	"github.com/heysnelling/computesdk/pkg/sidekick/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFileWatcherService_BasicOperations(t *testing.T) {
	service := services.NewFileWatcherService()
	
	// Create a temporary directory
	tempDir, err := os.MkdirTemp("", "watcher-test-*")
	require.NoError(t, err)
	defer os.RemoveAll(tempDir)
	
	// Test Create
	watcher, err := service.Create(context.Background(), tempDir, true, []string{"*.log"})
	require.NoError(t, err)
	assert.NotEmpty(t, watcher.ID)
	assert.Equal(t, tempDir, watcher.Path)
	assert.True(t, watcher.IncludeContent)
	assert.Equal(t, "active", watcher.Status)
	
	// Test Get
	retrieved, err := service.Get(context.Background(), watcher.ID)
	require.NoError(t, err)
	assert.Equal(t, watcher.ID, retrieved.ID)
	
	// Test List
	list, err := service.List(context.Background())
	require.NoError(t, err)
	assert.Len(t, list, 1)
	assert.Equal(t, watcher.ID, list[0].ID)
	
	// Test Delete
	err = service.Delete(context.Background(), watcher.ID)
	require.NoError(t, err)
	
	// Verify deletion
	_, err = service.Get(context.Background(), watcher.ID)
	assert.Error(t, err)
}

func TestFileWatcherService_FileEvents(t *testing.T) {
	service := services.NewFileWatcherService()
	
	tempDir, err := os.MkdirTemp("", "watcher-test-*")
	require.NoError(t, err)
	defer os.RemoveAll(tempDir)
	
	// Create watcher with content
	watcher, err := service.Create(context.Background(), tempDir, true, nil)
	require.NoError(t, err)
	defer service.Delete(context.Background(), watcher.ID)
	
	// Get event channel
	events := service.GetEvents(context.Background(), watcher.ID)
	
	// Create a file
	testFile := filepath.Join(tempDir, "test.txt")
	err = os.WriteFile(testFile, []byte("Hello"), 0644)
	require.NoError(t, err)
	
	// Small delay for filesystem settling
	time.Sleep(50 * time.Millisecond)
	
	// Wait for event
	event, ok := testutil.WaitForWebSocketMessage(t, events, 3*time.Second)
	require.True(t, ok, "Should receive file event")
	
	assert.Contains(t, event.Path, "test.txt")
	assert.Contains(t, []string{"created", "modified"}, event.Event) // Accept either
	if watcher.IncludeContent {
		assert.NotEmpty(t, event.Content)
	}
}