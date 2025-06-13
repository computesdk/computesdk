package services

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// FileWatcher represents an active file watching session
type FileWatcher struct {
	ID             string
	Path           string
	IncludeContent bool
	Ignored        []string
	Status         string
	CreatedAt      time.Time
	UpdatedAt      time.Time
	watcher        *fsnotify.Watcher
	stopChan       chan struct{}
	mu             sync.Mutex
}

// FileChangeEvent represents a file system change event
type FileChangeEvent struct {
	Path      string    `json:"path"`
	Event     string    `json:"event"` // created, modified, deleted, renamed
	Content   string    `json:"content,omitempty"`
	Timestamp time.Time `json:"timestamp"`
}

// FileWatcherService defines the interface for file watching operations
type FileWatcherService interface {
	Create(ctx context.Context, path string, includeContent bool, ignored []string) (*FileWatcher, error)
	Get(ctx context.Context, id string) (*FileWatcher, error)
	Delete(ctx context.Context, id string) error
	List(ctx context.Context) ([]*FileWatcher, error)
	GetEvents(ctx context.Context, id string) <-chan FileChangeEvent
}

// fileWatcherService implements FileWatcherService
type fileWatcherService struct {
	watchers map[string]*FileWatcher
	events   map[string]chan FileChangeEvent
	mu       sync.RWMutex
}

// NewFileWatcherService creates a new file watcher service
func NewFileWatcherService() FileWatcherService {
	return &fileWatcherService{
		watchers: make(map[string]*FileWatcher),
		events:   make(map[string]chan FileChangeEvent),
	}
}

// Create creates a new file watcher
func (s *fileWatcherService) Create(ctx context.Context, path string, includeContent bool, ignored []string) (*FileWatcher, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Create fsnotify watcher
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, fmt.Errorf("failed to create watcher: %w", err)
	}

	// Add the path to watch
	err = watcher.Add(path)
	if err != nil {
		watcher.Close()
		return nil, fmt.Errorf("failed to watch path %s: %w", path, err)
	}

	// Also watch subdirectories recursively
	err = s.addRecursive(watcher, path, ignored)
	if err != nil {
		watcher.Close()
		return nil, fmt.Errorf("failed to add recursive watches: %w", err)
	}

	fw := &FileWatcher{
		ID:             fmt.Sprintf("watcher-%d", time.Now().UnixNano()),
		Path:           path,
		IncludeContent: includeContent,
		Ignored:        ignored,
		Status:         "active",
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
		watcher:        watcher,
		stopChan:       make(chan struct{}),
	}

	// Create event channel
	eventChan := make(chan FileChangeEvent, 100)
	s.events[fw.ID] = eventChan

	// Start watching in background
	go s.watchLoop(fw, eventChan)

	s.watchers[fw.ID] = fw
	return fw, nil
}

// Get retrieves a file watcher by ID
func (s *fileWatcherService) Get(ctx context.Context, id string) (*FileWatcher, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	watcher, exists := s.watchers[id]
	if !exists {
		return nil, fmt.Errorf("watcher not found: %s", id)
	}

	return watcher, nil
}

// Delete removes a file watcher
func (s *fileWatcherService) Delete(ctx context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	watcher, exists := s.watchers[id]
	if !exists {
		return fmt.Errorf("watcher not found: %s", id)
	}

	// Stop the watcher
	watcher.mu.Lock()
	close(watcher.stopChan)
	if watcher.watcher != nil {
		watcher.watcher.Close()
	}
	watcher.mu.Unlock()

	// Close and remove event channel
	if eventChan, exists := s.events[id]; exists {
		close(eventChan)
		delete(s.events, id)
	}

	delete(s.watchers, id)
	return nil
}

// List returns all active watchers
func (s *fileWatcherService) List(ctx context.Context) ([]*FileWatcher, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	watchers := make([]*FileWatcher, 0, len(s.watchers))
	for _, watcher := range s.watchers {
		watchers = append(watchers, watcher)
	}

	return watchers, nil
}

// GetEvents returns the event channel for a watcher
func (s *fileWatcherService) GetEvents(ctx context.Context, id string) <-chan FileChangeEvent {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if eventChan, exists := s.events[id]; exists {
		return eventChan
	}

	// Return closed channel if not found
	ch := make(chan FileChangeEvent)
	close(ch)
	return ch
}

// watchLoop is the main loop for watching file changes
func (s *fileWatcherService) watchLoop(fw *FileWatcher, eventChan chan<- FileChangeEvent) {
	defer func() {
		// Recover from any panic when sending to closed channel
		if r := recover(); r != nil {
			// Channel was closed, just return
			return
		}
	}()
	
	for {
		select {
		case <-fw.stopChan:
			return

		case event, ok := <-fw.watcher.Events:
			if !ok {
				return
			}

			// Skip if path matches ignored patterns
			if s.shouldIgnore(event.Name, fw.Ignored) {
				continue
			}

			// Convert fsnotify event to our event type
			var eventType string
			switch {
			case event.Op&fsnotify.Create == fsnotify.Create:
				eventType = "created"
			case event.Op&fsnotify.Write == fsnotify.Write:
				eventType = "modified"
			case event.Op&fsnotify.Remove == fsnotify.Remove:
				eventType = "deleted"
			case event.Op&fsnotify.Rename == fsnotify.Rename:
				eventType = "renamed"
			default:
				continue
			}

			fileEvent := FileChangeEvent{
				Path:      event.Name,
				Event:     eventType,
				Timestamp: time.Now(),
			}

			// Read file content if requested and file exists
			if fw.IncludeContent && (eventType == "created" || eventType == "modified") {
				// Small delay to ensure file write is complete
				time.Sleep(10 * time.Millisecond)
				content, err := os.ReadFile(event.Name)
				if err == nil {
					fileEvent.Content = string(content)
				}
			}

			// Send event (non-blocking)
			select {
			case eventChan <- fileEvent:
			default:
				// Channel full, drop event
			}

		case err, ok := <-fw.watcher.Errors:
			if !ok {
				return
			}
			// Log error but continue watching
			fmt.Printf("Watcher error: %v\n", err)
		}
	}
}

// addRecursive adds watches for all subdirectories
func (s *fileWatcherService) addRecursive(watcher *fsnotify.Watcher, path string, ignored []string) error {
	return filepath.Walk(path, func(walkPath string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip errors
		}

		// Skip if matches ignored patterns
		if s.shouldIgnore(walkPath, ignored) {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		// Add directories to watcher
		if info.IsDir() {
			err = watcher.Add(walkPath)
			if err != nil {
				return fmt.Errorf("failed to watch %s: %w", walkPath, err)
			}
		}

		return nil
	})
}

// shouldIgnore checks if a path matches any of the ignore patterns
func (s *fileWatcherService) shouldIgnore(path string, patterns []string) bool {
	for _, pattern := range patterns {
		// Check against the base filename
		baseName := filepath.Base(path)
		matched, err := filepath.Match(pattern, baseName)
		if err == nil && matched {
			return true
		}

		// Check against the full path
		matched, err = filepath.Match(pattern, path)
		if err == nil && matched {
			return true
		}

		// Also check if any part of the path contains the pattern (for dirs like node_modules)
		if strings.Contains(path, strings.Trim(pattern, "*/")) {
			return true
		}
	}
	return false
}