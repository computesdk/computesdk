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

		html.Body().Class(css.BgGray(50), css.MinH("screen"), css.Flex()).AddChildren(
			// Sidebar
			html.Div().Class(
				css.W(64), css.BgWhite(), css.BorderR(), css.BorderGray(200),
				css.Flex(), css.FlexCol(), css.H("screen"),
			).AddChildren(
				// Logo/Brand
				html.Div().Class(css.P(6), css.BorderB(), css.BorderGray(200)).AddChildren(
					html.H1("ComputeSDK").Class(css.Text2XL(), css.FontBold(), css.TextGray(900)),
					html.P("Console").Class(css.TextSm(), css.TextGray(500)),
				),
				
				// Navigation
				html.Nav().Class(css.Flex1(), css.P(4)).AddChildren(
					html.Div().Class(css.Space4()).AddChildren(
						// Dashboard
						html.A().SetHref("#").Class(
							css.Flex(), css.ItemsCenter(), css.Px(3), css.Py(2), css.Rounded(6),
							css.BgGray(100), css.TextGray(900), css.FontMedium(),
						).AddChildren(
							html.Span("🏠").Class(css.Mr(3)),
							html.Span("Dashboard"),
						),
						
						// Compute Nodes
						html.A().SetHref("#").Class(
							css.Flex(), css.ItemsCenter(), css.Px(3), css.Py(2), css.Rounded(6),
							css.TextGray(600), css.Hover(css.BgGray(100)), css.Hover(css.TextGray(900)),
						).AddChildren(
							html.Span("💻").Class(css.Mr(3)),
							html.Span("Compute Nodes"),
						),
						
						// Jobs
						html.A().SetHref("#").Class(
							css.Flex(), css.ItemsCenter(), css.Px(3), css.Py(2), css.Rounded(6),
							css.TextGray(600), css.Hover(css.BgGray(100)), css.Hover(css.TextGray(900)),
						).AddChildren(
							html.Span("📋").Class(css.Mr(3)),
							html.Span("Jobs"),
						),
						
						// Monitoring
						html.A().SetHref("#").Class(
							css.Flex(), css.ItemsCenter(), css.Px(3), css.Py(2), css.Rounded(6),
							css.TextGray(600), css.Hover(css.BgGray(100)), css.Hover(css.TextGray(900)),
						).AddChildren(
							html.Span("📊").Class(css.Mr(3)),
							html.Span("Monitoring"),
						),
						
						// Settings
						html.A().SetHref("#").Class(
							css.Flex(), css.ItemsCenter(), css.Px(3), css.Py(2), css.Rounded(6),
							css.TextGray(600), css.Hover(css.BgGray(100)), css.Hover(css.TextGray(900)),
						).AddChildren(
							html.Span("⚙️").Class(css.Mr(3)),
							html.Span("Settings"),
						),
					),
				),
				
				// Footer
				html.Div().Class(css.P(4), css.BorderT(), css.BorderGray(200)).AddChildren(
					html.Div().Class(css.Flex(), css.ItemsCenter()).AddChildren(
						html.Div().Class(css.W(8), css.H(8), css.Rounded("full"), css.BgGray(300), css.Mr(3)),
						html.Div().AddChildren(
							html.P("Admin User").Class(css.TextSm(), css.FontMedium(), css.TextGray(900)),
							html.P("admin@computesdk.io").Class(css.TextXs(), css.TextGray(500)),
						),
					),
				),
			),
			
			// Main Content Area
			html.Div().Class(css.Flex1(), css.Flex(), css.FlexCol()).AddChildren(
				// Top Bar
				html.Header().Class(css.BgWhite(), css.BorderB(), css.BorderGray(200), css.Px(6), css.Py(4)).AddChildren(
					html.Div().Class(css.Flex(), css.ItemsCenter(), css.JustifyBetween()).AddChildren(
						html.H2("Dashboard").Class(css.Text2XL(), css.FontBold(), css.TextGray(900)),
						html.Div().Class(css.Flex(), css.ItemsCenter(), css.Space4()).AddChildren(
							html.Button("🔔").Class(
								css.P(2), css.Rounded(6), css.TextGray(600),
								css.Hover(css.BgGray(100)),
							),
							html.Button("Refresh").Class(
								css.Px(4), css.Py(2), css.BgBlue(600), css.TextWhite(),
								css.Rounded(6), css.FontMedium(), css.Hover(css.BgBlue(700)),
							),
						),
					),
				),
				
				// Main Content
				html.Main().Class(css.Flex1(), css.P(6), css.OverflowAuto()).AddChildren(
					// Stats Cards
					html.Div().Class(css.Grid(), css.GridCols(1), css.MdGridCols(2), css.LgGridCols(4), css.Gap(6), css.Mb(8)).AddChildren(
						// Online Status Card
						html.Div().Class(css.BgWhite(), css.P(6), css.Rounded(8), css.Shadow("sm"), css.Border(), css.BorderGray(200)).AddChildren(
							html.Div().Class(css.Flex(), css.ItemsCenter(), css.JustifyBetween()).AddChildren(
								html.Div().AddChildren(
									html.P("System Status").Class(css.TextSm(), css.TextGray(600)),
									html.P("Online").Class(css.Text2XL(), css.FontBold(), css.TextGreen(600), css.Mt(1)),
								),
								html.Span("✓").Class(css.Text3xl(), css.TextGreen(500)),
							),
						),
						
						// Active Nodes Card
						html.Div().Class(css.BgWhite(), css.P(6), css.Rounded(8), css.Shadow("sm"), css.Border(), css.BorderGray(200)).AddChildren(
							html.Div().Class(css.Flex(), css.ItemsCenter(), css.JustifyBetween()).AddChildren(
								html.Div().AddChildren(
									html.P("Active Nodes").Class(css.TextSm(), css.TextGray(600)),
									html.P("12").Class(css.Text2XL(), css.FontBold(), css.TextGray(900), css.Mt(1)),
								),
								html.Span("💻").Class(css.Text3xl()),
							),
						),
						
						// Running Jobs Card
						html.Div().Class(css.BgWhite(), css.P(6), css.Rounded(8), css.Shadow("sm"), css.Border(), css.BorderGray(200)).AddChildren(
							html.Div().Class(css.Flex(), css.ItemsCenter(), css.JustifyBetween()).AddChildren(
								html.Div().AddChildren(
									html.P("Running Jobs").Class(css.TextSm(), css.TextGray(600)),
									html.P("24").Class(css.Text2XL(), css.FontBold(), css.TextGray(900), css.Mt(1)),
								),
								html.Span("⚡").Class(css.Text3xl()),
							),
						),
						
						// CPU Usage Card
						html.Div().Class(css.BgWhite(), css.P(6), css.Rounded(8), css.Shadow("sm"), css.Border(), css.BorderGray(200)).AddChildren(
							html.Div().Class(css.Flex(), css.ItemsCenter(), css.JustifyBetween()).AddChildren(
								html.Div().AddChildren(
									html.P("CPU Usage").Class(css.TextSm(), css.TextGray(600)),
									html.P("68%").Class(css.Text2XL(), css.FontBold(), css.TextGray(900), css.Mt(1)),
								),
								html.Span("📊").Class(css.Text3xl()),
							),
						),
					),
					
					// Welcome Section
					html.Div().Class(css.BgWhite(), css.P(8), css.Rounded(8), css.Shadow("sm"), css.Border(), css.BorderGray(200)).AddChildren(
						html.H3("Welcome to ComputeSDK Console").Class(css.Text2XL(), css.FontBold(), css.TextGray(900), css.Mb(4)),
						html.P("This is your central hub for managing compute resources, monitoring jobs, and configuring your distributed computing environment.").Class(css.TextGray(600), css.Mb(6)),
						
						html.H4("Quick Actions").Class(css.TextLg(), css.FontSemibold(), css.TextGray(800), css.Mb(3)),
						html.Div().Class(css.Grid(), css.GridCols(1), css.MdGridCols(3), css.Gap(4)).AddChildren(
							html.Button("Deploy New Node").Class(
								css.Px(4), css.Py(3), css.BgBlue(50), css.TextBlue(700),
								css.Rounded(6), css.FontMedium(), css.Border(), css.BorderBlue(200),
								css.Hover(css.BgBlue(100)),
							),
							html.Button("Submit Job").Class(
								css.Px(4), css.Py(3), css.BgGreen(50), css.TextGreen(700),
								css.Rounded(6), css.FontMedium(), css.Border(), css.BorderGreen(200),
								css.Hover(css.BgGreen(100)),
							),
							html.Button("View Reports").Class(
								css.Px(4), css.Py(3), css.BgPurple(50), css.TextPurple(700),
								css.Rounded(6), css.FontMedium(), css.Border(), css.BorderPurple(200),
								css.Hover(css.BgPurple(100)),
							),
						),
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
