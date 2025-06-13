package proxy

import (
	"net/http"
	"strings"
)

// ExtractComputeID extracts the compute ID from an HTTP request
// using various methods (hostname, path, etc.)
func ExtractComputeID(r *http.Request) string {
	// First check hostname-based routing (like port-computeID.preview.computesdk.com)
	host := r.Host
	if host != "" {
		// Check for port-specific format: port-computeID.preview.computesdk.com
		if parts := strings.Split(host, "-"); len(parts) > 1 {
			if strings.Contains(parts[1], ".preview.") {
				computeID := strings.Split(parts[1], ".")[0]
				return computeID
			}
		}
		
		// Check for standard format: computeID.preview.computesdk.com
		if strings.Contains(host, ".preview.") {
			// Extract everything before .preview.
			hostParts := strings.Split(host, ".preview.")
			return hostParts[0]
		}
	}
	
	// Extract from path patterns
	pathParts := strings.Split(r.URL.Path, "/")
	
	// Pattern: /preview/{slug} where slug is {port}-{computeId}
	if len(pathParts) >= 3 && pathParts[1] == "preview" {
		slug := pathParts[2]
		// Extract compute ID from slug (port-computeId format)
		if parts := strings.Split(slug, "-"); len(parts) > 1 {
			// The compute ID is everything after the first dash
			return parts[1]
		}
		// If there's no dash, the whole slug is the compute ID
		return slug
	}
	
	return ""
}
