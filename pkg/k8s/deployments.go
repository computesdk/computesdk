package client

import (
	"context"
	"fmt"

	appsv1 "k8s.io/api/apps/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
)

// DeploymentOperations defines all deployment-related operations
type DeploymentOperations interface {
	GetDeployment(ctx context.Context, namespace, name string) (*appsv1.Deployment, error)
	ListDeployments(ctx context.Context, namespace string, labelSelector map[string]string) (*appsv1.DeploymentList, error)
	CreateDeployment(ctx context.Context, namespace string, deployment *appsv1.Deployment) (*appsv1.Deployment, error)
	UpdateDeployment(ctx context.Context, namespace string, deployment *appsv1.Deployment) (*appsv1.Deployment, error)
	DeleteDeployment(ctx context.Context, namespace, name string) error
	// Future methods: etc.
}

// GetDeployment retrieves a specific Deployment by its name within the given namespace.
// If the namespace is empty, it defaults to the client's configured default namespace.
// It ensures context deadlines are respected and returns a standard Kubernetes Deployment object
// or an error if the deployment is not found or another API error occurs.
func (c *DefaultKubernetesClient) GetDeployment(ctx context.Context, namespace, name string) (*appsv1.Deployment, error) {
	if namespace == "" {
		namespace = c.namespace
	}
	ctx, cancel := c.ensureContextTimeout(ctx)
	if cancel != nil {
		defer cancel()
	}

	deployment, err := c.clientset.AppsV1().Deployments(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		// Handle NotFound specifically if needed, otherwise wrap the error
		if errors.IsNotFound(err) {
			return nil, fmt.Errorf("deployment %s not found in namespace %s: %w", name, namespace, err)
		}
		return nil, fmt.Errorf("error getting deployment %s in namespace %s: %w", name, namespace, err)
	}
	return deployment, nil
}

// ListDeployments retrieves a list of Deployments within the given namespace that match the specified label selector.
// If the namespace is empty, it defaults to the client's configured default namespace.
// If the labelSelectorMap is empty or nil, all deployments in the namespace are listed.
// It ensures context deadlines are respected and returns a standard Kubernetes DeploymentList object
// or an error if an API error occurs.
func (c *DefaultKubernetesClient) ListDeployments(ctx context.Context, namespace string, labelSelector map[string]string) (*appsv1.DeploymentList, error) {
	if namespace == "" {
		namespace = c.namespace
	}
	ctx, cancel := c.ensureContextTimeout(ctx)
	if cancel != nil {
		defer cancel()
	}

	listOptions := metav1.ListOptions{}
	if len(labelSelector) > 0 {
		selector := labels.SelectorFromSet(labels.Set(labelSelector))
		listOptions.LabelSelector = selector.String()
	}

	deployments, err := c.clientset.AppsV1().Deployments(namespace).List(ctx, listOptions)
	if err != nil {
		return nil, fmt.Errorf("error listing deployments in namespace %s: %w", namespace, err)
	}
	return deployments, nil
}

// CreateDeployment creates a new Deployment resource in the specified namespace.
// If the namespace is empty, it defaults to the client's configured default namespace.
// It ensures context deadlines are respected and returns the created Deployment object
// or an error if the deployment already exists or another API error occurs.
func (c *DefaultKubernetesClient) CreateDeployment(ctx context.Context, namespace string, deployment *appsv1.Deployment) (*appsv1.Deployment, error) {
	if namespace == "" {
		namespace = c.namespace
	}
	// Ensure the deployment's namespace matches the target namespace
	if deployment.Namespace == "" {
		deployment.Namespace = namespace
	} else if deployment.Namespace != namespace {
		return nil, fmt.Errorf("deployment namespace '%s' does not match target namespace '%s'", deployment.Namespace, namespace)
	}

	ctx, cancel := c.ensureContextTimeout(ctx)
	if cancel != nil {
		defer cancel()
	}

	createdDeployment, err := c.clientset.AppsV1().Deployments(namespace).Create(ctx, deployment, metav1.CreateOptions{})
	if err != nil {
		return nil, fmt.Errorf("error creating deployment %s in namespace %s: %w", deployment.Name, namespace, err)
	}
	return createdDeployment, nil
}

// UpdateDeployment updates an existing Deployment resource in the specified namespace.
// If the namespace is empty, it defaults to the client's configured default namespace.
// It ensures context deadlines are respected and returns the updated Deployment object
// or an error if the deployment does not exist or another API error occurs.
func (c *DefaultKubernetesClient) UpdateDeployment(ctx context.Context, namespace string, deployment *appsv1.Deployment) (*appsv1.Deployment, error) {
	if namespace == "" {
		namespace = c.namespace
	}
	// Ensure the deployment's namespace matches the target namespace
	if deployment.Namespace == "" {
		deployment.Namespace = namespace
	} else if deployment.Namespace != namespace {
		return nil, fmt.Errorf("deployment namespace '%s' does not match target namespace '%s'", deployment.Namespace, namespace)
	}

	ctx, cancel := c.ensureContextTimeout(ctx)
	if cancel != nil {
		defer cancel()
	}

	updatedDeployment, err := c.clientset.AppsV1().Deployments(namespace).Update(ctx, deployment, metav1.UpdateOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to update deployment '%s' in namespace '%s': %w", deployment.Name, namespace, err)
	}
	return updatedDeployment, nil
}

// DeleteDeployment deletes a specific Deployment by its name within the given namespace.
// If the namespace is empty, it defaults to the client's configured default namespace.
// It ensures context deadlines are respected.
// This operation is idempotent; deleting a non-existent deployment will not return an error.
// Returns an error only if an API error occurs during the deletion attempt.
func (c *DefaultKubernetesClient) DeleteDeployment(ctx context.Context, namespace, name string) error {
	if namespace == "" {
		namespace = c.namespace
	}
	ctx, cancel := c.ensureContextTimeout(ctx)
	if cancel != nil {
		defer cancel()
	}

	err := c.clientset.AppsV1().Deployments(namespace).Delete(ctx, name, metav1.DeleteOptions{})
	if errors.IsNotFound(err) {
		return nil // Consider it successfully deleted if it's already gone.
	}
	if err != nil {
		return fmt.Errorf("error deleting deployment %s in namespace %s: %w", name, namespace, err)
	}
	return nil
}

// Ensure DefaultKubernetesClient implements DeploymentOperations (compile-time check)
var _ DeploymentOperations = (*DefaultKubernetesClient)(nil)
