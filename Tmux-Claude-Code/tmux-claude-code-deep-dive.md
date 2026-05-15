---
title: "Tmux + Claude Code — Deep Dive"
date: 2026-05-13
difficulty: advanced
tags: [tmux, claude-code, terminal, session-management, ai-coding, agentic-coding, workflow, automation, scripting]
---

# Tmux + Claude Code — Deep Dive

## Overview

This is the advanced reference for power users who want to get the most out of tmux + Claude Code. It covers the full picture: architecture internals, parallel agent workflows, scripting patterns, performance tuning, and integration with the broader terminal ecosystem.

Topics covered:
- **Architecture**: how tmux's client-server model works and why it's ideal for long-running AI agents
- **Parallel agents**: running multiple Claude Code instances across worktrees, branches, and projects
- **Scripting and automation**: repeatable, idempotent workspace scripts
- **Performance tuning**: handling heavy Claude Code output without degrading your terminal
- **Tool integrations**: sesh, fzf, git worktrees, Mosh
- **Team and CI/CD patterns**: headless operation, output capture, automation pipelines

Reference [[tmux-claude-code-beginner-guide]] for the fundamentals before continuing here.

---

## Prerequisites

Before working through this guide you should have:

- Everything from the beginner guide: tmux installed, basic keybindings, attaching/detaching
- Comfort with tmux concepts — sessions, windows, panes, prefix key, copy mode
- Shell scripting experience (bash/zsh) — you will write scripts
- Familiarity with Claude Code's permission modes, CLAUDE.md files, and subagents
- Git worktree understanding is helpful — reference [[git-worktrees-worktrunk-beginner-guide]]
- See [[claude-cheatsheet]] for a complete Claude Code command reference

---

## Key Concepts

### tmux Client-Server Architecture

Understanding tmux's internals explains why it pairs so well with Claude Code.

When you run `tmux` for the first time, two processes are created:

1. **The tmux server** — a long-lived background process that owns all sessions, windows, and panes. It communicates over a Unix domain socket (typically `/tmp/tmux-$(id -u)/default`). The server continues running even after every client disconnects.

2. **The tmux client** — your terminal window, iTerm tab, or SSH session. Clients connect to the server, render its output, and forward your keystrokes. Clients are disposable; the server is not.

```
┌─────────────────────────────────────────────────────────┐
│                    tmux server                           │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ session: auth│  │ session: perf│  │session:refact│  │
│  │  claude …    │  │  claude …    │  │  claude …    │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│           ↑                                             │
│     Unix socket: /tmp/tmux-1000/default                 │
└─────────────────────────────────────────────────────────┘
           ↑               ↑
    [terminal A]      [terminal B]        ← clients come and go
```

**Why this matters for Claude Code:**

Claude Code agents can run for minutes or hours — generating code, running tests, making API calls. With a raw SSH session, network interruptions kill the process. With tmux, the agent lives in the server and keeps running. You reconnect, and it's still there.

You can also connect multiple clients to the same server simultaneously — one on your laptop, one on a second monitor, one from your phone via Mosh. All see the same live state.

**Inspecting the socket:**

```bash
# See the socket path
tmux display-message -p '#{socket_path}'
# Output: /tmp/tmux-501/default

# List all running sessions from outside tmux
tmux ls

# Connect a second client to the same server
tmux attach -t mysession

# Use a named socket (useful for multi-user or container setups)
tmux -L myserver new-session -s work
tmux -L myserver attach -t work
```

---

### Claude Code's Execution Model

Claude Code has several execution modes — choosing the right one for a tmux pane matters.

| Mode | Flag | Use Case |
|------|------|----------|
| Interactive REPL | `claude` (no flags) | Primary development work, back-and-forth with the agent |
| One-shot (print mode) | `claude -p "prompt"` | Scripting, CI, headless automation |
| Continue last session | `claude -c` | Resume after detach or crash |
| Resume by ID | `claude -r <id>` | Jump back to a specific conversation |

**Permission modes** control what the agent can do without asking:

```bash
claude --permission-mode plan          # propose only, never execute
claude --permission-mode acceptEdits   # auto-accept file edits, ask for commands
claude --permission-mode auto          # auto-approve low-risk, ask for high-risk
claude --permission-mode bypassPermissions  # full auto (use carefully in isolated envs)
```

**Subagents**: Claude Code can spawn parallel subagents internally. These share the same tmux pane and process — they are not separate OS processes. For true OS-level parallelism, use separate tmux sessions with separate `claude` invocations.

**Context management**: in a long session, context fills up. Use:

```bash
# Inside Claude Code interactive session:
/compact          # summarizes old context, keeps working memory
/status           # check how full the context window is

# From the shell (start a fresh continuation):
claude -c         # continues the most recent session
claude --continue # same thing
```

---

### Parallel Agent Architecture

The right mental model for parallel Claude Code work:

```
repo/
├── main branch          ← tmux session "main"    (review/integration)
├── worktrees/
│   ├── feature-auth     ← tmux session "auth"    (claude agent #1)
│   ├── fix-perf         ← tmux session "perf"    (claude agent #2)
│   └── refactor         ← tmux session "refactor" (claude agent #3)
└── CLAUDE.md            ← shared instructions for all agents
```

Key rules for parallel agents:

1. **Never share a worktree between two agents** — git state corruption will happen
2. **Each session = one worktree = one Claude Code instance** — clean isolation
3. **CLAUDE.md is inherited** — all agents read it, so keep shared instructions there
4. **Agents don't share context** — they're independent processes; communication is via the filesystem (committed code, shared files)
5. **Monitor all from one client** — `tmux attach -t main` then use `switch-client` to jump between sessions

---

### tmux Hooks and Automation

tmux has a hook system that fires shell commands on lifecycle events:

```bash
# Fire a command when any session is created
tmux set-hook -g after-new-session "run-shell '~/scripts/session-init.sh'"

# Fire when a pane exits (e.g., Claude Code finishes)
tmux set-hook -g pane-exited "run-shell 'notify-send tmux \"Pane exited in #{session_name}\"'"

# Fire after a window is renamed
tmux set-hook -g after-rename-window "run-shell '~/scripts/update-status.sh'"
```

Key hooks for Claude Code workflows:

