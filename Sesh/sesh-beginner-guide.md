---
title: Sesh Beginner's Guide
date: 2026-04-11
difficulty: beginner
tags: [sesh, tmux, terminal, session-management, zoxide, workflow]
---

# Sesh Beginner's Guide: Smart Terminal Session Management

## Overview

**Sesh** is a smart tmux session manager written in Go by Josh Medeski that makes terminal session management effortless. Instead of manually naming and organizing your tmux sessions, sesh automatically creates meaningful session names based on your current directory, git repository, or git remote. It integrates seamlessly with zoxide (a smart directory jumping tool) and your existing tmux setup.

### Why Sesh Matters

If you work with multiple projects or directories, you know how tedious it is to:
- Remember which tmux session corresponds to which project
- Type long, complicated session names
- Recreate the same session setup repeatedly

Sesh solves these problems by creating sessions automatically, naming them intelligently, and letting you switch between them with a simple keybinding.

### What You'll Learn

By the end of this guide, you'll understand:
- How sesh improves your tmux workflow
- How to install and configure sesh
- How to integrate sesh with fzf or television for quick session switching
- How to create custom session configurations
- Real-world usage patterns from productive developers

---

## Prerequisites

Before starting, ensure you have:

1. **tmux** installed (v2.6 or later)
   ```bash
   tmux -V
   ```
   If not installed: `brew install tmux` (macOS) or `sudo apt install tmux` (Linux)

2. **zoxide** installed (v0.5 or later)
   ```bash
   zoxide --version
   ```
   Install: `brew install zoxide` (macOS) or see https://github.com/ajeetdsouv/zoxide

3. **Homebrew**, **Go**, or package manager access for installation

4. **Basic terminal skills** — familiarity with tmux basics is helpful but not required

5. *Optional*: **fzf** (fuzzy finder) for enhanced session picking

---

## Key Concepts

### Understanding tmux Sessions

A tmux session is a container for windows and panes — it persists even if you disconnect. Instead of managing multiple terminal tabs, tmux lets you organize work into sessions.

```
Session "work-project"
├── Window 0: editor
├── Window 1: tests
└── Window 2: logs

Session "dotfiles"
├── Window 0: config
└── Window 1: scripts
```

### zoxide: Smart Directory Navigation

zoxide tracks which directories you visit frequently and remembers them. Unlike `cd`, zoxide uses "frecency" — a combination of frequency and recency — to let you jump to directories with partial names.

```bash
z work          # Jump to frequently visited work directory
z proj          # Jump to a project directory
```

### How Sesh Combines Them

Sesh bridges tmux and zoxide by automatically creating session names from:
- **Git repository name** (if in a git repo): `my-app`
- **Remote name** (if connected to a remote): `user@server`
- **Directory name** (fallback): `downloads`
- **Git worktree name** (if using worktrees): `feature-branch` (see [[git-worktrees-worktrunk-beginner-guide]])

This means you spend less time managing sessions and more time coding.

---

## Step-by-Step Instructions

### Step 1: Install tmux and zoxide

**macOS:**
```bash
brew install tmux zoxide
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt install tmux
curl -sS https://raw.githubusercontent.com/ajeetdsouv/zoxide/main/install.sh | bash
```

**Verify installations:**
```bash
tmux -V
zoxide --version
```

Expected output:
```
tmux 3.3a
zoxide 0.9.2
```

### Step 2: Install Sesh

**Option 1: Homebrew (macOS/Linux)**
```bash
brew install sesh
```

**Option 2: Go**
```bash
go install github.com/joshmedeski/sesh/v2@latest
```

**Option 3: AUR (Arch Linux)**
```bash
yay -S sesh
```

**Option 4: Conda**
```bash
conda install -c conda-forge sesh
```

**Verify installation:**
```bash
sesh --version
```

### Step 3: Learn Basic Commands

Start with these core sesh commands:

**List all available sessions:**
```bash
sesh list
```

Expected output:
```
dotfiles
my-app
downloads
notes
```

