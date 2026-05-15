---
title: "uv Beginner Guide — Lightning-Fast Python Package Management"
date: 2026-05-13
difficulty: beginner
tags: [uv, python, package-manager, pip, virtual-environment, astral, rust]
---

# uv Beginner Guide — Lightning-Fast Python Package Management

## 1. Overview

**uv** is a blazing-fast Python package and project manager written in Rust, created by [Astral](https://astral.sh/) — the same team behind the popular [Ruff](https://docs.astral.sh/ruff/) linter. It serves as a single, unified replacement for an entire ecosystem of Python tooling:

| Traditional Tool        | What uv Replaces            |
| ----------------------- | --------------------------- |
| `pip` / `pip-tools`     | Package installation        |
| `virtualenv` / `venv`   | Virtual environment creation|
| `pyenv`                 | Python version management   |
| `pipx`                  | Tool installation           |
| `poetry` / `pdm`       | Project management          |

### Why uv Matters

- **Speed**: uv resolves and installs packages **10–100x faster** than pip. A cold install of a typical data-science stack that takes pip 30+ seconds completes in under 2 seconds with uv.
- **Unified toolchain**: One binary handles everything — creating projects, managing virtual environments, installing packages, pinning Python versions, running scripts, and installing CLI tools.
- **Drop-in compatible**: The `uv pip` subcommand accepts the same flags as pip, so migrating existing workflows is trivial.
- **Deterministic lockfiles**: `uv.lock` captures exact, cross-platform resolution so every developer and CI machine gets identical environments.
- **Rust-powered reliability**: No Python bootstrap problem — uv is a standalone binary with no Python dependency of its own.

### uv vs. Other Tools — Where Does It Fit?

uv is **PyPI-focused**. It excels at managing pure-Python projects and packages from PyPI. If your project lives entirely in the Python/PyPI ecosystem, uv is likely the fastest, simplest choice.

For **scientific computing** that requires conda packages — think NumPy built with MKL, CUDA-enabled PyTorch, or R/Julia interop — consider [[pixi-beginner-guide|Pixi Beginner Guide]]. Pixi is also Rust-based and fast, but it resolves from **both conda-forge and PyPI**, giving you access to pre-compiled binaries that pip cannot provide. See the comparison table below:

| Feature                  | uv                        | pixi                        | pip + venv         | poetry              | conda               |
| ------------------------ | ------------------------- | --------------------------- | ------------------ | ------------------- | -------------------- |
| Language                 | Rust                      | Rust                        | Python             | Python              | Python               |
| Package sources          | PyPI only                 | conda-forge + PyPI          | PyPI only          | PyPI only           | conda channels       |
| Speed                    | Extremely fast             | Very fast                   | Slow               | Moderate            | Slow                 |
| Lockfile                 | `uv.lock`                 | `pixi.lock`                 | `requirements.txt` | `poetry.lock`       | `conda-lock`(addon)  |
| Python version mgmt      | Built-in                  | Built-in                    | No (use pyenv)     | No                  | Built-in             |
| Non-Python packages      | No                        | Yes (C libs, R, etc.)       | No                 | No                  | Yes                  |
| Project management       | Yes (`pyproject.toml`)    | Yes (`pixi.toml`)           | Manual             | Yes                 | Manual               |

### What You Will Learn

By the end of this tutorial you will be able to:

- Install uv on macOS, Linux, and Windows
- Create and manage Python projects with `uv init`
- Add, remove, and sync dependencies
- Manage multiple Python versions
- Run scripts and CLI tools without permanent installs
- Share reproducible environments via lockfiles
- Troubleshoot common issues

---

## 2. Prerequisites

This tutorial assumes:

- **Basic Python familiarity** — you know what `import requests` means, even if you have never published a package.
- **Terminal basics** — you can open a terminal, `cd` into directories, and run commands. If file permissions confuse you, check [[linux-permissions-beginner-guide|Linux Permissions Beginner Guide]].
- **No prior packaging experience required** — we explain virtual environments, lockfiles, and `pyproject.toml` from scratch.

You do **not** need Python pre-installed. uv can download and manage Python for you.

---

## 3. Key Concepts

### 3.1 Virtual Environments

A virtual environment is an isolated directory that holds a specific Python interpreter and its own set of installed packages. This prevents Project A's dependencies from clashing with Project B's.

uv creates and manages virtual environments automatically. When you run `uv run`, `uv sync`, or `uv add`, uv ensures a `.venv/` directory exists in your project root.

### 3.2 `pyproject.toml` — The Single Source of Truth

Modern Python projects use `pyproject.toml` as their central configuration file. uv reads and writes this file to track:

- Project metadata (name, version, description)
- Dependencies and their version constraints
- The required Python version
- Build system configuration

```toml
[project]
name = "my-app"
version = "0.1.0"
description = "My awesome application"
requires-python = ">=3.11"
dependencies = [
    "httpx>=0.27",
    "rich>=13.0",
]

[dependency-groups]
dev = [
    "pytest>=8.0",
    "ruff>=0.4",
]
```

### 3.3 `uv.lock` — The Lockfile

While `pyproject.toml` declares *what* you need (e.g., `httpx>=0.27`), the lockfile records *exactly* what was resolved (e.g., `httpx==0.27.2` with all transitive dependencies and their hashes). This guarantees reproducibility.

Key properties of `uv.lock`:

- **Cross-platform**: captures resolutions for Linux, macOS, and Windows simultaneously.
- **Human-readable**: it is a TOML file you can inspect.
- **Committed to version control**: always check `uv.lock` into Git so collaborators get identical environments.

> **Comparison**: Poetry also has a lockfile (`poetry.lock`), but uv's resolver is significantly faster and produces cross-platform lockfiles by default. pip has no built-in lockfile — you manually run `pip freeze > requirements.txt`, which is platform-specific and fragile.

### 3.4 Python Version Management

uv can download, install, and switch between multiple Python versions — no pyenv needed:

```bash
uv python install 3.12 3.13    # download both versions
uv python pin 3.12              # pin this project to 3.12
uv python list                  # see all available/installed versions
```

This creates a `.python-version` file in your project, which uv (and other tools) respect.

### 3.5 Tool Installation

uv can run CLI tools from PyPI **without permanently installing them**, similar to `npx` in the JavaScript ecosystem or `pipx`:

```bash
uv tool run ruff check .        # run ruff without installing it
uvx black --check .              # uvx is shorthand for `uv tool run`
```

You can also install tools globally:

```bash
uv tool install httpie           # install permanently
uv tool list                     # see installed tools
```

### 3.6 Inline Script Dependencies

uv supports PEP 723 inline metadata, letting single-file scripts declare their own dependencies:

```python
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "httpx",
#     "rich",
# ]
# ///

import httpx
from rich import print

resp = httpx.get("https://httpbin.org/json")
print(resp.json())
```

Run it with `uv run script.py` — uv reads the inline metadata, creates a temporary environment, installs the dependencies, and executes the script. No project setup needed.

### 3.7 `uv pip` vs. Native `uv` Commands

uv provides two interfaces:

| Interface          | Purpose                                      | Example                            |
| ------------------ | -------------------------------------------- | ---------------------------------- |
| `uv` (native)     | Project-oriented workflow with lockfiles      | `uv add flask`, `uv run app.py`   |
| `uv pip`          | Drop-in pip replacement for legacy workflows  | `uv pip install -r requirements.txt` |

**Prefer the native `uv` commands** for new projects. They give you lockfiles, automatic virtual environment management, and the full project workflow. Use `uv pip` when you need compatibility with existing `requirements.txt` files or CI scripts that expect pip-style commands.

### 3.8 Workspaces

For monorepos or projects with multiple packages, uv supports workspaces — a root `pyproject.toml` that ties together several sub-packages:

```toml
# Root pyproject.toml
[tool.uv.workspace]
members = ["packages/*"]
```

Each member is its own package with its own `pyproject.toml`, but they share a single `uv.lock` for consistent resolution.

---

## 4. Step-by-Step Instructions

### 4.1 Installing uv

**macOS / Linux (recommended — standalone installer):**

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Expected output:

```
Downloading uv 0.7.x (aarch64-apple-darwin)
Installing to /Users/you/.local/bin
uv is ready to use!

To get started, try: uv init my-project
```

**macOS (Homebrew):**

```bash
brew install uv
```

**Windows (PowerShell):**

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

**Via pip (if you already have Python):**

```bash
pip install uv
```

**Verify the installation:**

```bash
uv --version
```

Expected output:

```
uv 0.7.8 (e0e1df090 2026-05-06)
```

### 4.2 Creating a New Project

```bash
uv init my-project
cd my-project
```

Expected output:

```
Initialized project `my-project` at `/home/you/my-project`
```

This creates the following structure:

```
my-project/
├── .python-version    # pinned Python version
├── README.md
├── pyproject.toml     # project metadata and dependencies
└── src/
    └── my_project/
        └── __init__.py
```

Inspect the generated `pyproject.toml`:

```bash
cat pyproject.toml
```

```toml
[project]
name = "my-project"
version = "0.1.0"
description = "Add your description here"
readme = "README.md"
requires-python = ">=3.12"
dependencies = []
```

### 4.3 Adding Dependencies

```bash
uv add httpx rich
```

Expected output:

```
Resolved 12 packages in 48ms
Prepared 12 packages in 132ms
Installed 12 packages in 28ms
 + anyio==4.9.0
 + certifi==2025.1.31
 + h11==0.16.0
 + httpcore==1.0.8
 + httpx==0.28.1
 + idna==3.10
 + markdown-it-py==3.0.0
 + mdurl==0.1.2
 + pygments==2.19.1
 + rich==13.9.4
 + sniffio==1.3.1
 + typing-extensions==4.13.2
```

Notice the speed — 12 packages resolved, downloaded, and installed in well under a second.

**Add development dependencies:**

```bash
uv add --group dev pytest ruff mypy
```

This adds them under `[dependency-groups]` in `pyproject.toml`, keeping them separate from production dependencies.

**Remove a dependency:**

```bash
uv remove rich
```

### 4.4 Running Scripts

Create `src/my_project/main.py`:

```python
import httpx

def main():
    resp = httpx.get("https://httpbin.org/json")
    data = resp.json()
    print(f"Got response with {len(data)} keys")

if __name__ == "__main__":
    main()
```

Run it:

```bash
uv run python -m my_project.main
```

uv automatically:
1. Creates a `.venv/` if one does not exist
2. Installs/syncs all dependencies
3. Activates the environment
4. Runs the command

You can also run any arbitrary command inside the project environment:

```bash
uv run pytest
uv run ruff check .
uv run python -c "import httpx; print(httpx.__version__)"
```

### 4.5 Managing Python Versions

**List available Python versions:**

```bash
uv python list
```

**Install a specific version:**

```bash
uv python install 3.13
```

Expected output:

```
Searching for Python installations
Installed Python 3.13.3 in 2.84s
 + cpython-3.13.3-macos-aarch64-none
```

**Pin your project to a specific version:**

```bash
uv python pin 3.12
```

This writes `3.12` to `.python-version`. When collaborators clone your repo and run `uv sync`, uv will automatically download Python 3.12 if they do not have it.

### 4.6 Syncing Environments

When you clone a project that already has a `uv.lock`:

```bash
git clone https://github.com/example/cool-project.git
cd cool-project
uv sync
```

This recreates the exact environment from the lockfile. To include dev dependencies:

```bash
uv sync --group dev
```

To update all dependencies to their latest allowed versions:

```bash
uv lock --upgrade
uv sync
```

### 4.7 Building and Publishing

```bash
uv build
```

This produces a wheel and sdist in `dist/`. To publish to PyPI:

```bash
uv publish
```

You will need a PyPI API token configured. For managing your GitHub workflow around publishing, see [[github-cli-beginner-guide|GitHub CLI Beginner Guide]].

---

## 5. Practical Examples

### 5.1 Creating a FastAPI Web Application

```bash
uv init fastapi-demo --package
cd fastapi-demo
uv add fastapi uvicorn[standard]
```

Edit `src/fastapi_demo/app.py`:

```python
from fastapi import FastAPI

app = FastAPI()

@app.get("/")
def read_root():
    return {"message": "Hello from uv + FastAPI!"}

@app.get("/items/{item_id}")
def read_item(item_id: int, q: str | None = None):
    return {"item_id": item_id, "q": q}
```

Run the development server:

```bash
uv run uvicorn fastapi_demo.app:app --reload
```

Expected output:

```
INFO:     Uvicorn running on http://127.0.0.1:8000
INFO:     Started reloader process [12345]
```

Visit `http://127.0.0.1:8000/docs` for the auto-generated API docs.

### 5.2 Building a CLI Tool

```bash
uv init greet-cli --package
cd greet-cli
uv add click
```

Edit `src/greet_cli/main.py`:

```python
import click

@click.command()
@click.argument("name")
@click.option("--greeting", "-g", default="Hello", help="The greeting to use")
@click.option("--count", "-c", default=1, help="Number of greetings")
def main(name: str, greeting: str, count: int):
    """Greet someone enthusiastically."""
    for _ in range(count):
        click.echo(f"{greeting}, {name}!")

if __name__ == "__main__":
    main()
```

Add a script entry point in `pyproject.toml`:

```toml
[project.scripts]
greet = "greet_cli.main:main"
```

Run it:

```bash
uv run greet World --count 3
```

Expected output:

```
Hello, World!
Hello, World!
Hello, World!
```

### 5.3 Data Analysis Script with Inline Dependencies

Create `analyze.py` — no project setup needed:

```python
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "pandas>=2.2",
#     "matplotlib>=3.9",
# ]
# ///

import pandas as pd
import matplotlib.pyplot as plt

# Create sample data
data = pd.DataFrame({
    "month": ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
    "sales": [120, 135, 148, 162, 155, 178],
})

print(data.describe())
data.plot(x="month", y="sales", kind="bar", title="Monthly Sales")
plt.tight_layout()
plt.savefig("sales.png")
print("Chart saved to sales.png")
```

Run it directly:

```bash
uv run analyze.py
```

uv reads the inline metadata, installs pandas and matplotlib into a temporary environment, and runs the script. Nothing is left behind.

> **Note on scientific computing**: This example uses pure-Python wheels for pandas and matplotlib, which works well. However, if you need optimized BLAS/LAPACK (MKL), CUDA-enabled PyTorch, or other packages with complex compiled dependencies, consider [[pixi-beginner-guide|Pixi Beginner Guide]] — pixi can pull pre-compiled binaries from conda-forge that pip/uv cannot. For HPC clusters specifically, see [[pixi-hpc-usage|Using Pixi on HPC Clusters]].

### 5.4 Using `uv tool` for One-Off Commands

Run linters and formatters without installing them into your project:

```bash
# Run ruff to lint your code
uvx ruff check .

# Format with black
uvx black --check .

# Check types with pyright
uvx pyright .

# Generate a project skeleton with cookiecutter
uvx cookiecutter gh:audreyfeldroy/cookiecutter-pypackage

# Run a Jupyter notebook server
uvx jupyter lab
```

The first run downloads the tool; subsequent runs use a cached version.

### 5.5 Migrating from pip + requirements.txt

If you have an existing project with `requirements.txt`:

```bash
# Option 1: Use uv pip as a drop-in replacement (quick migration)
uv venv
uv pip install -r requirements.txt

# Option 2: Convert to a proper uv project (recommended)
uv init --bare             # creates pyproject.toml without src layout
uv add $(cat requirements.txt | grep -v '^#' | grep -v '^$' | tr '\n' ' ')
```

Option 2 gives you the full benefits of lockfiles and project management.

---

## 6. Hands-On Exercises

Work through these exercises to build practical uv skills. Solutions follow each exercise.

### Exercise 1: Create a Project from Scratch

**Task**: Create a new project called `weather-app` that uses the `httpx` and `rich` libraries to fetch weather data and display it nicely.

<details>
<summary>Solution</summary>

```bash
uv init weather-app --package
cd weather-app
uv add httpx rich
```

Create `src/weather_app/main.py`:

```python
import httpx
from rich.console import Console
from rich.table import Table

def main():
    console = Console()
    resp = httpx.get("https://wttr.in/London?format=j1")
    data = resp.json()

    table = Table(title="London Weather")
    table.add_column("Metric")
    table.add_column("Value")

    current = data["current_condition"][0]
    table.add_row("Temperature", f"{current['temp_C']}°C")
    table.add_row("Feels Like", f"{current['FeelsLikeC']}°C")
    table.add_row("Humidity", f"{current['humidity']}%")
    table.add_row("Description", current['weatherDesc'][0]['value'])

    console.print(table)

if __name__ == "__main__":
    main()
```

```bash
uv run python -m weather_app.main
```

</details>

### Exercise 2: Add Dev Dependencies and Run Tests

**Task**: Add `pytest` as a dev dependency and write a simple test.

<details>
<summary>Solution</summary>

```bash
uv add --group dev pytest
```

Create `tests/__init__.py` (empty) and `tests/test_basic.py`:

```python
def test_addition():
    assert 1 + 1 == 2

def test_string_methods():
    assert "hello".upper() == "HELLO"
    assert "  spaces  ".strip() == "spaces"
```

Run the tests:

```bash
uv run pytest -v
```

Expected output:

```
========================= test session starts =========================
tests/test_basic.py::test_addition PASSED
tests/test_basic.py::test_string_methods PASSED
========================= 2 passed in 0.03s ==========================
```

</details>

### Exercise 3: Pin a Python Version

**Task**: Pin your project to Python 3.12 and verify.

<details>
<summary>Solution</summary>

```bash
uv python pin 3.12
cat .python-version
# Output: 3.12

uv run python --version
# Output: Python 3.12.x
```

If Python 3.12 is not already installed, uv will prompt you to install it:

```bash
uv python install 3.12
```

</details>

### Exercise 4: Use `uv tool` for One-Off Commands

**Task**: Run `ruff` to lint your project and `black` to check formatting — without adding either as a project dependency.

<details>
<summary>Solution</summary>

```bash
# Lint with ruff
uvx ruff check src/

# Check formatting with black
uvx black --check src/

# Fix formatting (if needed)
uvx black src/
```

These tools are cached globally and do not appear in your `pyproject.toml`.

</details>

### Exercise 5: Share a Lockfile with a Colleague

**Task**: Simulate the workflow of sharing a reproducible environment.

<details>
<summary>Solution</summary>

```bash
# You: commit and push
git add pyproject.toml uv.lock .python-version
git commit -m "Add weather app with pinned dependencies"
git push

# Colleague: clone and sync
git clone <repo-url>
cd weather-app
uv sync --group dev   # recreates exact environment from lockfile

# Verify identical environment
uv run python -c "import httpx; print(httpx.__version__)"
```

The lockfile ensures your colleague gets the exact same package versions, regardless of their operating system.

</details>

---

## 7. Troubleshooting

### Resolution Conflicts

**Error:**

```
error: No solution found when resolving dependencies:
  Because package-a==1.0.0 depends on requests>=2.28,<2.30
    and package-b==2.0.0 depends on requests>=2.31
```

**Fix**: Check which packages have conflicting requirements:

```bash
uv tree                   # show dependency tree
uv tree --invert requests # show who depends on requests
```

Then either relax your constraints, update the conflicting packages, or use version overrides as a last resort:

```toml
# pyproject.toml
[tool.uv]
override-dependencies = ["requests>=2.31"]
```

### Python Version Not Found

**Error:**

```
error: No interpreter found for Python 3.12 in managed installations or system path
```

**Fix**:

```bash
uv python install 3.12
```

If you need to see all available versions:

```bash
uv python list --all-versions
```

### Platform-Specific Wheel Issues

**Error:**

```
error: No matching distribution found for some-package==1.2.3
```

This often happens with packages that only publish wheels for certain platforms (e.g., Windows-only or Linux-only).

**Fix**: Check PyPI for available wheels. If the package does not have a wheel for your platform, you may need a source distribution and a C compiler:

```bash
# macOS
xcode-select --install

# Ubuntu/Debian
sudo apt install build-essential python3-dev
```

For complex compiled packages (CUDA, MKL, etc.), this is where uv hits its limit — it only pulls from PyPI. Consider using [[pixi-deep-dive|Pixi Deep Dive]] for access to pre-compiled conda-forge binaries.

### Editable Installs / Import Errors

**Error:**

```
ModuleNotFoundError: No module named 'my_project'
```

**Fix**: Make sure you are running through uv, which handles the editable install automatically:

```bash
# Correct — uv manages the environment
uv run python -m my_project.main

# If you need a traditional editable install in the venv
uv pip install -e .
```

### Cache Issues

If something seems stale or corrupted:

```bash
uv cache clean             # clear the entire cache
uv cache clean httpx       # clear cache for a specific package
uv cache dir               # see where the cache lives
```

### Lockfile Out of Sync

**Error:**

```
error: The lockfile at `uv.lock` needs to be updated
```

**Fix**:

```bash
uv lock          # regenerate lockfile from pyproject.toml
uv sync          # sync environment to match
```

---

## 8. Related Tutorials

These linked tutorials cover complementary tools and workflows:

- [[uv-deep-dive|uv Deep Dive]] — Advanced uv topics: workspaces, custom indices, CI/CD integration, performance tuning, and publishing workflows
- [[pixi-beginner-guide|Pixi Beginner Guide]] — An alternative Rust-based project manager that resolves from both conda-forge and PyPI — ideal for scientific computing and mixed-language projects
- [[pixi-deep-dive|Pixi Deep Dive]] — Advanced pixi reference covering environments, tasks, multi-platform lockfiles, and complex dependency trees
- [[pixi-hpc-usage|Using Pixi on HPC Clusters]] — Running pixi on HPC systems with Slurm, shared filesystems, and offline environments
- [[docker-test-container-beginner-guide|Docker Test Container Beginner Guide]] — Containerize your uv-managed project for testing and deployment
- [[linux-permissions-beginner-guide|Linux Permissions Beginner Guide]] — Understanding file permissions, especially useful when uv installs binaries to `~/.local/bin`
- [[github-cli-beginner-guide|GitHub CLI Beginner Guide]] — Manage repositories, pull requests, and CI workflows from the terminal

---

## 9. References

- **Official documentation**: [https://docs.astral.sh/uv/](https://docs.astral.sh/uv/)
- **GitHub repository**: [https://github.com/astral-sh/uv](https://github.com/astral-sh/uv)
- **Astral blog**: [https://astral.sh/blog](https://astral.sh/blog)
- **PEP 723 — Inline script metadata**: [https://peps.python.org/pep-0723/](https://peps.python.org/pep-0723/)
- **pyproject.toml specification**: [https://packaging.python.org/en/latest/specifications/pyproject-toml/](https://packaging.python.org/en/latest/specifications/pyproject-toml/)
- **uv pip compatibility guide**: [https://docs.astral.sh/uv/pip/compatibility/](https://docs.astral.sh/uv/pip/compatibility/)

---

## 10. Summary

### Key Takeaways

1. **uv replaces multiple tools** — pip, virtualenv, pyenv, pipx, and project managers like poetry — with a single, fast binary.
2. **Speed matters** — uv's Rust-based resolver and installer are 10–100x faster than pip, making dependency management nearly instant.
3. **Use native `uv` commands** (`uv init`, `uv add`, `uv run`) for new projects. Reserve `uv pip` for migrating legacy workflows.
4. **Lockfiles are essential** — always commit `uv.lock` to Git for reproducible environments across machines and platforms.
5. **`uv run` is your friend** — it handles environment creation, dependency syncing, and script execution in one command.
6. **`uvx` for one-off tools** — run ruff, black, or any PyPI CLI tool without polluting your project.
7. **uv is PyPI-only** — for conda packages (MKL-optimized NumPy, CUDA, non-Python libraries), use [[pixi-beginner-guide|Pixi Beginner Guide]] instead.

### Next Steps

- Read [[uv-deep-dive|uv Deep Dive]] for workspaces, CI/CD patterns, custom package indices, and advanced configuration.
- Try [[pixi-beginner-guide|Pixi Beginner Guide]] if your projects need conda packages alongside PyPI.
- Set up [[docker-test-container-beginner-guide|Docker Test Container Beginner Guide]] to containerize your uv-managed applications.
- Explore the [official uv documentation](https://docs.astral.sh/uv/) for the full command reference and configuration options.
