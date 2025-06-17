package internal

import (
	"embed"
	"fmt"
	"strings"
	
	"gopkg.in/yaml.v3"
)

//go:embed config/*.yaml
var configFS embed.FS

// Config structures for different utility types
type SpacingConfig struct {
	Spacing struct {
		Scale         []int `yaml:"scale"`
		RemMultiplier float64 `yaml:"rem_multiplier"`
		Properties    []struct {
			Name        string `yaml:"name"`
			Prefix      string `yaml:"prefix"`
			CSSProperty string `yaml:"css_property"`
		} `yaml:"properties"`
	} `yaml:"spacing"`
}

type ColorsConfig struct {
	Colors map[string]map[string]string `yaml:"colors"`
}

type LayoutConfig struct {
	Layout struct {
		Display []struct {
			Name        string `yaml:"name"`
			CSSProperty string `yaml:"css_property"`
		} `yaml:"display"`
	} `yaml:"layout"`
	Flexbox struct {
		Justify []struct {
			Name        string `yaml:"name"`
			CSSProperty string `yaml:"css_property"`
		} `yaml:"justify"`
		Align []struct {
			Name        string `yaml:"name"`
			CSSProperty string `yaml:"css_property"`
		} `yaml:"align"`
		Direction []struct {
			Name        string `yaml:"name"`
			CSSProperty string `yaml:"css_property"`
		} `yaml:"direction"`
		Wrap []struct {
			Name        string `yaml:"name"`
			CSSProperty string `yaml:"css_property"`
		} `yaml:"wrap"`
	} `yaml:"flexbox"`
	Grid struct {
		Cols struct {
			Scale       []int  `yaml:"scale"`
			CSSTemplate string `yaml:"css_template"`
		} `yaml:"cols"`
		Rows struct {
			Scale       []int  `yaml:"scale"`
			CSSTemplate string `yaml:"css_template"`
		} `yaml:"rows"`
		Gap struct {
			Scale         []int   `yaml:"scale"`
			RemMultiplier float64 `yaml:"rem_multiplier"`
			CSSTemplate   string  `yaml:"css_template"`
		} `yaml:"gap"`
	} `yaml:"grid"`
}

type TypographyConfig struct {
	Typography struct {
		Sizes map[string]struct {
			Size       string `yaml:"size"`
			LineHeight string `yaml:"line_height"`
		} `yaml:"sizes"`
		Align []struct {
			Name        string `yaml:"name"`
			CSSProperty string `yaml:"css_property"`
		} `yaml:"align"`
		Weight []struct {
			Name        string `yaml:"name"`
			CSSProperty string `yaml:"css_property"`
		} `yaml:"weight"`
		Decoration []struct {
			Name        string `yaml:"name"`
			CSSProperty string `yaml:"css_property"`
		} `yaml:"decoration"`
	} `yaml:"typography"`
}

type BordersConfig struct {
	Borders struct {
		Width struct {
			Scale      []int `yaml:"scale"`
			Properties []struct {
				Name        string `yaml:"name"`
				Prefix      string `yaml:"prefix"`
				CSSProperty string `yaml:"css_property"`
			} `yaml:"properties"`
		} `yaml:"width"`
		Radius struct {
			Scale         []int   `yaml:"scale"`
			RemMultiplier float64 `yaml:"rem_multiplier"`
			Properties    []struct {
				Name        string `yaml:"name"`
				Prefix      string `yaml:"prefix"`
				CSSProperty string `yaml:"css_property"`
			} `yaml:"properties"`
			Special []struct {
				Name        string `yaml:"name"`
				CSSProperty string `yaml:"css_property"`
			} `yaml:"special"`
		} `yaml:"radius"`
		Style []struct {
			Name        string `yaml:"name"`
			CSSProperty string `yaml:"css_property"`
		} `yaml:"style"`
	} `yaml:"borders"`
}

// LoadConfig loads and parses all configuration files
func LoadConfig() (*SpacingConfig, *ColorsConfig, *LayoutConfig, *TypographyConfig, *BordersConfig, error) {
	var spacing SpacingConfig
	var colors ColorsConfig
	var layout LayoutConfig
	var typography TypographyConfig
	var borders BordersConfig

	configs := []struct {
		filename string
		target   interface{}
	}{
		{"config/spacing.yaml", &spacing},
		{"config/colors.yaml", &colors},
		{"config/layout.yaml", &layout},
		{"config/typography.yaml", &typography},
		{"config/borders.yaml", &borders},
	}

	for _, config := range configs {
		data, err := configFS.ReadFile(config.filename)
		if err != nil {
			return nil, nil, nil, nil, nil, fmt.Errorf("failed to read %s: %w", config.filename, err)
		}

		if err := yaml.Unmarshal(data, config.target); err != nil {
			return nil, nil, nil, nil, nil, fmt.Errorf("failed to parse %s: %w", config.filename, err)
		}
	}

	return &spacing, &colors, &layout, &typography, &borders, nil
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