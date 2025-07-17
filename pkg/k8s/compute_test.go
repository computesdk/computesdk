package k8s_test

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	client "github.com/heysnelling/computesdk/pkg/k8s"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// mockPodOperations is a mock implementation of client.PodOperations for testing.
// It allows setting functions to simulate different behaviors for each method.
// Enhanced mockPodOperations
type mockPodOperations struct {
	GetPodFunc            func(ctx context.Context, namespace, name string) (*corev1.Pod, error)
	ListPodsFunc          func(ctx context.Context, namespace string, labelSelectorMap map[string]string) (*corev1.PodList, error)
	WaitForPodReadyFunc   func(ctx context.Context, namespace, name string, timeout time.Duration) (*corev1.Pod, error)
	CreatePodFunc         func(ctx context.Context, namespace string, pod *corev1.Pod) (*corev1.Pod, error)
	UpdatePodFunc         func(ctx context.Context, namespace string, pod *corev1.Pod) (*corev1.Pod, error)
	DeletePodFunc         func(ctx context.Context, namespace, name string) error
	DeletePodsByLabelFunc func(ctx context.Context, namespace string, labelSelectorMap map[string]string) error
	GetPodByLabelFunc     func(ctx context.Context, namespace string, labelSelectorMap map[string]string) (*corev1.Pod, error)
}

func (m *mockPodOperations) GetPod(ctx context.Context, namespace, name string) (*corev1.Pod, error) {
	if m.GetPodFunc != nil {
		return m.GetPodFunc(ctx, namespace, name)
	}
	return nil, fmt.Errorf("GetPodFunc not implemented in mock")
}

func (m *mockPodOperations) ListPods(ctx context.Context, namespace string, labelSelectorMap map[string]string) (*corev1.PodList, error) {
	if m.ListPodsFunc != nil {
		return m.ListPodsFunc(ctx, namespace, labelSelectorMap)
	}
	return nil, fmt.Errorf("ListPodsFunc not implemented in mock")
}

func (m *mockPodOperations) WaitForPodReady(ctx context.Context, namespace, name string, timeout time.Duration) (*corev1.Pod, error) {
	if m.WaitForPodReadyFunc != nil {
		return m.WaitForPodReadyFunc(ctx, namespace, name, timeout)
	}
	return nil, fmt.Errorf("WaitForPodReadyFunc not implemented in mock")
}

func (m *mockPodOperations) CreatePod(ctx context.Context, namespace string, pod *corev1.Pod) (*corev1.Pod, error) {
	if m.CreatePodFunc != nil {
		return m.CreatePodFunc(ctx, namespace, pod)
	}
	return pod, nil // Default pass-through for simplicity if not specified
}

func (m *mockPodOperations) UpdatePod(ctx context.Context, namespace string, pod *corev1.Pod) (*corev1.Pod, error) {
	if m.UpdatePodFunc != nil {
		return m.UpdatePodFunc(ctx, namespace, pod)
	}
	return pod, nil // Default pass-through
}

func (m *mockPodOperations) DeletePod(ctx context.Context, namespace, name string) error {
	if m.DeletePodFunc != nil {
		return m.DeletePodFunc(ctx, namespace, name)
	}
	return fmt.Errorf("DeletePodFunc not implemented in mock")
}

func (m *mockPodOperations) DeletePodsByLabel(ctx context.Context, namespace string, labelSelectorMap map[string]string) error {
	if m.DeletePodsByLabelFunc != nil {
		return m.DeletePodsByLabelFunc(ctx, namespace, labelSelectorMap)
	}
	return fmt.Errorf("DeletePodsByLabelFunc not implemented in mock")
}

func (m *mockPodOperations) GetPodByLabel(ctx context.Context, namespace string, labelSelectorMap map[string]string) (*corev1.Pod, error) {
	if m.GetPodByLabelFunc != nil {
		return m.GetPodByLabelFunc(ctx, namespace, labelSelectorMap)
	}
	return nil, fmt.Errorf("GetPodByLabelFunc not implemented in mock")
}

// Compile-time check to ensure mockPodOperations implements client.PodOperations
var _ client.PodOperations = &mockPodOperations{}

