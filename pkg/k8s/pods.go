package client

import (
	"context"
	"fmt"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
)

// PodOperations defines all pod-related operations
type PodOperations interface {
	GetPod(ctx context.Context, namespace, name string) (*corev1.Pod, error)
	ListPods(ctx context.Context, namespace string, labelSelectorMap map[string]string) (*corev1.PodList, error)
	WaitForPodReady(ctx context.Context, namespace, name string, timeout time.Duration) (*corev1.Pod, error)
	CreatePod(ctx context.Context, namespace string, pod *corev1.Pod) (*corev1.Pod, error)
	UpdatePod(ctx context.Context, namespace string, pod *corev1.Pod) (*corev1.Pod, error)
	DeletePod(ctx context.Context, namespace, name string) error
	DeletePodsByLabel(ctx context.Context, namespace string, labelSelectorMap map[string]string) error
	GetPodByLabel(ctx context.Context, namespace string, labelSelectorMap map[string]string) (*corev1.Pod, error)
}

// GetPod retrieves a specific Pod by its name within the given namespace.
// If the namespace is empty, it defaults to the client's configured default namespace.
// It ensures context deadlines are respected and returns a standard Kubernetes Pod object
// or an error if the pod is not found or another API error occurs.
func (c *DefaultKubernetesClient) GetPod(ctx context.Context, namespace, name string) (*corev1.Pod, error) {
	if namespace == "" {
		namespace = c.namespace
	}

	ctx, cancel := c.ensureContextTimeout(ctx)
	if cancel != nil {
		defer cancel()
	}

	pod, err := c.clientset.CoreV1().Pods(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		if errors.IsNotFound(err) {
			return nil, fmt.Errorf("pod %s not found in namespace %s: %w", name, namespace, err)
		}
		return nil, fmt.Errorf("error getting pod %s in namespace %s: %w", name, namespace, err)
	}
	return pod, nil
}

// ListPods retrieves pods from the specified namespace with optional label selectors
func (c *DefaultKubernetesClient) ListPods(ctx context.Context, namespace string, labelSelectorMap map[string]string) (*corev1.PodList, error) {
	if ctx == nil { // Should ideally not happen if called from other client methods
		ctx = context.Background()
	}
	// Check if context is already done (e.g., cancelled or deadline exceeded)
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("context error before listing pods: %w", err)
	}

	if namespace == "" {
		namespace = c.namespace
	}

	ctxToList, cancel := c.ensureContextTimeout(ctx) // Rename to avoid confusion with outer ctx
	if cancel != nil {
		defer cancel()
	}

	options := metav1.ListOptions{}
	if len(labelSelectorMap) > 0 { // Check if there are any labels to select by
		options.LabelSelector = labels.SelectorFromSet(labelSelectorMap).String()
	}

	pods, err := c.clientset.CoreV1().Pods(namespace).List(ctxToList, options)
	if err != nil {
		return nil, fmt.Errorf("error listing pods in namespace %s: %w", namespace, err)
	}
	return pods, nil
}

// WaitForPodReady waits for a pod to become ready
func (c *DefaultKubernetesClient) WaitForPodReady(ctx context.Context, namespace, name string, timeout time.Duration) (*corev1.Pod, error) {
	if namespace == "" {
		namespace = c.namespace
	}

	// Use the provided context for the overall wait operation deadline
	// If the provided context has no deadline, create one for the *wait* operation.
	// Note: We don't use ensureContextTimeout here directly because this function manages
	// its own overall timeout distinct from individual GetPod calls.
	waitCtx := ctx
	var waitCancel context.CancelFunc
	if _, deadlineSet := ctx.Deadline(); !deadlineSet {
		if timeout <= 0 {
			timeout = c.timeout // Use client default if timeout param is zero or negative
		}
		waitCtx, waitCancel = context.WithTimeout(ctx, timeout)
		defer waitCancel()
	} else {
		// If the parent context already has a deadline, respect it.
		// We might optionally want to check if the provided timeout param is shorter
		// and create an even shorter deadline, but respecting the parent is usually safer.
	}

	// Poll every second until timeout
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-waitCtx.Done(): // Check the deadline of the wait context
			// Provide context error if available (e.g., Canceled or DeadlineExceeded)
			err := waitCtx.Err()
			baseMsg := fmt.Sprintf("timeout or context canceled waiting for pod %s in namespace %s to become ready", name, namespace)
			return nil, fmt.Errorf("%s: %w", baseMsg, err)
		case <-ticker.C:
			// Use the *original* provided context (or background if nil) for the GetPod call itself.
			// The GetPod call will apply its *own* short-term timeout via ensureContextTimeout.
			// Pass the *original* context `ctx` here, not `waitCtx`.
			pod, err := c.GetPod(ctx, namespace, name)
			if err != nil {
				// If pod not found, keep waiting until timeout
				if errors.IsNotFound(err) {
					continue
				}
				return nil, fmt.Errorf("error getting pod %s in namespace %s during wait: %w", name, namespace, err) // Propagate other errors
			}

			// Check if pod is ready
			for _, condition := range pod.Status.Conditions {
				if condition.Type == corev1.PodReady && condition.Status == corev1.ConditionTrue {
					return pod, nil // Pod is ready
				}
			}
		}
	}
}

