package managers

import (
	"errors"
	"fmt"
)

// Manager-specific error types
var (
	// Compute errors
	ErrComputeNotFound     = errors.New("compute instance not found")
	ErrComputeNotReady     = errors.New("compute instance not ready")
	ErrInvalidComputeSpec  = errors.New("invalid compute specification")
	ErrComputeCreateFailed = errors.New("failed to create compute instance")
	ErrComputeDeleteFailed = errors.New("failed to delete compute instance")

	// Preset errors
	ErrPresetNotFound     = errors.New("preset not found")
	ErrPresetInUse        = errors.New("preset is in use by running computes")
	ErrInvalidPresetSpec  = errors.New("invalid preset specification")
	ErrPresetCreateFailed = errors.New("failed to create preset")
	ErrPresetUpdateFailed = errors.New("failed to update preset")
	ErrPresetDeleteFailed = errors.New("failed to delete preset")

	// Validation errors
	ErrMissingPresetID     = errors.New("preset ID is required")
	ErrMissingComputeID    = errors.New("compute ID is required")
	ErrMissingPresetName   = errors.New("preset name is required")
	ErrMissingImage        = errors.New("preset template image is required")
	ErrInvalidResourceSpec = errors.New("invalid resource specification")

	// Deployment errors
	ErrDeploymentNotFound    = errors.New("deployment not found")
	ErrDeploymentScaleFailed = errors.New("failed to scale deployment")
	ErrPodNotFound           = errors.New("pod not found")
)

// ComputeError wraps errors with compute context
type ComputeError struct {
	ComputeID string
	Op        string
	Err       error
}

func (e *ComputeError) Error() string {
	return fmt.Sprintf("compute %s %s: %v", e.ComputeID, e.Op, e.Err)
}

func (e *ComputeError) Unwrap() error {
	return e.Err
}

// PresetError wraps errors with preset context
type PresetError struct {
	PresetID string
	Op       string
	Err      error
}

func (e *PresetError) Error() string {
	return fmt.Sprintf("preset %s %s: %v", e.PresetID, e.Op, e.Err)
}

func (e *PresetError) Unwrap() error {
	return e.Err
}

// ValidationError represents validation failures
type ValidationError struct {
	Field   string
	Value   interface{}
	Message string
}

func (e *ValidationError) Error() string {
	return fmt.Sprintf("validation failed for field '%s' with value '%v': %s", e.Field, e.Value, e.Message)
}

// Helper functions for creating wrapped errors

func NewComputeError(computeID, op string, err error) error {
	return &ComputeError{
		ComputeID: computeID,
		Op:        op,
		Err:       err,
	}
}

func NewPresetError(presetID, op string, err error) error {
	return &PresetError{
		PresetID: presetID,
		Op:       op,
		Err:      err,
	}
}

func NewValidationError(field string, value interface{}, message string) error {
	return &ValidationError{
		Field:   field,
		Value:   value,
		Message: message,
	}
}

// IsComputeNotFound checks if error is compute not found
func IsComputeNotFound(err error) bool {
	return errors.Is(err, ErrComputeNotFound)
}

// IsPresetNotFound checks if error is preset not found
func IsPresetNotFound(err error) bool {
	return errors.Is(err, ErrPresetNotFound)
}

// IsValidationError checks if error is a validation error
func IsValidationError(err error) bool {
	var validationErr *ValidationError
	return errors.As(err, &validationErr)
}

// IsPresetInUse checks if error is preset in use
func IsPresetInUse(err error) bool {
	return errors.Is(err, ErrPresetInUse)
}
