// Package managers is all about manage k8s
package managers

import (
	"context"
	"fmt"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"

	"github.com/heysnelling/computesdk/pkg/common"
	"github.com/heysnelling/computesdk/pkg/k8s"
)

// ComputeManager interface defines operations for managing compute instances
type ComputeManager interface {
	// Core CRUD operations
	CreateCompute(ctx context.Context, spec ComputeSpec) (*ComputeInfo, error)
	GetCompute(ctx context.Context, computeID string) (*ComputeInfo, error)
	ListComputes(ctx context.Context, filters ComputeFilters) ([]*ComputeInfo, error)
	DeleteCompute(ctx context.Context, computeID string) error

	// Status and lifecycle
	GetComputeStatus(ctx context.Context, computeID string) (*ComputeStatus, error)
	WaitForComputeReady(ctx context.Context, computeID string, timeout time.Duration) (*ComputeInfo, error)

	// Management operations
	RestartCompute(ctx context.Context, computeID string) error
}

// DefaultComputeManager implements ComputeManager
type DefaultComputeManager struct {
	podOps        k8s.PodOperations
	deploymentOps k8s.DeploymentOperations
	presetMgr     PresetManager
	namespace     string
	logger        Logger

	// Cache for compute instances
	computeCache map[string]*ComputeInfo
	cacheMutex   sync.RWMutex
}

// NewComputeManager creates a new ComputeManager
func NewComputeManager(podOps k8s.PodOperations, deploymentOps k8s.DeploymentOperations, presetMgr PresetManager, config ManagerConfig) ComputeManager {
	cm := &DefaultComputeManager{
		podOps:        podOps,
		deploymentOps: deploymentOps,
		presetMgr:     presetMgr,
		namespace:     config.Namespace,
		logger:        config.Logger,
		computeCache:  make(map[string]*ComputeInfo),
	}

	// Start background cache refresh
	go cm.refreshCachePeriodically()

	return cm
}

// CreateCompute creates a new compute instance by scaling the preset deployment
func (cm *DefaultComputeManager) CreateCompute(ctx context.Context, spec ComputeSpec) (*ComputeInfo, error) {
	// Generate compute ID if not provided
	if spec.ComputeID == "" {
		spec.ComputeID = common.GeneratePrefixedID("compute")
	}

	// Validate spec
	if err := cm.validateComputeSpec(spec); err != nil {
		return nil, fmt.Errorf("invalid compute spec: %w", err)
	}

	// Ensure preset deployment exists
	deployment, err := cm.presetMgr.EnsurePresetDeployment(ctx, spec.PresetID)
	if err != nil {
		return nil, fmt.Errorf("failed to ensure preset deployment: %w", err)
	}

	// Scale deployment +1
	currentReplicas := int32(0)
	if deployment.Spec.Replicas != nil {
		currentReplicas = *deployment.Spec.Replicas
	}
	newReplicas := currentReplicas + 1

	err = cm.deploymentOps.ScaleDeployment(ctx, cm.namespace, deployment.Name, newReplicas)
	if err != nil {
		return nil, fmt.Errorf("failed to scale deployment %s: %w", deployment.Name, err)
	}

	// Wait for new pod to be created and assign it to this compute
	computeInfo, err := cm.waitForNewComputePod(ctx, spec)
	if err != nil {
		// Rollback: scale back down
		cm.deploymentOps.ScaleDeployment(ctx, cm.namespace, deployment.Name, currentReplicas)
		return nil, fmt.Errorf("failed to create compute pod: %w", err)
	}

	// Cache the compute info
	cm.cacheMutex.Lock()
	cm.computeCache[spec.ComputeID] = computeInfo
	cm.cacheMutex.Unlock()

	cm.logger.Infof("Created compute %s from preset %s", spec.ComputeID, spec.PresetID)
	return computeInfo, nil
}

// GetCompute retrieves a compute instance by ID
func (cm *DefaultComputeManager) GetCompute(ctx context.Context, computeID string) (*ComputeInfo, error) {
	// Try cache first
	cm.cacheMutex.RLock()
	cached, exists := cm.computeCache[computeID]
	cm.cacheMutex.RUnlock()

	if exists && cached != nil {
		return cached, nil
	}

	// Cache miss, query Kubernetes API
	return cm.fetchComputeByID(ctx, computeID)
}

