---
title: "Docker Test Container — Deep Dive"
date: 2026-04-28
difficulty: advanced
tags: [docker, containers, dotfiles, testing, configuration, rocky-linux, nvim, tmux, multi-stage-builds, volumes, networking]
---

# Docker Test Container — Deep Dive

## 1. Overview

This advanced reference guide expands on the [[docker-test-container-beginner-guide|Docker Test Container Beginner Guide]] to explore sophisticated container patterns, internals, and professional workflows for testing configuration changes in isolated environments.

### What This Reference Covers

Beyond the beginner guide's basic container usage, this deep dive addresses:

- **Multi-stage Docker builds** to optimize image size and build layers
- **Layer caching strategies** that dramatically speed up rebuild cycles
- **Docker Compose orchestration** for testing across multiple OS versions simultaneously
- **Volume management** patterns: named volumes, bind mounts, tmpfs, and permission mapping
- **Container networking** for realistic testing scenarios
- **BuildKit advanced features** including secrets management and cache control
- **Integration workflows** combining Docker with git, SSH, justfiles, and CI/CD pipelines
- **Architecture internals** explaining namespaces, overlay filesystems, and why containers are safer than raw host changes
- **Performance optimization** including layer caching, BuildKit strategies, and macOS-specific considerations
- **Troubleshooting** edge cases: SELinux context on Rocky Linux, terminal capabilities, true color support, UID/GID mapping

This is a **reference document** — use it when you need to understand the *why* behind Docker container decisions, implement advanced workflows, or debug tricky container behavior.

---

## 2. Prerequisites

Before diving into this guide, you should have:

- **Docker installed and running** (Docker Desktop, Podman, or Docker Server)
- **Familiarity with the beginner guide** including basic `docker run`, `docker build`, and `.dockerignore`
- **Basic Dockerfile knowledge** including `FROM`, `RUN`, `COPY`, `ENTRYPOINT`
- **Command-line confidence** with shell scripting, git, and text editors
- **Understanding of Linux user/group model** (UID/GID, permissions)
- **Familiarity with volume concepts** (at least from the beginner guide)

### Optional Background

- Docker Compose syntax
- BuildKit (introduced in Docker 19.03)
- Multi-stage build patterns
- Linux namespaces and cgroups (conceptual)

---

## 3. Key Concepts

### 3.1 Multi-Stage Builds

Multi-stage builds allow you to use multiple `FROM` statements in a single Dockerfile, with each stage having its own base image and isolated filesystem. Stages can copy files from previous stages, but only the final stage (or explicitly targeted stages) are included in the final image.

**Why this matters for config testing:**

- **Smaller images** by excluding build tools from the final image
- **Faster iteration** because unchanged stages use cached layers
- **Cleaner separation** of build dependencies from runtime environment
- **Image variants** by switching which stage gets pushed

**Example pattern:**

```dockerfile
FROM rocky:9 AS builder
RUN dnf install -y build-essential git ...
COPY dotfiles /tmp/dotfiles
RUN cd /tmp/dotfiles && make build

FROM rocky:9 AS runtime
COPY --from=builder /tmp/build /opt/config
# Final image is much smaller
```

### 3.2 Docker Layers and Caching

Every instruction in a Dockerfile creates a new **layer** — an immutable snapshot of the filesystem at that point. Docker caches layers by instruction checksum.

**Critical for performance:**

- Layers are **cached independently**. If layer N uses a cached version, Docker reuses it even if you rebuilt the image 10 times.
- Layer cache **invalidates on:**
  - Instruction text changes (including RUN command strings)
  - Source file changes (for COPY/ADD)
  - Base image change (FROM instruction)
- **Order matters hugely:** Put frequently-changing instructions last
- **String concatenation in RUN:** `RUN apt update && apt install pkg` is ONE layer; splitting into two RUN commands creates two cacheable layers

**Optimization strategy:**

```dockerfile
# ❌ BAD: Rebuilds everything if dotfiles change
FROM rocky:9
COPY dotfiles /home/user/.config
RUN dnf install -y base-devel git neovim tmux

# ✓ GOOD: Caches dependencies if only dotfiles change
FROM rocky:9
RUN dnf install -y base-devel git neovim tmux
COPY dotfiles /home/user/.config
```

### 3.3 BuildKit

BuildKit is Docker's next-generation build engine (enabled by default in Docker Desktop 4.0+). It provides:

- **Parallel layer building** (multiple RUN commands in parallel if independent)
- **Secrets management** (inject API keys without baking them into images)
- **Custom cache exporters** (reuse caches across CI/CD runs)
- **SSH forwarding** (access git repos during build without hardcoding credentials)
- **Frontend syntax** (next-gen Dockerfile syntax with imports, functions)

**Enable BuildKit:**

```bash
export DOCKER_BUILDKIT=1
docker build ...
```

Or permanently in `~/.docker/daemon.json`:

```json
{
  "features": {
    "buildkit": true
  }
}
```

### 3.4 Named Volumes vs Bind Mounts vs Tmpfs

Three ways to add storage to containers, each with trade-offs:

| Type | Location | Persistence | Host Changes | Ownership | Use Case |
|------|----------|-------------|--------------|-----------|----------|
| **Named Volume** | Docker's data dir | Survives container | Not visible | Docker engine | Databases, build artifacts, test results |
| **Bind Mount** | Host filesystem | Survives container | Immediately visible | Host | Development (dotfiles, source code), logs |
| **Tmpfs** | RAM | Lost on stop | N/A | Container | Temporary data, caches, `/run` |

**When to use each:**

- **Named volumes** for persistent test results, databases, build caches
- **Bind mounts** for iterating on dotfiles, viewing logs in real-time
- **Tmpfs** for performance-critical temporary data, SELinux sandboxing

**UID/GID mapping** (critical for dotfiles):

```bash
# Bind mount with explicit UID:GID ownership
# On host, files appear as your user; in container, as root
docker run -v ~/dotfiles:/etc/config \
  --user 1000:1000 \
  rocky:9

# Relative vs absolute paths
docker run -v dotfiles:/root/.config  # Relative path → named volume
docker run -v ./dotfiles:/root/.config # Absolute path → bind mount
```

### 3.5 Container Networking

Containers have isolated network namespaces, meaning:

- **Localhost in a container is isolated** from host's localhost
- **Port mapping** (`-p 8080:8080`) bridges host port to container port
- **Networks** allow container-to-container communication by hostname

**Networking modes:**

```bash
# Bridge (default): NAT, each container on virtual network
docker run --network bridge rocky:9

# Host: Shares host's network namespace (bypasses isolation)
docker run --network host rocky:9

# Custom bridge: DNS resolution by container name
docker network create testnet
docker run --network testnet --name srv1 rocky:9
docker run --network testnet --link srv1 rocky:9

# None: No network (only loopback)
docker run --network none rocky:9
```

**For config testing:** Bridge mode (default) is safest; use `--network host` only if testing network-specific configs.

### 3.6 Docker Compose Services

Compose simplifies multi-container workflows with YAML definition:

```yaml
services:
  rocky8:
    image: rocky:8
    volumes:
      - dotfiles:/home/user/.config
      - test_results:/tmp/results
  rocky9:
    image: rocky:9
    volumes:
      - dotfiles:/home/user/.config
      - test_results:/tmp/results

volumes:
  dotfiles:
    driver: local
  test_results:
    driver: local
```

**Compose advantages:**

- Single command `docker compose up` starts all services
- Services can reference each other by name
- Shared networks created automatically
- Volume and network cleanup with `docker compose down`
- Compose overrides: `docker-compose.override.yml` for local modifications

