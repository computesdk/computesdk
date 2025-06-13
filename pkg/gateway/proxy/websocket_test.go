package proxy

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// Using the mockPodManager from http_test.go instead of redefining it here

// WebSocket echo server for testing
func setupMockWebSocketServer(t *testing.T) *httptest.Server {
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return true
		},
	}

	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Upgrade the connection to WebSocket
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Logf("Error upgrading to WebSocket: %v", err)
			return
		}
		defer conn.Close()

		// Simple echo server - read messages and echo them back
		for {
			messageType, p, err := conn.ReadMessage()
			if err != nil {
				// Don't report error on normal disconnection
				if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
					t.Logf("Error reading WebSocket message: %v", err)
				}
				break
			}

			// Prepend "ECHO: " to the message and send it back
			response := append([]byte("ECHO: "), p...)
			if err := conn.WriteMessage(messageType, response); err != nil {
				t.Logf("Error writing WebSocket message: %v", err)
				break
			}
		}
	}))
}

func TestWebSocketProxy_ErrorCases(t *testing.T) {
	// Setup a mock WebSocket server
	mockServer := setupMockWebSocketServer(t)
	defer mockServer.Close()

	// Parse server address
	serverURL := strings.TrimPrefix(mockServer.URL, "http://")
	parts := strings.Split(serverURL, ":")
	podIP := parts[0]

	// Setup mock pod manager
	mockPM := newMockPodManager()
	mockPM.AddPod("ws-test-id", podIP, true)
	mockPM.AddPod("ws-not-ready", podIP, false)

	// Create WebSocket proxy with mock pod manager
	proxy := NewWebSocketProxy(mockPM, 1024, 1024, 8080, false, 0)

	// Test error cases with direct HTTP requests
	errorTests := []struct {
		name           string
		host           string
		expectedStatus int
		expectedBody   string
	}{
		{
			name:           "Missing compute ID",
			host:           "gateway.computesdk.com",
			expectedStatus: http.StatusBadRequest,
			expectedBody:   "Missing compute ID",
		},
		{
			name:           "Pod not found",
			host:           "unknown-id.preview.computesdk.com",
			expectedStatus: http.StatusNotFound,
			expectedBody:   "Pod not found",
		},
		{
			name:           "Pod not ready",
			host:           "ws-not-ready.preview.computesdk.com",
			expectedStatus: http.StatusServiceUnavailable,
			expectedBody:   "Pod not ready",
		},
	}

	for _, tt := range errorTests {
		t.Run(tt.name, func(t *testing.T) {
			// Create test request - this will not be upgraded to WebSocket
			req := httptest.NewRequest("GET", "http://"+tt.host+"/ws", nil)
			req.Host = tt.host
			req.Header.Set("Connection", "upgrade")
			req.Header.Set("Upgrade", "websocket")

			// Create response recorder
			w := httptest.NewRecorder()

			// Call the proxy handler
			proxy.ServeHTTP(w, req)

			// Check status code
			if w.Code != tt.expectedStatus {
				t.Errorf("Expected status %d, got %d", tt.expectedStatus, w.Code)
			}

			// Check response body contains expected string
			if !strings.Contains(w.Body.String(), tt.expectedBody) {
				t.Errorf("Expected body to contain '%s', got '%s'", tt.expectedBody, w.Body.String())
			}
		})
	}
}

func TestWebSocketProxy_ConnectionCount(t *testing.T) {
	// Create a WebSocket proxy with a mock pod manager
	mockPM := newMockPodManager()
	proxy := NewWebSocketProxy(mockPM, 1024, 1024, 8080, false, 0)

	// Test the connection tracking methods directly
	computeID := "test-compute-id"

	// Initially should have 0 connections
	if count := proxy.GetConnectionCount(computeID); count != 0 {
		t.Errorf("Expected 0 initial connections, got %d", count)
	}

	// Create mock connections
	conn1 := &websocket.Conn{}
	conn2 := &websocket.Conn{}

	// Add connections
	proxy.trackConnection(computeID, conn1)
	if count := proxy.GetConnectionCount(computeID); count != 1 {
		t.Errorf("Expected 1 connection, got %d", count)
	}

	proxy.trackConnection(computeID, conn2)
	if count := proxy.GetConnectionCount(computeID); count != 2 {
		t.Errorf("Expected 2 connections, got %d", count)
	}

	// Remove connections
	proxy.untrackConnection(computeID, conn1)
	if count := proxy.GetConnectionCount(computeID); count != 1 {
		t.Errorf("Expected 1 connection after removal, got %d", count)
	}

	proxy.untrackConnection(computeID, conn2)
	if count := proxy.GetConnectionCount(computeID); count != 0 {
		t.Errorf("Expected 0 connections after removal, got %d", count)
	}
}

// mockPodManagerWithTeardown extends mockPodManager to track pod deletion
type mockPodManagerWithTeardown struct {
	*mockPodManager
	deletedPods map[string]bool
	deleteCh    chan string
}

func newMockPodManagerWithTeardown() *mockPodManagerWithTeardown {
	return &mockPodManagerWithTeardown{
		mockPodManager: newMockPodManager(),
		deletedPods:    make(map[string]bool),
		deleteCh:       make(chan string, 10),
	}
}

