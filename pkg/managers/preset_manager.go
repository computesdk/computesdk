package managers

import (
	"context"
	"fmt"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/heysnelling/computesdk/pkg/k8s"
)

// PresetManager interface defines operations for managing preset templates
type PresetManager interface {
	// Core CRUD operations
	CreatePreset(ctx context.Context, spec PresetSpec) (*PresetInfo, error)
	GetPreset(ctx context.Context, presetID string) (*PresetInfo, error)
	ListPresets(ctx context.Context, filters PresetFilters) ([]*PresetInfo, error)
	UpdatePreset(ctx context.Context, presetID string, spec PresetSpec) (*PresetInfo, error)
	DeletePreset(ctx context.Context, presetID string) error

	// Template operations
	ValidatePreset(ctx context.Context, spec PresetSpec) error
	RenderPreset(ctx context.Context, presetID string, params map[string]interface{}) (*ComputeSpec, error)

	// Deployment management
	EnsurePresetDeployment(ctx context.Context, presetID string) (*appsv1.Deployment, error)
	GetPresetDeploymentStatus(ctx context.Context, presetID string) (*DeploymentStatus, error)
}

// DefaultPresetManager implements PresetManager
type DefaultPresetManager struct {
	deploymentOps k8s.DeploymentOperations
	namespace     string
	logger        Logger
}

// NewPresetManager creates a new PresetManager
func NewPresetManager(deploymentOps k8s.DeploymentOperations, config ManagerConfig) PresetManager {
	return &DefaultPresetManager{
		deploymentOps: deploymentOps,
		namespace:     config.Namespace,
		logger:        config.Logger,
	}
}

// CreatePreset creates a new preset template
func (pm *DefaultPresetManager) CreatePreset(ctx context.Context, spec PresetSpec) (*PresetInfo, error) {
	// Validate the preset spec
	if err := pm.ValidatePreset(ctx, spec); err != nil {
		return nil, fmt.Errorf("invalid preset spec: %w", err)
	}

	// Create the deployment with 0 replicas
	deployment := pm.buildDeploymentFromSpec(spec)
	createdDeployment, err := pm.deploymentOps.CreateDeployment(ctx, pm.namespace, deployment)
	if err != nil {
		return nil, fmt.Errorf("failed to create deployment for preset %s: %w", spec.PresetID, err)
	}

	// Build and return PresetInfo
	presetInfo := &PresetInfo{
		PresetID:       spec.PresetID,
		Name:           spec.Name,
		Description:    spec.Description,
		Version:        spec.Version,
		Template:       spec.Template,
		Resources:      spec.Resources,
		DeploymentName: createdDeployment.Name,
		BaseReplicas:   0,
		ActiveComputes: []string{},
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
		Labels:         spec.Labels,
		Annotations:    spec.Annotations,
	}

	pm.logger.Infof("Created preset %s with deployment %s", spec.PresetID, createdDeployment.Name)
	return presetInfo, nil
}

// GetPreset retrieves a preset by ID
func (pm *DefaultPresetManager) GetPreset(ctx context.Context, presetID string) (*PresetInfo, error) {
	deploymentName := DeploymentNameFromPresetID(presetID)
	deployment, err := pm.deploymentOps.GetDeployment(ctx, pm.namespace, deploymentName)
	if err != nil {
		return nil, fmt.Errorf("preset %s not found: %w", presetID, err)
	}

	return pm.buildPresetInfoFromDeployment(deployment), nil
}

// ListPresets lists presets based on filters
func (pm *DefaultPresetManager) ListPresets(ctx context.Context, filters PresetFilters) ([]*PresetInfo, error) {
	labelSelector := PresetLabels("")
	if filters.Labels != nil {
		for k, v := range filters.Labels {
			labelSelector[k] = v
		}
	}

	deployments, err := pm.deploymentOps.ListDeployments(ctx, pm.namespace, labelSelector)
	if err != nil {
		return nil, fmt.Errorf("failed to list preset deployments: %w", err)
	}

	var presets []*PresetInfo
	for _, deployment := range deployments.Items {
		presetInfo := pm.buildPresetInfoFromDeployment(&deployment)

		// Apply filters
		if filters.Name != "" && presetInfo.Name != filters.Name {
			continue
		}
		if filters.Version != "" && presetInfo.Version != filters.Version {
			continue
		}

		presets = append(presets, presetInfo)
	}

	return presets, nil
}

