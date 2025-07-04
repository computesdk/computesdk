// Package middleware is all about middleware
package middleware

import (
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/heysnelling/computesdk/pkg/api/session"
	"github.com/heysnelling/computesdk/pkg/auth"
)

type AuthMiddleware struct {
	jwtService     *auth.JWTService
	sessionService *session.SessionService
}

func NewAuthMiddleware(jwtService *auth.JWTService, sessionService *session.SessionService) *AuthMiddleware {
	return &AuthMiddleware{
		jwtService:     jwtService,
		sessionService: sessionService,
	}
}

// SessionAuth validates JWT tokens and ensures sessions are active
func (am *AuthMiddleware) SessionAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer ") {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Missing or invalid authorization header"})
			c.Abort()
			return
		}

		tokenString := strings.TrimPrefix(authHeader, "Bearer ")

		// Validate JWT token
		claims, err := am.jwtService.ValidateToken(tokenString)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token"})
			c.Abort()
			return
		}

		// Verify session is still active
		summary, err := am.sessionService.GetSession(c.Request.Context(), claims.SessionID)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Session not found"})
			c.Abort()
			return
		}

		if summary.Status != "active" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Session inactive"})
			c.Abort()
			return
		}

		// Check if session has expired
		if summary.ExpiresAt != nil && time.Now().After(*summary.ExpiresAt) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Session expired"})
			c.Abort()
			return
		}

		// Add session info to context
		c.Set("session_id", claims.SessionID)
		c.Set("permissions", claims.Permissions)
		c.Set("session_claims", claims)

		c.Next()
	}
}

// OptionalSessionAuth is like SessionAuth but doesn't require authentication
// Useful for endpoints that can work with or without authentication
func (am *AuthMiddleware) OptionalSessionAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer ") {
			// No auth header, continue without setting session context
			c.Next()
			return
		}

		tokenString := strings.TrimPrefix(authHeader, "Bearer ")

		// Try to validate token
		claims, err := am.jwtService.ValidateToken(tokenString)
		if err != nil {
			// Invalid token, continue without setting session context
			c.Next()
			return
		}

		// Try to get session
		summary, err := am.sessionService.GetSession(c.Request.Context(), claims.SessionID)
		if err != nil || summary.Status != "active" {
			// Session not found or inactive, continue without setting session context
			c.Next()
			return
		}

		// Check expiry
		if summary.ExpiresAt != nil && time.Now().After(*summary.ExpiresAt) {
			// Session expired, continue without setting session context
			c.Next()
			return
		}

		// Valid session, add to context
		c.Set("session_id", claims.SessionID)
		c.Set("permissions", claims.Permissions)
		c.Set("session_claims", claims)

		c.Next()
	}
}

// RequirePermission checks if the authenticated session has a specific permission
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

// GetSessionID extracts session ID from Gin context
func GetSessionID(c *gin.Context) string {
	if sessionID, exists := c.Get("session_id"); exists {
		if id, ok := sessionID.(string); ok {
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

// GetSessionClaims extracts full session claims from Gin context
func GetSessionClaims(c *gin.Context) *auth.SessionClaims {
	if claims, exists := c.Get("session_claims"); exists {
		if sessionClaims, ok := claims.(*auth.SessionClaims); ok {
			return sessionClaims
		}
	}
	return nil
}

// HasPermission checks if the current session has a specific permission
func HasPermission(c *gin.Context, permission string) bool {
	permissions := GetPermissions(c)
	return slices.Contains(permissions, permission)
}
