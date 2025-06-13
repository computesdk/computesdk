package cas

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/s3/manager"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

// mockFile implements the fileSeeker interface for testing
type mockFile struct {
	*bytes.Reader
}

func (m *mockFile) Close() error {
	return nil
}

func newMockFile(data []byte) *mockFile {
	return &mockFile{
		Reader: bytes.NewReader(data),
	}
}

// mockS3Client implements our S3Client interface
type mockS3Client struct {
	mock.Mock
}

func (m *mockS3Client) HeadObject(ctx context.Context, params *s3.HeadObjectInput, optFns ...func(*s3.Options)) (*s3.HeadObjectOutput, error) {
	args := m.Called(ctx, params)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*s3.HeadObjectOutput), args.Error(1)
}

// mockS3Uploader implements our S3Uploader interface
type mockS3Uploader struct {
	mock.Mock
}

func (m *mockS3Uploader) Upload(ctx context.Context, input *s3.PutObjectInput, opts ...func(*manager.Uploader)) (*manager.UploadOutput, error) {
	args := m.Called(ctx, input)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*manager.UploadOutput), args.Error(1)
}

func TestStoreInCAS_NewFile(t *testing.T) {
	// Test data
	testData := []byte("test data")
	hasher := sha256.New()
	hasher.Write(testData)
	expectedHash := hex.EncodeToString(hasher.Sum(nil))
	expectedKey := "test-prefix/" + expectedHash

	// Create mocks
	mockClient := new(mockS3Client)
	mockUploader := new(mockS3Uploader)

	// Set up expectations
	headerMatcher := func(input *s3.HeadObjectInput) bool {
		return *input.Bucket == "test-bucket" && *input.Key == expectedKey
	}

	uploadMatcher := func(input *s3.PutObjectInput) bool {
		return *input.Bucket == "test-bucket" && 
		       *input.Key == expectedKey &&
		       *input.ContentType == "application/octet-stream"
	}

	mockClient.On("HeadObject", mock.Anything, mock.MatchedBy(headerMatcher)).
		Return((*s3.HeadObjectOutput)(nil), &types.NotFound{})

	mockUploader.On("Upload", mock.Anything, mock.MatchedBy(uploadMatcher)).
		Return(&manager.UploadOutput{
			Location: "test-location",
		}, nil)

	// Create test file
	file := newMockFile(testData)

	// Call function
	hash, err := StoreInCAS(
		context.Background(),
		mockUploader,
		mockClient,
		"test-bucket",
		file,
		"test-prefix/",
	)

	// Assertions
	assert.NoError(t, err)
	assert.Equal(t, expectedHash, hash)
	mockClient.AssertExpectations(t)
	mockUploader.AssertExpectations(t)
}

func TestStoreInCAS_ExistingFile(t *testing.T) {
	// Test data
	testData := []byte("test data")
	hasher := sha256.New()
	hasher.Write(testData)
	expectedHash := hex.EncodeToString(hasher.Sum(nil))
	expectedKey := "test-prefix/" + expectedHash

	// Create mocks
	mockClient := new(mockS3Client)
	mockUploader := new(mockS3Uploader)

	// Set up expectations - file exists
	mockClient.On("HeadObject", mock.Anything, &s3.HeadObjectInput{
		Bucket: aws.String("test-bucket"),
		Key:    aws.String(expectedKey),
	}).Return(&s3.HeadObjectOutput{}, nil)

	// Create test file
	file := newMockFile(testData)

	// Call function
	hash, err := StoreInCAS(
		context.Background(),
		mockUploader,
		mockClient,
		"test-bucket",
		file,
		"test-prefix/",
	)

	// Assertions
	assert.NoError(t, err)
	assert.Equal(t, expectedHash, hash)
	mockClient.AssertExpectations(t)
	mockUploader.AssertNotCalled(t, "Upload") // Should not call upload
}

