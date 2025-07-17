package k8s

import (
	// Though not directly used in fixtures, good practice if expanded

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime" // Required for fake.NewSimpleClientsetWithObjects
	"k8s.io/client-go/kubernetes/fake"
	// "k8s.io/client-go/kubernetes" // No longer needed if NewTestClients returns KubernetesClient
)

// NewTestClients returns a KubernetesClient backed by a fake clientset, and the fake clientset itself.
// This allows tests to inspect the fake clientset directly if needed.
// Pass Kubernetes runtime objects (like Pods, Deployments) to preload the fake clientset.
func NewTestClients(namespace string, initialObjects ...runtime.Object) (KubernetesClient, *fake.Clientset, error) {
	if namespace == "" {
		namespace = "default"
	}

	fakeClientset := fake.NewSimpleClientset(initialObjects...)
	
	client, err := NewKubernetesClient(
		WithClientset(fakeClientset),
		WithNamespace(namespace),
	)
	if err != nil {
		return nil, nil, err
	}
	return client, fakeClientset, nil
}

// CreateTestPod creates a test pod with customizable properties.
// It returns a basic, ready pod by default.
func CreateTestPod(name, namespace string, labels map[string]string, ready bool) *corev1.Pod {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: namespace,
			Labels:    labels,
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{
					Name:  "test-container",
					Image: "nginx", // A common placeholder image
				},
			},
		},
	}

	if ready {
		pod.Status = corev1.PodStatus{
			Phase: corev1.PodRunning,
			Conditions: []corev1.PodCondition{
				{
					Type:   corev1.PodReady,
					Status: corev1.ConditionTrue,
				},
			},
		}
	} else {
		pod.Status = corev1.PodStatus{
			Phase: corev1.PodPending, // Or any other non-ready phase
			Conditions: []corev1.PodCondition{
				{
					Type:   corev1.PodReady,
					Status: corev1.ConditionFalse,
				},
			},
		}
	}
	return pod
}

// CreateTestDeployment creates a test deployment with customizable properties.
func CreateTestDeployment(name, namespace string, replicas int32, podLabels map[string]string) *appsv1.Deployment {
	// Ensure replicas is a pointer
	r := replicas
	return &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: namespace,
			Labels:    podLabels, // Often deployments share labels with their pods
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &r,
			Selector: &metav1.LabelSelector{
				MatchLabels: podLabels,
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: podLabels,
				},
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{
						{
							Name:  "test-container",
							Image: "nginx",
						},
					},
				},
			},
		},
	}
}
