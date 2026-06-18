---
title: "uv Deep Dive — Advanced Python Packaging, Internals & Professional Workflows"
date: 2026-05-13
difficulty: advanced
tags: [uv, python, package-manager, pip, virtual-environment, astral, rust, advanced]
---

# uv Deep Dive — Advanced Python Packaging, Internals & Professional Workflows

## 1. Overview

This deep dive goes well beyond the basics covered in the [[uv-beginner-guide|uv Beginner Guide]]. Here we dissect the internals of uv's resolver, explore workspace and monorepo patterns, optimize CI/CD pipelines with aggressive caching, build production Docker images with multi-stage builds, and lay out migration strategies from pip, poetry, and conda.

**What you will learn:**

- How the PubGrub-based dependency resolver works and why it is fast
- Workspace and monorepo project architecture with `uv`
- Docker multi-stage build patterns that produce minimal production images
- CI/CD optimization with GitHub Actions caching
- Migration paths from pip/requirements.txt, Poetry, and conda
- Publishing packages to PyPI and private registries
- Cache architecture, platform markers, and build isolation internals
- When to reach for uv versus [[pixi-deep-dive|Pixi Deep Dive]] or other tools

If you are looking for conda-channel support or HPC scientific computing workflows, see the [[pixi-beginner-guide|Pixi Beginner Guide]] and [[pixi-hpc-usage|Using Pixi on HPC Clusters]] instead — uv is deliberately PyPI-only by design.

---

## 2. Prerequisites

Before working through this guide you should be comfortable with:

- **uv basics** — installing packages, creating projects, running scripts. See the [[uv-beginner-guide|uv Beginner Guide]] if you need a refresher.
- **Python packaging ecosystem** — understand what wheels, sdists, and build backends are.
- **pyproject.toml and PEP standards** — PEP 621 (project metadata), PEP 631 (dependency specification), PEP 660 (editable installs), PEP 723 (inline script metadata).
- **Git fundamentals** — branching, tagging, and basic repository management. See [[git-worktrees-beginner-guide|Git Worktrees Beginner Guide]] for monorepo-related Git patterns.
- **CI/CD familiarity** — basic understanding of GitHub Actions or similar systems.
- **Docker basics** — Dockerfiles, layers, multi-stage builds. See [[docker-test-container-deep-dive|Docker Test Container Deep Dive]] for related patterns.
- **Command-line comfort** — shell scripting, environment variables, file permissions ([[linux-permissions-beginner-guide|Linux Permissions Beginner Guide]]).

**Environment:**

```bash
# Verify uv is installed and up to date
uv --version
# Expected output (version may differ):
# uv 0.7.x (Homebrew 2026-xx-xx)

# Verify Python is available
python3 --version
# Expected output:
# Python 3.12.x
```

---

## 3. Key Concepts

### 3.1 The PubGrub Resolution Algorithm

uv uses a Rust implementation of the **PubGrub** algorithm for dependency resolution. PubGrub is a version-solving algorithm originally developed for the Dart package manager (pub). It works by:

1. **Unit propagation** — when a package is selected at a specific version, all its dependencies become constraints that must be satisfied.
2. **Conflict-driven learning** — when a conflict is detected, the solver analyzes the root cause and learns a new constraint (an "incompatibility") that prevents the same conflict from recurring.
3. **Backjumping** — instead of naive backtracking (undoing one decision at a time), PubGrub jumps back to the decision that actually caused the conflict.

This approach is fundamentally different from pip's backtracking resolver, which explores the dependency tree more naively and can get stuck in exponential search spaces.

```
┌─────────────────────────────────────────────────┐
│              PubGrub Resolution Flow             │
├─────────────────────────────────────────────────┤
│                                                  │
│  1. Pick next undecided package                  │
│  2. Choose best version (latest compatible)      │
│  3. Add version's dependencies as constraints    │
│  4. Propagate constraints (unit propagation)     │
│  5. Conflict? → Analyze root cause               │
│     → Learn incompatibility                      │
│     → Backjump to causal decision                │
│  6. No conflict? → Go to step 1                  │
│  7. All decided? → Solution found                │
│                                                  │
└─────────────────────────────────────────────────┘
```

**Why uv is fast:**

- **Rust** — no interpreter startup overhead, zero-cost abstractions, parallel I/O.
- **Aggressive caching** — HTTP responses, metadata, and wheel builds are all cached.
- **Parallel metadata fetching** — uv fetches package metadata concurrently from the index.
- **Lazy wheel downloads** — only downloads wheels that are actually needed after resolution.
- **PubGrub efficiency** — conflict-driven learning avoids redundant search paths.

### 3.2 Platform Markers and Environment Resolution

uv resolves dependencies with full awareness of PEP 508 environment markers:

```toml
# pyproject.toml
[project]
dependencies = [
    "uvloop>=0.19; sys_platform != 'win32'",
    "winloop>=0.1; sys_platform == 'win32'",
    "numpy>=1.26; python_version >= '3.12'",
    "numpy>=1.24,<1.26; python_version < '3.12'",
]
```

