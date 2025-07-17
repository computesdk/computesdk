package main

import (
	"fmt"
	"os"
	"os/exec"
)

const (
	defaultNamespace  = "computesdk-system"
	defaultDeployment = "deployment/computesdk-api"
)

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	// Get namespace from environment or use default
	namespace := os.Getenv("COMPUTESDK_NAMESPACE")
	if namespace == "" {
		namespace = defaultNamespace
	}

	// Build kubectl exec command
	args := []string{
		"exec", "-n", namespace,
		defaultDeployment, "--",
		"./keyctl",
	}

	// Append all arguments passed to this CLI
	args = append(args, os.Args[1:]...)

	// Execute kubectl command
	cmd := exec.Command("kubectl", args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Stdin = os.Stdin

	err := cmd.Run()
	if err != nil {
		if exitError, ok := err.(*exec.ExitError); ok {
			os.Exit(exitError.ExitCode())
		}
		fmt.Fprintf(os.Stderr, "Error executing command: %v\n", err)
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Println("computesdk-cli - ComputeSDK API Key Management")
	fmt.Println()
	fmt.Println("This CLI wraps the in-cluster keyctl tool via kubectl exec.")
	fmt.Println()
	fmt.Println("USAGE:")
	fmt.Println("  computesdk-cli <keyctl-command> [options]")
	fmt.Println()
	fmt.Println("EXAMPLES:")
	fmt.Println("  computesdk-cli create -name \"My API Key\"")
	fmt.Println("  computesdk-cli list -status active")
	fmt.Println("  computesdk-cli get -id key_abc123")
	fmt.Println("  computesdk-cli revoke -id key_abc123 -reason \"No longer needed\"")
	fmt.Println("  computesdk-cli help")
	fmt.Println()
	fmt.Println("ENVIRONMENT VARIABLES:")
	fmt.Println("  COMPUTESDK_NAMESPACE    Kubernetes namespace (default: computesdk-system)")
	fmt.Println()
	fmt.Println("REQUIREMENTS:")
	fmt.Println("  - kubectl must be installed and configured")
	fmt.Println("  - Access to the computesdk-system namespace")
}
