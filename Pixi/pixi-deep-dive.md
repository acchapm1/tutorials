---
title: "Pixi Deep Dive — Advanced Package Management, Internals & Patterns"
date: 2026-05-13
difficulty: advanced
tags: [pixi, python, package-manager, conda, environment-management, rust, advanced]
---

# Pixi Deep Dive — Advanced Package Management, Internals & Patterns

## 1. Overview

This deep dive goes well beyond the [[pixi-beginner-guide|Pixi Beginner Guide]] to cover the internals, advanced patterns, and production-grade workflows that experienced developers and scientists need when managing complex projects with Pixi. Topics include:

- **Multi-environment projects** — separate dev, test, and production environments in a single `pixi.toml`
- **Advanced dependency resolution** — how the rattler solver works, channel priority mechanics, and strategies for resolving conflicts
- **CI/CD integration** — GitHub Actions pipelines with intelligent caching, reproducible lockfile-based installs
- **Monorepo and workspace patterns** — shared dependency trees across multiple sub-projects
- **Performance tuning** — cache management, parallel downloads, and solving speed optimizations
- **Platform-specific and feature-gated dependencies** — CUDA variants, OS-specific packages, and optional feature sets
- **PyPI + conda mixing** — strategies for combining conda-forge packages with pure-Python PyPI wheels
- **Docker integration** — building minimal, reproducible container images with Pixi

Pixi is a Rust-based package and environment manager built on the conda ecosystem. Unlike traditional conda or mamba, it uses a project-centric model (similar to Cargo or npm) with a `pixi.toml` manifest and a `pixi.lock` lockfile. Under the hood, it leverages the **rattler** library for dependency resolution, package fetching, and environment creation — all written in Rust for speed.

If you are coming from [[uv-deep-dive|uv Deep Dive]], the key distinction is ecosystem scope: uv focuses on PyPI (pip-compatible resolution for pure Python), while Pixi operates on conda channels (conda-forge, bioconda, etc.) that distribute pre-compiled C, C++, Fortran, and CUDA packages. For scientific computing, HPC, and anything involving compiled native libraries, Pixi's conda integration is the primary differentiator.

---

## 2. Prerequisites

Before working through this tutorial, you should have:

- **Pixi basics** — comfortable with `pixi init`, `pixi add`, `pixi run`, and `pixi install`. If not, start with the [[pixi-beginner-guide|Pixi Beginner Guide]].
- **Conda ecosystem knowledge** — understanding of channels (conda-forge, defaults, bioconda), package naming conventions, and the difference between conda and pip packages.
- **TOML syntax** — Pixi's manifest uses TOML; familiarity with tables, arrays of tables, and inline tables is assumed.
- **Git** — lockfile workflows, merge conflict resolution, and branch-based development.
- **Basic terminal proficiency** — see [[linux-permissions-beginner-guide|Linux Permissions Beginner Guide]] if you need to review file ownership and permission concepts relevant to shared caches and HPC deployments.

You should have Pixi installed (v0.40+ recommended):

```bash
# Install or update pixi
curl -fsSL https://pixi.sh/install.sh | bash

# Verify version
pixi --version
```

```
pixi 0.41.4
```

---

## 3. Key Concepts

### 3.1 The Rattler Solver — Dependency Resolution Internals

Pixi does not use conda's classic solver or libmamba. Instead, it uses **rattler-solve**, a Rust implementation that wraps the **resolvo** SAT solver (a CDCL-based solver similar to libsolv). The resolution pipeline works as follows:

1. **Repodata fetch** — Pixi downloads and caches `repodata.json` from each configured channel. These files contain all available package metadata (name, version, build string, dependencies, constraints).
2. **Problem encoding** — The solver encodes your dependency requirements, channel priorities, and platform constraints as a SAT (Boolean satisfiability) problem.
3. **Resolution** — The SAT solver explores the solution space, using conflict-driven clause learning to prune impossible combinations efficiently.
4. **Lockfile generation** — The resolved set of packages (with exact versions, build strings, and SHA256 hashes) is written to `pixi.lock`.

Key performance characteristics:

- **Incremental solving** — When you add or remove a single dependency, Pixi re-solves from scratch but leverages cached repodata. The solve itself is fast (typically under 2 seconds for moderate dependency trees).
- **Parallel repodata fetch** — Channel metadata is downloaded concurrently across channels and platforms.
- **Repodata patching** — Pixi supports conda-forge's `current_repodata.json` (a trimmed version with only the latest builds), which dramatically reduces parse time for large channels.

### 3.2 Channel Priority and Resolution Order

Channels are searched in the order they appear in `pixi.toml`. This order is critical:

```toml
[project]
channels = ["conda-forge", "bioconda", "defaults"]
platforms = ["linux-64", "osx-arm64"]
```

The solver uses **strict channel priority** by default: if a package exists in `conda-forge`, it will never be pulled from `bioconda` or `defaults`, even if a newer version exists there. This prevents mixing ABIs from different channel ecosystems.

You can override priority per-dependency:

```toml
[dependencies]
numpy = { version = ">=1.26", channel = "conda-forge" }
special-bio-tool = { version = ">=2.0", channel = "bioconda" }
```

### 3.3 Platform-Specific Dependencies

Pixi natively supports platform-conditional dependencies using target tables:

```toml
[target.linux-64.dependencies]
cuda-toolkit = ">=12.4"

[target.osx-arm64.dependencies]
accelerate-framework = ">=1.0"

[target.win-64.dependencies]
vs2022_win-64 = ">=19.0"
```

These are resolved independently per platform. The lockfile contains separate resolution trees for each platform listed in `[project].platforms`.

### 3.4 Features and Environment Composition

Features are Pixi's mechanism for optional, composable dependency sets. Each feature can declare its own dependencies, tasks, channels, and platform targets. Environments are then composed by combining features:

```toml
[feature.cuda]
platforms = ["linux-64"]
channels = ["nvidia", "conda-forge"]

[feature.cuda.dependencies]
pytorch-cuda = ">=2.3"
cudnn = ">=9.0"

[feature.test]
[feature.test.dependencies]
pytest = ">=8.0"
pytest-cov = "*"
hypothesis = ">=6.0"

[environments]
default = { features = [], solve-group = "default" }
test = { features = ["test"], solve-group = "default" }
cuda = { features = ["cuda"], solve-group = "cuda" }
cuda-test = { features = ["cuda", "test"], solve-group = "cuda" }
```

The `solve-group` mechanism ensures that environments sharing the same solve group get a consistent set of shared dependency versions. Environments in the same solve group are solved together, preventing version drift between (for example) `cuda` and `cuda-test`.

### 3.5 The Relationship Between pixi.toml and pixi.lock

| Aspect | `pixi.toml` | `pixi.lock` |
|---|---|---|
| Purpose | Declare intent (version ranges, features) | Record exact resolution (pinned versions, hashes) |
| Edited by | Humans | Pixi (auto-generated) |
| Committed | Yes | Yes |
| Format | TOML | YAML (conda-lock compatible) |
| Platform-aware | Declares target platforms | Contains per-platform resolution trees |

The lockfile is deterministic: given the same `pixi.toml` and channel state, Pixi produces identical locks. However, channel repodata changes over time (new builds are added), so the lockfile pins the exact state at resolution time. Running `pixi update` re-solves and updates the lock.

### 3.6 PyPI Integration

Pixi can install packages from PyPI alongside conda packages. PyPI dependencies are declared separately:

```toml
[dependencies]
python = ">=3.12"
numpy = ">=1.26"

[pypi-dependencies]
my-internal-lib = { git = "https://github.com/org/my-lib.git", branch = "main" }
fastapi = ">=0.115"
```

The conda environment is resolved first, then PyPI packages are resolved against the already-installed conda packages. This two-phase approach avoids most conflicts but requires awareness of potential ABI mismatches (see Troubleshooting).

---

## 4. Step-by-Step Instructions

### 4.1 Multi-Environment Setup (Dev / Test / Prod)

Start by initializing a project and defining feature-based environments:

```bash
pixi init my-service
cd my-service
```

Edit `pixi.toml` to define a production-ready multi-environment layout:

```toml
[project]
name = "my-service"
version = "1.0.0"
channels = ["conda-forge"]
platforms = ["linux-64", "osx-arm64"]

# Core production dependencies
[dependencies]
python = ">=3.12,<3.13"
fastapi = ">=0.115"
uvicorn = ">=0.32"
sqlalchemy = ">=2.0"
pydantic = ">=2.9"

# Development tools
[feature.dev.dependencies]
ruff = ">=0.8"
mypy = ">=1.13"
ipython = ">=8.30"
pre-commit = ">=4.0"

[feature.dev.pypi-dependencies]
ipdb = ">=0.13"

# Testing dependencies
[feature.test.dependencies]
pytest = ">=8.3"
pytest-asyncio = ">=0.24"
pytest-cov = ">=6.0"
httpx = ">=0.28"

[feature.test.pypi-dependencies]
factory-boy = ">=3.3"

# Documentation
[feature.docs.dependencies]
mkdocs = ">=1.6"
mkdocs-material = ">=9.5"

# Environment composition
[environments]
default = { features = ["dev"], solve-group = "default" }
test = { features = ["dev", "test"], solve-group = "default" }
prod = { features = [], solve-group = "default" }
docs = { features = ["docs"], solve-group = "default" }
```

Install all environments and verify:

```bash
# Install all environments
pixi install --all

# List available environments
pixi project environment list
```

```
default
test
prod
docs
```

Run commands in specific environments:

```bash
# Run tests in the test environment
pixi run --environment test pytest tests/ -v

# Start the server in prod
pixi run --environment prod uvicorn main:app --host 0.0.0.0

# Build docs
pixi run --environment docs mkdocs build
```

### 4.2 Defining Tasks

Tasks are a central part of Pixi project workflows. They replace Makefiles and scripts:

```toml
[tasks]
start = "uvicorn main:app --reload"
lint = "ruff check src/"
format = "ruff format src/"
typecheck = "mypy src/"

[feature.test.tasks]
test = "pytest tests/ -v"
test-cov = "pytest tests/ --cov=src --cov-report=html"

[feature.docs.tasks]
docs-serve = "mkdocs serve"
docs-build = "mkdocs build"
```

Tasks support dependencies (execution order), `cwd` overrides, and environment variables:

```toml
[tasks]
check = { depends-on = ["lint", "typecheck"] }
ci = { depends-on = ["check", "test"] }

[tasks.migrate]
cmd = "alembic upgrade head"
env = { DATABASE_URL = "postgresql://localhost/mydb" }
```

### 4.3 Feature-Gated Platform-Specific Dependencies (CUDA Example)

For machine learning projects that need CUDA on Linux but use CPU-only on macOS:

```toml
[project]
name = "ml-training"
channels = ["conda-forge", "pytorch"]
platforms = ["linux-64", "osx-arm64"]

[dependencies]
python = ">=3.12,<3.13"
scikit-learn = ">=1.5"
pandas = ">=2.2"
matplotlib = ">=3.9"

# CPU-only PyTorch for macOS
[target.osx-arm64.dependencies]
pytorch = ">=2.5"

# CUDA feature for Linux GPU training
[feature.cuda]
platforms = ["linux-64"]
channels = ["nvidia/label/cuda-12.6.0", "pytorch", "conda-forge"]

[feature.cuda.dependencies]
pytorch-cuda = ">=2.5"
cuda-toolkit = "12.6.*"
cudnn = ">=9.0"
nccl = ">=2.23"

[feature.cuda.target.linux-64.dependencies]
nvidia-ml-py = ">=12.560"

[feature.cuda.tasks]
train-gpu = "python train.py --device cuda"

[environments]
default = { solve-group = "default" }
cuda = { features = ["cuda"], solve-group = "cuda" }
```

```bash
# On macOS — installs CPU PyTorch
pixi install

# On Linux with GPU — installs CUDA stack
pixi install --environment cuda
pixi run --environment cuda train-gpu
```

### 4.4 Workspace / Monorepo Configuration

Pixi supports workspaces for monorepo setups where multiple sub-projects share a common dependency resolution:

```
my-monorepo/
  pixi.toml          # Root workspace manifest
  packages/
    core/
      pixi.toml      # Sub-project
      src/
    api/
      pixi.toml      # Sub-project
      src/
    ml-pipeline/
      pixi.toml      # Sub-project
      src/
```

Root `pixi.toml`:

```toml
[workspace]
name = "my-monorepo"
channels = ["conda-forge"]
platforms = ["linux-64", "osx-arm64"]
members = ["packages/*"]

# Shared dependencies resolved once for the entire workspace
[dependencies]
python = ">=3.12,<3.13"
```

