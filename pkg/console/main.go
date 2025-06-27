package console

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
			html.Title("ComputeSDK Console"),
		),

		html.Body().Class(css.BgGray(50), css.MinH("screen"), css.Flex()).AddChildren(),
	)

	// Render the page (includes CSS injection and HTML generation)
	rendered := page.Render()

	// Serve the rendered HTML
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprint(w, rendered)
}
