---
title: "Pixi Beginner Guide — Fast Python & Conda Package Management"
date: 2026-05-13
difficulty: beginner
tags: [pixi, python, package-manager, conda, environment-management, rust]
---

# Pixi Beginner Guide — Fast Python & Conda Package Management

## 1. Overview

**Pixi** is a modern, cross-platform package manager and project environment tool built in Rust. It manages both **conda** and **PyPI** packages in a single workflow, giving you the best of both worlds: access to the massive conda-forge ecosystem of pre-compiled scientific libraries *and* the full breadth of the Python Package Index (PyPI).

### Why Pixi Matters

If you have ever struggled with any of the following, Pixi was designed for you:

- Juggling `conda`, `mamba`, `pip`, and `poetry` across different projects
- Waiting minutes for conda to "solve" an environment
- Sharing a project only to hear "it doesn't work on my machine"
- Installing compiled scientific packages (numpy, scipy, GDAL) and hitting build errors with pip

Pixi replaces all of those tools with a single binary. It is **fast** (Rust-powered dependency solving), **reproducible** (lockfile-based), and **cross-platform** (macOS, Linux, Windows).

### How Pixi Compares to Other Tools

| Feature | Pixi | uv | conda/mamba | pip + venv | poetry |
|---|---|---|---|---|---|
| Conda packages | Yes | No | Yes | No | No |
| PyPI packages | Yes | Yes | Limited | Yes | Yes |
| Lockfile | Yes | Yes | Partial | No | Yes |
| Task runner | Yes | No | No | No | Yes (scripts) |
| Speed | Very fast | Fastest (PyPI) | Slow/Fast | Medium | Medium |
| Global tool install | Yes | Yes | Yes | pipx | No |

A key distinction: [[uv-beginner-guide|uv Beginner Guide]] covers uv, which is an excellent choice for **pure Python** projects. But if your work involves compiled scientific packages from conda-forge (think numpy with MKL, GDAL, R packages, or CUDA toolkits), Pixi is the better fit because it can pull those pre-built binaries directly from conda channels. For a deeper comparison, see [[uv-deep-dive|uv Deep Dive]].

### What You Will Learn

By the end of this tutorial you will be able to:

- Install Pixi on your system
- Create and manage project environments
- Add packages from both conda-forge and PyPI
- Define and run project tasks
- Share reproducible environments with collaborators
- Use Pixi for global tool installations

---

## 2. Prerequisites

This guide assumes you have:

- **Basic terminal/command-line familiarity** — you know how to open a terminal, navigate directories with `cd`, and run commands. If you need a refresher on file permissions when working in the terminal, see [[linux-permissions-beginner-guide|Linux Permissions Beginner Guide]].
- **Some Python experience** — you have written or edited Python scripts before, even if just simple ones.

You do **not** need:

- Prior experience with conda, mamba, pip, poetry, or any package manager
- An existing Python installation (Pixi will manage Python for you)
- Administrator/root access on your machine

> **Note:** If you are working on a remote server or HPC cluster, check out [[pixi-hpc-usage|Using Pixi on HPC Clusters]] for cluster-specific guidance. For reliable remote connections while working, [[mosh-beginner-guide|Mosh Beginner Guide]] covers an alternative to SSH that handles intermittent connections well.

---

## 3. Key Concepts

Before diving into commands, let's establish the vocabulary Pixi uses.

### Projects vs Global Tools

Pixi operates in two modes:

- **Project mode** — you create a project directory with a manifest file (`pixi.toml`) that declares all dependencies, tasks, and configuration. This is the primary way to use Pixi.
- **Global mode** — you install command-line tools (like `ruff`, `black`, or `jupyter`) system-wide so they are available everywhere, similar to `pipx` or `uv tool install`.

### The Manifest: `pixi.toml`

Every Pixi project has a `pixi.toml` file at its root. This is the single source of truth for your project. It declares:

- Project metadata (name, version, description)
- Which channels to pull conda packages from
- Which platforms to support
- All dependencies (conda and PyPI)
- Tasks (named commands you can run)
- Environments (named dependency groups)

Think of it as `pyproject.toml` (poetry) + `environment.yml` (conda) + a `Makefile`, combined into one file.

### The Lockfile: `pixi.lock`

When you add or change dependencies, Pixi solves the full dependency tree and writes the exact versions of every package (and every transitive dependency) to `pixi.lock`. This file guarantees that anyone who clones your project gets *exactly* the same packages you have.

