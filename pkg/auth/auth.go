package auth

import (
	"github.com/heysnelling/computesdk/pkg/auth/handlers"
	"github.com/heysnelling/computesdk/pkg/auth/middleware"
	"github.com/heysnelling/computesdk/pkg/models/auth"
	"github.com/heysnelling/computesdk/pkg/auth/services"
	"github.com/heysnelling/computesdk/pkg/database"
	"gorm.io/gorm"
)

type Config struct {
	JWTSecret string
	JWTIssuer string
}

type Auth struct {
	Service    *services.AuthService
	JWT        *services.JWTService
	Middleware *middleware.AuthMiddleware
	Handler    *handlers.AuthHandler
}

func NewAuth(db *gorm.DB, config Config) *Auth {
	jwtService := services.NewJWTService(config.JWTSecret, config.JWTIssuer)
	authService := services.NewAuthService(db, jwtService)
	authMiddleware := middleware.NewAuthMiddleware(authService, jwtService)
	authHandler := handlers.NewAuthHandler(authService)

	return &Auth{
		Service:    authService,
		JWT:        jwtService,
		Middleware: authMiddleware,
		Handler:    authHandler,
	}
}

func MigrateModels(db *gorm.DB) error {
	return db.AutoMigrate(
		&auth.User{},
		&auth.Organization{},
		&auth.OrganizationMember{},
		&auth.APIKey{},
		&auth.ClaimableSession{},
		&auth.ClaimableResource{},
	)
}

// init registers auth models for migration
func init() {
	database.RegisterMigrations(MigrateModels)
}