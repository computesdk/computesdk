package services

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"sync"
	"time"

	"github.com/creack/pty"
)

// Terminal represents an active terminal session
type Terminal struct {
	ID        string
	Status    string
	CreatedAt time.Time
	UpdatedAt time.Time
	pty       *os.File
	cmd       *exec.Cmd
	mu        sync.Mutex
}

// CommandResult represents the result of executing a command
type CommandResult struct {
	Command     string
	Output      string
	ExitCode    int
	DurationMs  int64
	StartedAt   time.Time
	CompletedAt time.Time
}

// TerminalService defines the interface for terminal operations
type TerminalService interface {
	Create(ctx context.Context, shell string) (*Terminal, error)
	Get(ctx context.Context, id string) (*Terminal, error)
	Delete(ctx context.Context, id string) error
	Execute(ctx context.Context, id string, command string) (*CommandResult, error)
	Write(ctx context.Context, id string, data []byte) (int, error)
	Read(ctx context.Context, id string, buffer []byte) (int, error)
	Resize(ctx context.Context, id string, rows, cols uint16) error
	List(ctx context.Context) ([]*Terminal, error)
}

// terminalService implements TerminalService
type terminalService struct {
	terminals map[string]*Terminal
	mu        sync.RWMutex
}

// NewTerminalService creates a new terminal service
func NewTerminalService() TerminalService {
	return &terminalService{
		terminals: make(map[string]*Terminal),
	}
}

// Create creates a new terminal session with PTY
func (s *terminalService) Create(ctx context.Context, shell string) (*Terminal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if shell == "" {
		shell = os.Getenv("SHELL")
		if shell == "" {
			shell = "/bin/sh"
		}
	}

	cmd := exec.Command(shell)
	cmd.Env = os.Environ()

	// Start command with PTY
	ptyFile, err := pty.Start(cmd)
	if err != nil {
		return nil, fmt.Errorf("failed to start PTY: %w", err)
	}

	terminal := &Terminal{
		ID:        fmt.Sprintf("terminal-%d", time.Now().UnixNano()),
		Status:    "active",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
		pty:       ptyFile,
		cmd:       cmd,
	}

	s.terminals[terminal.ID] = terminal
	return terminal, nil
}

// Get retrieves a terminal by ID
func (s *terminalService) Get(ctx context.Context, id string) (*Terminal, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	terminal, exists := s.terminals[id]
	if !exists {
		return nil, fmt.Errorf("terminal not found: %s", id)
	}

	return terminal, nil
}

// Delete removes a terminal session
func (s *terminalService) Delete(ctx context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	terminal, exists := s.terminals[id]
	if !exists {
		return fmt.Errorf("terminal not found: %s", id)
	}

	// Clean up PTY and process
	terminal.mu.Lock()
	if terminal.pty != nil {
		terminal.pty.Close()
	}
	if terminal.cmd != nil && terminal.cmd.Process != nil {
		terminal.cmd.Process.Kill()
	}
	terminal.mu.Unlock()

	delete(s.terminals, id)
	return nil
}

// Execute runs a command in the terminal session
func (s *terminalService) Execute(ctx context.Context, id string, command string) (*CommandResult, error) {
	// Verify terminal exists
	if _, err := s.Get(ctx, id); err != nil {
		return nil, err
	}

	startTime := time.Now()

	// Create command with context for cancellation
	cmd := exec.CommandContext(ctx, "sh", "-c", command)

	// Capture stdout and stderr
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	// Execute the command
	err := cmd.Run()

	// Get exit code
	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			// Command failed to start or other error
			return nil, fmt.Errorf("failed to execute command: %w", err)
		}
	}

	completedTime := time.Now()
	duration := completedTime.Sub(startTime)

	// Combine stdout and stderr
	output := stdout.String()
	if stderr.String() != "" {
		output += stderr.String()
	}

	return &CommandResult{
		Command:     command,
		Output:      output,
		ExitCode:    exitCode,
		DurationMs:  duration.Milliseconds(),
		StartedAt:   startTime,
		CompletedAt: completedTime,
	}, nil
}

// List returns all active terminals
func (s *terminalService) List(ctx context.Context) ([]*Terminal, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	terminals := make([]*Terminal, 0, len(s.terminals))
	for _, terminal := range s.terminals {
		terminals = append(terminals, terminal)
	}

	return terminals, nil
}

// Write sends data to the terminal PTY
func (s *terminalService) Write(ctx context.Context, id string, data []byte) (int, error) {
	terminal, err := s.Get(ctx, id)
	if err != nil {
		return 0, err
	}

	terminal.mu.Lock()
	defer terminal.mu.Unlock()

	if terminal.pty == nil {
		return 0, fmt.Errorf("terminal PTY not available")
	}

	return terminal.pty.Write(data)
}

// Read reads data from the terminal PTY
func (s *terminalService) Read(ctx context.Context, id string, buffer []byte) (int, error) {
	terminal, err := s.Get(ctx, id)
	if err != nil {
		return 0, err
	}

	terminal.mu.Lock()
	defer terminal.mu.Unlock()

	if terminal.pty == nil {
		return 0, fmt.Errorf("terminal PTY not available")
	}

	return terminal.pty.Read(buffer)
}

// Resize changes the terminal size
func (s *terminalService) Resize(ctx context.Context, id string, rows, cols uint16) error {
	terminal, err := s.Get(ctx, id)
	if err != nil {
		return err
	}

	terminal.mu.Lock()
	defer terminal.mu.Unlock()

	if terminal.pty == nil {
		return fmt.Errorf("terminal PTY not available")
	}

	return pty.Setsize(terminal.pty, &pty.Winsize{
		Rows: rows,
		Cols: cols,
	})
}
