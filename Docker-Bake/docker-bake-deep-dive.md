---
title: "Docker Bake — Deep Dive"
date: 2026-06-18
difficulty: advanced
tags: [docker, buildx, bake, multi-platform, cross-platform, HPC, amd64, arm64, rocky-linux, CI, BuildKit, cache, matrix]
---

# Docker Bake — Deep Dive

## Overview

This reference covers Docker Bake from internals to production patterns. It assumes you have read [[docker-bake-beginner-guide|Docker Bake Beginner Guide]] and are comfortable with basic `docker-bake.hcl` syntax.

**What you will find here:**

- HCL language features: variables, locals, functions, conditionals
- Target inheritance and DRY patterns
- Matrix builds for publishing multiple versions in one pass
- Advanced cache strategies (registry, GitHub Actions, S3)
- Remote native builders — the key to fast amd64 builds without QEMU
- Rocky Linux 8.10 HPC deployment patterns
- Singularity/Apptainer integration for cluster environments
- CI/CD integration (GitHub Actions, GitLab CI)
- Debugging bake configurations

---

## Prerequisites

- Docker Desktop ≥ 4.20, or Docker Engine ≥ 24 with the Buildx plugin
- A working multi-platform builder — see [[docker-bake-beginner-guide|Beginner Guide Step 1]]
- Access to a container registry (Docker Hub, GHCR, or private)
- Familiarity with Docker multi-stage builds
- Optional: A Rocky Linux 8.10 HPC cluster or access to one via SSH

---

## Key Concepts

### How Bake Resolves Configuration

When you run `docker bake`, BuildKit searches for configuration in this order:

1. Files named explicitly with `-f`
2. `docker-bake.hcl` in the current directory
3. `docker-bake.json` in the current directory
4. `docker-bake.override.hcl` merged on top
5. `docker-compose.yml` as fallback

Multiple files can be merged with repeated `-f` flags:

```bash
docker bake -f base.hcl -f overrides.hcl --push
```

### HCL vs JSON vs Compose

| Format | Pros | Cons |
|---|---|---|
| HCL | Variables, functions, expressions | HCL-specific syntax to learn |
| JSON | Any language can generate it | No native variables or logic |
| Compose | Already in your project | Limited to Compose schema subset |

Prefer HCL for anything beyond a single static target.

### The Build Graph

When you have multiple targets in a group, Bake builds them in **parallel by default**. Targets that share a common base layer benefit from BuildKit's shared layer cache — the base is pulled once and reused across targets running concurrently.

---

## Step-by-Step Instructions

### Step 1 — HCL Language Features

#### Variables

Variables accept a `default` and are overridden by environment variables of the same name:

```hcl
variable "REGISTRY" {
  default = "ghcr.io/myorg"
}

variable "GIT_SHA" {
  default = ""   # empty means: must be supplied via env in production
}
```

```bash
REGISTRY=myregistry.io GIT_SHA=abc1234 docker bake --push
```

#### Locals

Use `locals` for computed values that you don't want to expose as overridable variables:

```hcl
variable "TAG"  { default = "latest" }
variable "PUSH" { default = false }

locals {
  is_release = TAG != "latest"
  cache_repo = "${REGISTRY}/cache"
}
```

#### Functions

HCL supports a subset of the HashiCorp functions:

```hcl
variable "VERSION" { default = "1.2.3" }

locals {
  # Split "1.2.3" into ["1", "2", "3"] and take the major component
  major = split(".", VERSION)[0]
  # Build a list of all version tags to push
  version_tags = [
    "${REGISTRY}/myapp:${VERSION}",
    "${REGISTRY}/myapp:${major}",
    "${REGISTRY}/myapp:latest",
  ]
}

target "app" {
  tags = local.version_tags
}
```

#### Conditionals

```hcl
variable "CI" { default = "" }

target "app" {
  # Only use registry cache in CI; avoid polluting cache from developer laptops
  cache-from = CI != "" ? ["type=registry,ref=${REGISTRY}/cache:app"] : []
  cache-to   = CI != "" ? ["type=registry,ref=${REGISTRY}/cache:app,mode=max"] : []
}
```

