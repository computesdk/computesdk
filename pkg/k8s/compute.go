package client

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// PodInfo holds extracted information about a Kubernetes pod relevant to the gateway
// This type is now central to Kubernetes operations within the application.
type PodInfo struct {
	Name        string
	IP          string
	ComputeID   string
	Phase       corev1.PodPhase
	IsReady     bool
	HostIP      string
	StartTime   *metav1.Time
	Labels      map[string]string
	Annotations map[string]string
	PortMap     map[string]int32 // Map of port names to port numbers
}

// ComputeManagerInterface defines methods for managing compute pods
// Deprecated: This interface is being phased out. Prefer direct use of k8s.PodOperations where possible.
type ComputeManagerInterface interface {
	// GetPod retrieves information about a specific pod by its compute ID.
	// It returns a PodInfo struct and an error if the pod is not found or another error occurs.
	GetPod(ctx context.Context, computeID string) (*PodInfo, error)

	// ListPods lists all compute pods
	// It returns a slice of PodInfo structs and an error if the listing fails.
	ListPods() ([]*PodInfo, error)

	// DeletePod deletes a compute pod by its compute ID.
	// It returns an error if the deletion fails.
	DeletePod(ctx context.Context, computeID string) error
}

// ComputeManager handles pod lifecycle and tracking
type ComputeManager struct {
	k8sClient PodOperations // Assumes PodOperations is defined in this pkg/k8s/
	podCache  map[string]*PodInfo
	mutex     sync.RWMutex
	namespace string
}

// NewComputeManager creates a new compute manager
func NewComputeManager(k8sClient PodOperations, namespace string) *ComputeManager {
	cm := &ComputeManager{
		k8sClient: k8sClient,
		podCache:  make(map[string]*PodInfo),
		namespace: namespace,
	}

	// Start background pod cache refresh
	go cm.refreshPodCachePeriodically()

	return cm
}

// GetPod gets pod information by compute ID
func (cm *ComputeManager) GetPod(ctx context.Context, computeID string) (*PodInfo, error) {
	// Try cache first
	cm.mutex.RLock()
	pod, exists := cm.podCache[computeID]
	cm.mutex.RUnlock()

	if exists && pod != nil {
		return pod, nil
	}

	// Cache miss, query Kubernetes API using the k8sClient
	return cm.fetchPodByComputeID(ctx, computeID)
}

// ListPods lists all compute pods
func (cm *ComputeManager) ListPods() ([]*PodInfo, error) {
	// Define the label selector for compute pods
	labelSelector := map[string]string{"app": "compute"}

	podsList, err := cm.k8sClient.ListPods(context.Background(), cm.namespace, labelSelector)
	if err != nil {
		return nil, fmt.Errorf("failed to list pods from Kubernetes API: %w", err)
	}

	var podInfos []*PodInfo
	for _, pod := range podsList.Items { // Iterate over podsList.Items
		computeID, exists := pod.Labels["computeId"]
		if !exists || computeID == "" { // Check for existence AND non-empty value
			log.Printf("Warning: Pod %s in namespace %s has 'app=compute' label but is missing or has an empty 'computeId' label. Skipping.", pod.Name, pod.Namespace)
			continue
		}

		isReady := IsPodReady(&pod)
		// Extract port information
		portMap := make(map[string]int32)
		for _, container := range pod.Spec.Containers {
			for _, port := range container.Ports {
				if port.Name != "" {
					portMap[port.Name] = port.ContainerPort
				} else {
					// If port name is empty, use a default key or skip
					// For now, using a default key like 'default_port_idx'
					portMap[fmt.Sprintf("default_port_%d", port.ContainerPort)] = port.ContainerPort
				}
			}
		}

		podInfo := &PodInfo{
			Name:        pod.Name,
			IP:          pod.Status.PodIP,
			ComputeID:   computeID,
			Phase:       pod.Status.Phase,
			IsReady:     isReady,
			HostIP:      pod.Status.HostIP,
			StartTime:   pod.Status.StartTime,
			Labels:      pod.Labels,
			Annotations: pod.Annotations,
			PortMap:     portMap,
		}

		podInfos = append(podInfos, podInfo)

		// Update cache
		cm.mutex.Lock()
		cm.podCache[computeID] = podInfo
		cm.mutex.Unlock()
	}

	return podInfos, nil
}

// DeletePod deletes a compute pod by its compute ID
func (cm *ComputeManager) DeletePod(ctx context.Context, computeID string) error {
	podInfo, err := cm.GetPod(ctx, computeID)
	if err != nil {
		return fmt.Errorf("failed to get pod info for compute ID %s before deletion: %w", computeID, err)
	}

	log.Printf("Attempting to delete pod %s for compute ID %s", podInfo.Name, computeID)
	err = cm.k8sClient.DeletePod(ctx, cm.namespace, podInfo.Name)
	if err != nil {
		return fmt.Errorf("failed to delete pod %s: %w", podInfo.Name, err)
	}

	cm.mutex.Lock()
	delete(cm.podCache, computeID)
	cm.mutex.Unlock()

	log.Printf("Successfully deleted pod %s for compute ID %s and removed from cache", podInfo.Name, computeID)
	return nil
}

// fetchPodByComputeID fetches a pod by compute ID and updates the cache
func (cm *ComputeManager) fetchPodByComputeID(ctx context.Context, computeID string) (*PodInfo, error) {
	labelSelector := map[string]string{"computeId": computeID}
	k8sPod, err := cm.k8sClient.GetPodByLabel(ctx, cm.namespace, labelSelector)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch pod from Kubernetes API for computeID %s: %w", computeID, err)
	}

	if k8sPod == nil { // Should be redundant if GetPodByLabel errors on not found
		return nil, fmt.Errorf("no pod found for computeID %s", computeID)
	}

	isReady := IsPodReady(k8sPod)
	// Extract port information
	portMap := make(map[string]int32)
	for _, container := range k8sPod.Spec.Containers {
		for _, port := range container.Ports {
			if port.Name != "" {
				portMap[port.Name] = port.ContainerPort
			} else {
				portMap[fmt.Sprintf("default_port_%d", port.ContainerPort)] = port.ContainerPort
			}
		}
	}

	podInfo := &PodInfo{
		Name:        k8sPod.Name,
		IP:          k8sPod.Status.PodIP,
		ComputeID:   computeID,
		Phase:       k8sPod.Status.Phase,
		IsReady:     isReady,
		HostIP:      k8sPod.Status.HostIP,
		StartTime:   k8sPod.Status.StartTime,
		Labels:      k8sPod.Labels,
		Annotations: k8sPod.Annotations,
		PortMap:     portMap,
	}

	cm.mutex.Lock()
	cm.podCache[computeID] = podInfo
	cm.mutex.Unlock()

	return podInfo, nil
}

// refreshPodCachePeriodically refreshes the pod cache every 30 seconds
func (cm *ComputeManager) refreshPodCachePeriodically() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		_, err := cm.ListPods() // ListPods already updates the cache
		if err != nil {
			log.Printf("Error refreshing pod cache: %v", err)
			continue
		}
	}
}

// IsPodReady checks if a Pod is ready based on its conditions.
// It is an exported helper function.
func IsPodReady(pod *corev1.Pod) bool {
	if pod == nil {
		return false
	}
	for _, condition := range pod.Status.Conditions {
		if condition.Type == corev1.PodReady && condition.Status == corev1.ConditionTrue {
			return true
		}
	}
	return false
}
