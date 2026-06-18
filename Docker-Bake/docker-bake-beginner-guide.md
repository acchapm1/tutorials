---
title: "Docker Bake — Beginner's Guide"
date: 2026-06-18
difficulty: beginner
tags: [docker, buildx, bake, multi-platform, cross-platform, HPC, amd64, arm64, rocky-linux]
---

# Docker Bake — Beginner's Guide

## Overview

If you work on an Apple Silicon Mac but deploy to a Linux HPC cluster running Rocky Linux 8.10 on `x86_64/amd64`, you have a classic cross-platform problem: your laptop builds `arm64` images by default, but your cluster needs `amd64`. Running those images under QEMU emulation is painfully slow, and forgetting to add `--platform` flags to `docker buildx build` is easy.

**Docker Bake** solves this. It is a higher-level build orchestration tool built on top of `docker buildx`. Instead of typing long `docker buildx build` commands with many flags every time, you write a `docker-bake.hcl` file once that captures your build configuration — platforms, tags, cache settings, build arguments — and then simply run `docker bake` to reproduce the exact same build every time.

**What you will learn in this guide:**
- What Docker Bake is and how it relates to `docker buildx`
- How to write your first `docker-bake.hcl` file
- How to build a `linux/amd64` image from an Apple Silicon Mac that will run correctly on a Rocky Linux 8.10 HPC node
- How to verify the image before pushing to a registry

**Prerequisite knowledge:** This guide assumes you are comfortable with basic Docker concepts (images, containers, Dockerfiles) and have done at least one `docker buildx build --platform` command before. If Docker is brand new to you, start with [[docker-test-container-beginner-guide|Docker Test Container Beginner Guide]] first.

---

## Prerequisites

Before you start, make sure you have:

| Requirement | How to verify |
|---|---|
| Docker Desktop ≥ 4.20 (macOS) | `docker --version` — should be 24+ |
| `docker buildx` available | `docker buildx version` |
| A container registry account | Docker Hub, GHCR, or a private registry |
| A text editor | VS Code, vim, etc. |
| Basic familiarity with `docker buildx build --platform` | See [[docker-test-container-beginner-guide]] |

Docker Desktop on Apple Silicon ships with QEMU and BuildKit built in — no manual QEMU setup is required.

---

## Key Concepts

### What is Docker Bake?

`docker bake` (full name: `docker buildx bake`) is a sub-command that reads a **bake file** — a configuration document in HCL, JSON, or Docker Compose format — and uses it to drive one or more `docker buildx build` operations. You can think of it as a Makefile for your Docker builds.

Without Bake, a cross-platform build command looks like this:

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag myregistry/myapp:1.2.3 \
  --tag myregistry/myapp:latest \
  --build-arg APP_VERSION=1.2.3 \
  --cache-from type=registry,ref=myregistry/myapp:cache \
  --cache-to type=registry,ref=myregistry/myapp:cache,mode=max \
  --push \
  .
```

That is hard to remember, hard to share with teammates, and easy to get wrong. With Bake, you write that configuration once in `docker-bake.hcl`:

```hcl
target "myapp" {
  platforms = ["linux/amd64", "linux/arm64"]
  tags      = ["myregistry/myapp:1.2.3", "myregistry/myapp:latest"]
  args      = { APP_VERSION = "1.2.3" }
  cache-from = ["type=registry,ref=myregistry/myapp:cache"]
  cache-to   = ["type=registry,ref=myregistry/myapp:cache,mode=max"]
}
```

And then every build is just:

```bash
docker bake --push
```

### Bake File Formats

Docker Bake supports three formats. HCL is recommended:

- **HCL** (`docker-bake.hcl`) — most expressive; supports variables, functions, conditionals
- **JSON** (`docker-bake.json`) — good for programmatic generation
- **Docker Compose** (`docker-compose.yml`) — if you already use Compose and want multi-platform builds

This guide uses HCL throughout.

### Targets and Groups

A **target** is a single build configuration: one Dockerfile, one set of platforms, one set of tags. A **group** is a named collection of targets you can build together.

When you run `docker bake` with no arguments, it builds the `default` group (or target). You can also name a specific target:

```bash
docker bake myapp         # builds just the myapp target
docker bake production    # builds the production group
```

### How This Relates to `docker buildx`

Bake *is* buildx under the hood. Every `docker bake` invocation results in one or more `docker buildx build` calls. Bake adds:
- A declarative config file instead of command-line flags
- Parallel builds across multiple targets
- Variable interpolation and reuse across targets

You still need a BuildKit-enabled builder (the `docker-container` driver) for multi-platform builds, just as you would with plain buildx. See [[docker-multiplatform-apple-silicon|Building Multi-Platform Docker Images on Apple Silicon]] for details on setting up the builder.

---

## Step-by-Step Instructions

### Step 1 — Set Up a Multi-Platform Builder

If you have not already created a `docker-container` builder, do it now. This is a one-time operation.

```bash
docker buildx create \
  --name multiplatform \
  --driver docker-container \
  --bootstrap \
  --use
