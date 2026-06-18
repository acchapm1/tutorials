---
title: "Herdr — Deep Dive"
date: 2026-05-30
difficulty: advanced
tags: [herdr, terminal, multiplexer, agent-runtime, socket-api, configuration, integrations, keybindings, rust, coding-agents]
---

# Herdr — Deep Dive

## 1. Overview

This deep-dive reference expands on the [[herdr-beginner-guide|Herdr Beginner Guide]] with comprehensive coverage of Herdr's internals, configuration system, socket API, agent integration hooks, advanced keybinding customization, worktree management, and multi-agent orchestration patterns.

Herdr is a terminal-native agent runtime and multiplexer written in Rust. While the beginner guide covers getting started and daily usage, this document is built to be revisited as an ongoing reference when you need to understand the architecture behind Herdr's design decisions, write custom integrations, automate pane management through the API, or troubleshoot advanced scenarios.

**What you will learn:**

- Architecture: how the server, client, and socket API interact
- Full configuration reference (`config.toml`)
- Custom keybindings and command bindings
- The socket API: raw JSON protocol for automation
- Agent detection pipeline: process detection, heuristics, and integration hooks
- Writing custom integrations and agent skill files
- Worktree management for git-based workflows
- Session restoration and persistence internals
- Performance tuning and advanced troubleshooting

## 2. Prerequisites

- Completion of the [[herdr-beginner-guide|Herdr Beginner Guide]] — you should be comfortable starting sessions, splitting panes, and detaching
- Familiarity with [[tmux-claude-code-deep-dive|tmux concepts]] — Herdr shares the prefix-key model and client-server architecture
- Basic understanding of Unix sockets and JSON — the socket API uses newline-delimited JSON (NDJSON)
- Git — Herdr's worktree features integrate directly with `git worktree`
- At least one coding agent installed (Claude Code, Codex, Pi, OpenCode, or Hermes Agent)

## 3. Key Concepts

### 3.1 Client-Server Architecture

Herdr runs as a background server process. When you type `herdr`, the CLI either starts a new server or connects to an existing one. The server owns all state: workspaces, tabs, panes, processes, and agent metadata. Clients (your terminal) render the UI and send input.

This is architecturally similar to [[openmux-deep-dive|OpenMux]] and tmux, but with a critical addition: the server also maintains an **agent state machine** for each detected agent, and exposes that state through the sidebar and the API.

Key implications:

- Multiple clients can attach to the same server simultaneously
- The server survives client disconnection — agents keep running
- All CLI commands talk to the server over the local Unix socket
- The socket API is the same interface used by both the CLI and agent integrations

### 3.2 Agent Detection Pipeline

Herdr uses a three-tier detection system, from least to most precise:

**Tier 1 — Process detection:** Herdr watches the foreground process in each pane. When it recognizes a known agent binary (e.g., `claude`, `codex`, `pi`), it marks the pane as containing an agent.

**Tier 2 — Screen heuristics:** When no integration is installed, Herdr infers state from terminal output patterns. This is approximate — it may not catch every state transition.

**Tier 3 — Integrations:** The most precise tier. Integrations are hooks or plugins installed into the agent itself. They report semantic state (idle, working, blocked, done) directly to the Herdr server via the socket API. The state reported by an integration takes authority over heuristic guesses.

### 3.3 State Rollup

Agent state rolls upward through the hierarchy:

```
agent state → pane state → tab state → workspace state
```

The sidebar shows the **most urgent** state at each level. A single blocked agent in a workspace of ten working agents makes the workspace appear "blocked" — ensuring you never miss an agent waiting for input.

State priority (highest to lowest): blocked > working > idle > done.

### 3.4 Worktree Integration

Herdr's worktree commands wrap `git worktree` and create a corresponding Herdr workspace for each checkout. This means each feature branch or review gets its own isolated workspace with separate tabs, panes, and agents — while sharing the same git repository.

This pairs well with [[git-worktrees-worktrunk-deep-dive|Git Worktrees]] workflows where you maintain multiple checkouts simultaneously.

## 4. Step-by-Step Instructions

### 4.1 Configuration File

Herdr reads its config from `~/.config/herdr/config.toml`. View the full default configuration:

```bash
herdr --default-config
```

Key configuration sections:

```toml
# ~/.config/herdr/config.toml

# Mouse behavior
mouse_capture = true          # Set false to let terminal handle clicks
mouse_scroll_lines = 3        # Scrollback lines per wheel notch

# Session persistence
[session]
resume_agents_on_restore = true   # Restore agent sessions after server restart

# Prefix key (default: ctrl+b)
[keys]
prefix = "ctrl+b"
```

After modifying the config, reload without restarting:

```bash
herdr server reload-config
```

### 4.2 Custom Keybindings

Herdr supports two categories of keybindings:

**Prefix-mode keybindings** — activated after pressing the prefix key:

```toml
[keys]
prefix = "ctrl+b"

# Remap split keys
split_right = "v"        # prefix + v to split right (vim-style)
split_down = "s"         # prefix + s to split down
```

Key strings accept plain keys, modifier combinations (`ctrl+a`, `shift+n`, `alt+1`, `cmd+k`), and special keys (`enter`, `tab`, `esc`, `left`, `right`, `up`, `down`).

**Command keybindings** — launch shell commands or temporary panes from prefix mode:

```toml
[[keys.command]]
key = "g"
type = "pane"
command = "lazygit"

[[keys.command]]
key = "t"
type = "shell"
command = "herdr pane run 'npm test'"

[[keys.command]]
key = "l"
type = "pane"
command = "herdr pane run 'tail -f /var/log/app.log'"
```

The `type` field determines behavior: `"pane"` opens a new pane with the command; `"shell"` runs the command as a detached shell helper.

**Resetting to defaults:**

If you have old custom keybindings and want the new defaults:

```bash
herdr config reset-keys
```

This backs up `config.toml`, removes the `[keys]` and `[[keys.command]]` sections, and uses built-in v2 defaults after restart or `herdr server reload-config`.

### 4.3 The Socket API

Herdr exposes its full functionality through a newline-delimited JSON (NDJSON) socket API. Most automation should start with the CLI wrappers, but the raw socket API gives you direct request/response control and long-lived event subscriptions.

**CLI vs. Socket API:**

The CLI commands are thin wrappers around the socket API. For example:

```bash
# CLI wrapper
herdr pane send-text --pane abc123 "ls -la"

# Equivalent raw socket API call (via socat or similar)
echo '{"method":"pane.send_text","params":{"pane_id":"abc123","text":"ls -la"}}' | socat - UNIX-CONNECT:/tmp/herdr.sock
```

**Key API method categories:**

| Category | Methods | Purpose |
|----------|---------|---------|
| Workspace | `workspace.create`, `workspace.list`, `workspace.remove` | Manage project containers |
| Tab | `tab.create`, `tab.list`, `tab.focus` | Layout management within workspaces |
| Pane | `pane.create`, `pane.send_text`, `pane.send_keys`, `pane.read`, `pane.close` | Terminal operations |
| Output | `output.read`, `output.subscribe` | Read or stream pane output |
| Wait | `wait.output`, `wait.state` | Block until output matches or state changes |
| Worktree | `worktree.create`, `worktree.open`, `worktree.remove` | Git worktree workspace management |
| Agent | `agent.report_state`, `agent.set_metadata` | Integration state reporting |

**Reading pane output:**

```bash
herdr pane read --pane <pane-id> --lines 50
```

**Waiting for output (useful in scripts):**

```bash
# Wait until the pane output contains "Build succeeded"
herdr wait output --pane <pane-id> --match "Build succeeded" --timeout 300
```

**Subscribing to events (long-lived):**

For long-lived event subscriptions, use the raw socket API. This is how integrations and custom tools can react to state changes in real time.

### 4.4 Agent Integrations in Detail

#### How Integrations Work

An integration installs a hook script into the agent's configuration directory. The hook is called by the agent at lifecycle events (start, working, blocked, done) and reports state to the Herdr server via the socket API.

#### Claude Code Integration

```bash
herdr integration install claude
```

What it does:

- Writes `~/.claude/hooks/herdr-agent-state.sh`
- Updates `~/.claude/settings.json` with hook entries
- Uses `~/.claude` by default, or `CLAUDE_CONFIG_DIR` if set
- The config directory must already exist (run `claude` once first)

#### Codex Integration

```bash
herdr integration install codex
```