// UpdatePreset updates an existing preset
func (pm *DefaultPresetManager) UpdatePreset(ctx context.Context, presetID string, spec PresetSpec) (*PresetInfo, error) {
	// Validate the preset spec
	if err := pm.ValidatePreset(ctx, spec); err != nil {
		return nil, fmt.Errorf("invalid preset spec: %w", err)
	}

	// Get existing deployment
	deploymentName := DeploymentNameFromPresetID(presetID)
	existingDeployment, err := pm.deploymentOps.GetDeployment(ctx, pm.namespace, deploymentName)
	if err != nil {
		return nil, fmt.Errorf("preset %s not found: %w", presetID, err)
	}

	// Update deployment with new spec
	updatedDeployment := pm.buildDeploymentFromSpec(spec)
	updatedDeployment.Name = existingDeployment.Name
	updatedDeployment.Namespace = existingDeployment.Namespace
	updatedDeployment.ResourceVersion = existingDeployment.ResourceVersion
	updatedDeployment.Spec.Replicas = existingDeployment.Spec.Replicas // Preserve current replica count

	_, err = pm.deploymentOps.UpdateDeployment(ctx, pm.namespace, updatedDeployment)
	if err != nil {
		return nil, fmt.Errorf("failed to update deployment for preset %s: %w", presetID, err)
	}

	// Build and return updated PresetInfo
	presetInfo := pm.buildPresetInfoFromDeployment(updatedDeployment)
	presetInfo.UpdatedAt = time.Now()

	pm.logger.Infof("Updated preset %s", presetID)
	return presetInfo, nil
}

// DeletePreset deletes a preset
func (pm *DefaultPresetManager) DeletePreset(ctx context.Context, presetID string) error {
	deploymentName := DeploymentNameFromPresetID(presetID)

	// Check if deployment has active replicas
	deployment, err := pm.deploymentOps.GetDeployment(ctx, pm.namespace, deploymentName)
	if err != nil {
		return fmt.Errorf("preset %s not found: %w", presetID, err)
	}

	if deployment.Spec.Replicas != nil && *deployment.Spec.Replicas > 0 {
		return fmt.Errorf("cannot delete preset %s: has %d active compute instances", presetID, *deployment.Spec.Replicas)
	}

	err = pm.deploymentOps.DeleteDeployment(ctx, pm.namespace, deploymentName)
	if err != nil {
		return fmt.Errorf("failed to delete deployment for preset %s: %w", presetID, err)
	}

	pm.logger.Infof("Deleted preset %s", presetID)
	return nil
}

// ValidatePreset validates a preset specification
func (pm *DefaultPresetManager) ValidatePreset(ctx context.Context, spec PresetSpec) error {
	if spec.PresetID == "" {
		return fmt.Errorf("preset ID is required")
	}
	if spec.Name == "" {
		return fmt.Errorf("preset name is required")
	}
	if spec.Template.Image == "" {
		return fmt.Errorf("preset template image is required")
	}

	// Additional validation can be added here
	return nil
}

// RenderPreset renders a preset template into a compute spec
func (pm *DefaultPresetManager) RenderPreset(ctx context.Context, presetID string, params map[string]interface{}) (*ComputeSpec, error) {
	// Validate preset exists
	_, err := pm.GetPreset(ctx, presetID)
	if err != nil {
		return nil, err
	}

	// For now, simple rendering - can be extended with templating engine
	computeSpec := &ComputeSpec{
		PresetID: presetID,
		Labels:   ComputeLabels("", presetID), // ComputeID will be set by ComputeManager
	}

	// Apply resource overrides if provided in params
	if resourceOverrides, ok := params["resources"]; ok {
		if resources, ok := resourceOverrides.(*ComputeResources); ok {
			computeSpec.ResourceOverrides = resources
		}
	}

	return computeSpec, nil
}