// createTestPod creates a test pod for testing - removed unused clientset param
func createTestPod(name, computeID, ip string, isReady bool, namespace string, labels map[string]string, ports []corev1.ContainerPort) *corev1.Pod {
	if labels == nil {
		labels = make(map[string]string)
	}
	labels["computeId"] = computeID // Ensure computeId is set

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: namespace,
			Labels:    labels,
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{
					Ports: ports,
				},
			},
		},
		Status: corev1.PodStatus{
			PodIP: ip,
			Phase: corev1.PodRunning, // Assume running for simplicity in mock tests
		},
	}

	if isReady {
		pod.Status.Conditions = []corev1.PodCondition{
			{
				Type:   corev1.PodReady,
				Status: corev1.ConditionTrue,
			},
		}
	} else {
		pod.Status.Conditions = []corev1.PodCondition{
			{
				Type:   corev1.PodReady,
				Status: corev1.ConditionFalse,
			},
		}
	}

	return pod
}

func TestNewComputeManager(t *testing.T) {
	mockOps := &mockPodOperations{}
	testNamespace := "my-test-ns"

	pm := client.NewComputeManager(mockOps, testNamespace)

	if pm == nil {
		t.Fatal("NewComputeManager returned nil")
	}

	// Removed direct checks for unexported fields as per previous changes.
	// Their correct initialization is implicitly tested by other functions.
}

func TestPodManager_GetPod(t *testing.T) {
	ctx := context.Background()
	namespace := "test-getpod-ns"
	testComputeID := "test-compute-id-getpod"
	testPodName := "pod-" + testComputeID
	testPodIP := "10.0.0.1"

	tests := []struct {
		name           string
		mockSetup      func(*mockPodOperations)
		expectError    bool
		expectedPod    *client.PodInfo
		firstCall      bool           // true for API call, false for cache hit check
		secondCall     bool           // true to make a second call to check cache
		callCountCheck func(int) bool // Checks how many times GetPodByLabel was called
	}{
		{
			name: "Pod found - API call",
			mockSetup: func(mockOps *mockPodOperations) {
				mockOps.GetPodByLabelFunc = func(ctx context.Context, ns string, labelSelectorMap map[string]string) (*corev1.Pod, error) {
					if ns == namespace && labelSelectorMap["computeId"] == testComputeID {
						return createTestPod(testPodName, testComputeID, testPodIP, true, namespace, nil, nil), nil
					}
					return nil, fmt.Errorf("unexpected GetPodByLabel call")
				}
			},
			expectError: false,
			expectedPod: &client.PodInfo{Name: testPodName, ComputeID: testComputeID, IP: testPodIP, IsReady: true, Phase: corev1.PodRunning},
			firstCall:   true,
		},
		{
			name: "Pod not found - API call",
			mockSetup: func(mockOps *mockPodOperations) {
				mockOps.GetPodByLabelFunc = func(ctx context.Context, ns string, labelSelectorMap map[string]string) (*corev1.Pod, error) {
					return nil, fmt.Errorf("k8s API: pod not found") // Simulate K8s not found error
				}
			},
			expectError: true,
			firstCall:   true,
		},
		{
			name: "Pod found - cache hit",
			mockSetup: func(mockOps *mockPodOperations) {
				// This setup is for the first call that populates the cache.
				// The second call should not invoke GetPodByLabelFunc if cache works.
				var callCount int
				mockOps.GetPodByLabelFunc = func(ctx context.Context, ns string, labelSelectorMap map[string]string) (*corev1.Pod, error) {
					callCount++
					if ns == namespace && labelSelectorMap["computeId"] == testComputeID {
						return createTestPod(testPodName, testComputeID, testPodIP, true, namespace, nil, nil), nil
					}
					return nil, fmt.Errorf("unexpected GetPodByLabel call in cache hit setup")
				}
			},
			expectError:    false,
			expectedPod:    &client.PodInfo{Name: testPodName, ComputeID: testComputeID, IP: testPodIP, IsReady: true, Phase: corev1.PodRunning},
			firstCall:      true,                                       // This call populates the cache
			secondCall:     true,                                       // This call should hit the cache
			callCountCheck: func(count int) bool { return count == 1 }, // GetPodByLabel should be called only once
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			mockOps := &mockPodOperations{}
			if tc.mockSetup != nil {
				tc.mockSetup(mockOps)
			}

			pm := client.NewComputeManager(mockOps, namespace)
			var podInfo *client.PodInfo
			var err error

			if tc.firstCall {
				podInfo, err = pm.GetPod(ctx, testComputeID)
			}

			if tc.secondCall {
				// Ensure the mock's GetPodByLabelFunc is either not called or behaves as expected for cache test
				if tc.name == "Pod found - cache hit" { // Special handling for cache hit verification
					// Reset or design GetPodByLabelFunc to error if called again, to prove cache hit
					var getPodByLabelCallCountDuringSecondPhase int
					oldFunc := mockOps.GetPodByLabelFunc
					mockOps.GetPodByLabelFunc = func(ctx context.Context, ns string, labelSelectorMap map[string]string) (*corev1.Pod, error) {
						getPodByLabelCallCountDuringSecondPhase++
						t.Logf("GetPodByLabelFunc CALLED during second phase (cache test) - count: %d", getPodByLabelCallCountDuringSecondPhase)
						return nil, fmt.Errorf("GetPodByLabelFunc should not be called during cache hit test's second phase")
					}
					podInfo, err = pm.GetPod(ctx, testComputeID)
					mockOps.GetPodByLabelFunc = oldFunc // Restore for other tests if any in this scope
					if getPodByLabelCallCountDuringSecondPhase > 0 {
						t.Errorf("Cache test failed: GetPodByLabel was called %d times during second phase, expected 0", getPodByLabelCallCountDuringSecondPhase)
					}
				} else {
					podInfo, err = pm.GetPod(ctx, testComputeID) // Regular second call for other scenarios if needed
				}
			}

			if tc.expectError {
				if err == nil {
					t.Errorf("Expected an error, but got nil")
				}
			} else {
				if err != nil {
					t.Errorf("Expected no error, but got: %v", err)
				}
				if podInfo == nil && tc.expectedPod != nil {
					t.Errorf("Expected pod info, but got nil")
				}
				if podInfo != nil && tc.expectedPod != nil {
					if podInfo.ComputeID != tc.expectedPod.ComputeID || podInfo.IP != tc.expectedPod.IP || podInfo.IsReady != tc.expectedPod.IsReady {
						t.Errorf("Expected pod %+v, but got %+v", *tc.expectedPod, *podInfo)
					}
				}
			}

			// This is a bit tricky to check call counts with current mock structure without embedding counters in mockOps directly.
			// The cache hit test has its specific logic for now.
		})
	}
}