What it does:

- Writes `~/.codex/herdr-agent-state.sh`
- Updates `~/.codex/hooks.json`
- Ensures `[features] hooks = true` in `~/.codex/config.toml`
- Uses `~/.codex` by default, or `CODEX_HOME` if set

#### Version Requirements for Session Restore

Native session restoration (resuming agent sessions after a server restart) requires specific integration versions:

| Agent | Minimum Integration Version |
|-------|----------------------------|
| Pi | v2 |
| Claude Code | v4 |
| Codex | v4 |
| OpenCode | v2 |
| Hermes Agent | v2 |

Enable with:

```toml
[session]
resume_agents_on_restore = true
```

#### User Hooks Alongside Integrations

If you want custom hooks that run alongside an integration, use **metadata** rather than `report-agent`. Metadata changes presentation (labels, icons) without overriding the integration's authority over idle/working/blocked/done state:

```bash
# Set custom metadata on an agent pane
herdr agent set-metadata --pane <pane-id> --key "task" --value "refactoring auth module"
```

### 4.5 The Agent Skill File

Herdr ships a reusable agent skill file (`SKILL.md`) that can be installed into any coding agent supporting custom instructions or reusable skills. The skill is a markdown instruction file — not a separate app.

The skill tells an agent to use the `herdr` CLI when `HERDR_ENV=1` is set, which indicates the agent is running inside a Herdr-managed pane and can talk to the local socket.

This enables agents to self-manage panes: an agent can create a new pane, run a command in it, read the output, and close it — all programmatically. This is the foundation for [[maestri-deep-dive|Maestri]]-style orchestration patterns where agents coordinate through shared infrastructure.

### 4.6 Worktree Management

Herdr's worktree commands create Git worktrees and corresponding Herdr workspaces in one step:

```bash
# Create a new worktree and workspace for a feature branch
herdr worktree create ~/projects/myapp --branch feature/new-auth

# Open an existing worktree (or return the already-open workspace)
herdr worktree open ~/projects/myapp-feature

# Remove a worktree (runs git worktree remove; never deletes the branch)
herdr worktree remove ~/projects/myapp-feature
```

The `worktree.create` API returns the new workspace, tab, root pane, and worktree records — giving you everything needed to start agents in the new workspace programmatically.

This integrates naturally with [[git-worktrees-worktrunk-beginner-guide|Git Worktrees]] workflows. Each branch gets its own Herdr workspace with isolated panes and agents, while sharing the underlying git object store.

### 4.7 Session Management

**Named sessions:**

```bash
herdr --session work
herdr --session personal
```

Each named session runs its own server with independent workspaces.

**Remote attachment:**

```bash
herdr --remote user@server
```

Attach to a Herdr session on a remote machine over [[ssh-tutorial|SSH]]. Combined with [[mosh-deep-dive|Mosh]] for connection persistence, this enables a robust remote development setup where agents run on powerful servers while you monitor from anywhere.

**Session status:**

```bash
herdr status
```

Returns JSON with the current session's workspaces, tabs, panes, and agent states.

### 4.8 Advanced Pane Operations

**Send keystrokes (not text):**

```bash
# Send ctrl+c to interrupt a process
herdr pane send-keys --pane <pane-id> ctrl+c

# Send enter
herdr pane send-keys --pane <pane-id> enter
```

**Attach to a pane's terminal directly:**

```bash
herdr terminal attach --pane <pane-id>
```

This gives you raw terminal access to the pane — useful for debugging, interacting with prompts, or using tools that need direct terminal I/O.

**Agent targeting:**

Agent commands accept multiple target formats:

- Terminal ID (pane ID)
- Unique agent name
- Detected or reported agent label
- Legacy pane ID

```bash
# Target by agent name
herdr agent status --name "claude-frontend"

# Target by pane ID
herdr agent status --pane abc123
```

## 5. Practical Examples

### Example 1: Automated Multi-Agent Code Review Pipeline

Use the CLI to orchestrate a review pipeline where one agent writes code and another reviews it:

```bash
#!/bin/bash
# multi-agent-review.sh

# Create a workspace for the task
herdr worktree create ~/projects/myapp --branch feature/new-api

# Get the workspace and root pane IDs from the JSON output
WORKSPACE=$(herdr workspace list --json | jq -r '.[-1].id')
ROOT_PANE=$(herdr pane list --workspace "$WORKSPACE" --json | jq -r '.[0].id')

# Start the coding agent in the root pane
herdr pane send-text --pane "$ROOT_PANE" "claude 'Implement the /api/users endpoint'"

# Wait for the coding agent to finish
herdr wait state --pane "$ROOT_PANE" --state done --timeout 600

# Split and start a review agent
herdr pane send-keys --pane "$ROOT_PANE" "prefix+%"
REVIEW_PANE=$(herdr pane list --workspace "$WORKSPACE" --json | jq -r '.[-1].id')
herdr pane send-text --pane "$REVIEW_PANE" "codex 'Review the changes in this branch for security issues'"

echo "Review agent started in pane $REVIEW_PANE"
```

### Example 2: Per-Branch Agent Workspaces

Manage multiple feature branches, each with its own agent workspace:

```bash
#!/bin/bash
# branch-workspaces.sh

branches=("feature/auth" "feature/api" "bugfix/login")

for branch in "${branches[@]}"; do
    echo "Creating workspace for $branch"
    herdr worktree create ~/projects/myapp --branch "$branch"
done

# Check status across all workspaces
herdr status --json | jq '.workspaces[] | {name: .name, state: .state}'
```

Expected output:

```json
{"name": "feature/auth", "state": "idle"}
{"name": "feature/api", "state": "idle"}
{"name": "bugfix/login", "state": "idle"}
```

### Example 3: Custom Keybinding for Quick Agent Launch

Add a keybinding that launches Claude Code with a specific prompt:

```toml
# ~/.config/herdr/config.toml

[[keys.command]]
key = "a"
type = "pane"
command = "claude"

[[keys.command]]
key = "x"
type = "pane"
command = "codex"

[[keys.command]]
key = "g"
type = "pane"
command = "lazygit"
```

Now `prefix + a` opens Claude Code in a new pane, `prefix + x` opens Codex, and `prefix + g` opens lazygit.

### Example 4: Monitoring Agent State from a Script

Poll agent state for a CI/CD integration or monitoring dashboard:

```bash
#!/bin/bash
# monitor-agents.sh

while true; do
    STATUS=$(herdr status --json)
    
    BLOCKED=$(echo "$STATUS" | jq '[.workspaces[].tabs[].panes[] | select(.agent_state == "blocked")] | length')
    WORKING=$(echo "$STATUS" | jq '[.workspaces[].tabs[].panes[] | select(.agent_state == "working")] | length')
    DONE=$(echo "$STATUS" | jq '[.workspaces[].tabs[].panes[] | select(.agent_state == "done")] | length')
    
    echo "$(date): blocked=$BLOCKED working=$WORKING done=$DONE"
    
    if [ "$BLOCKED" -gt 0 ]; then
        echo "WARNING: $BLOCKED agent(s) need attention!"
        # Could send a notification here
    fi
    
    sleep 30
done
```

### Example 5: Using Herdr over SSH with Mosh

Set up a persistent remote agent management connection:

```bash
# Connect with Mosh for connection resilience
mosh user@gpu-server -- herdr

# If Herdr is already running, mosh reconnects to the session
# Your agents keep running even if your local network drops
```

For the SSH config to make this seamless, see [[ssh-config-deep-dive|SSH Config Deep Dive]] and [[mosh-deep-dive|Mosh Deep Dive]].

## 6. Hands-On Exercises

### Exercise 1: Custom Configuration

**Objective:** Customize Herdr keybindings and mouse behavior.

**Task:**

1. View the default config: `herdr --default-config > /tmp/herdr-defaults.toml`
2. Copy it to `~/.config/herdr/config.toml` if one doesn't exist
3. Change the prefix key to `ctrl+a`
4. Add a command keybinding for lazygit on `prefix + g`
5. Set `mouse_scroll_lines = 5`
6. Reload the config: `herdr server reload-config`
7. Verify the new prefix works and the command keybinding launches lazygit

**Success criteria:** New prefix key works; `prefix + g` opens lazygit in a new pane.

### Exercise 2: Socket API Scripting

**Objective:** Automate pane creation and command execution via the CLI.

**Task:**

