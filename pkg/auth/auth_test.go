package auth

import (
	"testing"

	"github.com/heysnelling/computesdk/pkg/auth/handlers"
	"github.com/heysnelling/computesdk/pkg/auth/middleware"
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

	err = MigrateModels(db)
	require.NoError(t, err)

	return db
}

func TestNewAuth(t *testing.T) {
	db := setupTestDB(t)

	config := Config{
		JWTSecret: "test-secret-key-123",
		JWTIssuer: "test-issuer",
	}

	authInstance := NewAuth(db, config)

	assert.NotNil(t, authInstance)
	assert.NotNil(t, authInstance.Service)
	assert.NotNil(t, authInstance.JWT)
	assert.NotNil(t, authInstance.Middleware)
	assert.NotNil(t, authInstance.Handler)

	assert.IsType(t, &services.AuthService{}, authInstance.Service)
	assert.IsType(t, &services.JWTService{}, authInstance.JWT)
	assert.IsType(t, &middleware.AuthMiddleware{}, authInstance.Middleware)
	assert.IsType(t, &handlers.AuthHandler{}, authInstance.Handler)
}

func TestMigrateModels(t *testing.T) {
	db := setupTestDB(t)

	var hasTable bool
	
	tables := []string{
		"users",
		"organizations",
		"organization_members",
		"api_keys",
		"end_user_sessions",
	}

	for _, table := range tables {
		hasTable = db.Migrator().HasTable(table)
		assert.True(t, hasTable, "Table %s should exist", table)
	}

	err := db.First(&auth.User{}).Error
	assert.Equal(t, gorm.ErrRecordNotFound, err)

	err = db.First(&auth.Organization{}).Error
	assert.Equal(t, gorm.ErrRecordNotFound, err)

	err = db.First(&auth.OrganizationMember{}).Error
	assert.Equal(t, gorm.ErrRecordNotFound, err)

	err = db.First(&auth.APIKey{}).Error
	assert.Equal(t, gorm.ErrRecordNotFound, err)

	err = db.First(&auth.EndUserSession{}).Error
	assert.Equal(t, gorm.ErrRecordNotFound, err)
}

func TestAuthIntegration(t *testing.T) {
	db := setupTestDB(t)

	config := Config{
		JWTSecret: "test-secret-key-123",
		JWTIssuer: "test-issuer",
	}

	authInstance := NewAuth(db, config)

	user, err := authInstance.Service.RegisterUser("test@example.com", "password123", "Test", "User")
	require.NoError(t, err)
	assert.Equal(t, "test@example.com", user.Email)
	assert.Equal(t, "Test", user.FirstName)
	assert.Equal(t, "User", user.LastName)
	assert.True(t, user.IsActive)

	authenticatedUser, accessToken, refreshToken, err := authInstance.Service.AuthenticateUser("test@example.com", "password123")
	require.NoError(t, err)
	assert.NotNil(t, authenticatedUser)
	assert.Equal(t, user.ID, authenticatedUser.ID)
	assert.NotEmpty(t, accessToken)
	assert.NotEmpty(t, refreshToken)

	claims, err := authInstance.JWT.ValidateToken(accessToken)
	require.NoError(t, err)
	assert.Equal(t, user.ID, claims.UserID)
	assert.Equal(t, user.Email, claims.Email)
	assert.Equal(t, "user", claims.AuthType)
}