// Package auth here
package auth

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type JWTService struct {
	secret []byte
}

func NewJWTService(secret string) *JWTService {
	return &JWTService{secret: []byte(secret)}
}

type SessionClaims struct {
	SessionID   string   `json:"session_id"`
	Permissions []string `json:"permissions"`
	jwt.RegisteredClaims
}

func (js *JWTService) GenerateSessionToken(sessionID string, ttl time.Duration) (string, error) {
	now := time.Now()
	claims := SessionClaims{
		SessionID:   sessionID,
		Permissions: []string{"session:manage", "compute:create", "compute:manage"},
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "compute-sdk",
			Subject:   sessionID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
			NotBefore: jwt.NewNumericDate(now),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(js.secret)
}

func (js *JWTService) ValidateToken(tokenString string) (*SessionClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &SessionClaims{}, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return js.secret, nil
	})
	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(*SessionClaims); ok && token.Valid {
		return claims, nil
	}

	return nil, fmt.Errorf("invalid token")
}
