package cas

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/s3/manager"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

// S3Client defines the interface for S3 operations needed by StoreInCAS.
// This allows for easier testing and abstraction.
type S3Client interface {
	HeadObject(ctx context.Context, params *s3.HeadObjectInput, optFns ...func(*s3.Options)) (*s3.HeadObjectOutput, error)
}

// S3Uploader defines the interface for uploading to S3.
// This allows for easier testing and abstraction.
// The manager.Uploader from aws-sdk-go-v2 satisfies this.
type S3Uploader interface {
	Upload(ctx context.Context, input *s3.PutObjectInput, opts ...func(*manager.Uploader)) (*manager.UploadOutput, error)
}

// fileSeeker is an interface that combines io.Reader, io.Seeker, and io.Closer.
// This is satisfied by *os.File.
type fileSeeker interface {
	io.Reader
	io.Seeker
	io.Closer
}

// StoreInCAS calculates the SHA256 hash of the content from the reader,
// uploads the content to the specified S3 bucket using the hash as the key,
// and returns the hex-encoded SHA256 hash.
//
// This function buffers the entire file content in memory before uploading.
// For very large files, a streaming approach (e.g., upload-then-rename) would be more memory-efficient.
//
// Parameters:
//   ctx: Context for the operation.
//   uploader: An S3 uploader instance (e.g., manager.NewUploader(s3Client)).
//   bucketName: The S3 bucket to upload to.
//   fileReader: The io.Reader providing the file content.
//   objectKeyPrefix: A prefix to add to the S3 object key (e.g., "cas/"). Can be empty.
//
// Returns:
//   The hex-encoded SHA256 hash of the file content.
//   An error if any step fails.
// StoreInCAS calculates the SHA256 hash of the content from the file,
// uploads the content to the specified S3 bucket using the hash as the key,
// and returns the hex-encoded SHA256 hash.
//
// This function uses a streaming approach to handle large files efficiently
// by reading the file in chunks rather than loading it entirely into memory.
//
// Parameters:
//   ctx: Context for the operation.
//   uploader: An S3 uploader instance (e.g., manager.NewUploader(s3Client)).
//   s3Client: An S3 client instance for checking object existence.
//   bucketName: The S3 bucket to upload to.
//   file: A fileSeeker (like *os.File) providing the file content.
//   objectKeyPrefix: A prefix to add to the S3 object key (e.g., "cas/"). Can be empty.
//
// Returns:
//   The hex-encoded SHA256 hash of the file content.
//   An error if any step fails.
func StoreInCAS(ctx context.Context, uploader S3Uploader, s3Client S3Client, bucketName string, file fileSeeker, objectKeyPrefix string) (string, error) {
	// First, compute the SHA256 hash of the file content.
	hasher := sha256.New()
	
	// Copy the file content to the hasher.
	if _, err := io.Copy(hasher, file); err != nil {
		return "", fmt.Errorf("failed to compute hash: %w", err)
	}
	
	// Get the hash bytes and convert to hex string.
	hashBytes := hasher.Sum(nil)
	hexHash := hex.EncodeToString(hashBytes)
	objectKey := objectKeyPrefix + hexHash

	// Check if the object already exists in S3.
	headObjInput := &s3.HeadObjectInput{
		Bucket: aws.String(bucketName),
		Key:    aws.String(objectKey),
	}

	_, err := s3Client.HeadObject(ctx, headObjInput)
	if err == nil {
		// Object exists, no need to upload again.
		log.Printf("Object %s already exists in S3 bucket %s. Skipping upload.", objectKey, bucketName)
		return hexHash, nil
	}

	// Check if the error is because the object doesn't exist.
	var nsk *types.NotFound
	if !errors.As(err, &nsk) {
		// Some other error occurred.
		return "", fmt.Errorf("error checking S3 object existence %s: %w", objectKey, err)
	}

	// Reset the file pointer to the beginning for the upload.
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return "", fmt.Errorf("failed to reset file pointer: %w", err)
	}

	// If we get here, the object doesn't exist, so we can proceed with the upload.
	log.Printf("Uploading object to S3. Bucket: %s, Key (hash): %s", bucketName, objectKey)

	// Upload the file to S3.
	_, err = uploader.Upload(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(bucketName),
		Key:         aws.String(objectKey),
		Body:        file,
		ContentType: aws.String("application/octet-stream"),
	})

	if err != nil {
		return "", fmt.Errorf("failed to upload to S3 with key %s: %w", objectKey, err)
	}

	log.Printf("Successfully uploaded to S3. Bucket: %s, Key: %s", bucketName, objectKey)
	return hexHash, nil
}
