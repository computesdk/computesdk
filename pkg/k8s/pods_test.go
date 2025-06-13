package client

import (
	"context"
	"errors" // Added for errors.New
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	k8sAPIErrors "k8s.io/apimachinery/pkg/api/errors" // For checking IsNotFound
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime" // Added for runtime.Object
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing" // Needed for checking actions
)

func TestKubernetesPodsWithFake(t *testing.T) {
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

	t.Run("WaitForPodReady", func(t *testing.T) {
		ctx := context.Background()
		_, err := k8sClient.WaitForPodReady(ctx, "default", "test-pod", 1*time.Second)
		if err != nil {
			t.Errorf("unexpected error waiting for ready pod: %v", err)
		}
	})
}

func TestCreatePod(t *testing.T) {
	ctx := context.Background()
	testNamespace := "create-pod-ns"
	podName := "newly-created-pod"
	podLabels := map[string]string{"app": "new-test-app", "env": "testing"}
	// The fixture CreateTestPod hardcodes the image and container name
	expectedImage := "nginx"
	expectedContainerName := "test-container"

	// 1. Define the pod to be created using the fixture
	// Pass 'true' for the 'ready' parameter as the fixture expects a boolean.
	podToCreate := CreateTestPod(podName, testNamespace, podLabels, true)

	// 2. Create a new test client using NewTestClients for consistency.
	client, _, err := NewTestClients(testNamespace) // No initial objects
	require.NoError(t, err, "NewTestClients should not return an error")
	require.NotNil(t, client, "Client from NewTestClients should not be nil")

	// 3. Call CreatePod
	createdPod, err := client.CreatePod(ctx, testNamespace, podToCreate)
	require.NoError(t, err, "CreatePod should not return an error")
	require.NotNil(t, createdPod, "CreatePod should return the created pod")

	// 4. Assert properties of the created pod
	assert.Equal(t, podName, createdPod.Name, "Created pod name mismatch")
	assert.Equal(t, testNamespace, createdPod.Namespace, "Created pod namespace mismatch")
	assert.Equal(t, podLabels, createdPod.Labels, "Created pod labels mismatch")
	require.NotEmpty(t, createdPod.Spec.Containers, "Created pod should have containers")
	// Assert against the image and name provided by the CreateTestPod fixture
	assert.Equal(t, expectedImage, createdPod.Spec.Containers[0].Image, "Created pod container image mismatch")
	assert.Equal(t, expectedContainerName, createdPod.Spec.Containers[0].Name, "Created pod container name mismatch")

	// 5. Verify by trying to Get the pod
	retrievedPod, err := client.GetPod(ctx, testNamespace, podName)
	require.NoError(t, err, "GetPod after create should not return an error")
	require.NotNil(t, retrievedPod, "GetPod after create should return the pod")
	assert.Equal(t, podName, retrievedPod.Name, "Retrieved pod name mismatch after create")
	assert.Equal(t, podLabels, retrievedPod.Labels, "Retrieved pod labels mismatch after create")
}

func TestUpdatePod(t *testing.T) {
	ctx := context.Background()
	testNamespace := "update-pod-ns"
	podName := "updatable-pod"
	initialLabels := map[string]string{"app": "app-to-update", "version": "v1"}
	updatedLabels := map[string]string{"app": "app-to-update", "version": "v2", "status": "updated"}

	// 1. Create and add an initial pod
	// The 'ready' status doesn't significantly impact a label update test.
	initialPod := CreateTestPod(podName, testNamespace, initialLabels, true)

	client, _, err := NewTestClients(testNamespace, initialPod)
	require.NoError(t, err, "NewTestClients should not return an error")

	// 2. Modify the pod for update (e.g., change labels)
	// It's good practice to get the existing pod first, modify it, and then update,
	// especially to ensure the ResourceVersion is handled correctly by the server.
	// For the fake client, directly modifying our 'initialPod' copy and updating is usually fine.
	podToUpdate := initialPod.DeepCopy() // Work on a copy
	podToUpdate.Labels = updatedLabels

	// 3. Call UpdatePod
	updatedPod, err := client.UpdatePod(ctx, testNamespace, podToUpdate)
	require.NoError(t, err, "UpdatePod should not return an error")
	require.NotNil(t, updatedPod, "UpdatePod should return the updated pod")

	// 4. Assert properties of the updated pod returned by UpdatePod
	assert.Equal(t, podName, updatedPod.Name)
	assert.Equal(t, testNamespace, updatedPod.Namespace)
	assert.Equal(t, updatedLabels, updatedPod.Labels, "Pod labels not updated as expected")

	// 5. Get the pod again and verify changes persist
	retrievedPod, err := client.GetPod(ctx, testNamespace, podName)
	require.NoError(t, err, "GetPod after update should not return an error")
	require.NotNil(t, retrievedPod, "GetDeployment after update should return a pod")
	assert.Equal(t, updatedLabels, retrievedPod.Labels, "Persisted pod labels do not match updated value")
}

