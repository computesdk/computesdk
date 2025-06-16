package elements

func Img(src string, attrs ...map[string]string) Element {
	attributes := make(map[string]string)
	if len(attrs) > 0 {
		attributes = attrs[0]
	}
	attributes["src"] = src
	return Element{
		Tag:        "img",
		Attributes: attributes,
	}
}

func Video(content string, attrs ...map[string]string) Element {
	return createMediaElement("video", content, attrs...)
}

func Audio(content string, attrs ...map[string]string) Element {
	return createMediaElement("audio", content, attrs...)
}

func Source(src string, attrs ...map[string]string) Element {
	attributes := make(map[string]string)
	if len(attrs) > 0 {
		attributes = attrs[0]
	}
	attributes["src"] = src
	return Element{
		Tag:        "source",
		Attributes: attributes,
	}
}

func createMediaElement(tag, content string, attrs ...map[string]string) Element {
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