Sub-project `packages/core/pixi.toml`:

```toml
[project]
name = "core"
version = "0.1.0"

[dependencies]
pydantic = ">=2.9"
sqlalchemy = ">=2.0"
```

Sub-project `packages/api/pixi.toml`:

```toml
[project]
name = "api"
version = "0.1.0"

[dependencies]
fastapi = ">=0.115"
```

The workspace shares a single `pixi.lock` at the root. All sub-projects get consistent dependency versions.

### 4.5 CI/CD Pipeline Integration (GitHub Actions)

Pixi provides an official GitHub Action for CI. The key optimization is caching the Pixi environment and downloaded packages:

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  PIXI_VERSION: "v0.41.4"

jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v4

      - name: Set up Pixi
        uses: prefix-dev/setup-pixi@v0.8.8
        with:
          pixi-version: ${{ env.PIXI_VERSION }}
          environments: test
          cache: true
          # Cache key is auto-derived from pixi.lock hash

      - name: Run linting
        run: pixi run --environment test lint

      - name: Run type checking
        run: pixi run --environment test typecheck

      - name: Run tests
        run: pixi run --environment test test-cov

      - name: Upload coverage
        if: matrix.os == 'ubuntu-latest'
        uses: actions/upload-artifact@v4
        with:
          name: coverage-report
          path: htmlcov/
```

The `setup-pixi` action handles:
- Installing Pixi at the pinned version
- Caching `~/.pixi` and `.pixi/envs` keyed on `pixi.lock` hash
- Restoring cached environments on subsequent runs (skipping the solve entirely)

For faster CI on large projects, you can freeze the lockfile to prevent accidental updates:

```yaml
      - name: Install (lockfile-only, no solve)
        run: pixi install --frozen --environment test
```

The `--frozen` flag errors if `pixi.lock` is out of date with `pixi.toml`, ensuring CI never silently re-solves.

### 4.6 Docker Integration

Building Docker images with Pixi creates reproducible, self-contained environments. Use multi-stage builds to keep the final image small. For more on container patterns, see [[docker-test-container-deep-dive|Docker Test Container Deep Dive]].

```dockerfile
# Stage 1: Install dependencies
FROM ghcr.io/prefix-dev/pixi:0.41.4-jammy AS build

WORKDIR /app
COPY pixi.toml pixi.lock ./

# Install only production environment
RUN pixi install --frozen --environment prod

# Copy application code
COPY src/ ./src/

# Stage 2: Runtime image (no pixi binary needed)
FROM ubuntu:22.04 AS runtime

WORKDIR /app

# Copy the pre-built conda environment
COPY --from=build /app/.pixi/envs/prod /app/.pixi/envs/prod
COPY --from=build /app/src /app/src

# Set PATH to use the pixi environment's Python
ENV PATH="/app/.pixi/envs/prod/bin:$PATH"

EXPOSE 8000
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Build and test:

```bash
docker build -t my-service:latest .
docker run -p 8000:8000 my-service:latest
```

The key insight: the runtime image does not need Pixi installed. The resolved environment is a self-contained directory with all binaries, libraries, and Python packages.

---

## 5. Practical Examples

### 5.1 Monorepo with Shared Dependencies

A data platform monorepo where an ETL pipeline, an API server, and a dashboard share common data models:

```toml
# Root pixi.toml
[workspace]
name = "data-platform"
channels = ["conda-forge"]
platforms = ["linux-64", "osx-arm64"]
members = ["services/*", "libs/*"]

[dependencies]
python = ">=3.12,<3.13"
```

```toml
# libs/data-models/pixi.toml
[project]
name = "data-models"
version = "0.1.0"

[dependencies]
pydantic = ">=2.9"
```

```toml
# services/etl/pixi.toml
[project]
name = "etl"
version = "0.1.0"

[dependencies]
polars = ">=1.15"
duckdb = ">=1.1"
pyarrow = ">=18.0"

[pypi-dependencies]
data-models = { path = "../../libs/data-models", editable = true }
```

All services share the same Python version and get consistent versions of any overlapping transitive dependencies.

### 5.2 ML Project with CUDA Variants

A training pipeline that needs different GPU configurations:

```toml
[project]
name = "training-pipeline"
channels = ["conda-forge"]
platforms = ["linux-64"]

[dependencies]
python = ">=3.12,<3.13"
pandas = ">=2.2"
mlflow = ">=2.18"
wandb = ">=0.19"

[feature.cuda12]
channels = ["nvidia/label/cuda-12.6.0", "pytorch", "conda-forge"]
[feature.cuda12.dependencies]
pytorch-cuda = { version = ">=2.5", channel = "pytorch" }
cuda-toolkit = "12.6.*"

[feature.rocm]
channels = ["rocm", "conda-forge"]
[feature.rocm.dependencies]
pytorch-rocm = ">=2.5"
rocm-smi-lib = ">=6.0"

[environments]
cuda = { features = ["cuda12"] }
rocm = { features = ["rocm"] }
```

```bash
# NVIDIA GPU cluster
pixi run --environment cuda python train.py

# AMD GPU cluster
pixi run --environment rocm python train.py
```

### 5.3 Cross-Platform Project (Linux + macOS + Windows)

A CLI tool that needs platform-specific system libraries:

```toml
[project]
name = "data-cli"
channels = ["conda-forge"]
platforms = ["linux-64", "osx-arm64", "win-64"]

[dependencies]
python = ">=3.12,<3.13"
click = ">=8.1"
rich = ">=13.9"
httpx = ">=0.28"

[target.linux-64.dependencies]
openssl = ">=3.4"

[target.osx-arm64.dependencies]
openssl = ">=3.4"

[target.win-64.dependencies]
openssl = ">=3.4"
win_inet_pton = ">=1.1"
```

The lockfile will contain three separate resolution trees. CI can test all three via the matrix strategy shown in section 4.5.

### 5.4 CI Pipeline with Advanced Caching

For large projects where environment creation is slow, use layered caching:

```yaml
# .github/workflows/ci-optimized.yml
name: CI (Optimized)

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Pixi
        uses: prefix-dev/setup-pixi@v0.8.8
        with:
          pixi-version: "v0.41.4"
          environments: test
          cache: true

      # Additional cache for pip wheel builds (PyPI deps)
      - name: Cache pip wheels
        uses: actions/cache@v4
        with:
          path: ~/.cache/pip
          key: pip-${{ runner.os }}-${{ hashFiles('pixi.lock') }}

      - name: Run tests
        run: pixi run --environment test test-cov

      - name: Enforce lockfile freshness
        run: |
          pixi install --environment test
          git diff --exit-code pixi.lock || \
            (echo "ERROR: pixi.lock is stale. Run 'pixi install' locally." && exit 1)
```

### 5.5 HPC Deployment Pattern

Deploying Pixi on shared HPC clusters requires careful attention to file paths and permissions. For more context, see [[pixi-hpc-usage|Using Pixi on HPC Clusters]] and [[linux-permissions-beginner-guide|Linux Permissions Beginner Guide]].

On HPC systems, home directories often have strict quotas. Redirect the Pixi cache to a scratch filesystem:

```bash
# In your .bashrc or job script
export PIXI_HOME="/scratch/$USER/.pixi"
export PIXI_CACHE_DIR="/scratch/$USER/.pixi/cache"
```

For shared team environments, use a group-readable cache:

```bash
# One team member creates the shared environment
pixi install --frozen --environment prod

# Set group permissions for the team
chmod -R g+rX .pixi/envs/prod/
```

SLURM job script example:

```bash
#!/bin/bash
#SBATCH --job-name=training
#SBATCH --partition=gpu
#SBATCH --gres=gpu:a100:4
#SBATCH --time=24:00:00

export PIXI_HOME="/scratch/$USER/.pixi"

cd /projects/my-team/training-pipeline

# Use --frozen so the job never re-solves
pixi run --frozen --environment cuda python train.py \
  --num-gpus 4 \
  --batch-size 256
```

When connecting to HPC clusters remotely, [[mosh-deep-dive|Mosh Deep Dive]] covers persistent terminal connections that survive network interruptions during long training runs.

---

## 6. Hands-On Exercises

### Exercise 1: Multi-Environment Project Setup

**Goal:** Create a project with `default`, `test`, and `docs` environments that share consistent dependency versions.

