package css_test

import (
	"strings"
	"testing"

	"github.com/heysnelling/computesdk/pkg/ui/css"
	"github.com/stretchr/testify/assert"
)

func TestClassString(t *testing.T) {
	class := css.P(4)
	assert.Equal(t, "p-4", class.String())
}

func TestSpacingUtilities(t *testing.T) {
	tests := []struct {
		name     string
		fn       func(int) css.Class
		value    int
		expected string
	}{
		{"padding", css.P, 4, "p-4"},
		{"padding-x", css.Px, 2, "px-2"},
		{"padding-y", css.Py, 8, "py-8"},
		{"padding-top", css.Pt, 1, "pt-1"},
		{"padding-right", css.Pr, 3, "pr-3"},
		{"padding-bottom", css.Pb, 6, "pb-6"},
		{"padding-left", css.Pl, 0, "pl-0"},
		{"margin", css.M, 4, "m-4"},
		{"margin-x", css.Mx, 2, "mx-2"},
		{"margin-y", css.My, 8, "my-8"},
		{"margin-top", css.Mt, 1, "mt-1"},
		{"margin-right", css.Mr, 3, "mr-3"},
		{"margin-bottom", css.Mb, 6, "mb-6"},
		{"margin-left", css.Ml, 0, "ml-0"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.fn(tt.value)
			assert.Equal(t, tt.expected, string(result))
		})
	}
}

func TestColorUtilities(t *testing.T) {
	tests := []struct {
		name     string
		bgFn     func(int) css.Class
		textFn   func(int) css.Class
		shade    int
		bgExp    string
		textExp  string
	}{
		{"indigo", css.BgIndigo, css.TextIndigo, 500, "bg-indigo-500", "text-indigo-500"},
		{"purple", css.BgPurple, css.TextPurple, 700, "bg-purple-700", "text-purple-700"},
		{"rose", css.BgRose, css.TextRose, 300, "bg-rose-300", "text-rose-300"},
		{"amber", css.BgAmber, css.TextAmber, 400, "bg-amber-400", "text-amber-400"},
		{"green", css.BgGreen, css.TextGreen, 600, "bg-green-600", "text-green-600"},
		{"blue", css.BgBlue, css.TextBlue, 50, "bg-blue-50", "text-blue-50"},
		{"red", css.BgRed, css.TextRed, 900, "bg-red-900", "text-red-900"},
		{"gray", css.BgGray, css.TextGray, 500, "bg-gray-500", "text-gray-500"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			bgResult := tt.bgFn(tt.shade)
			assert.Equal(t, tt.bgExp, string(bgResult))

			textResult := tt.textFn(tt.shade)
			assert.Equal(t, tt.textExp, string(textResult))
		})
	}
}

func TestDisplayUtilities(t *testing.T) {
	tests := []struct {
		name     string
		fn       func() css.Class
		expected string
	}{
		{"block", css.Block, "block"},
		{"flex", css.Flex, "flex"},
		{"grid", css.Grid, "grid"},
		{"hidden", css.Hidden, "hidden"},
		{"inline", css.Inline, "inline"},
		{"inline-block", css.InlineBlock, "inline-block"},
		{"inline-flex", css.InlineFlex, "inline-flex"},
		{"inline-grid", css.InlineGrid, "inline-grid"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.fn()
			assert.Equal(t, tt.expected, string(result))
		})
	}
}

func TestFlexUtilities(t *testing.T) {
	tests := []struct {
		name     string
		fn       func() css.Class
		expected string
	}{
		{"justify-start", css.JustifyStart, "justify-start"},
		{"justify-center", css.JustifyCenter, "justify-center"},
		{"justify-end", css.JustifyEnd, "justify-end"},
		{"justify-between", css.JustifyBetween, "justify-between"},
		{"justify-around", css.JustifyAround, "justify-around"},
		{"justify-evenly", css.JustifyEvenly, "justify-evenly"},
		{"items-start", css.ItemsStart, "items-start"},
		{"items-center", css.ItemsCenter, "items-center"},
		{"items-end", css.ItemsEnd, "items-end"},
		{"items-stretch", css.ItemsStretch, "items-stretch"},
		{"items-baseline", css.ItemsBaseline, "items-baseline"},
		{"flex-row", css.FlexRow, "flex-row"},
		{"flex-col", css.FlexCol, "flex-col"},
		{"flex-row-reverse", css.FlexRowReverse, "flex-row-reverse"},
		{"flex-col-reverse", css.FlexColReverse, "flex-col-reverse"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.fn()
			assert.Equal(t, tt.expected, string(result))
		})
	}
}

func TestTypographyUtilities(t *testing.T) {
	tests := []struct {
		name     string
		fn       func() css.Class
		expected string
	}{
		{"text-xs", css.TextXs, "text-xs"},
		{"text-sm", css.TextSm, "text-sm"},
		{"text-base", css.TextBase, "text-base"},
		{"text-lg", css.TextLg, "text-lg"},
		{"text-xl", css.TextXl, "text-xl"},
		{"text-2xl", css.Text2XL, "text-2xl"},
		{"text-3xl", css.Text3XL, "text-3xl"},
		{"text-left", css.TextLeft, "text-left"},
		{"text-center", css.TextCenter, "text-center"},
		{"text-right", css.TextRight, "text-right"},
		{"text-justify", css.TextJustify, "text-justify"},
		{"font-thin", css.FontThin, "font-thin"},
		{"font-light", css.FontLight, "font-light"},
		{"font-normal", css.FontNormal, "font-normal"},
		{"font-medium", css.FontMedium, "font-medium"},
		{"font-semibold", css.FontSemibold, "font-semibold"},
		{"font-bold", css.FontBold, "font-bold"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.fn()
			assert.Equal(t, tt.expected, string(result))
		})
	}
}

