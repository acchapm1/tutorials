---
title: Sesh Deep Dive
date: 2026-04-11
difficulty: advanced
tags: [sesh, tmux, session-management, productivity, shell, automation]
---

# Sesh Deep Dive

A comprehensive reference guide for advanced sesh usage, covering architecture, configuration, and real-world workflows.

## Overview

Sesh is a smart tmux session manager that intelligently discovers and manages tmux sessions from multiple sources: local configurations, git repositories, zoxide directories, and tmux instances. Unlike basic tmux session management, sesh provides:

- **Unified session discovery**: Aggregates sessions from config files, zoxide database, and running tmux servers
- **Smart session naming**: Automatically derives names from git repos, remotes, directory structure, or worktree roots
- **Configuration as code**: Define complete session layouts with startup commands, multiple windows, and preview commands
- **Multiple frontends**: fzf popups, television integration, gum menus, Raycast, Ulauncher, and shell completions
- **Wildcard patterns**: Match entire project directories with consistent session templates
- **Stale-while-revalidate caching**: Fast fuzzy finding with automatic cache refresh

This deep-dive covers advanced configuration patterns, integration strategies, and troubleshooting for power users managing complex multi-project workflows.

## Prerequisites

Before diving into advanced sesh usage, ensure you have:

- **tmux** installed and configured (v2.8+)
- **zoxide** for smart directory jumping and session discovery
- **fzf** (for picker integration) or **television** (modern alternative)
- **Shell proficiency**: Understanding of shell scripting, TOML syntax, tmux keybindings
- **Git knowledge**: Familiarity with repositories, remotes, and worktrees
- **Basic sesh experience**: Completion of [[sesh-beginner-guide]]

## Key Concepts

### Sesh Architecture

Sesh operates as a compiled Go binary that orchestrates three core data sources:

```
┌─────────────────┐
│   Sesh Binary   │
├─────────────────┤
│  Config Parser  │ ──→ ~/.config/sesh/sesh.toml
│  Zoxide Scanner │ ──→ ~/.local/share/zoxide/db.zo
│  Tmux API       │ ──→ tmux list-sessions
│  Git Detector   │ ──→ repo detection + naming
└─────────────────┘
         │
         ▼
    Session Pool
         │
    ┌────┴────┬────────┬──────────┐
    │          │        │          │
   fzf    Television   gum      Shell
  (popup)  (channel)  (menu)  (completion)
```

### Configuration Hierarchy

When sesh loads `sesh.toml`, it applies the following precedence (highest to lowest):

1. **Session-specific config** (`[[session]]` with matching name)
2. **Wildcard config** (`[[wildcard]]` matching current path)
3. **Default session config** (`[default_session]`)
4. **Built-in defaults** (no startup, no windows)

The `#:schema` directive enables editor autocomplete in TOML editors:
```toml
#:schema https://raw.githubusercontent.com/joshmedeski/sesh/master/schema.json
```

### Session Lifecycle

```
Discover ──→ Filter ──→ Sort ──→ Present ──→ Connect ──→ Attach
(all)      (exclude)  (order)  (UI)       (init)     (tmux)
```

- **Discover**: Scan config files, zoxide DB, running tmux servers
- **Filter**: Apply blacklist, hide active sessions with `-H` flag
- **Sort**: Order by `sort_order` preference (tmuxinator, config, tmux, zoxide)
- **Present**: Display via fzf, television, gum, or completion
- **Connect**: Execute startup commands and scripts
- **Attach**: Attach to tmux session (or run `--command`)

### Smart Session Naming Algorithm

When a session is created, sesh derives the name in this order:

1. Explicit name in `[[session]]` block
2. Wildcard-derived name (from pattern)
3. Git repository name (from `.git/config`)
4. Git remote URL parsing (last component before `.git`)
5. Git worktree root (if in a worktree)
6. Directory name (controlled by `dir_length` setting)

