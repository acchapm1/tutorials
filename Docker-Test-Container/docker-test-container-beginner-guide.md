---
title: "Docker Test Container — Beginner Guide"
date: 2026-04-28
difficulty: beginner
tags: [docker, containers, dotfiles, testing, configuration, rocky-linux, nvim, tmux]
---

# Docker Test Container — Beginner Guide

## Overview

This guide teaches you how to use Docker containers as disposable sandboxes to safely test configuration changes without modifying your local machine.

**What's the problem?** When you're experimenting with dotfiles (shell configs, nvim settings, tmux configs), you risk breaking your local setup if something goes wrong. You have to manually undo changes, debug conflicts, or worse—reinstall your entire environment.

**What's the solution?** Docker containers are lightweight, isolated environments where you can:
- Test new configurations in complete safety
- Quickly spin up fresh Linux environments
- Throw away the container if something breaks (no harm done)
- Keep your local machine pristine while experimenting

Think of a Docker container like a disposable virtual machine that boots in seconds. You can test your new tmux config, realize it's broken, exit the container, and your local machine is untouched.

**Why this matters:** This approach saves time, reduces risk, and lets you experiment confidently. Instead of wondering "will this break my setup?", you just test it in a container and find out.

---

## Prerequisites

Before you start, make sure you have:

- **Docker installed** — Docker Desktop (on macOS/Windows) or Docker Engine (on Linux)
  - Download from https://www.docker.com/products/docker-desktop
  - Verify installation: run `docker --version` in your terminal
- **Basic terminal familiarity** — comfortable with `cd`, `ls`, text editors
- **The configs you want to test** — whether that's `~/.config/nvim`, `~/.tmux.conf`, `~/.bashrc`, etc.
- **Optional but helpful:** A text editor to write Dockerfiles (VS Code, vim, etc.)

---

## Key Concepts

Let's define some Docker terms before diving in:

### Docker Images vs. Containers

A **Docker image** is like a blueprint or recipe. It's a file that describes everything needed to run your application: the operating system, installed packages, environment setup, etc. Images are immutable (read-only).

A **Docker container** is an instance created from an image. It's like running that blueprint—a live, running environment where things can change. When you exit a container, it can be discarded or saved.

**Analogy:** An image is like a cookie recipe; a container is like the actual cookie you baked from that recipe.

### Volumes and Bind Mounts

When you run a Docker container, its filesystem is isolated from your local machine. But you can "mount" directories from your local machine *into* the container using the `-v` flag.

```bash
docker run -v /path/on/local:/path/in/container
```

This lets you:
- Inject your dotfiles into the container
- Test them without copying them
- See changes reflected immediately if you edit files locally

### Dockerfiles

A **Dockerfile** is a plain-text file containing instructions to build a Docker image. Each line is a command that builds on the previous one.

Example:
```dockerfile
FROM rockylinux:8          # Start with Rocky Linux 8
RUN yum install -y nvim    # Install neovim
RUN yum install -y tmux    # Install tmux
```

This is your recipe for what goes into the container.

### Ephemeral vs. Persistent Containers

**Ephemeral containers** are temporary. You run them, test something, exit, and they're gone. Good for quick testing.

**Persistent containers** stick around. You can `docker exec` back into them later. Good if you're iterating on configs.

### `docker run` vs. `docker exec`

- **`docker run`** creates a new container and runs a command in it. Use this for fresh, isolated tests.
- **`docker exec`** runs a command inside an existing, running container. Use this to re-enter a container or run commands in it later.

---

## Step-by-Step Instructions

### Step 1: Create a Dockerfile

Create a file called `Dockerfile` (no extension) in a new directory. Let's use Rocky Linux 8 as our base:

```dockerfile
FROM rockylinux:8

# Update package manager
RUN yum update -y

# Install essential tools
RUN yum install -y \
    nvim \
    tmux \
    git \
    curl \
    wget \
    zsh \
    bash \
    gcc \
    make

# Create the root user's config directories
RUN mkdir -p /root/.config/nvim

# Set the working directory
WORKDIR /root

# Start an interactive shell by default
CMD ["/bin/bash"]
```

**Why each line:**
- `FROM rockylinux:8` — Starts with a Rocky Linux 8 base image (minimal, lightweight)
- `RUN yum update -y` — Updates all packages to latest versions
- `RUN yum install -y ...` — Installs tools we want to test (nvim, tmux, git, etc.)
- `MKDIR ...` — Pre-creates config directories so mounting works smoothly
- `WORKDIR /root` — Sets the default directory when you enter the container
- `CMD ["/bin/bash"]` — Opens a bash shell by default