```

Verify it is active and supports both platforms:

```bash
docker buildx ls
```

Expected output (relevant lines):

```
NAME/NODE         DRIVER/ENDPOINT   STATUS    BUILDKIT   PLATFORMS
multiplatform *   docker-container  running   v0.12.x    linux/arm64, linux/amd64, ...
```

The `*` means it is the active builder. You only need to create this once; in future sessions, reactivate it with `docker buildx use multiplatform`.

### Step 2 — Write a Dockerfile Targeting Rocky Linux 8.10

Create a project directory:

```bash
mkdir ~/my-hpc-app && cd ~/my-hpc-app
```

Write a simple Dockerfile that uses Rocky Linux 8.10 as its runtime base. Using the same OS as your HPC cluster avoids glibc version mismatches and missing shared libraries.

```dockerfile
# syntax=docker/dockerfile:1

# Build stage — runs natively on your Mac (arm64) for speed
FROM --platform=$BUILDPLATFORM python:3.11-slim AS builder

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Runtime stage — Rocky Linux 8.10, matches the HPC cluster
FROM rockylinux:8.10

# Install Python 3.11 from AppStream (Rocky 8 ships Python 3.6 by default)
RUN dnf module enable -y python39 && \
    dnf install -y python39 python39-pip && \
    ln -sf /usr/bin/python3.9 /usr/bin/python3 && \
    dnf clean all

# Copy installed Python packages from the build stage
COPY --from=builder /install /usr/local

WORKDIR /app
COPY . .

ENTRYPOINT ["python3", "main.py"]
```

> **Why `FROM --platform=$BUILDPLATFORM` on the builder stage?**
> This tells Docker to run the builder stage natively on your Mac's arm64 CPU. Heavy dependency installations run fast natively and only emit the final artifacts. Only the runtime stage uses the `linux/amd64` target platform, keeping QEMU emulation to a minimum.

Create a placeholder `main.py` and `requirements.txt` so the build succeeds:

```bash
echo 'print("Hello from Rocky Linux!")' > main.py
echo '# no dependencies yet' > requirements.txt
```

### Step 3 — Write Your First `docker-bake.hcl`

Create `docker-bake.hcl` in the same directory:

```hcl
# docker-bake.hcl

variable "REGISTRY" {
  default = "docker.io/yourusername"
}

variable "IMAGE_NAME" {
  default = "my-hpc-app"
}

variable "TAG" {
  default = "latest"
}

# Default group — what `docker bake` builds with no arguments
group "default" {
  targets = ["app"]
}

target "app" {
  context    = "."
  dockerfile = "Dockerfile"

  # Build for the HPC cluster target only.
  # Change to ["linux/amd64", "linux/arm64"] to publish a multi-arch manifest.
  platforms = ["linux/amd64"]

  tags = [
    "${REGISTRY}/${IMAGE_NAME}:${TAG}",
  ]
}
```

> **Single platform vs. multi-arch manifest:** For deploying *only* to an amd64 HPC cluster, `platforms = ["linux/amd64"]` is simpler and builds faster. A multi-arch manifest (listing both `linux/amd64` and `linux/arm64`) lets the same tag run on both platforms automatically — useful if you also run the image on your Mac for local testing.

### Step 4 — Do a Local Test Build

Before pushing, do a local single-platform build to catch errors quickly:

```bash
docker bake --load app
```

The `--load` flag loads the image into your local Docker daemon instead of pushing. You can only load a single platform at a time (limitation of the local daemon).

Expected output:

```
[+] Building 45.2s (12/12) FINISHED
 => [internal] load build definition from Dockerfile
 => [internal] load .dockerignore
 => [builder 1/4] FROM docker.io/library/python:3.11-slim@sha256:...
 => [builder 2/4] WORKDIR /app
 => [builder 3/4] COPY requirements.txt .
 => [builder 4/4] RUN pip install ...
 => [stage-1 1/4] FROM rockylinux:8.10
 ...
 => => writing image sha256:...
 => => naming to docker.io/yourusername/my-hpc-app:latest
