package html_test

import (
	"testing"

	"github.com/heysnelling/computesdk/pkg/ui/css"
	"github.com/heysnelling/computesdk/pkg/ui/html"
)

func TestBasicRendering(t *testing.T) {
	// Reset CSS tracking for clean test
	css.ResetTracking()
	
	// Test simple div with content
	div := html.Div().SetContent("Hello World")
	result := div.Render()
	expected := "<div>Hello World</div>"

	if result != expected {
		t.Errorf("Expected %s, got %s", expected, result)
	}
}

func TestWithAttributes(t *testing.T) {
	// Reset CSS tracking for clean test
	css.ResetTracking()
	
	// Test div with attributes using fluent API
	div := html.Div().SetContent("Styled content").Class(css.P(4), css.BgBlue(100)).ID("main")
	result := div.Render()

	// Should contain both attributes (order may vary)
	if !contains(result, `class="p-4 bg-blue-100"`) || !contains(result, `id="main"`) {
		t.Errorf("Expected attributes not found in: %s", result)
	}
}

func TestSelfClosingTags(t *testing.T) {
	// Reset CSS tracking for clean test
	css.ResetTracking()
	
	// Test self-closing img tag
	img := html.Img("/path/to/image.jpg").Attr("alt", "Test image")
	result := img.Render()

	// Check that it's a self-closing img tag with the correct attributes
	if !contains(result, `<img`) || !contains(result, `/>`) {
		t.Errorf("Expected self-closing img tag, got: %s", result)
	}
	if !contains(result, `src="/path/to/image.jpg"`) || !contains(result, `alt="Test image"`) {
		t.Errorf("Expected attributes not found in: %s", result)
	}
}

func TestNestedElements(t *testing.T) {
	// Reset CSS tracking for clean test
	css.ResetTracking()
	
	// Test nested structure using fluent API
	div := html.Div(
		html.H1("Welcome"),
		html.P("This is a test paragraph"),
	)

	result := div.Render()
	expected := "<div><h1>Welcome</h1><p>This is a test paragraph</p></div>"

	if result != expected {
		t.Errorf("Expected %s, got %s", expected, result)
	}
}

func TestCompleteDocument(t *testing.T) {
	// Reset CSS tracking for clean test
	css.ResetTracking()
	
	// Test a complete HTML document structure using fluent API
	document := html.Html(
		html.Head(
			html.Title("Test Page"),
		),
		html.Body(
			html.H1("Welcome to Test Page"),
			html.P("This is a test paragraph with some content."),
		),
	)

	result := document.Render()

	expected := "<html><head><title>Test Page</title></head><body><h1>Welcome to Test Page</h1><p>This is a test paragraph with some content.</p></body></html>"

	if result != expected {
		t.Errorf("Expected %s, got %s", expected, result)
	}
}

func TestMethodChaining(t *testing.T) {
	// Reset CSS tracking for clean test
	css.ResetTracking()
	
	// Test method chaining
	div := html.Div().
		Class("container").
		ID("main").
		Attr("data-test", "value").
		AddChildren(
			html.H1("Title").Class("header"),
			html.P("Content").ID("content"),
		)

	result := div.Render()

	// Check all attributes are present
	if !contains(result, `class="container"`) {
		t.Errorf("Expected class attribute not found in: %s", result)
	}
	if !contains(result, `id="main"`) {
		t.Errorf("Expected id attribute not found in: %s", result)
	}
	if !contains(result, `data-test="value"`) {
		t.Errorf("Expected data-test attribute not found in: %s", result)
	}
	if !contains(result, `<h1 class="header">Title</h1>`) {
		t.Errorf("Expected h1 with class not found in: %s", result)
	}
	if !contains(result, `<p id="content">Content</p>`) {
		t.Errorf("Expected p with id not found in: %s", result)
	}
}

func TestCSSIntegration(t *testing.T) {
	// Reset CSS tracking for clean test
	css.ResetTracking()
	
	// Test CSS utility integration
	div := html.Div().
		SetContent("Styled with CSS utilities").
		Class(css.P(4), css.M(2), css.BgGray(100), css.TextGray(800), css.Rounded(8))
	
	result := div.Render()
	
	expected := `class="p-4 m-2 bg-gray-100 text-gray-800 rounded-8"`
	if !contains(result, expected) {
		t.Errorf("Expected CSS classes not found. Got: %s", result)
	}
}

func TestRenderWithCSSInjection(t *testing.T) {
	// Reset CSS tracking
	css.ResetTracking()
	
	// Create a document with CSS classes
	document := html.Html(
		html.Head(
			html.Title("CSS Test"),
		),
		html.Body(
			html.Div().SetContent("Test content").Class(css.P(4), css.BgRed(100)),
		),
	)
	
	result := document.Render()
	
	// Should contain CSS styles in head
	if !contains(result, "<style>") {
		t.Errorf("Expected CSS styles to be injected, got: %s", result)
	}
	if !contains(result, ".p-4") {
		t.Errorf("Expected .p-4 CSS rule, got: %s", result)
	}
	if !contains(result, ".bg-red-100") {
		t.Errorf("Expected .bg-red-100 CSS rule, got: %s", result)
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > len(substr) &&
		(s[:len(substr)] == substr || s[len(s)-len(substr):] == substr ||
			containsAt(s, substr, 1)))
}

func containsAt(s, substr string, start int) bool {
	if start >= len(s) {
		return false
	}
	if start+len(substr) <= len(s) && s[start:start+len(substr)] == substr {
		return true
	}
	return containsAt(s, substr, start+1)
}