uv evaluates markers at resolution time and produces a **universal lockfile** (`uv.lock`) that encodes solutions for all target platforms in a single file. This is a key differentiator — pip-tools generates platform-specific lockfiles, while uv produces one lockfile that works everywhere.

### 3.3 Extras and Optional Dependencies

```toml
[project.optional-dependencies]
dev = ["pytest>=8.0", "ruff>=0.4", "mypy>=1.10"]
docs = ["sphinx>=7.0", "sphinx-rtd-theme"]
gpu = ["torch>=2.3; sys_platform != 'darwin' or platform_machine != 'x86_64'"]
```

Install with extras:

```bash
uv sync --extra dev --extra docs
# Or install all extras:
uv sync --all-extras
```

### 3.4 Build Backends

uv supports all PEP 517 build backends. The build backend is specified in `pyproject.toml`:

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

Common backends uv works with:

| Backend | Use Case | Notes |
|---------|----------|-------|
| `hatchling` | General purpose, uv default | Fast, minimal config |
| `setuptools` | Legacy and compiled extensions | Broad ecosystem support |
| `maturin` | Rust+Python (PyO3) | For Rust extension modules |
| `scikit-build-core` | C/C++/Fortran extensions | CMake-based builds |
| `flit-core` | Pure Python, minimal | Simple and fast |
| `pdm-backend` | PDM ecosystem | PEP 621 native |

### 3.5 Workspace Dependency Graph

uv workspaces allow you to manage multiple related packages in a single repository. The workspace root defines members, and each member is a full Python package:

```
monorepo/
├── pyproject.toml          # workspace root
├── uv.lock                 # single lockfile for entire workspace
├── packages/
│   ├── core/
│   │   ├── pyproject.toml  # workspace member
│   │   └── src/core/
│   ├── api/
│   │   ├── pyproject.toml  # workspace member, depends on core
│   │   └── src/api/
│   └── cli/
│       ├── pyproject.toml  # workspace member, depends on core + api
│       └── src/cli/
```

The workspace dependency graph is resolved as a single unit — all members share compatible dependency versions through the unified lockfile.

### 3.6 Cache Architecture

uv maintains a structured cache (default `~/.cache/uv` on Linux, `~/Library/Caches/uv` on macOS):

```
~/.cache/uv/
├── archive-v0/          # Unpacked wheel archives
├── built-wheels-v4/     # Locally built wheels from sdists
├── environments-v1/     # Cached virtual environments
├── git-v0/              # Cloned Git repositories
├── interpreter-v4/      # Python interpreter metadata
├── sdists-v6/           # Downloaded source distributions
├── simple-v14/          # PyPI Simple API response cache
└── wheels-v3/           # Downloaded pre-built wheels
```

Cache management:

```bash
# Show cache location and size
uv cache dir
uv cache info

# Clean entire cache
uv cache clean

# Clean cache for a specific package
uv cache clean requests

# Prune unreachable cache entries (safe)
uv cache prune
```

### 3.7 uv vs pip/pip-tools/Poetry Lockfiles

| Feature | pip freeze | pip-tools | Poetry | uv |
|---------|-----------|-----------|--------|-----|
| Universal lockfile | No | No | No | Yes |
| Cross-platform lock | No | No | Partial | Yes |
| Resolution speed | N/A | Slow | Medium | Fast |
| Hash verification | Manual | Yes | Yes | Yes |
| Workspace support | No | No | No | Yes |
| Lock format | txt | txt | toml | toml |

### 3.8 uv vs Pixi — Choosing the Right Tool

Both uv and pixi are Rust-based next-generation tools from Astral and prefix.dev respectively. They target different niches:

| Dimension | uv | pixi |
|-----------|-----|------|
| **Package sources** | PyPI only | conda channels + PyPI |
| **Resolver** | PubGrub (PyPI-optimized) | rattler/libsolv (conda+PyPI) |
| **Resolution speed** | Extremely fast for PyPI | Fast, but conda metadata is heavier |
| **Compiled deps (numpy, scipy)** | Wheels from PyPI | Pre-built conda binaries |
| **CUDA/GPU libraries** | PyPI wheels (large) | conda nvidia channel (optimized) |
| **HPC clusters** | Possible but limited | Purpose-built (see [[pixi-hpc-usage|Using Pixi on HPC Clusters]]) |
| **Non-Python deps (R, Julia, C libs)** | Not supported | Full support via conda |
| **Lockfile** | `uv.lock` (universal) | `pixi.lock` (multi-platform) |
| **Python version management** | Built-in (`uv python install`) | Built-in (`pixi global install python`) |
| **Virtual environments** | Standard venvs | Conda environments |
| **Best for** | Web dev, microservices, pure Python | Scientific computing, data science, HPC |

**Decision guide:**

