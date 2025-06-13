package api

import (
	"github.com/gin-gonic/gin"
	"github.com/heysnelling/computesdk/pkg/api/handlers"
	"github.com/heysnelling/computesdk/pkg/api/services"
	"github.com/heysnelling/computesdk/pkg/auth"
	"github.com/heysnelling/computesdk/pkg/common"
	"gorm.io/gorm"
)

func NewRouter(db *gorm.DB, authInstance *auth.Auth) *gin.Engine {
	// Create router
	router := gin.Default()

	// Add health check route
	router.GET("/health", common.HealthCheckHandler)

	if db != nil && authInstance != nil {
		// Auth routes (public)
		authGroup := router.Group("/auth")
		{
			authGroup.POST("/register", authInstance.Handler.Register)
			authGroup.POST("/login", authInstance.Handler.Login)
			authGroup.POST("/refresh", authInstance.Handler.RefreshToken)
		}

		// API routes group
		apiGroup := router.Group("/api")

		// Public API routes
		publicAPI := apiGroup.Group("")
		{
			// End-user session creation (for compute sessions)
			publicAPI.POST("/sessions", authInstance.Handler.CreateEndUserSession)
		}

		// Protected API routes (require user or API key auth)
		protectedAPI := apiGroup.Group("")
		protectedAPI.Use(authInstance.Middleware.RequireAny())
		{
			// User profile routes
			protectedAPI.GET("/me", authInstance.Handler.GetCurrentUser)

			// API key management
			protectedAPI.POST("/api-keys", authInstance.Handler.CreateAPIKey)
			protectedAPI.GET("/api-keys", authInstance.Handler.ListAPIKeys)
			protectedAPI.DELETE("/api-keys/:id", authInstance.Handler.RevokeAPIKey)
		}

		// Initialize services
		computeService := services.NewComputeService(db)
		filesystemService := services.NewFilesystemService(db)
		secretService := services.NewSecretService(db)
		groupService := services.NewGroupService(db)

		// Initialize handlers
		computeHandler := handlers.NewComputeHandler(computeService)
		filesystemHandler := handlers.NewFilesystemHandler(filesystemService)
		secretHandler := handlers.NewSecretHandler(secretService)
		groupHandler := handlers.NewGroupHandler(groupService)

		// Register protected routes with auth middleware
		computeGroup := protectedAPI.Group("/computes")
		computeHandler.RegisterRoutes(computeGroup)

		filesystemGroup := protectedAPI.Group("/filesystems")
		filesystemHandler.RegisterRoutes(filesystemGroup)

		secretGroup := protectedAPI.Group("/secrets")
		secretHandler.RegisterRoutes(secretGroup)

		groupGroup := protectedAPI.Group("/groups")
		groupHandler.RegisterRoutes(groupGroup)

	}

	return router
}
