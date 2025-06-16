package elements

func Html(content string, attrs ...map[string]string) Element {
	return createDocumentElement("html", content, attrs...)
}

func Head(content string, attrs ...map[string]string) Element {
	return createDocumentElement("head", content, attrs...)
}

func Body(content string, attrs ...map[string]string) Element {
	return createDocumentElement("body", content, attrs...)
}

func Title(content string, attrs ...map[string]string) Element {
	return createDocumentElement("title", content, attrs...)
}

func Meta(attrs ...map[string]string) Element {
	attributes := make(map[string]string)
	if len(attrs) > 0 {
		attributes = attrs[0]
	}
	return Element{
		Tag:        "meta",
		Attributes: attributes,
	}
}

func Link(attrs ...map[string]string) Element {
	attributes := make(map[string]string)
	if len(attrs) > 0 {
		attributes = attrs[0]
	}
	return Element{
		Tag:        "link",
		Attributes: attributes,
	}
}

func Script(content string, attrs ...map[string]string) Element {
	return createDocumentElement("script", content, attrs...)
}

func Style(content string, attrs ...map[string]string) Element {
	return createDocumentElement("style", content, attrs...)
}

func createDocumentElement(tag, content string, attrs ...map[string]string) Element {
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