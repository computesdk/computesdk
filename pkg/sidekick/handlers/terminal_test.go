package handlers_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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

func TestTerminalHandler_HTTPAndWebSocket(t *testing.T) {
	gin.SetMode(gin.TestMode)
	
	// Setup
	wsManager := ws.NewManager()
	terminalService := services.NewTerminalService()
	terminalHandler := handlers.NewTerminalHandler(wsManager, terminalService)
	
	router := gin.New()
	router.GET("/ws", wsManager.HandleWebSocket)
	router.POST("/terminals", terminalHandler.Create)
	router.POST("/terminals/:id/execute", terminalHandler.Execute)
	
	// Start test server
	server := httptest.NewServer(router)
	defer server.Close()
	
	// 1. Create terminal via HTTP
	createBody := []byte(`{"shell":"/bin/sh"}`)
	resp, err := http.Post(server.URL+"/terminals", "application/json", bytes.NewReader(createBody))
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
	
	terminalID := createResp.Data.ID
	channel := createResp.Data.Channel
	
	// 2. Connect WebSocket
	wsURL := strings.Replace(server.URL, "http://", "ws://", 1) + "/ws"
	wsConn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.NoError(t, err)
	defer wsConn.Close()
	
	// 3. Subscribe to terminal channel
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
			// Log received messages for debugging
			if msgType, ok := msg["type"].(string); ok {
				t.Logf("Received WebSocket message type: %s", msgType)
			}
			messages <- msg
		}
	}()
	
	// Wait for subscription to be processed and clear any initial messages
	// Use small delay to ensure WebSocket goroutine starts
	time.Sleep(50 * time.Millisecond)
	
	// Drain any initial messages (like welcome or subscription confirmations)
	testutil.DrainChannel(messages)
	
	// 5. Execute command via HTTP (this should broadcast to WebSocket)
	execBody := []byte(`{"command":"echo test123"}`)
	resp, err = http.Post(server.URL+"/terminals/"+terminalID+"/execute", "application/json", bytes.NewReader(execBody))
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	
	var execResp struct {
		Data struct {
			Output string `json:"output"`
		} `json:"data"`
	}
	json.NewDecoder(resp.Body).Decode(&execResp)
	resp.Body.Close()
	
	assert.Contains(t, execResp.Data.Output, "test123")
	
	// 6. Check if WebSocket received the output
	timeout := time.After(3 * time.Second)
	var receivedOutput bool
	messageCount := 0
	
	for !receivedOutput {
		select {
		case msg := <-messages:
			messageCount++
			t.Logf("Message %d: type=%v", messageCount, msg["type"])
			
			if msg["type"] == "terminal:output" {
				if data, ok := msg["data"].(map[string]interface{}); ok {
					// Check if this is from Execute (has command field) or PTY reader
					if command, hasCommand := data["command"].(string); hasCommand {
						t.Logf("Execute output - command: %s", command)
						// This is the Execute output we're looking for
						if output, ok := data["output"].(string); ok {
							t.Logf("Execute command output: %q", output)
							if strings.Contains(output, "test123") {
								receivedOutput = true
							}
						}
					} else {
						// This is PTY reader output
						if output, ok := data["output"].(string); ok {
							t.Logf("PTY output: %q", output)
						}
					}
				}
			}
		case <-timeout:
			t.Logf("Timeout after receiving %d messages", messageCount)
			assert.True(t, receivedOutput, "Should receive output via WebSocket")
			return
		}
	}
}