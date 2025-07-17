package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"text/tabwriter"

	"github.com/heysnelling/computesdk/pkg/api/apikey"
	"github.com/heysnelling/computesdk/pkg/api/database"
)

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	command := os.Args[1]
	args := os.Args[2:]

	switch command {
	case "create":
		createKey(args)
	case "list":
		listKeys(args)
	case "get":
		getKey(args)
	case "revoke":
		revokeKey(args)
	case "help", "-h", "--help":
		printUsage()
	default:
		fmt.Printf("Unknown command: %s\n\n", command)
		printUsage()
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Println("keyctl - API Key Management Tool")
	fmt.Println()
	fmt.Println("USAGE:")
	fmt.Println("  keyctl <command> [options]")
	fmt.Println()
	fmt.Println("COMMANDS:")
	fmt.Println("  create    Create a new API key")
	fmt.Println("  list      List API keys")
	fmt.Println("  get       Get details of a specific API key")
	fmt.Println("  revoke    Revoke an API key")
	fmt.Println("  help      Show this help message")
	fmt.Println()
	fmt.Println("CREATE OPTIONS:")
	fmt.Println("  -name string        Name for the API key")
	fmt.Println("  -metadata string    JSON metadata for the key (default \"{}\")")
	fmt.Println("  -expires int        Expiration time in seconds (0 = never expires)")
	fmt.Println()
	fmt.Println("LIST OPTIONS:")
	fmt.Println("  -status string      Filter by status (active, revoked)")
	fmt.Println("  -limit int          Maximum number of keys to return (default 25)")
	fmt.Println("  -offset int         Number of keys to skip (default 0)")
	fmt.Println()
	fmt.Println("GET OPTIONS:")
	fmt.Println("  -id string          API key ID (required)")
	fmt.Println()
	fmt.Println("REVOKE OPTIONS:")
	fmt.Println("  -id string          API key ID to revoke (required)")
	fmt.Println("  -reason string      Reason for revocation (default \"Revoked via keyctl\")")
	fmt.Println()
	fmt.Println("EXAMPLES:")
	fmt.Println("  keyctl create -name \"My API Key\"")
	fmt.Println("  keyctl list -status active")
	fmt.Println("  keyctl get -id key_abc123")
	fmt.Println("  keyctl revoke -id key_abc123 -reason \"No longer needed\"")
}

func createKey(args []string) {
	fs := flag.NewFlagSet("create", flag.ExitOnError)
	name := fs.String("name", "", "Name for the API key")
	metadataStr := fs.String("metadata", "{}", "JSON metadata for the key")
	expiresIn := fs.Int64("expires", 0, "Expiration time in seconds (0 = never expires)")
	fs.Parse(args)

	if *name == "" {
		log.Fatal("Name is required. Use -name flag")
	}

	// Parse metadata JSON
	var metadata map[string]string
	if err := json.Unmarshal([]byte(*metadataStr), &metadata); err != nil {
		log.Fatalf("Invalid metadata JSON: %v", err)
	}

	// Connect to database
	service := getAPIKeyService()

	// Prepare request
	req := &apikey.CreateAPIKeyRequest{
		Name:        *name,
		Permissions: []string{"compute:create", "compute:manage"},
		Metadata:    metadata,
	}

	if *expiresIn > 0 {
		req.ExpiresIn = expiresIn
	}

	// Create API key
	summary, err := service.CreateAPIKey(context.Background(), req)
	if err != nil {
		log.Fatalf("Failed to create API key: %v", err)
	}

	// Output results
	fmt.Printf("✅ API Key created successfully!\n\n")
	fmt.Printf("ID:          %s\n", summary.ID)
	fmt.Printf("Name:        %s\n", summary.Name)
	fmt.Printf("Key:         %s\n", summary.FullKey) // Only shown once
	fmt.Printf("Prefix:      %s\n", summary.KeyPrefix)
	fmt.Printf("Status:      %s\n", summary.Status)
	fmt.Printf("Permissions: %v\n", summary.Permissions)
	if len(summary.Metadata) > 0 {
		fmt.Printf("Metadata:    %v\n", summary.Metadata)
	}
	fmt.Printf("Created:     %s\n", summary.CreatedAt.Format("2006-01-02 15:04:05 UTC"))

	fmt.Printf("\n🔑 Save this API key securely - it won't be shown again!\n")
}

