package client

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/api/errors" // For checking "not found" errors
	// appsv1 "k8s.io/api/apps/v1" // Already available via fixtures.go in package client
	// metav1 "k8s.io/apimachinery/pkg/apis/meta/v1" // Already available via fixtures.go
)

func TestGetDeployment(t *testing.T) {
	ctx := context.Background()
	testNamespace := "test-deploy-ns"
	deploymentName := "my-test-deployment"
	var replicas int32 = 3
	podLabels := map[string]string{"app": "my-test-app"}

	// 1. Create a test Deployment object using your fixture
	testDeployment := CreateTestDeployment(deploymentName, testNamespace, replicas, podLabels)

	// 2. Create a new test client using NewTestClients, preloading the fake clientset with our testDeployment
	client, _, err := NewTestClients(testNamespace, testDeployment)
	require.NoError(t, err, "NewTestClients should not return an error")
	require.NotNil(t, client, "Client from NewTestClients should not be nil")

	// 3. Use the client to get the Deployment
	retrievedDeployment, err := client.GetDeployment(ctx, testNamespace, deploymentName)
	require.NoError(t, err, "GetDeployment should not return an error when deployment exists")
	require.NotNil(t, retrievedDeployment, "GetDeployment should return a deployment")

	// 4. Assert that the retrieved Deployment matches what we expect
	assert.Equal(t, deploymentName, retrievedDeployment.Name, "Deployment name mismatch")
	assert.Equal(t, testNamespace, retrievedDeployment.Namespace, "Deployment namespace mismatch")
	require.NotNil(t, retrievedDeployment.Spec.Replicas, "Deployment spec replicas should not be nil")
	assert.Equal(t, replicas, *retrievedDeployment.Spec.Replicas, "Deployment replicas mismatch")
	assert.Equal(t, podLabels, retrievedDeployment.Spec.Selector.MatchLabels, "Deployment selector labels mismatch")
	assert.Equal(t, podLabels, retrievedDeployment.Spec.Template.Labels, "Deployment template pod labels mismatch")
}

// You can add more tests here for other scenarios, e.g.:
// - TestGetDeployment_NotFound
// - Tests for ListDeployments once implemented
// - Tests for Create/Update/Delete Deployments once implemented

func TestListDeployments(t *testing.T) {
	ctx := context.Background()
	testNamespace := "list-deploy-ns"
	otherNamespace := "other-ns"
	
	labelsMatch := map[string]string{"env": "test", "app": "service-a"}
	labelsNoMatch := map[string]string{"env": "prod", "app": "service-b"}
	labelsPartialMatch := map[string]string{"env": "test", "app": "service-c"} // Shares 'env' but not 'app'

	// Create deployments
	dep1 := CreateTestDeployment("deploy1", testNamespace, 1, labelsMatch)
	dep2 := CreateTestDeployment("deploy2", testNamespace, 2, labelsMatch)
	dep3NoMatch := CreateTestDeployment("deploy3", testNamespace, 1, labelsNoMatch)
	dep4PartialMatch := CreateTestDeployment("deploy4", testNamespace, 1, labelsPartialMatch)
	depInOtherNS := CreateTestDeployment("deploy5", otherNamespace, 1, labelsMatch)

	client, _, err := NewTestClients(testNamespace, dep1, dep2, dep3NoMatch, dep4PartialMatch, depInOtherNS)
	require.NoError(t, err)

	t.Run("list with matching labels", func(t *testing.T) {
		deploymentList, err := client.ListDeployments(ctx, testNamespace, labelsMatch)
		require.NoError(t, err)
		require.NotNil(t, deploymentList)
		assert.Len(t, deploymentList.Items, 2, "Should list 2 deployments with matching labels in the namespace")

		// Verify the names (order isn't guaranteed, so check for presence)
		foundDep1 := false
		foundDep2 := false
		for _, d := range deploymentList.Items {
			if d.Name == dep1.Name {
				foundDep1 = true
			}
			if d.Name == dep2.Name {
				foundDep2 = true
			}
			assert.Equal(t, testNamespace, d.Namespace, "Deployment should be in the correct namespace")
		}
		assert.True(t, foundDep1, "deploy1 not found in list")
		assert.True(t, foundDep2, "deploy2 not found in list")
	})

	t.Run("list with no matching labels", func(t *testing.T) {
		nonExistentLabels := map[string]string{"app": "non-existent"}
		deploymentList, err := client.ListDeployments(ctx, testNamespace, nonExistentLabels)
		require.NoError(t, err)
		require.NotNil(t, deploymentList)
		assert.Len(t, deploymentList.Items, 0, "Should list 0 deployments for non-existent labels")
	})
	
	t.Run("list with nil labels (all in namespace)", func(t *testing.T) {
		deploymentList, err := client.ListDeployments(ctx, testNamespace, nil)
		require.NoError(t, err)
		require.NotNil(t, deploymentList)
		// Should include dep1, dep2, dep3NoMatch, dep4PartialMatch (4 total in testNamespace)
		assert.Len(t, deploymentList.Items, 4, "Should list all 4 deployments in the namespace when labels are nil")
	})

	t.Run("list with empty map labels (all in namespace)", func(t *testing.T) {
		deploymentList, err := client.ListDeployments(ctx, testNamespace, map[string]string{})
		require.NoError(t, err)
		require.NotNil(t, deploymentList)
		assert.Len(t, deploymentList.Items, 4, "Should list all 4 deployments in the namespace when labels are an empty map")
	})
}