func TestPodManager_ListPods(t *testing.T) {
	ctx := context.Background() // Context might not be directly used by ListPods but good practice
	namespace := "test-listpods-ns"

	testPods := []struct {
		name           string
		computeID      string
		ip             string
		isReady        bool
		labels         map[string]string
		ports          []corev1.ContainerPort
		expectedInList bool // Does this pod have the required 'app: compute' and 'computeId' labels?
	}{
		{
			name: "pod1", computeID: "id1", ip: "10.0.0.1", isReady: true,
			labels:         map[string]string{"app": "compute", "computeId": "id1", "extra": "label1"},
			ports:          []corev1.ContainerPort{{Name: "http", ContainerPort: 80}},
			expectedInList: true,
		},
		{
			name: "pod2", computeID: "id2", ip: "10.0.0.2", isReady: false,
			labels:         map[string]string{"app": "compute", "computeId": "id2"},
			ports:          []corev1.ContainerPort{{ContainerPort: 8080}}, // Nameless port
			expectedInList: true,
		},
		{
			name: "pod3-no-computeid", computeID: "", ip: "10.0.0.3", isReady: true, // computeID will be missing from labels
			labels:         map[string]string{"app": "compute"}, // Missing computeId label
			expectedInList: false,
		},
		{
			name: "pod4-wrong-app", computeID: "id4", ip: "10.0.0.4", isReady: true,
			labels:         map[string]string{"app": "other", "computeId": "id4"}, // Wrong app label for ListPods selector
			expectedInList: false,                                                 // Will be filtered out by the ListPods call to k8sClient itself
		},
	}

	type testCase struct {
		name              string
		mockSetup         func(*mockPodOperations) *corev1.PodList
		expectError       bool
		expectedNumListed int
		validatePodInfos  func(t *testing.T, podInfos []*client.PodInfo, originalPods []*corev1.Pod)
	}

	createK8sPodList := func(podsToInclude ...int) *corev1.PodList {
		k8sPodList := &corev1.PodList{Items: []corev1.Pod{}}
		for _, idx := range podsToInclude {
			p := testPods[idx]
			k8sPodList.Items = append(k8sPodList.Items, *createTestPod(p.name, p.computeID, p.ip, p.isReady, namespace, p.labels, p.ports))
		}
		return k8sPodList
	}

	testCases := []testCase{
		{
			name: "Successful list with multiple pods",
			mockSetup: func(mockOps *mockPodOperations) *corev1.PodList {
				k8sPods := createK8sPodList(0, 1, 2) // pod1, pod2, pod3 (no-computeid)
				// pod4 (wrong-app) would be filtered by the k8sClient.ListPods itself if real,
				// so we only return pods that would match the 'app:compute' selector.
				mockOps.ListPodsFunc = func(c context.Context, ns string, labelSelectorMap map[string]string) (*corev1.PodList, error) {
					if ns == namespace && labelSelectorMap["app"] == "compute" {
						return k8sPods, nil
					}
					return nil, fmt.Errorf("unexpected ListPods call params")
				}
				return k8sPods
			},
			expectError:       false,
			expectedNumListed: 2, // pod1 and pod2, pod3 is filtered by ComputeManager due to missing computeId
			validatePodInfos: func(t *testing.T, podInfos []*client.PodInfo, _ []*corev1.Pod) {
				foundID1, foundID2 := false, false
				for _, pi := range podInfos {
					if pi.ComputeID == "id1" {
						foundID1 = true
						if pi.IP != "10.0.0.1" || !pi.IsReady || len(pi.Labels) != 3 || pi.PortMap["http"] != 80 {
							t.Errorf("PodInfo for id1 doesn't match expected: %+v", pi)
						}
					} else if pi.ComputeID == "id2" {
						foundID2 = true
						if pi.IP != "10.0.0.2" || pi.IsReady || pi.PortMap["default_port_8080"] != 8080 {
							t.Errorf("PodInfo for id2 doesn't match expected: %+v", pi)
						}
					}
				}
				if !foundID1 || !foundID2 {
					t.Errorf("Expected to find pod infos for id1 and id2, found1: %v, found2: %v", foundID1, foundID2)
				}
			},
		},
		{
			name: "Empty list from API",
			mockSetup: func(mockOps *mockPodOperations) *corev1.PodList {
				k8sPods := &corev1.PodList{Items: []corev1.Pod{}}
				mockOps.ListPodsFunc = func(c context.Context, ns string, labelSelectorMap map[string]string) (*corev1.PodList, error) {
					return k8sPods, nil
				}
				return k8sPods
			},
			expectError:       false,
			expectedNumListed: 0,
		},
		{
			name: "Error from API",
			mockSetup: func(mockOps *mockPodOperations) *corev1.PodList {
				mockOps.ListPodsFunc = func(c context.Context, ns string, labelSelectorMap map[string]string) (*corev1.PodList, error) {
					return nil, fmt.Errorf("K8s API list error")
				}
				return nil
			},
			expectError:       true,
			expectedNumListed: 0,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			mockOps := &mockPodOperations{}
			var expectedK8sPodsFromMock *corev1.PodList
			if tc.mockSetup != nil {
				expectedK8sPodsFromMock = tc.mockSetup(mockOps)
			}

			pm := client.NewComputeManager(mockOps, namespace)
			podInfos, err := pm.ListPods() // Call the actual ListPods method

			if tc.expectError {
				if err == nil {
					t.Errorf("Expected an error, but got nil")
				}
			} else {
				if err != nil {
					t.Errorf("Expected no error, but got: %v", err)
				}
				if len(podInfos) != tc.expectedNumListed {
					t.Errorf("Expected %d pod(s) in list, got %d", tc.expectedNumListed, len(podInfos))
				}
				if tc.validatePodInfos != nil {
					var corePodsForValidation []*corev1.Pod
					if expectedK8sPodsFromMock != nil {
						for i := range expectedK8sPodsFromMock.Items {
							corePodsForValidation = append(corePodsForValidation, &expectedK8sPodsFromMock.Items[i])
						}
					}
					tc.validatePodInfos(t, podInfos, corePodsForValidation)
				}
				// Verify cache: After a successful ListPods, GetPod for listed items should hit cache.
				// This is an implicit test. If GetPod tests for cache hits are robust, this offers some confidence.
				// For more direct cache validation here, we could iterate podInfos and call GetPod,
				// ensuring GetPodByLabelFunc is not called again.
				for _, listedPI := range podInfos {
					// Re-configure GetPodByLabelFunc to error if called, to prove cache hit.
					originalGetPodFunc := mockOps.GetPodByLabelFunc
					var getPodByLabelCalledForCacheCheck int
					mockOps.GetPodByLabelFunc = func(ctx context.Context, ns string, labelSelectorMap map[string]string) (*corev1.Pod, error) {
						getPodByLabelCalledForCacheCheck++
						return nil, fmt.Errorf("GetPodByLabelFunc was called for %s during ListPods cache check, expected cache hit", listedPI.ComputeID)
					}
					cachedPI, cacheErr := pm.GetPod(ctx, listedPI.ComputeID)
					if cacheErr != nil {
						t.Errorf("Error getting pod %s from cache after ListPods: %v", listedPI.ComputeID, cacheErr)
					}
					if getPodByLabelCalledForCacheCheck > 0 {
						t.Errorf("Cache not populated correctly by ListPods for %s, GetPodByLabel was called %d times", listedPI.ComputeID, getPodByLabelCalledForCacheCheck)
					}
					if cachedPI == nil || cachedPI.ComputeID != listedPI.ComputeID {
						t.Errorf("Pod %s from cache does not match listed pod. Got: %+v, Expected: %+v", listedPI.ComputeID, cachedPI, listedPI)
					}
					mockOps.GetPodByLabelFunc = originalGetPodFunc // Restore
				}
			}
		})
	}
}

