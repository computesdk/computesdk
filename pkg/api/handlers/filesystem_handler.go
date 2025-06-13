package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/heysnelling/computesdk/pkg/api/services"
)

type FilesystemHandler struct {
	service *services.FilesystemService
}

func NewFilesystemHandler(service *services.FilesystemService) *FilesystemHandler {
	return &FilesystemHandler{
		service: service,
	}
}

func (h *FilesystemHandler) RegisterRoutes(group *gin.RouterGroup) {
	group.GET("", h.List)
	group.POST("", h.Create)
	group.GET("/:id", h.Get)
	group.PUT("/:id", h.Update)
	group.DELETE("/:id", h.Delete)
}

func (h *FilesystemHandler) List(c *gin.Context) {
	ctx := c.Request.Context()
	result, err := h.service.ListFilesystems(ctx)
	if err != nil {
		c.Error(err)
		return
	}
	// TODO: Implement
	c.JSON(http.StatusOK, gin.H{"data": result})
}

func (h *FilesystemHandler) Create(c *gin.Context) {
	ctx := c.Request.Context()
	result, err := h.service.CreateFilesystem(ctx, nil)
	if err != nil {
		c.Error(err)
		return
	}
	// TODO: Implement
	c.JSON(http.StatusCreated, result)
}

func (h *FilesystemHandler) Get(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Param("id")
	result, err := h.service.GetFilesystem(ctx, id)
	if err != nil {
		c.Error(err)
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *FilesystemHandler) Update(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Param("id")

	result, err := h.service.UpdateFilesystem(ctx, id, nil)
	if err != nil {
		c.Error(err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *FilesystemHandler) Delete(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Param("id")
	result, err := h.service.DeleteFilesystem(ctx, id, "API delete")
	if err != nil {
		c.Error(err)
		return
	}
	c.JSON(http.StatusOK, result)
}
