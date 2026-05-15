---
title: "Just Command Runner — Deep Dive"
date: 2026-04-24
difficulty: advanced
tags: [just, command-runner, automation, task-runner, sysadmin, devops, advanced]
---

# Just Command Runner — Deep Dive

## Overview

`just` is a command runner and task automation tool created by Casey Rodarmor that sits at the intersection of Make's syntax heritage and modern shell scripting needs. Unlike Make (which was designed for C compilation), just prioritizes simplicity and safety for general-purpose task automation.

**Design Philosophy:**
- **Explicit over implicit**: Variables require explicit scoping; dependencies are clear
- **Language-agnostic**: Recipes are shell-agnostic (can use bash, zsh, fish, Python, etc.)
- **User-friendly error messages**: Helpful diagnostics without cryptic shell errors
- **No built-in rules**: Recipes must be explicit; no magic inference
- **Cross-platform first**: Same justfile works on Linux, macOS, Windows

**How it differs from alternatives:**
- **vs Make**: just has simpler variable scoping, better error handling, and doesn't conflate task running with build artifact management
- **vs npm scripts**: just is language-agnostic; doesn't require Node.js; includes recipe parameters and dependencies
- **vs Bash scripts**: just provides recipe organization, parameterization, dependency ordering, and interactive features like `--choose`
- **vs Ansible**: just is lighter-weight for simple automation; Ansible excels at systems management at scale

## Prerequisites

This tutorial assumes you've mastered [[just-beginner-guide]]:
- Basic recipe syntax and dependencies
- Variable definitions
- Parameters and defaults
- The `@` prefix for suppressing output
- Running recipes with `just` command

## Key Concepts

### Recipe Attributes

Attributes modify recipe behavior using square bracket syntax:

```just
[no-cd]
recipe target:
    pwd  # Stays in invocation directory, not justfile directory

[private]
_internal:
    echo "Not listed in `just --list`"

[no-exit-message]
silent-fail:
    @false || true

[confirm]
[group('dangerous')]
delete-database:
    rm -rf /var/db/app

[doc("Deploy to staging environment")]
[linux]
[macos]
deploy:
    ./deploy.sh

[windows]
deploy:
    deploy.bat

[no-quiet]
verbose-task:
    set -x
```

Key attributes:
- `[private]`: Hides recipe from `--list`; useful for internal helpers
- `[no-cd]`: Stays in invocation directory instead of justfile directory
- `[confirm]`: Prompts user before execution
- `[group('name')]`: Organizes recipes in `--list` output
- `[doc("text")]`: Provides help text in `--list`
- `[windows]`, `[linux]`, `[macos]`, `[unix]`: Platform-specific recipes
- `[no-exit-message]`: Suppresses exit status output

### Conditional Expressions

just includes a conditional expression language for dynamic recipes:

```just
set windows-shell := if os() == "windows" { ["powershell", "-Command"] } else { ["bash", "-c"] }

build target='debug':
    @if [ "{{ target }}" = "release" ]; then
        cargo build --release
    else
        cargo build
    fi

configure:
    @if path_exists('.env'); then
        source .env
    fi
    
    @if env_var_or_default('DEBUG', '') == 'true'; then
        set -x
    fi

list-arch:
    @echo "Architecture: {{ arch() }}"
    @echo "OS: {{ os() }}"
    @echo "OS Family: {{ os_family() }}"
```

Built-in conditional functions:
- `os()`: Returns 'linux', 'macos', 'windows'
- `os_family()`: Returns 'unix' or 'windows'
- `arch()`: Returns 'aarch64', 'x86_64', etc.
- `env_var('NAME')`: Retrieves environment variable; fails if missing
- `env_var_or_default('NAME', 'default')`: Returns default if missing
- `path_exists('/path')`: Boolean check for file/directory existence

### Built-in Functions

just provides a rich function library:

```just
info:
    @echo "Justfile: {{ justfile() }}"
    @echo "Directory: {{ justfile_directory() }}"
    @echo "Invoked from: {{ invocation_directory() }}"
    @echo "Just binary: {{ just_executable() }}"

strings:
    @echo "{{ 'hello' + ' ' + 'world' }}"  # Concatenation
    @echo "{{ 'path' / 'to' / 'file' }}"   # Path joining
    @echo "{{ 'HELLO'.lowercase() }}"      # String methods
    @echo "{{ 'hello'.uppercase() }}"
    @echo "{{ 'hello world'.replace('world', 'universe') }}"
    @echo "{{ 'a,b,c'.split(',').join('-') }}"

hashing:
    @echo "{{ sha256('hello world') }}"
    @echo "{{ sha256_file('Justfile') }}"

uuid-gen:
    @echo "UUID: {{ uuid() }}"

datetime:
    @echo "Timestamp: {{ datetime('%Y-%m-%d %H:%M:%S') }}"
    @echo "Now: {{ now }}"
```

### Modules and Imports

Organize large justfiles into modules:

```just
# justfile
mod docker
mod database
mod deploy

# docker.just
@load-image image:
    docker load < {{ image }}.tar

build-image tag:
    docker build -t {{ tag }} .

# database.just
init-db:
    createdb myapp

migrate version:
    flyway migrate -target={{ version }}

# deploy.just
deploy env:
    @echo "Deploying to {{ env }}"
```

Modules provide namespace isolation. Call them with `just docker::build-image nginx:latest`.

### Shell Customization

Control shell behavior globally:

```just
set shell := ["bash", "-uc"]
set positional-arguments
set dotenv-load
set export
set tempdir := '/tmp/justwork'
set windows-shell := ["powershell", "-Command"]

recipe $ARG1 $ARG2:
    echo "$ARG1"  # Can use positional args with set positional-arguments
    echo "$APP_DB"  # Automatically exported via set export
```

- `set positional-arguments`: Pass recipe parameters as shell positional arguments
- `set dotenv-load`: Automatically load `.env` file
- `set export`: Automatically export all variables as environment variables
- `set tempdir`: Custom temporary directory for `tempfile()` function
- `set fallback`: Use fallback shell if default fails

### Error Handling

just provides multiple error handling strategies:

```just
[confirm]
dangerous-op:
    rm -rf /data

safe-fallback:
    @command-that-might-fail || echo "Fallback executed"

set fallback
recipe:  # Falls back to sh if bash unavailable
    #!/bin/bash
    echo "Executed"

graceful-exit:
    @set -e  # Exit on error
    @set +e  # Continue on error
    command1
    command2
```

Use `[confirm]` for destructive operations. Use `|| true` or `|| fallback-command` for recovery patterns.

## Step-by-Step Instructions

### Advanced Pattern: Multi-File Justfiles with Modules

```just
# justfile
mod ci
mod infra
mod app

# ci.just
test:
    cargo test --all

lint:
    cargo clippy -- -D warnings

# infra.just
[group('infrastructure')]
[doc("Deploy infrastructure")]
tf-apply:
    terraform apply -auto-approve

# app.just
build-release:
    cargo build --release
    strip target/release/myapp
```

Call with: `just ci::test`, `just infra::tf-apply`, `just app::build-release`

### Shell Function Integration

Embed complex logic as shell functions:

```just
set shell := ["bash", "-uc"]

deploy env:
    #!/bin/bash
    
    deploy_to_env() {
        local env="$1"
        echo "Deploying to $env"
        # Complex deployment logic
        curl -X POST https://api.example.com/deploy \
            -d "{\"environment\": \"$env\"}"
    }
    
    deploy_to_env "{{ env }}"
```

### Complex Variable Interpolation

```just
build-matrix target arch:
    @echo "Target: {{ target }}"
    @echo "Arch: {{ arch }}"
    @echo "Binary: target/{{ target }}/{{ arch }}/myapp"

path-construction base file:
    @echo "{{ base / 'subdir' / file }}"

conditional-vars env:
    @if [ "{{ env }}" = "prod" ]; then \
        DB_URL="postgresql://prod-db"; \
    else \
        DB_URL="postgresql://localhost"; \
    fi && echo $DB_URL
```