**Connect to a session (creates if it doesn't exist):**
```bash
sesh connect dotfiles
```

**Switch to your last session:**
```bash
sesh last
```

**Create a new window in the current session:**
```bash
sesh window
```

### Step 4: Set Up Tmux Keybinding with fzf

Add this to your `~/.tmux.conf` to enable interactive session switching:

```bash
# Add this to ~/.tmux.conf
bind-key x kill-pane
bind-key C-o display-popup -E "sesh connect $(sesh list | fzf)"
```

This creates a popup with fzf to select and connect to sessions using Ctrl+O.

**Required tmux settings:**
```bash
set -g detach-on-destroy off
```

Reload your tmux config:
```bash
tmux source-file ~/.tmux.conf
```

### Step 5: Create Your First sesh.toml Config

Create the config directory and file:
```bash
mkdir -p ~/.config/sesh
touch ~/.config/sesh/sesh.toml
```

Edit `~/.config/sesh/sesh.toml`:

```toml
# Default session behavior
[default_session]
startup_command = "nvim"
preview_command = "lsd -la"

# Custom session: Downloads directory
[[session]]
name = "downloads"
path = "~/Downloads"
startup_command = "yazi"

# Custom session: Dotfiles project
[[session]]
name = "dotfiles"
path = "~/dotfiles"
startup_command = "nvim init.lua"
windows = ["editor", "git"]

[[window]]
name = "editor"
startup_script = "nvim"

[[window]]
name = "git"
startup_script = "lazygit"
```

### Step 6: Configure Default Session Behavior

Add this to your shell profile (`~/.zshrc`, `~/.bashrc`, etc.):

```bash
# Auto-switch to sesh session on shell startup
eval "$(sesh init bash)"  # or zsh
```

This ensures sesh hooks into your shell and tracks your directory changes with zoxide.

---

## Practical Examples

### Example 1: Basic fzf Integration

After setting up the tmux keybinding, press Ctrl+O to see:

```
> dotfiles
  my-app
  downloads
  notes
```

Type `dot` to filter, then press Enter to connect to the dotfiles session.

### Example 2: Using Television's Sesh Channel

Television integrates with sesh for a modern picker experience. Install television, then use:

```bash
sesh connect $(television --channel sesh)
```

This opens a beautiful, searchable interface for session selection. See [[television-beginner-guide]] for setup details.

### Example 3: Custom Session for a Project

Imagine you have a project with specific needs:

```toml
[[session]]
name = "my-app"
path = "~/projects/my-app"
startup_command = "nvim src/main.rs"
windows = ["editor", "test", "docs"]
preview_command = "git status"

[[window]]
name = "editor"
startup_script = "nvim src/main.rs"

[[window]]
name = "test"
startup_script = "cargo test --watch"

[[window]]
name = "docs"
startup_script = "python -m http.server 8000"
```

When you `sesh connect my-app`, it:
1. Creates a session named "my-app"
2. Changes to `~/projects/my-app`
3. Opens nvim in the first window
4. Creates a second window running cargo test
5. Creates a third window serving docs on localhost:8000

### Example 4: Wildcard Configs for Multiple Projects

Use wildcards to apply the same config to similar directories:

```toml
[[wildcard]]
pattern = "~/projects/*"
startup_command = "nvim"
preview_command = "git log --oneline -5"
```

Now every subdirectory in `~/projects/` gets this config automatically.

### Example 5: macOS Keybinding with skhd

If you use skhd, create instant session switching from anywhere:

```bash
# In ~/.skhdrc
cmd + shift + s: open -a Terminal && tmux send-keys -t 0 "sesh connect $(sesh list | fzf)" Enter
```

This launches your terminal and opens a sesh picker from any application.

---

## Hands-On Exercises

### Exercise 1: Install and Connect

1. Install sesh using your preferred method
2. Run `sesh list` to see available sessions
3. Navigate to a project directory: `cd ~/projects/my-project`
4. Run `sesh connect` and observe the session name
5. Disconnect: `tmux detach` (Ctrl+B then D)
6. List sessions again: `sesh list`

### Exercise 2: Frecency Building

1. Create 5 test directories: `mkdir -p ~/test-{1,2,3,4,5}`
2. Visit each one: `cd ~/test-1`, `cd ~/test-2`, etc.
3. Run `zoxide query -l` to see your frecency-ranked directories
4. Jump using frecency: `z test-3`
5. Create sessions in each: `sesh connect test-3`

### Exercise 3: Custom Config

1. Edit `~/.config/sesh/sesh.toml`
2. Add three custom sessions:
   - One for a project you're working on
   - One for a downloads directory with yazi startup
   - One wildcard pattern for similar directories
3. Test each: `sesh connect project-name`
4. Verify windows opened correctly

---

## Troubleshooting

### "tmux is not running"

**Problem:** You see an error about tmux not existing.

**Solution:** Ensure tmux is installed and running:
```bash
brew install tmux  # or your package manager
tmux new-session -d -s work  # Create a tmux session
sesh connect work
```

### "zoxide is empty — no frecency data"

**Problem:** `sesh list` shows no sessions, and `zoxide query -l` is empty.

**Solution:** zoxide builds its database as you navigate. Visit directories to populate it:
```bash
cd ~/projects && cd ~/dotfiles && cd ~/downloads
zoxide query -l  # Should now show directories
sesh list        # Should now show sessions
```

### "Session names are confusing"

**Problem:** Session names don't match what you expected.

**Solution:** Remember sesh's naming priority:
1. Git repository name (highest)
2. Remote name (if using SSH)
3. Worktree name (if using git worktrees)
4. Directory name (fallback)

Check what sesh sees:
```bash
cd ~/projects/my-repo && sesh list
```

### "Keybinding doesn't work in tmux"

**Problem:** Ctrl+O (or your keybinding) doesn't open the sesh picker.

**Solution:**
1. Verify tmux config was reloaded: `tmux source-file ~/.tmux.conf`
2. Check for keybinding conflicts: `tmux list-keys | grep C-o`
3. Ensure fzf is installed: `which fzf`
4. Test manually: `tmux display-popup -E "sesh list"`

---

## References

- **Official Repository:** https://github.com/joshmedeski/sesh
- **Blog Post:** https://www.joshmedeski.com/posts/smart-tmux-sessions-with-sesh/
- **zoxide Documentation:** https://github.com/ajeetdsouv/zoxide
- **fzf Documentation:** https://github.com/junegunn/fzf

---

## Related Tutorials

- [[television-beginner-guide]] — Modern terminal UI picker (integrates with sesh)
- [[television-deep-dive]] — Advanced television configuration
- [[ghostty-keyboard-shortcuts]] — Terminal keybindings and workflows
- [[worktrunk-beginner-guide]] — Git worktrees (pairs well with sesh)
- [[worktrunk-deep-dive]] — Advanced worktree management
- [[git-worktrees-worktrunk-beginner-guide]] — Git worktrees fundamentals
- [[git-worktrees-worktrunk-deep-dive]] — Worktree best practices
- [[dotfiles-beginner-guide]] — Organizing your config files (sesh.toml lives here)
- [[dotfiles-deep-dive]] — Advanced dotfile management
- [[sesh-deep-dive]] — Advanced sesh configuration, scripting, and workflows

---

## Summary

Sesh transforms terminal session management from a manual, error-prone task into an intelligent, automatic process. By leveraging tmux sessions, zoxide's frecency algorithm, and sesh's smart naming, you can:

- **Switch between projects instantly** using a single keybinding
- **Eliminate session naming confusion** through automatic naming
- **Maintain consistent project setups** with reusable configs
- **Integrate with modern tools** like television, fzf, and gum

Start with the basics: install sesh, create a simple fzf keybinding, and add 3-5 custom sessions to your `sesh.toml`. As your workflow evolves, explore wildcard configs, integration with television, and custom shell functions.

The combination of sesh, tmux, and zoxide creates a powerful, efficient terminal workflow that scales from personal projects to complex multi-project setups.

Happy session switching!
# Related Tutorials

- [[television-beginner-guide]] — Modern terminal UI picker (integrates with sesh)
- [[television-deep-dive]] — Advanced television configuration
- [[ghostty-keyboard-shortcuts]] — Terminal keybindings and workflows
- [[worktrunk-beginner-guide]] — Git worktrees (pairs well with sesh)
- [[worktrunk-deep-dive]] — Advanced worktree management
- [[git-worktrees-worktrunk-beginner-guide]] — Git worktrees fundamentals
- [[git-worktrees-worktrunk-deep-dive]] — Worktree best practices
- [[dotfiles-beginner-guide]] — Organizing your config files (sesh.toml lives here)
- [[dotfiles-deep-dive]] — Advanced dotfile management
- [[chezmoi-beginner-guide|Chezmoi Beginner Guide]] — Manage your sesh.toml with chezmoi across machines
- [[chezmoi-deep-dive|Chezmoi Deep Dive]] — Advanced chezmoi templates for per-machine sesh configs
- [[sesh-deep-dive]] — Advanced sesh configuration, scripting, and workflows

- [[mosh-beginner-guide|Mosh Beginner Guide]] — Persistent remote sessions with Mosh + tmux (complements sesh for HPC/remote work)
- [[mosh-deep-dive|Mosh Deep Dive]] — Advanced Mosh internals and HPC workflow patterns

- [[openmux-beginner-guide|OpenMux Beginner Guide]] and [[openmux-deep-dive|OpenMux Deep Dive]] — terminal multiplexer with session management

- [[micropython-ttgo-t-display-beginner-guide|MicroPython TTGO T-Display Beginner Guide]] — managing multiple serial terminal sessions for embedded devices
- [[micropython-ttgo-t-display-deep-dive|MicroPython TTGO T-Display Deep Dive]] — session management for ESP32 REPL and monitoring workflows

- [[hyperqueue-basics|HyperQueue Basics]] — HPC task scheduler that needs a persistent tmux session for its server
- [[hyperqueue-deep-dive|HyperQueue Deep Dive]] — production HQ setup including server persistence strategies

- [[honeymux-beginner-guide|Honeymux Beginner Guide]] — a TUI wrapper for tmux with visual session management
- [[docker-test-container-beginner-guide|Docker Test Container Beginner Guide]] — test session configs safely in containers

- [[dtach-beginner-guide|Dtach Beginner Guide]] — minimal alternative to tmux when you only need detach/reattach
- [[dtach-deep-dive|Dtach Deep Dive]] — run tmux inside dtach for extra session protection

- [[tmux-claude-code-beginner-guide|Tmux + Claude Code Beginner Guide]] — Run Claude Code inside tmux for persistent, multi-project AI coding sessions
- [[tmux-claude-code-deep-dive|Tmux + Claude Code Deep Dive]] — Advanced tmux + Claude Code patterns including parallel agents and worktree integration
