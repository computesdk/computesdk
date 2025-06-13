package handlers

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/heysnelling/computesdk/pkg/sidekick/services"
	"github.com/heysnelling/computesdk/pkg/sidekick/websocket"
)

type TerminalHandler struct {
	*BaseHandler
	service      services.TerminalService
	ptyReaders   map[string]context.CancelFunc
	ptyReadersMu sync.RWMutex
}

func NewTerminalHandler(ws *websocket.Manager, service services.TerminalService) *TerminalHandler {
	handler := &TerminalHandler{
		BaseHandler: NewBaseHandler(ws),
		service:     service,
		ptyReaders:  make(map[string]context.CancelFunc),
	}
	
	// Register WebSocket message handlers
	ws.RegisterHandler("terminal:input", handler.handleTerminalInput)
	ws.RegisterHandler("terminal:resize", handler.handleTerminalResize)
	
	return handler
}

// Create - POST /terminals
func (th *TerminalHandler) Create(c *gin.Context) {
	var req struct {
		Shell string `json:"shell"`
	}
	// Optional shell parameter
	c.BindJSON(&req)

	terminal, err := th.service.Create(c.Request.Context(), req.Shell)
	if err != nil {
		th.HandleInternalError(c, err)
		return
	}

	channel := fmt.Sprintf("terminal:%s", terminal.ID)

	// Start PTY reader goroutine
	th.startPTYReader(terminal.ID)

	// Broadcast terminal creation to all WebSocket clients
	th.BroadcastToAll("terminal:created", gin.H{
		"id":      terminal.ID,
		"status":  terminal.Status,
		"channel": channel,
	})

	th.SendSuccess(c, http.StatusCreated, "Terminal created", gin.H{
		"id":      terminal.ID,
		"status":  terminal.Status,
		"channel": channel,
		"ws_url":  "/ws",
	})
}

// Show - GET /terminals/:id
func (th *TerminalHandler) Show(c *gin.Context) {
	id := th.GetParam(c, "id")

	terminal, err := th.service.Get(c.Request.Context(), id)
	if err != nil {
		th.HandleNotFound(c, "terminal")
		return
	}

	channel := fmt.Sprintf("terminal:%s", terminal.ID)

	th.SendSuccess(c, http.StatusOK, "Terminal details", gin.H{
		"id":      terminal.ID,
		"status":  terminal.Status,
		"channel": channel,
	})
}

// Destroy - DELETE /terminals/:id
func (th *TerminalHandler) Destroy(c *gin.Context) {
	id := th.GetParam(c, "id")

	// Stop PTY reader
	th.stopPTYReader(id)

	err := th.service.Delete(c.Request.Context(), id)
	if err != nil {
		th.HandleNotFound(c, "terminal")
		return
	}

	// Broadcast terminal destruction to WebSocket clients
	th.BroadcastToChannel(fmt.Sprintf("terminal:%s", id), "terminal:destroyed", gin.H{
		"id": id,
	})

	th.SendNoContent(c)
}

// Execute - POST /terminals/:id/execute
func (th *TerminalHandler) Execute(c *gin.Context) {
	id := th.GetParam(c, "id")

	var command struct {
		Command string `json:"command"`
	}

	if err := th.BindJSON(c, &command); err != nil {
		th.HandleBadRequest(c, err)
		return
	}

	// Execute the command using the service
	result, err := th.service.Execute(c.Request.Context(), id, command.Command)
	if err != nil {
		th.HandleInternalError(c, err)
		return
	}

	// Broadcast to WebSocket clients subscribed to this terminal
	th.BroadcastToChannel(fmt.Sprintf("terminal:%s", id), "terminal:output", gin.H{
		"terminal_id": id,
		"command":     result.Command,
		"output":      result.Output,
		"exit_code":   result.ExitCode,
		"timestamp":   result.CompletedAt.Unix(),
	})

	// Return the complete output in the HTTP response
	th.SendSuccess(c, http.StatusOK, "Command executed", gin.H{
		"terminal_id": id,
		"command":     result.Command,
		"output":      result.Output,
		"exit_code":   result.ExitCode,
		"duration_ms": result.DurationMs,
	})
}

// startPTYReader starts a goroutine to read PTY output and broadcast it
func (th *TerminalHandler) startPTYReader(terminalID string) {
	ctx, cancel := context.WithCancel(context.Background())

	th.ptyReadersMu.Lock()
	th.ptyReaders[terminalID] = cancel
	th.ptyReadersMu.Unlock()

	go func() {
		buffer := make([]byte, 4096)
		channel := fmt.Sprintf("terminal:%s", terminalID)

		for {
			select {
			case <-ctx.Done():
				return
			default:
				n, err := th.service.Read(ctx, terminalID, buffer)
				if err != nil {
					if ctx.Err() != nil {
						// Context cancelled, normal shutdown
						return
					}
					log.Printf("Error reading from terminal %s: %v", terminalID, err)
					th.BroadcastToChannel(channel, "terminal:error", gin.H{
						"terminal_id": terminalID,
						"error":       err.Error(),
					})
					return
				}

				if n > 0 {
					// Broadcast output to all subscribers
					th.BroadcastToChannel(channel, "terminal:output", gin.H{
						"terminal_id": terminalID,
						"output":      string(buffer[:n]),
					})
				}
			}
		}
	}()
}

// stopPTYReader stops the PTY reader goroutine
func (th *TerminalHandler) stopPTYReader(terminalID string) {
	th.ptyReadersMu.Lock()
	cancel, exists := th.ptyReaders[terminalID]
	if exists {
		cancel()
		delete(th.ptyReaders, terminalID)
	}
	th.ptyReadersMu.Unlock()
}

// handleTerminalInput handles input messages from WebSocket
func (th *TerminalHandler) handleTerminalInput(message websocket.Message) {
	// Convert interface{} to map
	dataMap, ok := message.Data.(map[string]interface{})
	if !ok {
		log.Printf("Error: terminal input data is not a map")
		return
	}

	terminalID, _ := dataMap["terminal_id"].(string)
	input, _ := dataMap["input"].(string)

	if terminalID == "" || input == "" {
		return
	}

	// Write to PTY
	_, err := th.service.Write(context.Background(), terminalID, []byte(input))
	if err != nil {
		log.Printf("Error writing to terminal %s: %v", terminalID, err)
		th.BroadcastToChannel(fmt.Sprintf("terminal:%s", terminalID), "terminal:error", gin.H{
			"terminal_id": terminalID,
			"error":       err.Error(),
		})
	}
}

// handleTerminalResize handles resize messages from WebSocket
func (th *TerminalHandler) handleTerminalResize(message websocket.Message) {
	// Convert interface{} to map
	dataMap, ok := message.Data.(map[string]interface{})
	if !ok {
		log.Printf("Error: terminal resize data is not a map")
		return
	}

	terminalID, _ := dataMap["terminal_id"].(string)
	rowsFloat, _ := dataMap["rows"].(float64)
	colsFloat, _ := dataMap["cols"].(float64)

	rows := uint16(rowsFloat)
	cols := uint16(colsFloat)

	if terminalID == "" || rows == 0 || cols == 0 {
		return
	}

	// Resize PTY
	err := th.service.Resize(context.Background(), terminalID, rows, cols)
	if err != nil {
		log.Printf("Error resizing terminal %s: %v", terminalID, err)
		th.BroadcastToChannel(fmt.Sprintf("terminal:%s", terminalID), "terminal:error", gin.H{
			"terminal_id": terminalID,
			"error":       err.Error(),
		})
	}
}