// EnsurePresetDeployment ensures a deployment exists for the preset
func (pm *DefaultPresetManager) EnsurePresetDeployment(ctx context.Context, presetID string) (*appsv1.Deployment, error) {
	deploymentName := DeploymentNameFromPresetID(presetID)

	// Try to get existing deployment
	deployment, err := pm.deploymentOps.GetDeployment(ctx, pm.namespace, deploymentName)
	if err == nil {
		return deployment, nil
	}

	// If deployment doesn't exist, this means the preset was not properly created
	return nil, fmt.Errorf("deployment for preset %s does not exist", presetID)
}

// GetPresetDeploymentStatus gets the deployment status for a preset
func (pm *DefaultPresetManager) GetPresetDeploymentStatus(ctx context.Context, presetID string) (*DeploymentStatus, error) {
	deploymentName := DeploymentNameFromPresetID(presetID)
	deployment, err := pm.deploymentOps.GetDeployment(ctx, pm.namespace, deploymentName)
	if err != nil {
		return nil, fmt.Errorf("preset %s deployment not found: %w", presetID, err)
	}

	return &DeploymentStatus{
		Replicas:          deployment.Status.Replicas,
		ReadyReplicas:     deployment.Status.ReadyReplicas,
		AvailableReplicas: deployment.Status.AvailableReplicas,
		UpdatedReplicas:   deployment.Status.UpdatedReplicas,
		Conditions:        deployment.Status.Conditions,
	}, nil
}

// Helper methods

func (pm *DefaultPresetManager) buildDeploymentFromSpec(spec PresetSpec) *appsv1.Deployment {
	labels := PresetLabels(spec.PresetID)
	for k, v := range spec.Labels {
		labels[k] = v
	}

	replicas := int32(0) // Start with 0 replicas

	return &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:        DeploymentNameFromPresetID(spec.PresetID),
			Namespace:   pm.namespace,
			Labels:      labels,
			Annotations: spec.Annotations,
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Selector: &metav1.LabelSelector{
				MatchLabels: PresetLabels(spec.PresetID),
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: labels,
				},
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{
						{
							Name:            "compute",
							Image:           spec.Template.Image,
							ImagePullPolicy: spec.Template.ImagePullPolicy,
							Command:         spec.Template.Command,
							Args:            spec.Template.Args,
							Env:             spec.Template.Env,
							Ports:           spec.Template.Ports,
							VolumeMounts:    spec.Template.VolumeMounts,
							WorkingDir:      spec.Template.WorkingDir,
							Resources: corev1.ResourceRequirements{
								Requests: spec.Resources.Requests,
								Limits:   spec.Resources.Limits,
							},
						},
					},
				},
			},
		},
	}
}

func (pm *DefaultPresetManager) buildPresetInfoFromDeployment(deployment *appsv1.Deployment) *PresetInfo {
	presetID := deployment.Labels["presetId"]
	if presetID == "" {
		// Fallback: extract from deployment name
		presetID = deployment.Name[7:] // Remove "preset-" prefix
	}

	var template PresetTemplate
	var resources ResourceRequirements

	if len(deployment.Spec.Template.Spec.Containers) > 0 {
		container := deployment.Spec.Template.Spec.Containers[0]
		template = PresetTemplate{
			Image:           container.Image,
			ImagePullPolicy: container.ImagePullPolicy,
			Command:         container.Command,
			Args:            container.Args,
			Env:             container.Env,
			Ports:           container.Ports,
			VolumeMounts:    container.VolumeMounts,
			WorkingDir:      container.WorkingDir,
		}
		resources = ResourceRequirements{
			Requests: container.Resources.Requests,
			Limits:   container.Resources.Limits,
		}
	}

	// Get current replica count for active computes tracking
	currentReplicas := int32(0)
	if deployment.Spec.Replicas != nil {
		currentReplicas = *deployment.Spec.Replicas
	}

	return &PresetInfo{
		PresetID:       presetID,
		Name:           deployment.Labels["name"],
		Description:    deployment.Annotations["description"],
		Version:        deployment.Labels["version"],
		Template:       template,
		Resources:      resources,
		DeploymentName: deployment.Name,
		BaseReplicas:   0,                               // Always 0 for presets
		ActiveComputes: make([]string, currentReplicas), // TODO: Track actual compute IDs
		CreatedAt:      deployment.CreationTimestamp.Time,
		UpdatedAt:      deployment.CreationTimestamp.Time, // TODO: Track updates
		Labels:         deployment.Labels,
		Annotations:    deployment.Annotations,
	}
}
