package services_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/heysnelling/computesdk/pkg/sidekick/services"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupFilesystemService(t *testing.T) (services.FilesystemService, string) {
	tempDir, err := os.MkdirTemp("", "fs-service-test-*")
	require.NoError(t, err)

	service := services.NewFilesystemServiceWithPath(tempDir)
	return service, tempDir
}

func TestFilesystemService_List(t *testing.T) {
	service, tempDir := setupFilesystemService(t)
	defer os.RemoveAll(tempDir)

	// Create test files
	err := os.WriteFile(filepath.Join(tempDir, "file1.txt"), []byte("content1"), 0644)
	require.NoError(t, err)
	err = os.WriteFile(filepath.Join(tempDir, "file2.txt"), []byte("content2"), 0644)
	require.NoError(t, err)
	err = os.Mkdir(filepath.Join(tempDir, "subdir"), 0755)
	require.NoError(t, err)

	// List root directory
	files, err := service.List(context.Background(), "/")
	require.NoError(t, err)

	assert.Len(t, files, 3)

	// Check file properties
	var foundFile, foundDir bool
	for _, f := range files {
		if f.Name == "file1.txt" {
			foundFile = true
			assert.False(t, f.IsDir)
			assert.Equal(t, int64(8), f.Size)
			assert.Equal(t, "text/plain", f.MimeType)
		}
		if f.Name == "subdir" {
			foundDir = true
			assert.True(t, f.IsDir)
		}
	}
	assert.True(t, foundFile)
	assert.True(t, foundDir)
}

func TestFilesystemService_Get(t *testing.T) {
	service, tempDir := setupFilesystemService(t)
	defer os.RemoveAll(tempDir)

	// Create test file
	content := "test content"
	err := os.WriteFile(filepath.Join(tempDir, "test.txt"), []byte(content), 0644)
	require.NoError(t, err)

	// Get file info
	file, err := service.Get(context.Background(), "test.txt")
	require.NoError(t, err)

	assert.Equal(t, "test.txt", file.Name)
	assert.Equal(t, int64(len(content)), file.Size)
	assert.False(t, file.IsDir)
	assert.Equal(t, "text/plain", file.MimeType)
}

func TestFilesystemService_Read(t *testing.T) {
	service, tempDir := setupFilesystemService(t)
	defer os.RemoveAll(tempDir)

	// Create test file
	content := "Hello, World!"
	err := os.WriteFile(filepath.Join(tempDir, "hello.txt"), []byte(content), 0644)
	require.NoError(t, err)

	// Read file
	fileContent, err := service.Read(context.Background(), "hello.txt")
	require.NoError(t, err)

	assert.Equal(t, content, string(fileContent.Content))
	assert.Equal(t, "hello.txt", fileContent.File.Name)

	// Try to read directory
	err = os.Mkdir(filepath.Join(tempDir, "dir"), 0755)
	require.NoError(t, err)
	_, err = service.Read(context.Background(), "dir")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "cannot read directory")
}

func TestFilesystemService_Create(t *testing.T) {
	service, tempDir := setupFilesystemService(t)
	defer os.RemoveAll(tempDir)

	// Create file in root
	file, err := service.Create(context.Background(), "new.txt", []byte("new content"))
	require.NoError(t, err)

	assert.Equal(t, "new.txt", file.Name)

	// Verify file exists
	content, err := os.ReadFile(filepath.Join(tempDir, "new.txt"))
	require.NoError(t, err)
	assert.Equal(t, "new content", string(content))

	// Create file in subdirectory
	file, err = service.Create(context.Background(), "sub/dir/nested.txt", []byte("nested"))
	require.NoError(t, err)

	assert.Equal(t, "nested.txt", file.Name)

	// Verify nested file exists
	content, err = os.ReadFile(filepath.Join(tempDir, "sub", "dir", "nested.txt"))
	require.NoError(t, err)
	assert.Equal(t, "nested", string(content))
}

func TestFilesystemService_Update(t *testing.T) {
	service, tempDir := setupFilesystemService(t)
	defer os.RemoveAll(tempDir)

	// Create initial file
	err := os.WriteFile(filepath.Join(tempDir, "update.txt"), []byte("old"), 0644)
	require.NoError(t, err)

	// Update file
	file, err := service.Update(context.Background(), "update.txt", []byte("new"))
	require.NoError(t, err)

	assert.Equal(t, int64(3), file.Size)

	// Verify content
	content, err := os.ReadFile(filepath.Join(tempDir, "update.txt"))
	require.NoError(t, err)
	assert.Equal(t, "new", string(content))

	// Try to update non-existent file
	_, err = service.Update(context.Background(), "nonexistent.txt", []byte("data"))
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "file not found")
}

func TestFilesystemService_Delete(t *testing.T) {
	service, tempDir := setupFilesystemService(t)
	defer os.RemoveAll(tempDir)

	// Create file
	filePath := filepath.Join(tempDir, "delete.txt")
	err := os.WriteFile(filePath, []byte("delete me"), 0644)
	require.NoError(t, err)

	// Delete file
	err = service.Delete(context.Background(), "delete.txt")
	require.NoError(t, err)

	// Verify file is gone
	_, err = os.Stat(filePath)
	assert.True(t, os.IsNotExist(err))

	// Create directory with files
	dirPath := filepath.Join(tempDir, "deletedir")
	err = os.Mkdir(dirPath, 0755)
	require.NoError(t, err)
	err = os.WriteFile(filepath.Join(dirPath, "file.txt"), []byte("content"), 0644)
	require.NoError(t, err)

	// Delete directory
	err = service.Delete(context.Background(), "deletedir")
	require.NoError(t, err)

	// Verify directory is gone
	_, err = os.Stat(dirPath)
	assert.True(t, os.IsNotExist(err))
}

