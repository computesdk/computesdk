package main

import (
	"log"

	"github.com/heysnelling/computesdk/pkg/sidekick"
)

func main() {
	// Pass db instance to NewRouter
	router := sidekick.NewRouter()

	port := ":8080"
	log.Printf("Starting API server on port %s", port)

	// Use Gin's Run method to start the server
	err := router.Run(port)
	if err != nil {
		log.Fatalf("Could not start server: %s\n", err)
	}
}