Example derivation:
```
/home/user/projects/my-repo/.git → "my-repo"
/home/user/src/github.com/user/dotfiles → "dotfiles"
~/.config/sesh/sesh.toml → "sesh" (if no git)
```

### Wildcard Matching Semantics

Wildcard patterns use Go's `filepath.Match` with recursive `**` support:

```toml
[[wildcard]]
pattern = "~/projects/*/src"           # matches ~/projects/foo/src
pattern = "~/work/**/*.md"             # matches any .md recursively
pattern = "**/node_modules"            # matches any node_modules anywhere
```

The matching is performed relative to the session path discovery process. Each wildcard match can define its own startup commands and windows, enabling template-based session management.

## Step-by-Step Instructions

### Advanced fzf Integration with Full Keybindings

Configure an fzf tmux popup with comprehensive keybindings for session discovery:

```bash
# Add to ~/.zshrc or ~/.bashrc
bind_sesh() {
  local selected
  selected=$(sesh list -i | fzf-tmux -p 55%,60% \
    --no-sort \
    --ansi \
    --border-label "[ sesh ]" \
    --bind "ctrl-a:change-prompt(All> )+reload(sesh list -i)" \
    --bind "ctrl-t:change-prompt(Tmux> )+reload(sesh list -i -t tmux)" \
    --bind "ctrl-g:change-prompt(Configs> )+reload(sesh list -i -c config)" \
    --bind "ctrl-x:change-prompt(Zoxide> )+reload(sesh list -i -z zoxide)" \
    --bind "ctrl-f:change-prompt(Find> )+reload(sesh list -i | grep -i {q})" \
    --bind "ctrl-d:execute(sesh connect {1} --switch)+abort" \
    --bind "enter:execute(sesh connect {1} --switch)+abort")
  [ -n "$selected" ] && sesh connect "$selected"
}
```

### Television Integration

Television provides a modern, feature-rich alternative to fzf with built-in sesh channel support:

```bash
# Install television
brew install television

# Create sesh channel in television config (built-in)
tv sesh

# Or add custom keybinding to tmux
bind-key s run-shell "tv sesh"
```

Output:
```
✓ Session "dotfiles" created and attached
```

### gum Integration

For simpler TUI menu interactions without fzf:

```bash
# Add to shell config
sesh_menu() {
  local session
  session=$(sesh list | gum choose --header "Select session")
  [ -n "$session" ] && sesh connect "$session" --switch
}
```

### Window Management with sesh window

Create or switch to windows within a session:

```bash
# Create new window in current session
sesh window --name "build"

# Create window in specific session
sesh window --session "myproject" --name "tests"

# List windows in session
sesh window --session "myproject" --list
```

### Shell Completion Setup

Enable tab completion for sesh commands across shells:

```bash
# Bash
eval "$(sesh completion bash)"

# Zsh
eval "$(sesh completion zsh)"

# Fish
sesh completion fish | source

# PowerShell
sesh completion powershell | Out-String | Invoke-Expression
```

### Zsh Keybind for Session Switching

Add a quick Alt-s keybind for session switching in Zsh:

```bash
# Add to ~/.zshrc
bindkey -s '^[s' 'sesh list -i | fzf-tmux -p 55%,60% | xargs sesh connect --switch\n'

# Or with function
sesh_switch() {
  sesh list -i | fzf-tmux -p 55%,60% | xargs sesh connect --switch
}
bindkey -s '^[s' 'sesh_switch\n'
```

### Raycast Extension Setup

Install and configure the Raycast extension for system-wide session access:

1. Open Raycast and search "Extensions"
2. Install "Sesh" extension by Josh Medeski
3. Configure extension settings:
   - Custom sesh path: `/usr/local/bin/sesh` (if custom)
   - Config path: `~/.config/sesh/sesh.toml`
   - Show icons: enabled
