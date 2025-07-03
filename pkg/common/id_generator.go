// Package common is a common package
package common

import (
	"log"
	"time"

	gonanoid "github.com/matoous/go-nanoid/v2"
)

// GeneratePrefixedID returns a nanoid with the given prefix.
func GeneratePrefixedID(prefix string) string {
	nanoID, err := gonanoid.New()
	if err != nil {
		// Fallback to timestamp-based ID
		log.Printf("nanoid generation failed, using timestamp fallback: %v", err)
		return prefix + "_" + time.Now().Format("20060102150405")
	}
	return prefix + "_" + nanoID
}
