package elements

func Table(content string, attrs ...map[string]string) Element {
	return createTableElement("table", content, attrs...)
}

func Thead(content string, attrs ...map[string]string) Element {
	return createTableElement("thead", content, attrs...)
}

func Tbody(content string, attrs ...map[string]string) Element {
	return createTableElement("tbody", content, attrs...)
}

func Tfoot(content string, attrs ...map[string]string) Element {
	return createTableElement("tfoot", content, attrs...)
}

func Tr(content string, attrs ...map[string]string) Element {
	return createTableElement("tr", content, attrs...)
}

func Th(content string, attrs ...map[string]string) Element {
	return createTableElement("th", content, attrs...)
}

func Td(content string, attrs ...map[string]string) Element {
	return createTableElement("td", content, attrs...)
}

func Caption(content string, attrs ...map[string]string) Element {
	return createTableElement("caption", content, attrs...)
}

func createTableElement(tag, content string, attrs ...map[string]string) Element {
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