### 3.7 Image Tagging Strategies

Tags allow version control of images:

```bash
# Standard format: [REGISTRY/]NAME[:TAG]
docker tag myimage:latest myimage:1.0
docker tag myimage:latest docker.io/user/myimage:latest

# Multiple tags for same image hash
docker tag rocky-dotfiles:latest rocky-dotfiles:2026-04-28
docker tag rocky-dotfiles:latest rocky-dotfiles:stable
```

**Strategy for config testing:**

- `latest`: Current development version
- Date-based: `2026-04-28` for reproducibility
- OS versions: `rocky8`, `rocky9` for multi-version testing
- State snapshots: `working-state`, `before-refactor`

### 3.8 `.dockerignore`

Controls which files are sent to the build context, speeding up builds:

```
.git
.gitignore
*.swp
*.tmp
node_modules
__pycache__
.DS_Store
```

**Without `.dockerignore`:** Every file in the build directory (including `.git` with full history) is sent to the Docker daemon, slowing builds significantly.

---

## 4. Step-by-Step Instructions

### 4.1 Building Optimized Multi-Stage Dockerfiles

**Goal:** Create a reusable Rocky Linux 8/9 image optimized for dotfile testing with all common tools.

**Dockerfile (multi-stage, with caching optimization):**

```dockerfile
# syntax=docker/dockerfile:1
# Stage 1: Builder
FROM rocky:9 AS builder

# Install build dependencies
RUN dnf install -y \
    gcc \
    make \
    git \
    ca-certificates \
    && dnf clean all \
    && rm -rf /var/cache/dnf

# Build a custom tool (example: compile nvim from source)
WORKDIR /build
RUN git clone --depth 1 https://github.com/neovim/neovim.git
WORKDIR /build/neovim
RUN make CMAKE_BUILD_TYPE=Release && make install INSTALL_PREFIX=/usr/local

# Stage 2: Runtime (minimal, no build tools)
FROM rocky:9 AS runtime

# Install only runtime dependencies
RUN dnf install -y \
    tmux \
    zsh \
    git \
    curl \
    less \
    && dnf clean all \
    && rm -rf /var/cache/dnf

# Copy compiled nvim from builder
COPY --from=builder /usr/local/bin/nvim /usr/local/bin/

# Create non-root user
RUN useradd -m -s /bin/bash devuser

# Set working directory
WORKDIR /home/devuser

# Stage 3: Development (adds dev tools, inherits from runtime)
FROM runtime AS development

USER root
RUN dnf install -y \
    neovim \
    python3-pip \
    && pip3 install pynvim \
    && dnf clean all

USER devuser

# Select which stage to use
FROM ${BUILD_TARGET:-runtime} AS final
```

**Build with target selection:**

```bash
# Build minimal runtime image (faster)
docker build -t dotfiles:runtime --target runtime .

# Build development image (with tools)
docker build -t dotfiles:dev --target development .

# Build with custom base
docker build --build-arg BUILD_TARGET=development -t dotfiles:full .
```

### 4.2 Layer Caching Strategies

**Problem:** Dotfiles change frequently; rebuild takes forever.

**Solution:** Separate stable dependencies from changing configs.

**Optimized Dockerfile:**

```dockerfile
FROM rocky:9

# Step 1: Install all system packages (rarely changes)
# This layer is cached aggressively
RUN dnf update -y && \
    dnf install -y \
    base-devel \
    git \
    neovim \
    tmux \
    zsh \
    curl \
    fzf \
    ripgrep \
    && dnf clean all

# Step 2: Configure system (infrequent changes)
RUN echo "LANG=en_US.UTF-8" > /etc/environment && \
    mkdir -p /root/.cache /root/.local/share

# Step 3: Copy dotfiles (FREQUENT CHANGES - must be last!)
COPY dotfiles /root/.config

# Step 4: Install tools from dotfiles
RUN if [ -f /root/.config/setup.sh ]; then \
    bash /root/.config/setup.sh; \
    fi

ENTRYPOINT ["/bin/zsh"]
```

**Build and measure:**

```bash
# First build (full)
time docker build -t dotfiles:v1 .  # ~45 seconds

# Second build (no changes)
time docker build -t dotfiles:v1 .  # ~2 seconds (cache hit)

# Change only dotfiles, rebuild
echo "# changed" >> dotfiles/.zshrc
time docker build -t dotfiles:v1 .  # ~5 seconds (only Step 3 onwards)
```

**Cache inspection:**

```bash
# View image layers
docker history dotfiles:v1

# Export build cache
docker buildx build --cache-from=type=local,src=./build-cache \
  --cache-to=type=local,dest=./build-cache .
```

### 4.3 Creating a Dotfile Testing Toolkit Base Image

**Goal:** One reusable base image with all common tools, inherit for specific tests.

**Dockerfile (toolkit base):**

```dockerfile
FROM rocky:9

LABEL maintainer="devuser"
LABEL description="Dotfile testing toolkit base image"

# System packages
RUN dnf groupinstall -y "Development Tools" && \
    dnf install -y \
    git \
    curl \
    wget \
    ca-certificates \
    zsh \
    bash \
    fish \
    tmux \
    neovim \
    vim \
    nano \
    less \
    grep \
    sed \
    awk \
    find \
    tree \
    jq \
    yq \
    fzf \
    ripgrep \
    fd \
    bat \
    httpie \
    htop \
    ncdu \
    ssh-clients \
    openssh-server \
    python3 \
    python3-pip \
    ruby \
    ruby-devel \
    node \
    npm \
    go \
    rust \
    && dnf clean all

# Common Python tools
RUN pip3 install --no-cache-dir \
    pynvim \
    neovim \
    black \
    flake8 \
    mypy

# Create test user with sudo
RUN useradd -m -s /bin/zsh testuser && \
    usermod -aG wheel testuser && \
    echo "testuser ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/testuser

# Verify installations
RUN nvim --version && \
    tmux -V && \
    zsh --version && \
    git --version && \
    python3 --version

USER testuser
WORKDIR /home/testuser

ENTRYPOINT ["/bin/zsh"]
CMD ["-i"]
```

**Build and tag:**

```bash
docker build -t toolkit:latest .
docker tag toolkit:latest toolkit:rocky9-2026-04-28
```

**Use in child images:**

```dockerfile
FROM toolkit:latest

COPY dotfiles /home/testuser/.config
RUN ~/.config/install-nvim-plugins.sh
```

### 4.4 Using Docker Compose to Test Multiple OS Versions Simultaneously

**Goal:** Spin up Rocky 8, Rocky 9, and Ubuntu 22.04 all at once, sharing dotfiles.

**`docker-compose.yml`:**

