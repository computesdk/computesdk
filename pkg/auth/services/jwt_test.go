package services

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewJWTService(t *testing.T) {
	jwtService := NewJWTService("test-secret", "test-issuer")

	assert.NotNil(t, jwtService)
	assert.Equal(t, []byte("test-secret"), jwtService.secretKey)
	assert.Equal(t, "test-issuer", jwtService.issuer)
	assert.Equal(t, 15*time.Minute, jwtService.accessTokenTTL)
	assert.Equal(t, 7*24*time.Hour, jwtService.refreshTokenTTL)
}

func TestGenerateUserTokens(t *testing.T) {
	jwtService := NewJWTService("test-secret", "test-issuer")

	accessToken, refreshToken, err := jwtService.GenerateUserTokens(1, "test@example.com", 10)

	require.NoError(t, err)
	assert.NotEmpty(t, accessToken)
	assert.NotEmpty(t, refreshToken)
	assert.NotEqual(t, accessToken, refreshToken)

	accessClaims, err := jwtService.ValidateToken(accessToken)
	require.NoError(t, err)
	assert.Equal(t, uint(1), accessClaims.UserID)
	assert.Equal(t, "test@example.com", accessClaims.Email)
	assert.Equal(t, uint(10), accessClaims.OrganizationID)
	assert.Equal(t, "user", accessClaims.AuthType)
	assert.Equal(t, "test-issuer", accessClaims.Issuer)

	refreshClaims, err := jwtService.ValidateToken(refreshToken)
	require.NoError(t, err)
	assert.Equal(t, uint(1), refreshClaims.UserID)
	assert.Equal(t, "refresh", refreshClaims.AuthType)
	assert.Equal(t, "test-issuer", refreshClaims.Issuer)
	assert.Empty(t, refreshClaims.Email)
	assert.Equal(t, uint(0), refreshClaims.OrganizationID)
}

func TestGenerateAPIKeyToken(t *testing.T) {
	jwtService := NewJWTService("test-secret", "test-issuer")

	scopes := []string{"read", "write", "admin"}
	token, err := jwtService.GenerateAPIKeyToken(5, 20, scopes)

	require.NoError(t, err)
	assert.NotEmpty(t, token)

	claims, err := jwtService.ValidateToken(token)
	require.NoError(t, err)
	assert.Equal(t, uint(5), claims.APIKeyID)
	assert.Equal(t, uint(20), claims.OrganizationID)
	assert.Equal(t, "api_key", claims.AuthType)
	assert.Equal(t, scopes, claims.Scopes)
	assert.Equal(t, "test-issuer", claims.Issuer)
	assert.Equal(t, uint(0), claims.UserID)
	assert.Empty(t, claims.Email)
}


func TestValidateTokenSuccess(t *testing.T) {
	jwtService := NewJWTService("test-secret", "test-issuer")

	accessToken, _, err := jwtService.GenerateUserTokens(1, "test@example.com", 10)
	require.NoError(t, err)

	claims, err := jwtService.ValidateToken(accessToken)
	require.NoError(t, err)
	assert.NotNil(t, claims)
	assert.Equal(t, uint(1), claims.UserID)
	assert.Equal(t, "test@example.com", claims.Email)
	assert.Equal(t, "user", claims.AuthType)
}

func TestValidateTokenInvalid(t *testing.T) {
	jwtService := NewJWTService("test-secret", "test-issuer")

	_, err := jwtService.ValidateToken("invalid.token.here")
	assert.Error(t, err)
}

func TestValidateTokenWrongSecret(t *testing.T) {
	jwtService1 := NewJWTService("secret-1", "test-issuer")
	jwtService2 := NewJWTService("secret-2", "test-issuer")

	token, err := jwtService1.GenerateAPIKeyToken(1, 1, []string{"read"})
	require.NoError(t, err)

	_, err = jwtService2.ValidateToken(token)
	assert.Error(t, err)
}

