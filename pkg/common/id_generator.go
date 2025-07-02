// Package common is a common package
package common

import gonanoid "github.com/matoous/go-nanoid/v2"

// GeneratePrefixedID returns a nanoid with the given prefix.
func GeneratePrefixedID(prefix string) (string, error) {
	nanoID, err := gonanoid.New()
	if err != nil {
		return "", err
	}
	return prefix + nanoID, nil
}
