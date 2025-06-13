package websocket

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/heysnelling/computesdk/pkg/sidekick/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewManager(t *testing.T) {
	manager := NewManager()
	
	assert.NotNil(t, manager)
	assert.NotNil(t, manager.hub)
	assert.NotNil(t, manager.handlers)
}

func TestManager_GetHub(t *testing.T) {
	manager := NewManager()
	hub := manager.GetHub()
	
	assert.NotNil(t, hub)
	assert.Equal(t, manager.hub, hub)
}

func TestManager_Broadcast(t *testing.T) {
	manager := NewManager()
	
	// Create a test client
	client := &Client{
		ID:       "test-client",
		Send:     make(chan Message, 10),
		Channels: map[string]bool{"test-channel": true},
	}
	
	// Register client directly with hub
	manager.hub.register <- client
	
	// Wait for client to be registered
	testutil.RequireCondition(t, func() bool {
		return manager.hub.HasClient("test-client")
	}, 1*time.Second, "client should be registered")
	
	// Broadcast message
	manager.Broadcast("test-channel", "test-type", "test-data")
	
	// Check message was received
	msg, ok := testutil.WaitForWebSocketMessage(t, client.Send, 100*time.Millisecond)
	require.True(t, ok, "Client should receive broadcast message")
	assert.Equal(t, "test-type", msg.Type)
	assert.Equal(t, "test-channel", msg.Channel)
	assert.Equal(t, "test-data", msg.Data)
}

func TestManager_BroadcastToClient(t *testing.T) {
	manager := NewManager()
	
	// Create test clients
	client1 := &Client{
		ID:   "client-1",
		Send: make(chan Message, 10),
	}
	client2 := &Client{
		ID:   "client-2",
		Send: make(chan Message, 10),
	}
	
	// Register clients
	manager.hub.register <- client1
	manager.hub.register <- client2
	
	// Wait for clients to be registered
	testutil.RequireCondition(t, func() bool {
		return manager.hub.ClientCount() == 2
	}, 1*time.Second, "both clients should be registered")
	
	// Broadcast to specific client
	manager.BroadcastToClient("client-1", "direct-message", "private-data")
	
	// Check only client1 received message
	msg, ok := testutil.WaitForWebSocketMessage(t, client1.Send, 100*time.Millisecond)
	require.True(t, ok, "client1 should receive direct message")
	assert.Equal(t, "direct-message", msg.Type)
	assert.Equal(t, "private-data", msg.Data)
	
	select {
	case <-client2.Send:
		t.Fatal("client2 should not have received message")
	default:
		// Expected
	}
}

func TestManager_SubscribeUnsubscribe(t *testing.T) {
	manager := NewManager()
	
	client := &Client{
		ID:       "test-client",
		Send:     make(chan Message, 10),
		Channels: make(map[string]bool),
	}
	
	// Register client
	manager.hub.register <- client
	
	// Wait for registration
	testutil.RequireCondition(t, func() bool {
		return manager.hub.HasClient("test-client")
	}, 1*time.Second, "client should be registered")
	
	// Subscribe
	manager.Subscribe("test-client", "test-channel")
	
	// Wait for subscription
	testutil.RequireCondition(t, func() bool {
		return manager.hub.IsSubscribed("test-client", "test-channel")
	}, 1*time.Second, "client should be subscribed")
	
	// Check subscription
	client.mu.RLock()
	subscribed := client.Channels["test-channel"]
	client.mu.RUnlock()
	assert.True(t, subscribed)
	
	// Unsubscribe
	manager.Unsubscribe("test-client", "test-channel")
	time.Sleep(10 * time.Millisecond)
	
	// Check unsubscription
	client.mu.RLock()
	_, exists := client.Channels["test-channel"]
	client.mu.RUnlock()
	assert.False(t, exists)
}

