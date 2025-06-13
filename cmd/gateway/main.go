package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
	"github.com/heysnelling/computesdk/pkg/gateway/config"
	"github.com/heysnelling/computesdk/pkg/gateway/proxy"
	k8sopsclient "github.com/heysnelling/computesdk/pkg/k8s"
)

func main() {
	log.Println("Starting Compute Gateway...")

	// Load configuration
	cfg := config.Load()
	log.Printf("Loaded configuration: namespace=%s, port=%s", cfg.Namespace, cfg.Port)

	// Initialize the generic Kubernetes client (PodOperations)
	// NewKubernetesClient handles in-cluster and default kubeconfig logic.
	// It uses the KUBECONFIG env var if set, or ~/.kube/config, or in-cluster config.
	// cfg.KubeconfigPath can be used if specific path override is still desired, but
	// NewKubernetesClient doesn't directly accept it. It would need to be set as an env var before this call
	// or NewKubernetesClient would need modification to accept it.
	// For now, assuming standard kubeconfig resolution is sufficient.
	k8sOps, err := k8sopsclient.NewKubernetesClient(nil, cfg.Namespace) // Pass nil for clientset to use default
	if err != nil {
		log.Fatalf("Failed to create Kubernetes operations client: %v", err)
	}

	// Create compute manager using the k8sopsclient package NewComputeManager
	// and pass the PodOperations client and namespace
	computeMgr := k8sopsclient.NewComputeManager(k8sOps, cfg.Namespace)

	// Initialize proxies
	wsProxy := proxy.NewWebSocketProxy(computeMgr, cfg.ReadBufferSize, cfg.WriteBufferSize, cfg.PodDefaultPort, true, 10*time.Second)
	// Using cfg.ReadBufferSize for maxBufferSize and defaulting enableTLS to false.
	httpProxy := proxy.NewHTTPProxy(computeMgr, cfg.ReadBufferSize, cfg.PodDefaultPort, false)

	// Setup HTTP router with handlers
	mux := http.NewServeMux()

	// Health check endpoint
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status": "healthy"}`))
	})

	// HTTP proxy handler (catch-all)
	mux.Handle("/", httpProxy)

	// Create server with timeouts
	server := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Intercept WebSocket upgrade requests
	server.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Check if this is a WebSocket upgrade request
		if websocket.IsWebSocketUpgrade(r) {
			// Handle WebSocket connections
			wsProxy.ServeHTTP(w, r)
			return
		}

		// Handle regular HTTP requests
		mux.ServeHTTP(w, r)
	})

	// Start server in a goroutine
	go func() {
		log.Printf("Gateway server listening on port %s", cfg.Port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed: %v", err)
		}
	}()

	// Wait for interrupt signal
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	// Block until signal is received
	<-stop
	log.Println("Shutting down server...")

	// Create context with timeout for shutdown
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Gracefully shutdown the server
	if err := server.Shutdown(ctx); err != nil {
		log.Fatalf("Server shutdown failed: %v", err)
	}

	log.Println("Server gracefully stopped")
}