| Hook | Trigger | Use Case |
|------|---------|----------|
| `after-new-session` | New session created | Auto-launch Claude Code, set env vars |
| `pane-exited` | A pane's process ends | Notify when agent finishes |
| `after-split-window` | Pane split | Auto-size or auto-launch helper process |
| `window-activity` | Output detected | Alert when quiet agent produces output |
| `client-detached` | You disconnect | Save state, log timestamps |

---

## Step-by-Step Instructions

### Step 1: Advanced tmux Configuration for Claude Code

A production-ready `~/.tmux.conf` tuned for Claude Code workflows. Comments explain every setting.

```bash
# ~/.tmux.conf — tuned for Claude Code

# ── Scrollback ─────────────────────────────────────────────────────────────
# Claude Code produces a LOT of output. 100k lines prevents losing history.
set -g history-limit 100000

# ── Mouse ──────────────────────────────────────────────────────────────────
# Essential: click to switch panes, scroll to review Claude Code changes.
set -g mouse on

# ── Colors ─────────────────────────────────────────────────────────────────
# True color support — Claude Code's syntax highlighting needs this.
set -g default-terminal "tmux-256color"
set -ga terminal-overrides ",*256col*:Tc"

# ── Prefix Key ─────────────────────────────────────────────────────────────
# Ctrl+A is faster to type than Ctrl+B (left hand only).
unbind C-b
set -g prefix C-a
bind C-a send-prefix

# ── Timing ─────────────────────────────────────────────────────────────────
# Eliminate escape key delay — critical for Vim/Neovim inside tmux.
set -sg escape-time 0

# ── Reload ─────────────────────────────────────────────────────────────────
bind r source-file ~/.tmux.conf \; display "Config reloaded!"

# ── Splits ─────────────────────────────────────────────────────────────────
# Open splits in the current directory, not the original session dir.
bind | split-window -h -c "#{pane_current_path}"
bind - split-window -v -c "#{pane_current_path}"
unbind '"'
unbind %

# ── Pane Navigation (no prefix needed) ─────────────────────────────────────
bind -n M-Left  select-pane -L
bind -n M-Right select-pane -R
bind -n M-Up    select-pane -U
bind -n M-Down  select-pane -D

# ── Pane Resize (no prefix needed) ─────────────────────────────────────────
bind -n C-M-Left  resize-pane -L 5
bind -n C-M-Right resize-pane -R 5
bind -n C-M-Up    resize-pane -U 5
bind -n C-M-Down  resize-pane -D 5

# ── Window Navigation ───────────────────────────────────────────────────────
bind -n M-n next-window
bind -n M-p previous-window

# ── Session Switching ───────────────────────────────────────────────────────
# Quickly jump between Claude Code sessions
bind -n M-( switch-client -p
bind -n M-) switch-client -n

# ── Copy Mode ───────────────────────────────────────────────────────────────
# Vi-style copy mode — essential for navigating Claude Code output
setw -g mode-keys vi
bind -T copy-mode-vi v send -X begin-selection
bind -T copy-mode-vi y send -X copy-pipe-and-cancel "pbcopy"   # macOS
# bind -T copy-mode-vi y send -X copy-pipe-and-cancel "xclip -in -sel clip"  # Linux

# ── Window Naming ───────────────────────────────────────────────────────────
# Don't auto-rename — you'll name windows after what Claude Code is doing.
set -g allow-rename off
setw -g automatic-rename off

# ── Activity Monitoring ─────────────────────────────────────────────────────
# Get alerted (visual flash) when a quiet Claude Code agent produces output.
setw -g monitor-activity on
set -g visual-activity on
set -g visual-bell off      # disable audio bell

# ── Status Bar ─────────────────────────────────────────────────────────────
set -g status on
set -g status-interval 5
set -g status-position bottom
set -g status-left-length 40
set -g status-right-length 80

# Session name (green) + separator
set -g status-left '#[fg=colour46,bold]#{session_name} #[fg=colour250]│ '

# Time + hostname
set -g status-right '#[fg=colour226]%H:%M #[fg=colour250]│ #[fg=colour87]#{host_short}'

# Active window: bright
set-window-option -g window-status-current-format '#[fg=colour226,bold] #I:#W '

# Inactive window: dim, with activity flag
set-window-option -g window-status-format '#[fg=colour250] #I:#W#{?window_activity_flag,!,} '

# Highlight active pane border
set -g pane-active-border-style 'fg=colour46'
set -g pane-border-style 'fg=colour240'
```

Reload after saving:

```bash
tmux source-file ~/.tmux.conf
# or press Ctrl+A then r if already in tmux
```

---

### Step 2: Parallel Claude Code Agents with Git Worktrees

Git worktrees allow multiple working trees from the same repository — each has its own checked-out branch, staged changes, and working files. Combined with tmux sessions, this gives you true parallel Claude Code agents with zero risk of conflict.

**Setting up worktrees:**

```bash
# From your main repo directory
cd ~/projects/myapp

# Create three worktrees for parallel work
git worktree add ../myapp-feature-auth feature/auth
git worktree add ../myapp-fix-perf     fix/performance
git worktree add ../myapp-refactor     refactor/cleanup

# Verify
git worktree list
# /Users/you/projects/myapp              abc1234 [main]
# /Users/you/projects/myapp-feature-auth def5678 [feature/auth]
# /Users/you/projects/myapp-fix-perf     ghi9012 [fix/performance]
# /Users/you/projects/myapp-refactor     jkl3456 [refactor/cleanup]
```

**Create tmux sessions and launch agents:**

```bash
# Create a session rooted at each worktree
tmux new-session -d -s auth     -c ~/projects/myapp-feature-auth
tmux new-session -d -s perf     -c ~/projects/myapp-fix-perf
tmux new-session -d -s refactor -c ~/projects/myapp-refactor

# Launch Claude Code in each with an initial task
tmux send-keys -t auth     "claude 'Implement JWT authentication for all API endpoints. See CLAUDE.md for conventions.'" C-m
tmux send-keys -t perf     "claude 'Profile the application and fix the three slowest database queries.'" C-m
tmux send-keys -t refactor "claude 'Refactor the user module into separate domain concerns: auth, profile, preferences.'" C-m

# Monitor all three from a dashboard session
tmux new-session -d -s dashboard
tmux split-window -t dashboard -h
tmux split-window -t dashboard:0.0 -v
# Now 3 panes — connect each to a session for read-only monitoring
```

**Checking in on agents without interrupting them:**

```bash
# Switch to a session to see its state
tmux switch-client -t auth

# Capture the last 50 lines of output without attaching
tmux capture-pane -t auth -p -S -50

# See just the last line (what Claude Code is currently doing)
tmux capture-pane -t auth -p | tail -5
```

