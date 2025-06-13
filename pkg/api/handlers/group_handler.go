package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/heysnelling/computesdk/pkg/api/services"
)

type GroupHandler struct {
	service *services.GroupService
}

func NewGroupHandler(service *services.GroupService) *GroupHandler {
	return &GroupHandler{
		service: service,
	}
}

func (h *GroupHandler) RegisterRoutes(group *gin.RouterGroup) {
	group.GET("", h.List)
	group.POST("", h.Create)
	group.GET("/:id", h.Get)
	group.PUT("/:id", h.Update)
	group.DELETE("/:id", h.Delete)
}

func (h *GroupHandler) List(c *gin.Context) {
	ctx := c.Request.Context()
	result, err := h.service.ListGroups(ctx)
	if err != nil {
		c.Error(err)
		return
	}
	// TODO: Implement
	c.JSON(http.StatusOK, result)
}

func (h *GroupHandler) Create(c *gin.Context) {
	ctx := c.Request.Context()
	result, err := h.service.CreateGroup(ctx, nil)
	if err != nil {
		c.Error(err)
		return
	}

	c.JSON(http.StatusCreated, result)
}

func (h *GroupHandler) Get(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Param("id")
	result, err := h.service.GetGroup(ctx, id)
	if err != nil {
		c.Error(err)
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *GroupHandler) Update(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Param("id")

	result, err := h.service.UpdateGroup(ctx, id, nil)
	if err != nil {
		c.Error(err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *GroupHandler) Delete(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Param("id")
	result, err := h.service.DeleteGroup(ctx, id, "API delete")
	if err != nil {
		c.Error(err)
		return
	}
	c.JSON(http.StatusOK, result)
}
