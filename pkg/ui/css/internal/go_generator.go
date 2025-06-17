package internal

import (
	"fmt"
	"strings"
	"text/template"
)

// CodeGenerator generates Go utility functions from config
type CodeGenerator struct {
	functions []string
}

func NewCodeGenerator() *CodeGenerator {
	return &CodeGenerator{
		functions: make([]string, 0),
	}
}

// AddFunction adds a utility function to be generated
func (cg *CodeGenerator) AddFunction(funcCode string) {
	cg.functions = append(cg.functions, funcCode)
}

// GenerateSpacingFunctions creates functions from spacing config
func (cg *CodeGenerator) GenerateSpacingFunctions(spacing *SpacingConfig) {
	for _, prop := range spacing.Spacing.Properties {
		// Generate function like: func P(size int) Class { return Class(fmt.Sprintf("p-%d", size)) }
		funcName := strings.Title(prop.Prefix)
		if len(funcName) > 1 && funcName[1:2] != strings.ToUpper(funcName[1:2]) {
			// Handle cases like "px" -> "Px"
			funcName = strings.ToUpper(prop.Prefix[:1]) + prop.Prefix[1:]
		}
		
		funcCode := fmt.Sprintf(`// %s applies %s utility
func %s(size int) Class {
	className := fmt.Sprintf("%s-%%d", size)
	trackClass(className)
	return Class(className)
}`, prop.Name, prop.Name, funcName, prop.Prefix)
		
		cg.AddFunction(funcCode)
	}
}

// GenerateColorFunctions creates functions from colors config
func (cg *CodeGenerator) GenerateColorFunctions(colors *ColorsConfig) {
	for colorName := range colors.Colors {
		// Generate BgColorName and TextColorName functions
		bgFuncName := fmt.Sprintf("Bg%s", strings.Title(colorName))
		textFuncName := fmt.Sprintf("Text%s", strings.Title(colorName))
		
		bgFunc := fmt.Sprintf(`// %s applies bg-%s-shade utility
func %s(shade int) Class {
	className := fmt.Sprintf("bg-%s-%%d", shade)
	trackClass(className)
	return Class(className)
}`, bgFuncName, colorName, bgFuncName, colorName)

		textFunc := fmt.Sprintf(`// %s applies text-%s-shade utility  
func %s(shade int) Class {
	className := fmt.Sprintf("text-%s-%%d", shade)
	trackClass(className)
	return Class(className)
}`, textFuncName, colorName, textFuncName, colorName)

		cg.AddFunction(bgFunc)
		cg.AddFunction(textFunc)
	}
}

// GenerateLayoutFunctions creates functions from layout config
func (cg *CodeGenerator) GenerateLayoutFunctions(layout *LayoutConfig) {
	// Display utilities
	for _, display := range layout.Layout.Display {
		funcName := toCamelCase(display.Name)
		funcCode := fmt.Sprintf(`// %s applies %s utility
func %s() Class {
	trackClass("%s")
	return "%s"
}`, funcName, display.Name, funcName, display.Name, display.Name)
		cg.AddFunction(funcCode)
	}
	
	// Flexbox utilities
	for _, justify := range layout.Flexbox.Justify {
		funcName := toCamelCase(justify.Name)
		funcCode := fmt.Sprintf(`// %s applies %s utility
func %s() Class {
	trackClass("%s")
	return "%s"
}`, funcName, justify.Name, funcName, justify.Name, justify.Name)
		cg.AddFunction(funcCode)
	}
	
	for _, align := range layout.Flexbox.Align {
		funcName := toCamelCase(align.Name)
		funcCode := fmt.Sprintf(`// %s applies %s utility
func %s() Class {
	trackClass("%s")
	return "%s"
}`, funcName, align.Name, funcName, align.Name, align.Name)
		cg.AddFunction(funcCode)
	}
	
	for _, direction := range layout.Flexbox.Direction {
		funcName := toCamelCase(direction.Name)
		funcCode := fmt.Sprintf(`// %s applies %s utility
func %s() Class {
	trackClass("%s")
	return "%s"
}`, funcName, direction.Name, funcName, direction.Name, direction.Name)
		cg.AddFunction(funcCode)
	}
}

// GenerateTypographyFunctions creates functions from typography config
func (cg *CodeGenerator) GenerateTypographyFunctions(typography *TypographyConfig) {
	// Text size utilities
	for sizeName := range typography.Typography.Sizes {
		funcName := fmt.Sprintf("Text%s", strings.Title(sizeName))
		if sizeName == "2xl" || sizeName == "3xl" { // Handle special cases
			funcName = fmt.Sprintf("Text%s", strings.ToUpper(sizeName))
		}
		funcCode := fmt.Sprintf(`// %s applies text-%s utility
func %s() Class {
	return "text-%s"
}`, funcName, sizeName, funcName, sizeName)
		cg.AddFunction(funcCode)
	}
	
	// Text alignment utilities
	for _, align := range typography.Typography.Align {
		funcName := toCamelCase(align.Name)
		funcCode := fmt.Sprintf(`// %s applies %s utility
func %s() Class {
	return "%s"
}`, funcName, align.Name, funcName, align.Name)
		cg.AddFunction(funcCode)
	}
	
	// Font weight utilities
	for _, weight := range typography.Typography.Weight {
		funcName := toCamelCase(weight.Name)
		funcCode := fmt.Sprintf(`// %s applies %s utility
func %s() Class {
	return "%s"
}`, funcName, weight.Name, funcName, weight.Name)
		cg.AddFunction(funcCode)
	}
}