func TestDeletePod(t *testing.T) {
	ctx := context.Background()
	testNamespace := "delete-pod-ns"
	podName := "deletable-pod"
	nonExistentPodName := "i-do-not-exist-pod"
	podLabels := map[string]string{"app": "delete-me"}

	// 1. Create and add an initial pod
	podToDelete := CreateTestPod(podName, testNamespace, podLabels, true)

	client, _, err := NewTestClients(testNamespace, podToDelete)
	require.NoError(t, err, "NewTestClients should not return an error")

	// 2. Delete the existing pod
	err = client.DeletePod(ctx, testNamespace, podName)
	require.NoError(t, err, "DeletePod on existing pod should not return an error")

	// 3. Attempt to Get the deleted pod and verify it's not found
	_, err = client.GetPod(ctx, testNamespace, podName)
	require.Error(t, err, "GetPod after delete should return an error")
	assert.True(t, k8sAPIErrors.IsNotFound(err), "Error should be a 'NotFound' error after deleting existing pod")

	// 4. Delete a non-existent pod (should not error due to idempotency)
	err = client.DeletePod(ctx, testNamespace, nonExistentPodName)
	require.NoError(t, err, "DeletePod on non-existent pod should not return an error")
}

func TestDeletePodsByLabel(t *testing.T) {
	ctx := context.Background()
	defaultNamespace := "delete-label-default-ns"
	testNamespace := "delete-label-test-ns"
	targetLabels := map[string]string{"app": "delete-me"}
	targetSelector := labels.SelectorFromSet(targetLabels) // Create selector for verification

	// Pods to set up - fewer are needed now as we don't check complex deletion logic
	podA := CreateTestPod("pod-a", testNamespace, targetLabels, true)
	podE := CreateTestPod("pod-e", defaultNamespace, targetLabels, true) // Pod in default ns for default test

	// --- Test Case: Verify Successful Deletion Action ---
	t.Run("Verify delete-collection action for matching labels", func(t *testing.T) {
		// Setup client using helper which returns fake clientset
		k8sClient, fakeClientset, err := NewTestClients(defaultNamespace, podA.DeepCopy()) // Need at least one pod
		require.NoError(t, err)
		fakeClientset.ClearActions() // Clear setup actions like create

		// Action
		err = k8sClient.DeletePodsByLabel(ctx, testNamespace, targetLabels)
		require.NoError(t, err, "DeletePodsByLabel with valid selector should succeed")

		// Verification: Check the recorded action
		actions := fakeClientset.Actions()
		require.Len(t, actions, 1, "Expected exactly one action (delete-collection)")

		deleteAction, ok := actions[0].(k8stesting.DeleteCollectionAction)
		require.True(t, ok, "Expected action to be DeleteCollectionAction")

		assert.Equal(t, testNamespace, deleteAction.GetNamespace(), "Action namespace mismatch")
		assert.Equal(t, "pods", deleteAction.GetResource().Resource, "Action resource mismatch")
		assert.Equal(t, targetSelector.String(), deleteAction.GetListRestrictions().Labels.String(), "Action label selector mismatch")
	})

	// --- Test Case: Empty Selector Error (No change needed here) ---
	t.Run("Empty label selector error", func(t *testing.T) {
		// Setup client
		k8sClient, fakeClientset, err := NewTestClients(defaultNamespace, podA.DeepCopy()) // Need at least one pod to exist
		require.NoError(t, err)
		fakeClientset.ClearActions() // Clear setup actions

		// Action
		emptySelector := map[string]string{}
		err = k8sClient.DeletePodsByLabel(ctx, testNamespace, emptySelector)

		// Verification
		require.Error(t, err, "DeletePodsByLabel with empty selector should return an error")
		assert.Contains(t, err.Error(), "requires a non-empty label selector")

		// Verify no delete action occurred
		assert.Empty(t, fakeClientset.Actions(), "No delete action should occur on error")
	})

	// --- Test Case: Verify Default Namespace Action ---
	t.Run("Verify delete-collection action for default namespace", func(t *testing.T) {
		// Setup client with pod in default namespace
		k8sClient, fakeClientset, err := NewTestClients(defaultNamespace, podE.DeepCopy()) // Ensure default ns matches podE's ns
		require.NoError(t, err)
		fakeClientset.ClearActions() // Clear setup actions

		// Action: Call with empty namespace string
		err = k8sClient.DeletePodsByLabel(ctx, "", targetLabels)
		require.NoError(t, err, "DeletePodsByLabel with empty namespace should use default and succeed")

		// Verification: Check the recorded action
		actions := fakeClientset.Actions()
		require.Len(t, actions, 1, "Expected exactly one action (delete-collection)")

		deleteAction, ok := actions[0].(k8stesting.DeleteCollectionAction)
		require.True(t, ok, "Expected action to be DeleteCollectionAction")

		assert.Equal(t, defaultNamespace, deleteAction.GetNamespace(), "Action namespace should be default") // Check default namespace
		assert.Equal(t, "pods", deleteAction.GetResource().Resource, "Action resource mismatch")
		assert.Equal(t, targetSelector.String(), deleteAction.GetListRestrictions().Labels.String(), "Action label selector mismatch")
	})

	// --- Test Case: Non-existent Namespace (No change needed here) ---
	t.Run("Non-existent namespace", func(t *testing.T) {
		// Setup client
		k8sClient, fakeClientset, err := NewTestClients(defaultNamespace) // No objects needed
		require.NoError(t, err)
		fakeClientset.ClearActions()

		// Action
		err = k8sClient.DeletePodsByLabel(ctx, "this-ns-does-not-exist", targetLabels)

		// Verification: DeleteCollection might not error if namespace or pods don't exist.
		// We expect no error here, consistent with DeletePod behavior.
		require.NoError(t, err, "DeletePodsByLabel on non-existent namespace should not error")

		// Verify the action still occurred with the correct parameters
		actions := fakeClientset.Actions()
		require.Len(t, actions, 1, "Expected exactly one action (delete-collection)")

		deleteAction, ok := actions[0].(k8stesting.DeleteCollectionAction)
		require.True(t, ok, "Expected action to be DeleteCollectionAction")

		assert.Equal(t, "this-ns-does-not-exist", deleteAction.GetNamespace(), "Action namespace mismatch for non-existent ns")
		assert.Equal(t, "pods", deleteAction.GetResource().Resource, "Action resource mismatch for non-existent ns")
		assert.Equal(t, targetSelector.String(), deleteAction.GetListRestrictions().Labels.String(), "Action label selector mismatch for non-existent ns")
	})
}

