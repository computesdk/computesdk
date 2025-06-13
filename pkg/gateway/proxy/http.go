package proxy

import (
	"fmt"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"

	k8s "github.com/heysnelling/computesdk/pkg/k8s"
)

// HTTPProxy handles HTTP requests to compute pods
type HTTPProxy struct {
	podManager      k8s.ComputeManagerInterface
	maxBufferSize   int
	defaultPodPort  int
	enableTLS       bool
}

// NewHTTPProxy creates a new HTTP proxy
func NewHTTPProxy(podManager k8s.ComputeManagerInterface, maxBufferSize, defaultPodPort int, enableTLS bool) *HTTPProxy {
	return &HTTPProxy{
		podManager:      podManager,
		maxBufferSize:   maxBufferSize,
		defaultPodPort:  defaultPodPort,
		enableTLS:       enableTLS,
	}
}

// ServeHTTP handles HTTP requests
func (hp *HTTPProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Get compute ID from the request
	computeID := ExtractComputeID(r)
	if computeID == "" {
		log.Printf("ERROR: Missing compute ID in request: %s %s", r.Method, r.URL.String())
		http.Error(w, "Missing compute ID", http.StatusBadRequest)
		return
	}

	log.Printf("INFO: HTTP request for compute ID: %s, path: %s, method: %s, host: %s", computeID, r.URL.Path, r.Method, r.Host)

	// Get the target pod
	pod, err := hp.podManager.GetPod(r.Context(), computeID)
	if err != nil {
		log.Printf("ERROR: Finding pod for compute ID %s: %v", computeID, err)
		http.Error(w, "Pod not found", http.StatusNotFound)
		return
	}

	// Check if pod is ready
	if !pod.IsReady || pod.IP == "" {
		log.Printf("ERROR: Pod %s is not ready or has no IP. Ready: %v, IP: %s", pod.Name, pod.IsReady, pod.IP)
		http.Error(w, "Pod not ready", http.StatusServiceUnavailable)
		return
	}

	log.Printf("INFO: Found pod for compute ID %s: name=%s, ip=%s, ready=%v", computeID, pod.Name, pod.IP, pod.IsReady)

	// Default port for HTTP connections
	port := hp.defaultPodPort

	// Handle port-specific subdomains like 3000-computeID.compute.domain.com
	if parts := strings.Split(r.Host, "-"); len(parts) > 1 && parts[0] != "" {
		if customPort, err := parsePort(parts[0]); err == nil {
			port = customPort
			log.Printf("INFO: Using custom port %d from subdomain", port)
		}
	}

	// Construct target URL
	targetURL := &url.URL{
		Scheme: "http",
		Host:   fmt.Sprintf("%s:%d", pod.IP, port),
	}

	log.Printf("INFO: Proxying HTTP to %s for compute ID %s (pod name: %s)", targetURL.String(), computeID, pod.Name)

	// Create the reverse proxy
	proxy := httputil.NewSingleHostReverseProxy(targetURL)

	// Set up proxy director to modify the request
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)

		// Update the Host header to match the target
		req.Host = targetURL.Host
		log.Printf("DEBUG: Set Host header to %s", req.Host)

		// Add X-Forwarded headers
		req.Header.Set("X-Forwarded-Host", r.Host)
		req.Header.Set("X-Forwarded-Proto", "http")

		// Add custom header for compute ID
		req.Header.Set("X-Compute-ID", computeID)

		log.Printf("DEBUG: Modified request headers: %v", req.Header)
	}

	// Configure error handler
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		log.Printf("ERROR: Proxy error when connecting to %s: %v", targetURL.String(), err)
		http.Error(w, fmt.Sprintf("Proxy error: %v", err), http.StatusBadGateway)
	}

	// Serve the request
	log.Printf("INFO: Starting proxy request to %s", targetURL.String())
	proxy.ServeHTTP(w, r)
	log.Printf("INFO: Completed proxy request to %s", targetURL.String())
}

// Helper function to parse port from string
func parsePort(portStr string) (int, error) {
	port, err := strconv.Atoi(portStr)
	if err != nil {
		return 0, fmt.Errorf("invalid port number: %s", portStr)
	}

	// Validate port range
	if port < 0 || port > 65535 {
		return 0, fmt.Errorf("port number out of range (0-65535): %d", port)
	}

	return port, nil
}
