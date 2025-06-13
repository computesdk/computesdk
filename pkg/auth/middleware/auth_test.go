package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/heysnelling/computesdk/pkg/auth/services"
	"github.com/heysnelling/computesdk/pkg/models/auth"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func setupTestDB(t *testing.T) *gorm.DB {
	dsn := "host=localhost user=test password=test dbname=test_auth sslmode=disable"
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Skip("Test database not available:", err)
	}

	db.Exec("DROP SCHEMA public CASCADE")
	db.Exec("CREATE SCHEMA public")

	err = db.AutoMigrate(
		&auth.User{},
		&auth.Organization{},
		&auth.OrganizationMember{},
		&auth.APIKey{},
		&auth.EndUserSession{},
	)
	require.NoError(t, err)

	return db
}

func TestRequireUserSuccess(t *testing.T) {
	db := setupTestDB(t)
	jwtService := services.NewJWTService("test-secret", "test")
	authService := services.NewAuthService(db, jwtService)
	middleware := NewAuthMiddleware(authService, jwtService)

	user, err := authService.RegisterUser("test@example.com", "password123", "Test", "User")
	require.NoError(t, err)

	accessToken, _, err := jwtService.GenerateUserTokens(user.ID, user.Email, 0)
	require.NoError(t, err)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(middleware.RequireUser())
	router.GET("/protected", func(c *gin.Context) {
		userID := c.GetUint("user_id")
		email := c.GetString("email")
		authType := c.GetString("auth_type")
		
		c.JSON(http.StatusOK, gin.H{
			"user_id": userID,
			"email": email,
			"auth_type": authType,
		})
	})

	req, _ := http.NewRequest("GET", "/protected", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err = json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.Equal(t, float64(user.ID), response["user_id"])
	assert.Equal(t, user.Email, response["email"])
	assert.Equal(t, "user", response["auth_type"])
}

func TestRequireUserMissingToken(t *testing.T) {
	middleware := NewAuthMiddleware(nil, nil)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(middleware.RequireUser())
	router.GET("/protected", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"success": true})
	})

	req, _ := http.NewRequest("GET", "/protected", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.Equal(t, "missing authentication token", response["error"])
}

func TestRequireUserInvalidToken(t *testing.T) {
	jwtService := services.NewJWTService("test-secret", "test")
	middleware := NewAuthMiddleware(nil, jwtService)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(middleware.RequireUser())
	router.GET("/protected", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"success": true})
	})

	req, _ := http.NewRequest("GET", "/protected", nil)
	req.Header.Set("Authorization", "Bearer invalid-token")

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.Equal(t, "invalid token", response["error"])
}

func TestRequireUserWrongAuthType(t *testing.T) {
	jwtService := services.NewJWTService("test-secret", "test")
	middleware := NewAuthMiddleware(nil, jwtService)

	token, err := jwtService.GenerateAPIKeyToken(1, 1, []string{"read"})
	require.NoError(t, err)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(middleware.RequireUser())
	router.GET("/protected", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"success": true})
	})

	req, _ := http.NewRequest("GET", "/protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)

	var response map[string]interface{}
	err = json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.Equal(t, "invalid authentication type", response["error"])
}

func TestRequireAPIKeySuccess(t *testing.T) {
	db := setupTestDB(t)
	jwtService := services.NewJWTService("test-secret", "test")
	authService := services.NewAuthService(db, jwtService)
	middleware := NewAuthMiddleware(authService, jwtService)

	apiKey, rawKey, err := authService.CreateAPIKey(1, "Test Key", []string{"read", "write"})
	require.NoError(t, err)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(middleware.RequireAPIKey())
	router.GET("/protected", func(c *gin.Context) {
		apiKeyID := c.GetUint("api_key_id")
		orgID := c.GetUint("org_id")
		authType := c.GetString("auth_type")
		
		c.JSON(http.StatusOK, gin.H{
			"api_key_id": apiKeyID,
			"org_id": orgID,
			"auth_type": authType,
		})
	})

	req, _ := http.NewRequest("GET", "/protected", nil)
	req.Header.Set("X-API-Key", rawKey)

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err = json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.Equal(t, float64(apiKey.ID), response["api_key_id"])
	assert.Equal(t, float64(apiKey.OrganizationID), response["org_id"])
	assert.Equal(t, "api_key", response["auth_type"])
}

func TestRequireAPIKeyMissingKey(t *testing.T) {
	middleware := NewAuthMiddleware(nil, nil)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(middleware.RequireAPIKey())
	router.GET("/protected", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"success": true})
	})

	req, _ := http.NewRequest("GET", "/protected", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.Equal(t, "missing API key", response["error"])
}