```yaml
version: "3.9"

services:
  rocky8:
    image: rocky:8
    container_name: test-rocky8
    hostname: rocky8
    volumes:
      - dotfiles:/home/testuser/.config:ro
      - test_results:/tmp/results:rw
      - ccache:/root/.ccache
    environment:
      - LANG=en_US.UTF-8
      - TERM=xterm-256color
    command: /bin/bash -c "
      dnf install -y git zsh nvim tmux &&
      /home/testuser/.config/test-suite.sh &&
      cp /tmp/results/* /tmp/results-rocky8/ || true
      "
    networks:
      - testnet

  rocky9:
    image: rocky:9
    container_name: test-rocky9
    hostname: rocky9
    volumes:
      - dotfiles:/home/testuser/.config:ro
      - test_results:/tmp/results:rw
      - ccache:/root/.ccache
    environment:
      - LANG=en_US.UTF-8
      - TERM=xterm-256color
    command: /bin/bash -c "
      dnf install -y git zsh nvim tmux &&
      /home/testuser/.config/test-suite.sh
      "
    networks:
      - testnet
    depends_on:
      - rocky8

  ubuntu22:
    image: ubuntu:22.04
    container_name: test-ubuntu22
    hostname: ubuntu22
    volumes:
      - dotfiles:/home/testuser/.config:ro
      - test_results:/tmp/results:rw
      - build_cache:/root/.cache
    environment:
      - DEBIAN_FRONTEND=noninteractive
      - LANG=en_US.UTF-8
      - TERM=xterm-256color
    command: /bin/bash -c "
      apt-get update &&
      apt-get install -y git zsh neovim tmux &&
      /home/testuser/.config/test-suite.sh
      "
    networks:
      - testnet

volumes:
  dotfiles:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: ./dotfiles
  test_results:
    driver: local
  ccache:
    driver: local
  build_cache:
    driver: local

networks:
  testnet:
    driver: bridge
```

**Usage:**

```bash
# Start all services in parallel
docker compose up --build

# Tail logs from all services
docker compose logs -f

# Tail logs from one service
docker compose logs -f rocky9

# Stop all services
docker compose down

# Clean up volumes too
docker compose down -v

# Run a specific service only
docker compose up rocky9

# Execute command in running service
docker compose exec rocky9 /bin/zsh
```

### 4.5 Persisting Test Results with Named Volumes

**Goal:** Capture test output from containers for analysis.

**Dockerfile with test results capture:**

```dockerfile
FROM rocky:9

RUN dnf install -y git neovim tmux pytest

COPY dotfiles /root/.config

# Create results directory
RUN mkdir -p /tmp/test-results

WORKDIR /root/.config

# Run tests, capture output
RUN pytest tests/ --junit-xml=/tmp/test-results/junit.xml \
    --html=/tmp/test-results/report.html || true

VOLUME ["/tmp/test-results"]

ENTRYPOINT ["/bin/zsh"]
```

**Run with named volume:**

```bash
# First run
docker run -v test_results:/tmp/test-results \
  --name config_test1 \
  rocky-dotfiles:latest

# Results persist after container stops
docker run -v test_results:/tmp/test-results \
  --rm \
  rocky-dotfiles:latest \
  cat /tmp/test-results/junit.xml

# Inspect volume
docker volume inspect test_results

# Export results to host
docker run --rm \
  -v test_results:/results \
  -v ./results:/export \
  alpine cp -r /results/* /export/

# Clean up
docker volume rm test_results
```

### 4.6 Using `docker commit` to Snapshot Working Config States

**Goal:** Save a "known good" state after successful testing.

**Workflow:**

```bash
# Run container, test interactively
docker run -it \
  -v dotfiles:/home/testuser/.config \
  rocky:9 \
  /bin/zsh

# Inside container, make adjustments, verify everything works
# Then exit (Ctrl+D)

# Check which container you were in
docker ps -a

# Commit the container to an image
docker commit <container-id> dotfiles:working-state-2026-04-28

# Tag it
docker tag dotfiles:working-state-2026-04-28 dotfiles:stable

# Push for backup
docker push myregistry/dotfiles:stable

# Later, restore from snapshot
docker run -it dotfiles:stable
```

**Caveats:**

- Commits are **not reproducible** (no Dockerfile audit trail)
- Commits are **large** (includes all container changes)
- For permanent snapshots, always update the Dockerfile instead
- Use commits for **temporary debugging**, not production

### 4.7 Creating a `justfile` to Automate Common Workflows

**Goal:** Replace complex bash commands with simple, repeatable recipes.

**`justfile`:**

```justfile
# vim: set filetype=makefile:

# Default recipe
default:
  @just --list

# Build image with current dotfiles
build OS="rocky9":
  docker build \
    --build-arg BASE_IMAGE={{OS}} \
    -t dotfiles:{{OS}}-latest \
    .

# Run container interactively
run OS="rocky9" SHELL="/bin/zsh":
  docker run -it \
    -v ./dotfiles:/home/testuser/.config \
    --name test-{{OS}}-$(date +%s) \
    dotfiles:{{OS}}-latest \
    {{SHELL}}

# Run all tests across OS versions
test:
  @echo "Testing Rocky 8..."
  docker compose up rocky8
  @echo "Testing Rocky 9..."
  docker compose up rocky9
  @echo "Testing Ubuntu 22.04..."
  docker compose up ubuntu22
  @echo "All tests complete!"

# Run a specific test
test-single OS="rocky9" TEST="test_zsh":
  docker run --rm \
    -v ./dotfiles:/home/testuser/.config \
    dotfiles:{{OS}}-latest \
    pytest -v tests/{{TEST}}.py

# Cleanup: remove all test containers and images
cleanup:
  @echo "Removing containers..."
  docker compose down -v || true
  docker container prune -f
  @echo "Removing images..."
  docker image prune -af
  @echo "Done!"

# View image history and layer sizes
inspect OS="rocky9":
  docker history dotfiles:{{OS}}-latest

# Export test results
export-results:
  mkdir -p ./test-results
  docker run --rm \
    -v test_results:/results \
    -v ./test-results:/export \
    alpine cp -r /results/* /export/ || echo "No results to export"

# Rebuild cache and push
publish VERSION:
  docker build \
    --cache-to type=inline \
    -t myregistry/dotfiles:{{VERSION}} \
    -t myregistry/dotfiles:latest \
    .
  docker push myregistry/dotfiles:{{VERSION}}
  docker push myregistry/dotfiles:latest
```

**Usage:**

```bash
just build rocky9
just run rocky9
just test
just cleanup
just inspect rocky8
just publish 2026-04-28
```

### 4.8 Git Integration: Testing Dotfile Branches Inside Containers

**Goal:** Test dotfile configuration changes on separate git branches without touching the host.

**Dockerfile with git support:**

```dockerfile
FROM rocky:9

RUN dnf install -y git openssh-clients

COPY dotfiles /tmp/dotfiles-src

WORKDIR /root/.config

# Initialize git repo from COPY source
RUN cd /tmp/dotfiles-src && \
    git init && \
    git config user.email "test@example.com" && \
    git config user.name "Test User" && \
    git add -A && \
    git commit -m "Initial state" && \
    git log --oneline

# Clone into working directory
RUN git clone /tmp/dotfiles-src . && \
    git remote add origin https://github.com/user/dotfiles.git

ENTRYPOINT ["/bin/zsh"]
```

**Test a branch:**

```bash
docker run -it rocky-dotfiles /bin/zsh -c "
  cd ~/.config
  git fetch origin feature/new-nvim-config
  git checkout feature/new-nvim-config
  nvim --version
  nvim +PlugStatus
"
```

**Automated branch testing:**

```bash
#!/bin/bash
# test-branches.sh

branches=("main" "develop" "feature/nvim-lsp" "feature/tmux-plugins")

for branch in "${branches[@]}"; do
  echo "Testing branch: $branch"
  docker run --rm \
    -v dotfiles:/home/testuser/.config \
    rocky-dotfiles \
    /bin/bash -c "
      cd ~/.config
      git fetch origin
      git checkout $branch
      ./test-suite.sh && echo 'PASS: $branch' || echo 'FAIL: $branch'
    "
done
```

### 4.9 SSH Agent Forwarding for Git Operations

**Goal:** Access private git repositories and GitHub from inside containers.

**Enable SSH agent forwarding (macOS/Linux):**

