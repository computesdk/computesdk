package websocket

import (
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		// Configure this based on your security requirements
		return true
	},
}

// Manager handles WebSocket connections and messaging
// MessageHandler is a function that handles a specific message type
type MessageHandler func(Message)

type Manager struct {
	hub      *Hub
	handlers map[string]MessageHandler
}

// NewManager creates a new WebSocket manager
func NewManager() *Manager {
	hub := NewHub()
	go hub.Run()
	
	return &Manager{
		hub:      hub,
		handlers: make(map[string]MessageHandler),
	}
}

// HandleWebSocket upgrades HTTP connections to WebSocket
func (m *Manager) HandleWebSocket(c *gin.Context) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	clientID := uuid.New().String()
	client := &Client{
		ID:       clientID,
		Conn:     conn,
		Send:     make(chan Message, 256),
		Channels: make(map[string]bool),
	}

	m.hub.register <- client

	// Start goroutines for reading and writing
	go client.writePump()
	go client.readPump(m)

	// Send welcome message
	client.Send <- Message{
		Type: "connected",
		Data: gin.H{
			"client_id": clientID,
			"message":   "Connected to WebSocket",
		},
	}
}

// Broadcast sends a message to all clients on a channel
func (m *Manager) Broadcast(channel, msgType string, data interface{}) {
	m.hub.Broadcast(channel, msgType, data)
}

// BroadcastToClient sends a message to a specific client
func (m *Manager) BroadcastToClient(clientID, msgType string, data interface{}) {
	m.hub.BroadcastToClient(clientID, msgType, data)
}

// Subscribe adds a client to a channel
func (m *Manager) Subscribe(clientID, channel string) {
	m.hub.Subscribe(clientID, channel)
}

// Unsubscribe removes a client from a channel
func (m *Manager) Unsubscribe(clientID, channel string) {
	m.hub.Unsubscribe(clientID, channel)
}

// GetHub returns the underlying hub (useful for direct access if needed)
func (m *Manager) GetHub() *Hub {
	return m.hub
}

// Client pump methods

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 512 * 1024 // 512KB
)

// readPump handles incoming messages from the client
func (c *Client) readPump(m *Manager) {
	hub := m.hub
	defer func() {
		hub.unregister <- c
		c.Conn.Close()
	}()

	c.Conn.SetReadLimit(maxMessageSize)
	c.Conn.SetReadDeadline(time.Now().Add(pongWait))
	c.Conn.SetPongHandler(func(string) error {
		c.Conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		var msg Message
		err := c.Conn.ReadJSON(&msg)
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			break
		}

		// Handle different message types
		switch msg.Type {
		case "subscribe":
			if channel, ok := msg.Data.(string); ok {
				hub.Subscribe(c.ID, channel)
			} else if dataMap, ok := msg.Data.(map[string]interface{}); ok {
				// Handle case where data is sent as {"channel": "..."}
				if channel, ok := dataMap["channel"].(string); ok {
					hub.Subscribe(c.ID, channel)
				}
			}
		case "unsubscribe":
			if channel, ok := msg.Data.(string); ok {
				hub.Unsubscribe(c.ID, channel)
			}
		default:
			// Check if there's a registered handler for this message type
			if handler, exists := m.handlers[msg.Type]; exists {
				handler(msg)
			} else {
				// Forward message to other clients in the same channel
				if msg.Channel != "" {
					hub.Broadcast(msg.Channel, msg.Type, msg.Data)
				}
			}
		}
	}
}

// writePump handles sending messages to the client
func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.Send:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			if err := c.Conn.WriteJSON(message); err != nil {
				return
			}

		case <-ticker.C:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
// RegisterHandler registers a handler for a specific message type
func (m *Manager) RegisterHandler(msgType string, handler MessageHandler) {
	m.handlers[msgType] = handler
}