- **Pure Python web app or microservice?** Use uv. Its PyPI resolver is faster and its Docker integration is tighter.
- **Data science with compiled deps (numpy, pandas, scipy)?** Pixi is simpler — conda binaries avoid compilation entirely. See [[pixi-deep-dive|Pixi Deep Dive]].
- **HPC cluster with module systems?** Pixi handles system-level deps that uv cannot. See [[pixi-hpc-usage|Using Pixi on HPC Clusters]].
- **Rust+Python hybrid project?** uv with maturin backend.
- **Mixed ecosystem (Python + R + system libs)?** Pixi, no contest.

---

## 4. Step-by-Step Instructions

### 4.1 Workspace / Monorepo Setup

Create a workspace root:

```bash
mkdir my-monorepo && cd my-monorepo
uv init --name my-monorepo
```

Edit the root `pyproject.toml` to declare workspace members:

```toml
[project]
name = "my-monorepo"
version = "0.1.0"
requires-python = ">=3.11"

[tool.uv.workspace]
members = ["packages/*"]
```

Create workspace members:

```bash
# Create the core library
mkdir -p packages/core
cd packages/core
uv init --lib --name my-core
cd ../..

# Create the API service
mkdir -p packages/api
cd packages/api
uv init --name my-api
cd ../..

# Create the CLI tool
mkdir -p packages/cli
cd packages/cli
uv init --name my-cli
cd ../..
```

Add cross-member dependencies. In `packages/api/pyproject.toml`:

```toml
[project]
name = "my-api"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "my-core",        # workspace dependency (resolved locally)
    "fastapi>=0.111",
    "uvicorn>=0.30",
]

[tool.uv.sources]
my-core = { workspace = true }
```

In `packages/cli/pyproject.toml`:

```toml
[project]
name = "my-cli"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "my-core",
    "my-api",
    "click>=8.1",
]

[tool.uv.sources]
my-core = { workspace = true }
my-api = { workspace = true }
```

Lock and sync the entire workspace:

```bash
# From the workspace root
uv lock
# Expected output:
# Resolved 42 packages in 1.23s

uv sync
# Expected output:
# Installed 42 packages in 0.89s
```

Run commands within a specific member:

```bash
# Run tests for the API package
uv run --package my-api pytest

# Run the CLI
uv run --package my-cli python -m my_cli
```

### 4.2 Migration from pip requirements.txt

Given an existing project with `requirements.txt`:

```bash
# Step 1: Initialize a uv project (preserves existing code)
cd legacy-project/
uv init

# Step 2: Import dependencies from requirements.txt
uv add $(cat requirements.txt | grep -v '^#' | grep -v '^\s*$' | tr '\n' ' ')

# Step 3: For complex requirements.txt with markers/extras,
# use uv's built-in pip compatibility:
uv pip compile requirements.txt -o requirements-locked.txt

# Step 4: Or migrate fully to pyproject.toml-managed deps:
uv add -r requirements.txt

# Step 5: Lock and verify
uv lock
uv sync

# Step 6: Run your test suite to verify nothing broke
uv run pytest
```

If you have separate `requirements-dev.txt`:

```bash
# Add dev dependencies to an optional group
uv add --group dev -r requirements-dev.txt
```

### 4.3 Migration from Poetry

Poetry projects use `pyproject.toml` with `[tool.poetry]` sections. uv can read the dependency specification but uses a different lockfile format:

```bash
# Step 1: In your Poetry project directory
cd poetry-project/

# Step 2: uv can work alongside poetry's pyproject.toml
# But for a clean migration, convert the metadata

# Step 3: Replace poetry-specific build system
# FROM:
# [build-system]
# requires = ["poetry-core"]
# build-backend = "poetry.core.masonry.api"

# TO:
# [build-system]
# requires = ["hatchling"]
# build-backend = "hatchling.build"

# Step 4: Move [tool.poetry.dependencies] to [project.dependencies]
# Poetry format:
# [tool.poetry.dependencies]
# requests = "^2.31"
# python = "^3.11"

# PEP 621 format:
# [project]
# requires-python = ">=3.11"
# dependencies = ["requests>=2.31,<3"]

# Step 5: Move dev dependencies
# Poetry: [tool.poetry.group.dev.dependencies]
# uv:     [project.optional-dependencies] or [dependency-groups]

# Step 6: Generate uv lockfile
uv lock

# Step 7: Remove poetry.lock (no longer needed)
rm poetry.lock

# Step 8: Verify
uv sync
uv run pytest
```

**Version constraint translation:**

| Poetry | PEP 621 (uv) | Meaning |
|--------|---------------|---------|
| `^2.31` | `>=2.31,<3` | Compatible release (major) |
| `~2.31` | `>=2.31,<2.32` | Compatible release (minor) |
| `>=2.31,<3` | `>=2.31,<3` | Identical |
| `*` | `>=0` | Any version |

### 4.4 Migration from conda

Migrating from conda to uv is the most complex path because conda packages may include non-Python dependencies. If your project relies heavily on conda-channel packages (CUDA libraries, system-level C libraries, R, etc.), consider [[pixi-deep-dive|Pixi Deep Dive]] instead — pixi handles both conda and PyPI packages natively.

For pure-Python conda projects:

```bash
# Step 1: Export current conda environment
conda list --export > conda-packages.txt

# Step 2: Identify which packages are available on PyPI
# Most pure-Python packages exist on both conda and PyPI
# System libraries (libffi, openssl, etc.) do not

# Step 3: Create a uv project
uv init

# Step 4: Add PyPI-available packages
# Filter out conda-only system packages and add the rest
uv add numpy pandas scikit-learn requests flask

# Step 5: For packages that need system libraries,
# install those via your OS package manager:
# Ubuntu/Debian: apt install libffi-dev libssl-dev
# macOS: brew install libffi openssl
# See [[linux-permissions-beginner-guide|Linux Permissions Beginner Guide]] for system-level operations

# Step 6: Lock and test
uv lock
uv sync
uv run pytest
```

### 4.5 Docker Multi-Stage Builds with uv

This is one of uv's strongest use cases — it dramatically speeds up Docker builds compared to pip:

```dockerfile
# ============================================
# Stage 1: Build stage — resolve and install
# ============================================
FROM python:3.12-slim AS builder

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Set uv environment variables
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

# Create app directory
WORKDIR /app

# Copy dependency files first (layer caching)
COPY pyproject.toml uv.lock ./

# Install dependencies only (no project code yet)
RUN uv sync --frozen --no-install-project --no-dev

# Now copy project source and install it
COPY . .
RUN uv sync --frozen --no-dev

# ============================================
# Stage 2: Runtime stage — minimal image
# ============================================
FROM python:3.12-slim AS runtime

# Copy the virtual environment from builder
COPY --from=builder /app/.venv /app/.venv

# Copy application code
COPY --from=builder /app /app

# Set PATH to use the venv
ENV PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# Run as non-root user
RUN useradd --create-home appuser
USER appuser

EXPOSE 8000

CMD ["uvicorn", "my_api:app", "--host", "0.0.0.0", "--port", "8000"]
```

**Key optimizations explained:**

- `UV_COMPILE_BYTECODE=1` — pre-compiles `.pyc` files at build time, reducing startup latency.
- `UV_LINK_MODE=copy` — copies files instead of hardlinking, required for multi-stage builds where the source filesystem disappears.
- `UV_PYTHON_DOWNLOADS=never` — prevents uv from downloading Python (we use the base image's interpreter).
- `--frozen` — uses the lockfile exactly as-is, failing if it is out of date. Ensures reproducibility.
- `--no-install-project` first, then full `uv sync` — separating dependency install from project install maximizes Docker layer cache hits. Dependencies change less often than source code.

For workspace monorepo Docker builds, see the Practical Examples section below.

### 4.6 CI/CD Pipelines — GitHub Actions with Caching

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: ["3.11", "3.12", "3.13"]

    steps:
      - uses: actions/checkout@v4

      - name: Install uv
        uses: astral-sh/setup-uv@v5
        with:
          enable-cache: true
          cache-dependency-glob: "uv.lock"

      - name: Set up Python ${{ matrix.python-version }}
        run: uv python install ${{ matrix.python-version }}

      - name: Install dependencies
        run: uv sync --all-extras --dev

      - name: Lint with ruff
        run: uv run ruff check .

      - name: Type check with mypy
        run: uv run mypy src/

      - name: Test with pytest
        run: uv run pytest --cov=src --cov-report=xml

      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          file: coverage.xml
```

**Cache breakdown:**

The `astral-sh/setup-uv` action with `enable-cache: true` caches the uv global cache (`~/.cache/uv`). The `cache-dependency-glob` key ensures the cache is invalidated when the lockfile changes. Typical CI speedup is 5-10x on cache hits compared to pip.

### 4.7 Publishing Packages

```bash
# Build the package
uv build
# Expected output:
# Building source distribution...
# Building wheel from source distribution...
# Successfully built dist/my-package-0.1.0.tar.gz
# Successfully built dist/my_package-0.1.0-py3-none-any.whl

# Publish to PyPI (requires API token)
uv publish --token pypi-AgEIcH...

# Publish to TestPyPI
uv publish --index-url https://test.pypi.org/legacy/ --token pypi-AgEIcH...
```

Configure trusted publishing in `pyproject.toml`:

```toml
[tool.uv]
publish-url = "https://upload.pypi.org/legacy/"
```

### 4.8 Custom Index and Registry Configuration

For private PyPI registries (Artifactory, Nexus, AWS CodeArtifact, GCP Artifact Registry):

```toml
# pyproject.toml
[tool.uv]
index-url = "https://pypi.org/simple/"
extra-index-url = [
    "https://my-company.jfrog.io/artifactory/api/pypi/python-local/simple/",
]

[[tool.uv.index]]
name = "company-registry"
url = "https://my-company.jfrog.io/artifactory/api/pypi/python-local/simple/"
```

Authentication via environment variables or keyring:

```bash
# Environment variable authentication
export UV_INDEX_COMPANY_REGISTRY_USERNAME=deploy-bot
export UV_INDEX_COMPANY_REGISTRY_PASSWORD=token-here

# Or via .netrc
cat >> ~/.netrc << 'EOF'
machine my-company.jfrog.io
    login deploy-bot
    password token-here
EOF
chmod 600 ~/.netrc
```

Pin specific packages to specific indexes:

```toml
# Force internal packages to come from the company registry
[tool.uv.sources]
my-internal-lib = { index = "company-registry" }
```

---

## 5. Practical Examples

### 5.1 Monorepo with Multiple Packages

A real-world monorepo for a web platform:

```
platform/
├── pyproject.toml
├── uv.lock
├── packages/
│   ├── platform-models/      # Shared SQLAlchemy models
│   │   ├── pyproject.toml
│   │   └── src/platform_models/
│   │       ├── __init__.py
│   │       ├── user.py
│   │       └── product.py
│   ├── platform-api/         # FastAPI service
│   │   ├── pyproject.toml
│   │   └── src/platform_api/
│   │       ├── __init__.py
│   │       ├── main.py
│   │       └── routes/
│   ├── platform-worker/      # Celery worker
│   │   ├── pyproject.toml
│   │   └── src/platform_worker/
│   │       ├── __init__.py
│   │       └── tasks.py
│   └── platform-cli/         # Management CLI
│       ├── pyproject.toml
│       └── src/platform_cli/
│           ├── __init__.py
│           └── commands.py
```

Root `pyproject.toml`:

```toml
[project]
name = "platform"
version = "0.1.0"
requires-python = ">=3.12"

[tool.uv.workspace]
members = ["packages/*"]

[dependency-groups]
dev = [
    "pytest>=8.0",
    "ruff>=0.4",
    "mypy>=1.10",
    "pre-commit>=3.7",
]
```

`packages/platform-api/pyproject.toml`:

```toml
[project]
name = "platform-api"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "platform-models",
    "fastapi>=0.111",
    "uvicorn[standard]>=0.30",
    "sqlalchemy>=2.0",
    "pydantic>=2.7",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.uv.sources]