func TestValidateTokenExpired(t *testing.T) {
	jwtService := NewJWTService("test-secret", "test-issuer")

	claims := JWTClaims{
		UserID:   1,
		AuthType: "user",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-1 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now().Add(-2 * time.Hour)),
			Issuer:    "test-issuer",
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString(jwtService.secretKey)
	require.NoError(t, err)

	_, err = jwtService.ValidateToken(tokenString)
	assert.Error(t, err)
}

func TestValidateTokenWrongSigningMethod(t *testing.T) {
	claims := JWTClaims{
		UserID:   1,
		AuthType: "user",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(1 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "test-issuer",
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodNone, claims)
	tokenString, err := token.SignedString(jwt.UnsafeAllowNoneSignatureType)
	require.NoError(t, err)

	jwtService := NewJWTService("test-secret", "test-issuer")
	_, err = jwtService.ValidateToken(tokenString)
	assert.Error(t, err)
}

func TestJWTClaimsStructure(t *testing.T) {
	claims := JWTClaims{
		UserID:         1,
		OrganizationID: 2,
		APIKeyID:       3,
		Email:          "test@example.com",
		AuthType:       "user",
		Scopes:         []string{"read", "write"},
	}

	assert.Equal(t, uint(1), claims.UserID)
	assert.Equal(t, uint(2), claims.OrganizationID)
	assert.Equal(t, uint(3), claims.APIKeyID)
	assert.Equal(t, "test@example.com", claims.Email)
	assert.Equal(t, "user", claims.AuthType)
	assert.Equal(t, []string{"read", "write"}, claims.Scopes)
}

func TestTokenUniqueness(t *testing.T) {
	jwtService := NewJWTService("test-secret", "test-issuer")

	token1, _, err := jwtService.GenerateUserTokens(1, "test@example.com", 1)
	require.NoError(t, err)

	time.Sleep(1 * time.Second)

	token2, _, err := jwtService.GenerateUserTokens(1, "test@example.com", 1)
	require.NoError(t, err)

	assert.NotEqual(t, token1, token2)
}

func TestTokenExpiration(t *testing.T) {
	jwtService := NewJWTService("test-secret", "test-issuer")

	accessToken, refreshToken, err := jwtService.GenerateUserTokens(1, "test@example.com", 1)
	require.NoError(t, err)

	accessClaims, err := jwtService.ValidateToken(accessToken)
	require.NoError(t, err)

	refreshClaims, err := jwtService.ValidateToken(refreshToken)
	require.NoError(t, err)

	assert.True(t, accessClaims.ExpiresAt.Before(refreshClaims.ExpiresAt.Time))

	expectedAccessExpiry := time.Now().Add(jwtService.accessTokenTTL)
	expectedRefreshExpiry := time.Now().Add(jwtService.refreshTokenTTL)

	assert.WithinDuration(t, expectedAccessExpiry, accessClaims.ExpiresAt.Time, 5*time.Second)
	assert.WithinDuration(t, expectedRefreshExpiry, refreshClaims.ExpiresAt.Time, 5*time.Second)
}

func TestGenerateTokensWithEmptyEmail(t *testing.T) {
	jwtService := NewJWTService("test-secret", "test-issuer")

	accessToken, refreshToken, err := jwtService.GenerateUserTokens(1, "", 1)
	require.NoError(t, err)
	assert.NotEmpty(t, accessToken)
	assert.NotEmpty(t, refreshToken)

	claims, err := jwtService.ValidateToken(accessToken)
	require.NoError(t, err)
	assert.Empty(t, claims.Email)
}

func TestGenerateAPIKeyTokenWithEmptyScopes(t *testing.T) {
	jwtService := NewJWTService("test-secret", "test-issuer")

	token, err := jwtService.GenerateAPIKeyToken(1, 1, nil)
	require.NoError(t, err)
	assert.NotEmpty(t, token)

	claims, err := jwtService.ValidateToken(token)
	require.NoError(t, err)
	assert.Nil(t, claims.Scopes)

	token2, err := jwtService.GenerateAPIKeyToken(1, 1, []string{})
	require.NoError(t, err)

	claims2, err := jwtService.ValidateToken(token2)
	require.NoError(t, err)
	assert.Empty(t, claims2.Scopes)
}