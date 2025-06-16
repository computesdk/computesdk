package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/heysnelling/computesdk/pkg/sidekick/services"
	"github.com/heysnelling/computesdk/pkg/sidekick/websocket"
)

type FilesHandler struct {
	*BaseHandler
	service services.FilesystemService
}

func NewFilesHandler(ws *websocket.Manager, service services.FilesystemService) *FilesHandler {
	return &FilesHandler{
		BaseHandler: NewBaseHandler(ws),
		service:     service,
	}
}

// Index - GET /files
func (fh *FilesHandler) Index(c *gin.Context) {
	path := c.Query("path")
	if path == "" {
		path = "/"
	}

	files, err := fh.service.List(c.Request.Context(), path)
	if err != nil {
		fh.SendError(c, http.StatusBadRequest, err.Error())
		return
	}

	fh.SendSuccess(c, http.StatusOK, "List files", gin.H{
		"files": files,
		"path":  path,
	})
}

// Show - GET /files/:id
func (fh *FilesHandler) Show(c *gin.Context) {
	path := c.Param("id")

	// Check if we want file content or just metadata
	if c.Query("content") == "true" {
		fileContent, err := fh.service.Read(c.Request.Context(), path)
		if err != nil {
			fh.SendError(c, http.StatusBadRequest, err.Error())
			return
		}

		fh.SendSuccess(c, http.StatusOK, "Read file content", gin.H{
			"file":    fileContent.File,
			"content": string(fileContent.Content),
		})
		return
	}

	// Just get file metadata
	file, err := fh.service.Get(c.Request.Context(), path)
	if err != nil {
		fh.SendError(c, http.StatusNotFound, err.Error())
		return
	}

	fh.SendSuccess(c, http.StatusOK, "Show file", gin.H{
		"file": file,
	})
}

// Create - POST /files
func (fh *FilesHandler) Create(c *gin.Context) {
	var req struct {
		Path    string `json:"path" binding:"required"`
		Content string `json:"content"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		fh.SendError(c, http.StatusBadRequest, err.Error())
		return
	}

	file, err := fh.service.Create(c.Request.Context(), req.Path, []byte(req.Content))
	if err != nil {
		fh.SendError(c, http.StatusBadRequest, err.Error())
		return
	}

	fh.SendSuccess(c, http.StatusCreated, "File created", gin.H{
		"file": file,
	})
}

// Update - PUT /files/:id
func (fh *FilesHandler) Update(c *gin.Context) {
	path := c.Param("id")

	var req struct {
		Content string `json:"content" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		fh.SendError(c, http.StatusBadRequest, err.Error())
		return
	}

	file, err := fh.service.Update(c.Request.Context(), path, []byte(req.Content))
	if err != nil {
		fh.SendError(c, http.StatusBadRequest, err.Error())
		return
	}

	fh.SendSuccess(c, http.StatusOK, "File updated", gin.H{
		"file": file,
	})
}

// Destroy - DELETE /files/:id
func (fh *FilesHandler) Destroy(c *gin.Context) {
	path := c.Param("id")

	if err := fh.service.Delete(c.Request.Context(), path); err != nil {
		fh.SendError(c, http.StatusBadRequest, err.Error())
		return
	}

	fh.SendNoContent(c)
}
