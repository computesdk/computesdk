package managers

import (
	"context"
	"fmt"

	corev1 "k8s.io/api/core/v1"
)

// DefaultPresetID is the default preset used when none is specified
const DefaultPresetID = "default"

// GetDefaultPresets returns the default preset specifications
func GetDefaultPresets() []PresetSpec {
	return []PresetSpec{
		{
			PresetID:    "default",
			Name:        "Default Sandbox",
			Description: "Default sandbox environment with Node.js, Python, and dev tools",
			Version:     "1.2.0",
			Template: PresetTemplate{
				Image:           "node:18-bullseye",
				ImagePullPolicy: corev1.PullIfNotPresent,
				Command:         []string{"/bin/bash"},
				Args:            []string{"-c", "apt-get update && apt-get install -y python3 python3-pip python3-venv git curl wget vim nano && npm install -g nodemon typescript ts-node && sleep infinity"},
				Env: []corev1.EnvVar{
					{Name: "NODE_ENV", Value: "development"},
					{Name: "DEBIAN_FRONTEND", Value: "noninteractive"},
					{Name: "PYTHONUNBUFFERED", Value: "1"},
				},
				Ports: []corev1.ContainerPort{
					{Name: "http", ContainerPort: 3000, Protocol: corev1.ProtocolTCP},
					{Name: "api", ContainerPort: 8000, Protocol: corev1.ProtocolTCP},
					{Name: "debug", ContainerPort: 9229, Protocol: corev1.ProtocolTCP},
					{Name: "vite", ContainerPort: 5173, Protocol: corev1.ProtocolTCP},
				},
			},
			Resources: ResourceRequirements{
				Requests: NewResourceList("200m", "256Mi"),
				Limits:   NewResourceList("1000m", "1Gi"),
			},
			Labels: map[string]string{
				"preset-type": "default",
				"managed-by":  "computesdk",
				"runtime":     "node-python",
			},
		}, // Additional useful presets
		{
			PresetID:    "web-server",
			Name:        "Web Server",
			Description: "Nginx web server for hosting static content or reverse proxy",
			Version:     "1.0.0",
			Template: PresetTemplate{
				Image:           "nginx:alpine",
				ImagePullPolicy: corev1.PullIfNotPresent,
				Ports: []corev1.ContainerPort{
					{Name: "http", ContainerPort: 80, Protocol: corev1.ProtocolTCP},
				},
				Env: []corev1.EnvVar{
					{Name: "NGINX_PORT", Value: "80"},
				},
			},
			Resources: ResourceRequirements{
				Requests: NewResourceList("50m", "64Mi"),
				Limits:   NewResourceList("200m", "256Mi"),
			},
			Labels: map[string]string{
				"category":    "web",
				"preset-type": "application",
				"managed-by":  "computesdk",
			},
		},
		{
			PresetID:    "database",
			Name:        "Database Server",
			Description: "PostgreSQL database server",
			Version:     "1.0.0",
			Template: PresetTemplate{
				Image:           "postgres:13-alpine",
				ImagePullPolicy: corev1.PullIfNotPresent,
				Ports: []corev1.ContainerPort{
					{Name: "postgres", ContainerPort: 5432, Protocol: corev1.ProtocolTCP},
				},
				Env: []corev1.EnvVar{
					{Name: "POSTGRES_DB", Value: "app"},
					{Name: "POSTGRES_USER", Value: "user"},
					{Name: "POSTGRES_PASSWORD", Value: "password"},
					{Name: "PGDATA", Value: "/var/lib/postgresql/data/pgdata"},
				},
			},
			Resources: ResourceRequirements{
				Requests: NewResourceList("200m", "256Mi"),
				Limits:   NewResourceList("1000m", "1Gi"),
			},
			Labels: map[string]string{
				"category":    "database",
				"preset-type": "application",
				"managed-by":  "computesdk",
			},
		},
		{
			PresetID:    "python-only",
			Name:        "Python Environment",
			Description: "Python 3.11 environment with common data science libraries",
			Version:     "1.0.0",
			Template: PresetTemplate{
				Image:           "python:3.11-bullseye",
				ImagePullPolicy: corev1.PullIfNotPresent,
				Command:         []string{"/bin/bash"},
				Args:            []string{"-c", "pip install jupyter pandas numpy matplotlib requests flask fastapi && sleep infinity"},
				Env: []corev1.EnvVar{
					{Name: "PYTHONUNBUFFERED", Value: "1"},
					{Name: "DEBIAN_FRONTEND", Value: "noninteractive"},
				},
				Ports: []corev1.ContainerPort{
					{Name: "jupyter", ContainerPort: 8888, Protocol: corev1.ProtocolTCP},
					{Name: "flask", ContainerPort: 5000, Protocol: corev1.ProtocolTCP},
					{Name: "fastapi", ContainerPort: 8000, Protocol: corev1.ProtocolTCP},
				},
			},
			Resources: ResourceRequirements{
				Requests: NewResourceList("200m", "256Mi"),
				Limits:   NewResourceList("1000m", "1Gi"),
			},
			Labels: map[string]string{
				"category":    "development",
				"preset-type": "application",
				"managed-by":  "computesdk",
				"runtime":     "python",
			},
		},
		{
			PresetID:    "node-only",
			Name:        "Node.js Environment",
			Description: "Node.js 18 environment with common development tools",
			Version:     "1.0.0",
			Template: PresetTemplate{
				Image:           "node:18-bullseye",
				ImagePullPolicy: corev1.PullIfNotPresent,
				Command:         []string{"/bin/bash"},
				Args:            []string{"-c", "npm install -g typescript ts-node nodemon @types/node express && sleep infinity"},
				Env: []corev1.EnvVar{
					{Name: "NODE_ENV", Value: "development"},
					{Name: "DEBIAN_FRONTEND", Value: "noninteractive"},
				},
				Ports: []corev1.ContainerPort{
					{Name: "http", ContainerPort: 3000, Protocol: corev1.ProtocolTCP},
					{Name: "debug", ContainerPort: 9229, Protocol: corev1.ProtocolTCP},
					{Name: "vite", ContainerPort: 5173, Protocol: corev1.ProtocolTCP},
				},
			},
			Resources: ResourceRequirements{
				Requests: NewResourceList("150m", "192Mi"),
				Limits:   NewResourceList("750m", "768Mi"),
			},
			Labels: map[string]string{
				"category":    "development",
				"preset-type": "application",
				"managed-by":  "computesdk",
				"runtime":     "node",
			},
		},
	}
}

