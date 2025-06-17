package client

import (
	"context"
	"fmt"
	"net/http"

	"github.com/heysnelling/computesdk/pkg/ui"
	"github.com/heysnelling/computesdk/pkg/ui/css"
	"github.com/heysnelling/computesdk/pkg/ui/html"
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
	// Generate CSS utilities
	stylesheet := css.GenerateUtilities()
	
	// Build the UI using utility classes
	page := html.Html(
		html.Head(
			html.Title("ComputeSDK Client"),
			html.Style(stylesheet.Generate()),
		),
		html.Body(
			html.Div(
				html.H1("ComputeSDK Client").
					Class(css.TextGray(800), css.My(0)),
				html.Div().
					SetContent("✓ Server is online").
					Class(css.P(4), css.BgGreen(100), css.TextGreen(800), css.Rounded(4), css.My(5)),
				html.Div(
					html.P("Welcome to the ComputeSDK Client interface."),
					html.P("This UI is built using the ComputeSDK UI framework and served over HTTP."),
					html.H2("Features").Class(css.TextGray(700)),
					html.Ul(
						html.Li("Dynamic HTML generation"),
						html.Li("Component-based UI building"),  
						html.Li("Built-in HTTP server"),
					),
				).Class(css.TextGray(600)),
			).Class(css.BgGray(50), css.P(8), css.Rounded(8), css.M(6)),
		).Class(css.BgGray(100), css.P(5)),
	)

	// Render and serve
	myUI := ui.NewUI(page)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprint(w, myUI.Render())
}