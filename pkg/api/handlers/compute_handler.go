// Package handlers are the handlers for thehandlers for the api pkg
package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/heysnelling/computesdk/pkg/api/compute"
)

type ComputeHandler struct {
	service *compute.ComputeService
}

func NewComputeHandler(service *compute.ComputeService) *ComputeHandler {
	return &ComputeHandler{
		service: service,
	}
}

func (h *ComputeHandler) RegisterRoutes(group *gin.RouterGroup) {
	group.GET("", h.List)
	group.POST("", h.Create)
	group.GET("/:id", h.Get)
	group.POST("/:id/terminate", h.Terminate)
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
	var req compute.CreateComputeRequest

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON"})
		return
	}

	result, err := h.service.CreateCompute(c.Request.Context(), &req)
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

func (h *ComputeHandler) Terminate(c *gin.Context) {
	var req compute.TerminateComputeRequest
	ctx := c.Request.Context()

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON"})
		return
	}

	req.ComputeID = c.Param("id")

	result, err := h.service.TerminateCompute(ctx, &req)
	if err != nil {
		c.Error(err)
		return
	}
	c.JSON(http.StatusOK, result)
}
