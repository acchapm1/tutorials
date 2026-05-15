---
title: "Chezmoi Beginner Guide: Cross-Platform Dotfile Management"
date: 2026-04-13
difficulty: beginner
tags:
  - chezmoi
  - dotfiles
  - configuration
  - macOS
  - Linux
  - cross-platform
  - git
---

# Chezmoi Beginner Guide: Cross-Platform Dotfile Management

## Overview

Chezmoi (pronounced "shay-mwa," French for "at my place") is a dotfile manager that keeps your personal configuration files consistent across every machine you use. Unlike simpler symlink-based tools, chezmoi copies files from a source directory to their correct locations, which means it can transform files on the fly using templates, encrypt secrets, and run setup scripts automatically.

If you manage dotfiles across macOS and Linux machines — possibly with different architectures like Apple Silicon and x86_64 — chezmoi handles the differences for you. You write one set of configuration files with optional conditional sections, and chezmoi figures out what belongs on each machine.

This guide walks you through installing chezmoi, adding your first dotfiles, pushing them to a git repository, and applying them on a second machine. By the end you will have a working cross-platform dotfiles setup that you can extend over time.

If you are new to dotfiles in general, start with [[dotfiles-beginner-guide]] for foundational concepts like symlinks, the XDG specification, and repository patterns. This guide assumes you understand what dotfiles are and focuses specifically on using chezmoi to manage them.

---

## Prerequisites

Before starting, make sure you have the following ready:

- **Git** (version 2.20 or later) installed and configured with your name and email
- **A GitHub or GitLab account** with SSH access configured for pushing repositories
- **A terminal** you are comfortable working in — zsh, bash, or similar
- **macOS (10.15+) or Linux** as your operating system
- **Homebrew** (on macOS) or curl (on Linux) for installation
- **Familiarity with basic dotfiles concepts** from [[dotfiles-beginner-guide]]

Verify your setup:

```bash
git --version
# Expected: git version 2.39.0 or later

echo $SHELL
# Expected: /bin/zsh or /bin/bash

ssh -T git@github.com
# Expected: Hi username! You've successfully authenticated...
```

---

## Key Concepts

### Source State vs. Destination State

Chezmoi introduces a two-directory model:

- **Source state**: your dotfiles stored in `~/.local/share/chezmoi/` (a git repository you control)
- **Destination state**: the actual files on your system (e.g., `~/.zshrc`, `~/.config/nvim/init.lua`)

When you run `chezmoi apply`, chezmoi reads the source state, processes any templates, and writes the result to the destination. This is different from symlink tools like GNU Stow — chezmoi creates real files, not links.

```
Source: ~/.local/share/chezmoi/dot_zshrc
  ↓ chezmoi apply
Destination: ~/.zshrc
```

### File Naming Conventions

Chezmoi uses special prefixes in filenames to indicate how files should be handled:

| Source filename | Destination | Meaning |
|----------------|-------------|---------|
| `dot_zshrc` | `~/.zshrc` | `dot_` becomes `.` |
| `dot_config/nvim/init.lua` | `~/.config/nvim/init.lua` | Nested directories work naturally |
| `dot_zshrc.tmpl` | `~/.zshrc` | `.tmpl` means it is a Go template |
| `private_dot_ssh/config` | `~/.ssh/config` (mode 0600) | `private_` sets restrictive permissions |
| `run_once_install-packages.sh` | (executed once) | `run_once_` scripts run one time only |
| `encrypted_private_key.age` | (decrypted on apply) | `encrypted_` stores secrets safely |

You rarely type these names manually — `chezmoi add` creates them for you.

### Templates for Cross-Platform Configs

Templates let you write one file that adapts to each machine. Chezmoi uses Go's `text/template` syntax:

```
{{ if eq .chezmoi.os "darwin" }}
# macOS-specific line
{{ else if eq .chezmoi.os "linux" }}
# Linux-specific line
{{ end }}
```

Chezmoi automatically provides variables like `.chezmoi.os`, `.chezmoi.arch`, `.chezmoi.hostname`, and you can define your own in a config file.

### The Apply Workflow

The core workflow is always the same:

1. **Edit** the source state (either directly or with `chezmoi edit`)
2. **Preview** changes with `chezmoi diff`
3. **Apply** changes with `chezmoi apply`
4. **Commit** to git with `chezmoi git add . && chezmoi git commit`

---

## Step-by-Step Instructions

### Step 1: Install Chezmoi

**macOS (Homebrew):**

```bash
brew install chezmoi
```

**Linux (curl one-liner):**

```bash
sh -c "$(curl -fsLS get.chezmoi.io)"
```

**Linux (Homebrew on Linux):**

```bash
brew install chezmoi
```

Verify the installation:

```bash
chezmoi --version
```