func TestBorderUtilities(t *testing.T) {
	tests := []struct {
		name     string
		fn       func(int) css.Class
		value    int
		expected string
	}{
		{"border", css.Border, 2, "border-2"},
		{"border-t", css.BorderT, 1, "border-t-1"},
		{"border-r", css.BorderR, 4, "border-r-4"},
		{"border-b", css.BorderB, 0, "border-b-0"},
		{"border-l", css.BorderL, 8, "border-l-8"},
		{"rounded", css.Rounded, 4, "rounded-4"},
		{"rounded-t", css.RoundedT, 2, "rounded-t-2"},
		{"rounded-r", css.RoundedR, 6, "rounded-r-6"},
		{"rounded-b", css.RoundedB, 8, "rounded-b-8"},
		{"rounded-l", css.RoundedL, 1, "rounded-l-1"},
		{"rounded-tl", css.RoundedTl, 3, "rounded-tl-3"},
		{"rounded-tr", css.RoundedTr, 5, "rounded-tr-5"},
		{"rounded-br", css.RoundedBr, 7, "rounded-br-7"},
		{"rounded-bl", css.RoundedBl, 9, "rounded-bl-9"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.fn(tt.value)
			assert.Equal(t, tt.expected, string(result))
		})
	}

	t.Run("rounded-full", func(t *testing.T) {
		assert.Equal(t, "rounded-full", string(css.RoundedFull()))
	})

	t.Run("rounded-none", func(t *testing.T) {
		assert.Equal(t, "rounded-none", string(css.RoundedNone()))
	})
}

func TestGenerateUtilities(t *testing.T) {
	stylesheet := css.GenerateUtilities()
	assert.NotNil(t, stylesheet)

	cssContent := stylesheet.Generate()
	assert.NotEmpty(t, cssContent)

	// Check for some expected CSS rules
	expectedRules := []string{
		".p-4",
		".m-2",
		".flex",
		".block",
		".hidden",
	}

	for _, rule := range expectedRules {
		assert.True(t, strings.Contains(cssContent, rule), "Expected CSS to contain %s", rule)
	}
}

func TestMultipleClasses(t *testing.T) {
	// Test combining multiple classes
	classes := []css.Class{
		css.Flex(),
		css.ItemsCenter(),
		css.JustifyBetween(),
		css.P(4),
		css.BgBlue(500),
		css.TextBlue(100),
	}

	var classNames []string
	for _, c := range classes {
		classNames = append(classNames, c.String())
	}

	result := strings.Join(classNames, " ")
	expected := "flex items-center justify-between p-4 bg-blue-500 text-blue-100"
	assert.Equal(t, expected, result)
}

func TestClassTracking(t *testing.T) {
	// Reset tracking before test
	css.ResetTracking()
	
	// Initially should have no tracked classes
	assert.Empty(t, css.GetUsedClasses())
	
	// Use some classes
	css.P(4)
	css.BgRed(500)
	css.Flex()
	css.Rounded(8)
	
	// Should now have tracked classes
	usedClasses := css.GetUsedClasses()
	assert.Len(t, usedClasses, 4)
	
	// Check that all expected classes are tracked
	expectedClasses := map[string]bool{
		"p-4": true,
		"bg-red-500": true,
		"flex": true,
		"rounded-8": true,
	}
	
	for _, class := range usedClasses {
		assert.True(t, expectedClasses[class], "Unexpected class tracked: %s", class)
	}
}

func TestResetTracking(t *testing.T) {
	// Use some classes
	css.P(2)
	css.BgBlue(300)
	
	// Should have tracked classes
	assert.NotEmpty(t, css.GetUsedClasses())
	
	// Reset tracking
	css.ResetTracking()
	
	// Should now be empty
	assert.Empty(t, css.GetUsedClasses())
}

func TestGenerateMinimalCSS(t *testing.T) {
	// Reset tracking
	css.ResetTracking()
	
	// Use only a few specific classes
	css.P(4)
	css.BgGreen(100)
	css.TextGreen(800)
	css.Rounded(4)
	
	// Generate minimal CSS
	stylesheet := css.GenerateMinimalCSS()
	assert.NotNil(t, stylesheet)
	
	cssContent := stylesheet.Generate()
	assert.NotEmpty(t, cssContent)
	
	// Should contain CSS for the classes we used
	expectedRules := []string{
		".p-4",
		".bg-green-100",
		".text-green-800", 
		".rounded-4",
	}
	
	for _, rule := range expectedRules {
		assert.True(t, strings.Contains(cssContent, rule), "Expected minimal CSS to contain %s", rule)
	}
	
	// Should NOT contain CSS for classes we didn't use
	unexpectedRules := []string{
		".p-8",      // Different padding
		".bg-red-500", // Different color
		".rounded-full", // Different border radius
	}
	
	for _, rule := range unexpectedRules {
		assert.False(t, strings.Contains(cssContent, rule), "Expected minimal CSS NOT to contain %s", rule)
	}
}