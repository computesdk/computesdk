package client

import (
	"context"
	"fmt"
	"net/http"

	"github.com/computesdk/zforge/css"
	"github.com/computesdk/zforge/html"
)

type Server struct {
	addr   string
	server *http.Server
}

func NewServer(addr string) *Server {
	return &Server{addr: addr}
}

func (s *Server) Start() error {
	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleHome)

	s.server = &http.Server{
		Addr:    s.addr,
		Handler: mux,
	}

	return s.server.ListenAndServe()
}

func (s *Server) Shutdown(ctx context.Context) error {
	if s.server != nil {
		return s.server.Shutdown(ctx)
	}
	return nil
}

func (s *Server) handleHome(w http.ResponseWriter, r *http.Request) {
	// Reset tracking for this request
	css.ResetTracking()

	// Build the UI using utility classes

	page := html.Html(
		html.Head(
			html.Title("ComputeSDK Client"),
		),

		html.Body().Class(css.BgGray(100), css.MinH("screen"), css.Flex(), css.JustifyCenter(), css.ItemsCenter()).AddChildren(
			html.Div().Class(css.BgGray(50), css.P(8), css.Rounded(8), css.M(6), css.MaxW("4xl"), css.Mx(0), css.Shadow("lg")).AddChildren(
				html.H1("ComputeSDK Client").Class(css.TextGray(800), css.My(0), css.Text4xl(), css.W("full")),
				html.Div().SetContent("✓ Server is online").Class(css.P(4), css.BgGreen(100), css.TextGreen(800), css.Rounded(4), css.My(5), css.Shadow("md")),
				html.Div().Class(css.TextGray(600)).AddChildren(
					html.P("Welcome to the ComputeSDK Client interface.").Class(css.TextLg()),
					html.P("This UI is built using the ComputeSDK UI framework and served over HTTP."),
					html.H2("Features").Class(css.TextGray(700), css.Text2XL(), css.Mt(6), css.Mb(3)),
					html.Ul().Class(css.Ml(6)).AddChildren(
						html.Li("Dynamic HTML generation"),
						html.Li("Component-based UI building"),
						html.Li("Built-in HTTP server"),
					),
				),
			),
		),
	)

	// Render the page (includes CSS injection and HTML generation)
	rendered := page.Render()

	// Serve the rendered HTML
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprint(w, rendered)
}