func TestPodManager_DeletePod(t *testing.T) {
	ctx := context.Background()
	namespace := "test-deletepod-ns"

	type testCase struct {
		name              string
		computeIDToDelete string
		mockSetup         func(mockOps *mockPodOperations, computeID string)
		primeCache        func(pm *client.ComputeManager, mockOps *mockPodOperations, computeID string, podNameToPrime string) // For setting up initial cache state
		expectError       bool
		verifyMockCalls   func(t *testing.T, mockOps *mockPodOperations)
		verifyCache       func(t *testing.T, pm *client.ComputeManager, mockOps *mockPodOperations, deletedComputeID string)
	}

	// Pod definitions for use in tests
	podToDelete := createTestPod("pod-to-delete", "id-delete-success", "10.0.0.1", true, namespace, map[string]string{"app": "compute", "computeId": "id-delete-success"}, nil)
	podApiError := createTestPod("pod-api-error", "id-api-error", "10.0.0.2", true, namespace, map[string]string{"app": "compute", "computeId": "id-api-error"}, nil)
	podToKeepInCache := createTestPod("pod-to-keep", "id-keep", "10.0.0.3", true, namespace, map[string]string{"app": "compute", "computeId": "id-keep"}, nil)

	testCases := []testCase{
		{
			name:              "Successful deletion",
			computeIDToDelete: "id-delete-success",
			mockSetup: func(mockOps *mockPodOperations, computeID string) {
				// Mock for the initial GetPod call within DeletePod
				mockOps.GetPodByLabelFunc = func(c context.Context, ns string, labelSelectorMap map[string]string) (*corev1.Pod, error) {
					if ns == namespace && labelSelectorMap["computeId"] == computeID {
						return podToDelete, nil
					}
					return nil, fmt.Errorf("[mockSetup-success] GetPodByLabelFunc called for unexpected ID %s", labelSelectorMap["computeId"])
				}
				// Mock for the DeletePod call
				mockOps.DeletePodFunc = func(c context.Context, ns string, podName string) error {
					if ns == namespace && podName == podToDelete.Name {
						return nil // Successful deletion
					}
					return fmt.Errorf("[mockSetup-success] DeletePodFunc called with unexpected ns/name: %s/%s", ns, podName)
				}
			},
			primeCache: func(pm *client.ComputeManager, mockOps *mockPodOperations, computeIDTest string, _ string) {
				// Prime cache with the pod to be deleted and another pod to keep
				originalGetPodFunc := mockOps.GetPodByLabelFunc
				mockOps.GetPodByLabelFunc = func(ctx context.Context, ns string, labelSelectorMap map[string]string) (*corev1.Pod, error) {
					if labelSelectorMap["computeId"] == "id-delete-success" {
						return podToDelete, nil
					}
					if labelSelectorMap["computeId"] == "id-keep" {
						return podToKeepInCache, nil
					}
					return nil, fmt.Errorf("[primeCache-success] GetPodByLabelFunc called for unexpected ID %s", labelSelectorMap["computeId"])
				}
				pm.GetPod(ctx, "id-delete-success")            // Ensure it's in cache
				pm.GetPod(ctx, "id-keep")                      // Ensure this other pod is in cache
				mockOps.GetPodByLabelFunc = originalGetPodFunc // Restore for the actual test
			},
			expectError: false,
			verifyCache: func(t *testing.T, pm *client.ComputeManager, mockOps *mockPodOperations, deletedComputeID string) {
				// Verify deleted pod is gone from cache (GetPod should go to API)
				mockOps.GetPodByLabelFunc = func(c context.Context, ns string, labelSelectorMap map[string]string) (*corev1.Pod, error) {
					if labelSelectorMap["computeId"] == deletedComputeID {
						return nil, fmt.Errorf("pod %s not found via API (expected after cache removal)", deletedComputeID)
					}
					return nil, fmt.Errorf("[verifyCache-success-deleted] GetPodByLabelFunc called for unexpected ID %s", labelSelectorMap["computeId"])
				}
				_, err := pm.GetPod(ctx, deletedComputeID)
				if err == nil || !strings.Contains(err.Error(), "not found via API") {
					t.Errorf("Expected '%s not found via API' error when getting deleted pod, got: %v", deletedComputeID, err)
				}

				// Verify other pod ('id-keep') is still in cache (GetPodByLabelFunc should NOT be called for it)
				getCalledForKeptPod := false
				mockOps.GetPodByLabelFunc = func(c context.Context, ns string, labelSelectorMap map[string]string) (*corev1.Pod, error) {
					if labelSelectorMap["computeId"] == "id-keep" {
						getCalledForKeptPod = true
						return podToKeepInCache, nil // Should not happen if cache hit
					}
					return nil, fmt.Errorf("[verifyCache-success-kept] GetPodByLabelFunc called for unexpected ID %s", labelSelectorMap["computeId"])
				}
				keptPodInfo, err := pm.GetPod(ctx, "id-keep")
				if err != nil {
					t.Errorf("Error getting 'id-keep' pod: %v", err)
				}
				if getCalledForKeptPod {
					t.Errorf("GetPodByLabelFunc was called for 'id-keep'; expected cache hit")
				}
				if keptPodInfo == nil || keptPodInfo.ComputeID != "id-keep" {
					t.Errorf("Pod 'id-keep' data is incorrect or missing from cache, got: %+v", keptPodInfo)
				}
			},
		},
		{
			name:              "Deletion of non-existent pod",
			computeIDToDelete: "id-does-not-exist",
			mockSetup: func(mockOps *mockPodOperations, computeID string) {
				mockOps.GetPodByLabelFunc = func(c context.Context, ns string, labelSelectorMap map[string]string) (*corev1.Pod, error) {
					if ns == namespace && labelSelectorMap["computeId"] == computeID {
						return nil, fmt.Errorf("mock pod %s not found", computeID) // This error should be propagated
					}
					return nil, fmt.Errorf("[mockSetup-nonexistent] GetPodByLabelFunc called for unexpected ID %s", labelSelectorMap["computeId"])
				}
				mockOps.DeletePodFunc = func(c context.Context, ns string, podName string) error {
					t.Errorf("DeletePodFunc should not have been called for non-existent pod %s", podName)
					return nil
				}
			},
			expectError: true,
		},
		{
			name:              "Error during K8s API delete operation",
			computeIDToDelete: "id-api-error",
			mockSetup: func(mockOps *mockPodOperations, computeID string) {
				mockOps.GetPodByLabelFunc = func(c context.Context, ns string, labelSelectorMap map[string]string) (*corev1.Pod, error) {
					if ns == namespace && labelSelectorMap["computeId"] == computeID {
						return podApiError, nil
					}
					return nil, fmt.Errorf("[mockSetup-apierror] GetPodByLabelFunc called for unexpected ID %s", labelSelectorMap["computeId"])
				}
				mockOps.DeletePodFunc = func(c context.Context, ns string, podName string) error {
					return fmt.Errorf("K8s API delete failed") // This error should be propagated
				}
			},
			primeCache: func(pm *client.ComputeManager, mockOps *mockPodOperations, computeIDTest string, _ string) {
				// Prime cache with the pod that will cause an API error during delete
				originalGetPodFunc := mockOps.GetPodByLabelFunc
				mockOps.GetPodByLabelFunc = func(ctx context.Context, ns string, labelSelectorMap map[string]string) (*corev1.Pod, error) {
					if labelSelectorMap["computeId"] == "id-api-error" {
						return podApiError, nil
					}
					return nil, fmt.Errorf("[primeCache-apierror] GetPodByLabelFunc called for unexpected ID %s", labelSelectorMap["computeId"])
				}
				pm.GetPod(ctx, "id-api-error")
				mockOps.GetPodByLabelFunc = originalGetPodFunc
			},
			expectError: true,
			verifyCache: func(t *testing.T, pm *client.ComputeManager, mockOps *mockPodOperations, computeIDWhichFailedDeletion string) {
				// Pod should STILL be in cache because k8s API delete failed, and cache removal in DeletePod happens AFTER k8s call.
				getCalledForApiErrorPod := false
				mockOps.GetPodByLabelFunc = func(c context.Context, ns string, labelSelectorMap map[string]string) (*corev1.Pod, error) {
					if labelSelectorMap["computeId"] == computeIDWhichFailedDeletion {
						getCalledForApiErrorPod = true
						return podApiError, nil // Should not happen if cache hit
					}
					return nil, fmt.Errorf("[verifyCache-apierror] GetPodByLabelFunc called for unexpected ID %s", labelSelectorMap["computeId"])
				}
				info, err := pm.GetPod(ctx, computeIDWhichFailedDeletion)
				if err != nil {
					t.Errorf("Error getting pod %s which should have remained in cache: %v", computeIDWhichFailedDeletion, err)
				}
				if getCalledForApiErrorPod {
					t.Errorf("GetPodByLabelFunc was called for %s; expected cache hit as API delete failed", computeIDWhichFailedDeletion)
				}
				if info == nil || info.ComputeID != computeIDWhichFailedDeletion {
					t.Errorf("Pod %s data is incorrect or missing from cache after API delete error, got: %+v", computeIDWhichFailedDeletion, info)
				}
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			mockOps := &mockPodOperations{}
			pm := client.NewComputeManager(mockOps, namespace)

			if tc.primeCache != nil {
				tc.primeCache(pm, mockOps, tc.computeIDToDelete, "") // podNameToPrime not strictly needed with current primeCache logic
			}

			// This mockSetup must happen AFTER primeCache, as primeCache might use a generic GetPodByLabelFunc
			// and mockSetup for the test case needs to be specific for the DeletePod's internal GetPod call.
			if tc.mockSetup != nil {
				tc.mockSetup(mockOps, tc.computeIDToDelete)
			}

			err := pm.DeletePod(ctx, tc.computeIDToDelete)

			if tc.expectError {
				if err == nil {
					t.Fatalf("Expected an error, but got nil")
				}
			} else {
				if err != nil {
					t.Fatalf("Expected no error, but got: %v", err)
				}
			}

			if tc.verifyCache != nil {
				// Restore mockSetup after DeletePod call if verifyCache needs to re-mock GetPodByLabelFunc for its specific checks
				// This is handled inside verifyCache by setting mockOps.GetPodByLabelFunc as needed.
				tc.verifyCache(t, pm, mockOps, tc.computeIDToDelete)
			}
		})
	}
}