func TestCreateDeployment(t *testing.T) {
	ctx := context.Background()
	testNamespace := "create-deploy-ns"
	deploymentName := "newly-created-deployment"
	var replicas int32 = 2
	podLabels := map[string]string{"app": "new-app", "tier": "backend"}

	// 1. Define the deployment to be created using the fixture
	// Note: The fixture sets the namespace, but CreateDeployment will also set/verify it.
	deploymentToCreate := CreateTestDeployment(deploymentName, testNamespace, replicas, podLabels)
	
	// 2. Create a new test client. No initial objects are needed for a create test.
	client, _, err := NewTestClients(testNamespace) // No initial objects
	require.NoError(t, err, "NewTestClients should not return an error")
	require.NotNil(t, client, "Client from NewTestClients should not be nil")

	// 3. Call CreateDeployment
	createdDeployment, err := client.CreateDeployment(ctx, testNamespace, deploymentToCreate)
	require.NoError(t, err, "CreateDeployment should not return an error")
	require.NotNil(t, createdDeployment, "CreateDeployment should return the created deployment")

	// 4. Assert properties of the created deployment
	assert.Equal(t, deploymentName, createdDeployment.Name, "Created deployment name mismatch")
	assert.Equal(t, testNamespace, createdDeployment.Namespace, "Created deployment namespace mismatch")
	require.NotNil(t, createdDeployment.Spec.Replicas, "Created deployment spec replicas should not be nil")
	assert.Equal(t, replicas, *createdDeployment.Spec.Replicas, "Created deployment replicas mismatch")
	assert.Equal(t, podLabels, createdDeployment.Spec.Selector.MatchLabels, "Created deployment selector labels mismatch")
	assert.Equal(t, podLabels, createdDeployment.Spec.Template.Labels, "Created deployment template pod labels mismatch")

	// 5. (Optional but good) Verify by trying to Get the deployment
	retrievedDeployment, err := client.GetDeployment(ctx, testNamespace, deploymentName)
	require.NoError(t, err, "GetDeployment after create should not return an error")
	require.NotNil(t, retrievedDeployment, "GetDeployment after create should return the deployment")
	assert.Equal(t, deploymentName, retrievedDeployment.Name, "Retrieved deployment name mismatch after create")
}