### Step 2 — Target Inheritance

Use `inherits` to share common configuration across targets. This keeps your bake file DRY:

```hcl
# Shared base configuration — not a real build target
target "_common" {
  dockerfile = "Dockerfile"
  platforms  = ["linux/amd64"]
  cache-from = ["type=registry,ref=${REGISTRY}/cache:common"]
  cache-to   = ["type=registry,ref=${REGISTRY}/cache:common,mode=max"]
}

target "api" {
  inherits = ["_common"]
  context  = "./services/api"
  tags     = ["${REGISTRY}/api:${TAG}"]
}

target "worker" {
  inherits = ["_common"]
  context  = "./services/worker"
  tags     = ["${REGISTRY}/worker:${TAG}"]
  # Override a field from _common
  platforms = ["linux/amd64", "linux/arm64"]
}
```

Inheritance is additive for lists (tags, platforms) and overriding for scalars (dockerfile, context). An inherited `platforms` list is completely replaced when the child specifies its own.

### Step 3 — Matrix Builds

Matrix builds let you produce multiple variants of a target from a single target definition. Docker Bake expands the matrix into N individual build jobs and runs them in parallel.

#### Versioned builds

```hcl
target "app" {
  name = "app-${version}"

  matrix = {
    version = ["3.9", "3.10", "3.11"]
  }

  args = {
    PYTHON_VERSION = version
  }

  tags = ["${REGISTRY}/myapp:py${version}-${TAG}"]
}
```

```bash
docker bake --push
# Builds: app-3.9, app-3.10, app-3.11 in parallel
```

#### Cross-product matrix

```hcl
target "app" {
  name = "app-${python_version}-${distro}"

  matrix = {
    python_version = ["3.10", "3.11"]
    distro         = ["rocky8", "ubuntu22"]
  }

  dockerfile = "Dockerfile.${distro}"

  args = {
    PYTHON_VERSION = python_version
  }

  tags = ["${REGISTRY}/myapp:${python_version}-${distro}-${TAG}"]
}
```

This generates four build jobs: `3.10-rocky8`, `3.10-ubuntu22`, `3.11-rocky8`, `3.11-ubuntu22`.

### Step 4 — Advanced Cache Strategies

Proper caching is the single biggest lever for build performance.

#### Registry cache (recommended)

Registry cache stores BuildKit cache metadata inline in your registry. It survives across machines and CI ephemeral environments:

```hcl
target "app" {
  cache-from = ["type=registry,ref=${REGISTRY}/cache:app-amd64"]
  cache-to   = ["type=registry,ref=${REGISTRY}/cache:app-amd64,mode=max"]
}
```

`mode=max` exports intermediate layer cache (not just the final image) — this is slower to write but dramatically accelerates subsequent builds when intermediate layers change.

#### GitHub Actions cache

If you run builds in GitHub Actions, use the `gha` cache backend to persist layer cache in Actions' cache storage:

```hcl
target "app" {
  cache-from = ["type=gha,scope=app-amd64"]
  cache-to   = ["type=gha,scope=app-amd64,mode=max"]
}
```

This requires no extra registry and uses GitHub's built-in cache quota.

#### S3 / Azure blob cache

For self-hosted CI with access to object storage:

```hcl
target "app" {
  cache-from = ["type=s3,bucket=my-build-cache,region=us-east-1,prefix=app/"]
  cache-to   = ["type=s3,bucket=my-build-cache,region=us-east-1,prefix=app/,mode=max"]
}
```

#### Inline cache (simpler, less powerful)

Inline cache embeds the cache manifest directly into the pushed image. It is easier to set up but only stores the final layer cache (equivalent to `mode=min`):

```hcl
target "app" {
  cache-from = ["type=registry,ref=${REGISTRY}/myapp:${TAG}"]
  args = {
    BUILDKIT_INLINE_CACHE = "1"
  }
}
```

### Step 5 — Remote Native Builders (Key for HPC Workflows)

