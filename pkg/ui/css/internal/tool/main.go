package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/heysnelling/computesdk/pkg/ui/css/internal"
)

func main() {
	fmt.Println("🚀 Generating CSS utilities from YAML configs...")

	code, err := internal.GenerateUtilitiesCode()
	if err != nil {
		fmt.Printf("❌ Error generating utilities: %v\n", err)
		os.Exit(1)
	}

	// Debug: print current working directory
	cwd, _ := os.Getwd()
	fmt.Printf("Current working directory: %s\n", cwd)

	// Write to the css package directory (up from tool/ to internal/, up to css/)
	outputPath := "../../utilities.go"
	absPath, _ := filepath.Abs(outputPath)
	fmt.Printf("Writing to: %s\n", absPath)

	err = os.WriteFile(outputPath, []byte(code), 0644)
	if err != nil {
		fmt.Printf("❌ Error writing utilities.go: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("✅ Generated utilities.go successfully!")
	fmt.Printf("📊 Generated %d lines of Go code from YAML configs\n", len(code))

	// Count utilities generated
	spacing, colors, _, _, _, _, _, _, _ := internal.LoadConfig()
	if spacing != nil && colors != nil {
		colorCount := len(colors.Colors)
		spacingCount := len(spacing.Spacing.Properties)
		fmt.Printf("🎨 %d color palettes, %d spacing utilities\n", colorCount, spacingCount)
	}
}
