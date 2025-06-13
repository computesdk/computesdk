package main

import (
	"log"
	"os"

	"github.com/heysnelling/computesdk/pkg/api"
	"github.com/heysnelling/computesdk/pkg/auth"
	"github.com/heysnelling/computesdk/pkg/database"
	
	// Import to register auth migrations
	_ "github.com/heysnelling/computesdk/pkg/auth"
)

func main() {
	// Initialize Database
	config := database.GetConfigFromEnv()
	db, err := database.Initialize(config)
	if err != nil {
		log.Fatalf("Could not initialize database: %v", err)
	}

	// Run any registered migrations
	if err := database.RunMigrations(db); err != nil {
		log.Fatalf("Could not run migrations: %v", err)
	}

	// Initialize Auth
	authConfig := auth.Config{
		JWTSecret: getEnvOrDefault("JWT_SECRET", "your-secret-key-change-in-production"),
		JWTIssuer: getEnvOrDefault("JWT_ISSUER", "computesdk-api"),
	}
	authInstance := auth.NewAuth(db, authConfig)

	// Pass db and auth instance to NewRouter
	router := api.NewRouter(db, authInstance)

	port := ":8080"
	log.Printf("Starting API server on port %s", port)

	// Use Gin's Run method to start the server
	err = router.Run(port)
	if err != nil {
		log.Fatalf("Could not start server: %s\n", err)
	}
}

func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