QEMU emulation is the main bottleneck when building `linux/amd64` on Apple Silicon. The solution for large projects is to add a **native amd64 builder** — a remote machine running Rocky Linux or another `x86_64` host — to your BuildKit builder pool.

#### Adding a remote builder node

If you have SSH access to an amd64 Linux machine (or an EC2 instance):

```bash
# Create a multi-node builder: local arm64 + remote amd64
docker buildx create \
  --name hybrid \
  --driver docker-container \
  --bootstrap \
  --use

docker buildx create \
  --name hybrid \
  --append \
  ssh://user@amd64-host.example.com \
  --platform linux/amd64
```

With this hybrid builder, Bake dispatches `linux/amd64` layers to the remote native host and `linux/arm64` layers to your local machine — no QEMU involved for either architecture.

Verify both nodes appear:

```bash
docker buildx inspect hybrid
```

Expected output (abbreviated):

```
Name:          hybrid
Driver:        docker-container
Nodes:
  Name:    hybrid0
  Endpoint: unix:///var/run/docker.sock
  Platforms: linux/arm64, linux/arm/v7
  
  Name:    hybrid1
  Endpoint: ssh://user@amd64-host.example.com
  Platforms: linux/amd64, linux/386
```

Your `docker-bake.hcl` is unchanged — Bake automatically routes each platform to the correct builder node.

#### Using an ephemeral EC2 spot instance

For CI/CD pipelines that need fast amd64 builds but do not have a persistent builder:

```yaml
# .github/workflows/build.yml (abbreviated)
jobs:
  build:
    runs-on: ubuntu-latest  # x86_64 GitHub runner — native amd64!
    steps:
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - run: |
          TAG=${{ github.sha }} docker bake --push
```

On a native amd64 GitHub runner, there is no QEMU overhead — the `linux/amd64` target builds at full hardware speed.

### Step 6 — Rocky Linux 8.10 HPC-Specific Patterns

#### Matching the cluster environment

Rocky Linux 8.10 ships with glibc 2.28. If your image links against a newer glibc (e.g., Ubuntu 24.04 ships glibc 2.39), the binary will fail to run on the cluster with:

```
/lib64/ld-linux-x86-64.so.2: No such file or directory
```

**Always use `rockylinux:8.10` (or `rockylinux:8`) as your runtime base** when targeting Rocky 8.10 clusters.

```dockerfile
# ✓ Correct — runtime glibc matches cluster
FROM rockylinux:8.10

# ✗ Will fail — glibc 2.39 vs cluster glibc 2.28
FROM ubuntu:24.04
```

#### Python on Rocky Linux 8

Rocky Linux 8 ships Python 3.6 as the system default. AppStream provides Python 3.9, 3.11, and 3.12 as modules:

```dockerfile
FROM rockylinux:8.10

# Enable the Python 3.11 module stream
RUN dnf module enable -y python311 && \
    dnf install -y python311 python311-pip python311-devel && \
    dnf clean all

# Make python3 point to 3.11
RUN alternatives --set python3 /usr/bin/python3.11
```

#### EPEL and additional packages

For scientific software, EPEL (Extra Packages for Enterprise Linux) is often needed:

```dockerfile
FROM rockylinux:8.10

RUN dnf install -y epel-release && \
    dnf install -y \
      hdf5 \
      hdf5-devel \
      openmpi \
      openmpi-devel && \
    dnf clean all
```

#### Running Docker images under Singularity/Apptainer

Many HPC clusters run Singularity (now Apptainer) rather than Docker for security reasons. Your Docker images work directly:

```bash
# Pull a Docker image into a Singularity Image File (.sif)
singularity pull myapp.sif docker://yourusername/myapp:latest

# Run it
singularity run myapp.sif

# Run with bind mounts (equivalent to Docker -v)
singularity run --bind /data:/data myapp.sif

# Run with GPU (equivalent to Docker --gpus all)
singularity run --nv myapp.sif
```

The bake pipeline is unchanged — you build and push a standard OCI image, and `singularity pull` handles the conversion.

See [[isaaclab-metagrasp-apptainer-hpc-beginner-guide|IsaacLab + Apptainer HPC Guide]] for a full example of this workflow with GPU workloads.

