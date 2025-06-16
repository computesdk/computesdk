package elements

func Ul(content string, attrs ...map[string]string) Element {
	return createListElement("ul", content, attrs...)
}

func Ol(content string, attrs ...map[string]string) Element {
	return createListElement("ol", content, attrs...)
}

func Li(content string, attrs ...map[string]string) Element {
	return createListElement("li", content, attrs...)
}

func Dl(content string, attrs ...map[string]string) Element {
	return createListElement("dl", content, attrs...)
}

func Dt(content string, attrs ...map[string]string) Element {
	return createListElement("dt", content, attrs...)
}

func Dd(content string, attrs ...map[string]string) Element {
	return createListElement("dd", content, attrs...)
}

func createListElement(tag, content string, attrs ...map[string]string) Element {
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