1. Initialize a new project: `pixi init multi-env-exercise`
2. Add core dependencies: `python >=3.12`, `httpx`, `pydantic`
3. Create a `test` feature with `pytest`, `pytest-cov`, and `hypothesis`
4. Create a `docs` feature with `mkdocs` and `mkdocs-material`
5. Define environments using `solve-group = "default"` for all three
6. Add tasks: `test` (runs pytest), `docs-serve` (runs mkdocs serve)
7. Install all environments: `pixi install --all`
8. Verify each environment has the correct packages: `pixi list --environment test`

**Verification:**

```bash
pixi list --environment test | grep pytest
```

Expected output should show pytest and its dependencies installed only in the test environment.

### Exercise 2: Platform-Specific CUDA Dependencies

**Goal:** Configure a project that uses CUDA on Linux and MPS (Metal) acceleration on macOS.

1. Create a project targeting `linux-64` and `osx-arm64`
2. Add shared dependencies: `python`, `numpy`, `scipy`
3. Add a `cuda` feature with `cuda-toolkit` and `pytorch-cuda`, restricted to `linux-64`
4. Add `pytorch` (CPU/MPS) for `osx-arm64` as a target dependency
5. Define a `cuda` environment and a `default` environment
6. Test resolution: `pixi install --all`
7. Verify the lockfile contains different PyTorch builds per platform

```bash
# Inspect the lockfile for platform-specific packages
grep -A2 "pytorch" pixi.lock | head -20
```

### Exercise 3: CI Pipeline Creation

**Goal:** Write a GitHub Actions workflow that tests your project on Linux, macOS, and Windows.

1. Use the `prefix-dev/setup-pixi` action
2. Enable caching keyed on `pixi.lock`
3. Use `--frozen` to prevent re-solves in CI
4. Run lint, typecheck, and test tasks
5. Add a step that verifies `pixi.lock` is not stale

### Exercise 4: Cache Optimization for Team Sharing

**Goal:** Set up a shared cache directory for a team of developers.

1. Configure `PIXI_CACHE_DIR` to point to a shared network drive
2. Pre-populate the cache by running `pixi install` on the team's main projects
3. Verify that a teammate's `pixi install` uses cached packages (observe download counts)
4. Document the cache structure:

```bash
ls -la $PIXI_CACHE_DIR/
```

Expected structure:

```
pkgs/       # Downloaded .conda and .tar.bz2 archives
repodata/   # Cached channel metadata
```

---

## 7. Troubleshooting

### 7.1 Solver Conflicts Between Conda and PyPI

**Symptom:** `pixi install` succeeds, but importing a package at runtime raises `ImportError` or symbol errors.

**Cause:** A PyPI package was installed that provides a different build of a library already installed via conda (e.g., `numpy` from conda-forge vs. `numpy` from PyPI). The two may have incompatible ABIs.

**Fix:** Always prefer the conda version for packages available on conda-forge. Only use `[pypi-dependencies]` for packages not on conda. If a PyPI package depends on `numpy`, ensure `numpy` is in `[dependencies]` (conda) so the PyPI resolver sees it as already satisfied:

```toml
[dependencies]
numpy = ">=1.26"   # Conda version — has correct ABI

[pypi-dependencies]
some-pure-python-lib = ">=1.0"  # This will use the conda numpy
```

### 7.2 Platform Mismatch Errors

**Symptom:** `pixi install` fails with messages about packages not being available for your platform.

```
× No solution found for the following environments: default
╰─▶ ... package foo-1.2.3 not available for osx-arm64
```

**Fix:** Check if the package exists for your platform on conda-forge. If not, either:
- Move it to a target-specific section so it is only required on platforms where it exists
- Use the PyPI version as a fallback on unsupported platforms

```toml
[target.linux-64.dependencies]
linux-only-package = ">=1.0"

[target.osx-arm64.pypi-dependencies]
linux-only-package = ">=1.0"   # Fallback to PyPI wheel if available
```

### 7.3 Lockfile Merge Conflicts

**Symptom:** Git merge conflicts in `pixi.lock` after merging branches where both modified dependencies.

**Fix:** Do not attempt to manually resolve `pixi.lock` conflicts. Instead:

```bash
# Accept either version of the lockfile
git checkout --theirs pixi.lock   # or --ours

# Re-solve to get a correct lockfile
pixi install

# Stage the fresh lockfile
git add pixi.lock
git commit
```

