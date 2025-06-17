package internal_test

import (
	"strings"
	"testing"

	"github.com/heysnelling/computesdk/pkg/ui/css/internal"
	"github.com/stretchr/testify/assert"
)

func TestNewStylesheet(t *testing.T) {
	s := internal.NewStylesheet()
	assert.NotNil(t, s)
	assert.Empty(t, s.GenerateCSS())
}

func TestStylesheetAddRule(t *testing.T) {
	s := internal.NewStylesheet()
	
	s.AddRule(".test-class", "color: red")
	css := s.GenerateCSS()
	
	assert.Contains(t, css, ".test-class")
	assert.Contains(t, css, "color: red")
}

func TestStylesheetMultipleRules(t *testing.T) {
	s := internal.NewStylesheet()
	
	s.AddRule(".class-a", "color: blue")
	s.AddRule(".class-b", "background: white")
	s.AddRule(".class-c", "margin: 10px")
	
	css := s.GenerateCSS()
	
	// Check all rules are present
	assert.Contains(t, css, ".class-a { color: blue }")
	assert.Contains(t, css, ".class-b { background: white }")
	assert.Contains(t, css, ".class-c { margin: 10px }")
	
	// Verify output is sorted by selector
	lines := strings.Split(strings.TrimSpace(css), "\n")
	assert.Equal(t, 3, len(lines))
	assert.True(t, strings.HasPrefix(lines[0], ".class-a"))
	assert.True(t, strings.HasPrefix(lines[1], ".class-b"))
	assert.True(t, strings.HasPrefix(lines[2], ".class-c"))
}

func TestStylesheetOverwriteRule(t *testing.T) {
	s := internal.NewStylesheet()
	
	s.AddRule(".test", "color: red")
	s.AddRule(".test", "color: blue")
	
	css := s.GenerateCSS()
	
	// Should only have the latest rule
	assert.Contains(t, css, "color: blue")
	assert.NotContains(t, css, "color: red")
	
	// Should only appear once
	count := strings.Count(css, ".test")
	assert.Equal(t, 1, count)
}

func TestGenerateUtilities(t *testing.T) {
	s := internal.GenerateUtilities()
	assert.NotNil(t, s)
	
	css := s.GenerateCSS()
	assert.NotEmpty(t, css)
	
	// Check for basic utilities that should be present
	// either from config or fallback
	expectedPatterns := []string{
		".p-4",
		".m-4",
		".flex",
		".block",
		".hidden",
	}
	
	for _, pattern := range expectedPatterns {
		assert.Contains(t, css, pattern, "Expected CSS to contain %s", pattern)
	}
}

func TestStylesheetEmptyProperties(t *testing.T) {
	s := internal.NewStylesheet()
	
	s.AddRule(".empty", "")
	css := s.GenerateCSS()
	
	assert.Contains(t, css, ".empty {  }")
}

func TestStylesheetSpecialCharacters(t *testing.T) {
	s := internal.NewStylesheet()
	
	s.AddRule(".class\\:hover", "color: red")
	s.AddRule("#id-with-dash", "background: blue")
	s.AddRule("[data-attr]", "display: none")
	
	css := s.GenerateCSS()
	
	assert.Contains(t, css, ".class\\:hover")
	assert.Contains(t, css, "#id-with-dash")
	assert.Contains(t, css, "[data-attr]")
}