func TestUpdateDeployment(t *testing.T) {
	ctx := context.Background()
	testNamespace := "update-deploy-ns"
	deploymentName := "updatable-deployment"
	initialReplicas := int32(2)
	updatedReplicas := int32(5)
	initialImage := "nginx:1.21"
	updatedImage := "nginx:1.23-alpine"
	podLabels := map[string]string{"app": "app-to-update"}

	// 1. Create and add an initial deployment
	initialDeployment := CreateTestDeployment(deploymentName, testNamespace, initialReplicas, podLabels)
	initialDeployment.Spec.Template.Spec.Containers[0].Image = initialImage // Assuming one container from fixture

	client, _, err := NewTestClients(testNamespace, initialDeployment)
	require.NoError(t, err, "NewTestClients should not return an error")

	// 2. Modify the deployment for update
	// It's important to get the existing deployment first, modify it, and then update.
	// This simulates a real workflow where you fetch, modify, and then apply.
	// The fake clientset might not strictly require this for an update to "succeed",
	// but it's good practice. For this test, we'll directly modify our 'initialDeployment' copy.
	deploymentToUpdate := initialDeployment.DeepCopy() // Work on a copy
	deploymentToUpdate.Spec.Replicas = &updatedReplicas
	deploymentToUpdate.Spec.Template.Spec.Containers[0].Image = updatedImage

	// 3. Call UpdateDeployment
	updatedDeployment, err := client.UpdateDeployment(ctx, testNamespace, deploymentToUpdate)
	require.NoError(t, err, "UpdateDeployment should not return an error")
	require.NotNil(t, updatedDeployment, "UpdateDeployment should return the updated deployment")

	// 4. Assert properties of the updated deployment returned by UpdateDeployment
	assert.Equal(t, deploymentName, updatedDeployment.Name)
	assert.Equal(t, testNamespace, updatedDeployment.Namespace)
	require.NotNil(t, updatedDeployment.Spec.Replicas, "Updated deployment spec replicas should not be nil")
	assert.Equal(t, updatedReplicas, *updatedDeployment.Spec.Replicas, "Replicas not updated as expected")
	require.NotEmpty(t, updatedDeployment.Spec.Template.Spec.Containers, "Updated deployment should have containers")
	assert.Equal(t, updatedImage, updatedDeployment.Spec.Template.Spec.Containers[0].Image, "Container image not updated as expected")

	// 5. Get the deployment again and verify changes persist
	retrievedDeployment, err := client.GetDeployment(ctx, testNamespace, deploymentName)
	require.NoError(t, err, "GetDeployment after update should not return an error")
	require.NotNil(t, retrievedDeployment, "GetDeployment after update should return a deployment")
	require.NotNil(t, retrievedDeployment.Spec.Replicas, "Retrieved deployment spec replicas should not be nil")
	assert.Equal(t, updatedReplicas, *retrievedDeployment.Spec.Replicas, "Persisted replicas do not match updated value")
	require.NotEmpty(t, retrievedDeployment.Spec.Template.Spec.Containers, "Retrieved deployment should have containers")
	assert.Equal(t, updatedImage, retrievedDeployment.Spec.Template.Spec.Containers[0].Image, "Persisted container image does not match updated value")
}

func TestDeleteDeployment(t *testing.T) {
	ctx := context.Background()
	testNamespace := "delete-deploy-ns"
	deploymentName := "deletable-deployment"
	nonExistentDeploymentName := "i-do-not-exist"

	// 1. Create and add an initial deployment
	deploymentToDelete := CreateTestDeployment(deploymentName, testNamespace, 1, map[string]string{"app": "delete-me"})

	client, _, err := NewTestClients(testNamespace, deploymentToDelete)
	require.NoError(t, err, "NewTestClients should not return an error")

	// 2. Delete the existing deployment
	err = client.DeleteDeployment(ctx, testNamespace, deploymentName)
	require.NoError(t, err, "DeleteDeployment on existing deployment should not return an error")

	// 3. Attempt to Get the deleted deployment and verify it's not found
	_, err = client.GetDeployment(ctx, testNamespace, deploymentName)
	require.Error(t, err, "GetDeployment after delete should return an error")
	assert.True(t, errors.IsNotFound(err), "Error should be a 'NotFound' error")

	// 4. Delete a non-existent deployment (should not error)
	err = client.DeleteDeployment(ctx, testNamespace, nonExistentDeploymentName)
	require.NoError(t, err, "DeleteDeployment on non-existent deployment should not return an error")
}