Expected output:

```
chezmoi version v2.47.1, commit ..., built at ...
```

### Step 2: Initialize Chezmoi

Run the init command to create the source directory:

```bash
chezmoi init
```

This creates `~/.local/share/chezmoi/` as a new git repository. Inspect it:

```bash
ls -la ~/.local/share/chezmoi/
```

Expected output:

```
total 0
drwxr-xr-x  3 user  staff   96 Apr 13 10:00 .
drwxr-xr-x  5 user  staff  160 Apr 13 10:00 ..
drwxr-xr-x  9 user  staff  288 Apr 13 10:00 .git
```

### Step 3: Add Your First Dotfiles

Use `chezmoi add` to bring existing files under management:

```bash
# Add your shell config
chezmoi add ~/.zshrc

# Add git configuration
chezmoi add ~/.gitconfig

# Add an entire directory (neovim config)
chezmoi add ~/.config/nvim

# Add tmux config
chezmoi add ~/.config/tmux/tmux.conf

# Add sesh config
chezmoi add ~/.config/sesh/sesh.toml

# Add SSH config (chezmoi auto-detects private permissions)
chezmoi add ~/.ssh/config
```

Check what chezmoi is now managing:

```bash
chezmoi managed
```

Expected output:

```
.config/nvim/init.lua
.config/nvim/lua/config.lua
.config/sesh/sesh.toml
.config/tmux/tmux.conf
.gitconfig
.ssh/config
.zshrc
```

### Step 4: Inspect the Source Directory

See how chezmoi stored your files:

```bash
ls -la ~/.local/share/chezmoi/
```

Expected output:

```
dot_config/
├── nvim/
│   ├── init.lua
│   └── lua/
│       └── config.lua
├── sesh/
│   └── sesh.toml
└── tmux/
    └── tmux.conf
dot_gitconfig
dot_zshrc
private_dot_ssh/
└── config
```

Notice how `~/.zshrc` became `dot_zshrc` and `~/.ssh/config` became `private_dot_ssh/config`.

### Step 5: Edit a Managed File

Use `chezmoi edit` to modify files in the source state:

```bash
chezmoi edit ~/.zshrc
```

This opens the source copy in your `$EDITOR`. Make a change (for example, add an alias), save, and close. Then preview and apply:

```bash
# See what would change
chezmoi diff

# Apply the changes
chezmoi apply -v
```

The `-v` flag shows verbose output so you can see exactly what was written.

### Step 6: Push to a Remote Repository

Create a new empty repository on GitHub (e.g., `dotfiles` or `dotfiles-chezmoi`), then push:

```bash
# Navigate to the chezmoi source directory
chezmoi cd

# Add the remote
git remote add origin git@github.com:yourusername/dotfiles.git

# Commit everything
git add .
git commit -m "Initial chezmoi dotfiles: zsh, git, nvim, tmux, sesh, ssh"

# Push
git push -u origin main

# Return to your previous directory
exit
```

Alternatively, use chezmoi's built-in git passthrough:

```bash
chezmoi git -- remote add origin git@github.com:yourusername/dotfiles.git
chezmoi git add .
chezmoi git commit -- -m "Initial chezmoi dotfiles"
chezmoi git push -- -u origin main
```

### Step 7: Apply on a New Machine

On a fresh macOS or Linux machine, run a single command:

```bash
chezmoi init --apply git@github.com:yourusername/dotfiles.git
```

This clones your repository, initializes chezmoi, and applies all your dotfiles in one step. Your shell config, git settings, editor setup, and terminal preferences are all instantly available.

If you prefer to preview first:

```bash
chezmoi init git@github.com:yourusername/dotfiles.git
chezmoi diff
chezmoi apply
```

### Step 8: Keep Machines in Sync

When you change dotfiles on one machine, commit and push:

```bash
chezmoi git add .
chezmoi git commit -- -m "Update zsh aliases"
chezmoi git push
```

On another machine, pull and apply:

```bash
chezmoi update
```

The `update` command pulls the latest changes from the remote and applies them. If there are conflicts, chezmoi shows a diff and lets you resolve them with `chezmoi merge`.

---

## Practical Examples

### Example 1: Adding Shell Aliases That Work Everywhere

Create a `.zshrc` that works on both macOS and Linux:

```bash
chezmoi edit ~/.zshrc
```

Add platform-aware content. After editing, the source file at `~/.local/share/chezmoi/dot_zshrc` might look like:

```bash
# Common aliases
alias ll='ls -lh'
alias gs='git status'
alias ga='git add'
alias gc='git commit'
alias gp='git push'

# Editor
export EDITOR="nvim"

# Path additions
export PATH="$HOME/.local/bin:$PATH"
```

Apply and verify:

```bash
chezmoi apply
source ~/.zshrc
ll  # Should work
```

### Example 2: Adding Neovim Configuration

If your neovim config is a directory with multiple files:

```bash
chezmoi add ~/.config/nvim
```

This adds the entire directory tree. Any future edits:

```bash
chezmoi edit ~/.config/nvim/init.lua
chezmoi apply
```

### Example 3: Managing Your Sesh Config

Your [[sesh-beginner-guide|sesh]] configuration lives at `~/.config/sesh/sesh.toml`:

```bash
chezmoi add ~/.config/sesh/sesh.toml
chezmoi edit ~/.config/sesh/sesh.toml
```

Edit it to add your project sessions, then apply:

```bash
chezmoi apply -v
```

### Example 4: First Template — OS-Specific PATH

Convert your `.zshrc` to a template to handle macOS vs. Linux differences:

```bash
# Convert to a template
chezmoi chattr +template ~/.zshrc
```

Now edit it:

```bash
chezmoi edit ~/.zshrc
```

The file is now `dot_zshrc.tmpl`. Add conditional sections:

```bash
# Common settings
export EDITOR="nvim"
alias ll='ls -lh'

{{ if eq .chezmoi.os "darwin" -}}
# macOS: Homebrew on Apple Silicon
export PATH="/opt/homebrew/bin:$PATH"
alias flush-dns='sudo dscacheutil -flushcache'
{{ else if eq .chezmoi.os "linux" -}}
# Linux: standard paths
export PATH="/usr/local/bin:$PATH"
alias open='xdg-open'
{{ end -}}

# Common PATH additions
export PATH="$HOME/.local/bin:$PATH"
```

Test the template output without applying:

```bash
chezmoi execute-template < ~/.local/share/chezmoi/dot_zshrc.tmpl
```

Then apply:

```bash
chezmoi diff
chezmoi apply
```

### Example 5: Quick Status Check

See what has changed since your last apply:

```bash
chezmoi status
```

Output codes: `A` = added, `M` = modified, `D` = deleted, `R` = running script needed.

---

## Hands-On Exercises

### Exercise 1: Basic Setup (15 minutes)

1. Install chezmoi on your current machine
2. Run `chezmoi init`
3. Add your `.zshrc` (or `.bashrc`) and `.gitconfig`
4. Run `chezmoi managed` to verify
5. Make a small change with `chezmoi edit ~/.zshrc`
6. Preview with `chezmoi diff`
7. Apply with `chezmoi apply -v`
8. Commit: `chezmoi git add . && chezmoi git commit -- -m "First dotfiles"`

**Success criteria:** `chezmoi managed` shows your files, and `chezmoi diff` shows no pending changes after apply.

### Exercise 2: Push and Clone (15 minutes)

1. Create a new repository on GitHub called `dotfiles`
2. Push your chezmoi source to it (see Step 6 above)
3. On a different machine (or a VM/container), run:
   ```bash
   chezmoi init --apply git@github.com:yourusername/dotfiles.git
   ```
4. Verify your shell config loaded: open a new terminal and check your aliases

**Success criteria:** Your aliases and editor config work on the second machine.

### Exercise 3: Create Your First Template (10 minutes)

1. Convert `.zshrc` to a template: `chezmoi chattr +template ~/.zshrc`
2. Add an `{{ if eq .chezmoi.os "darwin" }}` block with a macOS-only alias
3. Test with `chezmoi execute-template`
4. Apply and verify the alias works (or does not appear on Linux)

**Success criteria:** `chezmoi cat-config` shows the rendered output appropriate for your OS.

---

## Troubleshooting

### "chezmoi: command not found"

**Cause:** Chezmoi is not installed or not in your PATH.

**Solution:**

```bash
# macOS
brew install chezmoi

# Linux — installs to ~/.local/bin
sh -c "$(curl -fsLS get.chezmoi.io)"

# Make sure ~/.local/bin is in your PATH
export PATH="$HOME/.local/bin:$PATH"
```

### "chezmoi apply" shows unexpected diffs

**Cause:** The destination file was edited directly instead of through `chezmoi edit`.

**Solution:**

```bash
# See the diff
chezmoi diff

# Option 1: Accept the source version (overwrite local changes)
chezmoi apply

# Option 2: Re-add the local version to source
chezmoi re-add
```

Use `chezmoi re-add` when you intentionally edited the file outside of chezmoi and want to keep those changes.

### Template syntax error

**Cause:** Malformed Go template syntax.

**Solution:**

```bash
# Test the template in isolation
chezmoi execute-template < ~/.local/share/chezmoi/dot_zshrc.tmpl

# Common mistakes:
# - Missing {{ end }} to close an if block
# - Using = instead of eq for comparison
# - Forgetting quotes around string values: eq .chezmoi.os "darwin"
```

