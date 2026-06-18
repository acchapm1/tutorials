---
title: "Honeymux — Deep Dive"
date: 2026-04-28
difficulty: advanced
tags: [honeymux, tmux, terminal-multiplexer, tui, session-management, hmx, ssh, remote, agent-monitoring]
---

# Honeymux — Deep Dive

## Overview

This is a comprehensive technical reference for advanced Honeymux users and developers. While the beginner guide covers basic session management and navigation, this deep dive explores Honeymux's architecture, internals, and power-user workflows.

Honeymux is a sophisticated TUI (Terminal User Interface) wrapper around tmux that reimagines terminal multiplexing for modern developers. It preserves tmux's legendary flexibility while providing an intuitive graphical interface, advanced session management, hook-based automation, SSH-backed remote pane stitching, and OS-native scrollback/search. This guide covers all these features in depth, from low-level architectural decisions to advanced integration patterns with complementary tools like Sesh, Mosh, justfiles, and CI/CD systems.

**What this covers beyond the beginner guide:**
- Honeymux architecture and how it wraps tmux
- Hook system design and implementation
- SSH pane stitching internals and configuration
- Layout profile creation and sharing strategies
- Integration with existing tmux configurations
- Advanced session orchestration patterns
- Performance tuning and terminal compatibility
- Troubleshooting complex multi-server setups
- Comparison with related tools (OpenMux, tmuxp, Sesh, etc.)

## Prerequisites

Before diving into this tutorial, you should have:

1. **Honeymux installed** via `brew install honeymux/tap/hmx` or the curl installer
2. **Completed the beginner guide** covering basic session creation, window/pane navigation, and the sidebar
3. **Tmux familiarity** (at least basic understanding of tmux concepts: sessions, windows, panes)
4. **Terminal emulator** with modern features (Kitty, Ghostty, iTerm2, WezTerm, or Alacritty 0.13+)
5. **SSH access** to at least one remote server (for pane stitching examples)
6. **Basic shell scripting** knowledge for hook automation examples
7. **Git and version control** familiarity for configuration management

Optional but helpful:
- Understanding of tmux hooks (`:list-hooks`, custom hook setup)
- Experience with session managers (Sesh, tmuxp, or tmuxinator)
- Knowledge of Mosh for persistent remote sessions
- Familiarity with CI/CD systems (GitHub Actions, GitLab CI)

## Key Concepts

### Architecture: Honeymux Wraps Tmux

Honeymux is fundamentally a **wrapper** around tmux, not a replacement. This is a critical design decision with profound implications.

**Traditional tmux architecture:**
```
Terminal Emulator → tmux server → Multiple clients
                              ↓
                    [windows/panes/buffers]
```

**Honeymux architecture:**
```
Terminal Emulator → Honeymux TUI → tmux server → Multiple clients
                    (rendering)  → (control)
                              ↓
                    [windows/panes/buffers]
```

**Key implications of the wrapper design:**

1. **100% tmux compatibility** — Any tmux command works in Honeymux. Existing `.tmux.conf` files apply. Raw tmux clients can attach to Honeymux-managed sessions.
2. **Dual control** — You can use Honeymux's UI for common tasks and drop to raw tmux commands (prefix+`:`) for advanced operations.
3. **Lighter overhead** — Honeymux adds a rendering layer, not a new multiplexer. The core multiplexing is still tmux.
4. **Gradual adoption** — Teams can mix Honeymux and raw tmux without conflicts.

**How the wrapper intercepts events:**

Honeymux uses tmux hooks to monitor state changes:
- `session-window-changed` — Track active window
- `pane-focus-changed` — Update selected pane
- `pane-mode-changed` — Detect copy/search mode
- `client-resized` — Handle terminal resize
- Custom hooks for user automation

The TUI layer translates these events into visual updates, while maintaining a persistent connection to the tmux server.

### The Hook System

Honeymux's hook system is the foundation for automation. Unlike raw tmux, Honeymux provides a curated interface for registering agent monitoring and custom event handlers.

**Hook categories:**

1. **Lifecycle hooks** — Fire when sessions/windows/panes are created, destroyed, or renamed
2. **Focus hooks** — Fire when focus shifts between panes/windows
3. **Content hooks** — Fire when pane content changes (useful for detecting process completion)
4. **Input hooks** — Fire when user commands are entered (for logging/auditing)

**Conceptual flow:**

```
Event occurs in tmux
        ↓
Tmux calls registered hooks
        ↓
Honeymux intercepts hook output
        ↓
Hook script runs (user-defined shell command)
        ↓
Honeymux captures output/exit code
        ↓
TUI updates or action triggers
        ↓
Visual feedback to user
```

**Hook vs. keybinding:**

- **Keybinding:** User initiates action (synchronous)
- **Hook:** Event-driven automation (asynchronous)

Hooks are ideal for long-running processes that require monitoring (e.g., "alert when this agent finishes" or "screenshot when pane status changes").

### Pane Stitching Internals

SSH pane stitching is Honeymux's most sophisticated feature. It merges local and remote tmux sessions into a unified view.

**Traditional remote development:**
```
Local session                    Remote session
┌──────────────┐               ┌──────────────┐
│ window 1     │               │ window 1     │
│ pane a (ssh) │───────────→   │ pane x       │
│ pane b (local)               │ pane y       │
└──────────────┘               └──────────────┘
```
User switches between contexts manually.

**Honeymux SSH pane stitching:**
```
                    Unified Honeymux session
         ┌──────────────────────────────────────┐
         │ Local window 1                       │
         │  pane a [local]  pane b [remote]    │
         │  (local: ~/code)  (ssh:user@host)   │
         │                                      │
         │ Pane content seamlessly merged      │
         └──────────────────────────────────────┘
```

**How stitching works:**

1. **Configuration** — Define remote connection details (host, user, port, initial command)
2. **Tmux instance on remote** — Honeymux starts a tmux server on the remote machine
3. **SSH tunnel** — Honeymux establishes persistent SSH connection for control
4. **Bidirectional control** — Commands sent through SSH tunnel to remote tmux
5. **Unified rendering** — Local TUI displays both local and remote panes in same layout
6. **Session persistence** — Remote tmux session continues if SSH disconnects

**Technical details:**

```bash
# Behind the scenes, Honeymux runs something like:
ssh user@host -t "tmux new-session -d -s honeymux-stitched"
ssh user@host -t "tmux send-keys -t honeymux-stitched 'command' Enter"

# And renders output from:
ssh user@host -t "tmux capture-pane -t honeymux-stitched:0.0 -p"
```

The SSH connection persists but is multiplexed; you can have multiple stitched panes through one connection.

### The Rendering Layer

Honeymux's TUI uses OpenTUI for rendering, which abstracts over Kitty Graphics Protocol, libghostty-vt, and standard terminal capabilities.

**Rendering pipeline:**

```
Tmux state
    ↓
OpenTUI abstraction layer
    ↓
Terminal capability detection (supports Kitty? images? true color?)
    ↓
Render layout (sidebar, toolbar, pane grid, tabs)
    ↓
Apply Base16 theme
    ↓
Render to terminal emulator
```

**Key features of the rendering layer:**

1. **Efficient updates** — Only changed regions re-rendered (not full screen)
2. **True color support** — 16.7 million color palette via Base16 themes
3. **Unicode/emoji** — Full Unicode support with proper width calculation
4. **Image protocol support** — Kitty protocol for inline images (screenshots, diagrams)
5. **Mouse support** — Click panes, resize with drag, scroll with wheel
6. **Accessibility** — Screen reader support on compatible terminals

**Terminal capability detection:**

Honeymux auto-detects terminal emulator at startup:
- Kitty → Full feature set enabled (images, advanced keyboard)
- Ghostty → Modern features available
- iTerm2 → Inline images, semantic key bindings
- WezTerm → Good feature support
- Alacritty 0.13+ → Keyboard protocol, true color
- Generic xterm → Fallback mode (limited but functional)

### Tmux Compatibility

Honeymux maintains full backward compatibility with tmux. This has implications for configuration and workflow.

**How existing `.tmux.conf` applies:**

1. When Honeymux starts a session, it uses the system tmux with your existing config
2. Key bindings in `.tmux.conf` work in Honeymux (they interact with the TUI)
3. Options like `set -g history-limit 50000` apply to Honeymux sessions
4. Plugins loaded in `.tmux.conf` work, but some may interfere with Honeymux's UI

**Configuration hierarchy:**

```
/etc/tmux.conf (system)
    ↓
~/.tmux.conf (user)
    ↓
Honeymux defaults (overrides above)
    ↓
Honeymux Options dialog (overrides all)
```

**Potential conflicts:**

- `status` option disabled in Honeymux (replaced by sidebar)
- `mode-keys` (vi/emacs) — Affects copy/search mode in panes
- `mouse` option — Honeymux manages this automatically
- Plugins that manipulate status bar — May cause rendering issues

### Honeymux Coexists with Raw Tmux

You can use `tmux` command line and `mux` (Honeymux) in the same environment without conflicts.

**Workflows:**

