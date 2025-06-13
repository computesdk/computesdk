package handlers

import (
	"context"
	"fmt"
	"net/http"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/heysnelling/computesdk/pkg/sidekick/services"
	"github.com/heysnelling/computesdk/pkg/sidekick/websocket"
)

type FileWatcherHandler struct {
	*BaseHandler
	service       services.FileWatcherService
	eventReaders  map[string]context.CancelFunc
	eventReadersMu sync.RWMutex
}

func NewFileWatcherHandler(ws *websocket.Manager, service services.FileWatcherService) *FileWatcherHandler {
	handler := &FileWatcherHandler{
		BaseHandler:  NewBaseHandler(ws),
		service:      service,
		eventReaders: make(map[string]context.CancelFunc),
	}
	
	return handler
}

// Create - POST /watchers
func (fh *FileWatcherHandler) Create(c *gin.Context) {
	var req struct {
		Path           string   `json:"path" binding:"required"`
		IncludeContent bool     `json:"includeContent"`
		Ignored        []string `json:"ignored"`
	}
	
	if err := fh.BindJSON(c, &req); err != nil {
		fh.HandleBadRequest(c, err)
		return
	}

	watcher, err := fh.service.Create(c.Request.Context(), req.Path, req.IncludeContent, req.Ignored)
	if err != nil {
		fh.HandleInternalError(c, err)
		return
	}

	channel := fmt.Sprintf("watcher:%s", watcher.ID)

	// Start event reader goroutine
	fh.startEventReader(watcher.ID)

	// Broadcast watcher creation to all WebSocket clients
	fh.BroadcastToAll("watcher:created", gin.H{
		"id":             watcher.ID,
		"path":           watcher.Path,
		"includeContent": watcher.IncludeContent,
		"ignored":        watcher.Ignored,
		"status":         watcher.Status,
		"channel":        channel,
	})

	fh.SendSuccess(c, http.StatusCreated, "File watcher created", gin.H{
		"id":             watcher.ID,
		"path":           watcher.Path,
		"includeContent": watcher.IncludeContent,
		"ignored":        watcher.Ignored,
		"status":         watcher.Status,
		"channel":        channel,
		"ws_url":         "/ws",
	})
}

// Show - GET /watchers/:id
func (fh *FileWatcherHandler) Show(c *gin.Context) {
	id := fh.GetParam(c, "id")

	watcher, err := fh.service.Get(c.Request.Context(), id)
	if err != nil {
		fh.HandleNotFound(c, "watcher")
		return
	}

	channel := fmt.Sprintf("watcher:%s", watcher.ID)

	fh.SendSuccess(c, http.StatusOK, "File watcher details", gin.H{
		"id":             watcher.ID,
		"path":           watcher.Path,
		"includeContent": watcher.IncludeContent,
		"ignored":        watcher.Ignored,
		"status":         watcher.Status,
		"channel":        channel,
	})
}

// Index - GET /watchers
func (fh *FileWatcherHandler) Index(c *gin.Context) {
	watchers, err := fh.service.List(c.Request.Context())
	if err != nil {
		fh.HandleInternalError(c, err)
		return
	}

	result := make([]gin.H, len(watchers))
	for i, watcher := range watchers {
		result[i] = gin.H{
			"id":             watcher.ID,
			"path":           watcher.Path,
			"includeContent": watcher.IncludeContent,
			"ignored":        watcher.Ignored,
			"status":         watcher.Status,
			"channel":        fmt.Sprintf("watcher:%s", watcher.ID),
		}
	}

	fh.SendSuccess(c, http.StatusOK, "File watchers", gin.H{
		"watchers": result,
	})
}

// Destroy - DELETE /watchers/:id
func (fh *FileWatcherHandler) Destroy(c *gin.Context) {
	id := fh.GetParam(c, "id")

	// Stop event reader
	fh.stopEventReader(id)

	err := fh.service.Delete(c.Request.Context(), id)
	if err != nil {
		fh.HandleNotFound(c, "watcher")
		return
	}

	// Broadcast watcher destruction to WebSocket clients
	fh.BroadcastToChannel(fmt.Sprintf("watcher:%s", id), "watcher:destroyed", gin.H{
		"id": id,
	})

	fh.SendNoContent(c)
}

// startEventReader starts a goroutine to read file events and broadcast them
func (fh *FileWatcherHandler) startEventReader(watcherID string) {
	ctx, cancel := context.WithCancel(context.Background())

	fh.eventReadersMu.Lock()
	fh.eventReaders[watcherID] = cancel
	fh.eventReadersMu.Unlock()

	go func() {
		channel := fmt.Sprintf("watcher:%s", watcherID)
		eventChan := fh.service.GetEvents(ctx, watcherID)

		for {
			select {
			case <-ctx.Done():
				return
			case event, ok := <-eventChan:
				if !ok {
					// Channel closed, watcher was deleted
					return
				}

				// Broadcast file change event to all subscribers
				eventData := gin.H{
					"watcher_id": watcherID,
					"path":       event.Path,
					"event":      event.Event,
					"timestamp":  event.Timestamp.Unix(),
				}

				// Include content if available
				if event.Content != "" {
					eventData["content"] = event.Content
				}

				fh.BroadcastToChannel(channel, "file:changed", eventData)
			}
		}
	}()
}

// stopEventReader stops the event reader goroutine
func (fh *FileWatcherHandler) stopEventReader(watcherID string) {
	fh.eventReadersMu.Lock()
	cancel, exists := fh.eventReaders[watcherID]
	if exists {
		cancel()
		delete(fh.eventReaders, watcherID)
	}
	fh.eventReadersMu.Unlock()
}