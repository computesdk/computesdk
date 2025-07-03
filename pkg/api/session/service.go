// Package session is all about session management
package session

import (
	"context"
	"fmt"
	"time"

	"github.com/heysnelling/computesdk/pkg/api/events"
	"github.com/heysnelling/computesdk/pkg/auth"
	"github.com/heysnelling/computesdk/pkg/common"
	"gorm.io/gorm"
)

type SessionService struct {
	eventStore        events.EventStore
	summaryRepo       *SummaryRepository
	jwtService        *auth.JWTService
	defaultTokenTTL   time.Duration
	defaultSessionTTL time.Duration
}

func NewService(db *gorm.DB) *SessionService {
	return &SessionService{
		eventStore:        events.NewGormEventStore(db),
		summaryRepo:       NewSummaryRepository(db),
		jwtService:        auth.NewJWTService("your-seceret"),
		defaultTokenTTL:   4 * time.Hour,  // Short for security
		defaultSessionTTL: 24 * time.Hour, // Long for compute work
	}
}

type SessionResponse struct {
	SessionID string    `json:"session_id"`
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
	Status    string    `json:"status"`
}

func (s *SessionService) StartSession(ctx context.Context, req *CreateSessionRequest) (*SessionResponse, error) {
	sessionID := common.GeneratePrefixedID("session")
	now := time.Now()

	// Default TTL if not specified
	ttl := s.defaultSessionTTL
	if req.ExpiresIn != nil {
		ttl = time.Duration(*req.ExpiresIn) * time.Second
	}

	expiresAt := now.Add(ttl)

	// Create and store the event
	event := SessionStarted{
		SessionID: sessionID,
		Config:    req.Config,
		ExpiresAt: expiresAt,
		CreatedAt: now,
	}

	if err := s.eventStore.Append(ctx, sessionID, event); err != nil {
		return nil, fmt.Errorf("failed to store SessionStarted event: %w", err)
	}

	aggregate, err := s.GetAggregateSession(ctx, sessionID)
	if err != nil {
		return nil, err
	}

	if _, err := s.summaryRepo.Create(ctx, aggregate.ToSummary()); err != nil {
		return nil, fmt.Errorf("failed to update session summary: %w", err)
	}

	// Generate JWT token
	token, err := s.jwtService.GenerateSessionToken(sessionID, s.defaultTokenTTL)
	if err != nil {
		return nil, fmt.Errorf("failed to generate token: %w", err)
	}

	return &SessionResponse{
		SessionID: sessionID,
		Token:     token,
		ExpiresAt: expiresAt,
		Status:    "active",
	}, nil
}

func (s *SessionService) TerminateSession(ctx context.Context, sessionID string, req *TerminateSessionRequest) (*SessionSummary, error) {
	// Check if session exists and is active
	summary, err := s.summaryRepo.Get(ctx, sessionID)
	if err != nil {
		return nil, fmt.Errorf("session not found: %w", err)
	}

	if summary.Status != "active" {
		return nil, fmt.Errorf("session %s is not active (status: %s)", sessionID, summary.Status)
	}

	// Create and store the event
	event := SessionTerminated{
		SessionID: sessionID,
		Reason:    req.Reason,
	}

	if err := s.eventStore.Append(ctx, sessionID, event); err != nil {
		return nil, fmt.Errorf("failed to store SessionTerminated event: %w", err)
	}

	aggregate, err := s.GetAggregateSession(ctx, sessionID)
	if err != nil {
		return nil, err
	}

	summary = aggregate.ToSummary()

	if _, err := s.summaryRepo.Update(ctx, summary); err != nil {
		return nil, fmt.Errorf("failed to update session summary: %w", err)
	}

	return summary, nil
}

func (s *SessionService) RenewSession(ctx context.Context, sessionID string, req *RenewSessionRequest) (*SessionResponse, error) {
	// Check if session exists and is active
	summary, err := s.summaryRepo.Get(ctx, sessionID)
	if err != nil {
		return nil, fmt.Errorf("session not found: %w", err)
	}

	if summary.Status != "active" {
		return nil, fmt.Errorf("session %s is not active (status: %s)", sessionID, summary.Status)
	}

	// Calculate new expiry time
	ttl := s.defaultSessionTTL // default
	if req.ExpiresIn != nil {
		ttl = time.Duration(*req.ExpiresIn) * time.Second
	}

	newExpiresAt := time.Now().Add(ttl)

	// Create and store the event
	event := SessionRenewed{
		SessionID:    sessionID,
		NewExpiresAt: newExpiresAt,
		RenewedAt:    time.Now(),
	}

	if err := s.eventStore.Append(ctx, sessionID, event); err != nil {
		return nil, fmt.Errorf("failed to store SessionRenewed event: %w", err)
	}

	aggregate, err := s.GetAggregateSession(ctx, sessionID)
	if err != nil {
		return nil, err
	}

	summary = aggregate.ToSummary()

	if _, err = s.summaryRepo.Update(ctx, summary); err != nil {
		return nil, fmt.Errorf("failed to update session summary: %w", err)
	}

	newToken, err := s.jwtService.GenerateSessionToken(sessionID, s.defaultTokenTTL)
	if err != nil {
		return nil, fmt.Errorf("failed to generate new token: %w", err)
	}

	return &SessionResponse{
		SessionID: sessionID,
		Token:     newToken,
		ExpiresAt: *summary.ExpiresAt,
		Status:    summary.Status,
	}, nil
}

// GetSession retrieves a session by ID
func (s *SessionService) GetSession(ctx context.Context, sessionID string) (*SessionSummary, error) {
	return s.summaryRepo.Get(ctx, sessionID)
}

// GetSessionWithComputes retrieves a session with its associated computes
func (s *SessionService) GetSessionWithComputes(ctx context.Context, sessionID string) (*SessionSummary, error) {
	return s.summaryRepo.GetWithComputes(ctx, sessionID)
}

// ListSessions retrieves sessions with optional filtering
func (s *SessionService) ListSessions(ctx context.Context, status *string, limit, offset int) ([]SessionSummary, error) {
	return s.summaryRepo.List(ctx, status, limit, offset)
}

func (s *SessionService) GetAggregateSession(ctx context.Context, sessionID string) (*SessionAggregate, error) {
	events, err := s.eventStore.GetEvents(ctx, sessionID)
	if err != nil {
		return nil, err
	}

	if len(events) == 0 {
		return nil, fmt.Errorf("compute not found: %s", sessionID)
	}

	sessionAggregate := &SessionAggregate{}

	if err := sessionAggregate.Apply(events); err != nil {
		return nil, err
	}

	return sessionAggregate, nil
}
