package handlers

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/heysnelling/computesdk/pkg/api/apikey"
)

type APIKeyHandler struct {
	service *apikey.APIKeyService
}

func NewAPIKeyHandler(service *apikey.APIKeyService) *APIKeyHandler {
	return &APIKeyHandler{
		service: service,
	}
}

func (h *APIKeyHandler) CreateAPIKey(c *gin.Context) {
	var req apikey.CreateAPIKeyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	summary, err := h.service.CreateAPIKey(c.Request.Context(), &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, summary)
}

func (h *APIKeyHandler) ListAPIKeys(c *gin.Context) {
	status := c.Query("status")
	var statusPtr *string
	if status != "" {
		statusPtr = &status
	}

	limit := 25
	if l := c.Query("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil {
			limit = parsed
		}
	}

	offset := 0
	if o := c.Query("offset"); o != "" {
		if parsed, err := strconv.Atoi(o); err == nil {
			offset = parsed
		}
	}

	keys, err := h.service.ListAPIKeys(c.Request.Context(), statusPtr, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"keys": keys})
}

func (h *APIKeyHandler) GetAPIKey(c *gin.Context) {
	keyID := c.Param("id")
	if keyID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "key ID is required"})
		return
	}

	key, err := h.service.GetAPIKey(c.Request.Context(), keyID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, key)
}

func (h *APIKeyHandler) RevokeAPIKey(c *gin.Context) {
	keyID := c.Param("id")
	if keyID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "key ID is required"})
		return
	}

	var req apikey.RevokeAPIKeyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	revokedKey, err := h.service.RevokeAPIKey(c.Request.Context(), keyID, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, revokedKey)
}

func (h *APIKeyHandler) RegisterRoutes(group *gin.RouterGroup) {
	group.POST("", h.CreateAPIKey)
	group.GET("", h.ListAPIKeys)
	group.GET("/:id", h.GetAPIKey)
	group.DELETE("/:id", h.RevokeAPIKey)
}