```

Test it locally:

```bash
docker run --rm --platform linux/amd64 yourusername/my-hpc-app:latest
```

Expected output:

```
Hello from Rocky Linux!
```

### Step 5 — Push to a Registry

Once you are satisfied with the local build, push the image to a registry so your HPC cluster can pull it.

First, log in to your registry:

```bash
docker login
# or for GitHub Container Registry:
echo $GITHUB_TOKEN | docker login ghcr.io -u YOUR_USERNAME --password-stdin
```

Then push:

```bash
docker bake --push app
```

Or override the tag from the command line using an environment variable:

```bash
TAG=1.0.0 docker bake --push app
```

Bake reads the `TAG` variable from the environment and uses it in the tag string.

### Step 6 — Verify the Pushed Image

Check that the image exists in the registry and is the right architecture:

```bash
docker buildx imagetools inspect docker.io/yourusername/my-hpc-app:latest
```

For a single-platform `linux/amd64` image, you will see:

```
Name:      docker.io/yourusername/my-hpc-app:latest
MediaType: application/vnd.oci.image.manifest.v1+json
Digest:    sha256:...

Manifest:
Name:      docker.io/yourusername/my-hpc-app:latest
MediaType: application/vnd.oci.image.manifest.v1+json
Digest:    sha256:...
Platform:  linux/amd64
```

On the HPC cluster, pull and run:

```bash
# On the Rocky Linux 8.10 HPC node
singularity pull docker://yourusername/my-hpc-app:latest
# or with Docker if available:
docker run --rm yourusername/my-hpc-app:latest
```

---

## Practical Examples

### Example 1 — Override Variables at Build Time

The `variable` blocks in your bake file set defaults, but you can override any of them from the environment:

```bash
REGISTRY=ghcr.io/myorg TAG=v2.1.0 docker bake --push
```

This is useful in CI/CD pipelines where the tag comes from a Git commit SHA or release tag.

### Example 2 — Building a Multi-Arch Manifest

To publish an image that runs on both your Mac (arm64) and the HPC cluster (amd64), change the `platforms` list:

```hcl
target "app" {
  platforms = ["linux/amd64", "linux/arm64"]
  tags      = ["${REGISTRY}/${IMAGE_NAME}:${TAG}"]
}
```

Then push (multi-arch manifests require pushing — you cannot `--load` a multi-platform build):

```bash
docker bake --push
```

The registry will store both architectures under the same tag. The HPC cluster pulls `linux/amd64`; your Mac pulls `linux/arm64` — each gets the right version automatically.

### Example 3 — A Project With Multiple Images

Many real projects have multiple services. Bake handles them naturally:

```hcl
variable "REGISTRY" { default = "myregistry.io/myproject" }
variable "TAG"      { default = "latest" }

group "default" {
  targets = ["api", "worker"]
}

target "api" {
  context    = "./services/api"
  dockerfile = "Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = ["${REGISTRY}/api:${TAG}"]
}

target "worker" {
  context    = "./services/worker"
  dockerfile = "Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = ["${REGISTRY}/worker:${TAG}"]
}
```

```bash
docker bake --push          # builds api and worker in parallel
docker bake --push worker   # builds only the worker
```

---

## Hands-On Exercises

**Exercise 1 — Your First Bake File**

1. Create a new directory with a simple Python or bash script `main.py` / `main.sh`
2. Write a `Dockerfile` that packages it using `rockylinux:8.10` as the runtime base
3. Write a `docker-bake.hcl` with a single `app` target targeting `linux/amd64`
4. Run `docker bake --load app` and verify it works with `docker run`

**Exercise 2 — Variable Override**

1. Add a `VERSION` variable to your bake file with a default of `"dev"`
2. Tag your image as `myapp:${VERSION}`
3. Build with `VERSION=1.0.0 docker bake --load app`
4. Confirm the image is tagged `myapp:1.0.0` with `docker images`

**Exercise 3 — Two Targets**

1. Add a second target `test` that builds the same context but runs your test suite (use a `CMD` or `ENTRYPOINT` that runs tests)
2. Build just the test target: `docker bake --load test`
3. Create a `ci` group that contains both `app` and `test`

---

## Troubleshooting

### `docker bake` says "no such file or directory"

Bake looks for `docker-bake.hcl`, `docker-bake.json`, or `docker-compose.yml` in the current directory. Make sure you are in the right directory.

You can also specify the file explicitly:

```bash
docker bake -f path/to/my-bake.hcl --push
```

### `--load` fails for multi-platform builds

The local Docker daemon only supports one architecture at a time. Use `--load` with a single platform for local testing, then `--push` for the multi-arch version:

```bash
# Local test (single platform)
docker bake --set "app.platforms=linux/amd64" --load app