### Step 2: Build the Docker Image

In the directory containing your `Dockerfile`, run:

```bash
docker build -t rocky-test:latest .
```

**What this does:**
- `docker build` — Reads the Dockerfile and creates an image
- `-t rocky-test:latest` — Tags (names) the image `rocky-test` with version `latest`
- `.` — Tells Docker to look for the Dockerfile in the current directory

**Expected output:**
```
Sending build context to Docker daemon  2.048kB
Step 1/8 : FROM rockylinux:8
...
Successfully built abc123def456
Successfully tagged rocky-test:latest
```

### Step 3: Run the Container with Bind Mounts

Now run the container, injecting your local dotfiles:

```bash
docker run -it --rm \
  -v ~/.config/nvim:/root/.config/nvim \
  -v ~/.tmux.conf:/root/.tmux.conf \
  rocky-test:latest
```

**What this does:**
- `docker run` — Creates and starts a new container
- `-it` — Interactive terminal (lets you type commands)
- `--rm` — Removes the container when you exit (ephemeral)
- `-v local:container` — Bind mounts (injects your configs into the container)
  - `-v ~/.config/nvim:/root/.config/nvim` — Mounts your local nvim config into the container
  - `-v ~/.tmux.conf:/root/.tmux.conf` — Mounts your tmux config
- `rocky-test:latest` — Runs the image we built

**You should see:**
```bash
[root@abc123def456 /root]#
```

You're now inside the container! Your local configs are available at `/root/.config/nvim` and `/root/.tmux.conf`.

### Step 4: Test Your Configs

Inside the container, test your configurations:

```bash
# Test nvim
nvim ~/.config/nvim/init.vim

# Test tmux
tmux new-session -s test
tmux list-sessions

# Test shell configs
source ~/.bashrc
```

If something breaks, no problem—just exit the container.

### Step 5: Exit and Discard (or Commit)

**To exit and discard changes:**
```bash
exit
```

The container is deleted (because we used `--rm`). Your local machine is untouched.

**To save changes to the image** (more advanced):
```bash
docker commit container-id rocky-test:updated
```

Most of the time, you'll just exit and discard.

### Step 6: Testing Multiple OS Versions

For macOS testing, Docker can't run macOS natively. Instead, use **[Tart](https://github.com/cirruslabs/tart)**, a lightweight macOS virtualization tool that works similarly to Docker.

For Linux, you can test multiple distributions side by side using different base images in separate Dockerfiles:

```dockerfile
# Dockerfile.rocky9
FROM rockylinux:9
# ... same as above

# Dockerfile.ubuntu
FROM ubuntu:22.04
# ... adapt for apt instead of yum
```

Build and run each separately to compare behavior across OS versions.

---

## Practical Examples

### Example 1: Testing a New tmux.conf

You've written a new tmux config and want to make sure it works before deploying it.

**Create `Dockerfile`:**
```dockerfile
FROM rockylinux:8
RUN yum install -y tmux
CMD ["/bin/bash"]
```

**Build and run:**
```bash
docker build -t tmux-test .
docker run -it --rm -v ~/.tmux.conf:/root/.tmux.conf tmux-test
```

**Inside the container:**
```bash
tmux new-session -s test
# Test your key bindings, panes, windows, etc.
# If something's broken, exit and edit ~/.tmux.conf locally
# Re-run the docker command to test again
```

### Example 2: Testing Nvim Plugin Changes

You're updating your neovim plugins and want to test in a clean environment.

**Create `Dockerfile`:**
```dockerfile
FROM rockylinux:8
RUN yum install -y nvim git
CMD ["/bin/bash"]
```

**Build and run:**
```bash
docker build -t nvim-test .
docker run -it --rm \
  -v ~/.config/nvim:/root/.config/nvim \
  -v ~/.local/share/nvim:/root/.local/share/nvim \
  nvim-test
```

**Inside the container:**
```bash
# Start nvim and check if plugins load
nvim
# Type :PlugStatus or equivalent for your plugin manager
# Test the new functionality
```

The container has a clean environment (no conflicting plugins from other systems), so you can isolate whether the issue is your setup or the new plugin.

### Example 3: Testing Shell Dotfiles

You've rewritten your `.bashrc` and `.zshrc` and want to test them.

**Create `Dockerfile`:**
```dockerfile
FROM rockylinux:8
RUN yum install -y bash zsh curl git
CMD ["/bin/bash"]
```