// InitializeDefaultPresets ensures all default presets exist
func InitializeDefaultPresets(ctx context.Context, presetMgr PresetManager) error {
	if presetMgr == nil {
		return fmt.Errorf("preset manager is nil")
	}

	defaultPresets := GetDefaultPresets()

	for _, presetSpec := range defaultPresets {
		err := ensurePresetExists(ctx, presetMgr, presetSpec)
		if err != nil {
			return fmt.Errorf("failed to ensure preset %s exists: %w", presetSpec.PresetID, err)
		}
	}

	return nil
}

// ensurePresetExists creates a preset if it doesn't already exist (idempotent)
func ensurePresetExists(ctx context.Context, presetMgr PresetManager, spec PresetSpec) error {
	// Check if preset already exists
	existing, err := presetMgr.GetPreset(ctx, spec.PresetID)
	if err == nil && existing != nil {
		// Preset exists, check if it needs updating
		if existing.Version != spec.Version {
			// Update preset if version is different
			_, err = presetMgr.UpdatePreset(ctx, spec.PresetID, spec)
			if err != nil {
				return fmt.Errorf("failed to update preset %s: %w", spec.PresetID, err)
			}
			fmt.Printf("Updated preset %s to version %s\n", spec.PresetID, spec.Version)
		} else {
			fmt.Printf("Preset %s already exists (v%s)\n", spec.PresetID, existing.Version)
		}
		return nil
	}

	// Preset doesn't exist, create it
	_, err = presetMgr.CreatePreset(ctx, spec)
	if err != nil {
		return fmt.Errorf("failed to create preset %s: %w", spec.PresetID, err)
	}

	fmt.Printf("Created default preset %s (v%s)\n", spec.PresetID, spec.Version)
	return nil
}

// GetDefaultPreset returns the default preset ID
func GetDefaultPreset() string {
	return DefaultPresetID
}
