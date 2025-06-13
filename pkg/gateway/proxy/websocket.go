package proxy

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	k8s "github.com/heysnelling/computesdk/pkg/k8s"
)

// WebSocketProxy handles WebSocket connections to compute pods
type WebSocketProxy struct {
	podManager  k8s.ComputeManagerInterface
	upgrader    websocket.Upgrader
	defaultPort int

	// Connection tracking
	connections      map[string]map[*websocket.Conn]bool
	connectionsMutex sync.RWMutex

	// Auto-teardown configuration
	autoTeardownEnabled bool
	teardownDelay       time.Duration
}

// NewWebSocketProxy creates a new WebSocket proxy
func NewWebSocketProxy(podManager k8s.ComputeManagerInterface, readBufferSize, writeBufferSize, defaultPort int, autoTeardown bool, teardownDelay time.Duration) *WebSocketProxy {
	return &WebSocketProxy{
		podManager: podManager,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  readBufferSize,
			WriteBufferSize: writeBufferSize,
			CheckOrigin: func(r *http.Request) bool {
				return true // Allow all origins for now
			},
		},
		connections:         make(map[string]map[*websocket.Conn]bool),
		defaultPort:         defaultPort,
		autoTeardownEnabled: autoTeardown,
		teardownDelay:       teardownDelay,
	}
}

// ServeHTTP handles WebSocket connection requests
func (wp *WebSocketProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Extract compute ID from the request
	computeID := ExtractComputeID(r)
	if computeID == "" {
		log.Printf("ERROR: Missing compute ID in WebSocket request: %s %s", r.Method, r.URL.String())
		http.Error(w, "Missing compute ID", http.StatusBadRequest)
		return
	}

	log.Printf("INFO: WebSocket connection request for compute ID: %s, path: %s, host: %s", computeID, r.URL.Path, r.Host)

	// Get the target pod
	pod, err := wp.podManager.GetPod(r.Context(), computeID)
	if err != nil {
		log.Printf("ERROR: Finding pod for compute ID %s: %v", computeID, err)
		http.Error(w, "Pod not found", http.StatusNotFound)
		return
	}

	// Check if pod is ready
	if !pod.IsReady || pod.IP == "" {
		log.Printf("ERROR: Pod %s is not ready or has no IP. Ready: %v, IP: %s", pod.Name, pod.IsReady, pod.IP)
		http.Error(w, "Pod not ready", http.StatusServiceUnavailable)
		return
	}

	log.Printf("INFO: Found pod for compute ID %s: name=%s, ip=%s, ready=%v", computeID, pod.Name, pod.IP, pod.IsReady)

	// Default port for WebSocket connections (can be configured)
	port := wp.defaultPort

	// Construct target URL
	targetURL := url.URL{
		Scheme: "ws",
		Host:   fmt.Sprintf("%s:%d", pod.IP, port),
		Path:   "ws", // WebSocket endpoint on the runtime pod
	}

	log.Printf("INFO: Proxying WebSocket to %s for compute ID %s (pod name: %s)", targetURL.String(), computeID, pod.Name)

	// Connect to the pod's WebSocket
	log.Printf("DEBUG: Dialing WebSocket to %s", targetURL.String())
	podConn, resp, err := websocket.DefaultDialer.Dial(targetURL.String(), nil)

	if err != nil {
		statusCode := http.StatusInternalServerError
		errorMsg := fmt.Sprintf("Error connecting to pod WebSocket: %v", err)

		if resp != nil {
			statusCode = resp.StatusCode
			log.Printf("ERROR: WebSocket dial response: status=%d, headers=%v", resp.StatusCode, resp.Header)
		}

		log.Printf("ERROR: %s", errorMsg)
		http.Error(w, errorMsg, statusCode)
		return
	}

	log.Printf("INFO: Successfully connected to pod WebSocket at %s", targetURL.String())

	// Upgrade the client connection
	log.Printf("DEBUG: Upgrading client connection to WebSocket")
	clientConn, err := wp.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ERROR: Upgrading client connection: %v", err)
		podConn.Close()
		return
	}
	log.Printf("INFO: Successfully upgraded client connection to WebSocket")

	// Track the connection
	wp.trackConnection(computeID, clientConn)
	defer wp.untrackConnection(computeID, clientConn)

	// Set up bidirectional message proxying
	errCh := make(chan error, 2)

	// Forward from client to pod
	go forwardMessages(clientConn, podConn, errCh, "client → pod")

	// Forward from pod to client
	go forwardMessages(podConn, clientConn, errCh, "pod → client")

	// Wait for an error from either direction
	err = <-errCh
	if err != nil {
		log.Printf("ERROR: WebSocket proxy error for compute ID %s: %v", computeID, err)
	} else {
		log.Printf("INFO: WebSocket proxy closed gracefully for compute ID %s", computeID)
	}
}

