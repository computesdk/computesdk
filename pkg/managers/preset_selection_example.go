package managers

import (
	"context"
	"fmt"
	"time"

	corev1 "k8s.io/api/core/v1"

	"github.com/heysnelling/computesdk/pkg/k8s"
)

// PresetSelectionExample demonstrates how to use preset selection in the API
func PresetSelectionExample() error {
	// 1. Create Kubernetes client and managers
	k8sClient, err := k8s.NewKubernetesClient(
		k8s.WithNamespace("computesdk"),
	)
	if err != nil {
		return fmt.Errorf("failed to create k8s client: %w", err)
	}

	factory := NewManagerFactory(k8sClient, "computesdk")
	presetMgr, computeMgr := factory.CreateManagers()
	ctx := context.Background()

	// 2. Create multiple preset templates for different use cases
	presets := []PresetSpec{
		{
			PresetID:    "web-server",
			Name:        "Web Server",
			Description: "Nginx web server preset",
			Version:     "1.0.0",
			Template: PresetTemplate{
				Image:           "nginx:latest",
				ImagePullPolicy: corev1.PullIfNotPresent,
				Ports: []corev1.ContainerPort{
					{Name: "http", ContainerPort: 80, Protocol: corev1.ProtocolTCP},
				},
				Env: []corev1.EnvVar{
					{Name: "NGINX_PORT", Value: "80"},
				},
			},
			Resources: ResourceRequirements{
				Requests: NewResourceList("100m", "128Mi"),
				Limits:   NewResourceList("500m", "512Mi"),
			},
			Labels: map[string]string{
				"category": "web",
				"tier":     "frontend",
			},
		},
		{
			PresetID:    "database",
			Name:        "Database Server",
			Description: "PostgreSQL database preset",
			Version:     "1.0.0",
			Template: PresetTemplate{
				Image:           "postgres:13",
				ImagePullPolicy: corev1.PullIfNotPresent,
				Ports: []corev1.ContainerPort{
					{Name: "postgres", ContainerPort: 5432, Protocol: corev1.ProtocolTCP},
				},
				Env: []corev1.EnvVar{
					{Name: "POSTGRES_DB", Value: "myapp"},
					{Name: "POSTGRES_USER", Value: "user"},
					{Name: "POSTGRES_PASSWORD", Value: "password"},
				},
			},
			Resources: ResourceRequirements{
				Requests: NewResourceList("200m", "256Mi"),
				Limits:   NewResourceList("1000m", "1Gi"),
			},
			Labels: map[string]string{
				"category": "database",
				"tier":     "backend",
			},
		},
		{
			PresetID:    "dev-environment",
			Name:        "Development Environment",
			Description: "Ubuntu development environment with tools",
			Version:     "1.0.0",
			Template: PresetTemplate{
				Image:           "ubuntu:20.04",
				ImagePullPolicy: corev1.PullIfNotPresent,
				Command:         []string{"/bin/bash"},
				Args:            []string{"-c", "sleep infinity"},
				Env: []corev1.EnvVar{
					{Name: "DEBIAN_FRONTEND", Value: "noninteractive"},
				},
			},
			Resources: ResourceRequirements{
				Requests: NewResourceList("500m", "512Mi"),
				Limits:   NewResourceList("2000m", "2Gi"),
			},
			Labels: map[string]string{
				"category": "development",
				"tier":     "tools",
			},
		},
	}

	// 3. Create all presets
	fmt.Println("Creating presets...")
	for _, presetSpec := range presets {
		preset, err := presetMgr.CreatePreset(ctx, presetSpec)
		if err != nil {
			return fmt.Errorf("failed to create preset %s: %w", presetSpec.PresetID, err)
		}
		fmt.Printf("✓ Created preset: %s (%s)\n", preset.PresetID, preset.Name)
	}

	// 4. List available presets
	fmt.Println("\nAvailable presets:")
	availablePresets, err := presetMgr.ListPresets(ctx, PresetFilters{})
	if err != nil {
		return fmt.Errorf("failed to list presets: %w", err)
	}

	for _, preset := range availablePresets {
		fmt.Printf("- %s: %s (v%s)\n", preset.PresetID, preset.Name, preset.Version)
		fmt.Printf("  Description: %s\n", preset.Description)
		fmt.Printf("  Image: %s\n", preset.Template.Image)
		fmt.Printf("  Resources: %v requests, %v limits\n",
			preset.Resources.Requests, preset.Resources.Limits)
		fmt.Println()
	}

	// 5. Create compute instances using different presets
	computeSpecs := []ComputeSpec{
		{
			ComputeID: "web-instance-1",
			PresetID:  "web-server",
			Labels: map[string]string{
				"app":  "frontend",
				"user": "demo",
			},
		},
		{
			ComputeID: "db-instance-1",
			PresetID:  "database",
			Labels: map[string]string{
				"app":  "backend",
				"user": "demo",
			},
		},
		{
			ComputeID: "dev-instance-1",
			PresetID:  "dev-environment",
			Labels: map[string]string{
				"app":  "development",
				"user": "developer",
			},
		},
	}

	fmt.Println("Creating compute instances with different presets...")
	var createdComputes []*ComputeInfo
	for _, computeSpec := range computeSpecs {
		compute, err := computeMgr.CreateCompute(ctx, computeSpec)
		if err != nil {
			return fmt.Errorf("failed to create compute %s: %w", computeSpec.ComputeID, err)
		}
		createdComputes = append(createdComputes, compute)
		fmt.Printf("✓ Created compute: %s using preset %s\n", compute.ComputeID, compute.PresetID)
	}

	// 6. Wait for computes to be ready
	fmt.Println("\nWaiting for compute instances to be ready...")
	for _, compute := range createdComputes {
		readyCompute, err := computeMgr.WaitForComputeReady(ctx, compute.ComputeID, 60*time.Second)
		if err != nil {
			fmt.Printf("⚠ Compute %s did not become ready: %v\n", compute.ComputeID, err)
			continue
		}
		fmt.Printf("✓ Compute %s is ready at IP: %s\n", readyCompute.ComputeID, readyCompute.Network.PodIP)
	}

	// 7. List computes by preset
	fmt.Println("\nListing computes by preset:")
	for _, presetID := range []string{"web-server", "database", "dev-environment"} {
		computes, err := computeMgr.ListComputes(ctx, ComputeFilters{PresetID: presetID})
		if err != nil {
			return fmt.Errorf("failed to list computes for preset %s: %w", presetID, err)
		}
		fmt.Printf("Preset %s has %d compute instances:\n", presetID, len(computes))
		for _, compute := range computes {
			fmt.Printf("  - %s (%s) - %s\n", compute.ComputeID, compute.Status.Phase, compute.Network.PodIP)
		}
	}

	// 8. Clean up
	fmt.Println("\nCleaning up...")
	for _, compute := range createdComputes {
		err := computeMgr.DeleteCompute(ctx, compute.ComputeID)
		if err != nil {
			fmt.Printf("⚠ Failed to delete compute %s: %v\n", compute.ComputeID, err)
		} else {
			fmt.Printf("✓ Deleted compute: %s\n", compute.ComputeID)
		}
	}

	// Delete presets
	for _, presetSpec := range presets {
		err := presetMgr.DeletePreset(ctx, presetSpec.PresetID)
		if err != nil {
			fmt.Printf("⚠ Failed to delete preset %s: %v\n", presetSpec.PresetID, err)
		} else {
			fmt.Printf("✓ Deleted preset: %s\n", presetSpec.PresetID)
		}
	}

	return nil
}

