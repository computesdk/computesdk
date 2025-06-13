package handlers

import (
	"bytes"
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

func setupRouter(authService *services.AuthService) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	handler := NewAuthHandler(authService)
	handler.RegisterRoutes(router)
	return router
}

func TestRegisterSuccess(t *testing.T) {
	db := setupTestDB(t)
	jwtService := services.NewJWTService("test-secret", "test")
	authService := services.NewAuthService(db, jwtService)
	handler := NewAuthHandler(authService)
	
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/auth/register", handler.Register)

	reqBody := RegisterRequest{
		Email:     "test@example.com",
		Password:  "password123",
		FirstName: "Test",
		LastName:  "User",
	}

	body, _ := json.Marshal(reqBody)
	req, _ := http.NewRequest("POST", "/auth/register", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusCreated, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.Equal(t, "registration successful", response["message"])
	assert.NotNil(t, response["user"])
}

func TestRegisterValidationError(t *testing.T) {
	handler := NewAuthHandler(nil)
	
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/auth/register", handler.Register)

	reqBody := RegisterRequest{
		Email:    "invalid-email",
		Password: "short",
	}

	body, _ := json.Marshal(reqBody)
	req, _ := http.NewRequest("POST", "/auth/register", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.NotEmpty(t, response["error"])
}

func TestRegisterDuplicateEmail(t *testing.T) {
	db := setupTestDB(t)
	jwtService := services.NewJWTService("test-secret", "test")
	authService := services.NewAuthService(db, jwtService)
	handler := NewAuthHandler(authService)
	
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/auth/register", handler.Register)

	authService.RegisterUser("test@example.com", "password123", "Test", "User")

	reqBody := RegisterRequest{
		Email:     "test@example.com",
		Password:  "password123",
		FirstName: "Test",
		LastName:  "User",
	}

	body, _ := json.Marshal(reqBody)
	req, _ := http.NewRequest("POST", "/auth/register", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusConflict, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.Equal(t, "email already exists", response["error"])
}

func TestLoginSuccess(t *testing.T) {
	db := setupTestDB(t)
	jwtService := services.NewJWTService("test-secret", "test")
	authService := services.NewAuthService(db, jwtService)
	handler := NewAuthHandler(authService)
	
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/auth/login", handler.Login)

	authService.RegisterUser("test@example.com", "password123", "Test", "User")

	reqBody := LoginRequest{
		Email:    "test@example.com",
		Password: "password123",
	}

	body, _ := json.Marshal(reqBody)
	req, _ := http.NewRequest("POST", "/auth/login", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.NotEmpty(t, response["access_token"])
	assert.NotEmpty(t, response["refresh_token"])
	assert.Equal(t, "Bearer", response["token_type"])
	assert.NotNil(t, response["user"])
}

func TestLoginInvalidCredentials(t *testing.T) {
	db := setupTestDB(t)
	jwtService := services.NewJWTService("test-secret", "test")
	authService := services.NewAuthService(db, jwtService)
	handler := NewAuthHandler(authService)
	
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/auth/login", handler.Login)

	reqBody := LoginRequest{
		Email:    "test@example.com",
		Password: "wrongpassword",
	}

	body, _ := json.Marshal(reqBody)
	req, _ := http.NewRequest("POST", "/auth/login", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.NotEmpty(t, response["error"])
}

func TestCreateAPIKey(t *testing.T) {
	db := setupTestDB(t)
	jwtService := services.NewJWTService("test-secret", "test")
	authService := services.NewAuthService(db, jwtService)
	handler := NewAuthHandler(authService)
	
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/api-keys", func(c *gin.Context) {
		c.Set("org_id", uint(1))
		handler.CreateAPIKey(c)
	})

	reqBody := CreateAPIKeyRequest{
		Name:   "Test API Key",
		Scopes: []string{"read", "write"},
	}

	body, _ := json.Marshal(reqBody)
	req, _ := http.NewRequest("POST", "/api-keys", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusCreated, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.NotEmpty(t, response["key"])
	assert.Equal(t, "save this key securely, it won't be shown again", response["message"])
	assert.NotNil(t, response["api_key"])
}

func TestCreateEndUserSession(t *testing.T) {
	db := setupTestDB(t)
	jwtService := services.NewJWTService("test-secret", "test")
	authService := services.NewAuthService(db, jwtService)
	handler := NewAuthHandler(authService)
	
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/sessions", func(c *gin.Context) {
		c.Set("org_id", uint(1))
		handler.CreateEndUserSession(c)
	})

	metadata := map[string]interface{}{"user": "test"}

	reqBody := CreateEndUserSessionRequest{
		ComputeID: "compute-123",
		Metadata:  metadata,
	}

	body, _ := json.Marshal(reqBody)
	req, _ := http.NewRequest("POST", "/sessions", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusCreated, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.NotEmpty(t, response["token"])
	assert.Equal(t, "Bearer", response["token_type"])
	assert.NotNil(t, response["session"])
}

func TestGetCurrentUser(t *testing.T) {
	db := setupTestDB(t)
	jwtService := services.NewJWTService("test-secret", "test")
	authService := services.NewAuthService(db, jwtService)
	handler := NewAuthHandler(authService)
	
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/me", func(c *gin.Context) {
		c.Set("user_id", uint(1))
		handler.GetCurrentUser(c)
	})

	user, _ := authService.RegisterUser("test@example.com", "password123", "Test", "User")

	req, _ := http.NewRequest("GET", "/me", nil)
	w := httptest.NewRecorder()
	
	router.Use(func(c *gin.Context) {
		c.Set("user_id", user.ID)
		c.Next()
	})
	
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.NotNil(t, response["user"])
}

func TestRefreshToken(t *testing.T) {
	handler := NewAuthHandler(nil)
	
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/auth/refresh", handler.RefreshToken)

	req, _ := http.NewRequest("POST", "/auth/refresh", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotImplemented, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.Equal(t, "not implemented", response["error"])
}

func TestAuthMissingOrgID(t *testing.T) {
	handler := NewAuthHandler(nil)
	
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/api-keys", handler.CreateAPIKey)

	reqBody := CreateAPIKeyRequest{Name: "test"}
	body, _ := json.Marshal(reqBody)
	req, _ := http.NewRequest("POST", "/api-keys", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.Equal(t, "organization not found", response["error"])
}