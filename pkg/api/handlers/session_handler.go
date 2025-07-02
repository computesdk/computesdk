package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/heysnelling/computesdk/pkg/api/session"
)

type SessionHandler struct {
	service *session.SessionService
}

func NewSessionHandler(service *session.SessionService) *SessionHandler {
	return &SessionHandler{
		service: service,
	}
}

func (h *SessionHandler) RegisterRoutes(group *gin.RouterGroup) {
	group.GET("", h.List)
	group.POST("", h.Create)
	group.GET("/:id", h.Get)
	group.POST("/:id/extend", h.Extend)
	group.POST("/:id/terminate", h.Terminate)
}

func (h *SessionHandler) List(c *gin.Context) {
}

func (h *SessionHandler) Create(c *gin.Context) {
}

func (h *SessionHandler) Get(c *gin.Context) {
}

func (h *SessionHandler) Extend(c *gin.Context) {
}

func (h *SessionHandler) Terminate(c *gin.Context) {
}
