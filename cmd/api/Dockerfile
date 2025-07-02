# Use a slim Go image
FROM golang:1.24-alpine AS builder

WORKDIR /app

# Copy go.mod and go.sum first to leverage Docker cache
# Assuming go.mod is at the project root
COPY go.mod go.sum ./
RUN go mod download

# Copy the rest of the application source code
# Assuming your API code is in cmd/api and shared packages in pkg/
COPY . .

# Run tests first - fail fast if tests don't pass
RUN go test -v ./pkg/api/...
RUN go test -v ./pkg/api/...

# Build the Go application
# Output to /app/api-server inside the container
RUN CGO_ENABLED=0 GOOS=linux go build -v -o /app/api ./cmd/api/main.go

# --- Final Stage ---
FROM alpine:latest

WORKDIR /root/

# Copy the Pre-built binary file from the previous stage
COPY --from=builder /app/api .

# Expose port 3000 (as per api-deployment.yaml)
EXPOSE 8080

# Command to run the executable
CMD ["./api"]
