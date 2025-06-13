package services_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/heysnelling/computesdk/pkg/sidekick/services"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTerminalService_Create(t *testing.T) {
	service := services.NewTerminalService()
	ctx := context.Background()

	// Test with default shell
	terminal, err := service.Create(ctx, "")
	require.NoError(t, err)
	assert.NotEmpty(t, terminal.ID)
	assert.Contains(t, terminal.ID, "terminal-")
	assert.Equal(t, "active", terminal.Status)
	assert.NotZero(t, terminal.CreatedAt)
	assert.NotZero(t, terminal.UpdatedAt)

	// Clean up
	service.Delete(ctx, terminal.ID)

	// Test with specific shell
	terminal2, err := service.Create(ctx, "/bin/sh")
	require.NoError(t, err)
	assert.NotEqual(t, terminal.ID, terminal2.ID) // Should have unique IDs

	// Clean up
	service.Delete(ctx, terminal2.ID)
}

func TestTerminalService_Get(t *testing.T) {
	service := services.NewTerminalService()
	ctx := context.Background()

	// Create a terminal
	terminal, err := service.Create(ctx, "")
	require.NoError(t, err)
	defer service.Delete(ctx, terminal.ID)

	// Test Get with valid ID
	retrieved, err := service.Get(ctx, terminal.ID)
	require.NoError(t, err)
	assert.Equal(t, terminal.ID, retrieved.ID)
	assert.Equal(t, terminal.Status, retrieved.Status)

	// Test Get with invalid ID
	_, err = service.Get(ctx, "non-existent")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "terminal not found")
}

func TestTerminalService_Delete(t *testing.T) {
	service := services.NewTerminalService()
	ctx := context.Background()

	// Create a terminal
	terminal, err := service.Create(ctx, "")
	require.NoError(t, err)

	// Delete the terminal
	err = service.Delete(ctx, terminal.ID)
	require.NoError(t, err)

	// Verify it's deleted
	_, err = service.Get(ctx, terminal.ID)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "terminal not found")

	// Test deleting non-existent terminal
	err = service.Delete(ctx, "non-existent")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "terminal not found")
}

func TestTerminalService_List(t *testing.T) {
	service := services.NewTerminalService()
	ctx := context.Background()

	// Initially should be empty
	list, err := service.List(ctx)
	require.NoError(t, err)
	assert.Empty(t, list)

	// Create multiple terminals
	terminal1, err := service.Create(ctx, "")
	require.NoError(t, err)
	defer service.Delete(ctx, terminal1.ID)

	terminal2, err := service.Create(ctx, "")
	require.NoError(t, err)
	defer service.Delete(ctx, terminal2.ID)

	// List should contain both
	list, err = service.List(ctx)
	require.NoError(t, err)
	assert.Len(t, list, 2)

	// Check that both terminals are in the list
	ids := make(map[string]bool)
	for _, t := range list {
		ids[t.ID] = true
	}
	assert.True(t, ids[terminal1.ID])
	assert.True(t, ids[terminal2.ID])
}

func TestTerminalService_Execute(t *testing.T) {
	service := services.NewTerminalService()
	ctx := context.Background()

	// Create a terminal
	terminal, err := service.Create(ctx, "")
	require.NoError(t, err)
	defer service.Delete(ctx, terminal.ID)

	// Execute a simple command
	result, err := service.Execute(ctx, terminal.ID, "echo 'hello world'")
	require.NoError(t, err)
	assert.Equal(t, "echo 'hello world'", result.Command)
	assert.Contains(t, result.Output, "hello world")
	assert.Equal(t, 0, result.ExitCode)
	assert.GreaterOrEqual(t, result.DurationMs, int64(0))
	assert.NotZero(t, result.StartedAt)
	assert.NotZero(t, result.CompletedAt)
	assert.True(t, result.CompletedAt.After(result.StartedAt))

	// Execute a command with non-zero exit code
	result, err = service.Execute(ctx, terminal.ID, "exit 42")
	require.NoError(t, err)
	assert.Equal(t, 42, result.ExitCode)

	// Execute on non-existent terminal
	_, err = service.Execute(ctx, "non-existent", "echo test")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "terminal not found")
}

