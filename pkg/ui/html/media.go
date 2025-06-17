package html

// Img creates a new img element (self-closing)
func Img(src string) *Element {
	elem := &Element{Tag: "img"}
	return elem.Attr("src", src)
}

// Video creates a new video element
func Video(children ...*Element) *Element {
	elem := &Element{Tag: "video"}
	return elem.AddChildren(children...)
}

// Audio creates a new audio element
func Audio(children ...*Element) *Element {
	elem := &Element{Tag: "audio"}
	return elem.AddChildren(children...)
}

// Source creates a new source element (self-closing)
func Source(src string) *Element {
	elem := &Element{Tag: "source"}
	return elem.Attr("src", src)
}