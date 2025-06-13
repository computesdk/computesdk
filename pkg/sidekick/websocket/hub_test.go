package websocket

import (
	"sync"
	"testing"
	"time"

	"fmt"

	"github.com/heysnelling/computesdk/pkg/sidekick/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewHub(t *testing.T) {
	hub := NewHub()
	
	assert.NotNil(t, hub)
	assert.NotNil(t, hub.clients)
	assert.NotNil(t, hub.broadcast)
	assert.NotNil(t, hub.register)
	assert.NotNil(t, hub.unregister)
}

func TestHub_ClientRegistration(t *testing.T) {
	hub := NewHub()
	
	// Start hub in background
	done := make(chan bool)
	go func() {
		defer close(done)
		hub.Run()
	}()
	
	client := &Client{
		ID:       "test-client-1",
		Send:     make(chan Message, 1),
		Channels: make(map[string]bool),
	}
	
	// Register client
	hub.register <- client
	
	// Wait for client to be registered
	testutil.RequireCondition(t, func() bool {
		return hub.HasClient("test-client-1")
	}, 1*time.Second, "client should be registered")
	
	// Check client was registered
	retrievedClient, exists := hub.GetClient("test-client-1")
	assert.True(t, exists)
	assert.Equal(t, client, retrievedClient)
}

func TestHub_ClientUnregistration(t *testing.T) {
	hub := NewHub()
	
	// Start hub in background
	go hub.Run()
	
	client := &Client{
		ID:       "test-client-1",
		Send:     make(chan Message, 1),
		Channels: make(map[string]bool),
	}
	
	// Register client
	hub.register <- client
	
	// Wait for registration
	testutil.RequireCondition(t, func() bool {
		return hub.HasClient("test-client-1")
	}, 1*time.Second, "client should be registered")
	
	// Unregister client
	hub.unregister <- client
	
	// Wait for unregistration
	testutil.RequireCondition(t, func() bool {
		return !hub.HasClient("test-client-1")
	}, 1*time.Second, "client should be unregistered")
}

func TestHub_MessageBroadcasting(t *testing.T) {
	hub := NewHub()
	
	// Start hub in background
	go hub.Run()
	
	// Create test clients
	client1 := &Client{
		ID:       "client-1",
		Send:     make(chan Message, 10),
		Channels: map[string]bool{"test-channel": true},
	}
	
	client2 := &Client{
		ID:       "client-2",
		Send:     make(chan Message, 10),
		Channels: map[string]bool{"test-channel": true},
	}
	
	client3 := &Client{
		ID:       "client-3",
		Send:     make(chan Message, 10),
		Channels: map[string]bool{"other-channel": true},
	}
	
	// Register clients
	hub.register <- client1
	hub.register <- client2
	hub.register <- client3
	
	// Wait for all clients to be registered
	testutil.RequireCondition(t, func() bool {
		return hub.ClientCount() == 3
	}, 1*time.Second, "all clients should be registered")
	
	// Broadcast message to test-channel
	hub.Broadcast("test-channel", "test-message", "test-data")
	
	// Use timeout for receiving messages
	timeout := 100 * time.Millisecond
	
	// Check client1 and client2 received message
	msg1, ok := testutil.WaitForWebSocketMessage(t, client1.Send, timeout)
	require.True(t, ok, "client1 should receive message")
	assert.Equal(t, "test-message", msg1.Type)
	assert.Equal(t, "test-channel", msg1.Channel)
	assert.Equal(t, "test-data", msg1.Data)
	
	msg2, ok := testutil.WaitForWebSocketMessage(t, client2.Send, timeout)
	require.True(t, ok, "client2 should receive message")
	assert.Equal(t, "test-message", msg2.Type)
	assert.Equal(t, "test-channel", msg2.Channel)
	assert.Equal(t, "test-data", msg2.Data)
	
	// Check client3 did not receive message
	select {
	case <-client3.Send:
		t.Fatal("client3 should not have received message")
	default:
		// Expected - client3 is not subscribed to test-channel
	}
}

func TestHub_BroadcastToSpecificClient(t *testing.T) {
	hub := NewHub()
	
	// Start hub in background
	go hub.Run()
	
	client1 := &Client{
		ID:       "client-1",
		Send:     make(chan Message, 10),
		Channels: make(map[string]bool),
	}
	
	client2 := &Client{
		ID:       "client-2",
		Send:     make(chan Message, 10),
		Channels: make(map[string]bool),
	}
	
	// Register clients
	hub.register <- client1
	hub.register <- client2
	
	// Wait for clients to be registered
	testutil.RequireCondition(t, func() bool {
		return hub.ClientCount() == 2
	}, 1*time.Second, "both clients should be registered")
	
	// Send message to specific client
	hub.BroadcastToClient("client-1", "direct-message", "private-data")
	
	// Check client1 received message
	msg, ok := testutil.WaitForWebSocketMessage(t, client1.Send, 100*time.Millisecond)
	require.True(t, ok, "client1 should receive direct message")
	assert.Equal(t, "direct-message", msg.Type)
	assert.Equal(t, "private-data", msg.Data)
	
	// Check client2 did not receive message
	select {
	case <-client2.Send:
		t.Fatal("client2 should not have received direct message")
	default:
		// Expected
	}
}

