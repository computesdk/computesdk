# Use Node.js base image with multi-language support
FROM node:20-slim

# Install system dependencies for multi-language support and curl
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    curl \
    git \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install global tools
RUN npm install -g tsx typescript

# Create workspace directory for user code execution
RUN mkdir -p /workspace && chmod 777 /workspace

# Set up our HTTP API server
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies (production only for smaller image)
RUN npm ci --only=production

# Copy built application
COPY dist ./dist

# Ensure we can execute both official ComputeSDK tools and our HTTP server
ENV COMPUTESDK_OFFICIAL=true

# Add health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Expose port
EXPOSE 3000

# Start server
CMD ["npm", "start"]