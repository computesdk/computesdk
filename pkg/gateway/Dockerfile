# Build stage
FROM golang:1.22-alpine AS builder

WORKDIR /app

# Copy go.mod and go.sum files
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy the source code
COPY . .

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -o gateway ./cmd

# Final stage - use the same base image pattern as other services
FROM 394753861590.dkr.ecr.us-east-2.amazonaws.com/computesdk-base:latest

# Add CA certificates
USER root
RUN apk --no-cache add ca-certificates

# Create directory for the Go application
WORKDIR /app/gateway

# Copy the binary from the builder stage
COPY --from=builder /app/gateway .
RUN chmod +x ./gateway

# Switch back to non-root user for security
USER node

# Expose port
EXPOSE 3000

# Run the application
CMD ["./gateway"]
