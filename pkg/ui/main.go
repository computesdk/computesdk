package ui

import (
	"fmt"
	"slices"
	"strings"
	
	"github.com/heysnelling/computesdk/pkg/ui/elements"
)

type UI struct {
	Root elements.Element
}

func NewUI(root elements.Element) *UI {
	return &UI{Root: root}
}

func (ui *UI) Render() string {
	return renderElement(ui.Root)
}

func renderElement(el elements.Element) string {
	html := fmt.Sprintf("<%s", el.Tag)

	for key, value := range el.Attributes {
		html += fmt.Sprintf(` %s="%s"`, key, value)
	}

	if isSelfClosing(el.Tag) {
		html += " />"
		return html
	}

	html += ">"

	if el.Content != "" {
		html += el.Content
	}

	for _, child := range el.Children {
		html += renderElement(child)
	}

	html += fmt.Sprintf("</%s>", el.Tag)
	return html
}

func isSelfClosing(tag string) bool {
	selfClosingTags := []string{
		"area", "base", "br", "col", "embed", "hr", "img", "input",
		"link", "meta", "param", "source", "track", "wbr",
	}
	
	return slices.Contains(selfClosingTags, strings.ToLower(tag))
}