func TestStoreInCAS_HeadError(t *testing.T) {
	// Test data
	testData := []byte("test data")

	// Create mocks
	mockClient := new(mockS3Client)
	mockUploader := new(mockS3Uploader)

	// Set up matcher
	headerMatcher := func(input *s3.HeadObjectInput) bool {
		return *input.Bucket == "test-bucket"
	}

	// Set up expectations - head returns non-NotFound error
	testErr := errors.New("head error")
	mockClient.On("HeadObject", mock.Anything, mock.MatchedBy(headerMatcher)).
		Return((*s3.HeadObjectOutput)(nil), testErr)

	// Create test file
	file := newMockFile(testData)

	// Call function
	_, err := StoreInCAS(
		context.Background(),
		mockUploader,
		mockClient,
		"test-bucket",
		file,
		"test-prefix/",
	)

	// Assertions
	assert.ErrorIs(t, err, testErr)
}

func TestStoreInCAS_UploadError(t *testing.T) {
	// Test data
	testData := []byte("test data")

	// Create mocks
	mockClient := new(mockS3Client)
	mockUploader := new(mockS3Uploader)

	// Set up matchers
	headerMatcher := func(input *s3.HeadObjectInput) bool {
		return *input.Bucket == "test-bucket"
	}

	uploadMatcher := func(input *s3.PutObjectInput) bool {
		return *input.Bucket == "test-bucket" && 
		       *input.ContentType == "application/octet-stream"
	}

	// Set up expectations
	mockClient.On("HeadObject", mock.Anything, mock.MatchedBy(headerMatcher)).
		Return((*s3.HeadObjectOutput)(nil), &types.NotFound{})

	testErr := errors.New("upload error")
	mockUploader.On("Upload", mock.Anything, mock.MatchedBy(uploadMatcher)).
		Return((*manager.UploadOutput)(nil), testErr)

	// Create test file
	file := newMockFile(testData)

	// Call function
	_, err := StoreInCAS(
		context.Background(),
		mockUploader,
		mockClient,
		"test-bucket",
		file,
		"test-prefix/",
	)

	// Assertions
	assert.ErrorIs(t, err, testErr)
}

func TestStoreInCAS_SeekError(t *testing.T) {
	// Create a custom mock that fails on Seek
	failingFile := &failingFile{
		Reader: bytes.NewReader([]byte("test data")),
	}

	// Create mocks
	mockClient := new(mockS3Client)
	mockUploader := new(mockS3Uploader)

	// Set up matchers
	headerMatcher := func(input *s3.HeadObjectInput) bool {
		return *input.Bucket == "test-bucket"
	}

	// Set up expectations - file doesn't exist
	mockClient.On("HeadObject", mock.Anything, mock.MatchedBy(headerMatcher)).
		Return((*s3.HeadObjectOutput)(nil), &types.NotFound{})

	// Call function
	_, err := StoreInCAS(
		context.Background(),
		mockUploader,
		mockClient,
		"test-bucket",
		failingFile,
		"test-prefix/",
	)

	// Assertions
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "failed to reset file pointer")
}

// failingFile is a fileSeeker that fails on Seek
type failingFile struct {
	io.Reader
}

func (f *failingFile) Seek(offset int64, whence int) (int64, error) {
	return 0, errors.New("seek error")
}

func (f *failingFile) Close() error {
	return nil
}

func Test_fileSeeker_Seek(t *testing.T) {
	// Test that our mockFile implements the interface correctly
	data := []byte("test data")
	file := newMockFile(data)

	// Test seeking to start
	offset, err := file.Seek(0, io.SeekStart)
	assert.NoError(t, err)
	assert.Equal(t, int64(0), offset)

	// Test reading after seek
	buf := make([]byte, 4)
	n, err := file.Read(buf)
	assert.NoError(t, err)
	assert.Equal(t, 4, n)
	assert.Equal(t, "test", string(buf))

	// Test seeking from current position
	offset, err = file.Seek(1, io.SeekCurrent)
	assert.NoError(t, err)
	assert.Equal(t, int64(5), offset)

	// Read from new position
	n, err = file.Read(buf)
	assert.NoError(t, err)
	assert.Equal(t, 4, n)
	assert.Equal(t, "data", string(buf[:n]))
}
