package services

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// File represents a file or directory
type File struct {
	ID       string
	Name     string
	Path     string
	IsDir    bool
	Size     int64
	Mode     string
	ModTime  time.Time
	MimeType string
}

// FileContent represents file content
type FileContent struct {
	*File
	Content []byte
}

// FilesystemService defines the interface for filesystem operations
type FilesystemService interface {
	List(ctx context.Context, path string) ([]*File, error)
	Get(ctx context.Context, path string) (*File, error)
	Read(ctx context.Context, path string) (*FileContent, error)
	Create(ctx context.Context, path string, content []byte) (*File, error)
	Update(ctx context.Context, path string, content []byte) (*File, error)
	Delete(ctx context.Context, path string) error
	Move(ctx context.Context, oldPath, newPath string) error
	Copy(ctx context.Context, srcPath, dstPath string) error
}

// filesystemService implements FilesystemService
type filesystemService struct {
	basePath string // Base directory to operate within
}

// NewFilesystemService creates a new filesystem service
// Default constructor
func NewFilesystemService() FilesystemService {
	return NewFilesystemServiceWithPath("/home/project")
}

// Constructor with custom path
func NewFilesystemServiceWithPath(basePath string) FilesystemService {
	return &filesystemService{
		basePath: basePath,
	}
}

// resolvePath ensures the path is within basePath and returns the full path
func (s *filesystemService) resolvePath(path string) (string, error) {
	// Remove any leading slashes to prevent absolute paths
	path = strings.TrimPrefix(path, "/")

	// Clean the path
	cleaned := filepath.Clean(path)

	// Reject paths that try to escape
	if strings.HasPrefix(cleaned, "..") || strings.Contains(cleaned, "/../") {
		return "", fmt.Errorf("path outside base directory: %s", path)
	}

	// Join with base path
	fullPath := filepath.Join(s.basePath, cleaned)

	// Double-check with absolute paths
	absBase, _ := filepath.Abs(s.basePath)
	absFull, _ := filepath.Abs(fullPath)

	// Ensure the resolved path is within the base directory
	if !strings.HasPrefix(absFull, absBase+string(filepath.Separator)) && absFull != absBase {
		return "", fmt.Errorf("path outside base directory: %s", path)
	}

	return fullPath, nil
}

// List returns files and directories in the given path
func (s *filesystemService) List(ctx context.Context, path string) ([]*File, error) {
	fullPath, err := s.resolvePath(path)
	if err != nil {
		return nil, err
	}

	entries, err := os.ReadDir(fullPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read directory: %w", err)
	}

	files := make([]*File, 0, len(entries))
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}

		file := &File{
			ID:      filepath.Join(path, entry.Name()),
			Name:    entry.Name(),
			Path:    filepath.Join(path, entry.Name()),
			IsDir:   entry.IsDir(),
			Size:    info.Size(),
			Mode:    info.Mode().String(),
			ModTime: info.ModTime(),
		}

		if !entry.IsDir() {
			file.MimeType = detectMimeType(entry.Name())
		}

		files = append(files, file)
	}

	return files, nil
}

// Get retrieves file information
func (s *filesystemService) Get(ctx context.Context, path string) (*File, error) {
	fullPath, err := s.resolvePath(path)
	if err != nil {
		return nil, err
	}

	info, err := os.Stat(fullPath)
	if err != nil {
		return nil, fmt.Errorf("failed to stat file: %w", err)
	}

	file := &File{
		ID:      path,
		Name:    filepath.Base(path),
		Path:    path,
		IsDir:   info.IsDir(),
		Size:    info.Size(),
		Mode:    info.Mode().String(),
		ModTime: info.ModTime(),
	}

	if !info.IsDir() {
		file.MimeType = detectMimeType(path)
	}

	return file, nil
}

// Read returns file content
func (s *filesystemService) Read(ctx context.Context, path string) (*FileContent, error) {
	file, err := s.Get(ctx, path)
	if err != nil {
		return nil, err
	}

	if file.IsDir {
		return nil, fmt.Errorf("cannot read directory: %s", path)
	}

	fullPath, err := s.resolvePath(path)
	if err != nil {
		return nil, err
	}

	content, err := os.ReadFile(fullPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}

	return &FileContent{
		File:    file,
		Content: content,
	}, nil
}

// Create creates a new file
func (s *filesystemService) Create(ctx context.Context, path string, content []byte) (*File, error) {
	fullPath, err := s.resolvePath(path)
	if err != nil {
		return nil, err
	}

	// Create directory if needed
	dir := filepath.Dir(fullPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create directory: %w", err)
	}

	// Write file
	if err := os.WriteFile(fullPath, content, 0644); err != nil {
		return nil, fmt.Errorf("failed to write file: %w", err)
	}

	return s.Get(ctx, path)
}

// Update updates file content
func (s *filesystemService) Update(ctx context.Context, path string, content []byte) (*File, error) {
	fullPath, err := s.resolvePath(path)
	if err != nil {
		return nil, err
	}

	// Check if file exists
	if _, err := os.Stat(fullPath); err != nil {
		return nil, fmt.Errorf("file not found: %s", path)
	}

	// Write file
	if err := os.WriteFile(fullPath, content, 0644); err != nil {
		return nil, fmt.Errorf("failed to write file: %w", err)
	}

	return s.Get(ctx, path)
}

// Delete removes a file or directory
func (s *filesystemService) Delete(ctx context.Context, path string) error {
	fullPath, err := s.resolvePath(path)
	if err != nil {
		return err
	}

	return os.RemoveAll(fullPath)
}

// Move moves a file or directory
func (s *filesystemService) Move(ctx context.Context, oldPath, newPath string) error {
	oldFull, err := s.resolvePath(oldPath)
	if err != nil {
		return err
	}

	newFull, err := s.resolvePath(newPath)
	if err != nil {
		return err
	}

	return os.Rename(oldFull, newFull)
}

// Copy copies a file
func (s *filesystemService) Copy(ctx context.Context, srcPath, dstPath string) error {
	srcFull, err := s.resolvePath(srcPath)
	if err != nil {
		return err
	}

	dstFull, err := s.resolvePath(dstPath)
	if err != nil {
		return err
	}

	// Open source file
	src, err := os.Open(srcFull)
	if err != nil {
		return fmt.Errorf("failed to open source file: %w", err)
	}
	defer src.Close()

	// Create destination file
	dst, err := os.Create(dstFull)
	if err != nil {
		return fmt.Errorf("failed to create destination file: %w", err)
	}
	defer dst.Close()

	// Copy content
	if _, err := io.Copy(dst, src); err != nil {
		return fmt.Errorf("failed to copy file: %w", err)
	}

	// Copy permissions
	srcInfo, _ := src.Stat()
	return dst.Chmod(srcInfo.Mode())
}

// detectMimeType returns a mime type based on file extension
func detectMimeType(filename string) string {
	ext := filepath.Ext(filename)
	switch ext {
	case ".txt":
		return "text/plain"
	case ".html", ".htm":
		return "text/html"
	case ".css":
		return "text/css"
	case ".js":
		return "application/javascript"
	case ".json":
		return "application/json"
	case ".xml":
		return "application/xml"
	case ".pdf":
		return "application/pdf"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".svg":
		return "image/svg+xml"
	default:
		return "application/octet-stream"
	}
}