### Cross-Platform Justfiles

```just
[windows]
build:
    cargo build

[unix]
build:
    cargo build

install-deps:
    @if os() == "macos"; then
        brew install myapp
    elif os() == "windows"; then
        choco install myapp
    else
        apt-get install myapp
    fi

run-binary:
    @./target/release/myapp{{ if os() == "windows" { ".exe" } else { "" } }}
```

### Working Directory Recipes

```just
[no-cd]
from-invocation:
    pwd  # Prints invocation directory

from-justfile-dir:
    pwd  # Prints justfile directory

monorepo-task subdir:
    cd {{ subdir }} && just test
```

## Practical Examples

### Multi-Environment Deployment

```just
set dotenv-load
set export

[group('deploy')]
[doc("Deploy to development")]
deploy-dev:
    @echo "Deploying to development..."
    @./scripts/deploy.sh development

[confirm]
[group('deploy')]
[doc("Deploy to production")]
deploy-prod:
    @echo "Deploying to production..."
    @./scripts/deploy.sh production
```

### CI/CD Integration

```just
# Works with GitHub Actions, GitLab CI, Jenkins
test:
    cargo test --all

lint-and-format:
    cargo fmt --check
    cargo clippy -- -D warnings

ci: test lint-and-format
    @echo "CI pipeline passed"
```

### Monorepo Management

```just
mod services::api
mod services::web
mod services::worker

build-all:
    just services::api::build
    just services::web::build
    just services::worker::build

test-all:
    just services::api::test
    just services::web::test
    just services::worker::test
```

### Database Migrations

```just
[doc("Run pending migrations")]
migrate:
    flyway migrate

[doc("Create new migration")]
migrate-create name:
    @echo "/* {{ now }} */ CREATE TABLE {{ name }} (id SERIAL PRIMARY KEY);" \
        > migrations/V$(date +%s)__{{ name }}.sql

migrate-info:
    flyway info

[confirm]
migrate-repair:
    flyway repair
```

### Infrastructure-as-Code Patterns

```just
set dotenv-load

[group('terraform')]
tf-plan:
    terraform plan -out=tfplan

[confirm]
[group('terraform')]
tf-apply:
    terraform apply tfplan

[group('terraform')]
tf-destroy:
    terraform destroy
```

### Polyglot Project Runner

```just
test-go:
    cd go-service && go test ./...

test-python:
    cd python-service && python -m pytest

test-node:
    cd node-service && npm test

test: test-go test-python test-node
    @echo "All tests passed"
```

### Complex Docker/Kubernetes Workflows

```just
[group('docker')]
build-image tag:
    docker build -t {{ tag }} .
    docker tag {{ tag }} myrepo/{{ tag }}

[group('docker')]
push-image tag:
    docker push myrepo/{{ tag }}

[group('k8s')]
[doc("Deploy to Kubernetes cluster")]
k8s-deploy image:
    kubectl set image deployment/myapp \
        myapp=myrepo/{{ image }}
    kubectl rollout status deployment/myapp

[group('k8s')]
k8s-logs:
    kubectl logs -f deployment/myapp
```

### Open Source Patterns

Popular projects use just for:
- **Helix editor**: Build, test, and install recipes
- **Nix**: Utility tasks for development shells
- **Zellij**: Cross-platform development workflows
- **Starship**: Testing and release automation

## Hands-On Exercises

1. **Exercise 1**: Create a justfile with platform-specific recipes using `[linux]`, `[macos]`, `[windows]` attributes
2. **Exercise 2**: Implement a multi-environment deploy recipe with `[confirm]` and conditional logic
3. **Exercise 3**: Build a monorepo justfile using modules for 3 separate services
4. **Exercise 4**: Create a CI pipeline justfile that coordinates test, lint, and build steps
5. **Exercise 5**: Implement database migration recipes with Flyway integration