Reference [[git-worktrees-worktrunk-deep-dive]] for advanced worktree patterns including pruning, locking, and the worktrunk workflow.

---

### Step 3: Advanced Workspace Automation Scripts

Manual setup is error-prone and slow. This script creates a complete multi-agent workspace in one command. It's idempotent — safe to run multiple times.

```bash
#!/usr/bin/env bash
# ~/scripts/claude-workspace.sh
# Usage: ./claude-workspace.sh [project-root] [session-name]
# Creates a full multi-agent Claude Code workspace.

set -euo pipefail

PROJECT_ROOT="${1:-$HOME/projects/myapp}"
SESSION="${2:-myapp}"

# ── Guards ──────────────────────────────────────────────────────────────────
if [ ! -d "$PROJECT_ROOT" ]; then
    echo "Error: project root '$PROJECT_ROOT' does not exist"
    exit 1
fi

# Kill any existing session with this name
if tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "Killing existing session: $SESSION"
    tmux kill-session -t "$SESSION"
fi

echo "Creating workspace: $SESSION → $PROJECT_ROOT"

# ── Window 1: Main Agent (acceptEdits mode) ─────────────────────────────────
tmux new-session -d -s "$SESSION" -n agent -c "$PROJECT_ROOT"
# Set a useful environment variable all Claude Code instances can read
tmux setenv -t "$SESSION" CLAUDE_WORKSPACE "$PROJECT_ROOT"
# Launch Claude Code in acceptEdits mode: auto-applies file edits, asks for shell commands
tmux send-keys -t "$SESSION:agent" "claude --permission-mode acceptEdits" C-m

# ── Window 2: Testing (split: watch tests left | git diff right) ────────────
tmux new-window -t "$SESSION" -n testing -c "$PROJECT_ROOT"
tmux split-window -t "$SESSION:testing" -h -p 40 -c "$PROJECT_ROOT"
# Left pane: continuous test runner
tmux send-keys -t "$SESSION:testing.0" "npm test -- --watch 2>&1 | tail -40" C-m
# Right pane: live diff stats
tmux send-keys -t "$SESSION:testing.1" "watch -n 3 'git diff --stat; echo; git status -s'" C-m

# ── Window 3: Plan/Review Mode ──────────────────────────────────────────────
tmux new-window -t "$SESSION" -n review -c "$PROJECT_ROOT"
tmux send-keys -t "$SESSION:review" "claude --permission-mode plan" C-m

# ── Window 4: Monitoring (logs + system) ────────────────────────────────────
tmux new-window -t "$SESSION" -n monitor -c "$PROJECT_ROOT"
tmux split-window -t "$SESSION:monitor" -v -p 30 -c "$PROJECT_ROOT"
# Top pane: application logs
tmux send-keys -t "$SESSION:monitor.0" \
    "tail -f logs/*.log 2>/dev/null || echo 'Waiting for logs... (run your app to generate)'" C-m
# Bottom pane: system resources
tmux send-keys -t "$SESSION:monitor.1" "htop" C-m

# ── Window 5: Scratch Shell ─────────────────────────────────────────────────
tmux new-window -t "$SESSION" -n shell -c "$PROJECT_ROOT"
# Just a clean shell for one-off commands

# ── Focus on the agent window ───────────────────────────────────────────────
tmux select-window -t "$SESSION:agent"

echo "Workspace ready. Attaching to session: $SESSION"
echo "  Windows: agent | testing | review | monitor | shell"
echo "  Detach:  Ctrl+A d"
echo "  Quit:    tmux kill-session -t $SESSION"

tmux attach -t "$SESSION"
```

Make it executable and use it:

```bash
chmod +x ~/scripts/claude-workspace.sh
./claude-workspace.sh ~/projects/myapp myapp
```

**Multi-project variant** — launch parallel sessions for multiple repos at once:

```bash
#!/usr/bin/env bash
# ~/scripts/claude-all-projects.sh
# Launches Claude Code workspaces for all active projects

PROJECTS=(
    "myapp-frontend:$HOME/projects/frontend"
    "myapp-backend:$HOME/projects/backend"
    "myapp-infra:$HOME/projects/infra"
)

for entry in "${PROJECTS[@]}"; do
    name="${entry%%:*}"
    path="${entry##*:}"
    if [ -d "$path" ]; then
        echo "Starting workspace: $name"
        ~/scripts/claude-workspace.sh "$path" "$name" &
    fi
done

wait
echo "All workspaces started. List sessions: tmux ls"
```

---

### Step 4: tmux + Sesh Integration for Claude Code

[[sesh-deep-dive|Sesh]] is a smart tmux session manager that can auto-launch Claude Code based on project detection. See [[sesh-beginner-guide]] for installation.

**Sesh configuration for Claude Code:**

```toml
# ~/.config/sesh/sesh.toml

# Named sessions with explicit Claude Code startup
[[session]]
name = "claude-frontend"
path = "~/projects/frontend"
startup_command = "claude --permission-mode acceptEdits"

[[session]]
name = "claude-backend"
path = "~/projects/backend"
startup_command = "claude --permission-mode acceptEdits"

[[session]]
name = "claude-infra"
path = "~/projects/infra"
startup_command = "claude --permission-mode plan"   # infra changes are riskier

# Wildcard: any project directory gets Claude Code in plan mode by default
[[wildcard]]
pattern = "~/projects/*"
startup_command = "claude --permission-mode plan"

# Override for specific subdirectory patterns
[[wildcard]]
pattern = "~/projects/sandbox-*"
startup_command = "claude --permission-mode bypassPermissions"   # sandboxes are safe
```

**fzf integration for session switching:**

```bash
# Add to ~/.zshrc or ~/.bashrc
# Ctrl+F: fuzzy-find and switch to any sesh-managed session
bindkey '^F' _sesh_fzf_widget

_sesh_fzf_widget() {
    local selected
    selected=$(sesh list | fzf \
        --height 40% \
        --reverse \
        --border \
        --prompt "  Claude Code Session > " \
        --preview 'tmux capture-pane -pt {} -S -20 2>/dev/null || echo "not running"'
    )
    if [ -n "$selected" ]; then
        sesh connect "$selected"
    fi
    zle reset-prompt
}
zle -N _sesh_fzf_widget
```

---

### Step 5: Claude Code Hooks + tmux Notifications

