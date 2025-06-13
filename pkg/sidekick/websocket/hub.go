package websocket

import (
	"sync"

	"github.com/gorilla/websocket"
)

// Message represents a WebSocket message
type Message struct {
	Type    string      `json:"type"`
	Channel string      `json:"channel"`
	Data    interface{} `json:"data"`
}

// Client represents a WebSocket client
type Client struct {
	ID       string
	Conn     *websocket.Conn
	Send     chan Message
	Channels map[string]bool
	mu       sync.RWMutex
}

// Hub maintains active clients and broadcasts messages
type Hub struct {
	clients    map[string]*Client
	broadcast  chan Message
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
}

// NewHub creates a new WebSocket hub
func NewHub() *Hub {
	return &Hub{
		clients:    make(map[string]*Client),
		broadcast:  make(chan Message),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
}

// Run starts the hub's main loop
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client.ID] = client
			h.mu.Unlock()

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client.ID]; ok {
				delete(h.clients, client.ID)
				close(client.Send)
			}
			h.mu.Unlock()

		case message := <-h.broadcast:
			h.mu.RLock()
			for _, client := range h.clients {
				// Only send to clients subscribed to this channel
				client.mu.RLock()
				subscribed := client.Channels[message.Channel] || message.Channel == ""
				client.mu.RUnlock()

				if subscribed {
					select {
					case client.Send <- message:
					default:
						// Client's send channel is full, close it
						close(client.Send)
						delete(h.clients, client.ID)
					}
				}
			}
			h.mu.RUnlock()
		}
	}
}

// Broadcast sends a message to all connected clients on a specific channel
func (h *Hub) Broadcast(channel string, msgType string, data interface{}) {
	message := Message{
		Type:    msgType,
		Channel: channel,
		Data:    data,
	}
	h.broadcast <- message
}

// BroadcastToClient sends a message to a specific client
func (h *Hub) BroadcastToClient(clientID string, msgType string, data interface{}) {
	h.mu.RLock()
	client, ok := h.clients[clientID]
	h.mu.RUnlock()

	if ok {
		message := Message{
			Type: msgType,
			Data: data,
		}
		select {
		case client.Send <- message:
		default:
			// Client's send channel is full
		}
	}
}

// Subscribe adds a client to a channel
func (h *Hub) Subscribe(clientID, channel string) {
	h.mu.RLock()
	client, ok := h.clients[clientID]
	h.mu.RUnlock()

	if ok {
		client.mu.Lock()
		client.Channels[channel] = true
		client.mu.Unlock()
	}
}

// Unsubscribe removes a client from a channel
func (h *Hub) Unsubscribe(clientID, channel string) {
	h.mu.RLock()
	client, ok := h.clients[clientID]
	h.mu.RUnlock()

	if ok {
		client.mu.Lock()
		delete(client.Channels, channel)
		client.mu.Unlock()
	}
}

// GetClient returns a client by ID
func (h *Hub) GetClient(clientID string) (*Client, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	client, ok := h.clients[clientID]
	return client, ok
}

// GetClients returns all connected clients
func (h *Hub) GetClients() map[string]*Client {
	h.mu.RLock()
	defer h.mu.RUnlock()
	
	// Return a copy to avoid race conditions
	clients := make(map[string]*Client)
	for k, v := range h.clients {
		clients[k] = v
	}
	return clients
}

// ClientCount returns the number of connected clients (for testing)
func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// HasClient checks if a client is registered (for testing)
func (h *Hub) HasClient(clientID string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	_, ok := h.clients[clientID]
	return ok
}

// IsSubscribed checks if a client is subscribed to a channel (for testing)
func (h *Hub) IsSubscribed(clientID, channel string) bool {
	h.mu.RLock()
	client, ok := h.clients[clientID]
	h.mu.RUnlock()
	
	if !ok {
		return false
	}
	
	client.mu.RLock()
	defer client.mu.RUnlock()
	return client.Channels[channel]
}