package services

import (
	"testing"
	"time"

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

func TestRegisterUser(t *testing.T) {
	db := setupTestDB(t)
	jwtService := NewJWTService("test-secret", "test")
	authService := NewAuthService(db, jwtService)

	user, err := authService.RegisterUser("test@example.com", "password123", "Test", "User")

	require.NoError(t, err)
	assert.NotNil(t, user)
	assert.Equal(t, "test@example.com", user.Email)
	assert.Equal(t, "Test", user.FirstName)
	assert.Equal(t, "User", user.LastName)
	assert.True(t, user.IsActive)
	assert.NotEmpty(t, user.PasswordHash)
	assert.NotEqual(t, "password123", user.PasswordHash)

	var dbUser auth.User
	err = db.First(&dbUser, user.ID).Error
	require.NoError(t, err)
	assert.Equal(t, user.Email, dbUser.Email)
}

func TestRegisterUserDuplicateEmail(t *testing.T) {
	db := setupTestDB(t)
	jwtService := NewJWTService("test-secret", "test")
	authService := NewAuthService(db, jwtService)

	_, err := authService.RegisterUser("test@example.com", "password123", "Test", "User")
	require.NoError(t, err)

	_, err = authService.RegisterUser("test@example.com", "password456", "Another", "User")
	assert.Error(t, err)
}

func TestAuthenticateUserSuccess(t *testing.T) {
	db := setupTestDB(t)
	jwtService := NewJWTService("test-secret", "test")
	authService := NewAuthService(db, jwtService)

	registeredUser, err := authService.RegisterUser("test@example.com", "password123", "Test", "User")
	require.NoError(t, err)

	user, accessToken, refreshToken, err := authService.AuthenticateUser("test@example.com", "password123")

	require.NoError(t, err)
	assert.NotNil(t, user)
	assert.Equal(t, registeredUser.ID, user.ID)
	assert.Equal(t, "test@example.com", user.Email)
	assert.NotEmpty(t, accessToken)
	assert.NotEmpty(t, refreshToken)
}

func TestAuthenticateUserInvalidEmail(t *testing.T) {
	db := setupTestDB(t)
	jwtService := NewJWTService("test-secret", "test")
	authService := NewAuthService(db, jwtService)

	_, _, _, err := authService.AuthenticateUser("nonexistent@example.com", "password123")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid credentials")
}

func TestAuthenticateUserInvalidPassword(t *testing.T) {
	db := setupTestDB(t)
	jwtService := NewJWTService("test-secret", "test")
	authService := NewAuthService(db, jwtService)

	_, err := authService.RegisterUser("test@example.com", "password123", "Test", "User")
	require.NoError(t, err)

	_, _, _, err = authService.AuthenticateUser("test@example.com", "wrongpassword")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid credentials")
}

func TestAuthenticateUserInactive(t *testing.T) {
	db := setupTestDB(t)
	jwtService := NewJWTService("test-secret", "test")
	authService := NewAuthService(db, jwtService)

	user, err := authService.RegisterUser("test@example.com", "password123", "Test", "User")
	require.NoError(t, err)

	db.Model(&user).Update("is_active", false)

	_, _, _, err = authService.AuthenticateUser("test@example.com", "password123")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid credentials")
}

func TestCreateAPIKey(t *testing.T) {
	db := setupTestDB(t)
	jwtService := NewJWTService("test-secret", "test")
	authService := NewAuthService(db, jwtService)

	apiKey, rawKey, err := authService.CreateAPIKey(1, "Test API Key", []string{"read", "write"})

	require.NoError(t, err)
	assert.NotNil(t, apiKey)
	assert.Equal(t, "Test API Key", apiKey.Name)
	assert.Equal(t, uint(1), apiKey.OrganizationID)
	assert.Equal(t, "read,write", apiKey.Scopes)
	assert.NotEmpty(t, apiKey.KeyHash)
	assert.NotEmpty(t, apiKey.KeyPrefix)
	assert.NotEmpty(t, rawKey)
	assert.True(t, len(rawKey) > 8)
	assert.Equal(t, rawKey[:8], apiKey.KeyPrefix)

	var dbAPIKey auth.APIKey
	err = db.First(&dbAPIKey, apiKey.ID).Error
	require.NoError(t, err)
	assert.Equal(t, apiKey.Name, dbAPIKey.Name)
}

func TestValidateAPIKeySuccess(t *testing.T) {
	db := setupTestDB(t)
	jwtService := NewJWTService("test-secret", "test")
	authService := NewAuthService(db, jwtService)

	_, rawKey, err := authService.CreateAPIKey(1, "Test API Key", []string{"read"})
	require.NoError(t, err)

	validatedKey, err := authService.ValidateAPIKey(rawKey)
	require.NoError(t, err)
	assert.NotNil(t, validatedKey)
	assert.Equal(t, "Test API Key", validatedKey.Name)
	assert.Equal(t, uint(1), validatedKey.OrganizationID)
}

func TestValidateAPIKeyInvalid(t *testing.T) {
	db := setupTestDB(t)
	jwtService := NewJWTService("test-secret", "test")
	authService := NewAuthService(db, jwtService)

	_, err := authService.ValidateAPIKey("invalid-key")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid API key")
}

func TestValidateAPIKeyExpired(t *testing.T) {
	db := setupTestDB(t)
	jwtService := NewJWTService("test-secret", "test")
	authService := NewAuthService(db, jwtService)

	apiKey, rawKey, err := authService.CreateAPIKey(1, "Test API Key", []string{"read"})
	require.NoError(t, err)

	expiredTime := time.Now().Add(-1 * time.Hour)
	db.Model(&apiKey).Update("expires_at", &expiredTime)

	_, err = authService.ValidateAPIKey(rawKey)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "API key expired")
}

