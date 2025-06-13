package services_test

import (
	"context"
	"testing"
	"time"

	"github.com/heysnelling/computesdk/pkg/sidekick/services"
	"github.com/heysnelling/computesdk/pkg/sidekick/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSignalService_BasicOperations(t *testing.T) {
	service := services.NewSignalService()
	ctx := context.Background()

	// Initially stopped
	status := service.GetStatus(ctx)
	assert.Equal(t, "stopped", status)

	// Start service
	err := service.Start(ctx)
	require.NoError(t, err)

	status = service.GetStatus(ctx)
	assert.Equal(t, "active", status)

	// Can't start again
	err = service.Start(ctx)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "already active")

	// Stop service
	err = service.Stop(ctx)
	require.NoError(t, err)

	status = service.GetStatus(ctx)
	assert.Equal(t, "stopped", status)

	// Can't stop again
	err = service.Stop(ctx)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "already stopped")
}

func TestSignalService_EmitSignals(t *testing.T) {
	service := services.NewSignalService()
	ctx := context.Background()

	// Start service
	err := service.Start(ctx)
	require.NoError(t, err)
	defer service.Stop(ctx)

	// Get signal channel
	signals := service.GetSignals(ctx)

	// Test port signal
	err = service.EmitPortSignal(ctx, 3000, "open", "http://localhost:3000")
	require.NoError(t, err)

	signal, ok := testutil.WaitForWebSocketMessage(t, signals, 1*time.Second)
	require.True(t, ok, "Should receive port signal")
	
	assert.Equal(t, services.SignalTypePort, signal.Type)
	assert.NotZero(t, signal.Timestamp)
	
	portData, ok := signal.Data.(services.PortSignalData)
	require.True(t, ok, "Signal data should be PortSignalData")
	assert.Equal(t, 3000, portData.Port)
	assert.Equal(t, "open", portData.Type)
	assert.Equal(t, "http://localhost:3000", portData.URL)

	// Test error signal
	err = service.EmitErrorSignal(ctx, "Test error message")
	require.NoError(t, err)

	signal, ok = testutil.WaitForWebSocketMessage(t, signals, 1*time.Second)
	require.True(t, ok, "Should receive error signal")
	
	assert.Equal(t, services.SignalTypeError, signal.Type)
	
	errorData, ok := signal.Data.(services.ErrorSignalData)
	require.True(t, ok, "Signal data should be ErrorSignalData")
	assert.Equal(t, "Test error message", errorData.Message)

	// Test server ready signal
	err = service.EmitServerReadySignal(ctx, 8080, "http://localhost:8080")
	require.NoError(t, err)

	signal, ok = testutil.WaitForWebSocketMessage(t, signals, 1*time.Second)
	require.True(t, ok, "Should receive server ready signal")
	
	assert.Equal(t, services.SignalTypeServerReady, signal.Type)
	
	serverData, ok := signal.Data.(services.ServerReadySignalData)
	require.True(t, ok, "Signal data should be ServerReadySignalData")
	assert.Equal(t, 8080, serverData.Port)
	assert.Equal(t, "http://localhost:8080", serverData.URL)
}

func TestSignalService_EmitWhenStopped(t *testing.T) {
	service := services.NewSignalService()
	ctx := context.Background()

	// Try to emit signals when service is stopped
	err := service.EmitPortSignal(ctx, 3000, "open", "http://localhost:3000")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not active")

	err = service.EmitErrorSignal(ctx, "Test error")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not active")

	err = service.EmitServerReadySignal(ctx, 8080, "http://localhost:8080")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not active")
}

func TestSignalService_SharedChannel(t *testing.T) {
	service := services.NewSignalService()
	ctx := context.Background()

	err := service.Start(ctx)
	require.NoError(t, err)
	defer service.Stop(ctx)

	// Multiple calls to GetSignals return the same channel
	listener1 := service.GetSignals(ctx)
	listener2 := service.GetSignals(ctx)
	
	// They should be the same channel
	assert.Equal(t, listener1, listener2, "GetSignals should return the same channel")

	// Emit multiple signals
	err = service.EmitPortSignal(ctx, 3000, "open", "http://localhost:3000")
	require.NoError(t, err)
	
	err = service.EmitErrorSignal(ctx, "Test error")
	require.NoError(t, err)

	// Should receive both signals from either listener
	signal1, ok := testutil.WaitForWebSocketMessage(t, listener1, 1*time.Second)
	require.True(t, ok, "Should receive first signal")
	assert.Equal(t, services.SignalTypePort, signal1.Type)

	signal2, ok := testutil.WaitForWebSocketMessage(t, listener1, 1*time.Second)
	require.True(t, ok, "Should receive second signal")
	assert.Equal(t, services.SignalTypeError, signal2.Type)
}

func TestSignalService_ConcurrentSignals(t *testing.T) {
	service := services.NewSignalService()
	ctx := context.Background()

	err := service.Start(ctx)
	require.NoError(t, err)
	defer service.Stop(ctx)

	signals := service.GetSignals(ctx)

	// Emit multiple signals concurrently
	go func() {
		for i := 0; i < 5; i++ {
			service.EmitPortSignal(ctx, 3000+i, "open", "http://localhost:3000")
		}
	}()

	go func() {
		for i := 0; i < 3; i++ {
			service.EmitErrorSignal(ctx, "Error message")
		}
	}()

	// Should receive all signals
	receivedCount := 0
	timeout := time.After(2 * time.Second)

	for receivedCount < 8 {
		select {
		case signal := <-signals:
			assert.Contains(t, []services.SignalType{
				services.SignalTypePort,
				services.SignalTypeError,
			}, signal.Type)
			receivedCount++
		case <-timeout:
			t.Fatalf("Timeout: only received %d signals, expected 8", receivedCount)
		}
	}
}