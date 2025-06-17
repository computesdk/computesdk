package internal

import (
	"embed"
	"fmt"
	
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
		Families []struct {
			Name        string `yaml:"name"`
			CSSProperty string `yaml:"css_property"`
		} `yaml:"families"`
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

type SizingConfig struct {
	Sizing struct {
		Width struct {
			Scale []struct {
				Name  string `yaml:"name"`
				Value string `yaml:"value"`
			} `yaml:"scale"`
			Special []struct {
				Name  string `yaml:"name"`
				Value string `yaml:"value"`
			} `yaml:"special"`
			Fractions []struct {
				Name  string `yaml:"name"`
				Value string `yaml:"value"`
			} `yaml:"fractions"`
		} `yaml:"width"`
		Height struct {
			Scale []struct {
				Name  string `yaml:"name"`
				Value string `yaml:"value"`
			} `yaml:"scale"`
			Special []struct {
				Name  string `yaml:"name"`
				Value string `yaml:"value"`
			} `yaml:"special"`
			Fractions []struct {
				Name  string `yaml:"name"`
				Value string `yaml:"value"`
			} `yaml:"fractions"`
		} `yaml:"height"`
		MaxWidth struct {
			Values []struct {
				Name  string `yaml:"name"`
				Value string `yaml:"value"`
			} `yaml:"values"`
		} `yaml:"max_width"`
		MinWidth struct {
			Values []struct {
				Name  string `yaml:"name"`
				Value string `yaml:"value"`
			} `yaml:"values"`
		} `yaml:"min_width"`
		MaxHeight struct {
			Scale []struct {
				Name  string `yaml:"name"`
				Value string `yaml:"value"`
			} `yaml:"scale"`
			Special []struct {
				Name  string `yaml:"name"`
				Value string `yaml:"value"`
			} `yaml:"special"`
		} `yaml:"max_height"`
		MinHeight struct {
			Values []struct {
				Name  string `yaml:"name"`
				Value string `yaml:"value"`
			} `yaml:"values"`
		} `yaml:"min_height"`
	} `yaml:"sizing"`
}

type PositionConfig struct {
	Position struct {
		Types []struct {
			Name        string `yaml:"name"`
			CSSProperty string `yaml:"css_property"`
		} `yaml:"types"`
		Inset struct {
			Scale []struct {
				Name  string `yaml:"name"`
				Value string `yaml:"value"`
			} `yaml:"scale"`
			Special []struct {
				Name  string `yaml:"name"`
				Value string `yaml:"value"`
			} `yaml:"special"`
			NegativeScale []struct {
				Name  string `yaml:"name"`
				Value string `yaml:"value"`
			} `yaml:"negative_scale"`
			NegativeSpecial []struct {
				Name  string `yaml:"name"`
				Value string `yaml:"value"`
			} `yaml:"negative_special"`
		} `yaml:"inset"`
		ZIndex struct {
			Values []struct {
				Name  string `yaml:"name"`
				Value string `yaml:"value"`
			} `yaml:"values"`
			NegativeValues []struct {
				Name  string `yaml:"name"`
				Value string `yaml:"value"`
			} `yaml:"negative_values"`
		} `yaml:"z_index"`
		Overflow struct {
			Types []struct {
				Name        string `yaml:"name"`
				CSSProperty string `yaml:"css_property"`
			} `yaml:"types"`
		} `yaml:"overflow"`
	} `yaml:"position"`
}

type EffectsConfig struct {
	Effects struct {
		Opacity struct {
			Values []struct {
				Name  string `yaml:"name"`
				Value string `yaml:"value"`
			} `yaml:"values"`
		} `yaml:"opacity"`
		Shadow struct {
			Values []struct {
				Name  string `yaml:"name"`
				Value string `yaml:"value"`
			} `yaml:"values"`
		} `yaml:"shadow"`
		Cursor struct {
			Values []struct {
				Name        string `yaml:"name"`
				CSSProperty string `yaml:"css_property"`
			} `yaml:"values"`
		} `yaml:"cursor"`
		UserSelect struct {
			Values []struct {
				Name        string `yaml:"name"`
				CSSProperty string `yaml:"css_property"`
			} `yaml:"values"`
		} `yaml:"user_select"`
		PointerEvents struct {
			Values []struct {
				Name        string `yaml:"name"`
				CSSProperty string `yaml:"css_property"`
			} `yaml:"values"`
		} `yaml:"pointer_events"`
		Visibility struct {
			Values []struct {
				Name        string `yaml:"name"`
				CSSProperty string `yaml:"css_property"`
			} `yaml:"values"`
		} `yaml:"visibility"`
		ScreenReaders struct {
			Values []struct {
				Name        string `yaml:"name"`
				CSSProperty string `yaml:"css_property"`
			} `yaml:"values"`
		} `yaml:"screen_readers"`
	} `yaml:"effects"`
}

// LoadConfig loads and parses all configuration files
func LoadConfig() (*SpacingConfig, *ColorsConfig, *LayoutConfig, *TypographyConfig, *BordersConfig, *SizingConfig, *PositionConfig, *EffectsConfig, error) {
	var spacing SpacingConfig
	var colors ColorsConfig
	var layout LayoutConfig
	var typography TypographyConfig
	var borders BordersConfig
	var sizing SizingConfig
	var position PositionConfig
	var effects EffectsConfig

	configs := []struct {
		filename string
		target   any
	}{
		{"config/spacing.yaml", &spacing},
		{"config/colors.yaml", &colors},
		{"config/layout.yaml", &layout},
		{"config/typography.yaml", &typography},
		{"config/borders.yaml", &borders},
		{"config/sizing.yaml", &sizing},
		{"config/position.yaml", &position},
		{"config/effects.yaml", &effects},
	}

	for _, config := range configs {
		data, err := configFS.ReadFile(config.filename)
		if err != nil {
			return nil, nil, nil, nil, nil, nil, nil, nil, fmt.Errorf("failed to read %s: %w", config.filename, err)
		}

		if err := yaml.Unmarshal(data, config.target); err != nil {
			return nil, nil, nil, nil, nil, nil, nil, nil, fmt.Errorf("failed to parse %s: %w", config.filename, err)
		}
	}

	return &spacing, &colors, &layout, &typography, &borders, &sizing, &position, &effects, nil
}

