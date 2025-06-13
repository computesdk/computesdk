package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/heysnelling/computesdk/pkg/sidekick/websocket"
)

// BaseHandler provides common functionality for all sidekick handlers
type BaseHandler struct {
	ws *websocket.Manager
}

// NewBaseHandler creates a new base handler
func NewBaseHandler(ws *websocket.Manager) *BaseHandler {
	return &BaseHandler{
		ws: ws,
	}
}

// SendJSON sends a JSON response with the given status code
func (b *BaseHandler) SendJSON(c *gin.Context, status int, data interface{}) {
	c.JSON(status, data)
}

// SendError sends an error response with the given status code
func (b *BaseHandler) SendError(c *gin.Context, status int, message string) {
	c.JSON(status, gin.H{"error": message})
}

// SendSuccess sends a success response with the given status code
func (b *BaseHandler) SendSuccess(c *gin.Context, status int, message string, data interface{}) {
	response := gin.H{"message": message}
	if data != nil {
		response["data"] = data
	}
	c.JSON(status, response)
}

// GetParam extracts a URL parameter
func (b *BaseHandler) GetParam(c *gin.Context, key string) string {
	return c.Param(key)
}

// GetQuery extracts a query parameter
func (b *BaseHandler) GetQuery(c *gin.Context, key string) string {
	return c.Query(key)
}

// GetQueryWithDefault extracts a query parameter with a default value
func (b *BaseHandler) GetQueryWithDefault(c *gin.Context, key, defaultValue string) string {
	if value := c.Query(key); value != "" {
		return value
	}
	return defaultValue
}

// BindJSON binds the request body to the given struct
func (b *BaseHandler) BindJSON(c *gin.Context, obj interface{}) error {
	return c.ShouldBindJSON(obj)
}

// SendNoContent sends a 204 No Content response
func (b *BaseHandler) SendNoContent(c *gin.Context) {
	c.Status(http.StatusNoContent)
}

// HandleNotFound sends a 404 Not Found response
func (b *BaseHandler) HandleNotFound(c *gin.Context, resourceName string) {
	b.SendError(c, http.StatusNotFound, resourceName+" not found")
}

// HandleBadRequest sends a 400 Bad Request response
func (b *BaseHandler) HandleBadRequest(c *gin.Context, err error) {
	b.SendError(c, http.StatusBadRequest, err.Error())
}

// HandleInternalError sends a 500 Internal Server Error response
func (b *BaseHandler) HandleInternalError(c *gin.Context, err error) {
	b.SendError(c, http.StatusInternalServerError, err.Error())
}

// WebSocket helper methods

// BroadcastToChannel sends a WebSocket message to all clients on a channel
func (b *BaseHandler) BroadcastToChannel(channel, msgType string, data interface{}) {
	if b.ws != nil {
		b.ws.Broadcast(channel, msgType, data)
	}
}

// BroadcastToClient sends a WebSocket message to a specific client
func (b *BaseHandler) BroadcastToClient(clientID, msgType string, data interface{}) {
	if b.ws != nil {
		b.ws.BroadcastToClient(clientID, msgType, data)
	}
}

// BroadcastToAll sends a WebSocket message to all connected clients
func (b *BaseHandler) BroadcastToAll(msgType string, data interface{}) {
	if b.ws != nil {
		b.ws.Broadcast("", msgType, data)
	}
}

// GetWebSocketManager returns the WebSocket manager
func (b *BaseHandler) GetWebSocketManager() *websocket.Manager {
	return b.ws
}