1. Write a bash script that creates a new workspace
2. In the workspace, create three panes: one for an agent, one for tests, one for logs
3. Run `npm test -- --watch` in the test pane
4. Read the test pane output after 10 seconds to check for pass/fail
5. Clean up by removing the workspace

**Success criteria:** Script runs end to end; test output is captured.

### Exercise 3: Multi-Agent Orchestration

**Objective:** Run two agents in the same workspace and observe state rollup.

**Task:**

1. Create a workspace with two panes
2. Start Claude Code in pane 1 and Codex in pane 2
3. Give both agents tasks simultaneously
4. Observe the sidebar: which states appear at the workspace level?
5. Let one agent finish (done) while the other is still working
6. Verify the workspace shows "working" (higher priority than "done")
7. Let both finish and verify the workspace shows "done"

**Success criteria:** Workspace state correctly reflects the most urgent agent state at all times.

### Exercise 4: Git Worktree Workflow

**Objective:** Use Herdr worktrees to manage feature branches with separate agent contexts.

**Task:**

1. Create a git repository with a `main` branch
2. Use `herdr worktree create` to make workspaces for two feature branches
3. Start an agent in each workspace
4. Make changes in each branch independently
5. Remove one worktree with `herdr worktree remove`
6. Verify the branch still exists in git (only the worktree and workspace are removed)

**Success criteria:** Each branch gets isolated workspaces; removal is clean.

## 7. Troubleshooting

### Server Socket Issues

**Symptom:** CLI commands fail with "connection refused" or "no such file."

**Diagnosis:**

```bash
# Check if the server process is running
ps aux | grep herdr

# Look for the socket file
ls -la /tmp/herdr*.sock
```

**Fix:** If the server died but the socket file remains (stale socket), remove it and restart:

```bash
rm -f /tmp/herdr-*.sock
herdr
```

### Config Syntax Errors

**Symptom:** Herdr starts with default config instead of custom settings, or fails to start.

**Diagnosis:**

```bash
# Validate TOML syntax
cat ~/.config/herdr/config.toml | python3 -c "import sys, tomllib; tomllib.load(sys.stdin.buffer)"
```

**Fix:** Check for common TOML errors: missing quotes around strings, duplicate section headers, or incorrect array-of-tables syntax (`[[keys.command]]` needs double brackets).

### Integration Hooks Not Firing

**Symptom:** Agent state stays "idle" despite the integration being installed.

**Diagnosis:**

```bash
herdr integration status
```

**Common causes:**

1. The agent was started before the integration was installed — restart the agent
2. The integration version is outdated — reinstall with `herdr integration install <agent>`
3. Environment variable `HERDR_ENV` is not set — the hook script checks for this
4. The hook script has wrong permissions — should be executable (`chmod +x`)

### Session Restore Failures

**Symptom:** After server restart, agents don't resume even with `resume_agents_on_restore = true`.

**Causes:**

1. Integration versions too old (see the version requirements table in Section 4.4)
2. The agent binary is not on `$PATH` at server startup time
3. The original working directory no longer exists

**Fix:** Update integrations to the required versions and ensure agent binaries are accessible.

### Performance — High CPU from Herdr Server

**Symptom:** `herdr` server process uses excessive CPU.

**Causes:**

1. Many panes with rapidly scrolling output (build logs, streaming tests)
2. Aggressive heuristic polling on panes without integrations

**Fix:**

- Install integrations to reduce heuristic polling
- Redirect verbose output to files instead of terminal: `npm test > /tmp/test.log 2>&1`
- Reduce the number of simultaneously visible panes

### Keybinding Conflicts

**Symptom:** Prefix key doesn't work, or actions trigger the wrong keybinding.

**Fix:** Herdr's default prefix (`ctrl+b`) conflicts with some shells (bash backward-character). Change it in config:

```toml
[keys]
prefix = "ctrl+a"   # Same as screen/tmux common remap
```

If you have old keybindings and want a clean slate:

```bash
herdr config reset-keys
herdr server reload-config
```

## 8. References