Claude Code supports lifecycle hooks — shell scripts that fire before/after tool calls, on session start/end, etc. You can use these with tmux's `display-message` to get real-time notifications.

**Hook directory structure:**

```
~/.claude/hooks/
├── pre-tool.sh       # fires before any tool executes
├── post-tool.sh      # fires after any tool executes
├── on-error.sh       # fires when Claude Code encounters an error
└── session-start.sh  # fires when a new Claude Code session starts
```

**Post-tool notification hook:**

```bash
#!/usr/bin/env bash
# ~/.claude/hooks/post-tool.sh
# Notifies you in tmux when Claude Code completes significant tool actions.

TOOL_NAME="${CLAUDE_TOOL_NAME:-unknown}"
SESSION_NAME="${TMUX_PANE_SESSION:-}"   # set by tmux if running inside tmux

case "$TOOL_NAME" in
    bash)
        MSG="Ran shell command"
        ;;
    write_file|edit_file)
        MSG="File edited: ${CLAUDE_TOOL_FILE:-?}"
        ;;
    task)
        MSG="Subagent task completed"
        ;;
    *)
        exit 0   # don't notify for minor tools
        ;;
esac

# Display in the tmux status bar for 4 seconds
if [ -n "$TMUX" ]; then
    tmux display-message -d 4000 "Claude Code: $MSG"
fi

# Also write to a log file for later review
echo "$(date '+%H:%M:%S') [$SESSION_NAME] $MSG" >> ~/.claude/activity.log
```

**Using tmux `wait-for` for inter-pane synchronization:**

```bash
# In pane 0: Claude Code runs, then signals completion
claude -p "Fix the failing tests" && tmux wait-for -S claude-done

# In pane 1: wait for Claude Code to finish, then run integration tests
tmux wait-for claude-done && npm run test:integration
```

This is powerful for scripted workflows where one agent's output feeds the next.

---

### Step 6: Remote Development with Mosh + tmux + Claude Code

SSH drops on flaky networks. Mosh maintains a persistent UDP connection that survives network changes, sleep, and IP changes. Combined with tmux, you get unbreakable remote Claude Code sessions.

**Setup on the remote server:**

```bash
# Install Mosh on the remote (Ubuntu/Debian)
sudo apt install mosh

# Install tmux (if not present)
sudo apt install tmux

# On macOS (local machine), install Mosh
brew install mosh
```

**Connect and start a persistent Claude Code session:**

```bash
# Connect to remote with Mosh
mosh user@dev-server.example.com

# Once connected, start or attach to a tmux session
tmux new-session -s remote-claude -c ~/projects/myapp

# Launch Claude Code
claude --permission-mode acceptEdits

# Detach: Ctrl+A d
# Mosh connection is still alive, Claude Code is still running
```

**Reconnecting after a network change:**

```bash
# Just reconnect with Mosh — it picks up automatically
mosh user@dev-server.example.com

# Re-attach to the running tmux session
tmux attach -t remote-claude

# Claude Code is exactly where you left it
```

**Performance tips for remote Claude Code:**

```bash
# In ~/.tmux.conf (on the remote server)
# Reduce status bar update frequency — saves bandwidth
set -g status-interval 30

# Disable mouse on slow connections — mouse events are chatty
# set -g mouse off   # uncomment if connection is very slow

# Use Mosh's built-in compression for high-latency links:
mosh --ssh="ssh -C" user@dev-server.example.com
```

Reference [[mosh-deep-dive]] for advanced Mosh configuration including port ranges, server-side setup, and SSH key management.

---

### Step 7: tmux Scripting Patterns for Claude Code

These patterns let you drive Claude Code from shell scripts — useful for automation, CI/CD, and repeatable workflows.

**Targeting specific panes:**

```bash
# Format: session:window.pane (pane index is 0-based)
tmux send-keys -t myapp:agent.0   "claude 'Run the tests'" C-m
tmux send-keys -t myapp:testing.1 "git diff HEAD" C-m

# Named windows work too
tmux send-keys -t myapp:review "claude 'Review my changes for security issues'" C-m

# Use % pane IDs for absolute targeting (survives window reorders)
PANE_ID=$(tmux display-message -t myapp:agent -p '#{pane_id}')
tmux send-keys -t "$PANE_ID" "some command" C-m
```

**Capturing pane output:**

```bash
# Capture visible content
tmux capture-pane -t myapp:agent -p

# Capture with scrollback (last 500 lines)
tmux capture-pane -t myapp:agent -p -S -500

# Save to file
tmux capture-pane -t myapp:agent -p -S -1000 > /tmp/agent-output.txt

# Stream to grep — find Claude Code's last action
tmux capture-pane -t myapp:agent -p -S -100 | grep "✓\|✗\|Error\|Done"
```

**Waiting for Claude Code to finish (polling pattern):**

```bash
#!/usr/bin/env bash
# Wait for Claude Code's interactive prompt to return, indicating it's idle
wait_for_claude_idle() {
    local target="$1"
    local timeout="${2:-300}"   # default 5 minutes
    local elapsed=0
    local check_interval=3

    while [ $elapsed -lt $timeout ]; do
        # Claude Code's prompt looks like "> " at the start of a line
        local last_line
        last_line=$(tmux capture-pane -t "$target" -p | grep -E '^\s*>\s*$' | tail -1)

        if [ -n "$last_line" ]; then
            echo "Claude Code is idle (after ${elapsed}s)"
            return 0
        fi

        sleep $check_interval
        elapsed=$((elapsed + check_interval))
    done

    echo "Timeout waiting for Claude Code after ${timeout}s"
    return 1
}

# Usage
tmux send-keys -t myapp:agent "claude -p 'Add input validation to all API endpoints'" C-m
wait_for_claude_idle myapp:agent 600
echo "Agent finished. Running tests..."
tmux send-keys -t myapp:testing "npm test" C-m
```

**Piping between panes:**

```bash
# Capture error output from a test pane and feed it to Claude Code
ERROR_OUTPUT=$(tmux capture-pane -t myapp:testing -p -S -50 | grep -A 5 "FAIL\|Error:")

if [ -n "$ERROR_OUTPUT" ]; then
    # Escape the output for safe shell injection
    ESCAPED=$(printf '%q' "$ERROR_OUTPUT")
    tmux send-keys -t myapp:agent "claude 'Fix these failing tests: $ESCAPED'" C-m
fi
```

**Command sequences with `;`:**