// TestIsPodReady remains relevant as it tests an exported utility function directly.
func TestIsPodReady(t *testing.T) {
	tests := []struct {
		name     string
		pod      *corev1.Pod
		expected bool
	}{
		{
			name: "pod is ready",
			pod: &corev1.Pod{
				Status: corev1.PodStatus{
					Conditions: []corev1.PodCondition{
						{Type: corev1.PodReady, Status: corev1.ConditionTrue},
					},
				},
			},
			expected: true,
		},
		{
			name: "pod is not ready",
			pod: &corev1.Pod{
				Status: corev1.PodStatus{
					Conditions: []corev1.PodCondition{
						{Type: corev1.PodReady, Status: corev1.ConditionFalse},
					},
				},
			},
			expected: false,
		},
		{
			name: "pod has no ready condition",
			pod: &corev1.Pod{
				Status: corev1.PodStatus{
					Conditions: []corev1.PodCondition{
						{Type: corev1.PodInitialized, Status: corev1.ConditionTrue},
					},
				},
			},
			expected: false,
		},
		{
			name: "pod has no conditions",
			pod: &corev1.Pod{
				Status: corev1.PodStatus{},
			},
			expected: false,
		},
		{
			name:     "nil pod",
			pod:      nil,
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := client.IsPodReady(tt.pod); got != tt.expected {
				t.Errorf("IsPodReady() = %v, want %v", got, tt.expected)
			}
		})
	}
}
