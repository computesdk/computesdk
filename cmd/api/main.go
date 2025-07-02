package main

import (
	"log"

	"github.com/heysnelling/computesdk/pkg/api"
	"github.com/heysnelling/computesdk/pkg/api/database"
	// Import to register auth migrations
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

	// Pass db and auth instance to NewRouter
	router := api.NewRouter(db)

	port := ":8080"
	log.Printf("Starting API server on port %s", port)

	// Use Gin's Run method to start the server
	err = router.Run(port)
	if err != nil {
		log.Fatalf("Could not start server: %s\n", err)
	}
}
