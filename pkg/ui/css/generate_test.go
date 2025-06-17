package css

import (
	"fmt"
	"os"
	"testing"
)

func TestGenerateUtilities(t *testing.T) {
	code, err := GenerateUtilitiesCode()
	if err != nil {
		t.Fatalf("Failed to generate utilities: %v", err)
	}
	
	// Write to utilities_generated.go for inspection
	err = os.WriteFile("utilities_generated.go", []byte(code), 0644)
	if err != nil {
		t.Fatalf("Failed to write generated file: %v", err)
	}
	
	fmt.Println("Generated utilities.go successfully!")
	fmt.Printf("Generated %d lines of code\n", len(code))
}

func TestGenerateAndReplace(t *testing.T) {
	code, err := GenerateUtilitiesCode()
	if err != nil {
		t.Fatalf("Failed to generate utilities: %v", err)
	}
	
	// Replace the existing utilities.go
	err = os.WriteFile("utilities.go", []byte(code), 0644)
	if err != nil {
		t.Fatalf("Failed to replace utilities.go: %v", err)
	}
	
	fmt.Println("Replaced utilities.go with generated version!")
}