```bash
# Start SSH agent (if not running)
eval $(ssh-agent)

# Add your key
ssh-add ~/.ssh/id_ed25519

# Verify
ssh-add -l
```

**Docker run with SSH agent forwarding:**

```bash
docker run -it \
  -v $SSH_AUTH_SOCK:/ssh-agent \
  -e SSH_AUTH_SOCK=/ssh-agent \
  -v dotfiles:/home/testuser/.config \
  rocky:9 \
  /bin/zsh
```

**Inside the container:**

```bash
ssh -T git@github.com  # Should work without password

git clone git@github.com:user/private-dotfiles.git
```

**Docker Compose with SSH agent:**

```yaml
services:
  dotfiles:
    image: rocky:9
    volumes:
      - $SSH_AUTH_SOCK:/ssh-agent
      - dotfiles:/home/testuser/.config
    environment:
      - SSH_AUTH_SOCK=/ssh-agent
    command: /bin/zsh
```

**BuildKit SSH support (for build-time git access):**

```dockerfile
# syntax=docker/dockerfile:1

FROM rocky:9

# Using secret mount (BuildKit)
RUN --mount=type=ssh git clone git@github.com:user/dotfiles.git /home/testuser/.config
```

**Build with SSH access:**

```bash
docker buildx build --ssh default /home/testuser/.config .
```

---

## 5. Practical Examples

### Example 1: Complete `docker-compose.yml` with Shared Dotfiles Volume

**Scenario:** You manage dotfiles with chezmoi. Test installation across Rocky 8, Rocky 9, and Ubuntu 22.04 simultaneously.

**`docker-compose.yml`:**

```yaml
version: "3.9"

# Shared configuration (compose feature)
x-common: &common
  volumes:
    - dotfiles:/home/testuser/.config:ro
    - test_reports:/tmp/reports:rw
    - ssh_auth:/ssh-agent:ro
  environment: &common_env
    - TERM=xterm-256color
    - LANG=en_US.UTF-8
    - TZ=UTC
    - SSH_AUTH_SOCK=/ssh-agent

services:
  rocky8:
    <<: *common
    image: rocky:8
    container_name: dotfiles-rocky8
    hostname: rocky8
    environment:
      <<: *common_env
      - TEST_OS=rocky8
      - DNF_INSTALL_CMD="dnf install -y"
    command: bash -c "
      dnf update -y &&
      dnf groupinstall -y 'Development Tools' &&
      dnf install -y git zsh neovim tmux chezmoi python3-pip &&
      python3 -m pip install --upgrade pip &&
      useradd -m testuser || true &&
      cd /home/testuser &&
      chezmoi init --apply git@github.com:user/dotfiles.git &&
      ./test.sh > /tmp/reports/rocky8.log 2>&1 &&
      echo 'Rocky 8: PASS' || echo 'Rocky 8: FAIL'
      "
    networks:
      - testnet

  rocky9:
    <<: *common
    image: rocky:9
    container_name: dotfiles-rocky9
    hostname: rocky9
    environment:
      <<: *common_env
      - TEST_OS=rocky9
      - DNF_INSTALL_CMD="dnf install -y"
    command: bash -c "
      dnf update -y &&
      dnf groupinstall -y 'Development Tools' &&
      dnf install -y git zsh neovim tmux chezmoi python3-pip &&
      python3 -m pip install --upgrade pip &&
      useradd -m testuser || true &&
      cd /home/testuser &&
      chezmoi init --apply git@github.com:user/dotfiles.git &&
      ./test.sh > /tmp/reports/rocky9.log 2>&1 &&
      echo 'Rocky 9: PASS' || echo 'Rocky 9: FAIL'
      "
    networks:
      - testnet
    depends_on:
      - rocky8

  ubuntu22:
    <<: *common
    image: ubuntu:22.04
    container_name: dotfiles-ubuntu22
    hostname: ubuntu22
    environment:
      <<: *common_env
      - TEST_OS=ubuntu22
      - DEBIAN_FRONTEND=noninteractive
    command: bash -c "
      apt-get update &&
      apt-get install -y build-essential git zsh neovim tmux curl python3-pip &&
      python3 -m pip install --upgrade pip &&
      useradd -m testuser || true &&
      apt-get install -y chezmoi &&
      cd /home/testuser &&
      chezmoi init --apply git@github.com:user/dotfiles.git &&
      ./test.sh > /tmp/reports/ubuntu22.log 2>&1 &&
      echo 'Ubuntu 22: PASS' || echo 'Ubuntu 22: FAIL'
      "
    networks:
      - testnet
    depends_on:
      - rocky8

volumes:
  dotfiles:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: ${PWD}/dotfiles
  test_reports:
    driver: local
  ssh_auth:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: ${SSH_AUTH_SOCK}

networks:
  testnet:
    driver: bridge
```

**Usage:**

```bash
# Ensure SSH agent is running
eval $(ssh-agent)
ssh-add ~/.ssh/id_ed25519

# Run all tests
docker compose up

# View results
cat test_reports/rocky8.log
cat test_reports/rocky9.log
cat test_reports/ubuntu22.log

# Clean up
docker compose down -v
```

### Example 2: `justfile` Automating Build/Run/Test/Cleanup Cycle

**`justfile`:**

```justfile
#!/usr/bin/env just --justfile

set shell := ["bash", "-c"]

# Build all images
build:
  @echo "Building multi-stage images..."
  docker buildx build \
    --target runtime \
    -t dotfiles:runtime-latest \
    -t dotfiles:runtime-{{now}} \
    --load \
    .
  docker buildx build \
    --target development \
    -t dotfiles:dev-latest \
    -t dotfiles:dev-{{now}} \
    --load \
    .
  @echo "Build complete!"

# Run interactive container with current dotfiles
run TARGET="dev":
  @echo "Starting {{TARGET}} container..."
  docker run -it \
    --rm \
    -v ./dotfiles:/root/.config:ro \
    -v /tmp/results:/tmp/results:rw \
    --name dotfiles-{{TARGET}}-$(date +%s) \
    dotfiles:{{TARGET}}-latest

# Test across all OS versions
test:
  @echo "Running tests..."
  docker compose build
  docker compose up --abort-on-container-exit
  @echo "Extracting results..."
  just export-results

# Run a specific test
test-file PATH:
  @echo "Running test: {{PATH}}"
  docker run --rm \
    -v ./dotfiles:/root/.config:ro \
    -v {{PATH}}:{{PATH}}:ro \
    dotfiles:dev-latest \
    pytest -v {{PATH}}

# Export test results from volume
export-results:
  @echo "Exporting test results..."
  mkdir -p ./reports
  docker run --rm \
    -v test_reports:/results:ro \
    -v ./reports:/export:rw \
    alpine:latest \
    sh -c 'cp -r /results/* /export/ 2>/dev/null || echo "No results found"'
  @echo "Results in ./reports/"

# Benchmark layer cache performance
benchmark:
  @echo "First build (full)..."
  time docker build -t benchmark:v1 . 2>&1 | tail -5
  @echo "\nSecond build (cached)..."
  time docker build -t benchmark:v1 . 2>&1 | tail -5
  @echo "\nChanging dotfiles..."
  echo "# test change" >> ./dotfiles/.zshrc
  @echo "Third build (partial)..."
  time docker build -t benchmark:v1 . 2>&1 | tail -5

# Clean everything
clean: cleanup
  @echo "Cleaned!"

# Remove containers, images, volumes
cleanup:
  @echo "Stopping containers..."
  docker compose down -v || true
  @echo "Pruning containers..."
  docker container prune -f --filter "label!=important"
  @echo "Pruning images..."
  docker image prune -f
  @echo "Cleanup complete!"

# View disk usage
du:
  @docker system df

# Inspect image layers
inspect TARGET="dev":
  @echo "Layers for dotfiles:{{TARGET}}-latest:"
  docker history dotfiles:{{TARGET}}-latest --no-trunc

# Push to registry
push VERSION TAG="latest":
  docker tag dotfiles:dev-latest myregistry/dotfiles:{{VERSION}}
  docker tag dotfiles:dev-latest myregistry/dotfiles:{{TAG}}
  docker push myregistry/dotfiles:{{VERSION}}
  docker push myregistry/dotfiles:{{TAG}}

# Pull from registry
pull VERSION:
  docker pull myregistry/dotfiles:{{VERSION}}

# Run shell in last container
shell:
  @CONTAINER=$$(docker ps -aq --latest) && \
  if [ -n "$$CONTAINER" ]; then \
    docker exec -it $$CONTAINER /bin/zsh || /bin/bash; \
  else \
    echo "No running containers"; \
  fi

# Show help
help:
  @just --list --unsorted
```

