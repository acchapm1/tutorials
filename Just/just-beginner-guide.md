---
title: "Just Command Runner — Beginner Guide"
date: 2026-04-24
difficulty: beginner
tags: [just, command-runner, automation, task-runner, sysadmin, devops]
---

# Just Command Runner — Beginner Guide

## Overview

`just` is a handy command runner that helps you automate and organize your repetitive terminal commands. Created by Casey Rodarmor, it's similar to Make but designed specifically for running commands rather than building projects.

### Why just Matters

In your daily sysadmin or DevOps work, you probably run the same commands repeatedly:
- Starting Docker containers and services
- Deploying applications to servers
- Running backups and maintenance scripts
- Setting up project environments
- Running Ansible playbooks

Instead of memorizing these commands or digging through shell history, `just` lets you define them once in a simple file and run them whenever needed.

### What You'll Learn

By the end of this guide, you'll be able to:
- Install and set up `just`
- Create and run basic recipes (command definitions)
- Use variables and arguments in recipes
- Organize complex workflows with dependencies
- Apply `just` to real sysadmin tasks like Docker management, deployments, and backups

---

## Prerequisites

- **Terminal familiarity**: Comfortable running basic shell commands
- **A text editor**: VS Code, vim, nano, or similar
- **Bash or zsh shell**: Most common on Linux/macOS
- **Optional**: Docker or server access for practical examples

You don't need to know Make, build systems, or any special syntax beforehand.

---

## Key Concepts

### What is a Justfile?

A `justfile` (lowercase, no extension) is a simple text file that contains recipes—definitions of commands you want to run. Unlike Makefiles, `just` is **not** a build system; it's purely for command execution.

### Recipes

A recipe is a named command or series of commands:

```just
hello:
    echo "Hello from just!"
```

Run it with: `just hello`

### Recipe Arguments

Recipes can accept arguments:

```just
greet name:
    echo "Hello, {{name}}!"
```

Run it with: `just greet Alice`

### Variables

Define values once, use them everywhere:

```just
docker_image := "myapp:latest"
docker_registry := "docker.io"

build:
    docker build -t {{docker_registry}}/{{docker_image}} .
```

### Dependencies

Run recipes in sequence using `@requires-recipe`:

```just
setup: install configure
    echo "Setup complete!"

install:
    apt-get update && apt-get install -y build-essential

configure:
    ./configure.sh
```

### Settings

Control shell behavior at the top of your justfile:

```just
set shell := ["bash", "-cu"]
set dotenv-load := true
```

---

## Step-by-Step Instructions

### Installing just

**macOS** (with Homebrew):
```bash
brew install just
```

**Linux** (Ubuntu/Debian):
```bash
sudo apt-get install just
```

