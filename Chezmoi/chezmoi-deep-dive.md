---
title: "Chezmoi Deep Dive: Advanced Cross-Platform Dotfile Management"
date: 2026-04-13
difficulty: advanced
tags:
  - chezmoi
  - dotfiles
  - templates
  - encryption
  - cross-platform
  - macOS
  - Linux
  - automation
  - git
  - secrets-management
---

# Chezmoi Deep Dive: Advanced Cross-Platform Dotfile Management

## Overview

This reference covers chezmoi's full feature set for managing complex, multi-machine dotfile configurations. Building on the [[chezmoi-beginner-guide]], this guide explores Go templates in depth, encrypted secrets with age, run scripts for automated machine provisioning, external file sources, machine-specific configuration data, and strategies for managing dotfiles across four or more machines with different operating systems and architectures.

Chezmoi's architecture separates source state from destination state, treating your dotfiles as a declarative specification of what each machine should look like. Templates and data files make each machine's configuration derivable from a single repository. Encryption keeps secrets safe in version control. Run scripts automate everything from package installation to system preferences.

If you manage machines spanning macOS (Apple Silicon and Intel) and Linux (x86_64 and ARM), with tools like [[sesh-beginner-guide|sesh]], neovim, tmux, zsh, and git across all of them, this guide shows you how to make one repository serve them all.

---

## Prerequisites

This guide assumes you have:

- **A working chezmoi setup** from [[chezmoi-beginner-guide]] — files added, git repository pushed
- **Comfort with the command line** — shell scripting, file permissions, environment variables
- **Git proficiency** — branching, rebasing, conflict resolution
- **Understanding of dotfiles concepts** from [[dotfiles-beginner-guide]] and [[dotfiles-deep-dive]]
- **Multiple machines** (or VMs/containers) to test cross-platform configurations
- **age or GPG installed** (for encryption sections): `brew install age` or `brew install gnupg`

Verify your current setup:

```bash
chezmoi --version
chezmoi managed | wc -l   # Should show your managed files
chezmoi git log --oneline  # Should show your commit history
age --version              # For encryption (optional but recommended)
```

---

## Key Concepts

### Chezmoi's Internal Architecture

When you run `chezmoi apply`, chezmoi performs a multi-stage pipeline:

1. **Read source state** — scans `~/.local/share/chezmoi/` for all managed entries
2. **Evaluate templates** — processes `.tmpl` files using Go's `text/template` engine with chezmoi's data context
3. **Compute target state** — determines what each destination file should contain, including permissions
4. **Diff against actual state** — compares computed target with what currently exists on disk
5. **Apply changes** — writes only the files that differ, respecting file modes and ownership
6. **Execute run scripts** — runs any `run_` scripts in the correct order

This pipeline means chezmoi is idempotent — running `chezmoi apply` multiple times produces the same result. It also means you can safely preview every change before it happens with `chezmoi diff`.

### Source State Entry Types

Chezmoi supports several entry types beyond regular files:

| Prefix/Suffix | Type | Behavior |
|---------------|------|----------|
| `dot_` | Dot-prefixed file | `dot_zshrc` → `.zshrc` |
| `private_` | Private permissions | Sets file to 0600, directory to 0700 |
| `readonly_` | Read-only | Sets file to 0444 |
| `executable_` | Executable | Sets file to 0755 |
| `empty_` | Empty file | Creates an empty file if it does not exist |
| `exact_` | Exact directory | Removes files in destination not in source |
| `symlink_` | Symbolic link | Creates a symlink instead of copying |
| `.tmpl` suffix | Template | Processed through Go template engine |
| `encrypted_` | Encrypted file | Decrypted on apply using age or GPG |
| `modify_` | Modify script | Script that modifies an existing file |
| `create_` | Create-only | Only written if the destination does not exist |
| `remove_` | Remove entry | Deletes the destination file |
| `run_` | Run script | Executed rather than installed |
| `run_once_` | Run-once script | Executed once, then recorded as done |
| `run_onchange_` | Run-on-change script | Re-executed when its content hash changes |
| `before_` / `after_` | Ordering | Controls when run scripts execute relative to file changes |