```bash
# Multiple tmux commands in sequence (tmux's own command separator)
tmux new-session -d -s work \; \
     new-window -n agent \; \
     send-keys "claude" C-m \; \
     new-window -n shell \; \
     select-window -t work:agent
```

---

### Step 8: Performance Tuning

Claude Code produces more terminal output than most programs — code diffs, tool call logs, long file reads, streaming completions. Without tuning, you can hit memory limits, rendering slowdowns, and lost history.

**Scrollback buffer:**

```bash
# ~/.tmux.conf
set -g history-limit 100000    # 100k lines — use this for Claude Code

# For extreme cases (long-running agents, very verbose output):
# set -g history-limit 500000  # ~500MB RAM per session — measure first
```

```bash
# Clear history for a pane (frees RAM without killing the process)
tmux clear-history -t myapp:agent

# Script: clear history for all panes in a session older than threshold
clear_all_history() {
    local session="$1"
    tmux list-panes -t "$session" -F '#{pane_id}' | while read -r pane; do
        tmux clear-history -t "$pane"
    done
    echo "Cleared scrollback for all panes in $session"
}
```

**Disable visual bell (can trigger on every Claude Code line):**

```bash
# ~/.tmux.conf
set -g visual-bell off
set -g bell-action none
```

**Monitor tmux server memory usage:**

```bash
# Find the tmux server process
pgrep -l tmux

# Check its memory
ps -o pid,rss,vsz,comm -p $(pgrep tmux | head -1)
# PID    RSS    VSZ COMM
# 1234  45320  4194304 tmux

# RSS in KB — 45MB for a session with heavy scrollback is normal
# If you see 500MB+, run clear_all_history on your sessions
```

**tmux-logging plugin** — persist all output to disk so you can clear in-memory scrollback aggressively:

```bash
# Add to ~/.tmux.conf (requires TPM)
set -g @plugin 'tmux-plugins/tmux-logging'

# Default log path: ~/tmux-logs/
# Press Prefix+Alt+p to toggle logging for current pane
# Press Prefix+Alt+P to log ALL panes simultaneously
```

**Rendering performance** — if Claude Code output causes visual glitches:

```bash
# Reset the current client's rendering
tmux refresh-client

# Force a full redraw
tmux refresh-client -S

# Check TERM is set correctly inside tmux
echo $TERM   # should be: tmux-256color or screen-256color
# If it shows xterm-256color you have a config issue
```

---

### Step 9: Session Templates with tmuxp or tmuxinator

Rather than maintaining shell scripts, YAML-based session templates are more readable and declarative.

**tmuxp** (Python, simpler):

```yaml
# ~/.tmuxp/claude-dev.yaml
session_name: claude-dev
start_directory: ~/projects/myapp

windows:
  - window_name: agent
    panes:
      - shell_command:
          - cd ~/projects/myapp
          - claude --permission-mode acceptEdits

  - window_name: tests
    layout: even-horizontal
    panes:
      - shell_command:
          - npm test -- --watch
      - shell_command:
          - watch -n 5 'git log --oneline -10 && echo && git diff --stat'

  - window_name: logs
    layout: even-vertical
    panes:
      - shell_command:
          - tail -f logs/app.log 2>/dev/null || echo waiting...
      - shell_command:
          - tail -f logs/error.log 2>/dev/null || echo waiting...

  - window_name: shell
    panes:
      - shell_command:
          - cd ~/projects/myapp
```

```bash
# Launch from template
tmuxp load ~/.tmuxp/claude-dev.yaml

# Or attach if already running
tmuxp load -d ~/.tmuxp/claude-dev.yaml   # detached
```

**tmuxinator** (Ruby, more features):

```yaml
# ~/.config/tmuxinator/claude-fullstack.yml
name: claude-fullstack
root: ~/projects/myapp

windows:
  - agent:
      layout: main-vertical
      panes:
        - claude --permission-mode acceptEdits
        - git log --oneline -10

  - testing:
      layout: even-horizontal
      panes:
        - npm run test:watch
        - npm run lint:watch

  - review:
      panes:
        - claude --permission-mode plan

  - monitoring:
      layout: tiled
      panes:
        - tail -f logs/app.log
        - htop
        - watch -n 2 'docker ps --format "table {{.Names}}\t{{.Status}}"'
```

```bash
# Install tmuxinator
gem install tmuxinator

# Launch
tmuxinator start claude-fullstack

# Stop everything
tmuxinator stop claude-fullstack
```

---

### Step 10: CI/CD and Headless Claude Code with tmux

Running Claude Code in automated pipelines requires headless operation. tmux provides the process isolation; Claude Code's print mode provides the output.

**Basic CI pattern:**

```bash
#!/usr/bin/env bash
# scripts/claude-ci-review.sh
# Run Claude Code to review a PR and write findings to a file.

set -euo pipefail

OUTPUT_FILE="${1:-/tmp/claude-review.md}"
PR_DIFF=$(git diff origin/main...HEAD)

# Create a detached tmux session
tmux new-session -d -s ci-claude-$$ -x 220 -y 50

# Run Claude Code in print mode (non-interactive, outputs to stdout)
tmux send-keys -t ci-claude-$$ \
    "claude -p 'Review this diff for bugs and security issues. Be concise.' <<'EOF'
${PR_DIFF}
EOF
" C-m

# Poll for completion (crude but reliable)
TIMEOUT=300
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
    if tmux capture-pane -t ci-claude-$$ -p | grep -q "^>"; then
        break
    fi
    sleep 5
    ELAPSED=$((ELAPSED + 5))
done

# Capture the output
tmux capture-pane -t ci-claude-$$ -p -S -500 > "$OUTPUT_FILE"

# Clean up
tmux kill-session -t ci-claude-$$ 2>/dev/null

echo "Review saved to: $OUTPUT_FILE"
```

**Better approach: use Claude Code's print mode directly:**

```bash
# -p flag = print mode: runs non-interactively, outputs result to stdout
claude -p "Summarize the changes in this diff and flag any issues" < <(git diff HEAD~1)

# Pipe to a file
claude -p "Review for security vulnerabilities" < modified_auth.py > security-review.txt

# Use in a CI step
- name: Claude Code security review
  run: |
    claude -p "Review these changes for security issues. Exit code 0 if safe, 1 if issues found." \
      < <(git diff origin/main) > review.md
    cat review.md
```

**Scheduled Claude Code tasks with cron:**

