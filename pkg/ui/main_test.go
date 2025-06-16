package ui_test

import (
	"testing"

	"github.com/heysnelling/computesdk/pkg/ui"
	"github.com/heysnelling/computesdk/pkg/ui/elements"
)

func TestBasicRendering(t *testing.T) {
	// Test simple div
	div := elements.Div("Hello World")
	myUI := ui.NewUI(div)
	result := myUI.Render()
	expected := "<div>Hello World</div>"

	if result != expected {
		t.Errorf("Expected %s, got %s", expected, result)
	}
}

func TestWithAttributes(t *testing.T) {
	// Test div with attributes
	div := elements.Div("Styled content", map[string]string{
		"class": "container",
		"id":    "main",
	})
	myUI := ui.NewUI(div)
	result := myUI.Render()

	// Should contain both attributes (order may vary)
	if !contains(result, `class="container"`) || !contains(result, `id="main"`) {
		t.Errorf("Expected attributes not found in: %s", result)
	}
}

func TestSelfClosingTags(t *testing.T) {
	// Test self-closing img tag
	img := elements.Img("/path/to/image.jpg", map[string]string{"alt": "Test image"})
	myUI := ui.NewUI(img)
	result := myUI.Render()

	// Check that it's a self-closing img tag with the correct attributes
	if !contains(result, `<img`) || !contains(result, `/>`) {
		t.Errorf("Expected self-closing img tag, got: %s", result)
	}
	if !contains(result, `src="/path/to/image.jpg"`) || !contains(result, `alt="Test image"`) {
		t.Errorf("Expected attributes not found in: %s", result)
	}
}

func TestNestedElements(t *testing.T) {
	// Test nested structure
	header := elements.H1("Welcome")
	paragraph := elements.P("This is a test paragraph")

	div := elements.Div("")
	div.Children = []elements.Element{header, paragraph}

	myUI := ui.NewUI(div)
	result := myUI.Render()
	expected := "<div><h1>Welcome</h1><p>This is a test paragraph</p></div>"

	if result != expected {
		t.Errorf("Expected %s, got %s", expected, result)
	}
}

func TestCompleteDocument(t *testing.T) {
	// Test a complete HTML document structure
	title := elements.Title("Test Page")
	head := elements.Head("")
	head.Children = []elements.Element{title}

	h1 := elements.H1("Welcome to Test Page")
	p := elements.P("This is a test paragraph with some content.")

	body := elements.Body("")
	body.Children = []elements.Element{h1, p}

	html := elements.Html("")
	html.Children = []elements.Element{head, body}

	myUI := ui.NewUI(html)
	result := myUI.Render()

	expected := "<html><head><title>Test Page</title></head><body><h1>Welcome to Test Page</h1><p>This is a test paragraph with some content.</p></body></html>"

	if result != expected {
		t.Errorf("Expected %s, got %s", expected, result)
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
