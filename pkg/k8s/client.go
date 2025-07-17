// Package k8s provides a simplified interface for interacting with Kubernetes resources
package k8s

import (
	"context"
	"fmt"
	"time"

	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

// KubernetesClient defines the interface you control
type KubernetesClient interface {
	Clientset() kubernetes.Interface
	Namespace() string
	DeploymentOperations
	PodOperations
}

// DefaultKubernetesClient implements KubernetesClient
type DefaultKubernetesClient struct {
	clientset kubernetes.Interface
	namespace string
	timeout   time.Duration
}

func (c *DefaultKubernetesClient) Clientset() kubernetes.Interface {
	return c.clientset
}

func (c *DefaultKubernetesClient) Namespace() string {
	return c.namespace
}

// ensureContextTimeout ensures the context has a timeout set
func (c *DefaultKubernetesClient) ensureContextTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	if _, ok := ctx.Deadline(); ok {
		// Context already has a deadline
		return ctx, nil
	}
	return context.WithTimeout(ctx, c.timeout)
}

// Ensure DefaultKubernetesClient implements all required interfaces
var (
	_ KubernetesClient     = (*DefaultKubernetesClient)(nil)
	_ DeploymentOperations = (*DefaultKubernetesClient)(nil)
	_ PodOperations        = (*DefaultKubernetesClient)(nil)
)

// --- Functional Options ---

type Option func(*configOptions)

type configOptions struct {
	namespace      string
	kubeConfigPath string
	clientset      kubernetes.Interface
	timeout        time.Duration
}

// WithNamespace sets the namespace (default: "default")
func WithNamespace(ns string) Option {
	return func(o *configOptions) {
		o.namespace = ns
	}
}

// WithKubeConfig sets the path to the kubeconfig file
func WithKubeConfig(path string) Option {
	return func(o *configOptions) {
		o.kubeConfigPath = path
	}
}

// WithClientset injects a prebuilt clientset (typically for testing)
func WithClientset(cs kubernetes.Interface) Option {
	return func(o *configOptions) {
		o.clientset = cs
	}
}

// WithTimeout sets a timeout for client interactions (default: 30s)
func WithTimeout(t time.Duration) Option {
	return func(o *configOptions) {
		o.timeout = t
	}
}

// NewKubernetesClient creates a Kubernetes client with the provided options
func NewKubernetesClient(opts ...Option) (KubernetesClient, error) {
	// Default configuration
	cfg := &configOptions{
		namespace: "default",
		timeout:   30 * time.Second,
	}

	// Apply functional options
	for _, opt := range opts {
		opt(cfg)
	}

	client := &DefaultKubernetesClient{
		namespace: cfg.namespace,
		timeout:   cfg.timeout,
	}

	// Use injected clientset if provided
	if cfg.clientset != nil {
		client.clientset = cfg.clientset
		return client, nil
	}

	// Build config
	var restConfig *rest.Config
	var err error

	if cfg.kubeConfigPath != "" {
		restConfig, err = clientcmd.BuildConfigFromFlags("", cfg.kubeConfigPath)
		if err != nil {
			return nil, fmt.Errorf("failed to build config from kubeconfig: %w", err)
		}
	} else {
		restConfig, err = rest.InClusterConfig()
		if err != nil {
			return nil, fmt.Errorf("failed to create in-cluster config: %w", err)
		}
	}

	restConfig.Timeout = cfg.timeout

	clientset, err := kubernetes.NewForConfig(restConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create clientset: %w", err)
	}

	client.clientset = clientset
	return client, nil
}
