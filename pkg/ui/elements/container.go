package elements

func Div(content string, attrs ...map[string]string) Element {
	return createContainerElement("div", content, attrs...)
}

func Section(content string, attrs ...map[string]string) Element {
	return createContainerElement("section", content, attrs...)
}

func Article(content string, attrs ...map[string]string) Element {
	return createContainerElement("article", content, attrs...)
}

func Header(content string, attrs ...map[string]string) Element {
	return createContainerElement("header", content, attrs...)
}

func Footer(content string, attrs ...map[string]string) Element {
	return createContainerElement("footer", content, attrs...)
}

func Nav(content string, attrs ...map[string]string) Element {
	return createContainerElement("nav", content, attrs...)
}

func Main(content string, attrs ...map[string]string) Element {
	return createContainerElement("main", content, attrs...)
}

func createContainerElement(tag, content string, attrs ...map[string]string) Element {
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