**Always commit `pixi.lock` to version control.** This is what makes your project reproducible.

### Channels

Channels are package repositories. The most common one is **conda-forge**, a community-maintained collection of thousands of pre-built packages. When you run `pixi init`, conda-forge is added as the default channel.

You can also use:

- `bioconda` for bioinformatics tools
- `nvidia` for CUDA packages
- Private channels hosted by your organization

### Environments

A Pixi project can define multiple named environments. For example:

- A `default` environment with your core dependencies
- A `test` environment that adds `pytest`
- A `docs` environment that adds `sphinx`

This keeps concerns separated without duplicating configuration.

### Tasks

Tasks are named commands defined in `pixi.toml`. Instead of remembering long commands, you define them once and run them with `pixi run <task-name>`. Tasks can depend on other tasks, forming a simple build pipeline.

### Conda Packages vs PyPI Packages

Pixi can install packages from two sources:

- **Conda packages** (from conda-forge or other channels) — these are pre-compiled for your platform and can include non-Python libraries (C, C++, Fortran, CUDA). This is why scientific packages install so much faster and more reliably through conda.
- **PyPI packages** — the standard Python package index. Pixi uses these as a fallback when a package is not available on conda-forge, or when you specifically need the PyPI version.

You declare them differently in `pixi.toml`:

```toml
[dependencies]
numpy = ">=1.26"          # This comes from conda-forge

[pypi-dependencies]
some-niche-library = "*"  # This comes from PyPI
```

---

## 4. Step-by-Step Instructions

### Step 1: Install Pixi

Pixi is distributed as a single static binary. No Python or conda installation is required first.

**macOS and Linux:**

```bash
curl -fsSL https://pixi.sh/install.sh | bash
```

Expected output:

```
info: downloading pixi 0.44.0 for darwin-arm64
info: installed pixi to /Users/you/.pixi/bin/pixi
info: updated shell profile /Users/you/.zshrc

Please restart your terminal or run:
  source ~/.zshrc
```

**Windows (PowerShell):**

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://pixi.sh/install.ps1 | iex"
```

**Verify the installation:**

```bash
pixi --version
```

Expected output:

```
pixi 0.44.0
```

> **Tip:** If you see `command not found`, restart your terminal or run `source ~/.bashrc` (or `source ~/.zshrc` on macOS) to pick up the updated PATH.

### Step 2: Create Your First Project

Navigate to where you keep your projects and initialize a new one:

```bash
mkdir my-first-pixi-project
cd my-first-pixi-project
pixi init
```

Expected output:

```
 Created /Users/you/my-first-pixi-project/pixi.toml
```

Let's look at what was created:

```bash
cat pixi.toml
```

```toml
[project]
name = "my-first-pixi-project"
version = "0.1.0"
description = "Add a short description here"
authors = ["Your Name <you@example.com>"]
channels = ["conda-forge"]
platforms = ["osx-arm64"]

[tasks]

[dependencies]
```

This is your project manifest. Notice that `conda-forge` is already set as the default channel, and your current platform has been auto-detected.

### Step 3: Add Packages

Add Python and a package to your project:

```bash
pixi add python=3.12 requests
```

Expected output:

```
 Added python 3.12.*
 Added requests >=2.32.3, <2.33
```

Pixi solved the environment and updated both `pixi.toml` and `pixi.lock`. Look at the dependencies section now:

```bash
grep -A 5 "\[dependencies\]" pixi.toml
```

```toml
[dependencies]
python = "3.12.*"
requests = ">=2.32.3, <2.33"
```

To add a PyPI-only package, use the `--pypi` flag:

```bash
pixi add --pypi httpx
```

```
 Added httpx >=0.28.1, <0.29
```

This adds the package under `[pypi-dependencies]` in your manifest.

### Step 4: Run Commands in the Environment

Use `pixi run` to execute any command inside the project environment:

```bash
pixi run python --version
```

```
Python 3.12.8
```

```bash
pixi run python -c "import requests; print(requests.__version__)"
```

```
2.32.3
```

The first time you run a command, Pixi will install all packages (this may take a moment). Subsequent runs are near-instant because the environment is cached.

### Step 5: Activate the Shell

If you want an interactive session inside the environment (like `conda activate`), use:

```bash
pixi shell
```

```
 Activated environment default
