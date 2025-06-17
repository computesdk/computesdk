package css_test

import (
	"fmt"
	"testing"

	"github.com/heysnelling/computesdk/pkg/ui/css"
	"github.com/heysnelling/computesdk/pkg/ui/html"
)

func TestCSSIntegration(t *testing.T) {
	// Create an element with CSS classes
	button := html.New("button").
		Class(css.P(4), css.BgBlue(500), css.TextCenter()).
		SetContent("Click me")

	fmt.Printf("Button HTML: %+v\n", button)
	
	// Generate CSS
	stylesheet := css.GenerateUtilities()
	cssOutput := stylesheet.Generate()
	
	fmt.Println("Generated CSS snippet:")
	fmt.Println(cssOutput[:200] + "...")
}

func Example() {
	// Create a card component
	card := html.New("div").
		Class(css.P(6), css.BgGray(100), css.M(4)).
		AddChildren(
			html.New("h2").
				Class(css.TextXl(), css.TextGray(800)).
				SetContent("Card Title"),
			html.New("p").
				Class(css.TextGray(600)).
				SetContent("Card content goes here"),
		)

	fmt.Printf("Card: %+v\n", card)
}