1. **Honeymux for UI-heavy work** — Session management, layout design, casual editing
2. **Raw tmux for scripting** — Automation, CI/CD, server environments
3. **Mixed sessions** — Honeymux UI attaches to tmux sessions, raw tmux CLI attaches to same sessions

**Example:**
```bash
# Start a Honeymux session
mux new-session -s dev

# In another terminal, attach with raw tmux
tmux attach-session -t dev

# Both show same session content, different rendering
```

This coexistence is powerful for teams transitioning to Honeymux or for automation that requires raw tmux.

## Step-by-Step Instructions

### Configuring Honeymux Options and Key Bindings

The Options dialog (`Ctrl+O` or via menu) is where you customize Honeymux behavior.

**Access Options:**
1. Press `Ctrl+O` in any Honeymux session
2. Navigate with arrow keys or mouse
3. Toggle boolean options with Space
4. Edit text fields with Enter
5. Exit with `Esc` or confirm with `Enter`

**Key configurable options:**

**Display options:**
- `font-size` — Render size (8-24pt)
- `theme` — Base16 theme selection (nord, gruvbox, solarized, dracula, etc.)
- `sidebar-position` — left/right
- `sidebar-width` — Pane dedicated to session/window list
- `show-tabs` — Window tabs within pane grid (yes/no)
- `tab-style` — Visual style of tabs (bar, rounded, minimal)

**Behavior options:**
- `key-binding-set` — keybindings to mimic (tmux, vim, emacs, custom)
- `history-limit` — Lines of scrollback per pane (default 2000)
- `mouse-mode` — Enable/disable mouse support
- `focus-style` — How to indicate focused pane (border, highlight, dim-others)
- `wrap-mode` — Wrap long lines in copy mode (yes/no)

**Performance options:**
- `render-fps` — Target frame rate (default 30fps)
- `lazy-load-remote` — Don't load remote panes until focused
- `enable-hooks` — Process user hooks (disable to reduce overhead)

**Example: Custom vim-like key bindings**

Create or edit `~/.config/honeymux/keybindings.yaml`:

```yaml
keybindings:
  navigation:
    pane_left: C-h
    pane_right: C-l
    pane_up: C-k
    pane_down: C-j
  window:
    next: J
    prev: K
    list: "'"
  command:
    kill_pane: d
    kill_window: X
    new_window: c
    new_pane_h: s
    new_pane_v: v
```

### Advanced Session Management Patterns

Beyond basic session creation, sophisticated users employ patterns for complex workflows.

**Pattern 1: Project-based sessions with layouts**

```bash
# Create session for project
mux new-session -s myproject -x 200 -y 50

# Define specific layout in script
cat > ~/scripts/setup-project.sh << 'EOF'
#!/bin/bash
SESSION="myproject"

# Create windows and panes
tmux new-window -t $SESSION -n editor
tmux new-window -t $SESSION -n tests
tmux new-window -t $SESSION -n server
tmux new-window -t $SESSION -n logs

# Split panes
tmux split-window -t $SESSION:editor -h
tmux split-window -t $SESSION:tests -v

# Send initial commands
tmux send-keys -t $SESSION:editor.0 "nvim src/" Enter
tmux send-keys -t $SESSION:tests.0 "jest --watch" Enter
tmux send-keys -t $SESSION:server "npm run dev" Enter
tmux send-keys -t $SESSION:logs "tail -f logs/*" Enter

# Attach
mux attach-session -t $SESSION
EOF

chmod +x ~/scripts/setup-project.sh
```

**Pattern 2: Ephemeral sessions for one-off tasks**

```bash
# Quick session that auto-destroys after exit
mux new-session -s temp -c ~/Downloads -x 120 -y 30 \
  && sleep 1 \
  && tmux kill-session -t temp
```

**Pattern 3: Session groups for multi-project workflows**

```bash
# Sessions with naming convention for organization
mux new-session -s work:frontend
mux new-session -s work:backend
mux new-session -s work:devops
mux new-session -s personal:scripts
mux new-session -s personal:learning

# List them all
mux list-sessions | grep "^work:"
```

**Pattern 4: Nested sessions (session within session)**

For remote development, create a Honeymux session that contains a tmux session:

```bash
# Local machine
mux new-session -s remote-dev -c ~/code

# Inside that session, SSH to remote
# Then on remote: tmux new-session -s remote-work
# Creates nested context: local Honeymux → remote tmux

# Jump back with C-b C-b (tmux escape prefix twice)
```

### Hook-Based Agent Monitoring

Hooks enable automation triggered by tmux events. This is powerful for monitoring coding agents.

**Use case: Monitor Claude Code execution**

```bash
# Create a hook that alerts when a pane exits
cat > ~/.config/honeymux/hooks/agent-monitor.sh << 'EOF'
#!/bin/bash

# Source: ~/.config/honeymux/hooks/agent-monitor.sh
# Called when a pane changes mode or content changes

PANE_ID=$1
SESSION=$2
WINDOW=$3
PANE=$4
EVENT=$5  # "content-change" or "mode-change"

# Monitor if pane is running an agent
if [[ "$PANE" == *"agent"* ]] || [[ "$PANE" == *"claude"* ]]; then
    case $EVENT in
        content-change)
            # Check if process ended
            if tmux capture-pane -t $SESSION:$WINDOW.$PANE -p | grep -q "ERROR\|Exception\|Traceback"; then
                # Send notification
                osascript -e 'display notification "Agent error detected" with title "Honeymux Alert"'
                # Sound alert
                afplay /System/Library/Sounds/Glass.aiff
            fi
            ;;
        mode-change)
            # Alert when entering copy mode (likely to review output)
            echo "Agent pane in review mode"
            ;;
    esac
fi
EOF

chmod +x ~/.config/honeymux/hooks/agent-monitor.sh
```

**Register hook in Honeymux:**

In Options dialog:
1. Set `hook-script-dir` to `~/.config/honeymux/hooks`
2. Enable `enable-hooks: yes`
3. Set `hook-events: pane-content-changed,pane-mode-changed`

**Alternative: Hook via tmux.conf**

```tmux
# ~/.tmux.conf

# Alert when pane exits
set-hook -g pane-died "run-shell 'notify-send \"Pane died\" \"Investigation needed\"'"

# Log window creation
set-hook -g window-new "run-shell 'echo $(date) - new window >> ~/.tmux-log'"

# Screenshot on mode change (with Honeymux)
set-hook -g pane-mode-changed "run-shell 'sleep 0.5 && mux screenshot'"
```

**Advanced: Multi-agent monitoring dashboard**

Create a dedicated monitoring pane:

```bash
#!/bin/bash
# ~/.config/honeymux/hooks/agent-dashboard.sh

SESSION="monitoring"
PANE="dashboard:0.0"

# Create if doesn't exist
if ! tmux list-sessions 2>/dev/null | grep -q "^monitoring"; then
    tmux new-session -d -s monitoring -x 120 -y 30 "watch -n 1 'tmux list-windows -t dev -F #{W} #{W_Name} #{W_Activity}'"
fi

# Append log entry
echo "[$(date +'%Y-%m-%d %H:%M:%S')] Agent status update" >> ~/.honeymux-agent.log

# Refresh the pane
tmux send-keys -t $PANE "C-c"
tmux send-keys -t $PANE "clear" Enter
tmux send-keys -t $PANE "tail -20 ~/.honeymux-agent.log" Enter
```

### SSH Pane Stitching: Setup and Configuration

SSH pane stitching is how Honeymux merges remote and local panes.

**Basic setup:**

1. Open Options (`Ctrl+O`)
2. Navigate to `ssh-stitching` section
3. Enable `enable-ssh-stitching: yes`
4. Add remote configuration:

```yaml
remote-servers:
  - name: production
    host: prod.example.com
    user: deploy
    port: 22
    key: ~/.ssh/id_rsa_deploy
    initial-session: prod-work
  - name: dev
    host: dev.local
    user: engineering
    port: 2222
    key: ~/.ssh/id_rsa
    initial-session: dev-session
```

**Create a stitched pane:**

```bash
# From within a Honeymux session
# Press Ctrl+\ (or menu: Window → Stitch Remote Pane)

# Select remote server: "production"
# Honeymux will:
# 1. SSH to prod.example.com
# 2. Start/attach to prod-work tmux session
# 3. Create stitched pane in your current window
# 4. Merge rendering
```

**How to use stitched panes:**

Once stitched, the remote pane behaves like a local pane:
- Type commands → sent over SSH tunnel to remote tmux
- Scroll/search → uses remote pane scrollback
- Copy/paste → works bidirectionally
- Kill pane → terminates remote pane only

**Advanced: Multiple remotes in one window**

```bash
mux new-window -t myproject:remotes

# Stitch to first server
Ctrl+\ → Select "production"

# Split the window
Ctrl+S (or Ctrl+\ then "split")

# Stitch to second server in new pane
Ctrl+\ → Select "dev"

# Result: local Honeymux window with panes split between 2 remote servers
```

**Troubleshooting stitching connection:**

```bash
# Check SSH connectivity first
ssh -v user@host "tmux list-sessions"

# Verify remote tmux is installed
ssh user@host "which tmux"

# Check if session exists on remote
ssh user@host "tmux list-sessions -t initial-session"

# View Honeymux logs for SSH errors
tail -f ~/.local/share/honeymux/logs/honeymux.log | grep -i ssh
```

