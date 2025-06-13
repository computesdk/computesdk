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

func TestSignalHandler_HTTPAndWebSocket(t *testing.T) {
	gin.SetMode(gin.TestMode)

	// Setup
	wsManager := ws.NewManager()
	signalService := services.NewSignalService()
	signalHandler := handlers.NewSignalHandler(wsManager, signalService)

	router := gin.New()
	router.GET("/ws", wsManager.HandleWebSocket)
	router.POST("/signals/start", signalHandler.Start)
	router.POST("/signals/stop", signalHandler.Stop)
	router.GET("/signals/status", signalHandler.Status)
	router.POST("/signals/port", signalHandler.EmitPort)
	router.POST("/signals/error", signalHandler.EmitError)
	router.POST("/signals/server-ready", signalHandler.EmitServerReady)
	router.POST("/signals/port/:port/:type", signalHandler.EmitPortQuery)

	// Start test server
	server := httptest.NewServer(router)
	defer server.Close()

	// 1. Check initial status
	resp, err := http.Get(server.URL + "/signals/status")
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, resp.StatusCode)

	var statusResp struct {
		Data struct {
			Status string `json:"status"`
		} `json:"data"`
	}
	json.NewDecoder(resp.Body).Decode(&statusResp)
	resp.Body.Close()
	assert.Equal(t, "stopped", statusResp.Data.Status)

	// 2. Start signal service
	resp, err = http.Post(server.URL+"/signals/start", "application/json", nil)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()
	
	// Give the broadcasting goroutine time to start
	time.Sleep(50 * time.Millisecond)

	// 3. Connect WebSocket
	wsURL := strings.Replace(server.URL, "http://", "ws://", 1) + "/ws"
	wsConn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.NoError(t, err)
	defer wsConn.Close()

	// 4. Subscribe to signals channel
	subscribeMsg := map[string]interface{}{
		"type": "subscribe",
		"data": map[string]interface{}{"channel": "signals"},
	}
	err = wsConn.WriteJSON(subscribeMsg)
	require.NoError(t, err)

	// 5. Start goroutine to read WebSocket messages
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

	// Wait for subscription and drain initial messages
	time.Sleep(50 * time.Millisecond)
	testutil.DrainChannel(messages)

	// 6. Test port signal emission
	portBody := map[string]interface{}{
		"port": 3000,
		"type": "open",
		"url":  "http://localhost:3000",
	}
	bodyBytes, _ := json.Marshal(portBody)

	resp, err = http.Post(server.URL+"/signals/port", "application/json", bytes.NewReader(bodyBytes))
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	// Check WebSocket received port signal
	msg, ok := testutil.WaitForWebSocketMessage(t, messages, 2*time.Second)
	require.True(t, ok, "Should receive port signal via WebSocket")

	assert.Equal(t, "signal", msg["type"])
	if data, ok := msg["data"].(map[string]interface{}); ok {
		assert.Equal(t, "port", data["signal"])
		if signalData, ok := data["data"].(map[string]interface{}); ok {
			assert.Equal(t, float64(3000), signalData["port"]) // JSON numbers are float64
			assert.Equal(t, "open", signalData["type"])
			assert.Equal(t, "http://localhost:3000", signalData["url"])
		}
	}

	// 7. Test error signal emission
	errorBody := map[string]interface{}{
		"message": "Test error message",
	}
	bodyBytes, _ = json.Marshal(errorBody)

	resp, err = http.Post(server.URL+"/signals/error", "application/json", bytes.NewReader(bodyBytes))
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	// Check WebSocket received error signal
	msg, ok = testutil.WaitForWebSocketMessage(t, messages, 2*time.Second)
	require.True(t, ok, "Should receive error signal via WebSocket")

	assert.Equal(t, "signal", msg["type"])
	if data, ok := msg["data"].(map[string]interface{}); ok {
		assert.Equal(t, "error", data["signal"])
		if signalData, ok := data["data"].(map[string]interface{}); ok {
			assert.Equal(t, "Test error message", signalData["message"])
		}
	}

	// 8. Test server ready signal emission
	serverReadyBody := map[string]interface{}{
		"port": 8080,
		"url":  "http://localhost:8080",
	}
	bodyBytes, _ = json.Marshal(serverReadyBody)

	resp, err = http.Post(server.URL+"/signals/server-ready", "application/json", bytes.NewReader(bodyBytes))
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	// Check WebSocket received server ready signal
	msg, ok = testutil.WaitForWebSocketMessage(t, messages, 2*time.Second)
	require.True(t, ok, "Should receive server ready signal via WebSocket")

	assert.Equal(t, "signal", msg["type"])
	if data, ok := msg["data"].(map[string]interface{}); ok {
		assert.Equal(t, "server-ready", data["signal"])
		if signalData, ok := data["data"].(map[string]interface{}); ok {
			assert.Equal(t, float64(8080), signalData["port"])
			assert.Equal(t, "http://localhost:8080", signalData["url"])
		}
	}

	// 9. Test query-style port endpoint
	resp, err = http.Post(server.URL+"/signals/port/4000/close", "application/json", nil)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	// Check WebSocket received query port signal
	msg, ok = testutil.WaitForWebSocketMessage(t, messages, 2*time.Second)
	require.True(t, ok, "Should receive query port signal via WebSocket")

	assert.Equal(t, "signal", msg["type"])
	if data, ok := msg["data"].(map[string]interface{}); ok {
		assert.Equal(t, "port", data["signal"])
		if signalData, ok := data["data"].(map[string]interface{}); ok {
			assert.Equal(t, float64(4000), signalData["port"])
			assert.Equal(t, "close", signalData["type"])
			assert.Equal(t, "http://localhost:4000", signalData["url"])
		}
	}

	// 10. Stop signal service
	resp, err = http.Post(server.URL+"/signals/stop", "application/json", nil)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()
}