The lockfile is auto-generated, so the correct approach is always to regenerate it from the merged `pixi.toml`.

### 7.4 Cache Corruption

**Symptom:** `pixi install` fails with hash verification errors or corrupted package archives.

```
× Package verification failed: SHA256 mismatch for numpy-1.26.4-...
```

**Fix:** Clear the package cache and reinstall:

```bash
# Remove the cached package directory
pixi clean cache

# Force a fresh install
pixi install
```

If using a shared cache on a network filesystem, check for interrupted writes (e.g., from killed jobs on HPC clusters) and ensure only one process writes to the cache at a time.

### 7.5 Slow Solves with Large Dependency Trees

**Symptom:** `pixi install` takes more than 30 seconds on a project with many dependencies.

**Causes and fixes:**

1. **Large repodata** — The `defaults` channel has enormous repodata. Remove it if you only need conda-forge:

```toml
channels = ["conda-forge"]   # Not ["defaults", "conda-forge"]
```

2. **Too many platforms** — Each platform multiplies solve time. Only list platforms you actually target:

```toml
platforms = ["linux-64", "osx-arm64"]   # Not all 4+ platforms
```

3. **Unconstrained versions** — Wildcard versions (`*`) give the solver maximum freedom but also maximum work. Add lower bounds:

```toml
numpy = ">=1.26"   # Better than numpy = "*"
```

4. **Many features with separate solve groups** — Each solve group is an independent solve. Use shared solve groups where possible:

```toml
[environments]
dev = { features = ["dev"], solve-group = "default" }
test = { features = ["dev", "test"], solve-group = "default" }
# ^ Same solve group = solved together = faster than separate solves
```

### 7.6 pixi.toml Validation Errors

**Symptom:** Pixi rejects your `pixi.toml` with schema errors.

**Fix:** Validate your TOML syntax. Common mistakes:

```toml
# WRONG: using a list where a string is expected
python = [">=3.12"]

# RIGHT
python = ">=3.12"

# WRONG: missing quotes around version constraint
numpy = >=1.26

# RIGHT
numpy = ">=1.26"
```

Use `pixi project validate` (if available in your version) or check the Pixi documentation for the current schema.

### 7.7 Environment Activation Issues

**Symptom:** `pixi shell` or `pixi run` doesn't pick up the expected environment.

**Fix:** Pixi environments are directory-scoped. Ensure you are in the project directory (or a subdirectory of it):

```bash
# This won't work if you're outside the project
cd /some/random/dir
pixi run python   # Error: no pixi.toml found

# Navigate to the project first
cd /path/to/my-project
pixi run python   # Works — uses the default environment
```

For explicit control:

```bash
pixi run --manifest-path /path/to/my-project/pixi.toml --environment test pytest
```

---

## 8. References