**SSH stitching with key forwarding:**

For accessing private git repos on remote:

```yaml
remote-servers:
  - name: build-server
    host: ci.internal
    user: cibot
    port: 22
    key: ~/.ssh/id_rsa_cibot
    ssh-flags: "-A"  # Forward SSH agent
    initial-session: build
```

### Layout Profiles: Creating and Sharing

Layout profiles let you save and restore complex pane arrangements.

**Save a layout:**

1. Arrange windows and panes as desired
2. Press `Ctrl+L` (or menu: Session → Save Layout)
3. Name it: `python-dev-layout`
4. Optionally add description and tag (e.g., `python, development, research`)

**Layout file format:**

Honeymux saves layouts as YAML:

```yaml
# ~/.config/honeymux/layouts/python-dev-layout.yaml
name: "Python Development"
description: "Editor, tests, REPL, and docs browser side-by-side"
tags: [python, development]
created: 2026-04-28
windows:
  - name: editor
    root: ~/projects/myapp
    panes:
      - command: "nvim ."
        index: 0
      - command: "python -i"
        index: 1
  - name: tests
    root: ~/projects/myapp
    panes:
      - command: "pytest --watch"
        index: 0
    layout: "even-horizontal"
  - name: docs
    root: ~/projects/myapp
    panes:
      - command: "python -m http.server 8000"
        index: 0
layout_structure: |
  3d67,207x50,0,0,0
  5d68,207x25,0,0,{1}
  5d69,207x24,0,26{2}
```

**Load a layout:**

```bash
# Load into new session
mux new-session -s myproject -L python-dev-layout

# Or load into existing session
mux load-layout -t myproject -L python-dev-layout
```

**Share layouts across team:**

```bash
# Save to git repo
git init ~/.config/honeymux-layouts
cp ~/.config/honeymux/layouts/*.yaml ~/.config/honeymux-layouts/
git add .
git commit -m "Add team layout profiles"
git push origin main

# Team member clones and links
git clone https://github.com/myorg/honeymux-layouts.git
ln -s honeymux-layouts ~/.config/honeymux/layouts/team
```

**Template layouts for onboarding:**

```yaml
# ~/.config/honeymux/layouts/team-onboarding.yaml
name: "Team Onboarding"
description: "Standard setup for new team members"
windows:
  - name: code
    root: ~/code/main-repo
    panes:
      - command: "git status && nvim ."
  - name: build
    root: ~/code/main-repo
    panes:
      - command: "make watch"
  - name: docs
    root: ~/code/main-repo
    panes:
      - command: "cd docs && python -m http.server 8000"
  - name: notes
    root: ~/notes
    panes:
      - command: "nvim onboarding.md"
```

### Per-Pane Scrollback and Search

Honeymux provides OS-native scrollback (not tmux copy mode, unless desired).

**Scrollback controls:**