(my-first-pixi-project) $
```

Now every command you type uses the project's Python and packages. Type `exit` to leave the shell.

> **Difference from conda:** With conda you run `conda activate myenv`. With Pixi, environments are project-local, so you just `cd` into your project and run `pixi shell`. No global environment names to remember.

### Step 6: Define Tasks

Open `pixi.toml` and add tasks:

```toml
[tasks]
start = "python main.py"
fmt = "ruff format ."
lint = "ruff check ."
check = { depends-on = ["fmt", "lint"] }
```

Now create a simple `main.py`:

```bash
echo 'print("Hello from Pixi!")' > main.py
```

Add ruff as a development dependency and run your task:

```bash
pixi add ruff
pixi run start
```

```
Hello from Pixi!
```

Run the composite task:

```bash
pixi run check
```

This runs `fmt` first, then `lint`, because `check` depends on both. Tasks are one of Pixi's most underrated features — they replace `Makefile` targets, npm scripts, and `poetry run` commands with a built-in, cross-platform solution.

---

## 5. Practical Examples

### Example 1: Data Science Project

Set up a data science project with the scientific Python stack:

```bash
mkdir data-analysis && cd data-analysis
pixi init
pixi add python=3.12 numpy pandas matplotlib jupyter scikit-learn
```

Add a task to launch Jupyter:

```toml
[tasks]
notebook = "jupyter notebook"
lab = "jupyter lab"
```

```bash
pixi run lab
```

This installs numpy, pandas, and scikit-learn from **conda-forge** with optimized BLAS libraries — something that would require manual configuration with pip. This is where Pixi shines compared to [[uv-beginner-guide|uv Beginner Guide]] workflows: uv would need you to compile these from source or use pre-built wheels, while Pixi pulls fully optimized binaries from conda-forge.

### Example 2: Web Development Project

```bash
mkdir web-app && cd web-app
pixi init
pixi add python=3.12
pixi add --pypi fastapi uvicorn[standard] sqlalchemy
```

Define tasks in `pixi.toml`:

```toml
[tasks]
dev = "uvicorn app.main:app --reload --port 8000"
test = "pytest tests/ -v"
migrate = "alembic upgrade head"
```

```bash
pixi run dev
```

```
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
INFO:     Started reloader process [12345]
```

For web projects that are pure Python, you could also use uv. But if your project later needs compiled dependencies (like `psycopg2` with system-level PostgreSQL libraries), having Pixi already in place saves a painful migration.

### Example 3: Global Tools

Install command-line tools available everywhere, not tied to any project:

```bash
pixi global install ruff
pixi global install black
pixi global install jupyter
```

```
 Installed ruff 0.9.4 to ~/.pixi/bin/ruff
```

Now `ruff`, `black`, and `jupyter` are available in any terminal session. This is similar to `pipx install` or `uv tool install`, but pulls from conda-forge instead of PyPI.

### Example 4: Reproducing a Colleague's Environment

Your colleague shares their project repository. To get their exact environment:

```bash
git clone https://github.com/colleague/cool-project.git
cd cool-project
pixi install
```

```
 Installed 142 packages in 8.3s
```

That's it. The `pixi.lock` file in the repository ensures you get the exact same package versions your colleague used. No `environment.yml` to manually recreate, no version conflicts, no "works on my machine" problems.

If you want to run their analysis:

```bash
pixi run analysis
```

The task is already defined in their `pixi.toml`. Compare this to the traditional conda workflow:

```bash
# Old way (conda) — multiple steps, often fails
conda env create -f environment.yml
conda activate cool-project
python run_analysis.py
```

### Example 5: Mixed Conda + PyPI Dependencies

Some projects need packages from both ecosystems. For instance, a bioinformatics pipeline might need conda packages for compiled tools and PyPI packages for niche libraries:

```bash
pixi init bio-pipeline
cd bio-pipeline
pixi add python=3.12 samtools bedtools numpy
pixi add --pypi pysam gffutils
```

The resulting `pixi.toml`:

```toml
[dependencies]
python = "3.12.*"
samtools = ">=1.21, <2"
bedtools = ">=2.31.1, <3"
numpy = ">=2.2.2, <3"

