package elements

type Element struct {
	Tag        string
	Content    string
	Attributes map[string]string
	Children   []Element
}