**Any system** (with Cargo, Rust's package manager):
```bash
cargo install just
```

**Verify installation**:
```bash
just --version
```

Expected output:
```
just 1.X.X
```

### Creating Your First Justfile

1. Navigate to your project directory:
```bash
cd ~/myproject
```

2. Create a `justfile`:
```bash
cat > justfile << 'EOF'
# My first justfile

hello:
    echo "Hello from just!"

build:
    echo "Building the project..."
    pwd

deploy:
    echo "Deploying to production"
EOF
```

3. List available recipes:
```bash
just --list
```

Expected output:
```
Available recipes:
    build
    deploy
    hello
```

4. Run a recipe:
```bash
just hello
```

Expected output:
```
Hello from just!
```

### Using Arguments

Create a recipe that accepts parameters:

```just
deploy env:
    echo "Deploying to {{env}} environment..."
    # In real use: ansible-playbook deploy-{{env}}.yml
```

Run with: `just deploy staging`

### Loading Environment Variables

Add this at the top of your justfile:

```just
set dotenv-load := true
```

Then create a `.env` file:
```
DOCKER_REGISTRY=docker.io
DATABASE_URL=postgres://localhost/mydb
```

Use them in recipes:
```just
db-migrate:
    psql {{env("DATABASE_URL")}} < migrations.sql
```

---

## Practical Examples

### Example 1: Docker Workflow for sysadmins

```just
set shell := ["bash", "-cu"]

docker_image := "myapp"
docker_tag := "latest"

# Build and tag the Docker image
docker-build:
    docker build -t {{docker_image}}:{{docker_tag}} .

# Run container with proper networking
docker-run:
    docker run -d \
        --name {{docker_image}}-container \
        -p 8080:8080 \
        --restart unless-stopped \
        {{docker_image}}:{{docker_tag}}

# Stop and remove the container
docker-clean:
    docker stop {{docker_image}}-container || true
    docker rm {{docker_image}}-container || true

# Full deploy cycle: build, clean old, run new
docker-deploy: docker-build docker-clean docker-run
    docker ps | grep {{docker_image}}
```

### Example 2: Server Deployment with Ansible

Many sysadmins use `just` to wrap their Ansible playbooks:

```just
set dotenv-load := true

inventory := "hosts.ini"

# Run a specific playbook against staging
deploy-staging:
    ansible-playbook \
        -i {{inventory}} \
        --limit staging \
        playbooks/deploy.yml \
        -v

# Run against production (requires confirmation)
deploy-production:
    @echo "⚠️  Deploying to PRODUCTION"
    @read -p "Type 'yes' to continue: " confirm && [ "$confirm" = "yes" ]
    ansible-playbook \
        -i {{inventory}} \
        --limit production \
        playbooks/deploy.yml \
        -v

# Check server health across all hosts
health-check:
    ansible all -i {{inventory}} -m ping
```

### Example 3: Backup and Maintenance Tasks

```just
backup_dir := "/backups"
db_name := "production"
retention_days := "30"

# Daily database backup
backup-db:
    mkdir -p {{backup_dir}}
    pg_dump {{db_name}} | gzip > {{backup_dir}}/{{db_name}}-$(date +%Y%m%d).sql.gz
    @echo "✓ Database backed up"

# Clean old backups
cleanup-backups:
    find {{backup_dir}} -name "*.sql.gz" -mtime +{{retention_days}} -delete
    @echo "✓ Old backups removed"

# Full maintenance routine
maintenance: backup-db cleanup-backups
    @echo "Maintenance complete!"
```

### Example 4: Project Setup (Like Your myvm Workspace)

```just
# HPC cluster setup with Docker and Ansible

set shell := ["bash", "-cu"]
set dotenv-load := true

cluster_name := "hpc-cluster"
docker_compose_file := "docker-compose.yml"

# Initial cluster setup
setup: docker-build ansible-prep
    @echo "✓ Cluster {{cluster_name}} ready"

# Build required Docker images
docker-build:
    docker-compose -f {{docker_compose_file}} build

# Prepare Ansible inventory and SSH keys
ansible-prep:
    [ -d .ssh ] || mkdir .ssh
    ssh-keygen -t ed25519 -f .ssh/cluster_key -N "" || true
    @echo "✓ Ansible prepared"

# SSH into the cluster master
ssh:
    ssh -i .ssh/cluster_key cluster-master

# Run Ansible playbooks on cluster
ansible-run playbook:
    ansible-playbook -i inventory.ini playbooks/{{playbook}}.yml -v

# Bring up all cluster services
cluster-up:
    docker-compose -f {{docker_compose_file}} up -d

# Tear down cluster
cluster-down:
    docker-compose -f {{docker_compose_file}} down

# View cluster status
cluster-status:
    docker-compose -f {{docker_compose_file}} ps
```

---

## Hands-On Exercises

### Exercise 1: Create a Personal justfile

Create a `justfile` in your home directory with recipes for tasks you do daily:

```just
# Example: system maintenance
update-system:
    sudo apt-get update && sudo apt-get upgrade -y

list-large-files:
    find ~ -type f -size +100M -exec ls -lh {} \;

disk-usage:
    du -sh ~/*
```

Run: `just update-system`

### Exercise 2: Add Arguments

Extend a recipe to accept parameters:

```just
backup target:
    tar -czf {{target}}-backup-$(date +%s).tar.gz {{target}}
    @echo "✓ Backup created"
```

Run: `just backup ~/Documents`

### Exercise 3: Create Dependencies

Chain recipes together:

```just
deploy: lint test build push
    @echo "✓ Deployment complete"

lint:
    shellcheck *.sh

test:
    ./run-tests.sh

build:
    docker build -t myapp:latest .

push:
    docker push myapp:latest
```

Run: `just deploy`

---

## Troubleshooting

### Recipe Not Found

**Problem**: `Error: Unknown recipe 'xyz'`

**Solution**: List available recipes with `just --list` and check the spelling.

### Permission Denied

**Problem**: `Permission denied: ./script.sh`

**Solution**: Make the script executable:
```bash
chmod +x script.sh
```

### Command Not Found in Recipe

**Problem**: Recipe runs fine locally but fails in `just`

**Solution**: `just` uses `/bin/sh` by default. Set a different shell:
```just
set shell := ["bash", "-cu"]
```

### Environment Variables Not Loading

**Problem**: `{{env("VAR_NAME")}}` returns empty

**Solution**: Ensure `set dotenv-load := true` is at the top of your justfile and the `.env` file exists.

### Recipe Output Not Showing

**Problem**: Silent output from recipes

**Solution**: By default, `just` suppresses command echoing. Add `@` before a line to suppress its echo, or remove `@` to see it:
```just
test:
    ./run-tests.sh  # This will show the command
```

---

## Related Tutorials

- [[just-deep-dive]] — Advanced features, error handling, and optimization
- [[just-vs-make]] — Comparison with Make and when to use each
- [[docker-beginner-guide]] — Working with containers (often automated with just)
- [[ansible-beginner-guide]] — Orchestration (commonly wrapped in just recipes)
- [[linux-permissions-beginner-guide]] — Understanding shell script permissions
- [[dotfiles-beginner-guide]] — Managing configuration files with just
- [[hammerspoon-beginner-guide]] — Other automation tools for your workflow

---

## References

- **Official Documentation**: https://github.com/casey/just
- **Manual Page**: https://just.systems/
- **Casey Rodarmor's Blog**: Posts on just design and philosophy
- **Community**: GitHub Issues and Discussions for questions

---

## Summary

### Key Takeaways

1. **`just` is simple**: Recipes are just commands in a file, no special build system complexity
2. **Perfect for sysadmins**: Ideal for automating Docker workflows, deployments, backups, and maintenance
3. **Improves consistency**: Same command, same result, every time—no manual typos
4. **Easy to share**: Commit your `justfile` to git; teammates run the same recipes
5. **Powerful when needed**: Variables, arguments, dependencies, and conditionals handle complex workflows

### Next Steps

1. **Install `just`** on your system
2. **Create a `justfile`** for your most-repeated tasks
3. **Gradually expand it** as you automate more workflows
4. **Share with your team** for consistent operations
5. **Explore the [[just-deep-dive]]** when you're ready for advanced features like custom functions and error handling

### Real-World Impact

By adopting `just` in your sysadmin role, you'll:
- Reduce human error in repetitive tasks
- Onboard new team members faster (they can see what commands to run)
- Maintain consistency across environments
- Document your operations in plain, executable code

Start small with one `justfile` for your most-used commands, and grow from there.
# Related Tutorials

- [[micropython-ttgo-t-display-beginner-guide|MicroPython TTGO T-Display Beginner Guide]] — automating flash/upload/connect commands with justfiles
- [[micropython-ttgo-t-display-deep-dive|MicroPython TTGO T-Display Deep Dive]] — justfile recipes for embedded MicroPython development workflows

- [[docker-test-container-beginner-guide|Docker Test Container Beginner Guide]] — automate Docker test workflows with justfiles
- [[honeymux-beginner-guide|Honeymux Beginner Guide]] — automate Honeymux session setup with just

- [[gh-cli-beginner-guide|GitHub CLI Beginner Guide]] — GitHub CLI commands to wrap in Justfile recipes
- [[gh-cli-deep-dive|GitHub CLI Deep Dive]] — advanced `gh` + Just automation patterns