// TestGetPodByLabel tests the GetPodByLabel functionality.
func TestGetPodByLabel(t *testing.T) {
	ns := "get-by-label-ns"

	// Common test pods
	pod1Labels := map[string]string{"app": "billing", "env": "staging"}
	pod1 := CreateTestPod("pod1-staging", ns, pod1Labels, true)

	pod2Labels := map[string]string{"app": "frontend", "env": "staging"}
	pod2 := CreateTestPod("pod2-staging", ns, pod2Labels, true) 

	// Pod3 has the same labels as Pod1 to test returning the first match
	pod3SameLabelsAs1 := map[string]string{"app": "billing", "env": "staging"}
	pod3 := CreateTestPod("pod3-staging-duplicate", ns, pod3SameLabelsAs1, true)

	t.Run("PodFound", func(t *testing.T) {
		client, _, err := NewTestClients(ns, pod1, pod2)
		require.NoError(t, err)

		ctx := context.Background()
		foundPod, err := client.GetPodByLabel(ctx, ns, pod1Labels)

		require.NoError(t, err)
		require.NotNil(t, foundPod)
		assert.Equal(t, pod1.Name, foundPod.Name)
		assert.Equal(t, pod1.Namespace, foundPod.Namespace)
		assert.Equal(t, pod1Labels, foundPod.Labels)
	})

	t.Run("MultiplePodsFoundReturnsFirst", func(t *testing.T) {
		// Note: The fake client's List usually returns in order of addition for NewSimpleClientset,
		// but this isn't a guaranteed contract for real API servers or more complex fake client setups.
		// For this test, we'll assume pod1 is listed before pod3 if both are added.
		client, _, err := NewTestClients(ns, pod1, pod3, pod2) // pod1 and pod3 match, pod2 does not
		require.NoError(t, err)

		ctx := context.Background()
		matchingLabels := map[string]string{"app": "billing", "env": "staging"}
		foundPod, err := client.GetPodByLabel(ctx, ns, matchingLabels)

		require.NoError(t, err)
		require.NotNil(t, foundPod)
		// We expect one of them, typically the first one added to the fake client that matches.
		assert.Contains(t, []string{pod1.Name, pod3.Name}, foundPod.Name)
		assert.Equal(t, ns, foundPod.Namespace)
		assert.Equal(t, matchingLabels, foundPod.Labels)
	})

	t.Run("PodNotFound", func(t *testing.T) {
		client, _, err := NewTestClients(ns, pod2) // Only pod2 exists
		require.NoError(t, err)

		ctx := context.Background()
		nonExistentLabels := map[string]string{"app": "inventory", "env": "production"}
		foundPod, err := client.GetPodByLabel(ctx, ns, nonExistentLabels)

		require.Error(t, err)
		assert.Nil(t, foundPod)
		assert.Contains(t, err.Error(), "no pod found with labels")
	})

	t.Run("EmptyLabelSelector", func(t *testing.T) {
		client, _, err := NewTestClients(ns, pod1) // Content of client doesn't matter here
		require.NoError(t, err)

		ctx := context.Background()
		emptyLabels := make(map[string]string)
		foundPod, err := client.GetPodByLabel(ctx, ns, emptyLabels)

		require.Error(t, err)
		assert.Nil(t, foundPod)
		assert.Contains(t, err.Error(), "requires a non-empty label selector")
	})

	t.Run("ListPodsError", func(t *testing.T) {
		fakeClientset := fake.NewSimpleClientset() // No initial objects
		fakeClientset.PrependReactor("list", "pods", func(action k8stesting.Action) (handled bool, ret runtime.Object, err error) {
			return true, nil, errors.New("simulated list pods error")
		})
		
		k8sClient, err := NewKubernetesClient(fakeClientset, ns)
		require.NoError(t, err)

		ctx := context.Background()
		labelsToSearch := map[string]string{"app": "any"}
		foundPod, err := k8sClient.GetPodByLabel(ctx, ns, labelsToSearch)

		require.Error(t, err)
		assert.Nil(t, foundPod)
		assert.Contains(t, err.Error(), "simulated list pods error")
		assert.Contains(t, err.Error(), "error listing pods with labels")
	})

	t.Run("ContextCancelled", func(t *testing.T) {
		client, _, err := NewTestClients(ns, pod1)
		require.NoError(t, err)

		ctx, cancel := context.WithCancel(context.Background())
		cancel() // Cancel context immediately

		labelsToSearch := map[string]string{"app": "billing"}
		foundPod, err := client.GetPodByLabel(ctx, ns, labelsToSearch)

		require.Error(t, err)
		assert.Nil(t, foundPod)
		// The error comes from ListPods, which itself calls ensureContextTimeout.
		// ensureContextTimeout creates a new derived context if the parent has no deadline,
		// but if parent is already cancelled, that derived context will also be immediately cancelled.
		// Or, if ListPods itself respects the parent context directly before API call.
		assert.ErrorIs(t, err, context.Canceled) // Check if the error is or wraps context.Canceled
	})
}