## Troubleshooting

**Recipe not executing:**
- Check for typos in recipe name
- Use `just --list` to verify recipe exists
- Check shell compatibility with `set shell` setting

**Variables not expanding:**
- Ensure variable is defined before use
- Use `{{ variable }}` syntax in recipe body
- Environment variables need `env_var()` function or `set export`

**Cross-platform issues:**
- Test recipes on each platform
- Use platform-specific recipes: `[windows]`, `[unix]`
- Escape paths properly for Windows: `{{ path / "to" / "file" }}`

**Module import errors:**
- Verify module file exists at correct path
- Check for circular dependencies
- Use `just --dump` to debug module resolution

**Shell escaping:**
- Single quotes prevent variable expansion: `echo '{{ var }}'` prints literal
- Double quotes allow expansion: `echo "{{ var }}"` expands variable
- Use backticks for command substitution: `{{ `date` }}`

## Related Tutorials

- [[just-beginner-guide]] — Foundation concepts
- [[just-vs-make]] — Detailed comparison with Make
- [[git-worktrees-worktrunk-deep-dive]] — Integration with Git workflows
- [[dotfiles-deep-dive]] — Configuration management patterns
- [[kubernetes-deep-dive]] — Container orchestration integration
- [[terraform-deep-dive]] — Infrastructure-as-code patterns (recommended link)
- [[hammerspoon-deep-dive]] — Desktop automation alternatives

## References

**Official Documentation:**
- [just GitHub repository](https://github.com/casey/just)
- [Official just documentation](https://just.systems/)
- [Changelog and feature list](https://github.com/casey/just/releases)

**Community Resources:**
- just Discord community
- GitHub issues and discussions on casey/just
- Cookbooks and recipes in just repository examples/
- Blog posts on task automation with just

**Related Tools:**
- [[television-deep-dive]] — Terminal UI for just recipe selection
- [[sesh-deep-dive]] — Session management with just integration
- [[mosh-deep-dive]] — Remote execution of just recipes

## Summary

**Mastery Checklist:**
- [ ] Understand just's design philosophy vs alternatives
- [ ] Use recipe attributes confidently: `[private]`, `[confirm]`, `[group]`, platform-specific
- [ ] Write conditional expressions with `os()`, `arch()`, path functions
- [ ] Leverage built-in functions: string operations, hashing, UUID, datetime
- [ ] Organize large projects with modules and imports
- [ ] Customize shell behavior with global settings
- [ ] Implement robust error handling patterns
- [ ] Build multi-environment deployment workflows
- [ ] Integrate just with CI/CD systems
- [ ] Manage monorepos effectively with modules
- [ ] Create reproducible, cross-platform justfiles

**Key Takeaways:**
1. just excels at general-purpose task automation without Make's compilation heritage
2. Modules provide scalability for complex projects
3. Recipe attributes enable safety and organization (confirm, group, private)
4. Conditional expressions and built-in functions enable dynamic recipe logic
5. just works seamlessly across Linux, macOS, and Windows with explicit platform support

just is ideal when you need a lightweight, language-agnostic task runner that prioritizes clarity and user experience over build artifact management.
# Related Tutorials

- [[openmux-beginner-guide|OpenMux Beginner Guide]] and [[openmux-deep-dive|OpenMux Deep Dive]] — terminal multiplexer with CLI for just integration

- [[micropython-ttgo-t-display-beginner-guide|MicroPython TTGO T-Display Beginner Guide]] — practical justfile use for embedded development
- [[micropython-ttgo-t-display-deep-dive|MicroPython TTGO T-Display Deep Dive]] — advanced justfile patterns for flash, deploy, REPL, and live-mount workflows

- [[gh-cli-beginner-guide|GitHub CLI Beginner Guide]] — `gh` fundamentals for Justfile integration
- [[gh-cli-deep-dive|GitHub CLI Deep Dive]] — scripting releases and PRs via Just recipes
