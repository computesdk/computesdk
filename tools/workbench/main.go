package main

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
)

//go:embed all:static
var staticFiles embed.FS

func main() {
	port := flag.String("port", "8090", "Port to serve the workbench on")
	flag.Parse()

	mux := http.NewServeMux()

	// Serve static files from the "static" subdirectory
	sub, err := fs.Sub(staticFiles, "static")
	if err != nil {
		log.Fatal(err)
	}
	mux.Handle("/", http.FileServer(http.FS(sub)))

	addr := fmt.Sprintf(":%s", *port)
	log.Printf("🚀 Workbench server starting on http://localhost%s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}