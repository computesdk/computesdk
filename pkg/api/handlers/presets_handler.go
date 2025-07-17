// Package handlers
package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/heysnelling/computesdk/pkg/api/compute"
)

type PresetHandler struct {
	service *compute.ComputeService
}

func NewPresetHandler(service *compute.ComputeService) *PresetHandler {
	return &PresetHandler{
		service: service,
	}
}

func (h *PresetHandler) RegisterRoutes(group *gin.RouterGroup) {
	group.GET("", h.List)
	group.POST("", h.Create)
	group.GET("/:id", h.Get)
	group.PATCH("/:id", h.Update)
}

func (h *PresetHandler) List(c *gin.Context) {
}

func (h *PresetHandler) Create(c *gin.Context) {
}

func (h *PresetHandler) Get(c *gin.Context) {
}

func (h *PresetHandler) Update(c *gin.Context) {
}