### Example 3: CI/CD Pipeline Validating Dotfiles Across OS Versions

**`.github/workflows/test-dotfiles.yml`:**

```yaml
name: Test Dotfiles

on:
  push:
    branches: [main, develop, feature/*]
    paths:
      - 'dotfiles/**'
      - 'Dockerfile'
      - '.github/workflows/test-dotfiles.yml'
  pull_request:
    branches: [main]

jobs:
  test:
    name: Test on ${{ matrix.os }}
    runs-on: ubuntu-latest
    strategy:
      matrix:
        os: [rocky8, rocky9, ubuntu22]
      fail-fast: false

    steps:
      - uses: actions/checkout@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v2

      - name: Build Docker image
        uses: docker/build-push-action@v4
        with:
          context: .
          push: false
          load: true
          tags: dotfiles:${{ matrix.os }}-test
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Run tests on ${{ matrix.os }}
        run: |
          docker run --rm \
            -v ${{ github.workspace }}/dotfiles:/root/.config:ro \
            -v /tmp/results:/tmp/results:rw \
            dotfiles:${{ matrix.os }}-test \
            bash -c "
              set -e
              echo '=== Testing on ${{ matrix.os }} ==='
              nvim --version
              tmux -V
              zsh --version
              if [ -f /root/.config/test.sh ]; then
                /root/.config/test.sh
              fi
              echo 'All tests passed!'
            "

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: test-results-${{ matrix.os }}
          path: /tmp/results/

  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Hadolint (Dockerfile linting)
        uses: hadolint/hadolint-action@v3.1.0
        with:
          dockerfile: Dockerfile
          failure-threshold: warning

      - name: ShellCheck
        run: |
          apt-get update && apt-get install -y shellcheck || true
          shellcheck dotfiles/*.sh || true

  security:
    name: Security scan
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Trivy vulnerability scan
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: 'rocky:9'
          format: 'sarif'
          output: 'trivy-results.sarif'

      - name: Upload Trivy results
        uses: github/codeql-action/upload-sarif@v2
        with:
          sarif_file: 'trivy-results.sarif'

  results:
    name: Test results summary
    needs: [test]
    runs-on: ubuntu-latest
    if: always()
    steps:
      - name: Download all artifacts
        uses: actions/download-artifact@v3

      - name: Print summary
        run: |
          echo "## Test Results Summary" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY
          for result in test-results-*/; do
            os=$(basename "$result")
            echo "- **${os}**: " >> $GITHUB_STEP_SUMMARY
            if [ -f "$result/test.log" ]; then
              head -5 "$result/test.log" | sed 's/^/  /' >> $GITHUB_STEP_SUMMARY
            fi
          done
```

### Example 4: Using BuildKit Secrets to Inject SSH Keys Safely

**Scenario:** Clone private dotfile repo during build without baking credentials into image.

**Dockerfile (BuildKit frontend):**

```dockerfile
# syntax=docker/dockerfile:1

FROM rocky:9

# Install dependencies
RUN dnf install -y git ssh-clients openssh

# Mount SSH key via secret mount (not in final image!)
RUN --mount=type=secret,id=github_ssh_key \
    mkdir -p ~/.ssh && \
    cp /run/secrets/github_ssh_key ~/.ssh/id_ed25519 && \
    chmod 600 ~/.ssh/id_ed25519 && \
    ssh-keyscan github.com >> ~/.ssh/known_hosts

# Clone private repo
RUN --mount=type=secret,id=github_ssh_key \
    git clone git@github.com:user/private-dotfiles.git /root/.config

# Secret is NOT in final image!
RUN rm -f ~/.ssh/id_ed25519

ENTRYPOINT ["/bin/zsh"]
```

**Build with secret:**

```bash
# Provide secret via file
docker buildx build \
  --secret id=github_ssh_key,src=$HOME/.ssh/id_ed25519 \
  -t dotfiles:secure \
  .

# Or via stdin
cat ~/.ssh/id_ed25519 | \
  docker buildx build \
    --secret id=github_ssh_key,stdin \
    -t dotfiles:secure \
    .

# Verify secret is not in image
docker run --rm dotfiles:secure ls -la ~/.ssh
# Output: No such file or directory ✓
```

### Example 5: Mounting Chezmoi-Managed Dotfiles into Containers

**Scenario:** Manage dotfiles with chezmoi, test in containers without installing chezmoi in container.

**Host setup:**

```bash
# Create chezmoi-managed dotfiles
chezmoi init --apply https://github.com/user/dotfiles

# Generate plain dotfiles (chezmoi templates evaluated)
chezmoi data
chezmoi managed  # List all managed files
```

**Dockerfile:**

```dockerfile
FROM rocky:9

RUN dnf install -y git zsh neovim tmux

WORKDIR /root

ENTRYPOINT ["/bin/zsh"]
```

**Run with chezmoi-rendered dotfiles:**

```bash
# Render chezmoi templates to host temp dir
chezmoi execute-template < ~/.chezmoi/templates/.zshrc > /tmp/.zshrc

# Mount rendered dotfiles
docker run -it \
  -v /tmp/.zshrc:/root/.zshrc:ro \
  -v ~/chezmoi_data:/root/.config/chezmoi:ro \
  dotfiles:latest

# Or use docker-compose
cat > docker-compose.yml << 'EOF'
version: "3.9"
services:
  test:
    image: rocky:9
    volumes:
      - ${HOME}/.local/share/chezmoi:/root/.chezmoi:ro
    command: /bin/zsh
    environment:
      - TERM=xterm-256color
EOF

docker compose up
```

**Alternative: Use chezmoi in container:**

```dockerfile
FROM rocky:9

RUN dnf install -y git zsh neovim tmux
RUN go install github.com/twpayne/chezmoi@latest

# Shallow clone (faster)
RUN git clone --depth 1 https://github.com/user/dotfiles.git /tmp/dotfiles

WORKDIR /root
RUN chezmoi init --apply /tmp/dotfiles

ENTRYPOINT ["/bin/zsh"]
```

### Example 6: Testing LunarVim Installation from Scratch in a Container

**Scenario:** Verify LunarVim installation works cleanly with your custom neovim config.

**Dockerfile:**

