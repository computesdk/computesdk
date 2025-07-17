// Package api - the api that manages all of compute
package api

import (
	"context"
	"log"

	"github.com/gin-gonic/gin"
	"github.com/heysnelling/computesdk/pkg/api/apikey"
	"github.com/heysnelling/computesdk/pkg/api/compute"
	"github.com/heysnelling/computesdk/pkg/api/handlers"
	"github.com/heysnelling/computesdk/pkg/api/middleware"
	"github.com/heysnelling/computesdk/pkg/common"
	"github.com/heysnelling/computesdk/pkg/k8s"
	"github.com/heysnelling/computesdk/pkg/managers"
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

		// API key service for authentication
		apiKeyService := apikey.NewService(db)

		// Initialize Kubernetes client and managers
		k8sClient, err := k8s.NewKubernetesClient(
			k8s.WithNamespace("computesdk"),
		)
		if err != nil {
			log.Printf("Warning: Failed to create Kubernetes client: %v", err)
			log.Printf("Compute operations will not work properly")
			// Continue without k8s client - service will handle gracefully
		}

		var computeService *compute.ComputeService
		if k8sClient != nil {
			// Create managers
			factory := managers.NewManagerFactory(k8sClient, "computesdk")
			presetMgr, computeMgr := factory.CreateManagers()

			// Initialize default presets
			log.Printf("Initializing default presets...")
			err = managers.InitializeDefaultPresets(context.Background(), presetMgr)
			if err != nil {
				log.Printf("Warning: Failed to initialize default presets: %v", err)
				log.Printf("Some compute operations may fail without default presets")
			} else {
				log.Printf("Default presets initialized successfully")
			}

			// Initialize compute service with managers
			computeService = compute.NewService(db, computeMgr, presetMgr)
		} else {
			// Fallback: create service with nil managers (will need to handle this in service)
			computeService = compute.NewService(db, nil, nil)
		}

		// Initialize handlers
		computeHandler := handlers.NewComputeHandler(computeService)
		apiKeyHandler := handlers.NewAPIKeyHandler(apiKeyService)

		// Create API key authentication middleware
		authMiddleware := middleware.NewAPIKeyAuthMiddleware(apiKeyService)

		// Protected routes with API key authentication
		protectedGroup := apiGroup.Group("")
		protectedGroup.Use(authMiddleware.APIKeyAuth())

		computeGroup := protectedGroup.Group("/computes")
		computeHandler.RegisterRoutes(computeGroup)

		// API key management routes (also protected)
		apiKeyGroup := protectedGroup.Group("/keys")
		apiKeyHandler.RegisterRoutes(apiKeyGroup)
	}

	return router
}