These prefixes combine: `private_executable_dot_my-script.tmpl` creates an executable, private, dot-prefixed file from a template.

### Go Template Engine Deep Dive

Chezmoi templates use Go's `text/template` with additional functions. The template context includes:

```go
// Automatically available variables
.chezmoi.os          // "darwin", "linux", "windows"
.chezmoi.arch        // "amd64", "arm64"
.chezmoi.hostname    // machine hostname
.chezmoi.username    // current user
.chezmoi.homeDir     // home directory path
.chezmoi.sourceDir   // chezmoi source directory path
.chezmoi.osRelease   // Linux OS release info (distro, version)

// User-defined data from .chezmoi.toml or .chezmoidata.*
.email
.name
.enable_experimental
// ... any custom key you define
```

### Data Hierarchy and Precedence

Chezmoi merges configuration data from multiple sources (highest priority first):

1. `chezmoi init --data` flags
2. `~/.config/chezmoi/chezmoi.toml` (or `.yaml`/`.json`)
3. `.chezmoidata.toml` (in source directory)
4. `.chezmoidata/*.toml` (data directory — multiple files merged)
5. Built-in `.chezmoi.*` variables (OS, arch, hostname)

This lets you separate machine-specific overrides from shared defaults.

---

## Step-by-Step Instructions

### 1. Configuration File Setup

Create a robust chezmoi configuration at `~/.config/chezmoi/chezmoi.toml`:

```toml
# ~/.config/chezmoi/chezmoi.toml

# Source directory (default is fine for most setups)
# sourceDir = "~/.local/share/chezmoi"

# Diff and merge tools
[diff]
    pager = "delta"    # Use delta for pretty diffs (install: brew install git-delta)

[merge]
    command = "nvim"
    args = ["-d", "{{ "{{ .Destination }}" }}", "{{ "{{ .Source }}" }}", "{{ "{{ .Target }}" }}"]

# Editor
[edit]
    command = "nvim"

# Git auto-commit and push (optional convenience)
[git]
    autoCommit = false
    autoPush = false

# User-defined template data
[data]
    name = "Your Name"
    email = "you@example.com"
    github_username = "yourusername"

    # Feature flags per machine
    is_work_machine = false
    enable_experimental = false
    install_gui_apps = true

    # Machine role (set differently per machine)
    machine_role = "personal"  # "personal", "work", "server"
```

When you run `chezmoi init` on a new machine, chezmoi can prompt for these values. Create a `.chezmoi.toml.tmpl` in your source directory:

```toml
# ~/.local/share/chezmoi/.chezmoi.toml.tmpl

[data]
    name = "Your Name"
    email = {{ promptString "Email address" | quote }}
    machine_role = {{ promptChoice "Machine role" (list "personal" "work" "server") | quote }}
    is_work_machine = {{ eq (promptChoice "Machine role" (list "personal" "work" "server")) "work" }}
    install_gui_apps = {{ promptBool "Install GUI apps" }}
```

### 2. Advanced Templates

#### Conditional Blocks by OS, Architecture, and Machine Role

```bash
# dot_zshrc.tmpl

# === Common Configuration ===
export EDITOR="nvim"
export VISUAL="$EDITOR"
export LANG="en_US.UTF-8"

# Common aliases
alias ll='ls -lh'
alias la='ls -lAh'
alias gs='git status'
alias ga='git add'
alias gc='git commit'
alias gp='git push'
alias gl='git log --oneline --graph --all'
alias v='nvim'

# === OS-Specific Configuration ===

{{- if eq .chezmoi.os "darwin" }}

# macOS: Homebrew
{{- if eq .chezmoi.arch "arm64" }}
eval "$(/opt/homebrew/bin/brew shellenv)"
{{- else }}
eval "$(/usr/local/bin/brew shellenv)"
{{- end }}

# macOS aliases
alias flush-dns='sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder'
alias show-hidden='defaults write com.apple.finder AppleShowAllFiles YES; killall Finder'
alias hide-hidden='defaults write com.apple.finder AppleShowAllFiles NO; killall Finder'

{{- else if eq .chezmoi.os "linux" }}

# Linux
export PATH="/usr/local/bin:$PATH"
alias open='xdg-open'
alias pbcopy='xclip -selection clipboard'
alias pbpaste='xclip -selection clipboard -o'

{{- if eq .chezmoi.osRelease.id "ubuntu" }}
# Ubuntu-specific
alias apt-update='sudo apt update && sudo apt upgrade -y'
{{- end }}

{{- end }}

# === Machine Role Configuration ===

{{- if eq .machine_role "work" }}

# Work machine: corporate proxy, internal tools
export HTTP_PROXY="http://proxy.corp.example.com:8080"
export HTTPS_PROXY="$HTTP_PROXY"
export NO_PROXY="localhost,127.0.0.1,.corp.example.com"

{{- else if eq .machine_role "server" }}

# Server: minimal config, no GUI
export TERM="xterm-256color"

{{- end }}

# === Common PATH ===
export PATH="$HOME/.local/bin:$PATH"

# === Tool Integrations ===

# zoxide (smart cd)
eval "$(zoxide init zsh)"

# fzf
[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh
```