[pypi-dependencies]
pysam = ">=0.22.1, <0.23"
gffutils = ">=0.13, <0.14"
```

Pixi resolves all of these together, ensuring there are no conflicts between conda and PyPI packages.

---

## 6. Hands-On Exercises

### Exercise 1: Create a Project from Scratch

1. Create a new directory called `pixi-practice`
2. Initialize it with `pixi init`
3. Add Python 3.12 and the `rich` library
4. Create a file `hello.py` that uses Rich to print a styled table
5. Define a task called `hello` that runs your script
6. Run it with `pixi run hello`

<details>
<summary>Solution</summary>

```bash
mkdir pixi-practice && cd pixi-practice
pixi init
pixi add python=3.12 rich
```

Create `hello.py`:

```python
from rich.table import Table
from rich.console import Console

console = Console()
table = Table(title="My Pixi Project")

table.add_column("Tool", style="cyan")
table.add_column("Purpose", style="green")

table.add_row("pixi", "Package & environment manager")
table.add_row("rich", "Beautiful terminal output")

console.print(table)
```

Add to `pixi.toml`:

```toml
[tasks]
hello = "python hello.py"
```

```bash
pixi run hello
```

</details>

### Exercise 2: Mixed Dependencies

1. Create a new project called `mixed-deps`
2. Add `pandas` from conda-forge
3. Add `plotly` from PyPI (`pixi add --pypi plotly`)
4. Write a script that creates a simple Plotly chart from a pandas DataFrame
5. Run it as a task

### Exercise 3: Task Chains

1. In any project, define three tasks:
   - `clean` — removes `__pycache__` directories (`find . -type d -name __pycache__ -exec rm -rf {} +`)
   - `test` — runs `pytest`
   - `ci` — depends on `clean` then `test`
2. Add `pytest` as a dependency
3. Create a trivial test file and run `pixi run ci`

### Exercise 4: Share Your Environment

1. Initialize a git repository in one of your Pixi projects
2. Commit `pixi.toml` and `pixi.lock` (and your source code)
3. Clone it to a different directory
4. Run `pixi install` in the clone and verify everything works

This exercise demonstrates the core reproducibility guarantee that makes Pixi valuable for team collaboration.

---

## 7. Troubleshooting

### "command not found: pixi"

Your shell has not picked up the PATH change from the installer.

```bash
# For bash
source ~/.bashrc

# For zsh (macOS default)
source ~/.zshrc

# Verify
which pixi
```

If it still fails, check that `~/.pixi/bin` is in your PATH:

```bash
echo $PATH | tr ':' '\n' | grep pixi
```

### Solve Failures

If `pixi add` fails with a solve error:

```
 Could not solve environment. The following packages are incompatible...
```

**Common causes:**

- You are requesting incompatible version ranges. Try relaxing the version constraint (e.g., `pixi add "numpy>=1.24"` instead of `numpy=1.24.0`).
- A PyPI package conflicts with a conda package. Try installing it from the other source.
- Your platform is not supported by a package. Check if the package supports your OS/architecture on conda-forge.

### PyPI vs Conda Conflicts

If you see errors about packages existing in both conda and PyPI:

```
 The following packages are available from both conda and PyPI...