```bash
# Run a nightly code health check via tmux
# Add to crontab: crontab -e
0 2 * * * /usr/local/bin/tmux new-session -d -s nightly-review && \
           /usr/local/bin/tmux send-keys -t nightly-review \
           "claude -p 'Review the codebase for code smells and generate a health report' > ~/reports/nightly-$(date +%Y%m%d).md" C-m
```

---

## Practical Examples

### Example 1: Full-Stack Development with 3 Claude Code Agents

Three agents work in parallel on frontend, backend, and infrastructure — each in an isolated worktree, each with its own tmux session.

```bash
#!/usr/bin/env bash
# ~/scripts/fullstack-agents.sh

BASE="$HOME/projects/myapp"

# Set up worktrees
git -C "$BASE" worktree add "$BASE-frontend" feature/new-ui      2>/dev/null || true
git -C "$BASE" worktree add "$BASE-backend"  feature/api-v2      2>/dev/null || true
git -C "$BASE" worktree add "$BASE-infra"    chore/k8s-migration  2>/dev/null || true

# Launch agents
for spec in "frontend:$BASE-frontend:acceptEdits" "backend:$BASE-backend:acceptEdits" "infra:$BASE-infra:plan"; do
    name="${spec%%:*}"
    rest="${spec#*:}"
    path="${rest%%:*}"
    mode="${rest##*:}"

    tmux has-session -t "$name" 2>/dev/null && tmux kill-session -t "$name"
    tmux new-session -d -s "$name" -c "$path"
    tmux send-keys -t "$name" "claude --permission-mode $mode" C-m
    echo "Started agent: $name ($path)"
done

# Dashboard: 3-pane view of all agents
tmux has-session -t dashboard 2>/dev/null && tmux kill-session -t dashboard
tmux new-session -d -s dashboard
tmux split-window -t dashboard -h
tmux split-window -t dashboard:0.0 -v

# Each dashboard pane watches one agent
tmux send-keys -t dashboard:0.0 "tmux attach-session -t frontend -r" C-m   # -r = read-only
tmux send-keys -t dashboard:0.1 "tmux attach-session -t backend  -r" C-m
tmux send-keys -t dashboard:0.2 "tmux attach-session -t infra    -r" C-m

echo "All agents running. Attach to dashboard: tmux attach -t dashboard"
```

### Example 2: Code Review Pipeline

Review a pull request with Claude Code in plan mode, watching the diff in an adjacent pane.

```bash
# Terminal layout:
# ┌─────────────────────┬──────────────────┐
# │  Claude Code        │  git diff output │
# │  (plan mode)        │  (live)          │
# └─────────────────────┴──────────────────┘

PR_BRANCH="feature/auth"

# Create a new window for the review
tmux new-window -n "review-$PR_BRANCH" -c ~/projects/myapp

# Split: Claude Code left, diff right
tmux split-window -t "review-$PR_BRANCH" -h -p 45 -c ~/projects/myapp

# Left: Claude Code in plan mode with the PR context
tmux send-keys -t "review-$PR_BRANCH".0 \
    "claude --permission-mode plan 'Review the changes on branch $PR_BRANCH vs main. Check for: security issues, missing error handling, test coverage gaps, and API design problems.'" C-m

# Right: live diff of the branch
tmux send-keys -t "review-$PR_BRANCH".1 \
    "git diff main...$PR_BRANCH" C-m

# Focus on Claude Code pane
tmux select-pane -t "review-$PR_BRANCH".0
```

### Example 3: Pair Programming with Claude Code

Claude Code makes changes automatically while you watch in real time. Three panes: agent, diff, tests.

```bash
# Layout:
# ┌──────────────────────────────┐
# │     Claude Code (auto)       │  ← tall, main pane
# ├───────────────┬──────────────┤
# │   git diff    │  npm test    │  ← bottom strip
# └───────────────┴──────────────┘

SESSION="pair-programming"
PROJECT="$HOME/projects/myapp"

tmux new-session -d -s "$SESSION" -n pair -c "$PROJECT"

# Split bottom strip
tmux split-window -t "$SESSION:pair" -v -p 25 -c "$PROJECT"
tmux split-window -t "$SESSION:pair.1" -h -p 50 -c "$PROJECT"

# Main pane (top): Claude Code in auto mode
tmux send-keys -t "$SESSION:pair.0" \
    "claude --permission-mode auto 'You are my pair programmer. Help me add comprehensive error handling to the payment module. Implement incrementally and run tests after each change.'" C-m

# Bottom left: live diff
tmux send-keys -t "$SESSION:pair.1" \
    "watch -n 2 'git diff --stat && echo && git diff --no-color | head -60'" C-m

# Bottom right: continuous test runner
tmux send-keys -t "$SESSION:pair.2" \
    "npm test -- --watch --testPathPattern=payment 2>&1" C-m

# Focus Claude Code
tmux select-pane -t "$SESSION:pair.0"
tmux attach -t "$SESSION"
```

### Example 4: Remote HPC Workflow

Use tmux to persist Claude Code sessions on an HPC cluster for writing and debugging batch scripts.

```bash
# ── Local machine ────────────────────────────────────────────────────────
# Connect via Mosh (survives VPN drops, WiFi changes)
mosh netid@hpc.university.edu

# ── Remote HPC node ──────────────────────────────────────────────────────
# Start or re-attach to persistent session
tmux new-session -s hpc-work -c ~/scratch 2>/dev/null || tmux attach -t hpc-work

# Window 1: Claude Code for writing SLURM scripts
tmux new-window -n scripts -c ~/scratch
claude 'Help me write a SLURM batch script to run my Python ML training job across 4 GPUs'

# Window 2: Job queue monitor
tmux new-window -n queue -c ~/scratch
watch -n 30 'squeue -u $USER --format="%.10i %.9P %.30j %.8T %.10M %.6D %R"'

# Window 3: Log tailing
tmux new-window -n logs -c ~/scratch
tail -f ~/scratch/jobs/latest/*.out
```

Reference [[mosh-deep-dive]] and [[ssh-tutorial]] for connection setup and key management.

### Example 5: Debugging with Claude Code + tmux

Two panes: Claude Code analyzes errors, you reproduce them in the other pane.