func TestManager_RegisterHandler(t *testing.T) {
	manager := NewManager()
	
	handlerCalled := false
	var receivedMessage Message
	
	handler := func(msg Message) {
		handlerCalled = true
		receivedMessage = msg
	}
	
	// Register handler
	manager.RegisterHandler("custom-type", handler)
	
	// Verify handler was registered
	assert.Contains(t, manager.handlers, "custom-type")
	
	// Test handler is called
	testMsg := Message{Type: "custom-type", Data: "test-data"}
	manager.handlers["custom-type"](testMsg)
	
	assert.True(t, handlerCalled)
	assert.Equal(t, testMsg, receivedMessage)
}

// Test WebSocket upgrade functionality
func TestManager_HandleWebSocket(t *testing.T) {
	gin.SetMode(gin.TestMode)
	
	manager := NewManager()
	router := gin.New()
	router.GET("/ws", manager.HandleWebSocket)
	
	server := httptest.NewServer(router)
	defer server.Close()
	
	// Convert HTTP URL to WebSocket URL
	wsURL := strings.Replace(server.URL, "http://", "ws://", 1) + "/ws"
	
	// Connect to WebSocket
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.NoError(t, err)
	defer conn.Close()
	
	// Read welcome message
	var welcomeMsg Message
	err = conn.ReadJSON(&welcomeMsg)
	require.NoError(t, err)
	
	assert.Equal(t, "connected", welcomeMsg.Type)
	assert.NotNil(t, welcomeMsg.Data)
	
	// Verify client was registered in hub
	clients := manager.hub.GetClients()
	assert.Len(t, clients, 1)
}

// Test message handling in readPump
func TestClient_MessageHandling(t *testing.T) {
	gin.SetMode(gin.TestMode)
	
	manager := NewManager()
	
	// Register a custom handler
	handlerCalled := false
	var handlerMessage Message
	manager.RegisterHandler("custom-message", func(msg Message) {
		handlerCalled = true
		handlerMessage = msg
	})
	
	router := gin.New()
	router.GET("/ws", manager.HandleWebSocket)
	
	server := httptest.NewServer(router)
	defer server.Close()
	
	wsURL := strings.Replace(server.URL, "http://", "ws://", 1) + "/ws"
	
	// Connect to WebSocket
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.NoError(t, err)
	defer conn.Close()
	
	// Read welcome message
	var welcomeMsg Message
	err = conn.ReadJSON(&welcomeMsg)
	require.NoError(t, err)
	
	// Send custom message
	customMsg := Message{
		Type: "custom-message",
		Data: "test-data",
	}
	err = conn.WriteJSON(customMsg)
	require.NoError(t, err)
	
	// Wait for handler to be called
	time.Sleep(50 * time.Millisecond)
	
	assert.True(t, handlerCalled)
	assert.Equal(t, "custom-message", handlerMessage.Type)
	assert.Equal(t, "test-data", handlerMessage.Data)
}

// Test subscription via WebSocket messages
func TestClient_SubscriptionMessages(t *testing.T) {
	gin.SetMode(gin.TestMode)
	
	manager := NewManager()
	router := gin.New()
	router.GET("/ws", manager.HandleWebSocket)
	
	server := httptest.NewServer(router)
	defer server.Close()
	
	wsURL := strings.Replace(server.URL, "http://", "ws://", 1) + "/ws"
	
	// Connect to WebSocket
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.NoError(t, err)
	defer conn.Close()
	
	// Read welcome message
	var welcomeMsg Message
	err = conn.ReadJSON(&welcomeMsg)
	require.NoError(t, err)
	
	// Extract client ID from welcome message
	data, ok := welcomeMsg.Data.(map[string]interface{})
	require.True(t, ok)
	clientID, ok := data["client_id"].(string)
	require.True(t, ok)
	
	// Send subscription message
	subscribeMsg := Message{
		Type: "subscribe",
		Data: "test-channel",
	}
	err = conn.WriteJSON(subscribeMsg)
	require.NoError(t, err)
	
	time.Sleep(50 * time.Millisecond)
	
	// Verify client is subscribed
	client, exists := manager.hub.GetClient(clientID)
	require.True(t, exists)
	
	client.mu.RLock()
	subscribed := client.Channels["test-channel"]
	client.mu.RUnlock()
	assert.True(t, subscribed)
	
	// Send unsubscribe message
	unsubscribeMsg := Message{
		Type: "unsubscribe",
		Data: "test-channel",
	}
	err = conn.WriteJSON(unsubscribeMsg)
	require.NoError(t, err)
	
	time.Sleep(50 * time.Millisecond)
	
	// Verify client is unsubscribed
	client.mu.RLock()
	_, exists = client.Channels["test-channel"]
	client.mu.RUnlock()
	assert.False(t, exists)
}