4. Bind global hotkey (e.g., Cmd+Shift+S)

## Practical Examples

### Complete Developer Workflow sesh.toml

```toml
#:schema https://raw.githubusercontent.com/joshmedeski/sesh/master/schema.json

sort_order = ["config", "tmux", "zoxide"]
cache = true
dir_length = 1

blacklist = ["scratch", "temp"]

[[session]]
name = "dotfiles"
path = "~/.config"
startup_command = "cd ~/.config && nvim ."
[[session.windows]]
name = "edit"
startup_script = "nvim ."
[[session.windows]]
name = "git"
startup_script = "git status"

[[session]]
name = "api"
path = "~/projects/api"
startup_command = "cd ~/projects/api && npm run dev"
[[session.windows]]
name = "server"
startup_script = "npm run dev"
[[session.windows]]
name = "tests"
startup_script = "npm test -- --watch"
[[session.windows]]
name = "logs"
startup_script = "tail -f logs/app.log"

[[wildcard]]
pattern = "~/projects/*/src"
startup_command = "cd {path}/.."
preview_command = "ls -la {path}/.."
[[wildcard.windows]]
name = "code"
startup_script = "nvim ."
[[wildcard.windows]]
name = "tests"
startup_script = "npm test -- --watch"

[default_session]
startup_command = "pwd"
preview_command = "ls -la {path}"
```

### Multi-Project Workflow with Git Worktrees

Combine sesh with [[git-worktrees-worktrunk-deep-dive]] for feature-branch isolation:

```toml
[[session]]
name = "feat/auth"
path = "~/projects/app/.git/worktrees/feat-auth"
startup_command = "cd {path} && git branch"
[[session.windows]]
name = "code"
[[session.windows]]
name = "test"
startup_script = "npm test"

[[wildcard]]
pattern = "~/projects/*/worktrees/*"
preview_command = "git log --oneline -5 {path}"
```

Launch with: `sesh list | fzf | xargs sesh connect --switch`

### Team Dotfiles Configuration Sharing

Use `import` directive to share sesh configs across team members via [[dotfiles-deep-dive]]:

```toml
# ~/.config/sesh/sesh.toml
import = [
  "~/.dotfiles/sesh/project-defaults.toml",
  "~/.dotfiles/sesh/work-sessions.toml",
  "~/.dotfiles/sesh/team-wildcards.toml"
]

sort_order = ["config", "tmux", "zoxide"]
```

Project repository setup:
```
~/.dotfiles/
├── sesh/
│   ├── project-defaults.toml
│   ├── work-sessions.toml
│   └── team-wildcards.toml
├── tmux/
└── nvim/
```

### Bootstrap Script for New Machine Setup

Automate sesh configuration on fresh machines:

```bash
#!/bin/bash
# bootstrap-sesh.sh

# Install sesh
if ! command -v sesh &> /dev/null; then
  brew install sesh || go install github.com/joshmedeski/sesh/v2@latest
fi

# Create config directory
mkdir -p ~/.config/sesh

# Clone dotfiles or fetch configuration
git clone https://github.com/yourorg/dotfiles ~/.dotfiles
ln -s ~/.dotfiles/sesh/sesh.toml ~/.config/sesh/sesh.toml

# Refresh zoxide database
zoxide query -i > /dev/null

# Test configuration
sesh list -c config

echo "✓ Sesh configured successfully"
```

### CI-Friendly tmux Automation with sesh

Use sesh for reproducible test environment setup in CI:

```bash
#!/bin/bash
# ci-test.sh - runs tests in isolated tmux session

sesh connect "ci-test" \
  --switch \
  --command "npm test -- --coverage && exit"

# Capture exit code
exit_code=$?

# Cleanup
tmux kill-session -t ci-test

exit $exit_code
```

## Hands-On Exercises

### Exercise 1: Build a Complete sesh.toml from Scratch

Create a configuration for three projects with different toolchains:

1. Create `~/.config/sesh/sesh.toml`
2. Define `[[session]]` blocks for:
   - Node.js project (with npm dev/test windows)
   - Python project (with poetry/pytest)
   - Go project (with build/run)
3. Add wildcard pattern for `~/projects/*`
4. Set `cache = true` and `sort_order = ["config", "tmux"]`
5. Test with `sesh list -c config`

Expected output:
```
3 sessions from config
- nodejs-app (4 windows)
- python-api (3 windows)
- golang-service (2 windows)
```

### Exercise 2: Create Multi-Window Development Session

Build a single session with 4+ focused windows:

```toml
[[session]]
name = "fullstack"
path = "~/projects/app"
startup_command = "cd {path}"
[[session.windows]]
name = "api"
startup_script = "cd api && npm run dev"
[[session.windows]]
name = "web"
startup_script = "cd web && npm run dev"
[[session.windows]]
name = "db"
startup_script = "docker-compose up postgres"
[[session.windows]]
name = "logs"
startup_script = "tail -f logs/combined.log"
```

Test workflow:
1. Run `sesh connect fullstack --switch`
2. Verify 4 windows created: `tmux list-windows -t fullstack`
3. Switch windows: `Ctrl-b 0`, `Ctrl-b 1`, etc.

### Exercise 3: Wildcard Config for Project Directory

Set up templated sessions for all projects in a directory:

```toml
[[wildcard]]
pattern = "~/projects/*/src"
startup_command = "cd {path}/.."
preview_command = "ls -la {path}/.."
[[wildcard.windows]]
name = "editor"
startup_script = "cd {path}/.. && nvim ."
[[wildcard.windows]]
name = "shell"
```

Test:
1. Create test projects: `mkdir -p ~/projects/app/src ~/projects/web/src`
2. Run `sesh list | grep -E "app|web"`
3. Connect: `sesh connect app --switch`
4. Verify windows and working directory

### Exercise 4: Television Integration Setup

Configure television as modern sesh frontend:

1. Install: `brew install television`
2. Add tmux keybinding:
   ```toml
   # ~/.config/tmux/tmux.conf
   bind-key s run-shell "tv sesh"
   ```
3. Test in tmux: `Prefix + s`
4. Navigate with arrow keys, select with Enter

## Troubleshooting

### Problem: Session Naming Conflicts

**Symptom**: Multiple sessions with same name or unexpected naming

**Solutions**:
1. Check git configuration: `git config --get remote.origin.url`
2. Explicitly name sessions in config: `name = "explicit-name"`
3. Control directory depth: `dir_length = 2`
4. Verify wildcard patterns don't overlap

### Problem: Config File Not Loading

**Symptom**: `sesh list -c config` shows no sessions

**Solutions**:
```bash
# Verify config path
cat ~/.config/sesh/sesh.toml

# Test custom config path
sesh -C /path/to/sesh.toml list -c config

# Validate TOML syntax
sesh list -c config --debug 2>&1 | head -20

# Check file permissions
ls -la ~/.config/sesh/sesh.toml
```

### Problem: Zoxide Database Stale

**Symptom**: Sessions from old projects appear in zoxide list

**Solutions**:
```bash
# Rebuild zoxide database
zoxide query -i > /dev/null
zoxide remove --interactive

# Check database file
sqlite3 ~/.local/share/zoxide/db.zo "SELECT path FROM paths ORDER BY rank;"

# Rebuild from scratch
rm ~/.local/share/zoxide/db.zo
zoxide add $PWD  # add current directory
```

### Problem: tmux Version Compatibility

**Symptom**: Errors with `sesh window` or window creation

**Solutions**:
```bash
# Check tmux version
tmux -V  # Should be 2.8+

# Upgrade tmux
brew upgrade tmux

# Use alternative session creation
sesh connect "session" --switch --command "tmux new-window -n mywindow"
```