### "chezmoi add" refuses a file

**Cause:** The file is in a location chezmoi considers dangerous (e.g., root-owned files).

**Solution:**

```bash
# Use --force if you are sure
chezmoi add --force /path/to/file

# Or add it manually by creating the source file
chezmoi cd
mkdir -p dot_config/myapp
cp ~/.config/myapp/config dot_config/myapp/config
```

### SSH key permissions are wrong after apply

**Cause:** Chezmoi created the file but did not set restrictive permissions.

**Solution:** Use the `private_` prefix:

```bash
# Re-add with correct detection
chezmoi forget ~/.ssh/config
chezmoi add ~/.ssh/config
# chezmoi auto-detects .ssh and uses private_ prefix

# Verify
ls -la ~/.local/share/chezmoi/private_dot_ssh/
```

---

## References

- **Chezmoi Official Documentation:** https://www.chezmoi.io/
- **Chezmoi Quick Start:** https://www.chezmoi.io/quick-start/
- **Chezmoi GitHub Repository:** https://github.com/twpayne/chezmoi
- **Go Template Documentation:** https://pkg.go.dev/text/template
- **Chezmoi User Guide:** https://www.chezmoi.io/user-guide/command-overview/

---

## Related Tutorials

- [[dotfiles-beginner-guide|Dotfiles Beginner Guide]] — Foundational dotfiles concepts, symlinks, and repository patterns
- [[dotfiles-deep-dive|Dotfiles Deep Dive]] — Advanced dotfile management including GNU Stow, bare git repos, and architecture comparisons
- [[dotfiles-tool-questionnaire|Dotfiles Tool Questionnaire]] — The decision questionnaire that led to choosing chezmoi
- [[chezmoi-deep-dive|Chezmoi Deep Dive]] — Advanced chezmoi: templates, encryption, run scripts, and multi-machine strategies
- [[sesh-beginner-guide|Sesh Beginner Guide]] — Terminal session manager whose config is a great dotfile to manage
- [[sesh-deep-dive|Sesh Deep Dive]] — Advanced sesh configuration
- [[git-worktrees-worktrunk-beginner-guide|Git Worktrees Beginner Guide]] — Git worktrees for managing your dotfiles branches
- [[worktrunk-beginner-guide|Worktrunk Beginner Guide]] — Simplified git worktree management
- [[worktrunk-deep-dive|Worktrunk Deep Dive]] — Advanced worktree patterns
- [[macos-app-layout-beginner-guide|macOS App Layout Beginner Guide]] — Syncing `.bunch` files and Moom exports across Macs
- [[macos-app-layout-deep-dive|macOS App Layout Deep Dive]] — Advanced window-layout automation
- [[bunch-beginner-guide|Bunch Beginner Guide]] — Bunch fundamentals for macOS developers
- [[bunch-deep-dive|Bunch Deep Dive]] — Templating `.bunch` files per host
- [[moom-beginner-guide|Moom Beginner Guide]] — Window management basics
- [[moom-deep-dive|Moom Deep Dive]] — Per-host Moom snapshot management
- [[karabiner-elements-beginner-guide|Karabiner-Elements Beginner Guide]] — Karabiner config at `~/.config/karabiner` is a great chezmoi candidate
- [[karabiner-elements-deep-dive|Karabiner-Elements Deep Dive]] — Per-device rules benefit from chezmoi templates across machines

---

## Summary

Chezmoi gives you a single command to set up any new machine with your complete development environment. The key workflow is straightforward: `chezmoi add` to track files, `chezmoi edit` to make changes, `chezmoi diff` to preview, and `chezmoi apply` to write them. Push to git and run `chezmoi init --apply` on any new machine.

The main things to remember as you get started:

1. Always use `chezmoi edit` instead of editing destination files directly — this keeps source and destination in sync.
2. Use `chezmoi diff` before `chezmoi apply` until you are confident in your setup.
3. Start simple — add your shell config and gitconfig first, then expand to editor and terminal configs.
4. Templates come later — get comfortable with the basic add/edit/apply cycle before introducing `{{ if }}` blocks.
5. Commit often — your chezmoi source directory is a git repo, so commit after every meaningful change.

When you are ready for templates, encrypted secrets, run scripts, and multi-machine strategies, continue to [[chezmoi-deep-dive|Chezmoi Deep Dive]].
# Related Tutorials

- [[docker-test-container-beginner-guide|Docker Test Container Beginner Guide]] — test chezmoi-managed dotfiles safely in containers
- [[honeymux-beginner-guide|Honeymux Beginner Guide]] — tmux TUI wrapper whose config can be managed with chezmoi
- [[ssh-tutorial|SSH Tutorial]]
- [[ssh-config-deep-dive|SSH Config Deep Dive]]