platform-models = { workspace = true }
```

Running specific services:

```bash
# Run the API server
uv run --package platform-api uvicorn platform_api.main:app --reload

# Run the Celery worker
uv run --package platform-worker celery -A platform_worker.tasks worker

# Run the CLI
uv run --package platform-cli python -m platform_cli migrate

# Run tests for a specific package
uv run --package platform-api pytest packages/platform-api/tests/

# Run all tests across the workspace
uv run pytest
```

### 5.2 Docker Production Image for Monorepo Member

```dockerfile
# Dockerfile.api — builds only the API service from the monorepo
FROM python:3.12-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

# Copy workspace definition and lockfile
COPY pyproject.toml uv.lock ./

# Copy all member pyproject.toml files (needed for workspace resolution)
COPY packages/platform-models/pyproject.toml packages/platform-models/pyproject.toml
COPY packages/platform-api/pyproject.toml packages/platform-api/pyproject.toml

# Install workspace deps (without source code for caching)
RUN mkdir -p packages/platform-models/src/platform_models && \
    touch packages/platform-models/src/platform_models/__init__.py && \
    mkdir -p packages/platform-api/src/platform_api && \
    touch packages/platform-api/src/platform_api/__init__.py && \
    uv sync --frozen --no-dev --package platform-api

# Copy actual source code
COPY packages/platform-models/src packages/platform-models/src
COPY packages/platform-api/src packages/platform-api/src

# Reinstall with real source
RUN uv sync --frozen --no-dev --package platform-api

# ---- Runtime ----
FROM python:3.12-slim AS runtime

COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/packages /app/packages

ENV PATH="/app/.venv/bin:$PATH"
WORKDIR /app

RUN useradd --create-home appuser
USER appuser

