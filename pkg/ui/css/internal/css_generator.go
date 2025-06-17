package internal

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

func (s *Stylesheet) GenerateCSS() string {
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

// GenerateUtilitiesFromConfig creates CSS rules from config files
func GenerateUtilitiesFromConfig() (*Stylesheet, error) {
	spacing, colors, layout, typography, borders, err := LoadConfig()
	if err != nil {
		return nil, err
	}

	s := NewStylesheet()

	// Generate spacing utilities
	for _, prop := range spacing.Spacing.Properties {
		for _, size := range spacing.Spacing.Scale {
			value := float64(size) * spacing.Spacing.RemMultiplier
			className := fmt.Sprintf(".%s-%d", prop.Prefix, size)
			
			cssValue := strings.ReplaceAll(prop.CSSProperty, "{value}", fmt.Sprintf("%.2frem", value))
			s.AddRule(className, cssValue)
		}
	}

	// Generate color utilities
	for colorName, shades := range colors.Colors {
		for shade, hex := range shades {
			bgClass := fmt.Sprintf(".bg-%s-%s", colorName, shade)
			textClass := fmt.Sprintf(".text-%s-%s", colorName, shade)
			
			s.AddRule(bgClass, fmt.Sprintf("background-color: %s", hex))
			s.AddRule(textClass, fmt.Sprintf("color: %s", hex))
		}
	}

	// Generate layout utilities
	for _, display := range layout.Layout.Display {
		s.AddRule(fmt.Sprintf(".%s", display.Name), display.CSSProperty)
	}

	// Generate flexbox utilities
	for _, justify := range layout.Flexbox.Justify {
		s.AddRule(fmt.Sprintf(".%s", justify.Name), justify.CSSProperty)
	}
	for _, align := range layout.Flexbox.Align {
		s.AddRule(fmt.Sprintf(".%s", align.Name), align.CSSProperty)
	}
	for _, direction := range layout.Flexbox.Direction {
		s.AddRule(fmt.Sprintf(".%s", direction.Name), direction.CSSProperty)
	}
	for _, wrap := range layout.Flexbox.Wrap {
		s.AddRule(fmt.Sprintf(".%s", wrap.Name), wrap.CSSProperty)
	}

	// Generate grid utilities
	for _, cols := range layout.Grid.Cols.Scale {
		className := fmt.Sprintf(".grid-cols-%d", cols)
		cssValue := strings.ReplaceAll(layout.Grid.Cols.CSSTemplate, "{value}", fmt.Sprintf("%d", cols))
		s.AddRule(className, cssValue)
	}
	for _, rows := range layout.Grid.Rows.Scale {
		className := fmt.Sprintf(".grid-rows-%d", rows)
		cssValue := strings.ReplaceAll(layout.Grid.Rows.CSSTemplate, "{value}", fmt.Sprintf("%d", rows))
		s.AddRule(className, cssValue)
	}
	for _, gap := range layout.Grid.Gap.Scale {
		value := float64(gap) * layout.Grid.Gap.RemMultiplier
		className := fmt.Sprintf(".gap-%d", gap)
		cssValue := strings.ReplaceAll(layout.Grid.Gap.CSSTemplate, "{value}", fmt.Sprintf("%.2f", value))
		s.AddRule(className, cssValue)
	}

	// Generate typography utilities
	for sizeName, sizeConfig := range typography.Typography.Sizes {
		className := fmt.Sprintf(".text-%s", sizeName)
		cssValue := fmt.Sprintf("font-size: %s; line-height: %s", sizeConfig.Size, sizeConfig.LineHeight)
		s.AddRule(className, cssValue)
	}
	for _, align := range typography.Typography.Align {
		s.AddRule(fmt.Sprintf(".%s", align.Name), align.CSSProperty)
	}
	for _, weight := range typography.Typography.Weight {
		s.AddRule(fmt.Sprintf(".%s", weight.Name), weight.CSSProperty)
	}
	for _, decoration := range typography.Typography.Decoration {
		s.AddRule(fmt.Sprintf(".%s", decoration.Name), decoration.CSSProperty)
	}

	// Generate border utilities
	for _, prop := range borders.Borders.Width.Properties {
		for _, width := range borders.Borders.Width.Scale {
			className := fmt.Sprintf(".%s-%d", prop.Prefix, width)
			cssValue := strings.ReplaceAll(prop.CSSProperty, "{value}", fmt.Sprintf("%d", width))
			s.AddRule(className, cssValue)
		}
	}
	for _, prop := range borders.Borders.Radius.Properties {
		for _, radius := range borders.Borders.Radius.Scale {
			value := float64(radius) * borders.Borders.Radius.RemMultiplier
			className := fmt.Sprintf(".%s-%d", prop.Prefix, radius)
			cssValue := strings.ReplaceAll(prop.CSSProperty, "{value}", fmt.Sprintf("%.2f", value))
			s.AddRule(className, cssValue)
		}
	}
	for _, special := range borders.Borders.Radius.Special {
		s.AddRule(fmt.Sprintf(".%s", special.Name), special.CSSProperty)
	}
	for _, style := range borders.Borders.Style {
		s.AddRule(fmt.Sprintf(".%s", style.Name), style.CSSProperty)
	}

	return s, nil
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