package sidekick

import (
	"github.com/gin-gonic/gin"
	"github.com/heysnelling/computesdk/pkg/common"
	"github.com/heysnelling/computesdk/pkg/sidekick/handlers"
	"github.com/heysnelling/computesdk/pkg/sidekick/services"
	"github.com/heysnelling/computesdk/pkg/sidekick/websocket"
)

func NewRouter() *gin.Engine {
	// Create router
	router := gin.Default()

	// Initialize WebSocket manager
	wsManager := websocket.NewManager()

	// Initialize services
	terminalService := services.NewTerminalService()
	filesystemService := services.NewFilesystemService() // Uses default /home/project
	fileWatcherService := services.NewFileWatcherService()
	signalService := services.NewSignalService()

	// Add health check route which doesn't require DB
	router.GET("/health", common.HealthCheckHandler)

	// WebSocket endpoint
	router.GET("/ws", wsManager.HandleWebSocket)

	// Initialize handlers
	filesHandler := handlers.NewFilesHandler(wsManager, filesystemService)
	terminalHandler := handlers.NewTerminalHandler(wsManager, terminalService)
	fileWatcherHandler := handlers.NewFileWatcherHandler(wsManager, fileWatcherService)
	signalHandler := handlers.NewSignalHandler(wsManager, signalService)

	// Files routes
	files := router.Group("/files")
	{
		files.GET("", filesHandler.Index)
		files.GET("/:id", filesHandler.Show)
		files.POST("", filesHandler.Create)
		files.PUT("/:id", filesHandler.Update)
		files.DELETE("/:id", filesHandler.Destroy)
	}

	// Terminal routes
	terminals := router.Group("/terminals")
	{
		terminals.POST("", terminalHandler.Create)
		terminals.GET("/:id", terminalHandler.Show)
		terminals.DELETE("/:id", terminalHandler.Destroy)
		terminals.POST("/:id/execute", terminalHandler.Execute)
	}

	// File watcher routes
	watchers := router.Group("/watchers")
	{
		watchers.GET("", fileWatcherHandler.Index)
		watchers.POST("", fileWatcherHandler.Create)
		watchers.GET("/:id", fileWatcherHandler.Show)
		watchers.DELETE("/:id", fileWatcherHandler.Destroy)
	}

	// Signal routes
	signals := router.Group("/signals")
	{
		signals.POST("/start", signalHandler.Start)
		signals.POST("/stop", signalHandler.Stop)
		signals.GET("/status", signalHandler.Status)
		signals.POST("/port", signalHandler.EmitPort)
		signals.POST("/error", signalHandler.EmitError)
		signals.POST("/server-ready", signalHandler.EmitServerReady)
		signals.POST("/port/:port/:type", signalHandler.EmitPortQuery)
	}

	return router
}
