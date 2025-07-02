# Use the official Golang image, specific version for reproducibility
FROM golang:1.24-alpine AS builder

WORKDIR /app

# Copy go.mod and go.sum first to leverage Docker cache
COPY go.mod go.sum ./
RUN go mod download

# Copy the rest of the application source code
# Assuming your gateway code is in cmd/gateway and shared packages in pkg/
COPY . .

# Run tests first - fail fast if tests don't pass
RUN go test -v ./pkg/gateway/...
RUN go test -v ./pkg/gateway/...


# Build the Go application
# Output to /app/gateway inside the container
RUN CGO_ENABLED=0 GOOS=linux go build -v -o /app/gateway ./cmd/gateway/main.go

# --- Final Stage ---
FROM alpine:latest

WORKDIR /root/

# Copy the Pre-built binary file from the previous stage
COPY --from=builder /app/gateway .

# Expose port 8080 to the outside world
EXPOSE 8080

# Command to run the executable
CMD ["./gateway"]
