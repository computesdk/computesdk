# Multi-runtime sandbox with SSH server for Fly.io
FROM ubuntu:22.04

# Avoid interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Update package list and install essential packages
RUN apt-get update && apt-get install -y \
    # SSH server
    openssh-server \
    # Core utilities
    curl \
    wget \
    git \
    vim \
    nano \
    htop \
    unzip \
    # Build tools
    build-essential \
    # Python runtime and tools
    python3 \
    python3-pip \
    python3-dev \
    python3-venv \
    # Node.js runtime (via NodeSource)
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    # Clean up
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create sandbox user with sudo privileges
RUN useradd -m -s /bin/bash -G sudo sandbox \
    && echo 'sandbox:sandbox' | chpasswd \
    && echo 'sandbox ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

# Configure SSH server
RUN mkdir /var/run/sshd \
    && sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin no/' /etc/ssh/sshd_config \
    && sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config \
    && sed -i 's/#PubkeyAuthentication yes/PubkeyAuthentication yes/' /etc/ssh/sshd_config \
    && echo 'AllowUsers sandbox' >> /etc/ssh/sshd_config

# Create .ssh directory for the sandbox user
RUN mkdir -p /home/sandbox/.ssh \
    && chown sandbox:sandbox /home/sandbox/.ssh \
    && chmod 700 /home/sandbox/.ssh

# Set up Python environment
RUN python3 -m pip install --upgrade pip setuptools wheel \
    && python3 -m pip install \
    requests \
    numpy \
    pandas \
    matplotlib \
    jupyter

# Set up Node.js environment  
RUN npm install -g \
    typescript \
    ts-node \
    nodemon \
    express \
    axios

# Create workspace directory
RUN mkdir -p /home/sandbox/workspace \
    && chown -R sandbox:sandbox /home/sandbox/workspace

# Set working directory
WORKDIR /home/sandbox/workspace

# Expose SSH port
EXPOSE 22

# Start SSH server
CMD ["/usr/sbin/sshd", "-D"]