- **Scroll wheel** — Scroll visible pane (if not in copy mode)
- **Page Up/Page Down** — Scroll by screen (if not in copy mode)
- **Ctrl+F** — Open per-pane search (searches current pane's scrollback)
- **Ctrl+G** — Go to line in scrollback
- **Shift+Enter** — Select/copy text directly from scrollback

**Search syntax:**

Honeymux search supports regex:

```
/ERROR.*failed    # Find ERROR followed by failed
/^START.*END      # Find lines starting with START and containing END
/\d{3}-\d{4}      # Find phone number patterns
```

**Persistent scrollback configuration:**

```yaml
# In Options dialog
scrollback:
  history-limit: 50000  # Lines per pane (high for debugging)
  search-mode: regex    # Regex or plain text
  persist-on-exit: yes  # Save scrollback when pane closes
  persist-dir: ~/.local/share/honeymux/scrollback
```

**Advanced: Extract scrollback to file**

```bash
# Right-click pane → "Export scrollback"
# Or via CLI:
mux export-scrollback -t myproject:0.0 > pane-output.txt

# Export with timestamps (if available)
mux export-scrollback -t myproject:0.0 --timestamps > pane-output-timed.txt
```

**Searching across multiple panes:**

```bash
# Create a "search" pane
mux new-window -t myproject:search

# Send search command to all panes
tmux list-panes -t myproject -F "#{session_name}:#{window_index}.#{pane_index}" \
  | while read pane; do
    mux export-scrollback -t $pane | grep -H "search-term" -
  done
```

### Integrating with Existing Tmux Config

Your existing `.tmux.conf` works with Honeymux with minor considerations.

**Best practices:**

```tmux
# ~/.tmux.conf

# Set history high (Honeymux will respect)
set -g history-limit 50000

# Use vim keys (works in copy/search mode)
set -g mode-keys vi

# Enable mouse (Honeymux manages this, but this is safe)
set -g mouse on

# DO NOT change status bar (Honeymux replaces it)
# set -g status off  # DON'T ADD THIS

# DO NOT set pane border styles that override Honeymux theme
# set -g pane-border-style ...  # Might conflict

# Key bindings work in Honeymux
bind -n C-h select-pane -L
bind -n C-j select-pane -D
bind -n C-k select-pane -U
bind -n C-l select-pane -R

# Custom hooks work
set-hook -g pane-died "run-shell 'notify-send \"Pane died\"'"

# Plugins generally work
set -g @plugin 'tmux-plugins/tpm'
set -g @plugin 'tmux-plugins/tmux-yank'  # Copy to system clipboard
run '~/.tmux/plugins/tpm/tpm'
```

**Plugins known to work well:**

- `tmux-plugins/tmux-yank` — System clipboard integration
- `tmux-plugins/tmux-resurrect` — Session persistence
- `tmux-plugins/tmux-continuum` — Auto-save sessions
- `christoomey/vim-tmux-navigator` — Seamless vim/tmux navigation

**Plugins that may conflict:**

- Status bar plugins (powerline, etc.) — Honeymux replaces status
- Aggressive mouse mode plugins — May interfere with Honeymux click handling
- Custom key binding overlays — Test thoroughly

**Conditional config for Honeymux:**

```tmux
# ~/.tmux.conf

# Detect if running in Honeymux
if-shell "env | grep -q HONEYMUX" \
  "source ~/.tmux.honeymux.conf" \
  "source ~/.tmux.raw.conf"
```

```tmux
# ~/.tmux.honeymux.conf (Honeymux-specific)
set -g status off  # Honeymux provides status
bind -n C-o "send-keys C-o"  # Pass through Ctrl+O for Options
```

```tmux
# ~/.tmux.raw.conf (Raw tmux-specific)
set -g status on
set -g status-bg black
set -g status-fg white
```

### Using Honeymux in CI/Headless Environments

Honeymux is interactive, but can integrate with CI/CD pipelines and server environments.

**Use case: CI job debugging in tmux**

```yaml
# .github/workflows/debug.yaml
name: Debug on Failure

on:
  workflow_dispatch:  # Manual trigger

jobs:
  debug:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Install Honeymux
        run: |
          curl -fsSL https://get.hmx.dev | bash
          export PATH="$PATH:$HOME/.local/bin"
      
      - name: Create debug session
        run: |
          mux new-session -d -s ci-debug -c ${{ github.workspace }}
          mux send-keys -t ci-debug "npm test" Enter
          
      - name: Wait for completion
        run: sleep 60
      
      - name: Export session state
        run: |
          tmux capture-pane -t ci-debug -p > ci-debug-state.txt
          tmux list-panes -t ci-debug -F "#{pane_index} #{pane_current_command}"
      
      - name: Upload artifacts
        uses: actions/upload-artifact@v3
        with:
          name: ci-debug-logs
          path: ci-debug-state.txt
```

**Use case: Remote server recovery**

```bash
#!/bin/bash
# Server automation script that uses Honeymux sessions for logging

set -e

SESSION_NAME="server-recovery-$(date +%s)"
mux new-session -d -s $SESSION_NAME -c /var/log

# Log database check
mux new-window -t $SESSION_NAME:0 -n db-check
mux send-keys -t $SESSION_NAME:db-check "mysql -u root -p$DB_PASS -e 'CHECK TABLE user_accounts;'" Enter

# Log service restart
mux new-window -t $SESSION_NAME:1 -n services
mux send-keys -t $SESSION_NAME:services "systemctl restart postgres nginx redis" Enter

# Log cleanup
mux new-window -t $SESSION_NAME:2 -n cleanup
mux send-keys -t $SESSION_NAME:cleanup "find /tmp -mtime +7 -delete && du -sh /var/log/* | sort -hr" Enter

# Keep session for 24 hours (for review)
# Then auto-destroy
at now + 24 hours << EOF
tmux kill-session -t $SESSION_NAME
EOF

echo "Session $SESSION_NAME created for debugging. Expires in 24 hours."
```

**Headless monitoring with Honeymux:**

```bash
#!/bin/bash
# Run Honeymux session in background and export state periodically

mux new-session -d -s monitoring -c ~/monitoring

# Every 5 minutes, export session state
while true; do
    timestamp=$(date +"%Y-%m-%d_%H:%M:%S")
    mkdir -p ~/monitoring-exports
    
    # Export each pane
    for pane in $(tmux list-panes -t monitoring -F "#{pane_index}"); do
        tmux capture-pane -t monitoring:0.$pane -p > ~/monitoring-exports/pane-$pane-$timestamp.txt
    done
    
    sleep 300
done &

# Honeymux session runs in background, state captured periodically
```

## Practical Examples

### Example 1: Multi-Project Workspace with Layout Profiles

You're working on three projects simultaneously: a Python web app, a Rust CLI, and JavaScript frontend.

**Setup:**

```bash
#!/bin/bash
# ~/scripts/workspace-setup.sh

# Create main workspace session
mux new-session -s workspace -d

# Python project
mux new-window -t workspace:1 -n python -c ~/projects/web-app
tmux send-keys -t workspace:python "git status && nvim ." Enter
tmux split-window -t workspace:python -v
tmux send-keys -t workspace:python "pytest --watch" Enter

# Rust project
mux new-window -t workspace:2 -n rust -c ~/projects/cli
tmux send-keys -t workspace:rust "cargo watch -x run" Enter
tmux split-window -t workspace:rust -v
tmux send-keys -t workspace:rust "cargo test --watch" Enter

# JavaScript project
mux new-window -t workspace:3 -n js -c ~/projects/frontend
tmux send-keys -t workspace:js "npm run dev" Enter
tmux split-window -t workspace:js -v
tmux send-keys -t workspace:js "npm test -- --watch" Enter

# Create focused layout for deep work (editor + single pane)
mux save-layout -n focused-dev

# Attach
mux attach-session -t workspace
```

**Run it:**
```bash
~/scripts/workspace-setup.sh
```

**Switch between projects:**
- `Ctrl+N` / `Ctrl+P` (or arrow keys) → Navigate windows
- `C-h/j/k/l` → Navigate panes within window

**Quick context restoration:**
```bash
# If you close and reopen
mux attach-session -t workspace
# Your layout and working directories are preserved
```

### Example 2: Remote Development with SSH Pane Stitching

You're developing on a local machine but need to test on a staging server (Ubuntu Linux, no GUI).

**Architecture:**
```
Local macOS
├─ Honeymux (TUI)
│  ├─ local:editor — nvim editing locally
│  ├─ local:build — npm run build
│  ├─ remote:ssh-stage1 — Testing on staging-1
│  └─ remote:ssh-stage2 — Testing on staging-2
└─ SSH tunnels to: stage-1.internal, stage-2.internal
```

**Setup:**

```bash
#!/bin/bash
# ~/scripts/remote-dev-setup.sh

# Configuration for Honeymux
cat > ~/.config/honeymux/remote-servers.yaml << 'EOF'
remotes:
  - name: stage-1
    host: stage-1.internal
    user: deploy
    port: 22
    identity: ~/.ssh/id_rsa_deploy
    initial_tmux_session: dev-1
    
  - name: stage-2
    host: stage-2.internal
    user: deploy
    port: 22
    identity: ~/.ssh/id_rsa_deploy
    initial_tmux_session: dev-2
EOF

# Create local session
mux new-session -s remote-dev -d -x 240 -y 60 -c ~/projects/app

# Local editor pane
mux send-keys -t remote-dev "nvim src/" Enter

# Split for local build
tmux split-window -t remote-dev -h
mux send-keys -t remote-dev "npm run build:watch" Enter

# Create second window for testing
mux new-window -t remote-dev:1 -n testing

# Stitch to stage-1 (via UI: Ctrl+\)
# Stitch to stage-2 (via UI: Ctrl+\)

# After stitching, window looks like:
# ┌─ stage-1 output ─┬─ stage-2 output ─┐
# │                  │                  │
# │ (SSH stitched)   │ (SSH stitched)   │
# └──────────────────┴──────────────────┘

# Attach
mux attach-session -t remote-dev
```

**Workflow:**

```bash
# Terminal 1: In Honeymux
# Edit locally (window 0)
# Ctrl+N → Switch to testing window
# Run commands in stitched panes (they execute on remote via SSH)
# 
# Example: in stage-1 stitched pane
# $ npm test
# (runs on stage-1.internal, output visible locally)

# Terminal 2 (optional): SSH directly to stage-1
ssh deploy@stage-1.internal
# tmux session is the same as what Honeymux is showing
# Can debug directly if needed
```

**Persistence:**

If SSH drops:
- Honeymux automatically attempts reconnect
- Remote tmux session continues running
- Reconnect restores state

```bash
# Save layout before session
mux save-layout -t remote-dev -n remote-dev-layout

# Later, restore it
mux attach-session -t remote-dev
# (or create new from saved layout)
mux new-session -s remote-dev-2 -L remote-dev-layout
```

### Example 3: Monitoring Multiple Coding Agents Simultaneously

You're running multiple AI coding agents (Claude Code, Copilot, etc.) and want to monitor them all.

**Setup:**

```bash
#!/bin/bash
# ~/scripts/agent-monitoring-setup.sh

mux new-session -s agents -d -x 240 -y 60

# Agent 1: Claude Code — File generation and refactoring
mux new-window -t agents:0 -n claude -c ~/workspace
tmux send-keys -t agents:claude "claude code --watch src/" Enter

# Agent 2: Copilot — Inline suggestions and completions
mux new-window -t agents:1 -n copilot -c ~/workspace
tmux send-keys -t agents:copilot "copilot serve --port 9000" Enter

# Agent 3: Custom agent — Database schema evolution
mux new-window -t agents:2 -n schema-agent -c ~/workspace
tmux send-keys -t agents:schema-agent "python scripts/schema-agent.py --watch db/" Enter

# Monitoring pane
mux new-window -t agents:3 -n monitor -c ~/.local/share/honeymux
tmux send-keys -t agents:monitor "watch -n 1 'date && echo \"---\" && tail -5 ~/.honeymux-agent-activity.log'" Enter

# Hook for agent events
cat > ~/.config/honeymux/hooks/agent-activity.sh << 'HOOK'
#!/bin/bash
SESSION=$1
WINDOW=$2
PANE=$3

# Log agent activity
{
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] Window: $WINDOW"
  tmux capture-pane -t $SESSION:$WINDOW -p | tail -3
  echo ""
} >> ~/.honeymux-agent-activity.log

# Alert on errors
if tmux capture-pane -t $SESSION:$WINDOW -p | grep -qi "error\|failed\|traceback"; then
  osascript -e 'display notification "Agent error in '$WINDOW'" with title "Honeymux Alert"'
fi
HOOK

chmod +x ~/.config/honeymux/hooks/agent-activity.sh

mux attach-session -t agents
```

**Dashboard layout:**

```bash
# Create a focused monitoring layout
# Window 0: Split 3 ways (claude, copilot, schema-agent vertically)
# Window 1: Single pane (monitor)

# In Honeymux Options:
# - Set focus-style to "dim-others" (dim inactive panes)
# - Enable hooks (monitor-enabled: yes)
# - Set hook-events to pane-content-changed
```

**Advanced: Agent state export**

```bash
#!/bin/bash
# ~/scripts/agent-state-report.sh

SESSION="agents"
REPORT_FILE="agent-report-$(date +%Y%m%d-%H%M%S).txt"

{
  echo "=== Agent Status Report ==="
  echo "Generated: $(date)"
  echo ""
  
  for window in $(tmux list-windows -t $SESSION -F "#{window_index}:#{window_name}"); do
    echo "## $window"
    
    for pane in $(tmux list-panes -t $SESSION:${window%:*} -F "#{pane_index}"); do
      pane_target="$SESSION:${window%:*}.$pane"
      
      echo ""
      echo "Pane $pane:"
      tmux capture-pane -t $pane_target -p -S -50 | tail -10
    done
    
    echo ""
  done
  
  echo "=== Agent Process List ==="
  ps aux | grep -E "claude|copilot|schema-agent" | grep -v grep
} | tee $REPORT_FILE

echo "Report saved to $REPORT_FILE"
```

### Example 4: Automating Honeymux with Justfiles and Shell Scripts

Use `just` (command runner) to automate complex Honeymux workflows.

**Justfile:**

```just
# justfile

set shell := ["bash", "-cu"]

# Default recipe
default:
    @just --list

# Setup: Create project session with all windows
setup PROJECT:
    #!/usr/bin/env bash
    SESSION={{ PROJECT }}
    
    # Kill existing
    tmux kill-session -t {{ PROJECT }} 2>/dev/null || true
    
    # Create new
    mux new-session -d -s {{ PROJECT }} -c ~/projects/{{ PROJECT }}
    
    # Windows
    mux new-window -t {{ PROJECT }}:0 -n editor
    mux new-window -t {{ PROJECT }}:1 -n tests
    mux new-window -t {{ PROJECT }}:2 -n server
    mux new-window -t {{ PROJECT }}:3 -n logs
    
    # Commands
    tmux send-keys -t {{ PROJECT }}:editor "nvim ." Enter
    tmux send-keys -t {{ PROJECT }}:tests "pytest --watch" Enter
    tmux send-keys -t {{ PROJECT }}:server "python manage.py runserver" Enter
    tmux send-keys -t {{ PROJECT }}:logs "tail -f /tmp/app.log" Enter
    
    # Attach
    mux attach-session -t {{ PROJECT }}

# Attach: Connect to existing session
attach SESSION:
    mux attach-session -t {{ SESSION }}

# Kill: Destroy session
kill SESSION:
    tmux kill-session -t {{ SESSION }}

# Export: Save session layout
export SESSION:
    mux save-layout -t {{ SESSION }} -n {{ SESSION }}-layout-$(date +%Y%m%d)

# Restore: Load saved layout
restore LAYOUT:
    mux new-session -s restored -L {{ LAYOUT }}
    mux attach-session -t restored

# List: Show all sessions
list:
    mux list-sessions

# Stitched: Create multi-remote dev session
stitched PROJECT:
    #!/usr/bin/env bash
    SESSION={{ PROJECT }}-remote
    
    mux new-session -d -s {{ SESSION }} -c ~/projects/{{ PROJECT }}
    mux new-window -t {{ SESSION }}:1 -n local-editor
    mux new-window -t {{ SESSION }}:2 -n remotes
    
    tmux send-keys -t {{ SESSION }}:local-editor "nvim ." Enter
    
    # Show instructions for stitching
    echo "✓ Session created: {{ SESSION }}"
    echo "Next steps:"
    echo "1. mux attach-session -t {{ SESSION }}"
    echo "2. Go to window 'remotes' (Ctrl+N)"
    echo "3. Press Ctrl+\ to stitch remote panes"

# Report: Generate session activity report
report SESSION:
    #!/usr/bin/env bash
    echo "=== Session: {{ SESSION }} ==="
    echo "Generated: $(date)"
    echo ""
    echo "Windows:"
    tmux list-windows -t {{ SESSION }}
    echo ""
    echo "Panes:"
    tmux list-panes -t {{ SESSION }} -a
    echo ""
    echo "Recent activity:"
    tail -20 ~/.honeymux-agent-activity.log 2>/dev/null || echo "(no activity log)"
```

**Usage:**

```bash
# Setup a project
just setup myapp

# List all commands
just --list

# Export layout
just export myapp

# Generate report
just report myapp

# Attach to session
just attach myapp
```

### Example 5: Integration with Sesh for Session Orchestration

Sesh is a session manager complementary to Honeymux. Honeymux handles UI; Sesh handles session discovery and switching.

**Sesh configuration:**

```yaml
# ~/.config/sesh/config.yaml
environments:
  - path: ~/projects
    prefix: proj
    mode: dirs

  - path: ~/work
    prefix: work
    mode: dirs

  - path: ~/scripts
    prefix: scripts
    mode: files

tmux:
  key_binding: C-j  # Switch sessions with Ctrl+J
```

**Honeymux + Sesh workflow:**

```bash
# In a Honeymux session
Ctrl+J  # Sesh key binding

# Sesh appears (fuzzy finder)
# Type project name: "myapp"
# Sesh creates tmux session if needed
# Honeymux automatically displays it

# Switch back to previous session
Ctrl+J
# (back in previous session)
```

**Script to create Honeymux sessions via Sesh:**

```bash
#!/bin/bash
# ~/scripts/sesh-honeymux-init.sh

# Called when Sesh creates a new session
# Arguments: $1 = session name, $2 = path

SESSION=$1
PATH=$2

# Create with Honeymux
mux new-session -d -s "$SESSION" -c "$PATH"

# Apply default layout if exists
if [[ -f ~/.config/honeymux/layouts/default.yaml ]]; then
    mux load-layout -t "$SESSION" -L default
fi

# Set working directory
tmux send-keys -t "$SESSION" "cd $PATH && git status" Enter

# Stitch to common remotes if configured
if [[ -f ~/.config/sesh/stitched-remotes.txt ]]; then
    while read remote; do
        echo "Would stitch to $remote"
    done < ~/.config/sesh/stitched-remotes.txt
fi

echo "Session $SESSION ready in Honeymux"
```

### Example 6: Using Honeymux with Mosh for Persistent Remote Sessions

Mosh (Mobile Shell) provides better connection resilience than SSH. Combine with Honeymux for robust remote work.

**Setup Mosh + Honeymux:**

```bash
# Install Mosh (if not already)
brew install mosh

# Connect to remote with Mosh, which starts tmux
mosh user@server -- tmux new-session -s mosh-session

# On local machine, create Honeymux session
mux new-session -d -s local-work

# In that session, create stitched pane to Mosh connection
# Honeymux SSH stitching works through Mosh as well
```

**Mosh + SSH stitching configuration:**

```yaml
# ~/.config/honeymux/remote-servers.yaml
remotes:
  - name: mobile-server
    host: nomadic-server.example.com
    user: developer
    port: 22
    use_mosh: true  # Use Mosh instead of SSH
    mosh_port: 60001  # Mosh UDP port
    initial_tmux_session: mosh-session
```

**Why this helps:**

- SSH breaks on network change (WiFi → LTE) — Mosh persists
- Honeymux + Mosh + SSH stitching = highly resilient remote development
- Pane continues running even if connection drops
- Automatic reconnect with state restoration

**Fallback script:**

```bash
#!/bin/bash
# ~/scripts/mosh-honeymux-connect.sh

REMOTE=$1
USER=${2:-developer}

# Try Mosh first
mosh "$USER@$REMOTE" -- tmux new-session -s mosh-session \
  && echo "✓ Connected via Mosh" \
  || {
    # Fall back to SSH if Mosh unavailable
    echo "⚠ Mosh unavailable, falling back to SSH"
    ssh -t "$USER@$REMOTE" "tmux new-session -s ssh-session"
  }
```

## Detailed Comparison with Alternatives

### Feature Comparison Table

| Feature | Honeymux | OpenMux | tmuxp | tmuxinator | Sesh | tmux-resurrect |
|---------|----------|---------|-------|-----------|------|----------------|
| **UI/UX** |
| TUI interface | Yes (modern) | Yes (lite) | No (CLI) | No (CLI) | No (CLI) | No (CLI) |
| Mouse support | Yes (full) | Yes (basic) | No | No | No | No |
| Session menu | Yes (sidebar) | Yes (simple) | No | No | Yes (picker) | No |
| **Tmux Integration** |
| Wraps tmux | Yes (layer) | Yes (layer) | Yes (config) | Yes (config) | No (discoverer) | Yes (plugin) |
| Tmux version required | 3.1+ | 3.0+ | 3.0+ | 2.5+ | — | 3.0+ |
| Config compatibility | Excellent | Good | Excellent | Excellent | N/A | N/A |
| **Session Management** |
| Session persistence | Yes | Yes | Yes | Yes | Yes (discovery) | Yes (restore) |
| Session templates | Yes (layouts) | Limited | Yes (schema) | Yes (template) | Yes (env) | No |
| Session restoration | Manual/auto | Manual | Manual | Manual | Automatic | Automatic |
| **Remote/SSH** |
| SSH pane stitching | Yes (advanced) | Planned | No | No | No | No |
| Remote session mgmt | Via SSH stitching | Via SSH | No | No | No | No |
| Mosh support | Yes (stitching) | No | No | No | No | No |
| **Advanced Features** |
| Hooks/automation | Yes (custom) | Planned | Limited | Limited | Environment hooks | No |
| Layout profiles | Yes (save/share) | Basic | Yes (complex) | Limited | Basic | No |
| Scrollback/search | OS-native | Tmux copy mode | Tmux copy mode | Tmux copy mode | Via tmux | Tmux copy mode |
| Per-pane settings | Yes | Limited | Limited | Limited | No | No |
| Screenshots | Yes (built-in) | No | No | No | No | No |
| **Configuration** |
| Format | YAML / Options UI | YAML | YAML | YAML | YAML | Lua/shell |
| Complexity | Low-medium | Low | Medium | Medium | Low | Low |
| Learning curve | Easy | Easy | Medium | Medium | Very easy | Easy |
| **Development** |
| Active development | Yes | Yes (starting) | Yes | Maintenance | Yes | Maintenance |
| License | Apache 2.0 | MIT | MIT | MIT | MIT | MIT |
| Community size | Growing | Small | Established | Established | Growing | Large |
| **Performance** |
| Startup time | ~200ms | ~150ms | ~100ms | ~100ms | ~50ms | Instant |
| Memory overhead | ~10MB | ~5MB | ~5MB | ~5MB | <1MB | <1MB |
| CPU usage | Low | Very low | Very low | Very low | Minimal | Minimal |
| **Use Cases** |
| Interactive workflows | Excellent | Good | Poor | Poor | Fair | Fair |
| Automation/CI | Good | Poor | Excellent | Excellent | Excellent | Excellent |
| Remote development | Excellent | Fair | Poor | Poor | Fair | Fair |
| Team onboarding | Excellent | Good | Good | Good | Fair | Good |

### Detailed Tool Analysis

**Honeymux** — Best for:
- **Interactive terminal work** with sophisticated UI
- **Modern TUI-first developers** who value visual feedback
- **Remote development** via SSH stitching
- **Layout-driven workflows** (save and restore complex arrangements)
- **Agent monitoring** (Claude Code, Copilot, etc.)

When to choose: You value UX, need remote stitching, or want modern defaults.

**OpenMux** — Best for:
- **Tmux users wanting lightweight UI enhancement** without major overhead
- **Projects valuing minimalism** (smaller footprint than Honeymux)
- **Quick adoption** (very similar to raw tmux)

When to choose: You want Honeymux-like features but with lower overhead, or prefer minimal UI.

**tmuxp** — Best for:
- **Complex programmatic session setup** via Python-like YAML config
- **Projects with intricate window/pane layouts** defined in config
- **CI/CD integration** requiring reproducible session structure

When to choose: You have complex layouts and prefer declarative config over UI.

**tmuxinator** — Best for:
- **Simple project templates** and onboarding
- **Ruby/Rails ecosystem** (native Ruby tooling)
- **Quick context switching** between projects

When to choose: You have simpler needs and want established tool with community support.

**Sesh** — Best for:
- **Quick session discovery and switching** (fuzzy finder)
- **Lightweight session orchestration** (finding and attaching)
- **Combined with Honeymux/raw tmux** for intelligent session management

When to choose: You want smart session discovery, not full session config management.

**tmux-resurrect** — Best for:
- **Automatic session persistence** across reboots
- **Zero configuration** (install and forget)
- **Plugins and customization** via tmux plugin architecture

When to choose: You need transparent session preservation with no extra work.

### Recommended Combinations

**For individual developers:**
- **Honeymux + Sesh** — Sophisticated interactive workflow
- **Sesh + tmux + tmux-resurrect** — Lightweight approach with auto-restore

**For teams:**
- **Honeymux + Honeymux layouts in git** — Shared team session templates
- **tmuxinator + GitHub** — Team-standard project templates
- **Honeymux + Sesh + justfiles** — Fully orchestrated workflows

**For automation/CI:**
- **tmuxp + CI/CD pipeline** — Reproducible session setup
- **Sesh + custom init scripts** — Intelligent environment discovery
- **Raw tmux + shell scripts** — Maximum control, minimal overhead

**For remote development:**
- **Honeymux SSH stitching + Mosh** — Resilient multi-server workflow
- **Sesh + SSH config** — Dynamic remote discovery
- **tmuxp + SSH tunnels** — Stable programmatic setup

## Architecture Deep Dive

### How Honeymux Wraps Tmux Under the Hood

When you start `mux new-session`, Honeymux performs these steps:

```
1. Parse arguments (session name, dimensions, working dir)
2. Validate tmux is installed and running
3. Create tmux session with `tmux new-session`
4. Register tmux hooks for state monitoring
5. Initialize OpenTUI rendering layer
6. Detect terminal emulator capabilities
7. Apply Base16 theme
8. Render sidebar, toolbar, pane grid
9. Enter event loop:
   - Listen for tmux hook events
   - Listen for keyboard input
   - Listen for mouse input
   - Listen for terminal resize
   - Update rendering incrementally
   - Dispatch commands to tmux
10. On exit: Clean up hooks, detach from tmux
```

**Event flow for a user action:**

```
User presses: C-l (move right)
        ↓
Honeymux TUI intercepts keypress
        ↓
Look up keybinding: C-l → select-pane -R
        ↓
Send to tmux: tmux send-keys -t SESSION:WINDOW.PANE C-l
        ↓
Tmux updates pane focus state
        ↓
Tmux fires pane-focus-changed hook
        ↓
Honeymux hook handler receives event
        ↓
Update internal state: current_pane = right_pane
        ↓
Invalidate UI region (pane border area)
        ↓
Re-render sidebar (highlight new pane)
        ↓
Re-render pane borders (show focused border)
        ↓
User sees visual feedback
```

### The TUI Rendering Approach

Honeymux uses OpenTUI for efficient terminal rendering:

```
Honeymux data model
(sessions, windows, panes, layout)
        ↓
Layout engine
(calculate positions and sizes)
        ↓
Rendering request
(list of regions to update)
        ↓
OpenTUI abstraction layer
(detect terminal capabilities)
        ↓
Terminal-specific renderer
├── Kitty protocol renderer
├── Sixel protocol renderer
├── SGR/ANSI renderer
└── Basic ASCII fallback
        ↓
Terminal emulator
```

**Key optimization: Dirty region tracking**

Instead of redrawing the entire screen each frame:

1. Track which regions changed
2. Only re-render those regions
3. Send minimal escape sequences to terminal
4. Result: efficient 30fps updates on modern terminals

**Rendering layers:**

```
Layer 1 (Background): Session/window structure
Layer 2 (Content): Pane output (tmux capture)
Layer 3 (UI): Borders, tabs, buttons
Layer 4 (Overlays): Dialogs (Options, search, etc.)
```

### How Hooks Intercept Tmux Events

Honeymux uses tmux's built-in hook system to monitor events without polling.

```bash
# Behind the scenes, Honeymux sets these hooks:

tmux set-hook -g pane-focus-changed "run-shell '... notify Honeymux ...'"
tmux set-hook -g window-layout-changed "run-shell '... notify Honeymux ...'"
tmux set-hook -g session-window-changed "run-shell '... notify Honeymux ...'"
tmux set-hook -g pane-died "run-shell '... notify Honeymux ...'"
```

**Hook notification channel:**

Honeymux uses a Unix domain socket (or named pipe on Windows) to receive hook notifications:

```
Tmux fires hook
    ↓
Hook script writes to: /tmp/honeymux-{SESSION}.sock
    ↓
Honeymux TUI process listening on socket
    ↓
Event received and processed
    ↓
State updated, UI re-rendered
```

**Why sockets instead of polling:**

- **Instant responsiveness** — No delay waiting for next poll
- **Low CPU overhead** — No constant checking
- **Reliable events** — Don't miss changes between polls

### SSH Pane Stitching Internals

SSH stitching is the most complex Honeymux feature. Here's how it works:

```
Honeymux session (local)
    ↓
User creates stitched pane
    ↓
Honeymux connects via SSH: ssh -N -f user@host
    ↓
SSH tunnel established (persistent, no command)
    ↓
Honeymux starts tmux on remote: ssh user@host tmux new-session -d -s stitched
    ↓
Remote tmux session created
    ↓
Honeymux pane object created (type: stitched)
    ↓
Bidirectional control:
  - Send: tmux send-keys → (ssh tunnel) → remote tmux
  - Recv: tmux capture-pane → (ssh tunnel) → Honeymux
    ↓
Honeymux renders remote pane output in local window layout
```

**SSH multiplexing:**

Multiple stitched panes may use the same SSH connection:

```bash
# Initial SSH connection
ssh user@host -N -f -S ~/.ssh/ctl-honeymux-user@host

# Multiple panes through same tunnel
ssh -S ~/.ssh/ctl-honeymux-user@host ... (subsequent commands use existing connection)

# Benefits: faster, lower overhead than new SSH per pane
```

**State persistence across SSH reconnect:**

If SSH drops:

```
SSH connection lost
    ↓
Honeymux detects broken tunnel
    ↓
Reconnect attempt (exponential backoff)
    ↓
SSH re-establishes
    ↓
Check remote tmux session still exists (it does!)
    ↓
Reattach to existing session (state preserved)
    ↓
User sees seamless reconnect
```

### Relationship to OpenTUI and libghostty-vt

Honeymux depends on these lower-level projects:

**OpenTUI:**
- Abstraction layer for TUI rendering
- Handles capability detection (Kitty, Sixel, ANSI, etc.)
- Provides widget library (buttons, text input, lists)
- Honeymux builds on this for menus, dialogs, sidebar

**libghostty-vt:**
- Virtual terminal emulation library
- Used for terminal rendering engine
- Handles escape sequences, ANSI codes, Unicode
- Ensures consistent rendering across terminal emulators

**Honeymux architecture:**
```
Honeymux (TUI wrapper for tmux)
    ↓
OpenTUI (widget and rendering abstractions)
    ↓
libghostty-vt (terminal emulation)
    ↓
Terminal emulator (iTerm2, Kitty, etc.)
```

## Hands-On Exercises

### Exercise 1: Advanced Layout Design and Export

**Objective:** Design a complex multi-window layout for a real project, save it, and share it.

**Steps:**

1. Create a new session:
   ```bash
   mux new-session -s advanced-layout -x 240 -y 60
   ```

2. Create a sophisticated layout:
   - Window 1 (editor): Split vertically into editor (left) and REPL (right)
   - Window 2 (tests): Full-width test runner
   - Window 3 (docs): Split horizontally (docs server top, notes bottom)

3. Populate each pane with commands
4. Adjust pane sizes using mouse drag or `Ctrl+←/→` to fine-tune
5. Save layout: `mux save-layout -t advanced-layout -n exercise1-layout`
6. Export to YAML: View the saved file in `~/.config/honeymux/layouts/exercise1-layout.yaml`
7. Validate the layout by creating a new session: `mux new-session -s test-restore -L exercise1-layout`

**Expected output:**
You have a saved layout file that can be committed to git and shared with team members.

---

### Exercise 2: Implement Hook-Based Monitoring

**Objective:** Create a custom hook that monitors pane output and alerts on specific patterns.

**Steps:**

1. Create a hook script:
   ```bash
   mkdir -p ~/.config/honeymux/hooks
   cat > ~/.config/honeymux/hooks/pattern-monitor.sh << 'EOF'
   #!/bin/bash
   # Monitor for ERROR or FAIL in pane output
   
   SESSION=$1
   WINDOW=$2
   PANE=$3
   
   OUTPUT=$(tmux capture-pane -t $SESSION:$WINDOW.$PANE -p -S -10)
   
   if echo "$OUTPUT" | grep -qi "ERROR\|FAIL\|EXCEPTION"; then
     # Alert
     echo "[$(date)] Alert in pane $SESSION:$WINDOW.$PANE" >> ~/.honeymux-alerts.log
     osascript -e 'display notification "Pattern detected" with title "Honeymux Alert"' 2>/dev/null
   fi
   EOF
   
   chmod +x ~/.config/honeymux/hooks/pattern-monitor.sh
   ```

2. Configure hook in Options (`Ctrl+O`):
   - Set `hook-script-dir: ~/.config/honeymux/hooks`
   - Set `hook-events: pane-content-changed`
   - Enable `enable-hooks: yes`

3. Create a test pane and generate output:
   ```bash
   mux new-session -s hook-test -d
   mux send-keys -t hook-test "echo 'Processing...' && sleep 2 && echo 'ERROR: Something failed'" Enter
   ```

4. Watch the alert trigger:
   ```bash
   tail -f ~/.honeymux-alerts.log
   ```

**Expected output:**
The alert log shows timestamped entries when ERROR/FAIL patterns appear.

---

### Exercise 3: SSH Pane Stitching Configuration

**Objective:** Set up SSH stitching to a remote server and merge panes in one window.

**Prerequisites:**
- SSH access to a remote server
- Tmux installed on remote server

**Steps:**

1. Configure remote servers in `~/.config/honeymux/remote-servers.yaml`:
   ```yaml
   remotes:
     - name: exercise-server
       host: your-server.example.com
       user: youruser
       port: 22
       identity: ~/.ssh/id_rsa
       initial_tmux_session: honeymux-stitched
   ```

2. Enable SSH stitching in Options:
   - `enable-ssh-stitching: yes`
   - `lazy-load-remote: yes`

3. Create a session:
   ```bash
   mux new-session -s stitch-demo -d
   ```

4. In Honeymux (attach to session):
   ```bash
   mux attach-session -t stitch-demo
   ```

5. Create a stitched pane:
   - Press `Ctrl+\` (or menu: Window → Stitch Remote)
   - Select "exercise-server"
   - Observe the pane loading (shows "Connecting...")

6. Once connected, test commands in the stitched pane:
   ```
   (in stitched pane)
   $ ls
   $ pwd
   $ tmux list-panes
   ```

**Expected output:**
A pane in your local Honeymux window that shows remote server content and responds to commands.

---

### Exercise 4: Integrate with Justfile for Automation

**Objective:** Create a justfile that manages Honeymux sessions and layouts for a project.

**Steps:**

1. Create a project directory and justfile:
   ```bash
   mkdir ~/exercises/exercise4
   cd ~/exercises/exercise4
   
   cat > justfile << 'EOF'
   default:
       @just --list
   
   setup:
       #!/bin/bash
       mux new-session -d -s exercise4 -c $(pwd)
       mux new-window -t exercise4:1 -n editor
       mux new-window -t exercise4:2 -n tests
       tmux send-keys -t exercise4:editor "nvim ." Enter
       tmux send-keys -t exercise4:tests "while true; do echo '[$(date)] Tests would run here'; sleep 5; done" Enter
       echo "✓ Session setup complete"
   
   attach:
       mux attach-session -t exercise4
   
   save-layout:
       mux save-layout -t exercise4 -n exercise4-layout
       @echo "✓ Layout saved"
   
   list:
       mux list-sessions | grep exercise4
   
   clean:
       tmux kill-session -t exercise4 2>/dev/null
       @echo "✓ Session cleaned up"
   EOF
   ```

2. Run setup:
   ```bash
   just setup
   ```

3. Verify:
   ```bash
   just list
   just attach
   ```

4. Save layout:
   ```bash
   just save-layout
   ```

5. Clean up:
   ```bash
   just clean
   ```

**Expected output:**
All commands succeed without errors. The layout is saved and can be restored.

---

### Exercise 5: Performance Tuning and Terminal Compatibility Testing

**Objective:** Test Honeymux performance and compatibility across different terminal emulators.

**Steps:**

1. Create a performance test session:
   ```bash
   mux new-session -d -s perf-test -x 240 -y 60
   
   # Create many panes to stress test rendering
   for i in {1..10}; do
     tmux split-window -t perf-test:0 -v
     tmux send-keys -t perf-test "watch -n 0.1 'date && ps aux | head -5'" Enter
   done
   ```

2. Monitor performance:
   ```bash
   # In a separate terminal
   while true; do
     ps aux | grep honeymux
     sleep 1
   done
   ```

3. Test in different terminal emulators:
   - Open Honeymux in Kitty
   - Open in iTerm2
   - Open in Alacritty
   - Open in WezTerm
   
   Compare:
   - Startup time
   - Rendering smoothness (watch for flicker)
   - Mouse responsiveness
   - Image protocol support (screenshots)

4. Check terminal capabilities:
   ```bash
   # In Honeymux, go to Window → About/Diagnostics
   # Or check logs:
   grep -i "capability\|terminal" ~/.local/share/honeymux/logs/honeymux.log
   ```

5. Adjust performance options:
   - Lower `render-fps` if CPU usage is high
   - Enable `lazy-load-remote` for many stitched panes
   - Reduce `history-limit` if memory is constrained

**Expected output:**
Document which terminal emulator(s) perform best and which rendering optimizations suit your hardware.

## Troubleshooting

### Issue: Tmux Version Conflicts

**Problem:** "Honeymux requires tmux 3.1 or newer, but you have 3.0"

**Solutions:**

1. **Upgrade tmux:**
   ```bash
   # macOS
   brew upgrade tmux
   
   # Ubuntu/Debian
   sudo apt-get install --upgrade tmux
   
   # Check version
   tmux -V
   ```

2. **Install Honeymux's bundled tmux:**
   ```bash
   curl -fsSL https://get.hmx.dev | bash
   # This may install a compatible tmux version
   ```

3. **Use older Honeymux version (not recommended):**
   ```bash
   brew install honeymux/tap/hmx@0.8
   ```

### Issue: SSH Stitching Fails with "Connection refused"

**Problem:** "SSH pane stitching: Connection refused or timeout"

**Debugging steps:**

1. **Verify SSH connectivity:**
   ```bash
   ssh -v user@host "echo connected"
   # Check for auth errors, wrong port, firewall blocks
   ```

2. **Check remote tmux:**
   ```bash
   ssh user@host "which tmux && tmux -V"
   # Ensure tmux is installed and correct version
   ```

3. **Check SSH key permissions:**
   ```bash
   ls -la ~/.ssh/id_rsa
   # Should be 600 (-rw-------)
   chmod 600 ~/.ssh/id_rsa
   ```

4. **Test manual SSH stitching:**
   ```bash
   ssh -N -f user@host
   ssh user@host "tmux new-session -d -s test"
   ssh user@host "tmux list-sessions"
   ```

5. **Check Honeymux config:**
   ```bash
   cat ~/.config/honeymux/remote-servers.yaml
   # Verify: host, user, port, identity path
   ```

6. **View Honeymux logs:**
   ```bash
   tail -50 ~/.local/share/honeymux/logs/honeymux.log | grep -i ssh
   ```

### Issue: Hook Script Not Executing

**Problem:** Hook scripts are configured but not running.

**Debugging:**

1. **Verify hooks are enabled:**
   ```bash
   # Options dialog (Ctrl+O)
   # Check: enable-hooks = yes
   ```

2. **Test hook directly:**
   ```bash
   # Manually trigger hook
   tmux set-hook -g test-hook "run-shell 'echo hello > /tmp/hook-test.txt'"
   tmux send-keys -t SESSION C-c  # Should trigger hook
   
   # Check result
   cat /tmp/hook-test.txt
   ```

3. **Check script permissions:**
   ```bash
   ls -la ~/.config/honeymux/hooks/
   # All scripts should be executable (755)
   chmod +x ~/.config/honeymux/hooks/*.sh
   ```

4. **Check hook-script-dir setting:**
   ```bash
   # Options dialog
   # Verify hook-script-dir points to correct location
   ls -la ~/.config/honeymux/hooks
   ```

5. **Review hook logs:**
   ```bash
   tail -f ~/.honeymux-alerts.log 2>/dev/null || echo "No alerts yet"
   ```

6. **Test with simple hook:**
   ```bash
   cat > ~/.config/honeymux/hooks/test.sh << 'EOF'
   #!/bin/bash
   echo "[$(date)] Hook executed" >> ~/.honeymux-hook-test.log
   EOF
   chmod +x ~/.config/honeymux/hooks/test.sh
   # Wait for pane event, check:
   cat ~/.honeymux-hook-test.log
   ```

### Issue: Performance Degradation with Many Panes

**Problem:** Honeymux becomes slow or unresponsive with 10+ panes.

**Solutions:**

1. **Lower render fps:**
   ```bash
   # Options dialog
   # render-fps: 15  (instead of 30)
   ```

2. **Reduce history limit:**
   ```bash
   # Options
   # history-limit: 1000  (instead of 2000)
   ```

3. **Enable lazy-load for remote panes:**
   ```yaml
   # ~/.config/honeymux/config.yaml
   lazy-load-remote: yes
   ```

4. **Disable unnecessary hooks:**
   ```bash
   # Options
   # enable-hooks: no  (if not using them)
   ```

5. **Check CPU/Memory:**
   ```bash
   ps aux | grep honeymux
   # If CPU > 50% or MEM > 100MB, something is wrong
   ```

6. **Restart Honeymux:**
   ```bash
   mux kill-session -t problematic-session
   # Start fresh
   ```

### Issue: Terminal Emulator Compatibility

**Problem:** Rendering looks broken in specific terminal emulator.

**Matrix:**

| Terminal | Issue | Solution |
|----------|-------|----------|
| **iTerm2** | Colors inverted | Update iTerm2, check theme settings |
| **Alacritty** | No mouse support | Upgrade to 0.13+, enable `enable-mouse` |
| **Ghostty** | Image rendering broken | Update Ghostty, enable image protocol |
| **WezTerm** | Keyboard protocol not detected | Set `enable_kitty_keyboard = true` in wezterm.lua |
| **Kitty** | Slow rendering | Lower `render-fps`, enable `lazy-load-remote` |

**Debug terminal compatibility:**

```bash
# Check if terminal is being detected
mux about  # or check logs

# Test escape sequence support
echo -e '\e[38;5;196mRed\e[0m'  # Should print red text
printf '\e[?1049h'              # Alternative screen buffer
printf '\e]6c\e\\'               # Device attributes

# Kitty protocol test
echo -e '\e_Ga=T\e\\'            # Should cause no error
```

### Issue: Honeymux Won't Start

**Problem:** "Error: Failed to initialize TUI" or "Honeymux exited unexpectedly"

**Steps:**

1. **Check tmux server:**
   ```bash
   tmux -S /tmp/tmux-test new-session
   # If fails, tmux is broken
   ```

2. **Check terminal:**
   ```bash
   echo $TERM
   # Should be: xterm-256color, xterm-kitty, etc.
   
   # If not set:
   export TERM=xterm-256color
   ```

3. **Check Honeymux installation:**
   ```bash
   which mux
   mux version
   ```

4. **Review logs:**
   ```bash
   tail -100 ~/.local/share/honeymux/logs/honeymux.log
   grep -i "error\|fatal" ~/.local/share/honeymux/logs/honeymux.log
   ```

5. **Reinstall Honeymux:**
   ```bash
   brew uninstall honeymux/tap/hmx
   brew install honeymux/tap/hmx
   ```

6. **Check dependencies:**
   ```bash
   # Honeymux depends on: tmux, libghostty-vt, openTUI
   # Verify all installed:
   brew list | grep -E "tmux|ghostty|openTUI"
   ```

## References

### Official Documentation
- **Honeymux Website:** https://hmx.dev
- **Honeymux Docs:** https://docs.hmx.dev
- **GitHub Repo:** https://github.com/honeymux/honeymux (check Issues/Discussions)
- **Installation:** `brew install honeymux/tap/hmx` or `curl -fsSL https://get.hmx.dev | bash`

### Tmux Resources
- **Tmux Manual:** `man tmux` or https://man.openbsd.org/tmux
- **Tmux Hooks Documentation:** `tmux list-hooks` or search "set-hook" in manual
- **Tmux Configuration Guide:** https://github.com/tmux/tmux/wiki

### Related Tools
- **OpenTUI:** TUI widget library (https://github.com/openchatai/opentui)
- **libghostty-vt:** Terminal emulation library (https://github.com/ghostty-org/ghostty)
- **Sesh:** Session manager (https://github.com/joshmedeski/sesh)
- **Tmuxp:** Session manager with YAML config (https://github.com/tmux-python/tmuxp)
- **Mosh:** Mobile Shell for persistent remote connections (https://mosh.org)
- **Just:** Command runner (https://just.systems)

### SSH and Remote Development
- **SSH Manual:** `man ssh` or https://man.openbsd.org/ssh
- **SSH Key Management:** https://github.com/jqlang/jq/wiki/Frequently-Asked-Questions#ssh
- **SSH Multiplexing:** Search "ControlMaster" in SSH manual

### Other Resources
- **Terminal Emulator Guide:** https://wezfurlong.org/wezterm/ (WezTerm docs)
- **Base16 Themes:** https://base16.io (for Honeymux theming)
- **ANSI/VT Escape Codes:** https://en.wikipedia.org/wiki/ANSI_escape_code

## Related Tutorials

For complementary workflows and tools, see:

- [[honeymux-beginner-guide|Honeymux Beginner Guide]] — Get started with basics
- [[openmux-beginner-guide|OpenMux Beginner Guide]] — Lightweight alternative
- [[openmux-deep-dive|OpenMux Deep Dive]] — Advanced OpenMux techniques
- [[sesh-beginner-guide|Sesh Beginner Guide]] — Session discovery
- [[sesh-deep-dive|Sesh Deep Dive]] — Advanced orchestration
- [[mosh-beginner-guide|Mosh Beginner Guide]] — Persistent remote shells
- [[mosh-deep-dive|Mosh Deep Dive]] — Mobile shell internals
- [[dotfiles-beginner-guide|Dotfiles Beginner Guide]] — Configuration management
- [[dotfiles-deep-dive|Dotfiles Deep Dive]] — Advanced dotfiles patterns
- [[chezmoi-beginner-guide|Chezmoi Beginner Guide]] — Machine-specific configs
- [[chezmoi-deep-dive|Chezmoi Deep Dive]] — Chezmoi internals
- [[just-beginner-guide|Just Beginner Guide]] — Task automation
- [[just-deep-dive|Just Deep Dive]] — Advanced just recipes
- [[docker-test-container-beginner-guide|Docker Test Container Beginner Guide]] — Container testing
- [[docker-test-container-deep-dive|Docker Test Container Deep Dive]] — Container internals
- [[hammerspoon-deep-dive|Hammerspoon Deep Dive]] — macOS automation
- [[bunch-deep-dive|Bunch Deep Dive]] — Context switching
- [[git-worktrees-worktrunk-deep-dive|Git Worktrees Deep Dive]] — Multi-branch workflows
- [[kubernetes-deep-dive|Kubernetes Deep Dive]] — Remote container workflows

## Summary

Honeymux represents a modern approach to terminal multiplexing, combining the power and flexibility of tmux with intuitive graphical interfaces and advanced features like SSH pane stitching, hook-based automation, and layout profiles.

**Key takeaways:**

1. **Architecture:** Honeymux wraps tmux rather than replacing it, ensuring full compatibility while adding sophisticated UI features.

2. **Wrapping vs. replacing:** Understand how Honeymux's layered approach (TUI → tmux → terminal) provides advantages and trade-offs.

3. **Hooks for automation:** Use tmux hooks and Honeymux's hook system to monitor long-running processes, coding agents, and custom workflows.

4. **SSH pane stitching:** Merge remote and local panes in a single Honeymux window for seamless multi-server development.

5. **Layout profiles:** Design complex window arrangements once, save as profiles, and share with teams via git.

6. **Integration patterns:** Combine Honeymux with Sesh (discovery), Mosh (persistence), justfiles (automation), and existing tmux configs.

7. **Performance tuning:** Optimize rendering for your hardware and terminal emulator by adjusting FPS, history limits, and lazy-loading.

8. **Terminal compatibility:** Test across Kitty, iTerm2, WezTerm, Alacritty, and Ghostty to ensure consistent experience.

9. **Alternatives and complements:** Choose between Honeymux, OpenMux, tmuxp, and tmuxinator based on your needs, or use them together.

10. **Ongoing reference:** Return to this guide for detailed troubleshooting, architectural explanations, and advanced workflow examples.

Honeymux is pre-1.0 software with active development. Stay updated on GitHub for new features (likely: improved remote support, more sophisticated hooks, better plugin system). The tool is built on proven foundations (tmux, OpenTUI, libghostty-vt) and Apache 2.0 licensed, making it suitable for both personal and professional use.
# Related Tutorials

- [[dtach-beginner-guide|Dtach Beginner Guide]] — minimal session detach as a complement to tmux/Honeymux
- [[dtach-deep-dive|Dtach Deep Dive]] — advanced dtach patterns and Unix socket internals

- [[tmux-claude-code-beginner-guide|Tmux + Claude Code Beginner Guide]] — Using tmux with Claude Code for agentic coding
- [[tmux-claude-code-deep-dive|Tmux + Claude Code Deep Dive]] — Advanced tmux + Claude Code automation

- [[herdr-beginner-guide|Herdr Beginner Guide]] — agent-native terminal multiplexer
- [[herdr-deep-dive|Herdr Deep Dive]] — advanced Herdr configuration and API