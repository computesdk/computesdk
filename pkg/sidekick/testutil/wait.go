package testutil

import (
	"testing"
	"time"
)

// WaitForCondition polls a condition function until it returns true or timeout occurs
func WaitForCondition(t *testing.T, condition func() bool, timeout time.Duration, pollInterval time.Duration) bool {
	t.Helper()
	
	deadline := time.Now().Add(timeout)
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()
	
	// Check immediately
	if condition() {
		return true
	}
	
	for {
		select {
		case <-ticker.C:
			if condition() {
				return true
			}
			if time.Now().After(deadline) {
				return false
			}
		}
	}
}

// RequireCondition is like WaitForCondition but fails the test if condition is not met
func RequireCondition(t *testing.T, condition func() bool, timeout time.Duration, message string) {
	t.Helper()
	
	if !WaitForCondition(t, condition, timeout, 10*time.Millisecond) {
		t.Fatalf("Condition not met within %v: %s", timeout, message)
	}
}

// WaitForWebSocketMessage waits for a message on a channel with timeout
func WaitForWebSocketMessage[T any](t *testing.T, ch <-chan T, timeout time.Duration) (T, bool) {
	t.Helper()
	
	select {
	case msg := <-ch:
		return msg, true
	case <-time.After(timeout):
		var zero T
		return zero, false
	}
}

// DrainChannel reads and discards all available messages from a channel
func DrainChannel[T any](ch <-chan T) {
	for {
		select {
		case <-ch:
			// Continue draining
		default:
			return
		}
	}
}