func TestHub_SubscriptionManagement(t *testing.T) {
	hub := NewHub()
	
	// Start hub in background
	go hub.Run()
	
	client := &Client{
		ID:       "test-client",
		Send:     make(chan Message, 10),
		Channels: make(map[string]bool),
	}
	
	// Register client
	hub.register <- client
	
	// Wait for registration
	testutil.RequireCondition(t, func() bool {
		return hub.HasClient("test-client")
	}, 1*time.Second, "client should be registered")
	
	// Subscribe to channel
	hub.Subscribe("test-client", "new-channel")
	
	// Wait for subscription
	testutil.RequireCondition(t, func() bool {
		return hub.IsSubscribed("test-client", "new-channel")
	}, 1*time.Second, "client should be subscribed")
	
	// Check subscription
	client.mu.RLock()
	subscribed := client.Channels["new-channel"]
	client.mu.RUnlock()
	assert.True(t, subscribed)
	
	// Unsubscribe from channel
	hub.Unsubscribe("test-client", "new-channel")
	
	// Wait for unsubscription
	testutil.RequireCondition(t, func() bool {
		return !hub.IsSubscribed("test-client", "new-channel")
	}, 1*time.Second, "client should be unsubscribed")
}

func TestHub_GetClients(t *testing.T) {
	hub := NewHub()
	
	// Start hub in background
	go hub.Run()
	
	client1 := &Client{
		ID:       "client-1",
		Send:     make(chan Message, 1),
		Channels: make(map[string]bool),
	}
	
	client2 := &Client{
		ID:       "client-2",
		Send:     make(chan Message, 1),
		Channels: make(map[string]bool),
	}
	
	// Register clients
	hub.register <- client1
	hub.register <- client2
	
	// Wait for clients to be registered
	testutil.RequireCondition(t, func() bool {
		return hub.ClientCount() == 2
	}, 1*time.Second, "both clients should be registered")
	
	// Get all clients
	clients := hub.GetClients()
	
	assert.Len(t, clients, 2)
	assert.Contains(t, clients, "client-1")
	assert.Contains(t, clients, "client-2")
	assert.Equal(t, client1, clients["client-1"])
	assert.Equal(t, client2, clients["client-2"])
}

func TestHub_ConcurrentAccess(t *testing.T) {
	hub := NewHub()
	
	// Start hub in background
	go hub.Run()
	
	const numClients = 100
	const numMessages = 10
	
	var wg sync.WaitGroup
	
	// Register multiple clients concurrently
	for i := 0; i < numClients; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			
			client := &Client{
				ID:       fmt.Sprintf("client-%d", id),
				Send:     make(chan Message, numMessages),
				Channels: map[string]bool{"test-channel": true},
			}
			
			hub.register <- client
		}(i)
	}
	
	// Send messages concurrently
	for i := 0; i < numMessages; i++ {
		wg.Add(1)
		go func(msgNum int) {
			defer wg.Done()
			hub.Broadcast("test-channel", "concurrent-test", fmt.Sprintf("message-%d", msgNum))
		}(i)
	}
	
	wg.Wait()
	
	// Wait for all clients to be registered
	testutil.RequireCondition(t, func() bool {
		return hub.ClientCount() == numClients
	}, 2*time.Second, "all clients should be registered")
	
	// Verify all clients were registered
	clients := hub.GetClients()
	assert.Len(t, clients, numClients)
}

func TestHub_BroadcastToNonExistentClient(t *testing.T) {
	hub := NewHub()
	
	// Start hub in background
	go hub.Run()
	
	// Try to broadcast to non-existent client - should not panic
	hub.BroadcastToClient("non-existent", "test", "data")
	
	// Test passes if no panic occurs
}

func TestHub_SubscribeNonExistentClient(t *testing.T) {
	hub := NewHub()
	
	// Start hub in background
	go hub.Run()
	
	// Try to subscribe non-existent client - should not panic
	hub.Subscribe("non-existent", "test-channel")
	hub.Unsubscribe("non-existent", "test-channel")
	
	// Test passes if no panic occurs
}