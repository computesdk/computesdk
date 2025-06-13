package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/heysnelling/computesdk/pkg/auth/services"
)

type AuthMiddleware struct {
	authService *services.AuthService
	jwtService  *services.JWTService
}

func NewAuthMiddleware(authService *services.AuthService, jwtService *services.JWTService) *AuthMiddleware {
	return &AuthMiddleware{
		authService: authService,
		jwtService:  jwtService,
	}
}

func (m *AuthMiddleware) RequireUser() gin.HandlerFunc {
	return func(c *gin.Context) {
		token := m.extractToken(c)
		if token == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "missing authentication token"})
			c.Abort()
			return
		}

		claims, err := m.jwtService.ValidateToken(token)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			c.Abort()
			return
		}

		if claims.AuthType != "user" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid authentication type"})
			c.Abort()
			return
		}

		c.Set("user_id", claims.UserID)
		c.Set("email", claims.Email)
		c.Set("org_id", claims.OrganizationID)
		c.Set("auth_type", "user")
		c.Next()
	}
}

func (m *AuthMiddleware) RequireAPIKey() gin.HandlerFunc {
	return func(c *gin.Context) {
		apiKey := c.GetHeader("X-API-Key")
		if apiKey == "" {
			token := m.extractToken(c)
			if token != "" {
				claims, err := m.jwtService.ValidateToken(token)
				if err == nil && claims.AuthType == "api_key" {
					c.Set("api_key_id", claims.APIKeyID)
					c.Set("org_id", claims.OrganizationID)
					c.Set("scopes", claims.Scopes)
					c.Set("auth_type", "api_key")
					c.Next()
					return
				}
			}
			
			c.JSON(http.StatusUnauthorized, gin.H{"error": "missing API key"})
			c.Abort()
			return
		}

		apiKeyModel, err := m.authService.ValidateAPIKey(apiKey)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
			c.Abort()
			return
		}

		c.Set("api_key_id", apiKeyModel.ID)
		c.Set("org_id", apiKeyModel.OrganizationID)
		c.Set("scopes", strings.Split(apiKeyModel.Scopes, ","))
		c.Set("auth_type", "api_key")
		c.Next()
	}
}

func (m *AuthMiddleware) RequireSession() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Try session token first
		sessionToken := c.GetHeader("X-Session-Token")
		if sessionToken != "" {
			session, err := m.authService.ValidateSessionToken(sessionToken)
			if err == nil {
				c.Set("session_id", session.ID)
				c.Set("org_id", session.OrganizationID)
				c.Set("auth_type", "session")
				c.Next()
				return
			}
		}

		// Fall back to Bearer token
		token := m.extractToken(c)
		if token == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "missing authentication token"})
			c.Abort()
			return
		}

		// For now, we'll validate this as a session token too
		// In the future, this could be JWT tokens
		session, err := m.authService.ValidateSessionToken(token)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session token"})
			c.Abort()
			return
		}

		c.Set("session_id", session.ID)
		c.Set("org_id", session.OrganizationID)
		c.Set("auth_type", "session")
		c.Next()
	}
}

func (m *AuthMiddleware) RequireAny() gin.HandlerFunc {
	return func(c *gin.Context) {
		token := m.extractToken(c)
		apiKey := c.GetHeader("X-API-Key")
		sessionToken := c.GetHeader("X-Session-Token")

		// Try JWT tokens first
		if token != "" {
			if claims, err := m.jwtService.ValidateToken(token); err == nil {
				switch claims.AuthType {
				case "user":
					c.Set("user_id", claims.UserID)
					c.Set("email", claims.Email)
					c.Set("org_id", claims.OrganizationID)
					c.Set("auth_type", "user")
					c.Next()
					return
				case "api_key":
					c.Set("api_key_id", claims.APIKeyID)
					c.Set("org_id", claims.OrganizationID)
					c.Set("scopes", claims.Scopes)
					c.Set("auth_type", "api_key")
					c.Next()
					return
				}
			}
		}

		// Try API key
		if apiKey != "" {
			if apiKeyModel, err := m.authService.ValidateAPIKey(apiKey); err == nil {
				c.Set("api_key_id", apiKeyModel.ID)
				c.Set("org_id", apiKeyModel.OrganizationID)
				c.Set("scopes", strings.Split(apiKeyModel.Scopes, ","))
				c.Set("auth_type", "api_key")
				c.Next()
				return
			}
		}

		// Try session token
		if sessionToken != "" {
			if session, err := m.authService.ValidateSessionToken(sessionToken); err == nil {
				c.Set("session_id", session.ID)
				c.Set("org_id", session.OrganizationID)
				c.Set("auth_type", "session")
				c.Next()
				return
			}
		}

		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		c.Abort()
	}
}

func (m *AuthMiddleware) extractToken(c *gin.Context) string {
	bearerToken := c.GetHeader("Authorization")
	if len(strings.Split(bearerToken, " ")) == 2 {
		return strings.Split(bearerToken, " ")[1]
	}
	return ""
}