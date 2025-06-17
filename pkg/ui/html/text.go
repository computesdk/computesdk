package html

// H1 creates a new h1 element with content
func H1(content string) *Element {
	return &Element{Tag: "h1", Content: content}
}

// H2 creates a new h2 element with content
func H2(content string) *Element {
	return &Element{Tag: "h2", Content: content}
}

// H3 creates a new h3 element with content
func H3(content string) *Element {
	return &Element{Tag: "h3", Content: content}
}

// H4 creates a new h4 element with content
func H4(content string) *Element {
	return &Element{Tag: "h4", Content: content}
}

// H5 creates a new h5 element with content
func H5(content string) *Element {
	return &Element{Tag: "h5", Content: content}
}

// H6 creates a new h6 element with content
func H6(content string) *Element {
	return &Element{Tag: "h6", Content: content}
}

// P creates a new p element with content
func P(content string) *Element {
	return &Element{Tag: "p", Content: content}
}

// Span creates a new span element with content
func Span(content string) *Element {
	return &Element{Tag: "span", Content: content}
}

// Text creates a text-only element (no tag)
func Text(content string) *Element {
	return &Element{Content: content}
}