package html

// Form creates a new form element
func Form(children ...*Element) *Element {
	elem := &Element{Tag: "form"}
	return elem.AddChildren(children...)
}

// Input creates a new input element (self-closing)
func Input(inputType string) *Element {
	elem := &Element{Tag: "input"}
	return elem.Attr("type", inputType)
}

// Button creates a new button element
func Button(content string) *Element {
	return &Element{Tag: "button", Content: content}
}

// Textarea creates a new textarea element
func Textarea(content string) *Element {
	return &Element{Tag: "textarea", Content: content}
}

// Select creates a new select element
func Select(children ...*Element) *Element {
	elem := &Element{Tag: "select"}
	return elem.AddChildren(children...)
}

// Option creates a new option element
func Option(content string) *Element {
	return &Element{Tag: "option", Content: content}
}

// Label creates a new label element
func Label(content string) *Element {
	return &Element{Tag: "label", Content: content}
}