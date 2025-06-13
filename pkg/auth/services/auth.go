package services

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/heysnelling/computesdk/pkg/models/auth"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type AuthService struct {
	db         *gorm.DB
	jwtService *JWTService
}

func NewAuthService(db *gorm.DB, jwtService *JWTService) *AuthService {
	return &AuthService{
		db:         db,
		jwtService: jwtService,
	}
}

func (s *AuthService) RegisterUser(email, password, firstName, lastName string) (*auth.User, error) {
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	user := &auth.User{
		Email:        email,
		PasswordHash: string(hashedPassword),
		FirstName:    firstName,
		LastName:     lastName,
		IsActive:     true,
	}

	if err := s.db.Create(user).Error; err != nil {
		return nil, err
	}

	return user, nil
}

func (s *AuthService) AuthenticateUser(email, password string) (*auth.User, string, string, error) {
	var user auth.User
	if err := s.db.Where("email = ? AND is_active = ?", email, true).First(&user).Error; err != nil {
		return nil, "", "", errors.New("invalid credentials")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return nil, "", "", errors.New("invalid credentials")
	}

	var orgID uint
	var orgMember auth.OrganizationMember
	if err := s.db.Where("user_id = ?", user.ID).First(&orgMember).Error; err == nil {
		orgID = orgMember.OrganizationID
	}

	accessToken, refreshToken, err := s.jwtService.GenerateUserTokens(user.ID, user.Email, orgID)
	if err != nil {
		return nil, "", "", err
	}

	return &user, accessToken, refreshToken, nil
}

func (s *AuthService) CreateAPIKey(orgID uint, name string, scopes []string) (*auth.APIKey, string, error) {
	rawKey := s.generateAPIKey()
	keyHash := s.hashAPIKey(rawKey)
	keyPrefix := rawKey[:8]

	apiKey := &auth.APIKey{
		Name:           name,
		KeyHash:        keyHash,
		KeyPrefix:      keyPrefix,
		OrganizationID: orgID,
		Scopes:         strings.Join(scopes, ","),
	}

	if err := s.db.Create(apiKey).Error; err != nil {
		return nil, "", err
	}

	return apiKey, rawKey, nil
}

func (s *AuthService) ValidateAPIKey(rawKey string) (*auth.APIKey, error) {
	keyHash := s.hashAPIKey(rawKey)
	
	var apiKey auth.APIKey
	if err := s.db.Where("key_hash = ?", keyHash).First(&apiKey).Error; err != nil {
		return nil, errors.New("invalid API key")
	}

	if apiKey.ExpiresAt != nil && apiKey.ExpiresAt.Before(time.Now()) {
		return nil, errors.New("API key expired")
	}

	now := time.Now()
	s.db.Model(&apiKey).Update("last_used_at", &now)

	return &apiKey, nil
}

func (s *AuthService) CreateEndUserSession(orgID uint, computeID string, metadata map[string]interface{}) (*auth.EndUserSession, string, error) {
	sessionToken := s.generateSessionToken()
	
	metadataJSON := "{}"
	if metadata != nil {
		metadataJSON = fmt.Sprintf("%v", metadata)
	}

	session := &auth.EndUserSession{
		SessionToken:   sessionToken,
		OrganizationID: orgID,
		ComputeID:      computeID,
		Metadata:       metadataJSON,
		ExpiresAt:      time.Now().Add(24 * time.Hour),
	}

	if err := s.db.Create(session).Error; err != nil {
		return nil, "", err
	}

	token, err := s.jwtService.GenerateEndUserToken(session.ID, orgID, computeID)
	if err != nil {
		return nil, "", err
	}

	return session, token, nil
}

func (s *AuthService) ValidateEndUserSession(sessionToken string) (*auth.EndUserSession, error) {
	var session auth.EndUserSession
	if err := s.db.Where("session_token = ? AND expires_at > ?", sessionToken, time.Now()).First(&session).Error; err != nil {
		return nil, errors.New("invalid or expired session")
	}

	return &session, nil
}

func (s *AuthService) generateAPIKey() string {
	b := make([]byte, 32)
	rand.Read(b)
	return "sk_" + hex.EncodeToString(b)
}

func (s *AuthService) hashAPIKey(key string) string {
	hash := sha256.Sum256([]byte(key))
	return hex.EncodeToString(hash[:])
}

func (s *AuthService) generateSessionToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// GetUserByID retrieves a user by their ID
func (s *AuthService) GetUserByID(userID uint) (*auth.User, error) {
	var user auth.User
	if err := s.db.Preload("Organizations.Organization").First(&user, userID).Error; err != nil {
		return nil, err
	}
	return &user, nil
}