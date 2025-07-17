package managers

import (
	"context"
	"fmt"
	"time"

	corev1 "k8s.io/api/core/v1"

	"github.com/heysnelling/computesdk/pkg/k8s"
)

// Example demonstrates how to use the Manager system
func Example() error {
	// 1. Create Kubernetes client
	k8sClient, err := k8s.NewKubernetesClient(
		k8s.WithNamespace("computesdk"),
	)
	if err != nil {
		return fmt.Errorf("failed to create k8s client: %w", err)
	}

	// 2. Create manager factory
	factory := NewManagerFactory(k8sClient, "computesdk")

	// 3. Create managers
	presetMgr, computeMgr := factory.CreateManagers()

	ctx := context.Background()

	// 4. Create a preset template
	presetSpec := PresetSpec{
		PresetID:    "example-preset",
		Name:        "Example Preset",
		Description: "An example compute preset",
		Version:     "1.0.0",
		Template: PresetTemplate{
			Image:           "nginx:latest",
			ImagePullPolicy: corev1.PullIfNotPresent,
			Command:         []string{},
			Args:            []string{},
			Env: []corev1.EnvVar{
				{Name: "ENV", Value: "production"},
			},
			Ports: []corev1.ContainerPort{
				{Name: "http", ContainerPort: 80, Protocol: corev1.ProtocolTCP},
			},
		},
		Resources: ResourceRequirements{
			Requests: NewResourceList("100m", "128Mi"),
			Limits:   NewResourceList("500m", "512Mi"),
		},
		Labels: map[string]string{
			"environment": "example",
		},
	}

	preset, err := presetMgr.CreatePreset(ctx, presetSpec)
	if err != nil {
		return fmt.Errorf("failed to create preset: %w", err)
	}
	fmt.Printf("Created preset: %s\n", preset.PresetID)

	// 5. Create a compute instance from the preset
	computeSpec := ComputeSpec{
		ComputeID: "example-compute-1",
		PresetID:  preset.PresetID,
		Labels: map[string]string{
			"user": "example-user",
		},
	}

	compute, err := computeMgr.CreateCompute(ctx, computeSpec)
	if err != nil {
		return fmt.Errorf("failed to create compute: %w", err)
	}
	fmt.Printf("Created compute: %s\n", compute.ComputeID)

	// 6. Wait for compute to be ready
	readyCompute, err := computeMgr.WaitForComputeReady(ctx, compute.ComputeID, 60*time.Second)
	if err != nil {
		return fmt.Errorf("compute did not become ready: %w", err)
	}
	fmt.Printf("Compute %s is ready at IP: %s\n", readyCompute.ComputeID, readyCompute.Network.PodIP)

	// 7. List all computes
	computes, err := computeMgr.ListComputes(ctx, ComputeFilters{})
	if err != nil {
		return fmt.Errorf("failed to list computes: %w", err)
	}
	fmt.Printf("Found %d compute instances\n", len(computes))

	// 8. Create another compute instance from the same preset
	computeSpec2 := ComputeSpec{
		ComputeID: "example-compute-2",
		PresetID:  preset.PresetID,
	}

	compute2, err := computeMgr.CreateCompute(ctx, computeSpec2)
	if err != nil {
		return fmt.Errorf("failed to create second compute: %w", err)
	}
	fmt.Printf("Created second compute: %s\n", compute2.ComputeID)

	// 9. Check preset deployment status
	deploymentStatus, err := presetMgr.GetPresetDeploymentStatus(ctx, preset.PresetID)
	if err != nil {
		return fmt.Errorf("failed to get deployment status: %w", err)
	}
	fmt.Printf("Preset deployment has %d/%d ready replicas\n", deploymentStatus.ReadyReplicas, deploymentStatus.Replicas)

	// 10. Clean up - delete compute instances
	err = computeMgr.DeleteCompute(ctx, compute.ComputeID)
	if err != nil {
		return fmt.Errorf("failed to delete compute: %w", err)
	}
	fmt.Printf("Deleted compute: %s\n", compute.ComputeID)

	err = computeMgr.DeleteCompute(ctx, compute2.ComputeID)
	if err != nil {
		return fmt.Errorf("failed to delete second compute: %w", err)
	}
	fmt.Printf("Deleted compute: %s\n", compute2.ComputeID)

	// 11. Delete preset (only works when no active computes)
	err = presetMgr.DeletePreset(ctx, preset.PresetID)
	if err != nil {
		return fmt.Errorf("failed to delete preset: %w", err)
	}
	fmt.Printf("Deleted preset: %s\n", preset.PresetID)

	return nil
}

// ExampleWithErrorHandling demonstrates error handling patterns
func ExampleWithErrorHandling() error {
	k8sClient, err := k8s.NewKubernetesClient(k8s.WithNamespace("computesdk"))
	if err != nil {
		return err
	}

	factory := NewManagerFactory(k8sClient, "computesdk")
	presetMgr, computeMgr := factory.CreateManagers()
	ctx := context.Background()

	// Try to get a non-existent compute
	_, err = computeMgr.GetCompute(ctx, "non-existent-compute")
	if IsComputeNotFound(err) {
		fmt.Println("Compute not found - this is expected")
	}

	// Try to create compute with invalid spec
	invalidSpec := ComputeSpec{
		// Missing PresetID - should fail validation
		ComputeID: "invalid-compute",
	}

	_, err = computeMgr.CreateCompute(ctx, invalidSpec)
	if IsValidationError(err) {
		fmt.Printf("Validation error: %v\n", err)
	}

	// Try to delete a preset that's in use
	// First create preset and compute
	presetSpec := PresetSpec{
		PresetID: "test-preset",
		Name:     "Test Preset",
		Template: PresetTemplate{
			Image: "nginx:latest",
		},
		Resources: ResourceRequirements{
			Requests: NewResourceList("100m", "128Mi"),
		},
	}

	preset, err := presetMgr.CreatePreset(ctx, presetSpec)
	if err != nil {
		return err
	}

	computeSpec := ComputeSpec{
		ComputeID: "test-compute",
		PresetID:  preset.PresetID,
	}

	_, err = computeMgr.CreateCompute(ctx, computeSpec)
	if err != nil {
		return err
	}

	// Now try to delete preset while compute is running
	err = presetMgr.DeletePreset(ctx, preset.PresetID)
	if IsPresetInUse(err) {
		fmt.Printf("Cannot delete preset - in use: %v\n", err)
	}

	// Clean up
	computeMgr.DeleteCompute(ctx, "test-compute")
	presetMgr.DeletePreset(ctx, preset.PresetID)

	return nil
}