// APIUsageExample shows how to use the new preset selection API
func APIUsageExample() {
	fmt.Println("API Usage Examples:")
	fmt.Println()

	fmt.Println("1. List available presets:")
	fmt.Println("   GET /api/computes/presets")
	fmt.Println("   Response: Array of preset objects with details")
	fmt.Println()

	fmt.Println("2. Get specific preset:")
	fmt.Println("   GET /api/computes/presets/web-server")
	fmt.Println("   Response: Preset object with full configuration")
	fmt.Println()

	fmt.Println("3. Create compute with specific preset:")
	fmt.Println("   POST /api/computes")
	fmt.Println("   Body: {")
	fmt.Println("     \"environment\": \"development\",")
	fmt.Println("     \"preset_id\": \"web-server\"")
	fmt.Println("   }")
	fmt.Println()

	fmt.Println("4. Create compute with default preset (backward compatible):")
	fmt.Println("   POST /api/computes")
	fmt.Println("   Body: {")
	fmt.Println("     \"environment\": \"development\"")
	fmt.Println("   }")
	fmt.Println("   (Uses default preset for the environment)")
	fmt.Println()

	fmt.Println("5. List computes (shows preset_id in response):")
	fmt.Println("   GET /api/computes")
	fmt.Println("   Response includes preset_id for each compute instance")
}
