package testutil

import (
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/require"
)

// Message represents a WebSocket message
type Message struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

// WebSocketClient is a test WebSocket client
type WebSocketClient struct {
	t        *testing.T
	conn     *websocket.Conn
	messages []Message
	mu       sync.RWMutex
	done     chan struct{}
}

// NewWebSocketClient creates a new test WebSocket client
func NewWebSocketClient(t *testing.T, router *gin.Engine, path string) *WebSocketClient {
	server := httptest.NewServer(router)
	t.Cleanup(server.Close)

	// Convert http:// to ws://
	wsURL := strings.Replace(server.URL, "http://", "ws://", 1) + path

	// Connect to WebSocket
	dialer := websocket.Dialer{}
	conn, _, err := dialer.Dial(wsURL, nil)
	require.NoError(t, err)

	client := &WebSocketClient{
		t:        t,
		conn:     conn,
		messages: make([]Message, 0),
		done:     make(chan struct{}),
	}

	// Start message reader
	go client.readMessages()

	return client
}

// readMessages continuously reads messages from the WebSocket
func (c *WebSocketClient) readMessages() {
	defer close(c.done)

	for {
		var msg Message
		err := c.conn.ReadJSON(&msg)
		if err != nil {
			if websocket.IsCloseError(err, websocket.CloseNormalClosure) {
				return
			}
			// Connection closed
			return
		}

		c.mu.Lock()
		c.messages = append(c.messages, msg)
		c.mu.Unlock()
	}
}

// Send sends a message to the WebSocket
func (c *WebSocketClient) Send(msgType string, data interface{}) {
	msg := Message{
		Type: msgType,
		Data: data,
	}

	err := c.conn.WriteJSON(msg)
	require.NoError(c.t, err)
}

// Subscribe subscribes to a channel
func (c *WebSocketClient) Subscribe(channel string) {
	c.Send("subscribe", map[string]interface{}{
		"channel": channel,
	})
}

// SendTerminalInput sends input to a terminal
func (c *WebSocketClient) SendTerminalInput(terminalID, input string) {
	c.Send("terminal:input", map[string]interface{}{
		"terminal_id": terminalID,
		"input":       input,
	})
}

// SendTerminalResize sends a resize command to a terminal
func (c *WebSocketClient) SendTerminalResize(terminalID string, rows, cols uint16) {
	c.Send("terminal:resize", map[string]interface{}{
		"terminal_id": terminalID,
		"rows":        rows,
		"cols":        cols,
	})
}

// WaitForMessage waits for a message of a specific type
func (c *WebSocketClient) WaitForMessage(msgType string, timeout time.Duration) (*Message, bool) {
	deadline := time.Now().Add(timeout)

	for time.Now().Before(deadline) {
		c.mu.RLock()
		for _, msg := range c.messages {
			if msg.Type == msgType {
				c.mu.RUnlock()
				return &msg, true
			}
		}
		c.mu.RUnlock()

		time.Sleep(10 * time.Millisecond)
	}

	return nil, false
}

// WaitForMessages waits for a specific number of messages
func (c *WebSocketClient) WaitForMessages(count int, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)

	for time.Now().Before(deadline) {
		c.mu.RLock()
		if len(c.messages) >= count {
			c.mu.RUnlock()
			return true
		}
		c.mu.RUnlock()

		time.Sleep(10 * time.Millisecond)
	}

	return false
}

// GetMessages returns all received messages
func (c *WebSocketClient) GetMessages() []Message {
	c.mu.RLock()
	defer c.mu.RUnlock()

	// Return a copy
	msgs := make([]Message, len(c.messages))
	copy(msgs, c.messages)
	return msgs
}

// ClearMessages clears all stored messages
func (c *WebSocketClient) ClearMessages() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.messages = c.messages[:0]
}

// Close closes the WebSocket connection
func (c *WebSocketClient) Close() {
	c.conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
	c.conn.Close()
	<-c.done
}

// AssertMessageReceived asserts that a message of a specific type was received
func (c *WebSocketClient) AssertMessageReceived(msgType string, timeout time.Duration) Message {
	msg, found := c.WaitForMessage(msgType, timeout)
	require.True(c.t, found, "Expected to receive message of type %s", msgType)
	return *msg
}

// AssertTerminalOutput asserts that terminal output was received
func (c *WebSocketClient) AssertTerminalOutput(terminalID string, expectedOutput string, timeout time.Duration) {
	deadline := time.Now().Add(timeout)

	for time.Now().Before(deadline) {
		c.mu.RLock()
		for _, msg := range c.messages {
			if msg.Type == "terminal:output" {
				if data, ok := msg.Data.(map[string]interface{}); ok {
					if id, _ := data["terminal_id"].(string); id == terminalID {
						if output, _ := data["output"].(string); strings.Contains(output, expectedOutput) {
							c.mu.RUnlock()
							return
						}
					}
				}
			}
		}
		c.mu.RUnlock()

		time.Sleep(10 * time.Millisecond)
	}

	c.t.Fatalf("Did not receive expected terminal output '%s' for terminal %s", expectedOutput, terminalID)
}
