// Package middleware is all about middleware
package middleware

import (
	"net/http"
	"slices"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/heysnelling/computesdk/pkg/api/apikey"
)

type AuthMiddleware struct {
	apiKeyService *apikey.APIKeyService
}

func NewAPIKeyAuthMiddleware(apiKeyService *apikey.APIKeyService) *AuthMiddleware {
	return &AuthMiddleware{
		apiKeyService: apiKeyService,
	}
}

// APIKeyAuth validates API keys
func (am *AuthMiddleware) APIKeyAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer csk_") {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key format"})
			c.Abort()
			return
		}

		apiKey := strings.TrimPrefix(authHeader, "Bearer ")

		// Validate API key
		keySummary, err := am.apiKeyService.ValidateAPIKey(c.Request.Context(), apiKey)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
			c.Abort()
			return
		}

		// Set context for downstream handlers
		c.Set("api_key_id", keySummary.ID)
		c.Set("permissions", keySummary.Permissions)
		c.Set("api_key_metadata", keySummary.Metadata)
		c.Set("api_key_name", keySummary.Name)

		c.Next()
	}
}

// OptionalAPIKeyAuth is like APIKeyAuth but doesn't require authentication
func (am *AuthMiddleware) OptionalAPIKeyAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer csk_") {
			// No API key, continue without setting context
			c.Next()
			return
		}

		apiKey := strings.TrimPrefix(authHeader, "Bearer ")

		// Try to validate API key
		keySummary, err := am.apiKeyService.ValidateAPIKey(c.Request.Context(), apiKey)
		if err != nil {
			// Invalid API key, continue without setting context
			c.Next()
			return
		}

		// Valid API key, add to context
		c.Set("api_key_id", keySummary.ID)
		c.Set("permissions", keySummary.Permissions)
		c.Set("api_key_metadata", keySummary.Metadata)
		c.Set("api_key_name", keySummary.Name)

		c.Next()
	}
}

// RequirePermission checks if the authenticated API key has a specific permission
func (am *AuthMiddleware) RequirePermission(permission string) gin.HandlerFunc {
	return func(c *gin.Context) {
		permissions, exists := c.Get("permissions")
		if !exists {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "No permissions found"})
			c.Abort()
			return
		}

		permissionList, ok := permissions.([]string)
		if !ok {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Invalid permissions format"})
			c.Abort()
			return
		}

		// Check if permission exists in the list
		if !slices.Contains(permissionList, permission) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Insufficient permissions"})
			c.Abort()
			return
		}

		c.Next()
	}
}

// Helper functions to extract values from Gin context

// GetAPIKeyID extracts API key ID from Gin context
func GetAPIKeyID(c *gin.Context) string {
	if keyID, exists := c.Get("api_key_id"); exists {
		if id, ok := keyID.(string); ok {
			return id
		}
	}
	return ""
}

// GetPermissions extracts permissions from Gin context
func GetPermissions(c *gin.Context) []string {
	if permissions, exists := c.Get("permissions"); exists {
		if perms, ok := permissions.([]string); ok {
			return perms
		}
	}
	return []string{}
}

// GetAPIKeyMetadata extracts API key metadata from Gin context
func GetAPIKeyMetadata(c *gin.Context) map[string]string {
	if metadata, exists := c.Get("api_key_metadata"); exists {
		if meta, ok := metadata.(map[string]string); ok {
			return meta
		}
	}
	return map[string]string{}
}

// GetAPIKeyName extracts API key name from Gin context
func GetAPIKeyName(c *gin.Context) string {
	if name, exists := c.Get("api_key_name"); exists {
		if n, ok := name.(string); ok {
			return n
		}
	}
	return ""
}

// HasPermission checks if the current API key has a specific permission
func HasPermission(c *gin.Context, permission string) bool {
	permissions := GetPermissions(c)
	return slices.Contains(permissions, permission)
}
