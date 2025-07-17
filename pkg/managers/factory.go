package managers

import (
	"log"

	"github.com/heysnelling/computesdk/pkg/k8s"
)

// DefaultLogger implements the Logger interface using standard log package
type DefaultLogger struct{}

func (l *DefaultLogger) Printf(format string, v ...interface{}) {
	log.Printf(format, v...)
}

func (l *DefaultLogger) Errorf(format string, v ...interface{}) {
	log.Printf("ERROR: "+format, v...)
}

func (l *DefaultLogger) Infof(format string, v ...interface{}) {
	log.Printf("INFO: "+format, v...)
}

func (l *DefaultLogger) Debugf(format string, v ...interface{}) {
	log.Printf("DEBUG: "+format, v...)
}

// ManagerFactory creates and manages the lifecycle of managers
type ManagerFactory struct {
	k8sClient k8s.KubernetesClient
	config    ManagerConfig
}

// NewManagerFactory creates a new manager factory
func NewManagerFactory(k8sClient k8s.KubernetesClient, namespace string) *ManagerFactory {
	config := ManagerConfig{
		Namespace: namespace,
		Logger:    &DefaultLogger{},
	}

	return &ManagerFactory{
		k8sClient: k8sClient,
		config:    config,
	}
}

// NewManagerFactoryWithLogger creates a new manager factory with custom logger
func NewManagerFactoryWithLogger(k8sClient k8s.KubernetesClient, namespace string, logger Logger) *ManagerFactory {
	config := ManagerConfig{
		Namespace: namespace,
		Logger:    logger,
	}

	return &ManagerFactory{
		k8sClient: k8sClient,
		config:    config,
	}
}

// CreatePresetManager creates a new PresetManager instance
func (f *ManagerFactory) CreatePresetManager() PresetManager {
	return NewPresetManager(f.k8sClient, f.config)
}

// CreateComputeManager creates a new ComputeManager instance
func (f *ManagerFactory) CreateComputeManager() ComputeManager {
	presetMgr := f.CreatePresetManager()
	return NewComputeManager(f.k8sClient, f.k8sClient, presetMgr, f.config)
}

// CreateManagers creates both preset and compute managers
func (f *ManagerFactory) CreateManagers() (PresetManager, ComputeManager) {
	presetMgr := f.CreatePresetManager()
	computeMgr := NewComputeManager(f.k8sClient, f.k8sClient, presetMgr, f.config)
	return presetMgr, computeMgr
}

// GetConfig returns the manager configuration
func (f *ManagerFactory) GetConfig() ManagerConfig {
	return f.config
}

// SetLogger updates the logger for all future manager instances
func (f *ManagerFactory) SetLogger(logger Logger) {
	f.config.Logger = logger
}