# Push multi-arch
docker bake --push app
```

### The amd64 build is very slow on Apple Silicon

QEMU emulates an x86_64 CPU in software — CPU-intensive operations take 5–10x longer. The main optimization is to run as much of your build as possible *natively* on arm64 using `FROM --platform=$BUILDPLATFORM` in multi-stage builds. See [[docker-bake-deep-dive|Docker Bake Deep Dive]] for advanced strategies including remote native builders.

### `exec format error` when running the image on the HPC cluster

This means the image was built for the wrong architecture. Check which platform is in the manifest:

```bash
docker buildx imagetools inspect yourregistry/yourimage:tag
```

If it shows `linux/arm64` instead of `linux/amd64`, your bake file has `platforms = ["linux/arm64"]` or you loaded the image locally without specifying a platform override.

### Variable value is not being picked up

Environment variable names must match exactly. If your bake file declares `variable "TAG"`, the environment variable must also be `TAG` (case-sensitive):

```bash
TAG=1.0.0 docker bake --push    # correct
tag=1.0.0 docker bake --push    # won't work
```

---

## References

- [Docker Bake Introduction (official docs)](https://docs.docker.com/build/bake/introduction/)
- [Docker Bake Reference (HCL syntax)](https://docs.docker.com/build/bake/reference/)
- [BuildKit multi-platform builds](https://docs.docker.com/build/building/multi-platform/)
- [Rocky Linux container images on Docker Hub](https://hub.docker.com/_/rockylinux)
- [BuildKit automatic platform args](https://docs.docker.com/engine/reference/builder/#automatic-platform-args-in-the-global-scope)
- Related vault document: [[docker-multiplatform-apple-silicon|Building Multi-Platform Docker Images on Apple Silicon]]

---

## Related Tutorials

- [[docker-test-container-beginner-guide|Docker Test Container Beginner Guide]] — core Docker skills needed before using Bake
- [[docker-test-container-deep-dive|Docker Test Container Deep Dive]] — multi-stage builds and advanced Dockerfile patterns
- [[docker-bake-deep-dive|Docker Bake Deep Dive]] — advanced bake.hcl patterns, matrix builds, CI/CD integration
- [[docker-multiplatform-apple-silicon|Building Multi-Platform Docker Images on Apple Silicon]] — the buildx fundamentals that Bake builds on
- [[kubernetes-beginner-guide|Kubernetes Beginner Guide]] — deploying container images to a cluster after you build them
- [[isaaclab-metagrasp-apptainer-hpc-beginner-guide|IsaacLab + Apptainer HPC Guide]] — another approach to HPC containers using Apptainer/Singularity
- [[hyperqueue-basics|HyperQueue Basics]] — scheduling jobs on HPC clusters that run your Docker images via Singularity
- [[pixi-beginner-guide|Pixi Beginner Guide]] — fast environment management that pairs well with Docker for reproducible builds

---

## Summary

**Key takeaways:**

1. **Docker Bake is `docker buildx` with a config file.** Instead of memorizing long command strings, you declare your build configuration in `docker-bake.hcl` and run `docker bake`.

2. **`docker-bake.hcl` captures everything.** Platforms, tags, build args, cache settings — all in one place, checked into version control alongside your Dockerfile.

3. **For Apple Silicon → HPC amd64 builds:** Set `platforms = ["linux/amd64"]` in your target. Use `FROM --platform=$BUILDPLATFORM` in compile-heavy Dockerfile stages so they run natively on your Mac.

4. **Use `rockylinux:8.10` as your runtime base** to match your HPC cluster OS and avoid glibc compatibility issues.

5. **`--load` for local testing, `--push` for the registry.** You cannot `--load` a multi-platform build; use a single platform for local smoke tests.

6. **Variables let you override tags and settings from the environment**, making bake files reusable across dev, staging, and production.

**Next steps:**

- Explore [[docker-bake-deep-dive|Docker Bake Deep Dive]] for variables, matrix builds, inheritance, and advanced cache strategies
- Set up registry caching to speed up iterative builds
- Add Docker Bake to your CI/CD pipeline for automated multi-platform releases
