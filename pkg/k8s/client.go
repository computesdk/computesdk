// Package client provides a simplified interface for interacting with Kubernetes resources
// like Pods and Deployments. It wraps the standard client-go library to offer
// consistent context handling, error management, and default namespace logic.
package client

import (
	"context"
	"fmt"
	"time"

	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

// KubernetesClient is the interface your app will use
type KubernetesClient interface {
	// Base client access
	Clientset() kubernetes.Interface

	// Pod operations
	PodOperations

	// Deployment operations
	DeploymentOperations

	// Namespace for operations
	Namespace() string
}

// DefaultKubernetesClient is the concrete implementation
type DefaultKubernetesClient struct {
	clientset kubernetes.Interface
	namespace string        // Default namespace for operations
	timeout   time.Duration // Default timeout for operations
}

// Common errors
var (
	ErrPodNotFound = fmt.Errorf("pod not found")
	ErrPodNotReady = fmt.Errorf("pod not ready")
	ErrTimeout     = fmt.Errorf("operation timed out")
)

func (d *DefaultKubernetesClient) Clientset() kubernetes.Interface {
	return d.clientset
}

func (d *DefaultKubernetesClient) Namespace() string {
	return d.namespace
}

// ensureContextTimeout takes a context and returns a new context derived
// from it with the client's default timeout, if the original context
// was nil or did not have a deadline set. It also returns the cancel function
// for the derived context, which the caller *must* defer. If the original
// context already had a deadline, it's returned unmodified with a nil cancel func.
func (c *DefaultKubernetesClient) ensureContextTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	if ctx == nil {
		// Create a new context with timeout if none provided
		return context.WithTimeout(context.Background(), c.timeout)
	}
	if _, deadlineSet := ctx.Deadline(); !deadlineSet {
		// Derive a context with timeout if the provided one lacks a deadline
		return context.WithTimeout(ctx, c.timeout)
	}
	// Return the original context and nil cancel func if it already has a deadline
	return ctx, nil
}

// NewKubernetesClient creates a KubernetesClient from either:
// - A provided kubernetes.Interface (for testing)
// - A kubeconfig file path
// - In-cluster config if no path is provided
func NewKubernetesClient(kubeConfigPathOrClientset interface{}, namespace string) (KubernetesClient, error) {
	// Default namespace if not provided
	if namespace == "" {
		namespace = "default"
	}

	// Default client with reasonable timeout
	client := &DefaultKubernetesClient{
		namespace: namespace,
		timeout:   30 * time.Second, // Reasonable default timeout
	}

	// If we're passed a clientset directly, use it (testing case)
	if clientset, ok := kubeConfigPathOrClientset.(kubernetes.Interface); ok {
		client.clientset = clientset
		return client, nil
	}

	// Otherwise, treat the input as a kubeconfig path
	var kubeConfigPath string
	if path, ok := kubeConfigPathOrClientset.(string); ok {
		kubeConfigPath = path
	}

	// Create config from either kubeconfig or in-cluster
	var config *rest.Config
	var err error

	if kubeConfigPath == "" {
		config, err = rest.InClusterConfig()
		if err != nil {
			return nil, fmt.Errorf("failed to create in-cluster config: %v", err)
		}
	} else {
		config, err = clientcmd.BuildConfigFromFlags("", kubeConfigPath)
		if err != nil {
			return nil, fmt.Errorf("failed to build config from kubeconfig: %v", err)
		}
	}

	// Create the clientset
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create clientset: %v", err)
	}

	client.clientset = clientset
	return client, nil
}

// // GetPod retrieves a pod by name from the specified namespace
// func (d *DefaultKubernetesClient) GetPod(ctx context.Context, namespace, name string) (*corev1.Pod, error) {
// 	if namespace == "" {
// 		namespace = d.namespace
// 	}

// 	// Use the provided context or create one with default timeout
// 	if ctx == nil {
// 		var cancel context.CancelFunc
// 		ctx, cancel = context.WithTimeout(context.Background(), d.timeout)
// 		defer cancel()
// 	}

// 	pod, err := d.clientset.CoreV1().Pods(namespace).Get(ctx, name, metav1.GetOptions{})
// 	if err != nil {
// 		return nil, fmt.Errorf("error getting pod %s in namespace %s: %w", name, namespace, err)
// 	}
// 	return pod, nil
// }