---

## Practical Examples

### Example 1 — Production-Ready Bake File for HPC

A complete `docker-bake.hcl` for a data science application deployed to a Rocky Linux 8.10 HPC cluster, built from an Apple Silicon Mac:

```hcl
# docker-bake.hcl

variable "REGISTRY"   { default = "ghcr.io/myorg" }
variable "IMAGE_NAME" { default = "hpc-app" }
variable "TAG"        { default = "latest" }
variable "CI"         { default = "" }

locals {
  full_image = "${REGISTRY}/${IMAGE_NAME}"
  is_ci      = CI != ""
}

group "default" {
  targets = ["app"]
}

group "all-versions" {
  targets = ["app-matrix"]
}

# Standard single-tag build
target "app" {
  context    = "."
  dockerfile = "Dockerfile"
  platforms  = ["linux/amd64"]
  tags = [
    "${local.full_image}:${TAG}",
  ]
  cache-from = local.is_ci ? ["type=gha,scope=${IMAGE_NAME}"] : []
  cache-to   = local.is_ci ? ["type=gha,scope=${IMAGE_NAME},mode=max"] : []
}

# Matrix build across Python versions
target "app-matrix" {
  name = "${IMAGE_NAME}-py${python_ver}"

  matrix = {
    python_ver = ["3.9", "3.11"]
  }

  context    = "."
  dockerfile = "Dockerfile"
  platforms  = ["linux/amd64"]

  args = {
    PYTHON_VERSION = python_ver
  }

  tags = ["${local.full_image}:py${python_ver}-${TAG}"]

  cache-from = local.is_ci ? ["type=gha,scope=${IMAGE_NAME}-${python_ver}"] : []
  cache-to   = local.is_ci ? ["type=gha,scope=${IMAGE_NAME}-${python_ver},mode=max"] : []
}
```

```dockerfile
# Dockerfile
# syntax=docker/dockerfile:1

ARG PYTHON_VERSION=3.11

# Build stage — native on your Mac (fast)
FROM --platform=$BUILDPLATFORM python:${PYTHON_VERSION}-slim AS builder

WORKDIR /build
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Runtime — Rocky Linux 8.10, matching HPC cluster
FROM rockylinux:8.10

ARG PYTHON_VERSION=3.11

# Install Python matching the requested version
RUN PYVER=$(echo ${PYTHON_VERSION} | tr -d '.') && \
    dnf module enable -y python${PYVER} && \
    dnf install -y python${PYVER} python${PYVER}-pip && \
    dnf clean all

COPY --from=builder /install /usr/local
COPY . /app
WORKDIR /app

ENTRYPOINT ["python3", "main.py"]
```

### Example 2 — Debugging Bake Configuration

Print the resolved build configuration without actually building:

```bash
docker bake --print
```

Sample output:

```json
{
  "group": {
    "default": {
      "targets": ["app"]
    }
  },
  "target": {
    "app": {
      "context": ".",
      "dockerfile": "Dockerfile",
      "platforms": ["linux/amd64"],
      "tags": ["ghcr.io/myorg/hpc-app:latest"],
      "cache-from": [],
      "cache-to": []
    }
  }
}
```

This is invaluable when debugging variable resolution — the JSON shows exactly what Bake will pass to BuildKit.

### Example 3 — GitHub Actions CI/CD Pipeline

```yaml
# .github/workflows/docker-bake.yml
name: Build and Push

on:
  push:
    branches: [main]
  release:
    types: [published]

jobs:
  bake:
    runs-on: ubuntu-latest   # native amd64 — no QEMU overhead

    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v4

      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Set image tag
        id: meta
        run: |
          if [ "${{ github.event_name }}" = "release" ]; then
            echo "tag=${{ github.event.release.tag_name }}" >> $GITHUB_OUTPUT
          else
            echo "tag=${{ github.sha }}" >> $GITHUB_OUTPUT
          fi

      - name: Build and push
        env:
          REGISTRY: ghcr.io/${{ github.repository_owner }}
          TAG: ${{ steps.meta.outputs.tag }}
          CI: "true"
        run: docker bake --push
```