### Official Documentation
- **Pixi documentation** — [https://pixi.sh/latest/](https://pixi.sh/latest/)
- **Pixi configuration reference** — [https://pixi.sh/latest/reference/pixi_manifest/](https://pixi.sh/latest/reference/pixi_manifest/)
- **Pixi CLI reference** — [https://pixi.sh/latest/reference/cli/](https://pixi.sh/latest/reference/cli/)

### Source Code and Development
- **Pixi GitHub** — [https://github.com/prefix-dev/pixi](https://github.com/prefix-dev/pixi)
- **Rattler (solver library)** — [https://github.com/conda/rattler](https://github.com/conda/rattler)
- **Resolvo (SAT solver)** — [https://github.com/mamba-org/resolvo](https://github.com/mamba-org/resolvo)
- **Pixi GitHub Discussions** — [https://github.com/prefix-dev/pixi/discussions](https://github.com/prefix-dev/pixi/discussions)

### Ecosystem
- **conda-forge documentation** — [https://conda-forge.org/docs/](https://conda-forge.org/docs/)
- **conda-forge packages** — [https://prefix.dev](https://prefix.dev) (search interface for conda channels)
- **setup-pixi GitHub Action** — [https://github.com/prefix-dev/setup-pixi](https://github.com/prefix-dev/setup-pixi)

### Comparisons
- **Pixi vs Conda vs Mamba** — [https://pixi.sh/latest/switching_from/conda/](https://pixi.sh/latest/switching_from/conda/)
- **uv documentation** — [https://docs.astral.sh/uv/](https://docs.astral.sh/uv/) — see also [[uv-beginner-guide|uv Beginner Guide]] and [[uv-deep-dive|uv Deep Dive]]

---

## Related Tutorials

The following notes provide complementary context and related workflows:

- [[pixi-beginner-guide|Pixi Beginner Guide]] — start here if you are new to Pixi; covers installation, basic commands, and first project setup
- [[uv-beginner-guide|uv Beginner Guide]] — introduction to Astral's uv, the PyPI-focused alternative to Pixi
- [[uv-deep-dive|uv Deep Dive]] — advanced uv reference covering resolution strategies, workspaces, and performance; useful for comparing approaches with Pixi
- [[pixi-hpc-usage|Using Pixi on HPC Clusters]] — specific guidance for deploying Pixi environments on SLURM-managed HPC clusters, shared filesystems, and module systems
- [[docker-test-container-deep-dive|Docker Test Container Deep Dive]] — patterns for containerizing environments, relevant to section 4.6 of this tutorial
- [[linux-permissions-beginner-guide|Linux Permissions Beginner Guide]] — essential background for shared cache directories and HPC group permissions
- [[mosh-deep-dive|Mosh Deep Dive]] — persistent remote terminal connections for long-running HPC jobs and remote development

---

## 9. Summary

### Key Advanced Takeaways

1. **The rattler solver** is a Rust-native SAT solver that operates on conda repodata. It is fast, deterministic, and supports strict channel priority. Understanding its resolution pipeline helps you diagnose and prevent dependency conflicts.

2. **Features and environments** are Pixi's composition model. Use features to group optional dependencies (CUDA, testing, docs) and environments to combine them. Solve groups keep shared dependencies consistent across related environments.

3. **The lockfile is sacred in CI.** Always use `--frozen` in CI pipelines to prevent re-solves. Cache the `.pixi` directory keyed on the lockfile hash. Verify lockfile freshness as a CI step.

4. **Platform-specific dependencies** are first-class citizens. Use `[target.<platform>.dependencies]` for OS-specific packages and feature-gated platform restrictions for GPU variants.

5. **PyPI mixing requires discipline.** Install compiled libraries (numpy, scipy, pandas) from conda-forge for correct ABIs. Reserve `[pypi-dependencies]` for pure-Python packages and internal Git dependencies.

6. **Workspaces enable monorepos.** A root `pixi.toml` with `[workspace]` coordinates dependency resolution across sub-projects, producing a single lockfile with consistent versions.

7. **Docker multi-stage builds** let you ship Pixi-resolved environments without the Pixi binary. The environment directory is self-contained.

8. **HPC deployments** need cache redirection (`PIXI_CACHE_DIR`), group permissions on shared environments, and `--frozen` in job scripts to avoid solver runs on compute nodes.

### When to Use Pixi vs uv vs Conda

| Scenario | Recommended Tool | Rationale |
|---|---|---|
| Scientific computing with C/Fortran libs | **Pixi** | Conda-forge provides pre-built binaries for numpy, scipy, HDF5, MPI, etc. |
| HPC clusters with GPU workloads | **Pixi** | Native CUDA toolkit, cuDNN, NCCL from conda channels. See [[pixi-hpc-usage|Using Pixi on HPC Clusters]]. |
| Cross-platform compiled dependencies | **Pixi** | Conda packages cover Linux, macOS, and Windows with consistent ABIs |
| Pure Python web projects | **uv** | Faster for PyPI-only resolution; simpler setup. See [[uv-deep-dive|uv Deep Dive]]. |
| Monorepo with mixed languages | **Pixi** | Workspace support with conda packages for non-Python deps (R, Julia, system libs) |
| Quick script or small CLI tool | **uv** | Lower overhead; `uv run script.py` with inline deps is very convenient |
| Legacy conda environments | **Pixi** | Drop-in migration from `environment.yml` via `pixi init --import` |
| Team standardization on PyPI only | **uv** | If you never need conda packages, uv's pip-compatible model is simpler |

The tools are complementary, not competing. Many teams use Pixi for ML/science workloads and uv for web services within the same organization. Choose based on whether your dependency tree requires conda-forge's compiled package ecosystem.