// ListComputes lists compute instances based on filters
func (cm *DefaultComputeManager) ListComputes(ctx context.Context, filters ComputeFilters) ([]*ComputeInfo, error) {
	labelSelector := ComputeLabels("", "")
	if filters.PresetID != "" {
		labelSelector["presetId"] = filters.PresetID
	}
	if filters.Labels != nil {
		for k, v := range filters.Labels {
			labelSelector[k] = v
		}
	}

	podList, err := cm.podOps.ListPods(ctx, cm.namespace, labelSelector)
	if err != nil {
		return nil, fmt.Errorf("failed to list compute pods: %w", err)
	}

	var computes []*ComputeInfo
	for _, pod := range podList.Items {
		computeInfo := cm.buildComputeInfoFromPod(&pod)
		if computeInfo == nil {
			continue // Skip pods without proper compute labels
		}

		// Apply phase filter
		if filters.Phase != "" && computeInfo.Status.Phase != filters.Phase {
			continue
		}

		computes = append(computes, computeInfo)

		// Update cache
		cm.cacheMutex.Lock()
		cm.computeCache[computeInfo.ComputeID] = computeInfo
		cm.cacheMutex.Unlock()
	}

	return computes, nil
}

// DeleteCompute deletes a compute instance by scaling down the deployment
func (cm *DefaultComputeManager) DeleteCompute(ctx context.Context, computeID string) error {
	// Get compute info
	compute, err := cm.GetCompute(ctx, computeID)
	if err != nil {
		return fmt.Errorf("compute %s not found: %w", computeID, err)
	}

	// Delete the specific pod
	err = cm.podOps.DeletePod(ctx, cm.namespace, compute.PodName)
	if err != nil {
		return fmt.Errorf("failed to delete pod %s: %w", compute.PodName, err)
	}

	// Scale deployment -1
	deployment, err := cm.deploymentOps.GetDeployment(ctx, cm.namespace, compute.DeploymentName)
	if err != nil {
		return fmt.Errorf("failed to get deployment %s: %w", compute.DeploymentName, err)
	}

	currentReplicas := int32(0)
	if deployment.Spec.Replicas != nil {
		currentReplicas = *deployment.Spec.Replicas
	}

	if currentReplicas > 0 {
		newReplicas := currentReplicas - 1
		err = cm.deploymentOps.ScaleDeployment(ctx, cm.namespace, compute.DeploymentName, newReplicas)
		if err != nil {
			return fmt.Errorf("failed to scale down deployment %s: %w", compute.DeploymentName, err)
		}
	}

	// Remove from cache
	cm.cacheMutex.Lock()
	delete(cm.computeCache, computeID)
	cm.cacheMutex.Unlock()

	cm.logger.Infof("Deleted compute %s", computeID)
	return nil
}

// GetComputeStatus gets the status of a compute instance
func (cm *DefaultComputeManager) GetComputeStatus(ctx context.Context, computeID string) (*ComputeStatus, error) {
	compute, err := cm.GetCompute(ctx, computeID)
	if err != nil {
		return nil, err
	}
	return &compute.Status, nil
}

// WaitForComputeReady waits for a compute instance to become ready
func (cm *DefaultComputeManager) WaitForComputeReady(ctx context.Context, computeID string, timeout time.Duration) (*ComputeInfo, error) {
	compute, err := cm.GetCompute(ctx, computeID)
	if err != nil {
		return nil, err
	}

	// Wait for the pod to be ready
	_, err = cm.podOps.WaitForPodReady(ctx, cm.namespace, compute.PodName, timeout)
	if err != nil {
		return nil, fmt.Errorf("compute %s did not become ready: %w", computeID, err)
	}

	// Return updated compute info
	return cm.GetCompute(ctx, computeID)
}

// RestartCompute restarts a compute instance by deleting its pod
func (cm *DefaultComputeManager) RestartCompute(ctx context.Context, computeID string) error {
	compute, err := cm.GetCompute(ctx, computeID)
	if err != nil {
		return fmt.Errorf("compute %s not found: %w", computeID, err)
	}

	// Delete the pod - deployment controller will recreate it
	err = cm.podOps.DeletePod(ctx, cm.namespace, compute.PodName)
	if err != nil {
		return fmt.Errorf("failed to restart compute %s: %w", computeID, err)
	}

	// Remove from cache so it gets refreshed
	cm.cacheMutex.Lock()
	delete(cm.computeCache, computeID)
	cm.cacheMutex.Unlock()

	cm.logger.Infof("Restarted compute %s", computeID)
	return nil
}

// Helper methods

func (cm *DefaultComputeManager) validateComputeSpec(spec ComputeSpec) error {
	if spec.PresetID == "" {
		return fmt.Errorf("preset ID is required")
	}
	if spec.ComputeID == "" {
		return fmt.Errorf("compute ID is required")
	}
	return nil
}

