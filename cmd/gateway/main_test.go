package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/heysnelling/computesdk/pkg/gateway/config"
	"github.com/heysnelling/computesdk/pkg/gateway/proxy"
	k8s "github.com/heysnelling/computesdk/pkg/k8s"
)

// Helper error functions to match the ones used in the k8s package
func errPodNotFound(computeID string) error {
	return fmt.Errorf("pod not found for compute ID: %s", computeID)
}

// func errPodNotReady(podName string) error {
// return fmt.Errorf("pod %s is not ready", podName)
// }

// Mock PodManager for testing
type mockPodManager struct {
	pods map[string]*k8s.PodInfo
}

func newMockPodManager() *mockPodManager {
	return &mockPodManager{
		pods: make(map[string]*k8s.PodInfo),
	}
}

func (m *mockPodManager) GetPod(ctx context.Context, computeID string) (*k8s.PodInfo, error) {
	if pod, exists := m.pods[computeID]; exists {
		return pod, nil
	}
	return nil, errPodNotFound(computeID)
}

func (m *mockPodManager) ListPods() ([]*k8s.PodInfo, error) {
	pods := make([]*k8s.PodInfo, 0, len(m.pods))
	for _, pod := range m.pods {
		pods = append(pods, pod)
	}
	return pods, nil
}

func (m *mockPodManager) DeletePod(ctx context.Context, computeID string) error {
	return nil
}

func (m *mockPodManager) AddPod(computeID, podIP string, isReady bool) {
	m.pods[computeID] = &k8s.PodInfo{
		Name:      "pod-" + computeID,
		IP:        podIP,
		ComputeID: computeID,
		IsReady:   isReady,
	}
}

// TestSetupRouter tests the router setup
func TestSetupRouter(t *testing.T) {
	// Create mock pod manager
	mockPM := newMockPodManager()
	mockPM.AddPod("test-compute-id", "127.0.0.1", true)
	mockPM.AddPod("not-ready-id", "127.0.0.1", false)

	// Create HTTP and WebSocket proxies
	httpProxy := proxy.NewHTTPProxy(mockPM, 1024*1024, 8080, false)
	wsProxy := proxy.NewWebSocketProxy(mockPM, 1024, 1024, 8080, false, 0)

	// Create test mux
	mux := http.NewServeMux()

	// Setup routes like in main
	mux.Handle("/", httpProxy)
	mux.Handle("/ws/", wsProxy)

	// Test HTTP proxy route
	t.Run("HTTP Proxy Route", func(t *testing.T) {
		// Create a request to a compute pod
		req := httptest.NewRequest("GET", "http://test-compute-id.preview.computesdk.com/api", nil)
		req.Host = "test-compute-id.preview.computesdk.com"

		// Create a ResponseRecorder to record the response
		rr := httptest.NewRecorder()

		// Serve the request
		mux.ServeHTTP(rr, req)

		// We expect a 502 Bad Gateway since we can't actually connect to the pod in the test
		if rr.Code != http.StatusBadGateway {
			t.Errorf("Expected status code %d, got %d", http.StatusBadGateway, rr.Code)
		}

		// The response should contain "Proxy error"
		if !strings.Contains(rr.Body.String(), "Proxy error") {
			t.Errorf("Expected response body to contain 'Proxy error', got: %s", rr.Body.String())
		}
	})

	// Test WebSocket proxy route
	t.Run("WebSocket Proxy Route", func(t *testing.T) {
		// Create a request to the WebSocket endpoint
		req := httptest.NewRequest("GET", "http://test-compute-id.preview.computesdk.com/ws/", nil)
		req.Host = "test-compute-id.preview.computesdk.com"

		// Add WebSocket headers
		req.Header.Add("Connection", "Upgrade")
		req.Header.Add("Upgrade", "websocket")
		req.Header.Add("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
		req.Header.Add("Sec-WebSocket-Version", "13")

		// Create a ResponseRecorder to record the response
		rr := httptest.NewRecorder()

		// Serve the request
		mux.ServeHTTP(rr, req)

		// We expect a 500 Internal Server Error since we can't connect to the WebSocket in this test
		if rr.Code != http.StatusInternalServerError {
			t.Errorf("Expected status code %d, got %d", http.StatusInternalServerError, rr.Code)
		}
	})

	// Test missing compute ID
	t.Run("Missing Compute ID", func(t *testing.T) {
		req := httptest.NewRequest("GET", "http://computesdk.com/api", nil)
		req.Host = "computesdk.com"

		rr := httptest.NewRecorder()
		mux.ServeHTTP(rr, req)

		if rr.Code != http.StatusBadRequest {
			t.Errorf("Expected status code %d for missing compute ID, got %d", http.StatusBadRequest, rr.Code)
		}

		if !strings.Contains(rr.Body.String(), "Missing compute ID") {
			t.Errorf("Expected 'Missing compute ID' in response, got: %s", rr.Body.String())
		}
	})

	// Test pod not found
	t.Run("Pod Not Found", func(t *testing.T) {
		req := httptest.NewRequest("GET", "http://non-existent.preview.computesdk.com/api", nil)
		req.Host = "non-existent.preview.computesdk.com"

		rr := httptest.NewRecorder()
		mux.ServeHTTP(rr, req)

		if rr.Code != http.StatusNotFound {
			t.Errorf("Expected status code %d for pod not found, got %d", http.StatusNotFound, rr.Code)
		}

		if !strings.Contains(rr.Body.String(), "Pod not found") {
			t.Errorf("Expected 'Pod not found' in response, got: %s", rr.Body.String())
		}
	})

	// Test pod not ready
	t.Run("Pod Not Ready", func(t *testing.T) {
		req := httptest.NewRequest("GET", "http://not-ready-id.preview.computesdk.com/api", nil)
		req.Host = "not-ready-id.preview.computesdk.com"

		rr := httptest.NewRecorder()
		mux.ServeHTTP(rr, req)

		if rr.Code != http.StatusServiceUnavailable {
			t.Errorf("Expected status code %d for pod not ready, got %d", http.StatusServiceUnavailable, rr.Code)
		}

		if !strings.Contains(rr.Body.String(), "Pod not ready") {
			t.Errorf("Expected 'Pod not ready' in response, got: %s", rr.Body.String())
		}
	})
}

// TestLoadConfig tests that the config is loaded correctly
func TestLoadConfig(t *testing.T) {
	// We'll just do a simple test that the config loads
	cfg := config.Load()

	if cfg == nil {
		t.Errorf("Expected config to be loaded, got nil")
		return
	}

	// Make sure default port is set
	if cfg.Port == "" {
		t.Errorf("Expected Port to be set, got empty string")
	}
}
