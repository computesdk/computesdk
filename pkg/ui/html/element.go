package html

import (
	"fmt"
	"slices"
	"strings"
	
	"github.com/heysnelling/computesdk/pkg/ui/css"
)

type Element struct {
	Tag        string
	Content    string
	Attributes map[string]string
	Children   []Element
}

// New creates a new element with the specified tag
func New(tag string) *Element {
	return &Element{Tag: tag}
}

// Class sets the class attribute and returns the element for chaining
func (e *Element) Class(classes ...css.Class) *Element {
	if e.Attributes == nil {
		e.Attributes = make(map[string]string)
	}
	
	classStrings := make([]string, len(classes))
	for i, class := range classes {
		classStrings[i] = class.String()
	}
	
	e.Attributes["class"] = strings.Join(classStrings, " ")
	return e
}

// ID sets the id attribute and returns the element for chaining
func (e *Element) ID(id string) *Element {
	if e.Attributes == nil {
		e.Attributes = make(map[string]string)
	}
	e.Attributes["id"] = id
	return e
}

// Attr sets a custom attribute and returns the element for chaining
func (e *Element) Attr(key, value string) *Element {
	if e.Attributes == nil {
		e.Attributes = make(map[string]string)
	}
	e.Attributes[key] = value
	return e
}

// AddChildren adds children to the element and returns the element for chaining
func (e *Element) AddChildren(children ...*Element) *Element {
	for _, child := range children {
		if child != nil {
			e.Children = append(e.Children, *child)
		}
	}
	return e
}

// SetContent sets the content and returns the element for chaining
func (e *Element) SetContent(content string) *Element {
	e.Content = content
	return e
}

// Render processes the element tree and returns the final HTML string
func (e *Element) Render() string {
	// Inject minimal CSS if a head element exists and CSS classes were used
	head := e.findHead()
	if head != nil {
		usedClasses := css.GetUsedClasses()
		if len(usedClasses) > 0 {
			stylesheet := css.GenerateMinimalCSS()
			head.Children = append(head.Children, *Style(stylesheet.Generate()))
		}
	}
	
	// Generate and return HTML string
	return e.toHTML()
}


// findHead recursively searches for the first head element in the document tree
func (e *Element) findHead() *Element {
	// Check if this element is a head
	if e.Tag == "head" {
		return e
	}
	
	// Recursively search children
	for i := range e.Children {
		if found := e.Children[i].findHead(); found != nil {
			return found
		}
	}
	
	return nil
}

// toHTML converts the element and its children to an HTML string
func (e *Element) toHTML() string {
	if e == nil {
		return ""
	}
	
	// Handle text-only elements (no tag)
	if e.Tag == "" {
		return e.Content
	}
	
	html := fmt.Sprintf("<%s", e.Tag)

	for key, value := range e.Attributes {
		html += fmt.Sprintf(` %s="%s"`, key, value)
	}

	if isSelfClosing(e.Tag) {
		html += " />"
		return html
	}

	html += ">"

	if e.Content != "" {
		html += e.Content
	}

	for _, child := range e.Children {
		html += child.toHTML()
	}

	html += fmt.Sprintf("</%s>", e.Tag)
	return html
}

// isSelfClosing checks if an HTML tag is self-closing
func isSelfClosing(tag string) bool {
	selfClosingTags := []string{
		"area", "base", "br", "col", "embed", "hr", "img", "input",
		"link", "meta", "param", "source", "track", "wbr",
	}
	
	return slices.Contains(selfClosingTags, strings.ToLower(tag))
}