```

**Solution:** Pick one source. Prefer conda-forge for packages that have compiled components. Use PyPI for packages only available there.

### Slow First Install

The very first `pixi install` or `pixi run` in a project downloads and caches all packages. This can take a few minutes for large environments. Subsequent operations are fast because Pixi caches packages globally in `~/.pixi`.

To see what is happening during a slow install:

```bash
pixi install -v
```

### "Environment already exists" or Stale Environments

If your environment seems out of sync:

```bash
pixi install --force
```

This re-solves and reinstalls everything from scratch.

### Pixi Inside Docker

If you are building Docker images with Pixi, you can use the official install script in your Dockerfile. For broader container guidance, see [[docker-test-container-beginner-guide|Docker Test Container Beginner Guide]].

```dockerfile
FROM ubuntu:24.04
RUN apt-get update && apt-get install -y curl
RUN curl -fsSL https://pixi.sh/install.sh | bash
ENV PATH="/root/.pixi/bin:${PATH}"
COPY pixi.toml pixi.lock ./
RUN pixi install
COPY . .
CMD ["pixi", "run", "start"]
```

---

## 8. References

- **Official documentation:** [https://pixi.sh](https://pixi.sh) — comprehensive docs with guides and API reference
- **GitHub repository:** [https://github.com/prefix-dev/pixi](https://github.com/prefix-dev/pixi) — source code, issues, and release notes
- **conda-forge:** [https://conda-forge.org](https://conda-forge.org) — the primary package channel Pixi uses
- **Pixi configuration reference:** [https://pixi.sh/latest/reference/pixi_manifest/](https://pixi.sh/latest/reference/pixi_manifest/) — full manifest specification
- **prefix.dev:** [https://prefix.dev](https://prefix.dev) — the company behind Pixi, also hosts a package search
- **Pixi vs other tools:** [https://pixi.sh/latest/switching_from/conda/](https://pixi.sh/latest/switching_from/conda/) — official migration guides from conda, poetry, and others

---

## Related Tutorials

Explore these related guides to deepen your understanding:

- [[pixi-deep-dive|Pixi Deep Dive]] — the advanced companion to this guide, covering multi-environment setups, custom channels, CI/CD integration, and advanced task configuration
- [[uv-beginner-guide|uv Beginner Guide]] — if your project is pure Python (no compiled conda dependencies), uv is an excellent alternative with even faster PyPI resolution
- [[uv-deep-dive|uv Deep Dive]] — advanced uv usage including workspaces, build backends, and tool management
- [[pixi-hpc-usage|Using Pixi on HPC Clusters]] — specific guidance for running Pixi on shared HPC systems with module systems, job schedulers, and shared filesystems
- [[docker-test-container-beginner-guide|Docker Test Container Beginner Guide]] — using Pixi inside Docker containers for reproducible builds and CI
- [[linux-permissions-beginner-guide|Linux Permissions Beginner Guide]] — understanding file permissions, relevant when installing Pixi or troubleshooting PATH issues
- [[mosh-beginner-guide|Mosh Beginner Guide]] — reliable remote connections for working on servers where you use Pixi (also covers conda/mamba installation comparisons)

---

## 9. Summary

### Key Takeaways

1. **Pixi is a single tool that replaces conda + mamba + pip + venv + make.** It manages both conda and PyPI packages in one workflow with a fast Rust-based solver.

2. **The `pixi.toml` manifest is your project's single source of truth.** It declares dependencies, tasks, environments, and metadata in one readable file.

3. **The `pixi.lock` lockfile guarantees reproducibility.** Commit it to version control so collaborators and CI systems get exactly the same packages.

4. **Conda-forge packages are preferred for scientific computing.** Pre-compiled binaries for numpy, pandas, scipy, GDAL, and thousands of other packages install in seconds without build errors.

5. **PyPI packages fill the gaps.** When a package is not on conda-forge, add it with `pixi add --pypi`.

6. **Tasks replace Makefiles and scripts.** Define named commands in `pixi.toml` with dependency chains for clean, repeatable workflows.

7. **Global installs work like pipx.** Use `pixi global install` for command-line tools you want available everywhere.

### When to Choose Pixi vs Other Tools

- **Choose Pixi** when your project uses compiled scientific packages (numpy, scipy, GDAL, samtools), needs cross-language dependencies (R, C++, CUDA), or you want conda + PyPI in one tool.
- **Choose uv** when your project is pure Python with no need for conda packages. uv is faster for PyPI-only resolution and has excellent pip compatibility. See [[uv-beginner-guide|uv Beginner Guide]].
- **Choose conda/mamba** if your organization mandates it or you need Anaconda-channel-specific packages. But consider migrating to Pixi for the speed and lockfile benefits.

### Next Steps

- Read the [[pixi-deep-dive|Pixi Deep Dive]] for multi-environment configurations, workspace support, and advanced task features
- Explore [[pixi-hpc-usage|Using Pixi on HPC Clusters]] if you work on shared computing systems
- Try converting an existing conda `environment.yml` project to Pixi using `pixi init --import environment.yml`
- Browse available packages at [https://prefix.dev](https://prefix.dev)

### Quick Reference Card

```bash
# Install pixi
curl -fsSL https://pixi.sh/install.sh | bash

# Project workflow
pixi init                        # Create a new project
pixi add python=3.12 numpy       # Add conda packages
pixi add --pypi some-package     # Add PyPI packages
pixi install                     # Install all dependencies
pixi run <task>                  # Run a defined task
pixi run python script.py        # Run any command in the env
pixi shell                       # Activate interactive shell

# Global tools
pixi global install ruff         # Install a CLI tool globally
pixi global list                 # List global tools

# Maintenance
pixi update                      # Update all packages
pixi list                        # List installed packages
pixi info                        # Show project/system info
```
