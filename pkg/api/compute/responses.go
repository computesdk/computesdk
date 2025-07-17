package compute

import (
	"time"

	"github.com/heysnelling/computesdk/pkg/managers"
)

// PresetResponse represents a preset in API responses
type PresetResponse struct {
	PresetID    string                 `json:"preset_id"`
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	Version     string                 `json:"version"`
	Template    PresetTemplateResponse `json:"template"`
	Resources   ResourcesResponse      `json:"resources"`
	CreatedAt   time.Time              `json:"created_at"`
	UpdatedAt   time.Time              `json:"updated_at"`
	Labels      map[string]string      `json:"labels,omitempty"`
}

// PresetTemplateResponse represents a preset template in API responses
type PresetTemplateResponse struct {
	Image           string            `json:"image"`
	ImagePullPolicy string            `json:"image_pull_policy,omitempty"`
	Command         []string          `json:"command,omitempty"`
	Args            []string          `json:"args,omitempty"`
	Env             map[string]string `json:"env,omitempty"`
	Ports           []PortResponse    `json:"ports,omitempty"`
	WorkingDir      string            `json:"working_dir,omitempty"`
}

// PortResponse represents a port in API responses
type PortResponse struct {
	Name          string `json:"name"`
	ContainerPort int32  `json:"container_port"`
	Protocol      string `json:"protocol"`
}

// ResourcesResponse represents resources in API responses
type ResourcesResponse struct {
	Requests map[string]string `json:"requests,omitempty"`
	Limits   map[string]string `json:"limits,omitempty"`
}

// PresetListResponse represents the response for listing presets
type PresetListResponse struct {
	Presets []PresetResponse `json:"presets"`
	Total   int              `json:"total"`
}

// Helper functions to convert from manager types to API response types

func presetInfoToResponse(preset *managers.PresetInfo) *PresetResponse {
	if preset == nil {
		return nil
	}

	// Convert environment variables from []EnvVar to map[string]string
	envMap := make(map[string]string)
	for _, env := range preset.Template.Env {
		envMap[env.Name] = env.Value
	}

	// Convert ports
	var ports []PortResponse
	for _, port := range preset.Template.Ports {
		ports = append(ports, PortResponse{
			Name:          port.Name,
			ContainerPort: port.ContainerPort,
			Protocol:      string(port.Protocol),
		})
	}

	// Convert resources to string maps
	requests := make(map[string]string)
	limits := make(map[string]string)

	for k, v := range preset.Resources.Requests {
		requests[string(k)] = v.String()
	}
	for k, v := range preset.Resources.Limits {
		limits[string(k)] = v.String()
	}

	return &PresetResponse{
		PresetID:    preset.PresetID,
		Name:        preset.Name,
		Description: preset.Description,
		Version:     preset.Version,
		Template: PresetTemplateResponse{
			Image:           preset.Template.Image,
			ImagePullPolicy: string(preset.Template.ImagePullPolicy),
			Command:         preset.Template.Command,
			Args:            preset.Template.Args,
			Env:             envMap,
			Ports:           ports,
			WorkingDir:      preset.Template.WorkingDir,
		},
		Resources: ResourcesResponse{
			Requests: requests,
			Limits:   limits,
		},
		CreatedAt: preset.CreatedAt,
		UpdatedAt: preset.UpdatedAt,
		Labels:    preset.Labels,
	}
}

func presetListToResponse(presets []*managers.PresetInfo) *PresetListResponse {
	response := &PresetListResponse{
		Presets: make([]PresetResponse, 0, len(presets)),
		Total:   len(presets),
	}

	for _, preset := range presets {
		if converted := presetInfoToResponse(preset); converted != nil {
			response.Presets = append(response.Presets, *converted)
		}
	}

	return response
}
