package css

//go:generate go run ./internal/generator

import (
	"fmt"
	"sort"
	"strings"
)

type Stylesheet struct {
	rules map[string]string
}

func NewStylesheet() *Stylesheet {
	return &Stylesheet{
		rules: make(map[string]string),
	}
}

func (s *Stylesheet) AddRule(selector, properties string) {
	s.rules[selector] = properties
}

func (s *Stylesheet) Generate() string {
	if len(s.rules) == 0 {
		return ""
	}

	var css strings.Builder
	
	// Sort selectors for consistent output
	selectors := make([]string, 0, len(s.rules))
	for selector := range s.rules {
		selectors = append(selectors, selector)
	}
	sort.Strings(selectors)

	for _, selector := range selectors {
		properties := s.rules[selector]
		css.WriteString(fmt.Sprintf("%s { %s }\n", selector, properties))
	}

	return css.String()
}

// GenerateUtilities creates CSS rules using the new config-driven approach
func GenerateUtilities() *Stylesheet {
	stylesheet, err := GenerateUtilitiesFromConfig()
	if err != nil {
		// Fallback to basic utilities if config loading fails
		return generateBasicUtilities()
	}
	return stylesheet
}

// generateBasicUtilities provides a fallback with basic utilities
func generateBasicUtilities() *Stylesheet {
	s := NewStylesheet()
	
	// Basic spacing utilities (0-16)
	for i := 0; i <= 16; i++ {
		rem := float64(i) * 0.25
		s.AddRule(fmt.Sprintf(".p-%d", i), fmt.Sprintf("padding: %.2frem", rem))
		s.AddRule(fmt.Sprintf(".m-%d", i), fmt.Sprintf("margin: %.2frem", rem))
	}

	// Basic layout utilities
	s.AddRule(".flex", "display: flex")
	s.AddRule(".block", "display: block")
	s.AddRule(".hidden", "display: none")
	
	return s
}