func TestRequireAPIKeyJWTToken(t *testing.T) {
	jwtService := services.NewJWTService("test-secret", "test")
	middleware := NewAuthMiddleware(nil, jwtService)

	token, err := jwtService.GenerateAPIKeyToken(1, 1, []string{"read"})
	require.NoError(t, err)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(middleware.RequireAPIKey())
	router.GET("/protected", func(c *gin.Context) {
		apiKeyID := c.GetUint("api_key_id")
		orgID := c.GetUint("org_id")
		authType := c.GetString("auth_type")
		
		c.JSON(http.StatusOK, gin.H{
			"api_key_id": apiKeyID,
			"org_id": orgID,
			"auth_type": authType,
		})
	})

	req, _ := http.NewRequest("GET", "/protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err = json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.Equal(t, float64(1), response["api_key_id"])
	assert.Equal(t, float64(1), response["org_id"])
	assert.Equal(t, "api_key", response["auth_type"])
}

func TestRequireEndUserSuccess(t *testing.T) {
	db := setupTestDB(t)
	jwtService := services.NewJWTService("test-secret", "test")
	authService := services.NewAuthService(db, jwtService)
	middleware := NewAuthMiddleware(authService, jwtService)

	session, sessionToken, err := authService.CreateEndUserSession(1, "compute-123", nil)
	require.NoError(t, err)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(middleware.RequireEndUser())
	router.GET("/protected", func(c *gin.Context) {
		sessionID := c.GetUint("session_id")
		orgID := c.GetUint("org_id")
		authType := c.GetString("auth_type")
		
		c.JSON(http.StatusOK, gin.H{
			"session_id": sessionID,
			"org_id": orgID,
			"auth_type": authType,
		})
	})

	req, _ := http.NewRequest("GET", "/protected", nil)
	req.Header.Set("X-Session-Token", session.SessionToken)

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err = json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.Equal(t, float64(session.ID), response["session_id"])
	assert.Equal(t, float64(session.OrganizationID), response["org_id"])
	assert.Equal(t, "end_user", response["auth_type"])

	_ = sessionToken
}

func TestRequireEndUserJWTToken(t *testing.T) {
	jwtService := services.NewJWTService("test-secret", "test")
	middleware := NewAuthMiddleware(nil, jwtService)

	token, err := jwtService.GenerateEndUserToken(1, 1, "compute-123")
	require.NoError(t, err)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(middleware.RequireEndUser())
	router.GET("/protected", func(c *gin.Context) {
		sessionID := c.GetUint("session_id")
		orgID := c.GetUint("org_id")
		authType := c.GetString("auth_type")
		
		c.JSON(http.StatusOK, gin.H{
			"session_id": sessionID,
			"org_id": orgID,
			"auth_type": authType,
		})
	})

	req, _ := http.NewRequest("GET", "/protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err = json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.Equal(t, float64(1), response["session_id"])
	assert.Equal(t, float64(1), response["org_id"])
	assert.Equal(t, "end_user", response["auth_type"])
}

func TestRequireAnyWithUserToken(t *testing.T) {
	db := setupTestDB(t)
	jwtService := services.NewJWTService("test-secret", "test")
	authService := services.NewAuthService(db, jwtService)
	middleware := NewAuthMiddleware(authService, jwtService)

	user, err := authService.RegisterUser("test@example.com", "password123", "Test", "User")
	require.NoError(t, err)

	accessToken, _, err := jwtService.GenerateUserTokens(user.ID, user.Email, 1)
	require.NoError(t, err)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(middleware.RequireAny())
	router.GET("/protected", func(c *gin.Context) {
		authType := c.GetString("auth_type")
		c.JSON(http.StatusOK, gin.H{"auth_type": authType})
	})

	req, _ := http.NewRequest("GET", "/protected", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err = json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.Equal(t, "user", response["auth_type"])
}

func TestRequireAnyWithAPIKey(t *testing.T) {
	db := setupTestDB(t)
	jwtService := services.NewJWTService("test-secret", "test")
	authService := services.NewAuthService(db, jwtService)
	middleware := NewAuthMiddleware(authService, jwtService)

	_, rawKey, err := authService.CreateAPIKey(1, "Test Key", []string{"read"})
	require.NoError(t, err)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(middleware.RequireAny())
	router.GET("/protected", func(c *gin.Context) {
		authType := c.GetString("auth_type")
		c.JSON(http.StatusOK, gin.H{"auth_type": authType})
	})

	req, _ := http.NewRequest("GET", "/protected", nil)
	req.Header.Set("X-API-Key", rawKey)

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err = json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.Equal(t, "api_key", response["auth_type"])
}

func TestRequireAnyNoAuth(t *testing.T) {
	middleware := NewAuthMiddleware(nil, nil)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(middleware.RequireAny())
	router.GET("/protected", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"success": true})
	})

	req, _ := http.NewRequest("GET", "/protected", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.Equal(t, "authentication required", response["error"])
}

func TestExtractToken(t *testing.T) {
	middleware := NewAuthMiddleware(nil, nil)

	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())

	c.Request, _ = http.NewRequest("GET", "/", nil)
	c.Request.Header.Set("Authorization", "Bearer test-token")

	token := middleware.extractToken(c)
	assert.Equal(t, "test-token", token)

	c.Request.Header.Set("Authorization", "invalid-format")
	token = middleware.extractToken(c)
	assert.Equal(t, "", token)

	c.Request.Header.Del("Authorization")
	token = middleware.extractToken(c)
	assert.Equal(t, "", token)
}