```dockerfile
FROM rocky:9

# Prerequisites for LunarVim
RUN dnf groupinstall -y "Development Tools" && \
    dnf install -y \
    git \
    curl \
    wget \
    ca-certificates \
    neovim \
    ripgrep \
    fd \
    fzf \
    python3-pip \
    nodejs \
    npm \
    && dnf clean all

# Install additional tools for testing
RUN pip3 install --no-cache-dir pynvim

# Create test user
RUN useradd -m -s /bin/bash nvimtest

USER nvimtest
WORKDIR /home/nvimtest

# Install LunarVim
RUN curl -s https://raw.githubusercontent.com/LunarVim/LunarVim/rolling/utils/installer/install.sh | bash

# Copy custom config (override LunarVim defaults)
COPY --chown=nvimtest:nvimtest nvim_config /home/nvimtest/.config/nvim

# Verify installation
RUN nvim --version && \
    ls -la ~/.config/nvim && \
    ls -la ~/.local/share/lunarvim

# Test startup (headless)
RUN timeout 10 nvim -c 'qall' -u ~/.config/nvim/init.lua || true

ENTRYPOINT ["nvim"]
CMD ["-u", "/home/nvimtest/.config/nvim/init.lua", "+qa"]
```

**Test LunarVim plugins:**

```bash
docker run --rm -v ./nvim_config:/home/nvimtest/.config/nvim:ro \
  dotfiles:lunarvim -c 'PlugStatus'

docker run -it -v ./nvim_config:/home/nvimtest/.config/nvim \
  dotfiles:lunarvim

# Inside container
# Check plugins loaded
:Lazy
:LspInfo
:MasonInfo
:TelescopeFind
```

---

## 6. Hands-On Exercises

### Exercise 1: Build a Multi-Stage Image with Layer Caching Optimization

**Objective:** Create a two-stage Dockerfile that caches build dependencies separately from application code.

**Task:**

1. Create a Dockerfile with two stages: `builder` and `runtime`
2. In builder stage, install build tools and compile a tool (e.g., build ripgrep from source)
3. In runtime stage, copy only compiled binaries, not build tools
4. Measure build time on first run, then modify only the runtime stage and measure again
5. Verify the builder stage used cache (rebuild much faster)

**Success criteria:**

- Second build runs in < 3 seconds (cache hits)
- First run: ~30 seconds, second run: ~2 seconds
- `docker history` shows builder and runtime stages
- Final image is smaller than single-stage equivalent

### Exercise 2: Create Docker Compose with 3 OS Versions and Shared Volume

**Objective:** Set up docker-compose.yml that tests dotfiles across Rocky 8, Rocky 9, and Ubuntu 22.

**Task:**

1. Write docker-compose.yml with three services
2. Each service: different base image, same `dotfiles` volume
3. Add `test_results` named volume for capturing output
4. Run `docker compose up` and verify all three containers start
5. Verify files in `test_results` volume from all three OS versions

**Success criteria:**

- `docker compose ps` shows 3 running services
- `docker volume ls` shows dotfiles and test_results
- Test output from all 3 OS versions exists
- `docker compose down -v` cleans up everything

### Exercise 3: Implement Layer Caching Benchmark

**Objective:** Demonstrate the performance impact of layer ordering.

**Task:**

1. Create two Dockerfiles:
   - `Dockerfile.bad`: Installs dependencies, then copies dotfiles (changes invalidate cache)
   - `Dockerfile.good`: Copies dotfiles, then installs (dependencies cached)
2. Build bad version: time the first and second builds
3. Build good version: time the first and second builds
4. Modify dotfiles and rebuild both versions, measure time difference

**Success criteria:**

- Good version shows 10-30x faster rebuild after dotfile changes
- Bad version rebuilds everything each time
- Layer cache inspection shows good version reuses dependency layer

### Exercise 4: Test Dotfile Branch with BuildKit SSH Forwarding

**Objective:** Use BuildKit SSH secrets to test git branch in container.

**Task:**

1. Create a feature branch in your dotfiles repo
2. Write Dockerfile with `RUN --mount=type=ssh` to clone branch
3. Build with `--secret` flag pointing to SSH key
4. Verify branch content available in container
5. Verify SSH key not in final image

**Success criteria:**

- Build succeeds with SSH mount
- Dockerfile uses BuildKit syntax
- `docker run <image> cat ~/.dotfiles/.git/HEAD` shows correct branch
- `docker run <image> ls ~/.ssh/id_*` returns empty

### Exercise 5: Implement `justfile` Workflow Automation

**Objective:** Create justfile with recipes for build, test, cleanup.

**Task:**

1. Write justfile with recipes: `build`, `run`, `test`, `cleanup`, `inspect`
2. `just build` builds both runtime and dev images
3. `just run` starts interactive container with dotfiles volume
4. `just test` runs docker-compose test suite
5. `just cleanup` removes containers, images, volumes
6. Verify each recipe works without shell knowledge

**Success criteria:**

- `just build` builds both images
- `just run` drops into container shell
- `just test` runs full test suite
- `just cleanup` removes everything safely
- `just --list` shows all available recipes

---

## 7. Troubleshooting

### 7.1 BuildKit Cache Invalidation

**Problem:** BuildKit cache not being reused when you expect it.

**Debug steps:**

```bash
# Check if BuildKit is enabled
docker buildx ls

# Build with verbose output
docker buildx build --progress=plain -t test . 2>&1 | grep -E "CACHED|RUN"

# Inspect cache info
docker buildx du

# Clear build cache
docker buildx prune -af

# Force rebuild without cache
docker build --no-cache -t test .
```

**Common causes:**

| Cause | Solution |
|-------|----------|
| String interpolation in RUN | Use BuildKit syntax: `--mount=type=cache,target=/var/cache` |
| File timestamps | Use `.dockerignore` to exclude changing files |
| ENV variables | Move ENV above files that depend on them |
| Wildcard COPY | Specify exact files: `COPY dotfiles /root/.config` |

### 7.2 Volume Permission Mismatches (UID/GID)

**Problem:** Files in bind mount appear as `root:root` in container, `nobody:nogroup` on host (or vice versa).

**Cause:** Host and container UID/GID don't match.

**Solutions:**

```bash
# Option 1: Run container as host user
docker run --user $(id -u):$(id -g) \
  -v ./dotfiles:/root/.config \
  rocky:9

# Option 2: Change host file ownership
sudo chown -R $(id -u):$(id -g) ./dotfiles

# Option 3: Use named volume (Docker handles mapping)
docker run -v dotfiles:/root/.config rocky:9

# Option 4: Use userns-remap (in daemon.json)
# Maps container root → unprivileged host user
```

**Verify permissions:**

```bash
# On host
ls -l ./dotfiles

# In container
docker run -it -v ./dotfiles:/mnt rocky:9 ls -l /mnt
```

### 7.3 SELinux Context on Rocky Linux (`:z` and `:Z` flags)

**Problem:** Container can't read host files due to SELinux restrictions.

**Symptoms:**

```
Permission denied: /root/.config (in container, but file is world-readable on host)
```

**Solution: Use selinux volume flags:**

```bash
# :z = shared (readable by container and other processes)
docker run -v ./dotfiles:/root/.config:z rocky:9

# :Z = private (readable only by this container)
docker run -v ./dotfiles:/root/.config:Z rocky:9

# Named volumes (SELinux automatic)
docker run -v dotfiles:/root/.config rocky:9
```

**Check SELinux status:**

```bash
getenforce  # Returns Enforcing, Permissive, or Disabled
```

**Disable SELinux for testing (risky):**

```bash
setenforce 0  # Temporary (until reboot)
```

### 7.4 Terminal Capabilities in Containers

**Problem:** Terminal output is broken in container (colors not working, cursor keys broken).

**Cause:** `TERM` variable mismatch or missing terminfo.