```bash
DEBUG_SESSION="debug-$(date +%s)"
PROJECT="$HOME/projects/myapp"

tmux new-session -d -s "$DEBUG_SESSION" -n debug -c "$PROJECT"
tmux split-window -t "$DEBUG_SESSION:debug" -h -p 50 -c "$PROJECT"

# Left: Claude Code ready to analyze
tmux send-keys -t "$DEBUG_SESSION:debug.0" \
    "claude --permission-mode plan 'I am debugging a crash. I will paste error output. Help me identify root cause and fix.'" C-m

# Right: reproduce the bug, capture stderr
tmux send-keys -t "$DEBUG_SESSION:debug.1" \
    "node server.js 2>&1 | tee /tmp/debug-output.txt" C-m

# After getting the error, pipe it to Claude Code:
# tmux send-keys -t "$DEBUG_SESSION:debug.0" "$(cat /tmp/debug-output.txt)" C-m
```

---

## Hands-On Exercises

### Exercise 1: Build a Multi-Agent Workspace Script

Build a script that:
1. Creates three git worktrees from the current repo
2. Launches one tmux session per worktree
3. Starts Claude Code in `acceptEdits` mode in each session
4. Creates a dashboard session with three read-only panes watching the agents
5. Is fully idempotent (safe to re-run)

**Success criteria:** All three Claude Code instances are running independently, visible from the dashboard, and working on separate branches.

### Exercise 2: tmux Hook Notifications

1. Configure `monitor-activity` in your `tmux.conf`
2. Write a `post-tool.sh` Claude Code hook that calls `tmux display-message` with the tool name
3. Verify notifications appear in the tmux status bar
4. Add a log entry to `~/.claude/activity.log` with each notification

**Success criteria:** You can see what Claude Code did last without switching panes.

### Exercise 3: Remote Persistent Session

1. SSH into a remote server (or use a local VM)
2. Install Mosh and tmux on the remote
3. Connect with Mosh and start a `claude` session in tmux
4. Detach from tmux (`Ctrl+A d`)
5. Close your terminal (not just detach — actually close it)
6. Reconnect with Mosh and re-attach to the tmux session
7. Confirm Claude Code is still running

**Success criteria:** Claude Code survived full terminal closure.

### Exercise 4: Session Template

1. Design your most common Claude Code workflow (what windows/panes do you need?)
2. Create either a `tmuxp` YAML or `tmuxinator` YAML for it
3. Launch it from the template
4. Kill the session and re-launch from the template — verify it's identical
5. Commit the template to your dotfiles repo

**Success criteria:** One command launches your full Claude Code environment.

### Exercise 5: Output Capture Pipeline

1. Start Claude Code in a tmux session with `tmux send-keys`
2. Give it a task via `send-keys`
3. Poll with `capture-pane` until you detect it's finished
4. Extract just Claude Code's final response (not the whole scrollback)
5. Save it to `~/claude-outputs/$(date +%Y%m%d-%H%M%S).md`

**Success criteria:** A clean output file exists with only Claude Code's response.

---

## Troubleshooting

### tmux server memory growth

**Symptom:** `ps` shows tmux using 500MB+ RAM.

**Cause:** Large scrollback buffers from verbose Claude Code output.

```bash
# Check per-session scrollback
tmux list-sessions -F '#{session_name}' | while read s; do
    count=$(tmux capture-pane -t "$s" -p -S - 2>/dev/null | wc -l)
    echo "$s: $count lines in scrollback"
done

# Clear all history (non-destructive to running processes)
tmux list-sessions -F '#{session_name}' | while read s; do
    tmux list-panes -t "$s" -F '#{pane_id}' | while read p; do
        tmux clear-history -t "$p"
    done
done
```

---

### Multiple Claude Code instances competing for API rate limits

**Symptom:** Agents get `429 Too Many Requests` errors.

**Solutions:**

```bash
# 1. Stagger launches (20-30 second gaps)
tmux send-keys -t auth "claude 'Implement auth'" C-m
sleep 25
tmux send-keys -t perf "claude 'Fix performance'" C-m
sleep 25
tmux send-keys -t refactor "claude 'Refactor module'" C-m

# 2. Use different API keys per agent (if you have team keys)
tmux send-keys -t auth "ANTHROPIC_API_KEY=$KEY1 claude ..." C-m

# 3. Use Claude Code's built-in retry — it handles 429s automatically
# Just ensure your tmux session stays alive while it retries
```

---

### Claude Code context window filling up

**Symptom:** Claude Code says context is full, responses degrade.

```bash
# Inside the Claude Code session, compress context:
/compact

# Start a fresh continuation session (keeps memory of prior work):
# Ctrl+C to exit, then:
claude -c   # or --continue

# Check context usage:
/status
```

---

### tmux socket permission issues

**Symptom:** `error connecting to /tmp/tmux-*/default: Permission denied`

**Causes and fixes:**

```bash
# Different UID (e.g., sudo changed your effective user)
# Fix: use -L to specify an explicit socket path
tmux -L $USER-main new-session -s work

# In containers: /tmp may not exist or have wrong perms
mkdir -p /tmp/tmux-$(id -u)
chmod 700 /tmp/tmux-$(id -u)

# List sockets for current user
ls -la /tmp/tmux-$(id -u)/
```

---

### Terminal rendering glitches

**Symptom:** Claude Code output appears garbled, colors wrong, artifacts visible.

```bash
# Inside tmux: reset rendering
tmux refresh-client
# or: Prefix + r (if you added the binding above)

# Check TERM variable — must be set correctly
echo $TERM           # should be tmux-256color
echo $COLORTERM      # should be truecolor or 24bit

# Outside tmux: check what your terminal reports
echo $TERM           # e.g., xterm-256color (correct for outside)

# If TERM is wrong inside tmux, add to tmux.conf:
# set -g default-terminal "tmux-256color"
```

---

### Claude Code losing PATH in tmux

**Symptom:** Claude Code can't find `node`, `python`, `go`, etc.

**Cause:** tmux starts a login shell, which may not source your shell config.

```bash
# Check what PATH tmux sees
tmux new-window "echo $PATH; sleep 5"

# Fix option 1: source your profile explicitly in tmux.conf
set-option -g default-command "/bin/zsh -l"   # -l = login shell

# Fix option 2: set PATH in tmux.conf directly
set-environment -g PATH "/usr/local/bin:/opt/homebrew/bin:$PATH"

# Fix option 3: add PATH to your shell's .profile (not just .bashrc/.zshrc)
# .profile is sourced by login shells; .bashrc/.zshrc is sourced by interactive shells
```

---

### Nested tmux sessions

