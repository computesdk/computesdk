package handlers

import (
	"context"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/heysnelling/computesdk/pkg/sidekick/services"
	"github.com/heysnelling/computesdk/pkg/sidekick/websocket"
)

type SignalHandler struct {
	*BaseHandler
	service services.SignalService
}

func NewSignalHandler(ws *websocket.Manager, service services.SignalService) *SignalHandler {
	handler := &SignalHandler{
		BaseHandler: NewBaseHandler(ws),
		service:     service,
	}
	
	return handler
}

// Start - POST /signals/start
func (sh *SignalHandler) Start(c *gin.Context) {
	err := sh.service.Start(c.Request.Context())
	if err != nil {
		sh.HandleInternalError(c, err)
		return
	}
	
	// Start signal broadcasting goroutine with background context
	go sh.broadcastSignals(context.Background())
	
	sh.SendSuccess(c, http.StatusOK, "Signal service started", gin.H{
		"status": "active",
		"channel": "signals",
		"ws_url": "/ws",
	})
}

// Stop - POST /signals/stop
func (sh *SignalHandler) Stop(c *gin.Context) {
	err := sh.service.Stop(c.Request.Context())
	if err != nil {
		sh.HandleInternalError(c, err)
		return
	}
	
	sh.SendSuccess(c, http.StatusOK, "Signal service stopped", gin.H{
		"status": "stopped",
	})
}

// Status - GET /signals/status
func (sh *SignalHandler) Status(c *gin.Context) {
	status := sh.service.GetStatus(c.Request.Context())
	
	sh.SendSuccess(c, http.StatusOK, "Signal service status", gin.H{
		"status": status,
		"channel": "signals",
	})
}

// EmitPort - POST /signals/port
func (sh *SignalHandler) EmitPort(c *gin.Context) {
	var req struct {
		Port int    `json:"port" binding:"required"`
		Type string `json:"type" binding:"required,oneof=open close"`
		URL  string `json:"url" binding:"required"`
	}
	
	if err := sh.BindJSON(c, &req); err != nil {
		sh.HandleBadRequest(c, err)
		return
	}
	
	err := sh.service.EmitPortSignal(c.Request.Context(), req.Port, req.Type, req.URL)
	if err != nil {
		sh.HandleInternalError(c, err)
		return
	}
	
	sh.SendSuccess(c, http.StatusOK, "Port signal emitted", gin.H{
		"port": req.Port,
		"type": req.Type,
		"url":  req.URL,
	})
}

// EmitError - POST /signals/error
func (sh *SignalHandler) EmitError(c *gin.Context) {
	var req struct {
		Message string `json:"message" binding:"required"`
	}
	
	if err := sh.BindJSON(c, &req); err != nil {
		sh.HandleBadRequest(c, err)
		return
	}
	
	err := sh.service.EmitErrorSignal(c.Request.Context(), req.Message)
	if err != nil {
		sh.HandleInternalError(c, err)
		return
	}
	
	sh.SendSuccess(c, http.StatusOK, "Error signal emitted", gin.H{
		"message": req.Message,
	})
}

// EmitServerReady - POST /signals/server-ready
func (sh *SignalHandler) EmitServerReady(c *gin.Context) {
	var req struct {
		Port int    `json:"port" binding:"required"`
		URL  string `json:"url" binding:"required"`
	}
	
	if err := sh.BindJSON(c, &req); err != nil {
		sh.HandleBadRequest(c, err)
		return
	}
	
	err := sh.service.EmitServerReadySignal(c.Request.Context(), req.Port, req.URL)
	if err != nil {
		sh.HandleInternalError(c, err)
		return
	}
	
	sh.SendSuccess(c, http.StatusOK, "Server ready signal emitted", gin.H{
		"port": req.Port,
		"url":  req.URL,
	})
}

// EmitPortQuery - POST /signals/port/:port/:type
// Alternative endpoint for simpler port signal emission
func (sh *SignalHandler) EmitPortQuery(c *gin.Context) {
	portStr := sh.GetParam(c, "port")
	signalType := sh.GetParam(c, "type")
	
	port, err := strconv.Atoi(portStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid port number"})
		return
	}
	
	if signalType != "open" && signalType != "close" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Type must be 'open' or 'close'"})
		return
	}
	
	// Generate URL based on port
	url := "http://localhost:" + portStr
	
	err = sh.service.EmitPortSignal(c.Request.Context(), port, signalType, url)
	if err != nil {
		sh.HandleInternalError(c, err)
		return
	}
	
	sh.SendSuccess(c, http.StatusOK, "Port signal emitted", gin.H{
		"port": port,
		"type": signalType,
		"url":  url,
	})
}

// broadcastSignals listens for signals and broadcasts them via WebSocket
func (sh *SignalHandler) broadcastSignals(ctx context.Context) {
	signals := sh.service.GetSignals(ctx)
	
	for {
		select {
		case signal, ok := <-signals:
			if !ok {
				return // Channel closed
			}
			
			// Broadcast signal to WebSocket clients subscribed to "signals" channel
			sh.BroadcastToChannel("signals", "signal", gin.H{
				"signal":    signal.Type,
				"timestamp": signal.Timestamp.Unix(),
				"data":      signal.Data,
			})
			
		case <-ctx.Done():
			return
		}
	}
}