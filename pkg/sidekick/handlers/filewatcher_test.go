package handlers_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/heysnelling/computesdk/pkg/sidekick/handlers"
	"github.com/heysnelling/computesdk/pkg/sidekick/services"
	"github.com/heysnelling/computesdk/pkg/sidekick/testutil"
	ws "github.com/heysnelling/computesdk/pkg/sidekick/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFileWatcherHandler_HTTPAndWebSocket(t *testing.T) {
	gin.SetMode(gin.TestMode)

	// Setup
	wsManager := ws.NewManager()
	fileWatcherService := services.NewFileWatcherService()
	fileWatcherHandler := handlers.NewFileWatcherHandler(wsManager, fileWatcherService)

	router := gin.New()
	router.GET("/ws", wsManager.HandleWebSocket)
	router.POST("/watchers", fileWatcherHandler.Create)
	router.GET("/watchers/:id", fileWatcherHandler.Show)
	router.DELETE("/watchers/:id", fileWatcherHandler.Destroy)

	// Start test server
	server := httptest.NewServer(router)
	defer server.Close()

	// Create a temporary directory to watch
	tempDir, err := os.MkdirTemp("", "filewatcher-test-*")
	require.NoError(t, err)
	defer os.RemoveAll(tempDir)

	// 1. Create file watcher via HTTP
	createBody := map[string]interface{}{
		"path":           tempDir,
		"includeContent": true,
		"ignored":        []string{"*.log", "*.tmp"},
	}
	bodyBytes, _ := json.Marshal(createBody)
	
	resp, err := http.Post(server.URL+"/watchers", "application/json", bytes.NewReader(bodyBytes))
	require.NoError(t, err)
	assert.Equal(t, http.StatusCreated, resp.StatusCode)

	var createResp struct {
		Data struct {
			ID      string `json:"id"`
			Channel string `json:"channel"`
		} `json:"data"`
	}
	json.NewDecoder(resp.Body).Decode(&createResp)
	resp.Body.Close()

	watcherID := createResp.Data.ID
	channel := createResp.Data.Channel

	// 2. Connect WebSocket
	wsURL := strings.Replace(server.URL, "http://", "ws://", 1) + "/ws"
	wsConn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.NoError(t, err)
	defer wsConn.Close()

	// 3. Subscribe to watcher channel
	subscribeMsg := map[string]interface{}{
		"type": "subscribe",
		"data": map[string]interface{}{"channel": channel},
	}
	err = wsConn.WriteJSON(subscribeMsg)
	require.NoError(t, err)

	// 4. Start a goroutine to read WebSocket messages
	messages := make(chan map[string]interface{}, 10)
	go func() {
		for {
			var msg map[string]interface{}
			err := wsConn.ReadJSON(&msg)
			if err != nil {
				return
			}
			messages <- msg
		}
	}()

	// Wait for subscription to be processed and drain initial messages
	time.Sleep(50 * time.Millisecond)
	testutil.DrainChannel(messages)

	// 5. Create a file (this should trigger a WebSocket event)
	testFile := filepath.Join(tempDir, "test.txt")
	testContent := "Hello, File Watcher!"
	err = os.WriteFile(testFile, []byte(testContent), 0644)
	require.NoError(t, err)

	// 6. Check if WebSocket received the file creation event
	timeout := time.After(2 * time.Second)
	var receivedCreate bool

	for {
		select {
		case msg := <-messages:
			if msg["type"] == "file:changed" {
				if data, ok := msg["data"].(map[string]interface{}); ok {
					if path, ok := data["path"].(string); ok && strings.Contains(path, "test.txt") {
						if event, ok := data["event"].(string); ok && event == "created" {
							if content, ok := data["content"].(string); ok && content == testContent {
								receivedCreate = true
							}
						}
					}
				}
			}
		case <-timeout:
			assert.True(t, receivedCreate, "Should receive file creation event via WebSocket")
			goto nextTest
		}
		
		if receivedCreate {
			break
		}
	}

nextTest:
	// 7. Modify the file
	modifiedContent := "Modified content!"
	err = os.WriteFile(testFile, []byte(modifiedContent), 0644)
	require.NoError(t, err)

	// Small delay for filesystem settling
	time.Sleep(50 * time.Millisecond)

	// 8. Check for modification event
	timeout = time.After(2 * time.Second)
	var receivedModify bool

	for {
		select {
		case msg := <-messages:
			if msg["type"] == "file:changed" {
				if data, ok := msg["data"].(map[string]interface{}); ok {
					if event, ok := data["event"].(string); ok && event == "modified" {
						if content, ok := data["content"].(string); ok && content == modifiedContent {
							receivedModify = true
						}
					}
				}
			}
		case <-timeout:
			assert.True(t, receivedModify, "Should receive file modification event via WebSocket")
			goto cleanupTest
		}
		
		if receivedModify {
			break
		}
	}

cleanupTest:
	// 9. Test that ignored files don't trigger events
	ignoredFile := filepath.Join(tempDir, "ignored.log")
	err = os.WriteFile(ignoredFile, []byte("should be ignored"), 0644)
	require.NoError(t, err)

	// Wait and ensure no event for ignored file
	time.Sleep(300 * time.Millisecond)
	
	// Drain any unrelated messages
	testutil.DrainChannel(messages)
	
	// Drain any pending messages
	select {
	case msg := <-messages:
		if data, ok := msg["data"].(map[string]interface{}); ok {
			if path, ok := data["path"].(string); ok {
				assert.False(t, strings.Contains(path, "ignored.log"), "Should not receive events for ignored files")
			}
		}
	default:
		// Good - no messages
	}

	// 10. Clean up - delete the watcher
	req, _ := http.NewRequest("DELETE", server.URL+"/watchers/"+watcherID, nil)
	resp, err = http.DefaultClient.Do(req)
	require.NoError(t, err)
	assert.Equal(t, http.StatusNoContent, resp.StatusCode)
}