### Problem: Cache Stale Issues

**Symptom**: New sessions not appearing immediately after creation

**Solutions**:
```bash
# Clear cache (5-second TTL applies)
# Just wait 5 seconds or restart sesh command

# Disable caching temporarily
sesh list --no-cache

# Update sesh.toml to disable cache
cache = false  # in sesh.toml
```

## References

- **Official Repository**: https://github.com/joshmedeski/sesh
- **GitHub Releases**: https://github.com/joshmedeski/sesh/releases
- **Configuration Schema**: https://raw.githubusercontent.com/joshmedeski/sesh/master/schema.json
- **Related Tools**:
  - [[television-deep-dive]] - Modern tmux picker
  - [[ghostty-keyboard-shortcuts]] - Terminal keybindings reference
  - [[worktrunk-deep-dive]] - Git worktree management
  - [[dotfiles-deep-dive]] - Configuration management

## Related Tutorials

- [[sesh-beginner-guide]] - Introduction and basic setup
- [[television-beginner-guide]] - Getting started with television
- [[television-deep-dive]] - Advanced television configuration
- [[git-worktrees-worktrunk-beginner-guide]] - Git worktree basics
- [[git-worktrees-worktrunk-deep-dive]] - Advanced worktree patterns
- [[dotfiles-beginner-guide]] - Configuration file management
- [[dotfiles-deep-dive]] - Advanced dotfile strategies

## Summary

Sesh transforms tmux session management from manual process to intelligent automation. Key takeaways:

1. **Configuration as Code**: Define complete session layouts in `sesh.toml` with startup commands and multiple windows
2. **Smart Discovery**: Aggregate sessions from git repos, zoxide database, and explicit configs
3. **Multiple Frontends**: Choose between fzf, television, gum, shell completion, and Raycast
4. **Wildcard Templates**: Apply consistent session patterns to entire project directories
5. **Integration**: Combine with [[television-deep-dive]], [[worktrunk-deep-dive]], and [[dotfiles-deep-dive]] for complete workflow automation
6. **Performance**: Leverage caching with stale-while-revalidate strategy for instant fuzzy finding

Advanced sesh workflows unlock significant productivity gains when managing multiple projects, branches, and environments simultaneously. Master the configuration hierarchy, wildcard semantics, and integration patterns to build a personalized session management system that grows with your development needs.
# Related Tutorials

- [[mosh-beginner-guide|Mosh Beginner Guide]] — Persistent remote sessions with Mosh + tmux for HPC clusters
- [[mosh-deep-dive|Mosh Deep Dive]] — Advanced Mosh configuration, network deep-dive, and Slurm integration

- [[openmux-beginner-guide|OpenMux Beginner Guide]] and [[openmux-deep-dive|OpenMux Deep Dive]] — terminal multiplexer with session management

- [[hyperqueue-basics|HyperQueue Basics]] — HPC meta-scheduler that benefits from persistent tmux sessions
- [[hyperqueue-deep-dive|HyperQueue Deep Dive]] — covers systemd-user units as an alternative to tmux for server persistence

- [[honeymux-beginner-guide|Honeymux Beginner Guide]] and [[honeymux-deep-dive|Honeymux Deep Dive]] — a TUI wrapper for tmux with built-in session management
- [[docker-test-container-beginner-guide|Docker Test Container Beginner Guide]] — test tmux/session configs in containers

- [[dtach-beginner-guide|Dtach Beginner Guide]] — lightweight detach when tmux is overkill
- [[dtach-deep-dive|Dtach Deep Dive]] — dtach + tmux integration patterns

- [[tmux-claude-code-beginner-guide|Tmux + Claude Code Beginner Guide]] — Run Claude Code inside tmux for persistent AI coding sessions
- [[tmux-claude-code-deep-dive|Tmux + Claude Code Deep Dive]] — Advanced tmux + Claude Code patterns with sesh integration