func listKeys(args []string) {
	fs := flag.NewFlagSet("list", flag.ExitOnError)
	status := fs.String("status", "", "Filter by status (active, revoked)")
	limit := fs.Int("limit", 25, "Maximum number of keys to return")
	offset := fs.Int("offset", 0, "Number of keys to skip")
	fs.Parse(args)

	service := getAPIKeyService()

	// List API keys
	var statusPtr *string
	if *status != "" {
		statusPtr = status
	}

	keys, err := service.ListAPIKeys(context.Background(), statusPtr, *limit, *offset)
	if err != nil {
		log.Fatalf("Failed to list API keys: %v", err)
	}

	if len(keys) == 0 {
		fmt.Println("No API keys found.")
		return
	}

	fmt.Printf("Found %d API key(s):\n\n", len(keys))

	// Use tabwriter for nice formatting
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "NAME\tID\tPREFIX\tSTATUS\tCREATED\tLAST USED")
	fmt.Fprintln(w, "----\t--\t------\t------\t-------\t---------")

	for _, key := range keys {
		lastUsed := "Never"
		if key.LastUsedAt != nil {
			lastUsed = key.LastUsedAt.Format("2006-01-02 15:04")
		}
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\t%s\n",
			key.Name,
			key.ID,
			key.KeyPrefix,
			key.Status,
			key.CreatedAt.Format("2006-01-02 15:04"),
			lastUsed,
		)
	}
	w.Flush()
}

func getKey(args []string) {
	fs := flag.NewFlagSet("get", flag.ExitOnError)
	keyID := fs.String("id", "", "API key ID (required)")
	fs.Parse(args)

	if *keyID == "" {
		log.Fatal("API key ID is required. Use -id flag")
	}

	service := getAPIKeyService()

	key, err := service.GetAPIKey(context.Background(), *keyID)
	if err != nil {
		log.Fatalf("Failed to get API key %s: %v", *keyID, err)
	}

	fmt.Printf("API Key Details:\n\n")
	fmt.Printf("ID:          %s\n", key.ID)
	fmt.Printf("Name:        %s\n", key.Name)
	fmt.Printf("Prefix:      %s\n", key.KeyPrefix)
	fmt.Printf("Status:      %s\n", key.Status)
	fmt.Printf("Permissions: %v\n", key.Permissions)
	if len(key.Metadata) > 0 {
		fmt.Printf("Metadata:    %v\n", key.Metadata)
	}
	fmt.Printf("Created:     %s\n", key.CreatedAt.Format("2006-01-02 15:04:05 UTC"))
	if key.LastUsedAt != nil {
		fmt.Printf("Last Used:   %s\n", key.LastUsedAt.Format("2006-01-02 15:04:05 UTC"))
	}
	if key.RevokedAt != nil {
		fmt.Printf("Revoked:     %s\n", key.RevokedAt.Format("2006-01-02 15:04:05 UTC"))
	}
}

func revokeKey(args []string) {
	fs := flag.NewFlagSet("revoke", flag.ExitOnError)
	keyID := fs.String("id", "", "API key ID to revoke (required)")
	reason := fs.String("reason", "Revoked via keyctl", "Reason for revocation")
	fs.Parse(args)

	if *keyID == "" {
		log.Fatal("API key ID is required. Use -id flag")
	}

	service := getAPIKeyService()

	// Get key info before revoking
	key, err := service.GetAPIKey(context.Background(), *keyID)
	if err != nil {
		log.Fatalf("Failed to find API key %s: %v", *keyID, err)
	}

	if key.Status != "active" {
		log.Fatalf("API key %s is already %s", *keyID, key.Status)
	}

	// Revoke the API key
	req := &apikey.RevokeAPIKeyRequest{
		Reason: *reason,
	}

	revokedKey, err := service.RevokeAPIKey(context.Background(), *keyID, req)
	if err != nil {
		log.Fatalf("Failed to revoke API key: %v", err)
	}

	// Output results
	fmt.Printf("🚫 API Key revoked successfully!\n\n")
	fmt.Printf("ID:       %s\n", revokedKey.ID)
	fmt.Printf("Name:     %s\n", revokedKey.Name)
	fmt.Printf("Prefix:   %s\n", revokedKey.KeyPrefix)
	fmt.Printf("Status:   %s\n", revokedKey.Status)
	fmt.Printf("Reason:   %s\n", *reason)
	if revokedKey.RevokedAt != nil {
		fmt.Printf("Revoked:  %s\n", revokedKey.RevokedAt.Format("2006-01-02 15:04:05 UTC"))
	}

	fmt.Printf("\n⚠️  This API key can no longer be used for authentication.\n")
}

func getAPIKeyService() *apikey.APIKeyService {
	// Connect to database using environment config
	config := database.GetConfigFromEnv()
	db, err := database.Initialize(config)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	// Run migrations to ensure tables exist
	if err := database.RunMigrations(db); err != nil {
		log.Fatalf("Failed to run database migrations: %v", err)
	}

	return apikey.NewService(db)
}