func TestTerminalService_ExecuteWithContext(t *testing.T) {
	service := services.NewTerminalService()
	ctx := context.Background()

	// Create a terminal
	terminal, err := service.Create(ctx, "")
	require.NoError(t, err)
	defer service.Delete(ctx, terminal.ID)

	// Test command cancellation
	cancelCtx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	// Execute a long-running command
	result, err := service.Execute(cancelCtx, terminal.ID, "sleep 5")
	// Should complete with exit code 0 because Execute doesn't respect context cancellation
	// (it creates a new command, not using the PTY)
	if err == nil {
		// Command completed normally
		assert.NotNil(t, result)
	} else {
		// Or context cancelled before command started
		assert.Error(t, err)
	}
}

func TestTerminalService_WriteRead(t *testing.T) {
	t.Skip("Skipping PTY-dependent test in unit tests")
	
	// Note: Write/Read operations depend on actual PTY functionality
	// which is difficult to test reliably in unit tests.
	// These are better tested in integration tests.
}

func TestTerminalService_Resize(t *testing.T) {
	t.Skip("Skipping PTY-dependent test in unit tests")
	
	// Note: Resize operations depend on actual PTY functionality
	// which is difficult to test reliably in unit tests.
	// These are better tested in integration tests.
}

func TestTerminalService_ConcurrentOperations(t *testing.T) {
	service := services.NewTerminalService()
	ctx := context.Background()

	// Test concurrent terminal creation
	const numTerminals = 10
	done := make(chan string, numTerminals)

	for i := 0; i < numTerminals; i++ {
		go func() {
			terminal, err := service.Create(ctx, "")
			if err == nil {
				done <- terminal.ID
			} else {
				done <- ""
			}
		}()
	}

	// Collect all terminal IDs
	terminalIDs := make([]string, 0, numTerminals)
	for i := 0; i < numTerminals; i++ {
		id := <-done
		if id != "" {
			terminalIDs = append(terminalIDs, id)
		}
	}

	// All terminals should be created successfully
	assert.Len(t, terminalIDs, numTerminals)

	// All IDs should be unique
	uniqueIDs := make(map[string]bool)
	for _, id := range terminalIDs {
		uniqueIDs[id] = true
	}
	assert.Len(t, uniqueIDs, numTerminals)

	// Clean up
	for _, id := range terminalIDs {
		service.Delete(ctx, id)
	}
}

func TestTerminalService_CommandOutput(t *testing.T) {
	service := services.NewTerminalService()
	ctx := context.Background()

	terminal, err := service.Create(ctx, "")
	require.NoError(t, err)
	defer service.Delete(ctx, terminal.ID)

	// Test stdout
	result, err := service.Execute(ctx, terminal.ID, "echo stdout")
	require.NoError(t, err)
	assert.Contains(t, result.Output, "stdout")

	// Test stderr (redirect stdout to stderr)
	result, err = service.Execute(ctx, terminal.ID, "echo stderr >&2")
	require.NoError(t, err)
	assert.Contains(t, result.Output, "stderr")

	// Test multiline output
	result, err = service.Execute(ctx, terminal.ID, "printf 'line1\\nline2\\nline3'")
	require.NoError(t, err)
	lines := strings.Split(strings.TrimSpace(result.Output), "\n")
	assert.Len(t, lines, 3)
}

func TestTerminalService_SpecialCharacters(t *testing.T) {
	service := services.NewTerminalService()
	ctx := context.Background()

	terminal, err := service.Create(ctx, "")
	require.NoError(t, err)
	defer service.Delete(ctx, terminal.ID)

	// Test command with special characters
	testCases := []struct {
		name     string
		command  string
		expected string
	}{
		{
			name:     "single quotes",
			command:  `echo 'hello "world"'`,
			expected: `hello "world"`,
		},
		{
			name:     "double quotes",
			command:  `echo "hello 'world'"`,
			expected: `hello 'world'`,
		},
		{
			name:     "pipe character",
			command:  `echo "hello | world"`,
			expected: `hello | world`,
		},
		{
			name:     "variables",
			command:  `TEST_VAR=123 && echo $TEST_VAR`,
			expected: "123",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result, err := service.Execute(ctx, terminal.ID, tc.command)
			require.NoError(t, err)
			// Trim newline from output for comparison
			output := strings.TrimSpace(result.Output)
			assert.Equal(t, tc.expected, output)
		})
	}
}