EXPOSE 8000
CMD ["uvicorn", "platform_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Build and test:

```bash
docker build -f Dockerfile.api -t platform-api:latest .
docker run -p 8000:8000 platform-api:latest
# Expected output:
# INFO:     Started server process [1]
# INFO:     Waiting for application startup.
# INFO:     Application startup complete.
# INFO:     Uvicorn running on http://0.0.0.0:8000
```

For more Docker patterns, see [[docker-test-container-deep-dive|Docker Test Container Deep Dive]].

### 5.3 GitHub Actions CI with Cache for Monorepo

```yaml
# .github/workflows/ci.yml
name: Monorepo CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  detect-changes:
    runs-on: ubuntu-latest
    outputs:
      api: ${{ steps.changes.outputs.api }}
      worker: ${{ steps.changes.outputs.worker }}
      models: ${{ steps.changes.outputs.models }}
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v3
        id: changes
        with:
          filters: |
            models:
              - 'packages/platform-models/**'
            api:
              - 'packages/platform-api/**'
              - 'packages/platform-models/**'
            worker:
              - 'packages/platform-worker/**'
              - 'packages/platform-models/**'

  test-api:
    needs: detect-changes
    if: needs.detect-changes.outputs.api == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install uv
        uses: astral-sh/setup-uv@v5
        with:
          enable-cache: true
          cache-dependency-glob: "uv.lock"

      - name: Install and test
        run: |
          uv sync --frozen
          uv run --package platform-api pytest packages/platform-api/tests/ -v

  test-worker:
    needs: detect-changes
    if: needs.detect-changes.outputs.worker == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install uv
        uses: astral-sh/setup-uv@v5
        with:
          enable-cache: true
          cache-dependency-glob: "uv.lock"

      - name: Install and test
        run: |
          uv sync --frozen
          uv run --package platform-worker pytest packages/platform-worker/tests/ -v

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install uv
        uses: astral-sh/setup-uv@v5
        with:
          enable-cache: true

      - name: Lint
        run: |
          uv sync --frozen
          uv run ruff check .
          uv run ruff format --check .
          uv run mypy packages/
```

### 5.4 Migrating a Legacy requirements.txt Project

Starting point — a Flask app with pinned deps:

```text
# requirements.txt
Flask==2.3.3
SQLAlchemy==2.0.21
alembic==1.12.0
celery==5.3.4
redis==5.0.1
gunicorn==21.2.0
psycopg2-binary==2.9.9
python-dotenv==1.0.0
```

Migration steps:

```bash
# 1. Initialize uv project
uv init --name my-flask-app

# 2. Add all dependencies (uv converts pins to ranges)
uv add flask sqlalchemy alembic celery redis gunicorn psycopg2-binary python-dotenv

# 3. If you want to preserve exact versions, use constraints:
uv add 'flask==2.3.3' 'sqlalchemy==2.0.21'

# 4. Add dev dependencies
uv add --group dev pytest pytest-flask factory-boy

# 5. Lock the project
uv lock
# Expected output:
# Resolved 58 packages in 0.87s

# 6. Verify everything works
uv sync
uv run flask run
# Expected output:
#  * Running on http://127.0.0.1:5000

# 7. Remove old files
rm requirements.txt
# Optionally: rm requirements-dev.txt setup.py setup.cfg

# 8. Commit
git add pyproject.toml uv.lock
git rm requirements.txt
git commit -m "Migrate from pip to uv"
```

### 5.5 Private PyPI Registry Setup

AWS CodeArtifact example:

```bash
# Get auth token
export CODEARTIFACT_AUTH_TOKEN=$(aws codeartifact get-authorization-token \
    --domain my-org \
    --domain-owner 123456789 \
    --query authorizationToken \
    --output text)

# Configure in pyproject.toml
cat >> pyproject.toml << 'EOF'

[[tool.uv.index]]
name = "codeartifact"
url = "https://my-org-123456789.d.codeartifact.us-east-1.amazonaws.com/pypi/python/simple/"
EOF

# Set credentials via environment
export UV_INDEX_CODEARTIFACT_USERNAME=aws
export UV_INDEX_CODEARTIFACT_PASSWORD=$CODEARTIFACT_AUTH_TOKEN

# Install from private registry
uv sync
```

---

## 6. Hands-On Exercises

### Exercise 1: Set Up a Workspace Monorepo

**Goal:** Create a workspace with three packages — `mathlib` (core), `mathcli` (CLI), and `mathapi` (web service) — where the CLI and API both depend on the core library.

**Steps:**

1. Create the workspace root and configure `[tool.uv.workspace]`.
2. Initialize each member with `uv init --lib` (for mathlib) and `uv init` (for the others).
3. Add `mathlib` as a workspace dependency in both `mathcli` and `mathapi`.
4. Add `click` to `mathcli` and `fastapi` to `mathapi`.
5. Create a simple function in `mathlib` and import it from both consumers.
6. Run `uv lock` and `uv sync` from the workspace root.
7. Verify with `uv run --package mathcli python -c "from mathlib import add; print(add(2,3))"`.

**Success criteria:** `uv.lock` exists at the root, all workspace members can import from `mathlib`, and `uv run --package <name>` works for each member.

### Exercise 2: Create an Optimized Docker Build

**Goal:** Dockerize a FastAPI application using uv with multi-stage builds and verify layer caching works.

**Steps:**

1. Create a simple FastAPI project with `uv init` and `uv add fastapi uvicorn`.
2. Write a `Dockerfile` using the multi-stage pattern from Section 4.5.
3. Build the image and verify it runs: `docker build -t myapi . && docker run -p 8000:8000 myapi`.
4. Modify only the application source code (not dependencies) and rebuild.
5. Observe that Docker reuses the dependency layer (should show "CACHED" for the `uv sync` step).

**Success criteria:** Second build completes in under 5 seconds with cached dependency layers. Final image size is under 200MB.

### Exercise 3: Configure CI Pipeline with Caching

**Goal:** Set up a GitHub Actions workflow that lints, type-checks, and tests a uv project with caching.

**Steps:**

1. Create `.github/workflows/ci.yml` using the template from Section 4.6.
2. Include separate jobs for lint (`ruff`), type check (`mypy`), and test (`pytest`).
3. Use `astral-sh/setup-uv@v5` with `enable-cache: true`.
4. Add a matrix strategy for Python 3.11 and 3.12.
5. Push and verify the workflow runs successfully on GitHub.

**Success criteria:** All CI jobs pass. Second run shows cache hits in the setup-uv step.

### Exercise 4: Migrate a pip Project to uv

**Goal:** Take an existing pip-managed project and migrate it fully to uv.

**Steps:**

1. Clone any open-source Flask or Django project that uses `requirements.txt`.
2. Run `uv init` in the project root.
3. Import dependencies with `uv add -r requirements.txt`.
4. If there is a `requirements-dev.txt`, add with `uv add --group dev -r requirements-dev.txt`.
5. Run `uv lock` and `uv sync`.
6. Run the project's test suite with `uv run pytest`.
7. Remove the old `requirements.txt` files and commit.

**Success criteria:** `uv lock` resolves without errors, `uv sync` installs all packages, and the test suite passes with `uv run pytest`.

---

## 7. Troubleshooting

### 7.1 Resolver Conflicts with Complex Dependency Trees

**Symptom:** `uv lock` fails with "No solution found" for packages with many transitive dependencies.

```
error: No solution found when resolving dependencies:
  ╰─▶ Because package-a==1.2.0 depends on lib-x>=2.0 and package-b==3.1.0
      depends on lib-x<2.0, we can conclude that package-a==1.2.0 and
      package-b==3.1.0 are incompatible.
```

**Solution:**

```bash
# Get verbose resolver output to understand the conflict
uv lock -v 2>&1 | grep -i conflict

# Try relaxing version constraints
uv add 'package-a>=1.1'  # Allow older version that may be compatible

# Use override to force a specific version (last resort)
# In pyproject.toml:
# [tool.uv]
# override-dependencies = ["lib-x==2.0"]
```

### 7.2 Yanked Versions

**Symptom:** Warning about yanked packages during resolution.

```
warning: package-x==1.0.0 is yanked (reason: "security vulnerability")
```

**Solution:**

```bash
# Upgrade to the latest non-yanked version
uv add 'package-x>=1.0.1'

# Or check what versions are available
uv pip index versions package-x
```

### 7.3 Pre-release Handling

**Symptom:** uv refuses to install a pre-release version you need.

```bash
# Explicitly allow pre-releases for a specific package
uv add 'torch>=2.4.0a1' --prerelease allow

# Or configure globally in pyproject.toml
# [tool.uv]
# prerelease = "if-necessary-or-explicit"
```

Pre-release strategies:

| Strategy | Behavior |
|----------|----------|
| `disallow` | Never use pre-releases (default) |
| `allow` | Always consider pre-releases |
| `if-necessary` | Use pre-releases only if no stable version satisfies constraints |
| `if-necessary-or-explicit` | Use if necessary or if the constraint explicitly includes a pre-release |

### 7.4 Build Isolation Issues

**Symptom:** Packages with C extensions fail to build.

```
error: Failed to build package-x==1.0.0
  Caused by: Build backend `setuptools.build_meta` failed
```

**Solutions:**

```bash
# Install system build dependencies
# Ubuntu/Debian:
sudo apt install build-essential python3-dev libffi-dev

# macOS:
xcode-select --install

# If a package needs specific build deps not on PyPI:
uv add package-x --no-build-isolation
# Warning: --no-build-isolation uses the current environment's packages
# as build dependencies instead of creating an isolated build env
```

### 7.5 Platform-Specific Resolution Failures

**Symptom:** Lockfile generated on macOS fails on Linux or vice versa.

uv's universal lockfile should handle this automatically. If you see issues:

```bash
# Force re-resolution for all platforms
uv lock --upgrade

# Check the lockfile for platform markers
grep -A2 'resolution-markers' uv.lock

# If a package is genuinely platform-specific, use markers in pyproject.toml:
# dependencies = [
#     "pywin32>=306; sys_platform == 'win32'",
#     "uvloop>=0.19; sys_platform != 'win32'",
# ]
```

### 7.6 Cache Problems

**Symptom:** Stale packages, corrupt cache, or unexpectedly large cache.

```bash
# Check cache size
uv cache info
# Expected output:
# Location: /home/user/.cache/uv
# Size: 2.3 GiB
# Packages: 847

# Prune orphaned entries (safe operation)
uv cache prune

# Nuclear option: clear everything
uv cache clean

# Clear cache for a specific problematic package
uv cache clean numpy

# Force a fresh resolution ignoring cache
uv lock --refresh
```

### 7.7 "Python not found" Errors

```bash
# List available Python versions
uv python list

# Install a specific version
uv python install 3.12

# Pin the project to a specific Python
uv python pin 3.12

# This creates .python-version file
cat .python-version
# Expected output:
# 3.12
```

---

## 8. References

### Official Documentation
- [uv Documentation](https://docs.astral.sh/uv/) — comprehensive official docs
- [uv GitHub Repository](https://github.com/astral-sh/uv) — source code and issue tracker
- [Astral Blog](https://astral.sh/blog) — release announcements and design decisions

### PEP Standards
- [PEP 621](https://peps.python.org/pep-0621/) — storing project metadata in pyproject.toml
- [PEP 631](https://peps.python.org/pep-0631/) — dependency specification in pyproject.toml
- [PEP 660](https://peps.python.org/pep-0660/) — editable installs for pyproject.toml-based builds
- [PEP 723](https://peps.python.org/pep-0723/) — inline script metadata for single-file scripts
- [PEP 517](https://peps.python.org/pep-0517/) — build system interface
- [PEP 508](https://peps.python.org/pep-0508/) — dependency specification with environment markers

### Resolver Internals
- [PubGrub algorithm paper](https://nex3.medium.com/pubgrub-2fb6470504f) — Natalie Weizenbaum's original blog post
- [uv resolver design](https://docs.astral.sh/uv/concepts/resolution/) — how uv applies PubGrub to Python packaging

### Comparison Resources
- [pixi Documentation](https://pixi.sh/) — conda+PyPI package manager (see [[pixi-deep-dive|Pixi Deep Dive]])
- [Poetry Documentation](https://python-poetry.org/docs/) — Python dependency management
- [pip-tools](https://pip-tools.readthedocs.io/) — pip requirements compilation

---

## Related Tutorials

- [[uv-beginner-guide|uv Beginner Guide]] — start here if you are new to uv; covers installation, basic project setup, and everyday commands
- [[pixi-beginner-guide|Pixi Beginner Guide]] — getting started with pixi, the conda+PyPI alternative from prefix.dev
- [[pixi-deep-dive|Pixi Deep Dive]] — advanced pixi reference covering rattler solver internals, multi-environment configurations, and conda-forge workflows
- [[pixi-hpc-usage|Using Pixi on HPC Clusters]] — deploying pixi in HPC environments with module systems, Slurm, and shared filesystems
- [[docker-test-container-deep-dive|Docker Test Container Deep Dive]] — advanced Docker patterns including multi-stage builds, test containers, and CI integration
- [[linux-permissions-beginner-guide|Linux Permissions Beginner Guide]] — understanding file permissions, ownership, and access control for system-level package management
- [[git-worktrees-beginner-guide|Git Worktrees Beginner Guide]] — using Git worktrees for monorepo workflows, parallel branch development, and workspace patterns
- [[autoresearch-deep-dive|Autoresearch Deep Dive]] — Karpathy's autoresearch project uses uv as its sole environment manager; the deep dive covers `uv sync` / `uv run` in the context of a GPU training loop

---

## 9. Summary

### Key Advanced Takeaways

1. **PubGrub is the engine** — uv's speed comes from a Rust implementation of PubGrub with conflict-driven learning, parallel metadata fetching, and aggressive caching. This makes it the fastest resolver in the Python ecosystem for PyPI packages.

2. **Universal lockfiles are a game-changer** — a single `uv.lock` encodes solutions for all platforms and Python versions. No more maintaining separate lockfiles per OS or CI matrix entry.

3. **Workspaces enable monorepo patterns** — multiple packages share a single lockfile with guaranteed-compatible dependency versions. Workspace members reference each other via `{ workspace = true }` sources.

4. **Docker builds benefit enormously** — separating dependency installation from source code installation maximizes Docker layer caching. The `--frozen` flag ensures deterministic builds.

5. **CI caching is simple** — the `astral-sh/setup-uv` action with `enable-cache: true` gives 5-10x speedups on repeated runs.

6. **Migration is practical** — pip, Poetry, and pure-Python conda projects can all migrate incrementally. uv's pip-compatibility layer (`uv pip`) eases the transition.

### Decision Guide: uv vs Pixi vs Poetry vs pip

| Scenario | Recommended Tool | Why |
|----------|-----------------|-----|
| **New pure-Python project** | **uv** | Fastest resolver, excellent DX, modern standards |
| **Web app / microservice** | **uv** | Docker integration, CI caching, workspace support |
| **Data science (numpy, pandas, sklearn)** | **pixi** or **uv** | pixi for conda binaries; uv works if wheel-only is fine |
| **HPC / scientific computing** | **pixi** | Conda channels for MPI, CUDA, system libs; see [[pixi-hpc-usage|Using Pixi on HPC Clusters]] |
| **Mixed ecosystem (Python + R + C)** | **pixi** | Only pixi handles non-Python packages natively |
| **Legacy project with setup.py** | **uv** | Best pip compatibility layer for migration |
| **Existing Poetry project (happy with it)** | **Poetry** | Migration has a cost; only switch if hitting pain points |
| **Minimal script, no project** | **uv** | `uv run --with requests script.py` — zero setup |
| **Corporate environment with pip mandate** | **uv pip** | Drop-in pip replacement, no project restructuring needed |

Both uv and pixi represent the Rust-powered future of Python packaging. uv dominates the PyPI-only space with its PubGrub resolver and tight integration with Python standards. Pixi's rattler solver handles the broader conda+PyPI universe that scientific computing demands. Choose based on your dependency sources — if everything you need is on PyPI, uv is the faster, simpler choice. If you need conda channels for compiled scientific libraries or non-Python dependencies, pixi is the right tool.