#### Using `include` for Modular Configs

Split large configs into reusable pieces:

```bash
# dot_zshrc.tmpl
# Core shell configuration
{{ include "shell/aliases.zsh" }}
{{ include "shell/functions.zsh" }}
{{ include "shell/path.zsh" }}

{{- if eq .chezmoi.os "darwin" }}
{{ include "shell/macos.zsh" }}
{{- end }}
```

Place the included files in your source directory under a non-managed location (prefix with `.`):

```
~/.local/share/chezmoi/
├── .chezmoitemplates/
│   └── shell/
│       ├── aliases.zsh
│       ├── functions.zsh
│       ├── path.zsh
│       └── macos.zsh
├── dot_zshrc.tmpl
└── ...
```

Files in `.chezmoitemplates/` are available to `include` but are not installed to the destination.

#### Template Functions Reference

Chezmoi extends Go templates with useful functions:

```bash
# String manipulation
{{ .chezmoi.hostname | upper }}           # MYMACHINE
{{ .email | replace "@" " at " }}         # you at example.com
{{ "hello" | quote }}                     # "hello"

# Conditional with default
{{ .some_var | default "fallback" }}

# Check if a command exists
{{ if lookPath "brew" }}
# Homebrew is available
{{ end }}

# Read output of a command (careful — runs at template time)
{{ output "hostname" "-s" | trim }}

# Check if running in a container
{{ if .chezmoi.kernel }}
# Has kernel info (Linux)
{{ end }}

# List and range
{{ range list "git" "nvim" "tmux" "zsh" }}
# Do something with {{ . }}
{{ end }}
```

### 3. Encrypted Secrets with age

Age is the recommended encryption tool for chezmoi (simpler than GPG).

#### Initial Setup

```bash
# Install age
brew install age  # macOS
sudo apt install age  # Ubuntu/Debian

# Generate a key pair
age-keygen -o ~/.config/chezmoi/key.txt
```

Expected output:

```
Public key: age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p
```

**Save the public key** — you will need it for your chezmoi config. The private key is in `~/.config/chezmoi/key.txt` — back this up securely (password manager, hardware key, etc.). **Never commit the private key to git.**

Configure chezmoi to use age:

```toml
# ~/.config/chezmoi/chezmoi.toml
[age]
    identity = "~/.config/chezmoi/key.txt"
    recipient = "age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p"
```

#### Adding Encrypted Files

```bash
# Add a file as encrypted
chezmoi add --encrypt ~/.ssh/id_ed25519

# Verify it is encrypted in the source
cat ~/.local/share/chezmoi/private_encrypted_dot_ssh/id_ed25519
# Shows age-encrypted binary/text — not your key

# Chezmoi decrypts on apply
chezmoi apply
cat ~/.ssh/id_ed25519  # Your actual key
```

#### Encrypted Templates

Combine encryption with templates for secrets that vary per machine:

```bash
# Create an encrypted template
chezmoi add --encrypt --template ~/.config/myapp/credentials.toml
chezmoi edit ~/.config/myapp/credentials.toml
```

Edit the source (chezmoi auto-decrypts for editing):