**Build and run:**
```bash
docker build -t shell-test .
docker run -it --rm \
  -v ~/.bashrc:/root/.bashrc \
  -v ~/.zshrc:/root/.zshrc \
  -v ~/.bash_profile:/root/.bash_profile \
  shell-test
```

**Inside the container:**
```bash
# Test bash
bash
source ~/.bashrc
echo $PATH  # Verify custom settings

# Test zsh
zsh
source ~/.zshrc

# Exit and verify locally
exit
```

### Example 4: Docker Compose for Multiple OS Versions

Want to test configs across multiple Rocky Linux versions simultaneously? Use `docker-compose.yml`:

```yaml
version: '3.8'

services:
  rocky8:
    build:
      context: .
      dockerfile: Dockerfile.rocky8
    image: rocky8-test
    container_name: rocky8-test
    volumes:
      - ~/.config/nvim:/root/.config/nvim
      - ~/.tmux.conf:/root/.tmux.conf
    stdin_open: true
    tty: true
    command: /bin/bash

  rocky9:
    build:
      context: .
      dockerfile: Dockerfile.rocky9
    image: rocky9-test
    container_name: rocky9-test
    volumes:
      - ~/.config/nvim:/root/.config/nvim
      - ~/.tmux.conf:/root/.tmux.conf
    stdin_open: true
    tty: true
    command: /bin/bash
```

**Run both:**
```bash
docker-compose up -d
docker exec -it rocky8-test bash
# Test in Rocky 8

# In another terminal:
docker exec -it rocky9-test bash
# Test in Rocky 9
```

This lets you compare behavior across OS versions without rebuilding.

---

## Hands-On Exercises

### Exercise 1: Create and Run Your First Test Container

1. Create a `Dockerfile` based on `rockylinux:8`
2. Install `vim`, `git`, and `curl`
3. Build the image with tag `my-first-test`
4. Run the container interactively
5. Inside the container, run `vim --version` to verify nvim is installed
6. Exit the container

**Goal:** Understand the build → run → test cycle.

### Exercise 2: Bind Mount Your Dotfiles

1. Create a `Dockerfile` with nvim installed
2. Run the container with `-v ~/.config/nvim:/root/.config/nvim`
3. Inside the container, list your nvim config: `ls -la /root/.config/nvim`
4. Edit a file locally (e.g., `~/.config/nvim/init.vim`)
5. In the container, verify the change is visible: `cat /root/.config/nvim/init.vim`

**Goal:** Understand how bind mounts work and that changes are shared.

### Exercise 3: Test a Configuration Change

1. Make a deliberate change to your `.tmux.conf` (e.g., add a new keybinding)
2. Create a Dockerfile with tmux installed
3. Run the container with your `.tmux.conf` mounted
4. Inside the container, start tmux: `tmux new-session -s test`
5. Test your new keybinding—does it work?
6. If not, exit the container, fix `.tmux.conf` locally, and re-run

**Goal:** Practice the real-world workflow of testing and iterating.

### Exercise 4: Compare Across OS Versions

1. Create `Dockerfile.rocky8` and `Dockerfile.rocky9`
2. Create a `docker-compose.yml` with both services
3. Run `docker-compose up -d` to start both
4. Log into the Rocky 8 container: `docker exec -it rocky8-test bash`
5. Check the OS version: `cat /etc/os-release`
6. Repeat for Rocky 9
7. Compare behavior of a tool you've installed

**Goal:** Understand how to test across multiple environments.

---

## Troubleshooting

### Permission Issues with Bind Mounts

**Problem:** You see `Permission denied` when trying to access mounted files.

**Cause:** Your local files might have restrictive permissions, or the container is running as a different user.

**Solution:**
```bash
# Check local file permissions
ls -la ~/.config/nvim

# Inside the container, try:
chmod -R 755 /root/.config/nvim
```

Alternatively, ensure your local files are readable by all users:
```bash
chmod -R 644 ~/.config/nvim
```

For more on file permissions, see [[linux-permissions-beginner-guide]].

### Missing Dependencies

**Problem:** A tool you mounted depends on another library that isn't installed.

**Cause:** You're injecting only the config file, not the tool itself.

**Solution:** Add the dependency to your Dockerfile:

```dockerfile
FROM rockylinux:8
RUN yum install -y nvim python3-neovim   # Added python3-neovim
```

### Clipboard Not Working in Containers

**Problem:** You can't copy/paste between the container and your local machine.

**Cause:** Containers are isolated; clipboard integration requires special setup.

**Solution:** Use `docker cp` to copy files in and out:
```bash
docker cp my-container:/root/.config/nvim ~/nvim-from-container
docker cp ~/nvim-new my-container:/root/.config/nvim
```

