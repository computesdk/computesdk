package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/heysnelling/computesdk/pkg/api/services"
)

type SecretHandler struct {
	service *services.SecretService
}

func NewSecretHandler(service *services.SecretService) *SecretHandler {
	return &SecretHandler{
		service: service,
	}
}

func (h *SecretHandler) RegisterRoutes(group *gin.RouterGroup) {
	group.GET("", h.List)
	group.POST("", h.Create)
	group.GET("/:id", h.Get)
	group.PUT("/:id", h.Update)
	group.DELETE("/:id", h.Delete)
}

func (h *SecretHandler) List(c *gin.Context) {
	ctx := c.Request.Context()
	result, err := h.service.ListSecrets(ctx)
	if err != nil {
		c.Error(err)
		return
	}
	// TODO: Implement
	c.JSON(http.StatusOK, result)
}

func (h *SecretHandler) Create(c *gin.Context) {
	ctx := c.Request.Context()
	result, err := h.service.CreateSecret(ctx, nil)
	if err != nil {
		c.Error(err)
		return
	}

	c.JSON(http.StatusCreated, result)
}

func (h *SecretHandler) Get(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Param("id")
	result, err := h.service.GetSecret(ctx, id)
	if err != nil {
		c.Error(err)
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *SecretHandler) Update(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Param("id")

	result, err := h.service.UpdateSecret(ctx, id, nil)
	if err != nil {
		c.Error(err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *SecretHandler) Delete(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Param("id")
	result, err := h.service.DeleteSecret(ctx, id, "API delete")
	if err != nil {
		c.Error(err)
		return
	}
	c.JSON(http.StatusOK, result)
}
