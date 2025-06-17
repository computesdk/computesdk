package html

// Ul creates a new ul element
func Ul(children ...*Element) *Element {
	elem := &Element{Tag: "ul"}
	return elem.AddChildren(children...)
}

// Ol creates a new ol element
func Ol(children ...*Element) *Element {
	elem := &Element{Tag: "ol"}
	return elem.AddChildren(children...)
}

// Li creates a new li element
func Li(content string) *Element {
	return &Element{Tag: "li", Content: content}
}

// Dl creates a new dl element
func Dl(children ...*Element) *Element {
	elem := &Element{Tag: "dl"}
	return elem.AddChildren(children...)
}

// Dt creates a new dt element
func Dt(content string) *Element {
	return &Element{Tag: "dt", Content: content}
}

// Dd creates a new dd element
func Dd(content string) *Element {
	return &Element{Tag: "dd", Content: content}
}