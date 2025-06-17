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
	spacing, colors, layout, typography, borders, sizing, position, effects, err := LoadConfig()
	if err != nil {
		return nil, err
	}

	s := NewStylesheet()

	// Add base/reset styles for proper typography
	s.AddRule("*", "box-sizing: border-box")
	s.AddRule("body", "margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'; font-size: 1rem; line-height: 1.5; color: #111827")
	s.AddRule("h1, h2, h3, h4, h5, h6", "margin-top: 0; margin-bottom: 0.5rem; font-weight: 600")
	s.AddRule("h1", "font-size: 2.25rem; line-height: 2.5rem")
	s.AddRule("h2", "font-size: 1.875rem; line-height: 2.25rem")
	s.AddRule("h3", "font-size: 1.5rem; line-height: 2rem")
	s.AddRule("h4", "font-size: 1.25rem; line-height: 1.75rem")
	s.AddRule("h5", "font-size: 1.125rem; line-height: 1.75rem")
	s.AddRule("h6", "font-size: 1rem; line-height: 1.5rem")
	s.AddRule("p", "margin-top: 0; margin-bottom: 1rem")
	s.AddRule("ul, ol", "margin-top: 0; margin-bottom: 1rem; padding-left: 2rem")
	s.AddRule("li", "margin-bottom: 0.25rem")
	s.AddRule("a", "color: #2563eb; text-decoration: underline")
	s.AddRule("a:hover", "color: #1d4ed8")
	s.AddRule("strong, b", "font-weight: 600")
	s.AddRule("code", "font-family: ui-monospace, SFMono-Regular, 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 0.875em; background-color: #f3f4f6; padding: 0.125rem 0.25rem; border-radius: 0.25rem")
	s.AddRule("pre", "font-family: ui-monospace, SFMono-Regular, 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 0.875rem; line-height: 1.5rem; background-color: #f3f4f6; padding: 1rem; border-radius: 0.375rem; overflow-x: auto")
	s.AddRule("pre code", "background-color: transparent; padding: 0")

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
	for _, family := range typography.Typography.Families {
		s.AddRule(fmt.Sprintf(".%s", family.Name), family.CSSProperty)
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

	// Generate sizing utilities
	// Width
	for _, size := range sizing.Sizing.Width.Scale {
		s.AddRule(fmt.Sprintf(".w-%s", size.Name), fmt.Sprintf("width: %s", size.Value))
	}
	for _, size := range sizing.Sizing.Width.Special {
		s.AddRule(fmt.Sprintf(".w-%s", size.Name), fmt.Sprintf("width: %s", size.Value))
	}
	for _, size := range sizing.Sizing.Width.Fractions {
		s.AddRule(fmt.Sprintf(".w-%s", size.Name), fmt.Sprintf("width: %s", size.Value))
	}
	
	// Height
	for _, size := range sizing.Sizing.Height.Scale {
		s.AddRule(fmt.Sprintf(".h-%s", size.Name), fmt.Sprintf("height: %s", size.Value))
	}
	for _, size := range sizing.Sizing.Height.Special {
		s.AddRule(fmt.Sprintf(".h-%s", size.Name), fmt.Sprintf("height: %s", size.Value))
	}
	for _, size := range sizing.Sizing.Height.Fractions {
		s.AddRule(fmt.Sprintf(".h-%s", size.Name), fmt.Sprintf("height: %s", size.Value))
	}
	
	// Max width
	for _, size := range sizing.Sizing.MaxWidth.Values {
		s.AddRule(fmt.Sprintf(".max-w-%s", size.Name), fmt.Sprintf("max-width: %s", size.Value))
	}
	
	// Min width
	for _, size := range sizing.Sizing.MinWidth.Values {
		s.AddRule(fmt.Sprintf(".min-w-%s", size.Name), fmt.Sprintf("min-width: %s", size.Value))
	}
	
	// Max height
	for _, size := range sizing.Sizing.MaxHeight.Scale {
		s.AddRule(fmt.Sprintf(".max-h-%s", size.Name), fmt.Sprintf("max-height: %s", size.Value))
	}
	for _, size := range sizing.Sizing.MaxHeight.Special {
		s.AddRule(fmt.Sprintf(".max-h-%s", size.Name), fmt.Sprintf("max-height: %s", size.Value))
	}
	
	// Min height
	for _, size := range sizing.Sizing.MinHeight.Values {
		s.AddRule(fmt.Sprintf(".min-h-%s", size.Name), fmt.Sprintf("min-height: %s", size.Value))
	}

	// Generate position utilities
	for _, pos := range position.Position.Types {
		s.AddRule(fmt.Sprintf(".%s", pos.Name), pos.CSSProperty)
	}
	
	// Inset utilities (top, right, bottom, left)
	directions := []string{"top", "right", "bottom", "left"}
	for _, dir := range directions {
		// Regular scale
		for _, inset := range position.Position.Inset.Scale {
			s.AddRule(fmt.Sprintf(".%s-%s", dir, inset.Name), fmt.Sprintf("%s: %s", dir, inset.Value))
		}
		// Special values
		for _, inset := range position.Position.Inset.Special {
			s.AddRule(fmt.Sprintf(".%s-%s", dir, inset.Name), fmt.Sprintf("%s: %s", dir, inset.Value))
		}
		// Negative scale
		for _, inset := range position.Position.Inset.NegativeScale {
			s.AddRule(fmt.Sprintf(".-%s%s", dir, inset.Name), fmt.Sprintf("%s: %s", dir, inset.Value))
		}
		// Negative special
		for _, inset := range position.Position.Inset.NegativeSpecial {
			s.AddRule(fmt.Sprintf(".-%s%s", dir, inset.Name), fmt.Sprintf("%s: %s", dir, inset.Value))
		}
	}
	
	// Inset (all sides)
	for _, inset := range position.Position.Inset.Scale {
		s.AddRule(fmt.Sprintf(".inset-%s", inset.Name), fmt.Sprintf("inset: %s", inset.Value))
	}
	for _, inset := range position.Position.Inset.Special {
		s.AddRule(fmt.Sprintf(".inset-%s", inset.Name), fmt.Sprintf("inset: %s", inset.Value))
	}
	
	// Inset X and Y
	for _, inset := range position.Position.Inset.Scale {
		s.AddRule(fmt.Sprintf(".inset-x-%s", inset.Name), fmt.Sprintf("left: %s; right: %s", inset.Value, inset.Value))
		s.AddRule(fmt.Sprintf(".inset-y-%s", inset.Name), fmt.Sprintf("top: %s; bottom: %s", inset.Value, inset.Value))
	}
	for _, inset := range position.Position.Inset.Special {
		s.AddRule(fmt.Sprintf(".inset-x-%s", inset.Name), fmt.Sprintf("left: %s; right: %s", inset.Value, inset.Value))
		s.AddRule(fmt.Sprintf(".inset-y-%s", inset.Name), fmt.Sprintf("top: %s; bottom: %s", inset.Value, inset.Value))
	}
	
	// Z-index
	for _, z := range position.Position.ZIndex.Values {
		s.AddRule(fmt.Sprintf(".z-%s", z.Name), fmt.Sprintf("z-index: %s", z.Value))
	}
	for _, z := range position.Position.ZIndex.NegativeValues {
		s.AddRule(fmt.Sprintf(".-z%s", z.Name), fmt.Sprintf("z-index: %s", z.Value))
	}
	
	// Overflow
	for _, overflow := range position.Position.Overflow.Types {
		s.AddRule(fmt.Sprintf(".%s", overflow.Name), overflow.CSSProperty)
	}

	// Generate effects utilities
	// Opacity
	for _, opacity := range effects.Effects.Opacity.Values {
		s.AddRule(fmt.Sprintf(".opacity-%s", opacity.Name), fmt.Sprintf("opacity: %s", opacity.Value))
	}
	
	// Shadow
	for _, shadow := range effects.Effects.Shadow.Values {
		className := ".shadow"
		if shadow.Name != "" {
			className = fmt.Sprintf(".shadow-%s", shadow.Name)
		}
		s.AddRule(className, fmt.Sprintf("box-shadow: %s", shadow.Value))
	}
	
	// Cursor
	for _, cursor := range effects.Effects.Cursor.Values {
		s.AddRule(fmt.Sprintf(".%s", cursor.Name), cursor.CSSProperty)
	}
	
	// User select
	for _, userSelect := range effects.Effects.UserSelect.Values {
		s.AddRule(fmt.Sprintf(".%s", userSelect.Name), userSelect.CSSProperty)
	}
	
	// Pointer events
	for _, pointerEvents := range effects.Effects.PointerEvents.Values {
		s.AddRule(fmt.Sprintf(".%s", pointerEvents.Name), pointerEvents.CSSProperty)
	}
	
	// Visibility
	for _, visibility := range effects.Effects.Visibility.Values {
		s.AddRule(fmt.Sprintf(".%s", visibility.Name), visibility.CSSProperty)
	}
	
	// Screen readers
	for _, sr := range effects.Effects.ScreenReaders.Values {
		s.AddRule(fmt.Sprintf(".%s", sr.Name), sr.CSSProperty)
	}

	return s, nil
}

// GenerateMinimalCSS creates CSS rules only for the specified classes
func GenerateMinimalCSS(usedClasses []string) *Stylesheet {
	if len(usedClasses) == 0 {
		return NewStylesheet()
	}
	
	// Convert slice to map for faster lookup
	usedClassMap := make(map[string]bool)
	for _, class := range usedClasses {
		usedClassMap[class] = true
	}
	
	// Generate full stylesheet
	fullStylesheet, err := GenerateUtilitiesFromConfig()
	if err != nil {
		return generateBasicUtilities()
	}
	
	// Create minimal stylesheet with only used classes
	minimalStylesheet := NewStylesheet()
	
	// Always include base styles (non-class selectors)
	for selector, properties := range fullStylesheet.rules {
		if !strings.HasPrefix(selector, ".") {
			// This is a base style (element selector), always include it
			minimalStylesheet.AddRule(selector, properties)
		} else {
			// This is a class selector, only include if used
			className := strings.TrimPrefix(selector, ".")
			if usedClassMap[className] {
				minimalStylesheet.AddRule(selector, properties)
			}
		}
	}
	
	return minimalStylesheet
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