```toml
# Will be encrypted at rest in git
[api]
token = "{{ .api_token }}"
endpoint = "{{ if eq .machine_role "work" }}https://api.corp.example.com{{ else }}https://api.example.com{{ end }}"
```

Define `api_token` in your chezmoi config (which is local, not committed):

```toml
# ~/.config/chezmoi/chezmoi.toml
[data]
    api_token = "sk-abc123..."
```

### 4. Run Scripts for Automated Provisioning

Run scripts execute commands rather than installing files. They are the key to fully automated machine setup.

#### Run-Once: Install Packages on First Setup

```bash
# ~/.local/share/chezmoi/run_once_before_install-packages.sh.tmpl
#!/bin/bash
set -euo pipefail

echo "Installing packages..."

{{ if eq .chezmoi.os "darwin" -}}

# Install Homebrew if not present
if ! command -v brew &> /dev/null; then
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    {{ if eq .chezmoi.arch "arm64" -}}
    eval "$(/opt/homebrew/bin/brew shellenv)"
    {{ else -}}
    eval "$(/usr/local/bin/brew shellenv)"
    {{ end -}}
fi

# Core CLI tools
brew install \
    chezmoi \
    neovim \
    tmux \
    git \
    git-delta \
    fzf \
    zoxide \
    ripgrep \
    fd \
    bat \
    eza \
    jq \
    age \
    sesh

{{ if .install_gui_apps -}}
# GUI applications (skip on headless/server machines)
brew install --cask \
    ghostty \
    raycast \
    1password
{{ end -}}

{{ else if eq .chezmoi.os "linux" -}}

sudo apt update
sudo apt install -y \
    neovim \
    tmux \
    git \
    fzf \
    ripgrep \
    fd-find \
    bat \
    jq

# Install age from GitHub releases
if ! command -v age &> /dev/null; then
    AGE_VERSION="1.1.1"
    curl -fsSL "https://github.com/FiloSottile/age/releases/download/v${AGE_VERSION}/age-v${AGE_VERSION}-linux-amd64.tar.gz" | \
        sudo tar -xz -C /usr/local/bin --strip-components=1
fi

{{ end -}}

echo "Package installation complete."
```

The `before_` in the filename ensures packages are installed before config files are written.

#### Run-On-Change: Reload When Configs Change

```bash
# ~/.local/share/chezmoi/run_onchange_after_reload-tmux.sh.tmpl
#!/bin/bash
# Reload tmux config when it changes
# Hash: {{ include "dot_config/tmux/tmux.conf" | sha256sum }}

if command -v tmux &> /dev/null && tmux info &> /dev/null; then
    tmux source-file ~/.config/tmux/tmux.conf
    echo "tmux config reloaded."
fi
```

The `sha256sum` in the comment is the magic: chezmoi re-runs this script whenever the tmux config file changes, because the hash in the script content changes.

#### Run-Once: Set macOS Defaults

```bash
# ~/.local/share/chezmoi/run_once_after_configure-macos.sh.tmpl
#!/bin/bash
{{ if ne .chezmoi.os "darwin" -}}
# Skip on non-macOS
exit 0
{{ end -}}

set -euo pipefail
echo "Configuring macOS defaults..."

# Finder: show hidden files
defaults write com.apple.finder AppleShowAllFiles -bool true

# Dock: auto-hide
defaults write com.apple.dock autohide -bool true

# Keyboard: fast key repeat
defaults write NSGlobalDomain KeyRepeat -int 2
defaults write NSGlobalDomain InitialKeyRepeat -int 15

# Trackpad: tap to click
defaults write com.apple.AppleMultitouchTrackpad Clicking -bool true

# Restart affected apps
killall Finder Dock 2>/dev/null || true

echo "macOS defaults configured."
```

### 5. External Sources

Pull files from URLs, git repos, or archives without committing them to your dotfiles repo:

```toml
# ~/.local/share/chezmoi/.chezmoiexternal.toml

# Download a single file
[".config/nvim/spell/en.utf-8.spl"]
    type = "file"
    url = "https://ftp.nluug.nl/pub/vim/runtime/spell/en.utf-8.spl"
    refreshPeriod = "720h"  # Re-download monthly

# Clone a git repo
[".config/tmux/plugins/tpm"]
    type = "git-repo"
    url = "https://github.com/tmux-plugins/tpm.git"
    refreshPeriod = "168h"  # Weekly
    clone.args = ["--depth", "1"]
    pull.args = ["--ff-only"]

# Extract an archive
[".local/share/fonts"]
    type = "archive"
    url = "https://github.com/ryanoasis/nerd-fonts/releases/download/v3.1.1/JetBrainsMono.tar.xz"
    refreshPeriod = "720h"
    stripComponents = 0
```

### 6. Ignore Patterns for Multi-Machine Repos

Control which files apply to which machines:

```
# ~/.local/share/chezmoi/.chezmoiignore

# Ignore README (not a dotfile)
README.md
LICENSE

# OS-specific ignores
{{ if ne .chezmoi.os "darwin" }}
# Don't apply macOS-specific configs on Linux
.config/ghostty/
run_once_after_configure-macos.sh
{{ end }}

{{ if ne .chezmoi.os "linux" }}
# Don't apply Linux-specific configs on macOS
.config/i3/
.config/sway/
{{ end }}

{{ if eq .machine_role "server" }}
# Servers don't need GUI configs
.config/ghostty/
.config/sesh/
{{ end }}
```

### 7. Keeping Machines in Sync — Daily Workflow

The day-to-day workflow across multiple machines:

```bash
# === On machine where you made changes ===

# See what changed
chezmoi diff

# Re-add any files edited outside chezmoi
chezmoi re-add

# Commit and push
chezmoi git add .
chezmoi git commit -- -m "Update zsh: add work proxy config"
chezmoi git push

# === On other machines ===

# Pull and apply in one command
chezmoi update

# Or preview first
chezmoi update --dry-run
chezmoi update
```

For automated daily sync, consider a cron job or systemd timer:

```bash
# crontab -e
0 9 * * * chezmoi update --no-tty 2>&1 | logger -t chezmoi
```

### 8. Verify and Debug

```bash
# Show the full computed config
chezmoi data | less

# Show what a template would produce
chezmoi execute-template '{{ .chezmoi.os }} {{ .chezmoi.arch }}'

# Doctor: check for common issues
chezmoi doctor

# Show the source path for a destination file
chezmoi source-path ~/.zshrc

# Cat the computed target (after template processing)
chezmoi cat ~/.zshrc

# Dump the entire target state
chezmoi dump
```

---

## Practical Examples

### Example 1: Complete .gitconfig with OS-Aware Settings

```ini
# dot_gitconfig.tmpl

[user]
    name = {{ .name }}
    email = {{ .email }}

[core]
    editor = nvim
    pager = delta
    excludesfile = ~/.gitignore_global
{{- if eq .chezmoi.os "darwin" }}
    # macOS: use Keychain for credentials
    credentialHelper = osxkeychain
{{- end }}

[alias]
    st = status
    co = checkout
    br = branch
    lg = log --graph --oneline --all --decorate
    unstage = reset HEAD --
    last = log -1 HEAD
    wt = worktree

[push]
    default = current
    autoSetupRemote = true

[pull]
    rebase = true

[init]
    defaultBranch = main

[delta]
    navigate = true
    side-by-side = true
    line-numbers = true

{{- if eq .machine_role "work" }}

[http]
    proxy = {{ .http_proxy | default "" }}

[url "git@github.corp.example.com:"]
    insteadOf = https://github.corp.example.com/
{{- end }}
```

### Example 2: Neovim Config with Plugin Toggles

