package client

import (
	"context"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

func TestKubernetesClientWithFake(t *testing.T) {
	// Fake client preloaded with a pod
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

	fakeClientset := fake.NewSimpleClientset(testPod)

	// Create client with the test namespace
	k8sClient, err := NewKubernetesClient(fakeClientset, "default")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	// Verify the namespace was set correctly
	if ns := k8sClient.Namespace(); ns != "default" {
		t.Errorf("expected namespace 'default', got %s", ns)
	}

	// Test 1: Basic API access via Clientset
	t.Run("Clientset", func(t *testing.T) {
		pod, err := k8sClient.Clientset().CoreV1().Pods("default").Get(context.TODO(), "test-pod", metav1.GetOptions{})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if pod.Name != "test-pod" {
			t.Errorf("expected pod name 'test-pod', got %s", pod.Name)
		}
	})

	// Test 2: GetPod convenience method
	t.Run("GetPod", func(t *testing.T) {
		ctx := context.Background()
		pod, err := k8sClient.GetPod(ctx, "default", "test-pod")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if pod.Name != "test-pod" {
			t.Errorf("expected pod name 'test-pod', got %s", pod.Name)
		}

		// Test with empty namespace (should use default)
		pod, err = k8sClient.GetPod(ctx, "", "test-pod")
		if err != nil {
			t.Fatalf("unexpected error with empty namespace: %v", err)
		}

		if pod.Name != "test-pod" {
			t.Errorf("expected pod name 'test-pod' with empty namespace, got %s", pod.Name)
		}
	})

	// Test 3: ListPods with label selector
	t.Run("ListPods", func(t *testing.T) {
		ctx := context.Background()
		pods, err := k8sClient.ListPods(ctx, "default", map[string]string{"app": "test"})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if len(pods.Items) != 1 {
			t.Errorf("expected 1 pod, got %d", len(pods.Items))
		}

		if len(pods.Items) > 0 && pods.Items[0].Name != "test-pod" {
			t.Errorf("expected pod name 'test-pod', got %s", pods.Items[0].Name)
		}
	})

	// Test 4: WaitForPodReady (should return immediately since pod is already ready)
	t.Run("WaitForPodReady", func(t *testing.T) {
		ctx := context.Background()
		_, err := k8sClient.WaitForPodReady(ctx, "default", "test-pod", 1*time.Second)
		if err != nil {
			t.Errorf("unexpected error waiting for ready pod: %v", err)
		}
	})
}