// GetConnectionCount returns the number of active connections for a compute ID
func (wp *WebSocketProxy) GetConnectionCount(computeID string) int {
	wp.connectionsMutex.RLock()
	defer wp.connectionsMutex.RUnlock()

	if conns, exists := wp.connections[computeID]; exists {
		return len(conns)
	}
	return 0
}

// trackConnection adds a connection to the tracking map
func (wp *WebSocketProxy) trackConnection(computeID string, conn *websocket.Conn) {
	wp.connectionsMutex.Lock()
	defer wp.connectionsMutex.Unlock()

	if _, exists := wp.connections[computeID]; !exists {
		wp.connections[computeID] = make(map[*websocket.Conn]bool)
	}

	wp.connections[computeID][conn] = true
	log.Printf("Connection tracked for compute ID %s (total: %d)",
		computeID, len(wp.connections[computeID]))
}

// untrackConnection removes a connection from the tracking map
func (wp *WebSocketProxy) untrackConnection(computeID string, conn *websocket.Conn) {
	wp.connectionsMutex.Lock()
	defer wp.connectionsMutex.Unlock()

	if conns, exists := wp.connections[computeID]; exists {
		delete(conns, conn)
		log.Printf("Connection untracked for compute ID %s (remaining: %d)",
			computeID, len(conns))

		// If this was the last connection and auto-teardown is enabled
		if len(conns) == 0 && wp.autoTeardownEnabled {
			delete(wp.connections, computeID)

			// Call DeletePod after a delay (optional)
			if wp.teardownDelay > 0 {
				go func() {
					log.Printf("Scheduling teardown for compute ID %s in %v", computeID, wp.teardownDelay)
					time.Sleep(wp.teardownDelay)

					// Check if new connections have been established during the delay
					wp.connectionsMutex.RLock()
					_, hasNewConnections := wp.connections[computeID]
					wp.connectionsMutex.RUnlock()

					if !hasNewConnections {
						wp.triggerTeardown(computeID)
					} else {
						log.Printf("Canceling teardown for compute ID %s - new connections detected", computeID)
					}
				}()
			} else {
				// Immediate teardown
				go wp.triggerTeardown(computeID)
			}
		} else if len(conns) == 0 {
			// Just clean up the map if auto-teardown is disabled
			delete(wp.connections, computeID)
		}
	}
}

// triggerTeardown handles the actual pod deletion
func (wp *WebSocketProxy) triggerTeardown(computeID string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	log.Printf("Triggering teardown for compute ID %s with no active connections", computeID)
	err := wp.podManager.DeletePod(ctx, computeID)
	if err != nil {
		log.Printf("ERROR: Failed to teardown compute ID %s: %v", computeID, err)
	} else {
		log.Printf("SUCCESS: Teardown completed for compute ID %s", computeID)
	}
}

// forwardMessages forwards WebSocket messages from one connection to another
func forwardMessages(src, dst *websocket.Conn, errCh chan error, direction string) {
	for {
		messageType, message, err := src.ReadMessage()
		if err != nil {
			// Don't log the usual close errors as errors
			if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				log.Printf("INFO: WebSocket closed normally (%s): %v", direction, err)
			} else {
				log.Printf("ERROR: Reading from WebSocket (%s): %v", direction, err)
			}
			errCh <- err
			break
		}

		log.Printf("DEBUG: WebSocket message received (%s): type=%d, size=%d bytes",
			direction, messageType, len(message))

		err = dst.WriteMessage(messageType, message)
		if err != nil {
			log.Printf("ERROR: Writing to WebSocket (%s): %v", direction, err)
			errCh <- err
			break
		}

		log.Printf("DEBUG: WebSocket message forwarded (%s): type=%d, size=%d bytes",
			direction, messageType, len(message))
	}
}