// Test message broadcasting between clients
func TestClient_MessageBroadcasting(t *testing.T) {
	gin.SetMode(gin.TestMode)
	
	manager := NewManager()
	router := gin.New()
	router.GET("/ws", manager.HandleWebSocket)
	
	server := httptest.NewServer(router)
	defer server.Close()
	
	wsURL := strings.Replace(server.URL, "http://", "ws://", 1) + "/ws"
	
	// Connect first client
	conn1, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.NoError(t, err)
	defer conn1.Close()
	
	// Connect second client
	conn2, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.NoError(t, err)
	defer conn2.Close()
	
	// Read welcome messages
	var welcomeMsg1, welcomeMsg2 Message
	err = conn1.ReadJSON(&welcomeMsg1)
	require.NoError(t, err)
	err = conn2.ReadJSON(&welcomeMsg2)
	require.NoError(t, err)
	
	// Subscribe both clients to same channel
	subscribeMsg := Message{
		Type: "subscribe",
		Data: "broadcast-channel",
	}
	
	err = conn1.WriteJSON(subscribeMsg)
	require.NoError(t, err)
	err = conn2.WriteJSON(subscribeMsg)
	require.NoError(t, err)
	
	time.Sleep(50 * time.Millisecond)
	
	// Send message from client1 to the channel
	broadcastMsg := Message{
		Type:    "chat-message",
		Channel: "broadcast-channel",
		Data:    "Hello from client1",
	}
	err = conn1.WriteJSON(broadcastMsg)
	require.NoError(t, err)
	
	// Client2 should receive the message
	var receivedMsg Message
	conn2.SetReadDeadline(time.Now().Add(2 * time.Second))
	err = conn2.ReadJSON(&receivedMsg)
	require.NoError(t, err)
	
	assert.Equal(t, "chat-message", receivedMsg.Type)
	assert.Equal(t, "broadcast-channel", receivedMsg.Channel)
	assert.Equal(t, "Hello from client1", receivedMsg.Data)
}

// Test connection cleanup on disconnect
func TestClient_ConnectionCleanup(t *testing.T) {
	gin.SetMode(gin.TestMode)
	
	manager := NewManager()
	router := gin.New()
	router.GET("/ws", manager.HandleWebSocket)
	
	server := httptest.NewServer(router)
	defer server.Close()
	
	wsURL := strings.Replace(server.URL, "http://", "ws://", 1) + "/ws"
	
	// Connect and immediately disconnect
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.NoError(t, err)
	
	// Read welcome message to get client ID
	var welcomeMsg Message
	err = conn.ReadJSON(&welcomeMsg)
	require.NoError(t, err)
	
	data, ok := welcomeMsg.Data.(map[string]interface{})
	require.True(t, ok)
	clientID, ok := data["client_id"].(string)
	require.True(t, ok)
	
	// Wait for client to be registered
	testutil.RequireCondition(t, func() bool {
		_, exists := manager.hub.GetClient(clientID)
		return exists
	}, 1*time.Second, "client should be registered")
	
	// Close connection
	conn.Close()
	
	// Wait for cleanup
	time.Sleep(100 * time.Millisecond)
	
	// Verify client is cleaned up
	_, exists := manager.hub.GetClient(clientID)
	assert.False(t, exists)
}