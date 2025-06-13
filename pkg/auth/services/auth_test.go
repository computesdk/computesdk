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
		&auth.ClaimableSession{},
		&auth.ClaimableResource{},
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

func TestCreateClaimableSession(t *testing.T) {
	db := setupTestDB(t)
	jwtService := NewJWTService("test-secret", "test")
	authService := NewAuthService(db, jwtService)

	metadata := map[string]interface{}{"user": "test", "environment": "dev"}
	session, err := authService.CreateClaimableSession(1, "test@example.com", metadata)

	require.NoError(t, err)
	assert.NotNil(t, session)
	assert.Equal(t, uint(1), session.OrganizationID)
	assert.Equal(t, "test@example.com", session.Email)
	assert.NotEmpty(t, session.SessionToken)
	assert.True(t, session.ExpiresAt.After(time.Now()))

	var dbSession auth.ClaimableSession
	err = db.First(&dbSession, session.ID).Error
	require.NoError(t, err)
	assert.Equal(t, session.SessionToken, dbSession.SessionToken)
}

func TestValidateSessionTokenSuccess(t *testing.T) {
	db := setupTestDB(t)
	jwtService := NewJWTService("test-secret", "test")
	authService := NewAuthService(db, jwtService)

	session, err := authService.CreateClaimableSession(1, "", nil)
	require.NoError(t, err)

	validatedSession, err := authService.ValidateSessionToken(session.SessionToken)
	require.NoError(t, err)
	assert.NotNil(t, validatedSession)
	assert.Equal(t, session.ID, validatedSession.ID)
	assert.Equal(t, session.SessionToken, validatedSession.SessionToken)
}

func TestValidateSessionTokenInvalid(t *testing.T) {
	db := setupTestDB(t)
	jwtService := NewJWTService("test-secret", "test")
	authService := NewAuthService(db, jwtService)

	_, err := authService.ValidateSessionToken("invalid-token")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid or expired session")
}

func TestValidateSessionTokenExpired(t *testing.T) {
	db := setupTestDB(t)
	jwtService := NewJWTService("test-secret", "test")
	authService := NewAuthService(db, jwtService)

	session, err := authService.CreateClaimableSession(1, "", nil)
	require.NoError(t, err)

	expiredTime := time.Now().Add(-1 * time.Hour)
	db.Model(&session).Update("expires_at", expiredTime)

	_, err = authService.ValidateSessionToken(session.SessionToken)
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

func TestClaimSession(t *testing.T) {
	db := setupTestDB(t)
	jwtService := NewJWTService("test-secret", "test")
	authService := NewAuthService(db, jwtService)

	// Create a user
	user, err := authService.RegisterUser("test@example.com", "password123", "Test", "User")
	require.NoError(t, err)

	// Create a claimable session
	session, err := authService.CreateClaimableSession(1, "test@example.com", nil)
	require.NoError(t, err)

	// Claim the session
	err = authService.ClaimSession(session.ID, user.ID)
	require.NoError(t, err)

	// Verify the session is now linked to the user
	var updatedSession auth.ClaimableSession
	err = db.First(&updatedSession, session.ID).Error
	require.NoError(t, err)
	assert.Equal(t, user.ID, *updatedSession.UserID)
	assert.NotNil(t, updatedSession.ClaimedAt)
}

func TestClaimAllSessionsByEmail(t *testing.T) {
	db := setupTestDB(t)
	jwtService := NewJWTService("test-secret", "test")
	authService := NewAuthService(db, jwtService)

	// Create a user
	user, err := authService.RegisterUser("test@example.com", "password123", "Test", "User")
	require.NoError(t, err)

	// Create multiple sessions with the same email
	session1, err := authService.CreateClaimableSession(1, "test@example.com", nil)
	require.NoError(t, err)
	
	session2, err := authService.CreateClaimableSession(1, "test@example.com", nil)
	require.NoError(t, err)

	// Create a session with a different email (should not be claimed)
	session3, err := authService.CreateClaimableSession(1, "other@example.com", nil)
	require.NoError(t, err)

	// Claim all sessions for the email
	claimedCount, err := authService.ClaimAllSessionsByEmail("test@example.com", user.ID)
	require.NoError(t, err)
	assert.Equal(t, int64(2), claimedCount)

	// Verify the correct sessions were claimed
	var updatedSession1 auth.ClaimableSession
	err = db.First(&updatedSession1, session1.ID).Error
	require.NoError(t, err)
	assert.Equal(t, user.ID, *updatedSession1.UserID)

	var updatedSession2 auth.ClaimableSession
	err = db.First(&updatedSession2, session2.ID).Error
	require.NoError(t, err)
	assert.Equal(t, user.ID, *updatedSession2.UserID)

	// Verify the other session was not claimed
	var updatedSession3 auth.ClaimableSession
	err = db.First(&updatedSession3, session3.ID).Error
	require.NoError(t, err)
	assert.Nil(t, updatedSession3.UserID)
}

func TestAddResourceToSession(t *testing.T) {
	db := setupTestDB(t)
	jwtService := NewJWTService("test-secret", "test")
	authService := NewAuthService(db, jwtService)

	// Create a session
	session, err := authService.CreateClaimableSession(1, "test@example.com", nil)
	require.NoError(t, err)

	// Add a resource to the session
	resource, err := authService.AddResourceToSession(session.ID, "Compute", "compute-123", []string{"read", "write"})
	require.NoError(t, err)
	assert.NotNil(t, resource)
	assert.Equal(t, session.ID, resource.SessionID)
	assert.Equal(t, "Compute", resource.ResourceType)
	assert.Equal(t, "compute-123", resource.ResourceID)
	assert.Contains(t, resource.Permissions, "read")

	// Verify it's in the database
	var dbResource auth.ClaimableResource
	err = db.First(&dbResource, resource.ID).Error
	require.NoError(t, err)
	assert.Equal(t, resource.SessionID, dbResource.SessionID)
}

func TestGetClaimableSession(t *testing.T) {
	db := setupTestDB(t)
	jwtService := NewJWTService("test-secret", "test")
	authService := NewAuthService(db, jwtService)

	// Create a session with resources
	session, err := authService.CreateClaimableSession(1, "test@example.com", nil)
	require.NoError(t, err)

	// Add a resource
	_, err = authService.AddResourceToSession(session.ID, "Compute", "compute-123", []string{"read"})
	require.NoError(t, err)

	// Get the session with resources
	retrievedSession, err := authService.GetClaimableSession(session.ID)
	require.NoError(t, err)
	assert.NotNil(t, retrievedSession)
	assert.Equal(t, session.ID, retrievedSession.ID)
	assert.Len(t, retrievedSession.Resources, 1)
	assert.Equal(t, "Compute", retrievedSession.Resources[0].ResourceType)
}