func TestCreateEndUserSession(t *testing.T) {
	db := setupTestDB(t)
	jwtService := NewJWTService("test-secret", "test")
	authService := NewAuthService(db, jwtService)

	metadata := map[string]interface{}{"user": "test", "environment": "dev"}
	session, token, err := authService.CreateEndUserSession(1, "compute-123", metadata)

	require.NoError(t, err)
	assert.NotNil(t, session)
	assert.Equal(t, uint(1), session.OrganizationID)
	assert.Equal(t, "compute-123", session.ComputeID)
	assert.NotEmpty(t, session.SessionToken)
	assert.NotEmpty(t, token)
	assert.True(t, session.ExpiresAt.After(time.Now()))

	var dbSession auth.EndUserSession
	err = db.First(&dbSession, session.ID).Error
	require.NoError(t, err)
	assert.Equal(t, session.SessionToken, dbSession.SessionToken)
}

func TestValidateEndUserSessionSuccess(t *testing.T) {
	db := setupTestDB(t)
	jwtService := NewJWTService("test-secret", "test")
	authService := NewAuthService(db, jwtService)

	session, _, err := authService.CreateEndUserSession(1, "compute-123", nil)
	require.NoError(t, err)

	validatedSession, err := authService.ValidateEndUserSession(session.SessionToken)
	require.NoError(t, err)
	assert.NotNil(t, validatedSession)
	assert.Equal(t, session.ID, validatedSession.ID)
	assert.Equal(t, session.SessionToken, validatedSession.SessionToken)
}

func TestValidateEndUserSessionInvalid(t *testing.T) {
	db := setupTestDB(t)
	jwtService := NewJWTService("test-secret", "test")
	authService := NewAuthService(db, jwtService)

	_, err := authService.ValidateEndUserSession("invalid-token")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid or expired session")
}

func TestValidateEndUserSessionExpired(t *testing.T) {
	db := setupTestDB(t)
	jwtService := NewJWTService("test-secret", "test")
	authService := NewAuthService(db, jwtService)

	session, _, err := authService.CreateEndUserSession(1, "compute-123", nil)
	require.NoError(t, err)

	expiredTime := time.Now().Add(-1 * time.Hour)
	db.Model(&session).Update("expires_at", expiredTime)

	_, err = authService.ValidateEndUserSession(session.SessionToken)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid or expired session")
}

func TestGetUserByID(t *testing.T) {
	db := setupTestDB(t)
	jwtService := NewJWTService("test-secret", "test")
	authService := NewAuthService(db, jwtService)

	registeredUser, err := authService.RegisterUser("test@example.com", "password123", "Test", "User")
	require.NoError(t, err)

	user, err := authService.GetUserByID(registeredUser.ID)
	require.NoError(t, err)
	assert.NotNil(t, user)
	assert.Equal(t, registeredUser.ID, user.ID)
	assert.Equal(t, "test@example.com", user.Email)
	assert.Equal(t, "Test", user.FirstName)
	assert.Equal(t, "User", user.LastName)
}

func TestGetUserByIDNotFound(t *testing.T) {
	db := setupTestDB(t)
	jwtService := NewJWTService("test-secret", "test")
	authService := NewAuthService(db, jwtService)

	_, err := authService.GetUserByID(999)
	assert.Error(t, err)
}

func TestGenerateAPIKey(t *testing.T) {
	db := setupTestDB(t)
	jwtService := NewJWTService("test-secret", "test")
	authService := NewAuthService(db, jwtService)

	key1 := authService.generateAPIKey()
	key2 := authService.generateAPIKey()

	assert.NotEqual(t, key1, key2)
	assert.True(t, len(key1) > 10)
	assert.True(t, len(key2) > 10)
	assert.Contains(t, key1, "sk_")
	assert.Contains(t, key2, "sk_")
}

func TestHashAPIKey(t *testing.T) {
	db := setupTestDB(t)
	jwtService := NewJWTService("test-secret", "test")
	authService := NewAuthService(db, jwtService)

	key := "test-api-key"
	hash1 := authService.hashAPIKey(key)
	hash2 := authService.hashAPIKey(key)

	assert.Equal(t, hash1, hash2)
	assert.NotEqual(t, key, hash1)
	assert.True(t, len(hash1) > 0)

	differentHash := authService.hashAPIKey("different-key")
	assert.NotEqual(t, hash1, differentHash)
}

func TestGenerateSessionToken(t *testing.T) {
	db := setupTestDB(t)
	jwtService := NewJWTService("test-secret", "test")
	authService := NewAuthService(db, jwtService)

	token1 := authService.generateSessionToken()
	token2 := authService.generateSessionToken()

	assert.NotEqual(t, token1, token2)
	assert.True(t, len(token1) > 10)
	assert.True(t, len(token2) > 10)
}