**Solutions:**

```bash
# Pass TERM from host
docker run -it -e TERM=$TERM rocky:9 zsh

# Or set explicitly
docker run -it -e TERM=xterm-256color rocky:9 zsh
docker run -it -e TERM=rxvt-unicode-256color rocky:9 zsh

# Install terminfo in image
RUN dnf install -y ncurses-term

# Verify inside container
echo $TERM
tput colors  # Should output 256
```

### 7.5 True Color Support in Containers

**Problem:** True color (24-bit RGB) not working in neovim/tmux inside container.

**Cause:** `TERM` doesn't advertise true color capability.

**Solutions:**

```bash
# For 256-color terminal
docker run -e TERM=xterm-256color rocky:9

# For true color terminals (requires matching host)
docker run -e TERM=tmux-256color rocky:9

# In Dockerfile
ENV TERM=xterm-256color

# In tmux config (inside container)
set -g default-terminal "tmux-256color"
set -ga terminal-overrides ",xterm-256color:RGB"

# In neovim config
set termguicolors
```

**Verify true color support:**

```bash
# Run this inside container
cat > /tmp/color-test.sh << 'EOF'
for i in {0..255}; do
  printf "\x1b[38;5;${i}mColor $i "
done
printf "\n"
EOF
bash /tmp/color-test.sh
```

### 7.6 Clipboard Integration (xclip/xsel in Containers)

**Problem:** Clipboard commands (xclip, xsel) don't work in container.

**Cause:** Container has no access to host X11 or Wayland.

**Solutions for neovim clipboard:**

```bash
# Option 1: Use SSH agent for non-clipboard tasks
docker run --mount type=bind,src=/run/user/1000,dst=/run/user/1000 rocky:9

# Option 2: Install clipboard tool that works remotely
docker run -e DISPLAY=$DISPLAY \
  -v /tmp/.X11-unix:/tmp/.X11-unix:rw \
  -v ~/.Xauthority:/root/.Xauthority:ro \
  rocky:9

# Option 3: In nvim, use simple register (no clipboard)
" Neovim config - disable clipboard integration
set clipboard=""

# Option 4: Use tmux buffer instead of system clipboard
tmux send-keys 'copy-mode'  # Then select text

# Option 5: For SSH containers, use OSC 52 sequence
# Enables clipboard over SSH (requires terminal support)
set -g set-clipboard on
```

### 7.7 Performance on macOS (VirtioFS vs gRPC FUSE)

**Problem:** Volume bind mounts extremely slow on macOS (30-100x slower than Linux).

**Cause:** File sync between macOS host and Linux Docker VM is expensive.

**Solutions:**

| Solution | Performance | Trade-off |
|----------|-------------|-----------|
| **VirtioFS** (default in Docker Desktop 4.6+) | 2-3x improvement | Uses more VM memory |
| **gRPC FUSE** (older Docker Desktop) | 1.5-2x improvement | Higher CPU usage |
| **Named volumes** (no bind mount) | Native speed | Can't edit files on host easily |
| **Delegated mounts** | Slight improvement | Potential data sync issues |
| **Cached mounts** | Slight improvement | Potential data sync issues |

**Enable VirtioFS (Docker Desktop settings):**

```
Preferences → Resources → File Sharing Implementation → VirtioFS
```

**Use delegated/cached for faster but less safe sync:**

```bash
# delegated: VM changes are slow to propagate to host
docker run -v ./dotfiles:/root/.config:delegated rocky:9

# cached: host changes are slow to propagate to VM
docker run -v ./dotfiles:/root/.config:cached rocky:9
```

**Benchmark volume performance:**

```bash
# Time a file operation in container
time docker run --rm -v ./large_dir:/data rocky:9 find /data -type f -name "*.txt" | wc -l
```

**Alternative: Use Lima or OrbStack on macOS:**

Lima and OrbStack use native Linux VMs with better filesystem performance than Docker Desktop.

---

## 8. References

### Official Documentation