```lua
-- dot_config/nvim/init.lua.tmpl

-- Basic settings
vim.opt.number = true
vim.opt.relativenumber = true
vim.opt.tabstop = 2
vim.opt.shiftwidth = 2
vim.opt.expandtab = true
vim.opt.termguicolors = true
vim.opt.signcolumn = "yes"

-- Leader key
vim.g.mapleader = " "

-- {{ if eq .chezmoi.os "darwin" -}}
-- macOS: use system clipboard
vim.opt.clipboard = "unnamedplus"
-- {{ end -}}

-- Key mappings
vim.keymap.set('n', '<leader>w', ':w<CR>')
vim.keymap.set('n', '<leader>q', ':q<CR>')
vim.keymap.set('n', '<leader>e', ':Ex<CR>')

-- {{ if ne .machine_role "server" -}}
-- Full plugin setup (skip on servers)
local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not vim.loop.fs_stat(lazypath) then
  vim.fn.system({
    "git", "clone", "--filter=blob:none",
    "https://github.com/folke/lazy.nvim.git",
    "--branch=stable", lazypath,
  })
end
vim.opt.rtp:prepend(lazypath)

require("lazy").setup({
  { "nvim-treesitter/nvim-treesitter", build = ":TSUpdate" },
  { "nvim-telescope/telescope.nvim", dependencies = { "nvim-lua/plenary.nvim" } },
  { "neovim/nvim-lspconfig" },
})
-- {{ end -}}
```

### Example 3: SSH Config with Per-Machine Hosts

```bash
# private_dot_ssh/config.tmpl

# Global defaults
Host *
    AddKeysToAgent yes
    IdentitiesOnly yes
{{- if eq .chezmoi.os "darwin" }}
    UseKeychain yes
{{- end }}

# GitHub
Host github.com
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519

{{- if eq .machine_role "work" }}

# Work servers
Host *.corp.example.com
    User {{ .chezmoi.username }}
    IdentityFile ~/.ssh/id_work
    ProxyJump bastion.corp.example.com

Host bastion.corp.example.com
    User {{ .chezmoi.username }}
    IdentityFile ~/.ssh/id_work
{{- end }}

{{- range .extra_ssh_hosts | default list }}
# Extra host: {{ .name }}
Host {{ .alias }}
    HostName {{ .hostname }}
    User {{ .user }}
    IdentityFile {{ .key }}
{{- end }}
```

Define extra hosts per machine in `chezmoi.toml`:

```toml
[[data.extra_ssh_hosts]]
name = "Raspberry Pi"
alias = "pi"
hostname = "192.168.1.100"
user = "pi"
key = "~/.ssh/id_ed25519"
```

### Example 4: Sesh Config Adapted per Machine

```toml
# dot_config/sesh/sesh.toml.tmpl

[default_session]
startup_command = "nvim"

{{- if ne .machine_role "server" }}

[[session]]
name = "dotfiles"
path = "{{ .chezmoi.homeDir }}/dotfiles"
startup_command = "nvim"

{{- end }}

{{- if eq .machine_role "personal" }}

[[session]]
name = "notes"
path = "{{ .chezmoi.homeDir }}/Documents/notes"
startup_command = "nvim"

{{- end }}

{{- if eq .machine_role "work" }}

[[session]]
name = "work-monorepo"
path = "{{ .chezmoi.homeDir }}/work/monorepo"
startup_command = "nvim"
windows = [
  { name = "editor", startup_command = "nvim" },
  { name = "test", startup_command = "make test-watch" },
  { name = "logs", startup_command = "tail -f /var/log/app.log" }
]

{{- end }}
```

### Example 5: Bootstrap Script with Chezmoi One-Liner

For brand new machines, create a bootstrap script hosted on your repo:

```bash
# bootstrap.sh (hosted at https://raw.githubusercontent.com/you/dotfiles/main/bootstrap.sh)
#!/bin/bash
set -euo pipefail

echo "=== Dotfiles Bootstrap ==="

# Install chezmoi
if ! command -v chezmoi &> /dev/null; then
    sh -c "$(curl -fsLS get.chezmoi.io)" -- -b "$HOME/.local/bin"
    export PATH="$HOME/.local/bin:$PATH"
fi

# Initialize and apply
chezmoi init --apply yourusername

echo "=== Bootstrap complete. Restart your shell. ==="
```

On a new machine:

```bash
curl -fsSL https://raw.githubusercontent.com/yourusername/dotfiles/main/bootstrap.sh | bash
```

---

## Hands-On Exercises

### Exercise 1: Convert All Configs to Templates (30 minutes)

1. List all managed files: `chezmoi managed`
2. For each file that has OS-specific content, convert to a template:
   ```bash
   chezmoi chattr +template ~/.zshrc
   chezmoi chattr +template ~/.gitconfig
   chezmoi chattr +template ~/.config/sesh/sesh.toml
   ```