func TestFilesystemService_Move(t *testing.T) {
	service, tempDir := setupFilesystemService(t)
	defer os.RemoveAll(tempDir)

	// Create file
	content := "move me"
	err := os.WriteFile(filepath.Join(tempDir, "old.txt"), []byte(content), 0644)
	require.NoError(t, err)

	// Move file
	err = service.Move(context.Background(), "old.txt", "new.txt")
	require.NoError(t, err)

	// Verify old file is gone
	_, err = os.Stat(filepath.Join(tempDir, "old.txt"))
	assert.True(t, os.IsNotExist(err))

	// Verify new file exists with same content
	newContent, err := os.ReadFile(filepath.Join(tempDir, "new.txt"))
	require.NoError(t, err)
	assert.Equal(t, content, string(newContent))
}

func TestFilesystemService_Copy(t *testing.T) {
	service, tempDir := setupFilesystemService(t)
	defer os.RemoveAll(tempDir)

	// Create source file
	content := "copy me"
	srcPath := filepath.Join(tempDir, "source.txt")
	err := os.WriteFile(srcPath, []byte(content), 0755)
	require.NoError(t, err)

	// Copy file
	err = service.Copy(context.Background(), "source.txt", "dest.txt")
	require.NoError(t, err)

	// Verify both files exist
	srcContent, err := os.ReadFile(filepath.Join(tempDir, "source.txt"))
	require.NoError(t, err)
	assert.Equal(t, content, string(srcContent))

	destContent, err := os.ReadFile(filepath.Join(tempDir, "dest.txt"))
	require.NoError(t, err)
	assert.Equal(t, content, string(destContent))

	// Verify permissions were copied
	srcInfo, _ := os.Stat(srcPath)
	destInfo, _ := os.Stat(filepath.Join(tempDir, "dest.txt"))
	assert.Equal(t, srcInfo.Mode(), destInfo.Mode())
}

func TestFilesystemService_PathTraversal(t *testing.T) {
	service, tempDir := setupFilesystemService(t)
	defer os.RemoveAll(tempDir)

	// Create a legitimate subdirectory for testing
	err := os.Mkdir(filepath.Join(tempDir, "etc"), 0755)
	require.NoError(t, err)

	tests := []struct {
		name            string
		path            string
		shouldFail      bool
		checkFileExists bool
	}{
		{"parent directory", "../outside.txt", true, false},
		{"absolute path becomes relative", "/etc/passwd", false, true}, // This is now etc/passwd
		{"hidden traversal", "subdir/../../outside.txt", true, false},
		{"multiple parent dirs", "../../outside.txt", true, false},
		{"sneaky traversal", "valid/../../../etc/passwd", true, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Try to create a file
			_, err := service.Create(context.Background(), tt.path, []byte("test content"))

			if tt.shouldFail {
				assert.Error(t, err, "Expected error for path: %s", tt.path)
			} else {
				assert.NoError(t, err, "Expected no error for path: %s", tt.path)

				if tt.checkFileExists {
					// Verify file was created in the safe location
					expectedPath := filepath.Join(tempDir, strings.TrimPrefix(tt.path, "/"))
					_, err := os.Stat(expectedPath)
					assert.NoError(t, err, "File should exist at: %s", expectedPath)

					// Clean up
					os.Remove(expectedPath)
				}
			}
		})
	}

	// Additional test: verify files are actually confined to tempDir
	_, err = service.Create(context.Background(), "../escape.txt", []byte("escaped"))
	assert.Error(t, err)

	// Make sure no file was created outside tempDir
	parentDir := filepath.Dir(tempDir)
	escapedFile := filepath.Join(parentDir, "escape.txt")
	_, err = os.Stat(escapedFile)
	assert.True(t, os.IsNotExist(err), "File should not exist outside temp directory")
}

func TestFilesystemService_MimeTypes(t *testing.T) {
	service, tempDir := setupFilesystemService(t)
	defer os.RemoveAll(tempDir)

	tests := []struct {
		filename string
		expected string
	}{
		{"test.txt", "text/plain"},
		{"index.html", "text/html"},
		{"style.css", "text/css"},
		{"script.js", "application/javascript"},
		{"data.json", "application/json"},
		{"config.xml", "application/xml"},
		{"document.pdf", "application/pdf"},
		{"image.png", "image/png"},
		{"photo.jpg", "image/jpeg"},
		{"animation.gif", "image/gif"},
		{"vector.svg", "image/svg+xml"},
		{"unknown.xyz", "application/octet-stream"},
	}

	for _, tt := range tests {
		t.Run(tt.filename, func(t *testing.T) {
			file, err := service.Create(context.Background(), tt.filename, []byte("content"))
			require.NoError(t, err)
			assert.Equal(t, tt.expected, file.MimeType)
		})
	}
}
