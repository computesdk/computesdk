// Package session is all about session management
package session

import (
	"github.com/heysnelling/computesdk/pkg/api/events"
	"gorm.io/gorm"
)

type SessionService struct {
	eventStore events.EventStore
	// summaryRepo *SummaryRepository
}

func NewService(db *gorm.DB) *SessionService {
	return &SessionService{
		eventStore: events.NewGormEventStore(db),
		// summaryRepo: NewSummaryRepository(db),
	}
}

func (s *SessionService) StartSession() {
}

func (s *SessionService) TerminateSession() {
}

func (s *SessionService) RenewSession() {
}
