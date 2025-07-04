// Package api - the api that manages all of compute
package api

import (
	"github.com/gin-gonic/gin"
	"github.com/heysnelling/computesdk/pkg/api/compute"
	"github.com/heysnelling/computesdk/pkg/api/handlers"
	"github.com/heysnelling/computesdk/pkg/api/middleware"
	"github.com/heysnelling/computesdk/pkg/api/session"
	"github.com/heysnelling/computesdk/pkg/auth"
	"github.com/heysnelling/computesdk/pkg/common"
	"gorm.io/gorm"
)

func NewRouter(db *gorm.DB) *gin.Engine {
	// Create router
	router := gin.Default()

	// Add health check route
	router.GET("/health", common.HealthCheckHandler)

	if db != nil {
		// API routes group
		apiGroup := router.Group("/api")

		secret := "your-secret-key"
		jwtService := auth.NewJWTService(secret)

		// Initialize services
		computeService := compute.NewService(db)
		sessionService := session.NewService(db, jwtService)

		// Initialize handlers
		computeHandler := handlers.NewComputeHandler(computeService)
		sessionHandler := handlers.NewSessionHandler(sessionService)

		// Register protected routes with auth middleware
		sessionGroup := apiGroup.Group("/sessions")
		sessionHandler.RegisterRoutes(sessionGroup)

		authMiddleware := middleware.NewAuthMiddleware(jwtService, sessionService)
		protectedGroup := apiGroup.Group("")
		protectedGroup.Use(authMiddleware.SessionAuth())

		computeGroup := protectedGroup.Group("/computes")
		computeHandler.RegisterRoutes(computeGroup)
	}

	return router
}
