package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/heysnelling/computesdk/pkg/api/services"
)

type ComputeHandler struct {
	service *services.ComputeService
}

func NewComputeHandler(service *services.ComputeService) *ComputeHandler {
	return &ComputeHandler{
		service: service,
	}
}

func (h *ComputeHandler) RegisterRoutes(group *gin.RouterGroup) {
	group.GET("", h.List)
	group.POST("", h.Create)
	group.GET("/:id", h.Get)
	group.PUT("/:id", h.Update)
	group.DELETE("/:id", h.Delete)
}

func (h *ComputeHandler) List(c *gin.Context) {
	ctx := c.Request.Context()
	result, err := h.service.ListComputes(ctx)
	if err != nil {
		c.Error(err) // Add to Gin's error stack for logging
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": result})
}

func (h *ComputeHandler) Create(c *gin.Context) {
	ctx := c.Request.Context()

	result, err := h.service.CreateCompute(ctx, nil)
	if err != nil {
		c.Error(err) // Add to Gin's error stack for logging
		return
	}
	c.JSON(http.StatusCreated, result)
}

func (h *ComputeHandler) Get(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Param("id")
	result, err := h.service.GetCompute(ctx, id)
	if err != nil {
		c.Error(err)
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *ComputeHandler) Update(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Param("id")

	result, err := h.service.UpdateCompute(ctx, id, nil)
	if err != nil {
		c.Error(err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *ComputeHandler) Delete(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Param("id")
	result, err := h.service.DeleteCompute(ctx, id, "API delete")
	if err != nil {
		c.Error(err)
		return
	}
	c.JSON(http.StatusOK, result)
}