- [Herdr Official Documentation](https://herdr.dev/docs/)
- [Herdr Concepts](https://herdr.dev/docs/concepts/)
- [Herdr CLI Reference](https://herdr.dev/docs/cli-reference/)
- [Herdr Socket API](https://herdr.dev/docs/socket-api/)
- [Herdr Configuration](https://herdr.dev/docs/configuration/)
- [Herdr Agents](https://herdr.dev/docs/agents/)
- [Herdr Integrations](https://herdr.dev/docs/integrations/)
- [Herdr Agent Skill File](https://herdr.dev/docs/agent-skill/)
- [Herdr GitHub Repository](https://github.com/ogulcancelik/herdr)
- [Herdr Releases](https://github.com/ogulcancelik/herdr/releases)
- [Herdr Compare Page](https://herdr.dev/compare/)

## 9. Related Tutorials

- [[herdr-beginner-guide|Herdr Beginner Guide]] — installation, first session, basic keybindings
- [[tmux-claude-code-beginner-guide|Tmux + Claude Code Beginner Guide]] — traditional tmux approach to coding agents
- [[tmux-claude-code-deep-dive|Tmux + Claude Code Deep Dive]] — advanced tmux workflows with agents
- [[openmux-beginner-guide|OpenMux Beginner Guide]] — terminal multiplexing basics
- [[openmux-deep-dive|OpenMux Deep Dive]] — advanced OpenMux configuration and usage
- [[sesh-beginner-guide|Sesh Beginner Guide]] — terminal session management
- [[sesh-deep-dive|Sesh Deep Dive]] — advanced session workflows
- [[dtach-beginner-guide|Dtach Beginner Guide]] — lightweight terminal detaching
- [[dtach-deep-dive|Dtach Deep Dive]] — advanced dtach patterns
- [[mosh-beginner-guide|Mosh Beginner Guide]] — persistent remote shell connections
- [[mosh-deep-dive|Mosh Deep Dive]] — advanced Mosh usage and configuration
- [[honeymux-beginner-guide|Honeymux Beginner Guide]] — multiplexer workflows
- [[honeymux-deep-dive|Honeymux Deep Dive]] — advanced Honeymux patterns
- [[maestri-beginner-guide|Maestri Beginner Guide]] — AI agent orchestration on a canvas
- [[maestri-deep-dive|Maestri Deep Dive]] — advanced agent orchestration with terminal workflows
- [[ssh-tutorial|SSH Tutorial]] — SSH fundamentals
- [[ssh-config-deep-dive|SSH Config Deep Dive]] — advanced SSH configuration
- [[git-worktrees-worktrunk-beginner-guide|Git Worktrees Beginner Guide]] — git worktree workflows
- [[git-worktrees-worktrunk-deep-dive|Git Worktrees Deep Dive]] — advanced worktree patterns
- [[docker-test-container-deep-dive|Docker Test Container Deep Dive]] — containerized development environments

## 10. Summary

Herdr is architecturally a client-server terminal multiplexer (like tmux) extended with an agent-aware state machine, a full JSON socket API, and first-class git worktree integration. Its design choices reflect a specific thesis: that running multiple coding agents is the normal case, not a special one, and the terminal multiplexer should understand what is happening inside each pane.

**Key takeaways:**

- The server maintains agent state through a three-tier detection pipeline: process detection, screen heuristics, and integration hooks
- State rolls up hierarchically (agent > pane > tab > workspace) with blocked as highest priority
- The socket API exposes workspace, tab, pane, output, wait, worktree, and agent methods as NDJSON
- The CLI is a thin wrapper around the socket API — anything the CLI can do, a script can do
- Integrations provide the most precise agent state; install them for every agent you use
- Worktree commands combine `git worktree` with Herdr workspace creation for branch-per-workspace workflows
- Session restoration (`resume_agents_on_restore = true`) can resume agent sessions after server restart, given compatible integration versions
- Custom keybindings support both prefix-mode remapping and command bindings that launch panes or shell helpers

**Next steps:**

- Build a monitoring dashboard using the socket API and a tool like [[just-beginner-guide|Just]] for task automation
- Combine Herdr with [[mosh-deep-dive|Mosh]] and [[ssh-config-deep-dive|SSH config]] for robust remote multi-agent management
- Explore [[maestri-deep-dive|Maestri]] for canvas-based agent orchestration as a complement to Herdr's terminal-native approach
- Contribute integrations for additional agents via the [Herdr GitHub repository](https://github.com/ogulcancelik/herdr)