Because the GitHub runner is already `linux/amd64`, the build is native — no QEMU emulation, full speed.

### Example 4 — Local Development Override File

Create `docker-bake.override.hcl` (gitignored) for personal development settings:

```hcl
# docker-bake.override.hcl — personal overrides, not committed

variable "REGISTRY" {
  # Use your personal namespace instead of the org registry during development
  default = "docker.io/myusername"
}

target "app" {
  # Always load locally instead of pushing during development
  output = ["type=docker"]

  # Skip the slow amd64 QEMU build; test with native arm64 locally
  platforms = ["linux/arm64"]
}
```

Bake automatically merges `docker-bake.override.hcl` on top of `docker-bake.hcl` when it exists. Your teammates never see your local tweaks.

---

## Hands-On Exercises

**Exercise 1 — Conditional Cache**

1. Write a bake file where `cache-from` and `cache-to` are empty lists when `CI` env var is empty, and use registry cache when `CI=true`.
2. Verify with `docker bake --print` and `CI=true docker bake --print`.

**Exercise 2 — Matrix with Three Python Versions**

1. Extend the matrix example to build for Python 3.9, 3.10, 3.11.
2. Add a group `all-python` that contains all three targets.
3. Build the group: `docker bake --load all-python`.
4. Verify all three images exist: `docker images | grep myapp`.

**Exercise 3 — Remote Builder**

1. If you have SSH access to any Linux x86_64 machine (even a cheap VPS), configure it as a remote builder node using `docker buildx create --append`.
2. Run `docker buildx inspect hybrid` to confirm both nodes are present.
3. Build your app with `platforms = ["linux/amd64"]` and observe the build happening on the remote host in the build output.

**Exercise 4 — Singularity Round-trip**

1. Push a small `linux/amd64` image to Docker Hub or GHCR.
2. On a Linux machine (or using an amd64 container locally), install Singularity/Apptainer.
3. `singularity pull myapp.sif docker://yourusername/myapp:latest`
4. `singularity run myapp.sif` — verify the app runs correctly under Singularity.

---

## Troubleshooting

### Build is ignoring my override file

Bake only auto-merges files named exactly `docker-bake.override.hcl` in the current directory. For any other name, use explicit `-f` flags:

```bash
docker bake -f docker-bake.hcl -f my-overrides.hcl --push
```

### Matrix target names collide

If two matrix expansions resolve to the same `name`, Bake will error. Make sure your `name` template includes all dimensions of the matrix:

```hcl
# ✗ Bad — "app-3.9" is ambiguous if there are two matrix dimensions
name = "app-${version}"

# ✓ Good — encodes all dimensions
name = "app-py${python_ver}-${distro}"
```

### `locals` block produces wrong value

Use `docker bake --print` to inspect the resolved configuration. If a local expression looks wrong, check that:
- String interpolation uses `"${expr}"` syntax
- You are referencing `local.myvar` not `var.myvar` for locals
- Function names are spelled exactly as the HCL stdlib defines them (`split`, `join`, `upper`, `lower`, etc.)

### Rocky Linux 8.10 image: `module enable` fails

In recent Rocky 8.10 container images, `dnf module` requires the `dnf-plugins-core` package and the `appstream` repo to be enabled:

```dockerfile
RUN dnf install -y dnf-plugins-core && \
    dnf config-manager --set-enabled appstream && \
    dnf module enable -y python311 && \
    dnf install -y python311 && \
    dnf clean all
```

### Build context too large — slow uploads to remote builder

Add a `.dockerignore` file to exclude non-essential files from the build context sent to BuildKit (local or remote):

```
# .dockerignore
.git
**/__pycache__
**/*.pyc
.env
.venv
dist/
build/
*.egg-info/
```

### Debugging a failed amd64 build from Apple Silicon

Launch an interactive amd64 container to debug build failures:

```bash
# Open a bash shell inside an emulated amd64 Rocky Linux container
docker run --rm -it --platform linux/amd64 rockylinux:8.10 bash

# Now you are inside an amd64 Rocky environment on your Mac
uname -m       # prints x86_64
cat /etc/os-release   # shows Rocky Linux 8.10
```

---

## References

- [Docker Bake Reference (complete HCL schema)](https://docs.docker.com/build/bake/reference/)
- [Docker Bake Matrices](https://docs.docker.com/build/bake/matrices/)
- [BuildKit Cache Documentation](https://docs.docker.com/build/cache/)
- [BuildKit GitHub Actions Cache](https://github.com/moby/buildkit#github-actions-cache-experimental)
- [Rocky Linux 8 Application Streams (Python)](https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/8/html/installing_managing_and_removing_user_space_components/using-appstream_using-appstream)
- [Apptainer (Singularity) Docker compatibility](https://apptainer.org/docs/user/main/docker_and_oci.html)
- Vault: [[docker-multiplatform-apple-silicon|Building Multi-Platform Docker Images on Apple Silicon]]

---

## Related Tutorials

- [[docker-bake-beginner-guide|Docker Bake Beginner Guide]] — start here if you are new to Bake
- [[docker-test-container-beginner-guide|Docker Test Container Beginner Guide]] — Docker fundamentals
- [[docker-test-container-deep-dive|Docker Test Container Deep Dive]] — multi-stage builds and advanced Dockerfile patterns
- [[docker-multiplatform-apple-silicon|Building Multi-Platform Docker Images on Apple Silicon]] — buildx fundamentals and QEMU internals
- [[kubernetes-beginner-guide|Kubernetes Beginner Guide]] — orchestrating containers after building them with Bake
- [[kubernetes-deep-dive|Kubernetes Deep Dive]] — production Kubernetes patterns
- [[isaaclab-metagrasp-apptainer-hpc-beginner-guide|IsaacLab + Apptainer HPC Guide]] — GPU workloads on HPC clusters using Singularity images built from Docker
- [[isaaclab-metagrasp-apptainer-hpc-deep-dive|IsaacLab + Apptainer HPC Deep Dive]] — advanced HPC container workflows
- [[hyperqueue-basics|HyperQueue Basics]] — HPC job scheduling for workloads packaged in Docker/Singularity images
- [[hyperqueue-deep-dive|HyperQueue Deep Dive]] — production HPC task dispatch
- [[parsl-beginner-guide|Parsl Beginner Guide]] — Python parallel computing on HPC clusters
- [[pixi-beginner-guide|Pixi Beginner Guide]] — fast conda-compatible environment management for reproducible builds

---

## Summary

**Key takeaways:**

1. **HCL gives you variables, locals, functions, and conditionals.** Use them to keep your bake file DRY and make it work across dev/CI/production environments without duplication.

2. **`inherits` is the core DRY tool.** Define a `_common` target with shared settings and inherit from it in all real targets. Override only what differs.

3. **Matrix builds parallelize version variants.** Instead of maintaining N nearly-identical targets, declare one target with a `matrix` block and let Bake expand it.

4. **Remote native builders eliminate QEMU overhead.** Add an amd64 host to your builder pool with `docker buildx create --append`. For CI, use a native `ubuntu-latest` GitHub Actions runner.

5. **Match your base image to your cluster OS.** Use `rockylinux:8.10` for Rocky 8.10 HPC clusters. glibc mismatches cause silent or cryptic failures at runtime.

6. **Docker images run under Singularity unchanged.** Build and push a standard OCI image; `singularity pull docker://...` handles the conversion for HPC environments that require Apptainer.

7. **`docker bake --print` is your debugging tool.** Always inspect the resolved configuration before running long builds, especially when working with complex variable expressions.

**Next steps:**

- Add Docker Bake to your project's CI pipeline and enjoy deterministic, cached, multi-platform builds
- Set up a remote amd64 builder node (or use GitHub's native amd64 runners) for production-speed cross-platform builds
- Explore [[hyperqueue-basics|HyperQueue]] and [[parsl-beginner-guide|Parsl]] to schedule jobs on the HPC cluster that consume your freshly built images
