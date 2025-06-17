package html

import (
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