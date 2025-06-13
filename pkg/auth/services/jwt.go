package services

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type JWTClaims struct {
	UserID         uint     `json:"user_id,omitempty"`
	OrganizationID uint     `json:"org_id,omitempty"`
	APIKeyID       uint     `json:"api_key_id,omitempty"`
	Email          string   `json:"email,omitempty"`
	AuthType       string   `json:"auth_type"`
	Scopes         []string `json:"scopes,omitempty"`
	jwt.RegisteredClaims
}

type JWTService struct {
	secretKey       []byte
	issuer          string
	accessTokenTTL  time.Duration
	refreshTokenTTL time.Duration
}

func NewJWTService(secretKey string, issuer string) *JWTService {
	return &JWTService{
		secretKey:       []byte(secretKey),
		issuer:          issuer,
		accessTokenTTL:  15 * time.Minute,
		refreshTokenTTL: 7 * 24 * time.Hour,
	}
}

func (s *JWTService) GenerateUserTokens(userID uint, email string, orgID uint) (accessToken, refreshToken string, err error) {
	accessClaims := JWTClaims{
		UserID:         userID,
		Email:          email,
		OrganizationID: orgID,
		AuthType:       "user",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(s.accessTokenTTL)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    s.issuer,
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, accessClaims)
	accessToken, err = token.SignedString(s.secretKey)
	if err != nil {
		return "", "", err
	}

	refreshClaims := JWTClaims{
		UserID:   userID,
		AuthType: "refresh",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(s.refreshTokenTTL)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    s.issuer,
		},
	}

	token = jwt.NewWithClaims(jwt.SigningMethodHS256, refreshClaims)
	refreshToken, err = token.SignedString(s.secretKey)
	
	return accessToken, refreshToken, err
}

func (s *JWTService) GenerateAPIKeyToken(apiKeyID uint, orgID uint, scopes []string) (string, error) {
	claims := JWTClaims{
		APIKeyID:       apiKeyID,
		OrganizationID: orgID,
		AuthType:       "api_key",
		Scopes:         scopes,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt: jwt.NewNumericDate(time.Now()),
			Issuer:   s.issuer,
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(s.secretKey)
}


func (s *JWTService) ValidateToken(tokenString string) (*JWTClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &JWTClaims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return s.secretKey, nil
	})

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(*JWTClaims); ok && token.Valid {
		return claims, nil
	}

	return nil, errors.New("invalid token")
}