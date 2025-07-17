package managers

import (
	"context"
	"fmt"

	"github.com/heysnelling/computesdk/pkg/k8s"
)

// StartupExample demonstrates the server startup process with default presets
func StartupExample() error {
	fmt.Println("=== Server Startup Process ===")

	// 1. Create Kubernetes client (happens in router.go)
	fmt.Println("1. Creating Kubernetes client...")
	k8sClient, err := k8s.NewKubernetesClient(
		k8s.WithNamespace("computesdk"),
	)
	if err != nil {
		return fmt.Errorf("failed to create k8s client: %w", err)
	}
	fmt.Println("✓ Kubernetes client created")

	// 2. Create managers (happens in router.go)
	fmt.Println("\n2. Creating managers...")
	factory := NewManagerFactory(k8sClient, "computesdk")
	presetMgr, computeMgr := factory.CreateManagers()
	fmt.Println("✓ PresetManager and ComputeManager created")

	// 3. Initialize default presets (happens in router.go)
	fmt.Println("\n3. Initializing default presets...")
	ctx := context.Background()
	err = InitializeDefaultPresets(ctx, presetMgr)
	if err != nil {
		return fmt.Errorf("failed to initialize default presets: %w", err)
	}
	fmt.Println("✓ Default presets initialized")

	// 4. Show what presets are now available
	fmt.Println("\n4. Available presets after startup:")
	presets, err := presetMgr.ListPresets(ctx, PresetFilters{})
	if err != nil {
		return fmt.Errorf("failed to list presets: %w", err)
	}

	for _, preset := range presets {
		fmt.Printf("   - %s: %s\n", preset.PresetID, preset.Name)
		fmt.Printf("     Image: %s\n", preset.Template.Image)
		fmt.Printf("     Resources: %v / %v\n", preset.Resources.Requests, preset.Resources.Limits)
		if preset.Labels["environment"] != "" {
			fmt.Printf("     Environment: %s\n", preset.Labels["environment"])
		}
		fmt.Println()
	}

	// 5. Demonstrate default preset selection
	fmt.Println("5. Default preset selection:")
	defaultPreset := GetDefaultPreset()
	fmt.Printf("   Default preset: %s\n", defaultPreset)

	// 6. Simulate API calls with and without preset selection
	fmt.Println("\n6. Simulating API calls:")

	// API call without preset_id (uses default)
	fmt.Println("   POST /api/computes")
	fmt.Println("   Body: {}")
	fmt.Printf("   → Will use default preset: %s\n", defaultPreset)

	// API call with specific preset_id
	fmt.Println("\n   POST /api/computes")
	fmt.Println("   Body: {\"preset_id\": \"web-server\"}")
	fmt.Printf("   → Will use specified preset: web-server\n")

	// 7. Create actual compute instances to demonstrate
	fmt.Println("\n7. Creating test compute instances:")

	// Create with default preset
	computeSpec1 := ComputeSpec{
		ComputeID: "test-default",
		PresetID:  GetDefaultPreset(),
		Labels: map[string]string{
			"test": "startup-example",
		},
	}

	compute1, err := computeMgr.CreateCompute(ctx, computeSpec1)
	if err != nil {
		return fmt.Errorf("failed to create compute with default preset: %w", err)
	}
	fmt.Printf("   ✓ Created compute '%s' with default preset '%s'\n", compute1.ComputeID, compute1.PresetID)

	// Create with specific preset
	computeSpec2 := ComputeSpec{
		ComputeID: "test-webserver",
		PresetID:  "web-server",
		Labels: map[string]string{
			"test": "startup-example",
		},
	}

	compute2, err := computeMgr.CreateCompute(ctx, computeSpec2)
	if err != nil {
		return fmt.Errorf("failed to create compute with web-server preset: %w", err)
	}
	fmt.Printf("   ✓ Created compute '%s' with web-server preset '%s'\n", compute2.ComputeID, compute2.PresetID)

	// 8. Clean up
	fmt.Println("\n8. Cleaning up test instances...")
	err = computeMgr.DeleteCompute(ctx, compute1.ComputeID)
	if err != nil {
		fmt.Printf("   ⚠ Failed to delete %s: %v\n", compute1.ComputeID, err)
	} else {
		fmt.Printf("   ✓ Deleted compute: %s\n", compute1.ComputeID)
	}

	err = computeMgr.DeleteCompute(ctx, compute2.ComputeID)
	if err != nil {
		fmt.Printf("   ⚠ Failed to delete %s: %v\n", compute2.ComputeID, err)
	} else {
		fmt.Printf("   ✓ Deleted compute: %s\n", compute2.ComputeID)
	}

	fmt.Println("\n=== Startup Complete ===")
	fmt.Println("Server is ready to accept compute creation requests!")
	fmt.Println("Default presets are available for all environments.")

	return nil
}

// ShowDefaultPresetInfo displays information about the default presets
func ShowDefaultPresetInfo() {
	fmt.Println("=== Default Preset Information ===")
	fmt.Println()

	fmt.Printf("Default Preset: %s\n", GetDefaultPreset())
	fmt.Println()

	fmt.Println("Available Presets:")
	presets := GetDefaultPresets()
	for _, preset := range presets {
		fmt.Printf("  %s (%s)\n", preset.PresetID, preset.Name)
		fmt.Printf("    Description: %s\n", preset.Description)
		fmt.Printf("    Image: %s\n", preset.Template.Image)
		if cpu, exists := preset.Resources.Requests["cpu"]; exists {
			fmt.Printf("    CPU: %s request", cpu.String())
			if cpuLimit, limitExists := preset.Resources.Limits["cpu"]; limitExists {
				fmt.Printf(", %s limit", cpuLimit.String())
			}
			fmt.Println()
		}
		if memory, exists := preset.Resources.Requests["memory"]; exists {
			fmt.Printf("    Memory: %s request", memory.String())
			if memLimit, limitExists := preset.Resources.Limits["memory"]; limitExists {
				fmt.Printf(", %s limit", memLimit.String())
			}
			fmt.Println()
		}
		if len(preset.Template.Ports) > 0 {
			fmt.Printf("    Ports: ")
			for i, port := range preset.Template.Ports {
				if i > 0 {
					fmt.Printf(", ")
				}
				fmt.Printf("%s:%d", port.Name, port.ContainerPort)
			}
			fmt.Println()
		}
		fmt.Println()
	}
}
