package k8s_test

import (
	"context"
	"testing"
	"time"

	"github.com/heysnelling/computesdk/pkg/k8s"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

func TestKubernetesClient(t *testing.T) {
	// Create a test pod
	testPod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "test-pod",
			Namespace: "default",
			Labels: map[string]string{
				"app": "test",
			},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
			Conditions: []corev1.PodCondition{
				{
					Type:   corev1.PodReady,
					Status: corev1.ConditionTrue,
				},
			},
		},
	}

	// Create a fake clientset with our test pod
	fakeClientset := fake.NewSimpleClientset(testPod)

	// Test 1: Create client with functional options
	t.Run("Create client with functional options", func(t *testing.T) {
		k8sClient, err := k8s.NewKubernetesClient(
			k8s.WithClientset(fakeClientset),
			k8s.WithNamespace("default"),
			k8s.WithTimeout(30*time.Second),
		)
		if err != nil {
			t.Fatalf("failed to create client: %v", err)
		}

		// Verify the namespace was set correctly
		if ns := k8sClient.Namespace(); ns != "default" {
			t.Errorf("expected namespace 'default', got %s", ns)
		}

		// Verify we can access the clientset
		if k8sClient.Clientset() == nil {
			t.Error("expected non-nil clientset")
		}
	})

	// Test 2: Test client operations through the clientset
	t.Run("Test client operations", func(t *testing.T) {
		k8sClient, err := k8s.NewKubernetesClient(
			k8s.WithClientset(fakeClientset),
			k8s.WithNamespace("default"),
		)
		if err != nil {
			t.Fatalf("failed to create client: %v", err)
		}

		// Get the pod through the clientset
		pod, err := k8sClient.Clientset().CoreV1().Pods("default").Get(
			context.Background(),
			"test-pod",
			metav1.GetOptions{},
		)
		if err != nil {
			t.Fatalf("failed to get pod: %v", err)
		}

		if pod.Name != "test-pod" {
			t.Errorf("expected pod name 'test-pod', got %s", pod.Name)
		}
	})

	// Test 3: Test WithKubeConfig option (will use in-cluster config in test)
	t.Run("Test WithKubeConfig", func(t *testing.T) {
		// This will use in-cluster config since we don't provide a kubeconfig path
		_, err := k8s.NewKubernetesClient(
			k8s.WithNamespace("test-namespace"),
		)

		// We expect an error because we're not running in a cluster
		if err == nil {
			t.Error("expected error when creating in-cluster config outside of cluster")
		}
	})
}
