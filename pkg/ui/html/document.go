package html

// Html creates a new html element
func Html(children ...*Element) *Element {
	elem := &Element{Tag: "html"}
	return elem.AddChildren(children...)
}

// Head creates a new head element
func Head(children ...*Element) *Element {
	elem := &Element{Tag: "head"}
	return elem.AddChildren(children...)
}

// Body creates a new body element
func Body(children ...*Element) *Element {
	elem := &Element{Tag: "body"}
	return elem.AddChildren(children...)
}

// Title creates a new title element
func Title(content string) *Element {
	return &Element{Tag: "title", Content: content}
}

// Meta creates a new meta element (self-closing)
func Meta() *Element {
	return &Element{Tag: "meta"}
}

// Link creates a new link element (self-closing)
func Link() *Element {
	return &Element{Tag: "link"}
}

// Script creates a new script element
func Script(content string) *Element {
	return &Element{Tag: "script", Content: content}
}

// Style creates a new style element
func Style(content string) *Element {
	return &Element{Tag: "style", Content: content}
}