// CreatePod creates a new pod in the specified namespace.
func (c *DefaultKubernetesClient) CreatePod(ctx context.Context, namespace string, pod *corev1.Pod) (*corev1.Pod, error) {
	if namespace == "" {
		namespace = c.namespace
	}
	if pod.Namespace != "" && pod.Namespace != namespace {
		return nil, fmt.Errorf("pod namespace '%s' does not match argument namespace '%s'", pod.Namespace, namespace)
	}
	pod.Namespace = namespace // Ensure namespace is set correctly

	ctx, cancel := c.ensureContextTimeout(ctx)
	if cancel != nil {
		defer cancel()
	}

	createdPod, err := c.clientset.CoreV1().Pods(namespace).Create(ctx, pod, metav1.CreateOptions{})
	if err != nil {
		return nil, fmt.Errorf("error creating pod %s in namespace %s: %w", pod.Name, namespace, err)
	}
	return createdPod, nil
}

// UpdatePod updates an existing pod in the specified namespace.
// Note: Many fields of a Pod are immutable once created. This operation
// is typically used for updating labels, annotations, or specific mutable fields.
func (c *DefaultKubernetesClient) UpdatePod(ctx context.Context, namespace string, pod *corev1.Pod) (*corev1.Pod, error) {
	if namespace == "" {
		namespace = c.namespace
	}
	// Ensure namespace consistency. The pod object must have its Name and Namespace fields
	// correctly set to identify the resource to update.
	if pod.Namespace != "" && pod.Namespace != namespace {
		return nil, fmt.Errorf("pod namespace '%s' does not match argument namespace '%s'", pod.Namespace, namespace)
	}
	pod.Namespace = namespace // Ensure namespace is set correctly

	ctx, cancel := c.ensureContextTimeout(ctx)
	if cancel != nil {
		defer cancel()
	}

	updatedPod, err := c.clientset.CoreV1().Pods(namespace).Update(ctx, pod, metav1.UpdateOptions{})
	if err != nil {
		return nil, fmt.Errorf("error updating pod %s in namespace %s: %w", pod.Name, namespace, err)
	}
	return updatedPod, nil
}

// DeletePod deletes an existing pod in the specified namespace by name.
// If the pod does not exist, it returns nil (idempotent).
func (c *DefaultKubernetesClient) DeletePod(ctx context.Context, namespace, name string) error {
	if namespace == "" {
		namespace = c.namespace
	}
	ctx, cancel := c.ensureContextTimeout(ctx)
	if cancel != nil {
		defer cancel()
	}

	err := c.clientset.CoreV1().Pods(namespace).Delete(ctx, name, metav1.DeleteOptions{})
	if errors.IsNotFound(err) {
		return nil // Consider it successfully deleted if it's already gone.
	}
	if err != nil {
		return fmt.Errorf("error deleting pod %s in namespace %s: %w", name, namespace, err)
	}
	return nil
}

// DeletePodsByLabel deletes all Pods within a given namespace that match the specified
// label selector.
// If the namespace is empty, it defaults to the client's configured default namespace.
// A non-empty labelSelectorMap is required to prevent accidental deletion of all pods.
// It uses the DeleteCollection API for efficient batch deletion with a foreground propagation policy.
// It returns an error if the label selector is empty or if an API error occurs during deletion.
// Note: Deleting from a non-existent namespace does not return an error.
func (c *DefaultKubernetesClient) DeletePodsByLabel(ctx context.Context, namespace string, labelSelectorMap map[string]string) error {
	if namespace == "" {
		namespace = c.namespace
	}

	ctx, cancel := c.ensureContextTimeout(ctx)
	if cancel != nil {
		defer cancel()
	}

	if len(labelSelectorMap) == 0 {
		return fmt.Errorf("DeletePodsByLabel requires a non-empty label selector to prevent accidental deletion of all pods in namespace '%s'", namespace)
	}

	selectorString := labels.SelectorFromSet(labelSelectorMap).String()
	listOptions := metav1.ListOptions{
		LabelSelector: selectorString,
	}

	// Use DeleteCollection for potentially more efficient batch deletion.
	// Set PropagationPolicy to Foreground to ensure dependents are deleted first.
	deletePolicy := metav1.DeletePropagationForeground
	deleteOptions := metav1.DeleteOptions{
		PropagationPolicy: &deletePolicy,
	}

	err := c.clientset.CoreV1().Pods(namespace).DeleteCollection(ctx, deleteOptions, listOptions)
	if err != nil {
		// Check if the error is because no pods were found (which isn't necessarily an error in this context)
		// However, DeleteCollection might not return IsNotFound in the same way as List/Get followed by Delete.
		// We'll log the error but proceed, assuming the goal is to ensure no pods matching the selector exist.
		// More robust error handling might be needed depending on specific requirements.
		// For now, return the error directly.
		return fmt.Errorf("error deleting pod collection in namespace %s with selector %s: %w", namespace, selectorString, err)
	}

	// DeleteCollection succeeded (or potentially returned no error if nothing matched).
	return nil
}

// GetPodByLabel retrieves the first pod that matches the given label selector in the specified namespace.
// If no pod matches the selector, it returns an error indicating that the pod was not found.
func (c *DefaultKubernetesClient) GetPodByLabel(ctx context.Context, namespace string, labelSelectorMap map[string]string) (*corev1.Pod, error) {
	if namespace == "" {
		namespace = c.namespace
	}

	if len(labelSelectorMap) == 0 {
		return nil, fmt.Errorf("GetPodByLabel requires a non-empty label selector")
	}

	// Use the existing ListPods to find matching pods.
	// ensureContextTimeout will be handled by ListPods.
	podList, err := c.ListPods(ctx, namespace, labelSelectorMap)
	if err != nil {
		return nil, fmt.Errorf("error listing pods with labels %v in namespace %s: %w", labelSelectorMap, namespace, err)
	}

	if len(podList.Items) == 0 {
		return nil, fmt.Errorf("no pod found with labels %v in namespace %s", labelSelectorMap, namespace)
	}

	// Return the first pod found.
	return &podList.Items[0], nil
}

// Ensure DefaultKubernetesClient implements PodOperations