func (cm *DefaultComputeManager) waitForNewComputePod(ctx context.Context, spec ComputeSpec) (*ComputeInfo, error) {
	// Wait for a new pod with the compute ID label to appear
	timeout := 60 * time.Second
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	timeoutCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	for {
		select {
		case <-timeoutCtx.Done():
			return nil, fmt.Errorf("timeout waiting for compute pod to be created")
		case <-ticker.C:
			// Look for a pod with our compute ID
			labelSelector := ComputeLabels(spec.ComputeID, spec.PresetID)
			pods, err := cm.podOps.ListPods(ctx, cm.namespace, labelSelector)
			if err != nil {
				continue
			}

			if len(pods.Items) > 0 {
				// Found our pod, build compute info
				pod := &pods.Items[0]

				// Update pod labels to include compute ID if not already set
				if pod.Labels["computeId"] != spec.ComputeID {
					if pod.Labels == nil {
						pod.Labels = make(map[string]string)
					}
					pod.Labels["computeId"] = spec.ComputeID

					// Update the pod
					_, err = cm.podOps.UpdatePod(ctx, cm.namespace, pod)
					if err != nil {
						cm.logger.Errorf("Failed to update pod labels: %v", err)
					}
				}

				return cm.buildComputeInfoFromPod(pod), nil
			}
		}
	}
}

func (cm *DefaultComputeManager) fetchComputeByID(ctx context.Context, computeID string) (*ComputeInfo, error) {
	labelSelector := map[string]string{"computeId": computeID}
	pod, err := cm.podOps.GetPodByLabel(ctx, cm.namespace, labelSelector)
	if err != nil {
		return nil, fmt.Errorf("compute %s not found: %w", computeID, err)
	}

	computeInfo := cm.buildComputeInfoFromPod(pod)
	if computeInfo == nil {
		return nil, fmt.Errorf("compute %s not found", computeID)
	}

	// Update cache
	cm.cacheMutex.Lock()
	cm.computeCache[computeID] = computeInfo
	cm.cacheMutex.Unlock()

	return computeInfo, nil
}

func (cm *DefaultComputeManager) buildComputeInfoFromPod(pod *corev1.Pod) *ComputeInfo {
	computeID := pod.Labels["computeId"]
	presetID := pod.Labels["presetId"]

	if computeID == "" || presetID == "" {
		return nil // Not a valid compute pod
	}

	// Determine compute phase from pod phase
	var computePhase ComputePhase
	switch pod.Status.Phase {
	case corev1.PodPending:
		computePhase = ComputePhasePending
	case corev1.PodRunning:
		computePhase = ComputePhaseRunning
	case corev1.PodSucceeded:
		computePhase = ComputePhaseSucceeded
	case corev1.PodFailed:
		computePhase = ComputePhaseFailed
	default:
		computePhase = ComputePhasePending
	}

	// Check if pod is ready
	isReady := false
	for _, condition := range pod.Status.Conditions {
		if condition.Type == corev1.PodReady && condition.Status == corev1.ConditionTrue {
			isReady = true
			break
		}
	}

	// Build port map
	portMap := make(map[string]int32)
	for _, container := range pod.Spec.Containers {
		for _, port := range container.Ports {
			if port.Name != "" {
				portMap[port.Name] = port.ContainerPort
			} else {
				portMap[fmt.Sprintf("port-%d", port.ContainerPort)] = port.ContainerPort
			}
		}
	}

	// Build resource info
	var resources ComputeResources
	if len(pod.Spec.Containers) > 0 {
		container := pod.Spec.Containers[0]
		resources = ComputeResources{
			Requests: container.Resources.Requests,
			Limits:   container.Resources.Limits,
		}
	}

	// Build conditions
	var conditions []ComputeCondition
	for _, condition := range pod.Status.Conditions {
		conditions = append(conditions, ComputeCondition{
			Type:               string(condition.Type),
			Status:             condition.Status,
			LastTransitionTime: condition.LastTransitionTime.Time,
			Reason:             condition.Reason,
			Message:            condition.Message,
		})
	}

	return &ComputeInfo{
		ComputeID:      computeID,
		Name:           pod.Name,
		PresetID:       presetID,
		DeploymentName: DeploymentNameFromPresetID(presetID),
		PodName:        pod.Name,
		Status: ComputeStatus{
			Phase:      computePhase,
			IsReady:    isReady,
			Message:    pod.Status.Message,
			Conditions: conditions,
		},
		Resources: resources,
		Network: ComputeNetwork{
			PodIP:  pod.Status.PodIP,
			HostIP: pod.Status.HostIP,
			Ports:  portMap,
		},
		CreatedAt:   pod.CreationTimestamp.Time,
		UpdatedAt:   pod.CreationTimestamp.Time, // TODO: Track actual updates
		Labels:      pod.Labels,
		Annotations: pod.Annotations,
	}
}

func (cm *DefaultComputeManager) refreshCachePeriodically() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		// Refresh cache by listing all computes
		_, err := cm.ListComputes(context.Background(), ComputeFilters{})
		if err != nil {
			cm.logger.Errorf("Error refreshing compute cache: %v", err)
		}
	}
}
