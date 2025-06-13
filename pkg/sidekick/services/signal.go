package services

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// SignalType represents the type of signal being emitted
type SignalType string

const (
	SignalTypePort        SignalType = "port"
	SignalTypeError       SignalType = "error"
	SignalTypeServerReady SignalType = "server-ready"
)

// Signal represents a system signal event
type Signal struct {
	Type      SignalType  `json:"type"`
	Timestamp time.Time   `json:"timestamp"`
	Data      interface{} `json:"data"`
}

// PortSignalData represents data for port signals
type PortSignalData struct {
	Port int    `json:"port"`
	Type string `json:"type"` // "open" or "close"
	URL  string `json:"url"`
}

// ErrorSignalData represents data for error signals
type ErrorSignalData struct {
	Message string `json:"message"`
}

// ServerReadySignalData represents data for server-ready signals
type ServerReadySignalData struct {
	Port int    `json:"port"`
	URL  string `json:"url"`
}

// SignalService defines the interface for signal operations
type SignalService interface {
	// Start begins the signal service
	Start(ctx context.Context) error
	
	// Stop stops the signal service
	Stop(ctx context.Context) error
	
	// EmitPortSignal emits a port open/close signal
	EmitPortSignal(ctx context.Context, port int, signalType string, url string) error
	
	// EmitErrorSignal emits an error signal
	EmitErrorSignal(ctx context.Context, message string) error
	
	// EmitServerReadySignal emits a server-ready signal
	EmitServerReadySignal(ctx context.Context, port int, url string) error
	
	// GetSignals returns the signal channel for listening
	GetSignals(ctx context.Context) <-chan Signal
	
	// GetStatus returns the service status
	GetStatus(ctx context.Context) string
}

// signalService implements SignalService
type signalService struct {
	signals chan Signal
	status  string
	mu      sync.RWMutex
}

// NewSignalService creates a new signal service
func NewSignalService() SignalService {
	return &signalService{
		signals: make(chan Signal, 100),
		status:  "stopped",
	}
}

// Start begins the signal service
func (s *signalService) Start(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	if s.status == "active" {
		return fmt.Errorf("signal service already active")
	}
	
	s.status = "active"
	
	return nil
}

// Stop stops the signal service
func (s *signalService) Stop(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	if s.status == "stopped" {
		return fmt.Errorf("signal service already stopped")
	}
	
	s.status = "stopped"
	close(s.signals)
	
	return nil
}

// EmitPortSignal emits a port open/close signal
func (s *signalService) EmitPortSignal(ctx context.Context, port int, signalType string, url string) error {
	signal := Signal{
		Type:      SignalTypePort,
		Timestamp: time.Now(),
		Data: PortSignalData{
			Port: port,
			Type: signalType,
			URL:  url,
		},
	}
	
	return s.emitSignal(signal)
}

// EmitErrorSignal emits an error signal
func (s *signalService) EmitErrorSignal(ctx context.Context, message string) error {
	signal := Signal{
		Type:      SignalTypeError,
		Timestamp: time.Now(),
		Data: ErrorSignalData{
			Message: message,
		},
	}
	
	return s.emitSignal(signal)
}

// EmitServerReadySignal emits a server-ready signal
func (s *signalService) EmitServerReadySignal(ctx context.Context, port int, url string) error {
	signal := Signal{
		Type:      SignalTypeServerReady,
		Timestamp: time.Now(),
		Data: ServerReadySignalData{
			Port: port,
			URL:  url,
		},
	}
	
	return s.emitSignal(signal)
}

// GetSignals returns the signal channel for listening
func (s *signalService) GetSignals(ctx context.Context) <-chan Signal {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	// Return the main signals channel directly
	return s.signals
}

// GetStatus returns the service status
func (s *signalService) GetStatus(ctx context.Context) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.status
}

// emitSignal sends a signal to the main channel
func (s *signalService) emitSignal(signal Signal) error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	if s.status != "active" {
		return fmt.Errorf("signal service not active")
	}
	
	// Non-blocking send
	select {
	case s.signals <- signal:
		return nil
	default:
		// Channel full, drop signal
		return fmt.Errorf("signal channel full, signal dropped")
	}
}

