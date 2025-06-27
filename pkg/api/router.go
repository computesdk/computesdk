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

	// API routes group
	apiGroup := router.Group("/api")

	// Initialize services
	computeService := services.NewComputeService(db)

	// Initialize handlers
	computeHandler := handlers.NewComputeHandler(computeService)

	// Register protected routes with auth middleware
	computeGroup := apiGroup.Group("/computes")
	computeHandler.RegisterRoutes(computeGroup)

	return router
}
