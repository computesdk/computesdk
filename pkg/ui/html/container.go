package html

// Div creates a new div element
func Div(children ...*Element) *Element {
	elem := &Element{Tag: "div"}
	return elem.AddChildren(children...)
}

// Section creates a new section element
func Section(children ...*Element) *Element {
	elem := &Element{Tag: "section"}
	return elem.AddChildren(children...)
}

// Article creates a new article element
func Article(children ...*Element) *Element {
	elem := &Element{Tag: "article"}
	return elem.AddChildren(children...)
}

// Header creates a new header element
func Header(children ...*Element) *Element {
	elem := &Element{Tag: "header"}
	return elem.AddChildren(children...)
}

// Footer creates a new footer element
func Footer(children ...*Element) *Element {
	elem := &Element{Tag: "footer"}
	return elem.AddChildren(children...)
}

// Nav creates a new nav element
func Nav(children ...*Element) *Element {
	elem := &Element{Tag: "nav"}
	return elem.AddChildren(children...)
}

// Main creates a new main element
func Main(children ...*Element) *Element {
	elem := &Element{Tag: "main"}
	return elem.AddChildren(children...)
}