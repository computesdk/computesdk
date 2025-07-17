package managers

import (
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
)

// ComputePhase represents the current phase of a compute instance
type ComputePhase string

const (
	ComputePhasePending   ComputePhase = "Pending"
	ComputePhaseRunning   ComputePhase = "Running"
	ComputePhaseFailed    ComputePhase = "Failed"
	ComputePhaseSucceeded ComputePhase = "Succeeded"
)

// ComputeCondition represents a condition of a compute instance
type ComputeCondition struct {
	Type               string
	Status             corev1.ConditionStatus
	LastTransitionTime time.Time
	Reason             string
	Message            string
}

// ComputeStatus represents the status of a compute instance
type ComputeStatus struct {
	Phase      ComputePhase
	IsReady    bool
	Message    string
	Conditions []ComputeCondition
}

// ComputeResources represents resource requirements and usage
type ComputeResources struct {
	Requests corev1.ResourceList
	Limits   corev1.ResourceList
	Usage    corev1.ResourceList // Current usage if available
}

// ComputeNetwork represents network configuration
type ComputeNetwork struct {
	PodIP  string
	HostIP string
	Ports  map[string]int32 // Port name to port number mapping
}

// ComputeInfo represents a compute instance
type ComputeInfo struct {
	ComputeID      string
	Name           string
	PresetID       string
	DeploymentName string
	PodName        string
	Status         ComputeStatus
	Resources      ComputeResources
	Network        ComputeNetwork
	CreatedAt      time.Time
	UpdatedAt      time.Time
	Labels         map[string]string
	Annotations    map[string]string
}

// ComputeSpec represents the specification for creating a compute instance
type ComputeSpec struct {
	ComputeID   string
	PresetID    string
	Labels      map[string]string
	Annotations map[string]string
	// Override resources if needed
	ResourceOverrides *ComputeResources
}

// ComputeFilters represents filters for listing compute instances
type ComputeFilters struct {
	PresetID string
	Phase    ComputePhase
	Labels   map[string]string
}

// PresetTemplate represents the template configuration for a preset
type PresetTemplate struct {
	Image           string
	ImagePullPolicy corev1.PullPolicy
	Command         []string
	Args            []string
	Env             []corev1.EnvVar
	Ports           []corev1.ContainerPort
	VolumeMounts    []corev1.VolumeMount
	WorkingDir      string
}

// ResourceRequirements represents resource requirements for a preset
type ResourceRequirements struct {
	Requests corev1.ResourceList
	Limits   corev1.ResourceList
}

// PresetInfo represents a preset template
type PresetInfo struct {
	PresetID       string
	Name           string
	Description    string
	Version        string
	Template       PresetTemplate
	Resources      ResourceRequirements
	DeploymentName string
	BaseReplicas   int32
	ActiveComputes []string
	CreatedAt      time.Time
	UpdatedAt      time.Time
	Labels         map[string]string
	Annotations    map[string]string
}

// PresetSpec represents the specification for creating a preset
type PresetSpec struct {
	PresetID    string
	Name        string
	Description string
	Version     string
	Template    PresetTemplate
	Resources   ResourceRequirements
	Labels      map[string]string
	Annotations map[string]string
}

// PresetFilters represents filters for listing presets
type PresetFilters struct {
	Name    string
	Version string
	Labels  map[string]string
}

// DeploymentStatus represents the status of a preset's deployment
type DeploymentStatus struct {
	Replicas          int32
	ReadyReplicas     int32
	AvailableReplicas int32
	UpdatedReplicas   int32
	Conditions        []appsv1.DeploymentCondition
}

// ManagerConfig represents configuration for managers
type ManagerConfig struct {
	Namespace string
	Logger    Logger
}

// Logger interface for manager logging
type Logger interface {
	Printf(format string, v ...any)
	Errorf(format string, v ...any)
	Infof(format string, v ...any)
	Debugf(format string, v ...any)
}

// NewResourceList Helper functions for resource management
func NewResourceList(cpu, memory string) corev1.ResourceList {
	resources := corev1.ResourceList{}
	if cpu != "" {
		resources[corev1.ResourceCPU] = resource.MustParse(cpu)
	}
	if memory != "" {
		resources[corev1.ResourceMemory] = resource.MustParse(memory)
	}
	return resources
}

// DeploymentNameFromPresetID Helper function to generate deployment name from preset ID
func DeploymentNameFromPresetID(presetID string) string {
	return "preset-" + presetID
}

// ComputeLabels Helper function to generate compute labels
func ComputeLabels(computeID, presetID string) map[string]string {
	return map[string]string{
		"app":       "compute",
		"computeId": computeID,
		"presetId":  presetID,
	}
}

// PresetLabels Helper function to generate preset labels
func PresetLabels(presetID string) map[string]string {
	return map[string]string{
		"app":      "preset",
		"presetId": presetID,
	}
}