func (m *mockPodManagerWithTeardown) DeletePod(ctx context.Context, computeID string) error {
	m.deletedPods[computeID] = true
	m.deleteCh <- computeID
	return nil
}

func TestWebSocketProxy_AutoTeardown(t *testing.T) {
	// Create a mock pod manager that can track deletions
	mockPM := newMockPodManagerWithTeardown()
	
	// Add a test pod
	computeID := "teardown-test-id"
	mockPM.AddPod(computeID, "10.0.0.1", true)
	
	// Create WebSocket proxy with auto-teardown enabled and NO delay
	proxy := NewWebSocketProxy(mockPM, 1024, 1024, 8080, true, 0)
	
	// Create mock connection
	conn := &websocket.Conn{}
	
	// Track the connection
	proxy.trackConnection(computeID, conn)
	if count := proxy.GetConnectionCount(computeID); count != 1 {
		t.Errorf("Expected 1 connection, got %d", count)
	}
	
	// Untrack the connection - should trigger auto-teardown
	proxy.untrackConnection(computeID, conn)
	
	// Wait for deletion to be recorded (with timeout)
	select {
	case deletedID := <-mockPM.deleteCh:
		if deletedID != computeID {
			t.Errorf("Expected deletion of computeID %s, got %s", computeID, deletedID)
		}
	case <-time.After(1 * time.Second):
		t.Errorf("Timed out waiting for pod deletion")
	}
	
	// Verify the pod was deleted
	if !mockPM.deletedPods[computeID] {
		t.Errorf("Expected pod %s to be deleted", computeID)
	}
}

func TestWebSocketProxy_AutoTeardownWithDelay(t *testing.T) {
	// Create a mock pod manager that can track deletions
	mockPM := newMockPodManagerWithTeardown()
	
	// Add a test pod
	computeID := "teardown-delay-test-id"
	mockPM.AddPod(computeID, "10.0.0.1", true)
	
	// Create WebSocket proxy with auto-teardown enabled and a short delay
	teardownDelay := 200 * time.Millisecond
	proxy := NewWebSocketProxy(mockPM, 1024, 1024, 8080, true, teardownDelay)
	
	// Create mock connection
	conn := &websocket.Conn{}
	
	// Track the connection
	proxy.trackConnection(computeID, conn)
	
	// Untrack the connection - should trigger delayed auto-teardown
	proxy.untrackConnection(computeID, conn)
	
	// Verify deletion hasn't happened immediately
	if mockPM.deletedPods[computeID] {
		t.Errorf("Expected deletion to be delayed, but it happened immediately")
	}
	
	// Wait for deletion to be recorded (with timeout)
	select {
	case deletedID := <-mockPM.deleteCh:
		if deletedID != computeID {
			t.Errorf("Expected deletion of computeID %s, got %s", computeID, deletedID)
		}
	case <-time.After(teardownDelay + 500*time.Millisecond):
		t.Errorf("Timed out waiting for pod deletion")
	}
	
	// Verify the pod was deleted after the delay
	if !mockPM.deletedPods[computeID] {
		t.Errorf("Expected pod %s to be deleted after delay", computeID)
	}
}

func TestWebSocketProxy_CancelTeardownOnNewConnection(t *testing.T) {
	// Create a mock pod manager that can track deletions
	mockPM := newMockPodManagerWithTeardown()
	
	// Add a test pod
	computeID := "teardown-cancel-test-id"
	mockPM.AddPod(computeID, "10.0.0.1", true)
	
	// Create WebSocket proxy with auto-teardown enabled and a delay
	teardownDelay := 300 * time.Millisecond
	proxy := NewWebSocketProxy(mockPM, 1024, 1024, 8080, true, teardownDelay)
	
	// Create mock connections
	conn1 := &websocket.Conn{}
	conn2 := &websocket.Conn{}
	
	// Track the first connection
	proxy.trackConnection(computeID, conn1)
	
	// Untrack the first connection - should trigger delayed auto-teardown
	proxy.untrackConnection(computeID, conn1)
	
	// Add a new connection during the delay period
	time.Sleep(100 * time.Millisecond)
	proxy.trackConnection(computeID, conn2)
	
	// Wait to ensure no deletion happens
	time.Sleep(teardownDelay + 100*time.Millisecond)
	
	// Verify the pod was NOT deleted (teardown should have been canceled)
	if mockPM.deletedPods[computeID] {
		t.Errorf("Expected teardown to be canceled, but pod %s was deleted", computeID)
	}
	
	// Verify we still have an active connection
	if count := proxy.GetConnectionCount(computeID); count != 1 {
		t.Errorf("Expected 1 connection, got %d", count)
	}
	
	// Now remove the second connection
	proxy.untrackConnection(computeID, conn2)
	
	// Wait for deletion to be recorded (with timeout)
	select {
	case <-mockPM.deleteCh:
		// Good, deletion happened
	case <-time.After(teardownDelay + 500*time.Millisecond):
		t.Errorf("Timed out waiting for pod deletion after all connections closed")
	}
}
