package chronicle_test

func Example_completeLifecycle() {
	// This example shows the clean separation between writing (events) and reading (state)

	// Initialize (in real code, use actual DB)
	// db := // ... your GORM connection
	// eventStore, _ := chronicle.NewPostgresEventStore(db)
	// repo := chronicle.NewEventStoreRepository(eventStore)
	// chronicle.RegisterChronicleType(repo, "server")

	// CREATE: Track creation with initial data
	/*
		server := chronicle.NewChronicle("server", repo)
		server.TrackCreate(map[string]any{
			"name":         "api-server-01",
			"environment": "production",
			"cpuCores":    4,
			"memoryGB":    16,
			"status":      "provisioning",
		})
		server.Save(ctx)
		serverID := server.GetID()

		// READ: Get current state using reflection
		var name string
		server.State("name", &name)  // name = "api-server-01"

		var cores int
		server.State("cpuCores", &cores)  // cores = 4

		// Or read all state at once
		type ServerState struct {
			Name        string `json:"name"`
			Environment string `json:"environment"`
			CPUCores    int    `json:"cpuCores"`
			MemoryGB    int    `json:"memoryGB"`
			Status      string `json:"status"`
		}

		var state ServerState
		server.StateAll(&state)
		fmt.Printf("%s: %d cores, %s\n", state.Name, state.CPUCores, state.Status)

		// UPDATE: Track changes through domain events
		server.TrackChange("ProvisioningCompleted", map[string]any{
			"status":    "running",
			"ipAddress": "10.0.1.42",
			"startedAt": time.Now(),
		})
		server.Save(ctx)

		// State is automatically updated
		server.State("status", &status)  // status = "running"

		// SCALE: Track configuration changes
		server.TrackChange("ResourcesScaled", map[string]any{
			"cpuCores":       8,
			"memoryGB":       32,
			"scaledBy":       "autoscaler",
			"reason":         "high CPU usage detected",
			"previousCores":  4,
			"previousMemory": 16,
		})
		server.Save(ctx)

		// DELETE: Track deletion with context
		server.TrackDelete("decommissioned - migrated to new cluster")
		server.Save(ctx)

		// Check if deleted
		if server.IsDeleted() {
			fmt.Println("Server has been deleted")
		}

		// RELOAD: Load from event history
		loadedServer, _ := chronicle.Load(ctx, repo, serverID, "server")

		// All state is reconstructed from events
		var finalState ServerState
		loadedServer.StateAll(&finalState)
		// finalState now contains the complete current state
	*/
}

func Example_eventBatching() {
	// Events can be batched before saving
	/*
		deployment := chronicle.NewChronicle("deployment", repo)

		// Track multiple events before saving
		deployment.TrackCreate(map[string]any{
			"appName": "frontend",
			"version": "1.0.0",
			"replicas": 3,
		})

		deployment.TrackChange("ImageUpdated", map[string]any{
			"image": "frontend:1.0.1",
			"updatedBy": "CI/CD pipeline",
		})

		deployment.TrackChange("ReplicasScaled", map[string]any{
			"replicas": 5,
			"reason": "preparing for traffic spike",
		})

		// All events saved in one transaction
		deployment.Save(ctx)
		// Version is now 3 (one for each event)
	*/
}