- **Docker Docs:**
  - [Multi-stage builds](https://docs.docker.com/build/building/multi-stage/)
  - [Dockerfile reference](https://docs.docker.com/reference/dockerfile/)
  - [Docker Compose specification](https://github.com/compose-spec/compose-spec)
  - [BuildKit documentation](https://github.com/moby/buildkit)
  - [Volume types](https://docs.docker.com/storage/volumes/)

- **Linux and Container Internals:**
  - [Docker architecture](https://docs.docker.com/get-started/overview/#docker-architecture)
  - [Linux namespaces](https://man7.org/linux/man-pages/man7/namespaces.7.html)
  - [cgroups](https://man7.org/linux/man-pages/man7/cgroups.7.html)
  - [Overlay filesystem](https://www.kernel.org/doc/html/latest/filesystems/overlayfs.html)

- **Rocky Linux:**
  - [Rocky Linux documentation](https://docs.rockylinux.org/)
  - [DNF package manager](https://dnf.readthedocs.io/)

### Related Tools and Alternatives

- **Container alternatives:**
  - [Podman](https://podman.io/) — drop-in Docker replacement, rootless by default
  - [Tart](https://tart.run/) — VM provisioning tool for macOS
  - [OrbStack](https://orbstack.dev/) — macOS Docker/Linux VM alternative
  - [Lima](https://lima-vm.io/) — lightweight Linux VM on macOS
  - [Distrobox](https://github.com/89luca89/distrobox) — containerized Linux distribution on host

- **Configuration management:**
  - [Chezmoi](https://www.chezmoi.io/) — manage dotfiles
  - [Nix](https://nixos.org/) — declarative configuration and packages
  - [GNU Stow](https://www.gnu.org/software/stow/) — symlink farm manager

- **Task runners:**
  - [Just](https://github.com/casey/just) — command runner (like Make)
  - [GNU Make](https://www.gnu.org/software/make/)
  - [Task](https://taskfile.dev/) — task runner in Go

- **CI/CD:**
  - [GitHub Actions](https://github.com/features/actions)
  - [GitLab CI](https://docs.gitlab.com/ee/ci/)
  - [Drone CI](https://www.drone.io/)

### Books and Articles

- "Docker Deep Dive" by Nigel Poulton
- "Container Security" by Liz Rice
- [CNCF Cloud Native Landscape](https://landscape.cncf.io/)

---

## 9. Architecture & Internals

### 9.1 Namespace Isolation

Linux namespaces provide process isolation, making containers safe sandboxes:

| Namespace | What It Isolates | Impact on Config Testing |
|-----------|------------------|-------------------------|
| **PID** | Process IDs | Container PID 1 is isolated; host processes hidden |
| **Network** | Network interfaces, IPs, ports | Containers have isolated IP stack; no host network interference |
| **Mount** | Filesystem mounts | Container has own mount table; host `/` is read-only unless bound |
| **IPC** | Inter-process communication | Prevents container code from reaching host shared memory |
| **User** | UID/GID mapping | Container root ≠ host root (optional user namespace remapping) |
| **UTS** | Hostname, domainname | Each container has isolated hostname |
| **Cgroup** | Resource limits | Container CPU/memory isolated from host |

**Why this matters:** Your host system is completely safe. Even if a config sets `rm -rf /`, it only removes files inside the container's namespace.

```bash
# Verify isolation
docker run --rm rocky:9 ps aux
# Output: Only container processes, not host processes

docker run --rm rocky:9 ip addr
# Output: Container's virtual network interface, not host's
```

### 9.2 Overlay Filesystem (Union FS)

Docker images are stacked layers, built on overlay filesystem technology:

```
Layer 5 (thin RW layer — container changes)
  ↓
Layer 4 (FROM base image, immutable)
  ↓
Layer 3 (RUN instruction, immutable)
  ↓
Layer 2 (COPY instruction, immutable)
  ↓
Layer 1 (Base OS from registry, immutable)
```

**How it works:**

- Each layer is a **snapshot** of filesystem changes at that point
- Layers are **stacked** using overlay FS (modern Linux kernel feature)
- Container has a **thin RW layer** on top where changes are written
- When container reads a file, it looks from top layer down until found (copy-on-write)
- When container writes a file, it writes to the RW layer

**Performance implications:**

- Writing large files in containers is slower (copy-on-write overhead)
- Deleting files doesn't reclaim space (delete marker in RW layer, lower layers unchanged)
- Nested reads (file in 3rd layer) are slower than reading from top layer

**Example:**

```bash
# Build creates layers
docker build -t test .

# Each instruction is a layer
docker history test
# IMAGE             CREATED ...  SIZE      CREATED BY
# abc123            5s    ago     150MB     /bin/sh -c dnf install ...
# def456            10s   ago     50MB      /bin/sh -c from rocky:9
```

### 9.3 Why Containers Are Better Than VMs for Config Testing

| Aspect | Container | VM |
|--------|-----------|-----|
| **Startup time** | ~100ms | ~10-30s |
| **Memory overhead** | ~10-50MB | ~512MB-2GB |
| **Disk space** | Shared layers, ~100MB each | 10-40GB each |
| **Layer caching** | Instant, multi-stage | None, full rebuild |
| **Portability** | Any Docker host | Specific hypervisor |
| **Isolation** | Namespace-based | Full VM isolation |
| **Network setup** | Automatic | Manual bridge/NAT |

**For config testing specifically:**

- **Instant test cycles:** Change dotfile, rebuild in 2-5 seconds vs VM snapshots (20+ seconds)
- **Layer caching:** Reuse Rocky 9 base image across 10 tests vs separate VMs
- **Multiple OS versions:** Test Rocky 8, 9, Ubuntu 22 simultaneously in <2GB RAM vs 20GB for 3 VMs

### 9.4 When to Use VMs Instead of Containers

VMs are better for:

| Use Case | Reason |
|----------|--------|
| **Kernel testing** | Containers share host kernel |
| **Device drivers** | Containers can't load kernel modules |
| **GPU access** | Complex GPU pass-through in containers (NVIDIA Container Toolkit workaround) |
| **Full OS testing** | Boot process, systemd behavior, init system |
| **macOS/Windows config** | Can't run macOS/Windows inside Linux containers |
| **Hardware simulation** | No UEFI, BIOS, firmware in containers |

**For dotfiles, stick with containers** — you only need the user environment, not the full OS.

---

## 10. Comparison of Alternatives (Detailed)

| Tool | Isolation | Speed | macOS Config Testing | Docker Coexistence | Best For |
|------|-----------|-------|---------------------|-------------------|----------|
| **Docker** | Namespace-based | ~100ms startup | Via Docker Desktop VM | Native | Standard container testing, multi-OS |
| **Podman** | Namespace-based, rootless default | ~150ms startup | Via Podman Machine | Drop-in Docker replacement | Security-focused, rootless preferred |
| **Tart** | Full VM, Apple Hypervisor | ~5-10s startup | Native macOS VMs | Separate virtualization | Testing macOS-specific configs |
| **OrbStack** | VM with native integration | ~1-2s startup | Seamless integration | Docker API compatible | Fast Docker experience on macOS |
| **Lima** | Lightweight VM | ~2-3s startup | Via QEMU | Compatible | Resource-constrained macOS setups |
| **Distrobox** | Container wrapping distro | ~50ms | Via host container | Container-native | Use Linux distro as dev environment |
| **Nix** | Declarative, namespace isolation | Instant via flakes | Full language support | Can run in containers | Reproducible builds, hermetic envs |
| **Vagrant** | Multiple backends (Docker, VirtualBox) | Slow (depends on backend) | VirtualBox backing | Via Docker provider | Multi-machine testing, IaC workflows |

**For dotfiles config testing:** Docker with multi-stage builds is the sweet spot — fastest iteration, easy cross-OS testing, minimal resource overhead.

---

## 11. Related Tutorials

For related learning and complementary workflows, see:

- [[docker-test-container-beginner-guide|Docker Test Container Beginner Guide]] — Start here for basics
- [[dotfiles-beginner-guide|Dotfiles Beginner Guide]] — Introduction to dotfiles management
- [[dotfiles-deep-dive|Dotfiles Deep Dive]] — Advanced dotfiles techniques
- [[chezmoi-beginner-guide|Chezmoi Beginner Guide]] — Getting started with chezmoi
- [[chezmoi-deep-dive|Chezmoi Deep Dive]] — Advanced chezmoi workflows
- [[kubernetes-beginner-guide|Kubernetes Beginner Guide]] — Container orchestration basics
- [[kubernetes-deep-dive|Kubernetes Deep Dive]] — Production Kubernetes patterns
- [[isaaclab-metagrasp-apptainer-hpc-beginner-guide|IsaacLab Apptainer Guide]] — Container tech on HPC systems
- [[linux-permissions-beginner-guide|Linux Permissions Beginner Guide]] — UID/GID fundamentals
- [[linux-permissions-deep-dive|Linux Permissions Deep Dive]] — Advanced Linux permissions
- [[just-beginner-guide|Just Beginner Guide]] — Task runner basics
- [[just-deep-dive|Just Deep Dive]] — Advanced Just workflows
- [[openmux-deep-dive|OpenMux Deep Dive]] — Terminal multiplexing
- [[sesh-deep-dive|Sesh Deep Dive]] — Session management
- [[mosh-deep-dive|Mosh Deep Dive]] — Mobile shell
- [[git-worktrees-worktrunk-deep-dive|Git Worktrees Deep Dive]] — Advanced git workflows

---

## 12. Summary

This deep-dive reference covered advanced Docker container patterns for testing configuration changes:

### Key Takeaways

1. **Multi-stage builds** reduce image size and enable efficient caching of dependencies
2. **Layer caching strategy** is critical — order instructions to maximize cache reuse (dependencies first, changing files last)
3. **BuildKit** provides advanced features (secrets, SSH forwarding, parallel builds) for professional workflows
4. **Volume types** (named, bind, tmpfs) have distinct trade-offs — choose based on persistence and performance needs
5. **Docker Compose** orchestrates multi-container testing, essential for testing across OS versions
6. **Justfiles** automate complex build/test workflows into simple, reproducible recipes
7. **Container internals** (namespaces, overlay FS) explain why containers are safer and faster than VMs for config testing
8. **SELinux, UID/GID, TERM variables** are common gotchas — understand them to avoid troubleshooting pain
9. **macOS performance** is a real constraint — use VirtioFS, named volumes, or alternative tools (Lima, OrbStack)
10. **Git integration** (branch testing, SSH forwarding) enables realistic dotfile testing workflows

### Next Steps

- Start with [[docker-test-container-beginner-guide|the beginner guide]] if you're new to containers
- Implement the `justfile` workflow (Exercise 5) for immediate productivity gains
- Set up Docker Compose for multi-OS testing (Exercise 2) to catch OS-specific config bugs
- Explore BuildKit secrets (Example 4) if testing with private repositories
- Profile your specific workflow to identify performance bottlenecks (benchmarking exercises)

**Remember:** Containers are tools for safe, fast iteration. Invest in automation early — a 5-second feedback loop changes everything.