func TestSignalHandler_ValidationErrors(t *testing.T) {
	gin.SetMode(gin.TestMode)

	wsManager := ws.NewManager()
	signalService := services.NewSignalService()
	signalHandler := handlers.NewSignalHandler(wsManager, signalService)

	router := gin.New()
	router.POST("/signals/start", signalHandler.Start)
	router.POST("/signals/port", signalHandler.EmitPort)
	router.POST("/signals/error", signalHandler.EmitError)
	router.POST("/signals/server-ready", signalHandler.EmitServerReady)
	router.POST("/signals/port/:port/:type", signalHandler.EmitPortQuery)

	server := httptest.NewServer(router)
	defer server.Close()

	// Start service first
	resp, err := http.Post(server.URL+"/signals/start", "application/json", nil)
	require.NoError(t, err)
	resp.Body.Close()

	// Test invalid port signal (missing fields)
	invalidBody := `{"port": 3000}`
	resp, err = http.Post(server.URL+"/signals/port", "application/json", strings.NewReader(invalidBody))
	require.NoError(t, err)
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	resp.Body.Close()

	// Test invalid port signal (invalid type)
	invalidBody = `{"port": 3000, "type": "invalid", "url": "http://localhost:3000"}`
	resp, err = http.Post(server.URL+"/signals/port", "application/json", strings.NewReader(invalidBody))
	require.NoError(t, err)
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	resp.Body.Close()

	// Test invalid error signal (missing message)
	invalidBody = `{}`
	resp, err = http.Post(server.URL+"/signals/error", "application/json", strings.NewReader(invalidBody))
	require.NoError(t, err)
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	resp.Body.Close()

	// Test invalid query port (invalid port)
	resp, err = http.Post(server.URL+"/signals/port/invalid/open", "application/json", nil)
	require.NoError(t, err)
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	resp.Body.Close()

	// Test invalid query port (invalid type)
	resp, err = http.Post(server.URL+"/signals/port/3000/invalid", "application/json", nil)
	require.NoError(t, err)
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	resp.Body.Close()
}