package elements

func H1(content string, attrs ...map[string]string) Element {
	return createTextElement("h1", content, attrs...)
}

func H2(content string, attrs ...map[string]string) Element {
	return createTextElement("h2", content, attrs...)
}

func H3(content string, attrs ...map[string]string) Element {
	return createTextElement("h3", content, attrs...)
}

func H4(content string, attrs ...map[string]string) Element {
	return createTextElement("h4", content, attrs...)
}

func H5(content string, attrs ...map[string]string) Element {
	return createTextElement("h5", content, attrs...)
}

func H6(content string, attrs ...map[string]string) Element {
	return createTextElement("h6", content, attrs...)
}

func P(content string, attrs ...map[string]string) Element {
	return createTextElement("p", content, attrs...)
}

func Span(content string, attrs ...map[string]string) Element {
	return createTextElement("span", content, attrs...)
}

func createTextElement(tag, content string, attrs ...map[string]string) Element {
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
