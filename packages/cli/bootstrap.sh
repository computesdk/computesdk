#!/bin/bash
#
# Bootstrap script for compute workspace
# Runs inside sandbox to set up git, gh CLI, and worktree
#
# Usage: ./bootstrap.sh <repo> <branch> [optional: github_token]
#
# Example: ./bootstrap.sh lodash/lodash fix-auth

set -e

REPO="${1:-}"
BRANCH="${2:-}"
GITHUB_TOKEN="${3:-${GITHUB_TOKEN:-}}"
REPO_NAME=$(basename "$REPO")
WORKTREE_DIR="/workspaces/${REPO_NAME}-${BRANCH}"
REPO_DIR="/workspaces/${REPO_NAME}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
  echo -e "${GREEN}[bootstrap]${NC} $1"
}

warn() {
  echo -e "${YELLOW}[bootstrap]${NC} $1"
}

error() {
  echo -e "${RED}[bootstrap]${NC} $1" >&2
}

# Validate inputs
if [ -z "$REPO" ] || [ -z "$BRANCH" ]; then
  error "Usage: $0 <owner/repo> <branch>"
  exit 1
fi

# Ensure /workspaces exists
mkdir -p /workspaces

# Install gh CLI if not present
if ! command -v gh &> /dev/null; then
  log "Installing GitHub CLI..."
  
  # Detect architecture
  ARCH=$(uname -m)
  case $ARCH in
    x86_64) GH_ARCH="amd64" ;;
    aarch64|arm64) GH_ARCH="arm64" ;;
    *) error "Unsupported architecture: $ARCH"; exit 1 ;;
  esac
  
  # Download and install
  GH_VERSION=$(curl -s https://api.github.com/repos/cli/cli/releases/latest | grep '"tag_name"' | cut -d'"' -f4)
  GH_VERSION=${GH_VERSION#v}  # Remove 'v' prefix
  
  curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${GH_ARCH}.tar.gz" | tar -xz -C /tmp
  sudo mv /tmp/gh_${GH_VERSION}_linux_${GH_ARCH}/bin/gh /usr/local/bin/
  sudo chmod +x /usr/local/bin/gh
  rm -rf /tmp/gh_${GH_VERSION}_linux_${GH_ARCH}
  
  log "GitHub CLI installed: $(gh --version | head -1)"
fi

# Handle GitHub authentication
if [ -n "$GITHUB_TOKEN" ]; then
  # Use provided token
  log "Using provided GitHub token..."
  echo "$GITHUB_TOKEN" | gh auth login --with-token
elif ! gh auth status &> /dev/null; then
  # No token, no existing auth - use device flow
  warn "No GitHub credentials found"
  echo ""
  echo "╔════════════════════════════════════════════════════════════╗"
  echo "║  Please authenticate with GitHub                          ║"
  echo "╚════════════════════════════════════════════════════════════╝"
  echo ""
  
  # Start device flow in background and capture output
  TMPFILE=$(mktemp)
  gh auth login --scopes repo,workflow --method device 2>&1 | tee "$TMPFILE" &
  AUTH_PID=$!
  
  # Monitor for device code
  for i in {1..60}; do
    if grep -q "First copy your one-time code" "$TMPFILE" 2>/dev/null; then
      CODE=$(grep -o '[A-Z0-9]\{4\}-[A-Z0-9]\{4\}' "$TMPFILE" | head -1)
      if [ -n "$CODE" ]; then
        echo ""
        echo "Your one-time code: ${YELLOW}${CODE}${NC}"
        echo "Visit: https://github.com/device"
        echo ""
        break
      fi
    fi
    sleep 1
  done
  
  # Wait for auth to complete
  wait $AUTH_PID || true
  rm -f "$TMPFILE"
  
  if ! gh auth status &> /dev/null; then
    error "GitHub authentication failed or timed out"
    exit 1
  fi
  
  USER=$(gh api user -q .login 2>/dev/null || echo "unknown")
  log "Authenticated as @${USER}"
else
  USER=$(gh api user -q .login 2>/dev/null || echo "unknown")
  log "Using existing GitHub auth (@${USER})"
fi

# Clone repo if not exists
if [ ! -d "$REPO_DIR/.git" ]; then
  log "Cloning ${REPO}..."
  gh repo clone "$REPO" "$REPO_DIR"
  log "Cloned to ${REPO_DIR}"
else
  log "Repo already cloned at ${REPO_DIR}, fetching updates..."
  cd "$REPO_DIR"
  git fetch origin
fi

# Create worktree
cd "$REPO_DIR"

if git worktree list | grep -q "$WORKTREE_DIR"; then
  warn "Worktree for ${BRANCH} already exists at ${WORKTREE_DIR}"
else
  # Check if branch exists locally or remotely
  if git show-ref --verify --quiet "refs/heads/${BRANCH}"; then
    log "Creating worktree for existing branch: ${BRANCH}"
    git worktree add "$WORKTREE_DIR" "$BRANCH"
  elif git ls-remote --exit-code origin "$BRANCH" &> /dev/null; then
    log "Creating worktree for remote branch: ${BRANCH}"
    git worktree add --track -b "$BRANCH" "$WORKTREE_DIR" "origin/${BRANCH}"
  else
    log "Creating new branch and worktree: ${BRANCH}"
    git worktree add -b "$BRANCH" "$WORKTREE_DIR"
  fi
  
  log "Worktree created: ${WORKTREE_DIR}"
fi

# Output workspace info for the CLI to parse
echo ""
echo "{"
echo '  "status": "ready",'
echo "  \"repo\": \"${REPO}\","
echo "  \"branch\": \"${BRANCH}\","
echo "  \"worktree_path\": \"${WORKTREE_DIR}\","
echo "  \"repo_path\": \"${REPO_DIR}\","
echo "  \"user\": \"$(gh api user -q .login 2>/dev/null || echo '')\""
echo "}"

log "Bootstrap complete!"
exit 0
