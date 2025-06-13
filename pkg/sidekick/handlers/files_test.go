package handlers_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/heysnelling/computesdk/pkg/sidekick/handlers"
	"github.com/heysnelling/computesdk/pkg/sidekick/services"
	"github.com/heysnelling/computesdk/pkg/sidekick/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupFilesRouter(t *testing.T) (*gin.Engine, string) {
	gin.SetMode(gin.TestMode)

	// Create temp directory for tests
	tempDir, err := os.MkdirTemp("", "sidekick-test-*")
	require.NoError(t, err)

	// Initialize dependencies
	wsManager := websocket.NewManager()
	filesystemService := services.NewFilesystemServiceWithPath(tempDir)
	filesHandler := handlers.NewFilesHandler(wsManager, filesystemService)

	// Setup router
	router := gin.New()
	files := router.Group("/files")
	{
		files.GET("", filesHandler.Index)
		files.GET("/:id", filesHandler.Show)
		files.POST("", filesHandler.Create)
		files.PUT("/:id", filesHandler.Update)
		files.DELETE("/:id", filesHandler.Destroy)
	}

	return router, tempDir
}

func TestFilesHandler_Index(t *testing.T) {
	router, tempDir := setupFilesRouter(t)
	defer os.RemoveAll(tempDir)

	// Create test files
	testFile := filepath.Join(tempDir, "test.txt")
	err := os.WriteFile(testFile, []byte("test content"), 0644)
	require.NoError(t, err)

	// Test listing root directory
	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/files", nil)
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response struct {
		Data struct {
			Files []struct {
				Name string `json:"Name"`
			} `json:"files"`
		} `json:"data"`
	}
	err = json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.Len(t, response.Data.Files, 1)
	assert.Equal(t, "test.txt", response.Data.Files[0].Name)
}

func TestFilesHandler_Create(t *testing.T) {
	router, tempDir := setupFilesRouter(t)
	defer os.RemoveAll(tempDir)

	// Create file via API
	payload := map[string]string{
		"path":    "new-file.txt",
		"content": "Hello World",
	}
	body, _ := json.Marshal(payload)

	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/files", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusCreated, w.Code)

	// Verify file was created
	content, err := os.ReadFile(filepath.Join(tempDir, "new-file.txt"))
	require.NoError(t, err)
	assert.Equal(t, "Hello World", string(content))
}

func TestFilesHandler_Show(t *testing.T) {
	router, tempDir := setupFilesRouter(t)
	defer os.RemoveAll(tempDir)

	// Create test file
	testContent := "test file content"
	err := os.WriteFile(filepath.Join(tempDir, "test.txt"), []byte(testContent), 0644)
	require.NoError(t, err)

	t.Run("get file metadata", func(t *testing.T) {
		w := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/files/test.txt", nil)
		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)

		var response struct {
			Data struct {
				File struct {
					Name string `json:"Name"`
					Size int64  `json:"Size"`
				} `json:"file"`
			} `json:"data"`
		}
		err := json.Unmarshal(w.Body.Bytes(), &response)
		require.NoError(t, err)

		assert.Equal(t, "test.txt", response.Data.File.Name)
		assert.Equal(t, int64(len(testContent)), response.Data.File.Size)
	})

	t.Run("get file content", func(t *testing.T) {
		w := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/files/test.txt?content=true", nil)
		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)

		var response struct {
			Data struct {
				Content string `json:"content"`
			} `json:"data"`
		}
		err := json.Unmarshal(w.Body.Bytes(), &response)
		require.NoError(t, err)

		assert.Equal(t, testContent, response.Data.Content)
	})
}

func TestFilesHandler_Update(t *testing.T) {
	router, tempDir := setupFilesRouter(t)
	defer os.RemoveAll(tempDir)

	// Create initial file
	err := os.WriteFile(filepath.Join(tempDir, "update-me.txt"), []byte("old content"), 0644)
	require.NoError(t, err)

	// Update via API
	payload := map[string]string{
		"content": "new content",
	}
	body, _ := json.Marshal(payload)

	w := httptest.NewRecorder()
	req := httptest.NewRequest("PUT", "/files/update-me.txt", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	// Verify file was updated
	content, err := os.ReadFile(filepath.Join(tempDir, "update-me.txt"))
	require.NoError(t, err)
	assert.Equal(t, "new content", string(content))
}

func TestFilesHandler_Delete(t *testing.T) {
	router, tempDir := setupFilesRouter(t)
	defer os.RemoveAll(tempDir)

	// Create file to delete
	filePath := filepath.Join(tempDir, "delete-me.txt")
	err := os.WriteFile(filePath, []byte("delete me"), 0644)
	require.NoError(t, err)

	// Delete via API
	w := httptest.NewRecorder()
	req := httptest.NewRequest("DELETE", "/files/delete-me.txt", nil)
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNoContent, w.Code)

	// Verify file was deleted
	_, err = os.Stat(filePath)
	assert.True(t, os.IsNotExist(err))
}

func TestFilesHandler_Subdirectories(t *testing.T) {
	router, tempDir := setupFilesRouter(t)
	defer os.RemoveAll(tempDir)

	// Create file in subdirectory via API
	payload := map[string]string{
		"path":    "subdir/nested/file.txt",
		"content": "nested content",
	}
	body, _ := json.Marshal(payload)

	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/files", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusCreated, w.Code)

	// Verify nested structure was created
	content, err := os.ReadFile(filepath.Join(tempDir, "subdir", "nested", "file.txt"))
	require.NoError(t, err)
	assert.Equal(t, "nested content", string(content))

	// List files in subdirectory
	w = httptest.NewRecorder()
	req = httptest.NewRequest("GET", "/files?path=subdir/nested", nil)
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestFilesHandler_PathTraversal(t *testing.T) {
	router, tempDir := setupFilesRouter(t)
	defer os.RemoveAll(tempDir)

	// Try to create file outside base directory
	payload := map[string]string{
		"path":    "../malicious.txt",
		"content": "should not exist",
	}
	body, _ := json.Marshal(payload)

	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/files", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)

	// Verify response indicates an error
	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)
	assert.Contains(t, response["error"], "path outside base directory")

	// Verify no malicious file was actually created in parent directory
	maliciousPath := filepath.Join(filepath.Dir(tempDir), "malicious.txt")
	_, err := os.Stat(maliciousPath)
	assert.True(t, os.IsNotExist(err), "Malicious file should not exist at %s", maliciousPath)
}