**Symptom:** You SSHed into a server and ran tmux inside your local tmux. Prefix key is ambiguous.

```bash
# Option 1: Use a different prefix for the inner tmux
# On the remote machine's ~/.tmux.conf:
set -g prefix C-b   # leave inner tmux with default prefix

# Option 2: Send prefix to inner tmux by pressing it twice
# C-a C-a sends one C-a to the inner session

# Option 3: Detect nested sessions and disable outer bindings
# Add to ~/.tmux.conf:
if-shell 'test -n "$TMUX"' \
    'set -g prefix C-b; bind C-b send-prefix' \
    'set -g prefix C-a; bind C-a send-prefix'

# Option 4: Avoid nesting — use the outer tmux's switch-client instead
# Never run tmux inside tmux; use tmux ls and switch-client
```

---

### tmux + SSH + Claude Code latency

**Symptom:** Claude Code feels laggy over SSH.

```bash
# In ~/.tmux.conf (on remote server)
set -sg escape-time 0    # eliminate ESC delay
set -g repeat-time 0     # eliminate repeat key delay

# SSH connection optimizations (~/.ssh/config):
Host dev-server
    HostName dev-server.example.com
    Compression yes
    ServerAliveInterval 30
    ServerAliveCountMax 3
    ControlMaster auto
    ControlPath ~/.ssh/cm-%r@%h:%p
    ControlPersist 10m

# Best solution: replace SSH with Mosh
# Mosh uses UDP, handles latency and packet loss far better
# See [[mosh-deep-dive]] for full setup
```

---

## References

- tmux manual: https://man.openbsd.org/tmux
- tmux wiki: https://github.com/tmux/tmux/wiki
- Claude Code docs: https://docs.anthropic.com/en/docs/claude-code
- tmuxp docs: https://tmuxp.git-pull.com/
- tmux plugins (TPM): https://github.com/tmux-plugins/tpm
- tmux-resurrect (save/restore sessions): https://github.com/tmux-plugins/tmux-resurrect
- tmux-continuum (automatic saves): https://github.com/tmux-plugins/tmux-continuum
- tmux-logging (persistent output capture): https://github.com/tmux-plugins/tmux-logging
- sesh (smart session manager): https://github.com/joshmedeski/sesh

---

## Related Tutorials

- [[tmux-claude-code-beginner-guide|Tmux + Claude Code Beginner Guide]] — Fundamentals of tmux + Claude Code
- [[sesh-beginner-guide|Sesh Beginner Guide]] — Smart tmux session manager
- [[sesh-deep-dive|Sesh Deep Dive]] — Advanced sesh configuration and scripting
- [[honeymux-beginner-guide|Honeymux Beginner Guide]] — TUI wrapper for tmux
- [[honeymux-deep-dive|Honeymux Deep Dive]] — Advanced Honeymux features
- [[openmux-beginner-guide|OpenMux Beginner Guide]] — Modern terminal multiplexer
- [[openmux-deep-dive|OpenMux Deep Dive]] — Advanced OpenMux patterns
- [[dtach-beginner-guide|Dtach Beginner Guide]] — Minimal detach/reattach
- [[dtach-deep-dive|Dtach Deep Dive]] — Advanced dtach usage
- [[mosh-beginner-guide|Mosh Beginner Guide]] — Persistent SSH alternative
- [[mosh-deep-dive|Mosh Deep Dive]] — Advanced Mosh configuration
- [[ssh-tutorial|SSH Tutorial]] — SSH fundamentals
- [[claude-cheatsheet|Claude Code Cheatsheet]] — Claude Code command reference
- [[claude-hotkeys|Claude Code Hotkeys]] — Keyboard shortcuts
- [[claude-code-vscode-go-beginner-guide|Claude Code + VSCode + Go Beginner Guide]] — IDE integration
- [[dotfiles-beginner-guide|Dotfiles Beginner Guide]] — Managing tmux.conf
- [[dotfiles-deep-dive|Dotfiles Deep Dive]] — Advanced dotfile management
- [[chezmoi-beginner-guide|Chezmoi Beginner Guide]] — Cross-machine config management
- [[chezmoi-deep-dive|Chezmoi Deep Dive]] — Advanced Chezmoi templates
- [[git-worktrees-worktrunk-beginner-guide|Git Worktrees Beginner Guide]] — Worktree fundamentals
- [[git-worktrees-worktrunk-deep-dive|Git Worktrees Deep Dive]] — Advanced worktree patterns
- [[worktrunk-beginner-guide|Worktrunk Beginner Guide]] — Worktrunk tool for worktrees
- [[worktrunk-deep-dive|Worktrunk Deep Dive]] — Advanced worktrunk usage
- [[gh-cli-beginner-guide|GitHub CLI Beginner Guide]] — GitHub from terminal
- [[gh-cli-deep-dive|GitHub CLI Deep Dive]] — Advanced GitHub CLI
- [[television-beginner-guide|Television Beginner Guide]] — Fuzzy finder for workflows
- [[television-deep-dive|Television Deep Dive]] — Advanced television usage

---

## Summary

Key takeaways from this deep dive:

1. **tmux's client-server architecture** makes it the ideal companion for long-running Claude Code agents — the server keeps agents alive regardless of network or terminal state
2. **Git worktrees + tmux sessions** provide safe parallel Claude Code agents on the same repo — one worktree per session, no shared state conflicts
3. **Automation scripts** (idempotent workspace builders) make complex multi-agent setups reproducible and shareable across machines
4. **Sesh integration** provides intelligent session management tied to project directories — one keystroke to resume any Claude Code context
5. **tmux hooks + Claude Code hooks** can be combined for real-time notifications and inter-pane synchronization without polling
6. **Performance tuning** — scrollback limits, periodic history clears, tmux-logging for persistence — is essential for heavy, long-running Claude Code sessions
7. **Mosh + tmux + Claude Code** is the optimal remote development stack: UDP resilience from Mosh, session persistence from tmux, AI capability from Claude Code

**Suggested next steps:**
- Master [[sesh-deep-dive|sesh]] for one-keystroke session management
- Explore [[git-worktrees-worktrunk-deep-dive|git worktrees deep dive]] for safe parallel agent work
- Set up [[mosh-deep-dive|Mosh]] for unbreakable remote Claude Code sessions
- Store your `~/.tmux.conf` and workspace scripts in a [[dotfiles-deep-dive|dotfiles repo]] managed by [[chezmoi-deep-dive|chezmoi]]
