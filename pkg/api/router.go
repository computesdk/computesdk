// Package api - the api that manages all of compute
package api

import (
	"github.com/gin-gonic/gin"
	"github.com/heysnelling/computesdk/pkg/api/compute"
	"github.com/heysnelling/computesdk/pkg/api/events"
	"github.com/heysnelling/computesdk/pkg/api/handlers"
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

		eventStore := events.NewGormEventStore(db)

		// Initialize services
		computeService := compute.NewService(eventStore)

		// Initialize handlers
		computeHandler := handlers.NewComputeHandler(computeService)

		// Register protected routes with auth middleware
		computeGroup := apiGroup.Group("/computes")
		computeHandler.RegisterRoutes(computeGroup)
	}

	return router
}