// GenerateBorderFunctions creates functions from borders config
func (cg *CodeGenerator) GenerateBorderFunctions(borders *BordersConfig) {
	// Border width utilities
	for _, prop := range borders.Borders.Width.Properties {
		funcName := toCamelCase(prop.Name)
		funcCode := fmt.Sprintf(`// %s applies %s utility
func %s(width int) Class {
	className := fmt.Sprintf("%s-%%d", width)
	trackClass(className)
	return Class(className)
}`, funcName, prop.Name, funcName, prop.Prefix)
		cg.AddFunction(funcCode)
	}
	
	// Border radius utilities
	for _, prop := range borders.Borders.Radius.Properties {
		funcName := toCamelCase(prop.Name)
		funcCode := fmt.Sprintf(`// %s applies %s utility
func %s(radius int) Class {
	className := fmt.Sprintf("%s-%%d", radius)
	trackClass(className)
	return Class(className)
}`, funcName, prop.Name, funcName, prop.Prefix)
		cg.AddFunction(funcCode)
	}
	
	// Special border radius utilities
	for _, special := range borders.Borders.Radius.Special {
		funcName := toCamelCase(special.Name)
		funcCode := fmt.Sprintf(`// %s applies %s utility
func %s() Class {
	trackClass("%s")
	return "%s"
}`, funcName, special.Name, funcName, special.Name, special.Name)
		cg.AddFunction(funcCode)
	}
}

// GenerateGoCode creates the complete utilities.go file content
func (cg *CodeGenerator) GenerateGoCode() string {
	tmpl := `// Code generated from YAML configs. DO NOT EDIT.
package css

import (
	"fmt"
	"sync"
	"github.com/heysnelling/computesdk/pkg/ui/css/internal"
)

type Class string

func (c Class) String() string {
	return string(c)
}

// Global class tracker
var (
	usedClasses = make(map[string]bool)
	classMutex  sync.RWMutex
)

// trackClass registers a class as being used
func trackClass(className string) {
	classMutex.Lock()
	defer classMutex.Unlock()
	usedClasses[className] = true
}

// GetUsedClasses returns a slice of all tracked classes
func GetUsedClasses() []string {
	classMutex.RLock()
	defer classMutex.RUnlock()
	
	classes := make([]string, 0, len(usedClasses))
	for class := range usedClasses {
		classes = append(classes, class)
	}
	return classes
}

// ResetTracking clears all tracked classes
func ResetTracking() {
	classMutex.Lock()
	defer classMutex.Unlock()
	usedClasses = make(map[string]bool)
}

// Stylesheet wraps the internal stylesheet type
type Stylesheet struct {
	internal interface{ GenerateCSS() string }
}

// Generate returns the CSS string
func (s *Stylesheet) Generate() string {
	if s.internal == nil {
		return ""
	}
	if gen, ok := s.internal.(interface{ GenerateCSS() string }); ok {
		return gen.GenerateCSS()
	}
	return ""
}

// GenerateUtilities creates CSS rules using the config-driven approach
func GenerateUtilities() *Stylesheet {
	return &Stylesheet{internal: internal.GenerateUtilities()}
}

// GenerateMinimalCSS generates CSS only for tracked classes
func GenerateMinimalCSS() *Stylesheet {
	return &Stylesheet{internal: internal.GenerateMinimalCSS(GetUsedClasses())}
}

{{range .Functions}}
{{.}}

{{end}}`

	t := template.Must(template.New("utilities").Parse(tmpl))
	var buf strings.Builder
	
	data := struct {
		Functions []string
	}{
		Functions: cg.functions,
	}
	
	t.Execute(&buf, data)
	return buf.String()
}

// Helper function to convert kebab-case to CamelCase
func toCamelCase(input string) string {
	parts := strings.Split(input, "-")
	result := ""
	for _, part := range parts {
		if part != "" {
			result += strings.Title(part)
		}
	}
	// Handle special cases for valid Go identifiers
	result = strings.ReplaceAll(result, "-", "")
	return result
}

// GenerateUtilitiesCode generates the complete utilities.go from all configs
func GenerateUtilitiesCode() (string, error) {
	spacing, colors, layout, typography, borders, err := LoadConfig()
	if err != nil {
		return "", err
	}
	
	cg := NewCodeGenerator()
	
	cg.GenerateSpacingFunctions(spacing)
	cg.GenerateColorFunctions(colors)
	cg.GenerateLayoutFunctions(layout)
	cg.GenerateTypographyFunctions(typography)
	cg.GenerateBorderFunctions(borders)
	
	return cg.GenerateGoCode(), nil
}