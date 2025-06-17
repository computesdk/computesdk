package html

// Table creates a new table element
func Table(children ...*Element) *Element {
	elem := &Element{Tag: "table"}
	return elem.AddChildren(children...)
}

// Thead creates a new thead element
func Thead(children ...*Element) *Element {
	elem := &Element{Tag: "thead"}
	return elem.AddChildren(children...)
}

// Tbody creates a new tbody element
func Tbody(children ...*Element) *Element {
	elem := &Element{Tag: "tbody"}
	return elem.AddChildren(children...)
}

// Tfoot creates a new tfoot element
func Tfoot(children ...*Element) *Element {
	elem := &Element{Tag: "tfoot"}
	return elem.AddChildren(children...)
}

// Tr creates a new tr element
func Tr(children ...*Element) *Element {
	elem := &Element{Tag: "tr"}
	return elem.AddChildren(children...)
}

// Th creates a new th element
func Th(content string) *Element {
	return &Element{Tag: "th", Content: content}
}

// Td creates a new td element
func Td(content string) *Element {
	return &Element{Tag: "td", Content: content}
}

// Caption creates a new caption element
func Caption(content string) *Element {
	return &Element{Tag: "caption", Content: content}
}