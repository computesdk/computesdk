# Build stage
FROM golang:1.24-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git make

# Set working directory
WORKDIR /build

# Copy go mod files
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy source code
COPY . .

# Run tests first - fail fast if tests don't pass
RUN go test -v ./pkg/sidekick/...
RUN go test -v ./cmd/sidekick/...


# Build the binary with version information
ARG VERSION=dev
ARG GIT_COMMIT=unknown
ARG BUILD_TIME=unknown

RUN CGO_ENABLED=0 GOOS=linux go build \
    -ldflags="-w -s -X main.version=${VERSION} -X main.gitCommit=${GIT_COMMIT} -X main.buildTime=${BUILD_TIME}" \
    -o sidekick \
    ./cmd/sidekick

# Runtime stage
FROM alpine:3.18

# Install runtime dependencies
RUN apk add --no-cache ca-certificates tzdata

# Create non-root user
RUN addgroup -g 1000 sidekick && \
    adduser -u 1000 -G sidekick -s /bin/sh -D sidekick

# Set working directory
WORKDIR /app

# Copy binary from builder
COPY --from=builder /build/sidekick /app/sidekick

# Create workspace directory with proper permissions
RUN mkdir -p /home/project && chown -R sidekick:sidekick /home/project

# Set ownership
RUN chown -R sidekick:sidekick /app

# Switch to non-root user
USER sidekick

# Expose ports
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD ["/app/sidekick", "-health-check"] || exit 1

# Run the binary
ENTRYPOINT ["/app/sidekick"]
