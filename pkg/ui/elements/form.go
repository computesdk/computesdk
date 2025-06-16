package elements

func Form(content string, attrs ...map[string]string) Element {
	return createFormElement("form", content, attrs...)
}

func Input(inputType string, attrs ...map[string]string) Element {
	attributes := make(map[string]string)
	if len(attrs) > 0 {
		attributes = attrs[0]
	}
	attributes["type"] = inputType
	return Element{
		Tag:        "input",
		Attributes: attributes,
	}
}

func Button(content string, attrs ...map[string]string) Element {
	return createFormElement("button", content, attrs...)
}

func Textarea(content string, attrs ...map[string]string) Element {
	return createFormElement("textarea", content, attrs...)
}

func Select(content string, attrs ...map[string]string) Element {
	return createFormElement("select", content, attrs...)
}

func Option(content string, attrs ...map[string]string) Element {
	return createFormElement("option", content, attrs...)
}

func Label(content string, attrs ...map[string]string) Element {
	return createFormElement("label", content, attrs...)
}

func createFormElement(tag, content string, attrs ...map[string]string) Element {
	attributes := make(map[string]string)
	if len(attrs) > 0 {
		attributes = attrs[0]
	}
	return Element{
		Tag:        tag,
		Content:    content,
		Attributes: attributes,
	}
}