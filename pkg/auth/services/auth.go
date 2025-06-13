package services

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
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

func (s *AuthService) CreateClaimableSession(orgID uint, email string, metadata map[string]interface{}) (*auth.ClaimableSession, error) {
	sessionToken := s.generateSessionToken()
	
	metadataJSON := "{}"
	if metadata != nil {
		metadataJSON = fmt.Sprintf("%v", metadata)
	}

	session := &auth.ClaimableSession{
		SessionToken:   sessionToken,
		OrganizationID: orgID,
		Email:          email,
		Metadata:       metadataJSON,
		ExpiresAt:      time.Now().Add(24 * time.Hour),
	}

	if err := s.db.Create(session).Error; err != nil {
		return nil, err
	}

	return session, nil
}

func (s *AuthService) ValidateSessionToken(sessionToken string) (*auth.ClaimableSession, error) {
	var session auth.ClaimableSession
	if err := s.db.Preload("Resources").Where("session_token = ? AND expires_at > ?", sessionToken, time.Now()).First(&session).Error; err != nil {
		return nil, errors.New("invalid or expired session")
	}

	return &session, nil
}

func (s *AuthService) GetClaimableSession(sessionID uint) (*auth.ClaimableSession, error) {
	var session auth.ClaimableSession
	if err := s.db.Preload("Resources").Where("id = ? AND expires_at > ?", sessionID, time.Now()).First(&session).Error; err != nil {
		return nil, errors.New("session not found or expired")
	}

	return &session, nil
}

func (s *AuthService) AddResourceToSession(sessionID uint, resourceType, resourceID string, permissions []string) (*auth.ClaimableResource, error) {
	// Verify session exists and is not expired
	var session auth.ClaimableSession
	if err := s.db.Where("id = ? AND expires_at > ?", sessionID, time.Now()).First(&session).Error; err != nil {
		return nil, errors.New("session not found or expired")
	}

	permissionsJSON := "[]"
	if permissions != nil {
		if permBytes, err := json.Marshal(permissions); err == nil {
			permissionsJSON = string(permBytes)
		}
	}

	resource := &auth.ClaimableResource{
		SessionID:    sessionID,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		Permissions:  permissionsJSON,
	}

	if err := s.db.Create(resource).Error; err != nil {
		return nil, err
	}

	return resource, nil
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

// ClaimSession links a claimable session to a user account
func (s *AuthService) ClaimSession(sessionID uint, userID uint) error {
	now := time.Now()
	result := s.db.Model(&auth.ClaimableSession{}).
		Where("id = ? AND expires_at > ?", sessionID, time.Now()).
		Updates(map[string]interface{}{
			"user_id": userID,
			"claimed_at": &now,
		})
	
	if result.Error != nil {
		return result.Error
	}
	
	if result.RowsAffected == 0 {
		return errors.New("session not found or expired")
	}
	
	return nil
}

// ClaimAllSessionsByEmail links all sessions with a given email to a user
func (s *AuthService) ClaimAllSessionsByEmail(email string, userID uint) (int64, error) {
	now := time.Now()
	result := s.db.Model(&auth.ClaimableSession{}).
		Where("email = ? AND user_id IS NULL", email).
		Updates(map[string]interface{}{
			"user_id": userID,
			"claimed_at": &now,
		})
	
	if result.Error != nil {
		return 0, result.Error
	}
	
	return result.RowsAffected, nil
}