Or use volume mounts (which we're already doing) and edit files locally.

### Locale Issues

**Problem:** You see errors like `locale: Cannot set LC_CTYPE` inside the container.

**Cause:** Rocky Linux doesn't have all locale data installed by default.

**Solution:** Add to your Dockerfile:
```dockerfile
FROM rockylinux:8
RUN yum install -y glibc-langpack-en
ENV LC_ALL=en_US.UTF-8
```

---

## Alternatives to Docker

You might be wondering: "Are there other ways to do this?" Yes! Here's how they compare:

### Tart — macOS VMs
[Tart](https://github.com/cirruslabs/tart) is a lightweight macOS virtualization tool. Use this if you're testing macOS-specific configs (like iTerm2 settings).
- **Pros:** Runs actual macOS, native behavior
- **Cons:** Slower than Docker, heavier resource usage
- **When to use:** You need to test on real macOS

### OrbStack — Docker/VM Alternative
OrbStack is a Docker replacement that's lighter-weight. However, it wants to *replace* Docker, which you don't want. Skip this unless you're rethinking your entire containerization strategy.

### Lima — Linux VMs on macOS
Lima runs lightweight Linux VMs on macOS using QEMU. It's more minimal than Docker but similar concept.
- **Pros:** Lightweight, can run multiple VMs
- **Cons:** Not as mature as Docker, less community support
- **When to use:** You're already familiar with VMs and want Linux isolation

### Distrobox — Container Integration
Distrobox runs containers that integrate more seamlessly with your host system (shared home directory, clipboard, etc.). It's a wrapper around Docker/Podman.
- **Pros:** Better integration with host, cleaner UX
- **Cons:** More complex setup, still requires Docker or Podman
- **When to use:** You want container benefits with less isolation

### Nix — Declarative Config Management
Nix is a package manager and language for reproducible builds. You can declare your entire environment and test it in isolation using `nix flake`.
- **Pros:** Very powerful, reproducible, no container overhead
- **Cons:** Steep learning curve, different paradigm
- **When to use:** You're comfortable with functional package management

### Recommendation
**Stick with Docker** for this use case. It's simple, fast, widely supported, and exactly what you need. The alternatives are either overkill or solve different problems. Docker containers are disposable enough for safe testing, yet persistent enough to iterate on configs.

---

## Related Tutorials

- [[dotfiles-beginner-guide|Dotfiles Beginner Guide]] — Learn how to organize your configurations
- [[dotfiles-deep-dive|Dotfiles Deep Dive]] — Advanced dotfiles patterns
- [[chezmoi-beginner-guide|Chezmoi Beginner Guide]] — Manage dotfiles across machines
- [[chezmoi-deep-dive|Chezmoi Deep Dive]] — Advanced Chezmoi workflows
- [[kubernetes-beginner-guide|Kubernetes Beginner Guide]] — Containers at scale (containers and Docker overlap)
- [[linux-permissions-beginner-guide|Linux Permissions Beginner Guide]] — Relevant to permission issues in containers
- [[just-beginner-guide|Just Beginner Guide]] — Automate Docker commands with justfiles
- [[openmux-beginner-guide|OpenMux Beginner Guide]] — Testing terminal multiplexer configs
- [[sesh-beginner-guide|Sesh Beginner Guide]] — Session management in containers
- [[mosh-beginner-guide|Mosh Beginner Guide]] — Remote connections to containers
- [[docker-test-container-deep-dive|Docker Test Container Deep Dive]] — Advanced techniques and workflows

---

## Summary

**Key takeaways:**

1. **Docker containers are disposable sandboxes.** Spin them up, test configs, throw them away—zero risk to your local machine.

2. **Bind mounts let you inject configs.** Use `-v` to mount your dotfiles into the container and test without copying.

3. **Dockerfiles are recipes.** Write once, build, run many times with consistency.

4. **The workflow is simple:** Dockerfile → build → run with mounts → test → exit → iterate.

5. **You can test across OS versions.** Use different base images or Docker Compose to compare behavior.

6. **Alternatives exist** (Tart, Nix, Distrobox), but Docker is the best fit for this use case.

**Next steps:**

- Create your first Dockerfile with the tools you use most
- Practice the bind mount workflow with one of your config files
- Try docker-compose if you want to test multiple OS versions
- Explore the [[docker-test-container-deep-dive|Docker Test Container Deep Dive]] for advanced patterns like caching, multi-stage builds, and automation

**Happy testing!**