3. Add `{{ if eq .chezmoi.os "darwin" }}` blocks for macOS-specific lines
4. Test each template: `chezmoi execute-template < source-file`
5. Apply and verify: `chezmoi apply -v`

**Success criteria:** `chezmoi diff` shows no changes on your current machine, and the templates would produce correct output for both macOS and Linux (test with `chezmoi execute-template`).

### Exercise 2: Set Up Encrypted Secrets (20 minutes)

1. Install age: `brew install age`
2. Generate a key: `age-keygen -o ~/.config/chezmoi/key.txt`
3. Add the recipient to `chezmoi.toml`
4. Add an encrypted file: `chezmoi add --encrypt ~/.ssh/config`
5. Verify it is encrypted in source: `cat $(chezmoi source-path ~/.ssh/config)`
6. Verify it decrypts on apply: `chezmoi cat ~/.ssh/config`
7. Commit the encrypted file to git

**Success criteria:** The source file is unreadable (encrypted), but `chezmoi cat` and `chezmoi apply` produce the correct plaintext.

### Exercise 3: Create a Run-Once Package Installer (20 minutes)

1. Create `run_once_before_install-packages.sh.tmpl` in your source directory
2. Add Homebrew/apt package installation with OS conditionals
3. Test with `chezmoi apply --dry-run` (look for script execution in output)
4. Apply: `chezmoi apply -v`
5. Verify packages installed

**Success criteria:** Running `chezmoi apply` a second time does NOT re-run the script (it was recorded as completed).

### Exercise 4: Apply on a Second Machine (20 minutes)

1. On a second machine (VM, container, or actual computer), install chezmoi
2. Run: `chezmoi init --apply git@github.com:yourusername/dotfiles.git`
3. When prompted, enter your machine-specific data (email, role, etc.)
4. Verify your shell loads correctly, git config is set, editor opens with your settings
5. Check that OS-specific sections rendered correctly

**Success criteria:** A fully configured development environment from a single command.

---

## Troubleshooting

### Template Produces Wrong Output

**Diagnosis:**

```bash
# See all available template data
chezmoi data

# Test a specific template
chezmoi execute-template '{{ .chezmoi.os }} {{ .chezmoi.arch }} {{ .machine_role }}'

# Test the full file
chezmoi execute-template < $(chezmoi source-path ~/.zshrc)
```

**Common causes:**
- Variable not defined in `chezmoi.toml` — add it to `[data]`
- Typo in variable name — check with `chezmoi data | grep varname`
- Wrong template syntax — `{{ eq .a "b" }}` not `{{ .a == "b" }}`

### Encryption Key Not Found on New Machine

**Problem:** `chezmoi apply` fails with "no identity" error.

**Solution:** Copy your age key to the new machine:

```bash
# From the old machine, securely copy the key
scp ~/.config/chezmoi/key.txt user@newmachine:~/.config/chezmoi/key.txt

# Or use a password manager to transfer it
# Then verify
chezmoi doctor
```

**Never commit the age private key to git.** Store it in your password manager.

### Run Script Keeps Re-Running

**Problem:** A `run_once_` script executes every time you `chezmoi apply`.

**Cause:** The script content is a template that produces different output each time (e.g., includes a timestamp).

**Solution:** Ensure the rendered content is deterministic. Remove any dynamic elements:

```bash
# Bad — changes every run
#!/bin/bash
# Generated at {{ now }}

# Good — static content
#!/bin/bash
# Package installer v1
```

Check run script state:

```bash
chezmoi state dump | grep run_once
```

### Merge Conflicts During chezmoi update

**Problem:** `chezmoi update` fails with git conflicts.

**Solution:**

```bash
# Enter the source directory
chezmoi cd

# Resolve git conflicts manually
git status
# Edit conflicted files
git add .
git commit -m "Resolve merge conflicts"

# Return and apply
exit
chezmoi apply
```

### chezmoi doctor Shows Warnings

Run the diagnostic tool regularly:

```bash
chezmoi doctor
```

Common warnings and fixes:

- "age not found in PATH" → `brew install age`
- "git not configured" → set `[git]` section in `chezmoi.toml`
- "source directory not a git repo" → `chezmoi cd && git init`

---

## References

- **Chezmoi Documentation:** https://www.chezmoi.io/
- **Chezmoi User Guide:** https://www.chezmoi.io/user-guide/command-overview/
- **Chezmoi Reference:** https://www.chezmoi.io/reference/
- **Go text/template Documentation:** https://pkg.go.dev/text/template
- **age Encryption:** https://github.com/FiloSottile/age
- **Chezmoi GitHub Discussions:** https://github.com/twpayne/chezmoi/discussions
- **Chezmoi Example Dotfile Repos:** https://www.chezmoi.io/links/dotfile-repos/

---

## Related Tutorials

- [[chezmoi-beginner-guide|Chezmoi Beginner Guide]] — Start here for initial setup and basic usage
- [[dotfiles-beginner-guide|Dotfiles Beginner Guide]] — Foundational dotfiles concepts and comparison of management approaches
- [[dotfiles-deep-dive|Dotfiles Deep Dive]] — Comprehensive coverage including GNU Stow, bare git repos, and XDG specification
- [[dotfiles-tool-questionnaire|Dotfiles Tool Questionnaire]] — The decision guide for choosing a dotfile management tool
- [[sesh-beginner-guide|Sesh Beginner Guide]] — Managing sesh.toml as a chezmoi-managed dotfile
- [[sesh-deep-dive|Sesh Deep Dive]] — Advanced sesh configuration and scripting
- [[git-worktrees-worktrunk-beginner-guide|Git Worktrees Beginner Guide]] — Using worktrees with your dotfiles repository
- [[worktrunk-beginner-guide|Worktrunk Beginner Guide]] — Simplified git worktree management
- [[worktrunk-deep-dive|Worktrunk Deep Dive]] — Advanced worktree patterns and automation
- [[karabiner-elements-beginner-guide|Karabiner-Elements Beginner Guide]] and [[karabiner-elements-deep-dive|Karabiner-Elements Deep Dive]] — `~/.config/karabiner` benefits from chezmoi templates for per-device keyboard rules

---

## Summary

Chezmoi transforms dotfile management from a collection of scripts and symlinks into a declarative, reproducible system. The key architectural ideas to internalize:

1. **Source state is truth.** Your `~/.local/share/chezmoi/` directory is the single source of truth. Every machine derives its configuration from it. Never edit destination files directly — always use `chezmoi edit`.

2. **Templates eliminate branching.** Instead of maintaining separate branches or repos per machine, use Go templates with `.chezmoi.os`, `.chezmoi.arch`, and custom data variables. One repository, many machines.

3. **Encryption belongs in the repo.** With age encryption, you can safely commit SSH keys, API tokens, and credentials to your dotfiles repository. The encrypted blobs are useless without your private key.

4. **Run scripts automate provisioning.** Package installation, macOS defaults, font setup — anything that runs once or on config change can be a run script. Combined with templates, this gives you a single `chezmoi init --apply` command for complete machine setup.

5. **The workflow is git.** At its core, chezmoi wraps a git repository. You commit, push, pull, and merge just like any other project. `chezmoi update` on each machine keeps everything in sync.

6. **Start simple, grow incrementally.** Begin with plain files, convert to templates when you need cross-platform support, add encryption when you need secrets, add run scripts when you want automation. Each feature is independent.

For ongoing maintenance, run `chezmoi doctor` periodically, use `chezmoi diff` before every `chezmoi apply`, and keep your `chezmoi.toml` data section well-documented so setting up a new machine is a smooth experience.
# Related Tutorials

- [[docker-test-container-beginner-guide|Docker Test Container Beginner Guide]] and [[docker-test-container-deep-dive|Docker Test Container Deep Dive]] — test chezmoi-managed dotfiles in Docker containers before deploying
- [[honeymux-beginner-guide|Honeymux Beginner Guide]] and [[honeymux-deep-dive|Honeymux Deep Dive]] — tmux TUI wrapper with configs manageable via chezmoi
- [[ssh-tutorial|SSH Tutorial]]
- [[ssh-config-deep-dive|SSH Config Deep Dive]]