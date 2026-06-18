---
title: "Herdr — Beginner's Guide"
date: 2026-05-30
difficulty: beginner
tags: [herdr, terminal, multiplexer, agent-runtime, tmux, panes, coding-agents, rust]
---

# Herdr — Beginner's Guide

## 1. Overview

Herdr is a terminal-native agent runtime and multiplexer written in Rust. It lets you run multiple AI coding agents side by side in real terminal panes, detach and reattach without losing state, and see at a glance whether each agent is **blocked**, **working**, or **done**.

Think of it as a purpose-built alternative to [[tmux-claude-code-beginner-guide|tmux]] for the age of coding agents. You keep your existing shell, SSH setup, fonts, and keybinds; Herdr adds persistent workspaces, mouse-native pane management, agent state awareness, and a CLI/socket API that agents themselves can drive.

**What you will learn:**

- How to install Herdr and start your first session
- The core UI: workspaces, tabs, and panes
- How to run coding agents inside Herdr panes
- Basic keybindings and mouse interactions
- Installing integrations for Claude Code, Codex, and other agents
- Detaching, reattaching, and keeping agents alive in the background

## 2. Prerequisites

Before starting, make sure you have:

- **A Unix-like OS** — Linux or macOS. Herdr runs in any modern terminal emulator.
- **Rust toolchain** — `cargo` is needed to build from source. Install via [rustup](https://rustup.rs/) if you do not have it:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

- **Git** — to clone the repository.
- **A coding agent** (optional but recommended) — Claude Code, Codex, Pi, OpenCode, or Hermes Agent. Having at least one installed lets you see Herdr's agent-awareness features in action.
- **Familiarity with the terminal** — you should be comfortable running commands, navigating directories, and using a shell. If you have used [[openmux-beginner-guide|OpenMux]], [[sesh-beginner-guide|Sesh]], or tmux before, you will feel right at home.

## 3. Key Concepts

### Session

A Herdr session is a persistent server process that keeps running even after you close your terminal or disconnect from [[ssh-tutorial|SSH]]. All your workspaces, tabs, panes, and running agents survive inside the session.

### Workspace

A workspace is a project-level container. It owns tabs and panes, and its sidebar state rolls up from the agents inside it — so you can see at a glance which project needs attention. Give each active project its own workspace.

### Tab

A tab is a layout inside a workspace. Use tabs to separate different views — for example, one tab for agents, another for logs, a third for a local server. Tabs are addressable from the CLI and socket API.

### Pane

A pane is a real terminal. Herdr renders the terminal output, sends input back to the process, and preserves the pane across client detach. Unlike some tools that show a log or transcript, you see the actual terminal — colors, cursor, scrollback and all.

### Agent State

An agent is a process that Herdr recognizes inside a pane. Herdr detects agents through three mechanisms:

1. **Process detection** — watching foreground processes
2. **Screen heuristics** — inferring state from terminal output
3. **Integrations** — hooks that report semantic state directly (most precise)

The sidebar displays a colored icon for each agent: **working** (active), **blocked** (waiting for input), **idle**, or **done**.

### Sidebar

The sidebar is always visible on the left. It shows your workspaces, tabs, panes, and their rolled-up agent state. A blocked agent makes its pane, tab, and workspace look blocked — so you can spot which project needs you without switching context.

## 4. Step-by-Step Instructions

### Step 1: Install Herdr

Clone the repository and build from source:

```bash
git clone https://github.com/ogulcancelik/herdr.git
cd herdr
cargo build --release
```

Expected output (last lines):

```
   Compiling herdr v0.x.y (/path/to/herdr)
    Finished `release` profile [optimized] target(s) in 1m 20s
```

Move the binary somewhere on your `$PATH`:

```bash
sudo cp target/release/herdr /usr/local/bin/
```

Verify the installation:

```bash
herdr --version
```

**Alternative — Nix users:**

```bash
nix run github:ogulcancelik/herdr/v0.x.y
```

Replace `v0.x.y` with the latest release tag from the [releases page](https://github.com/ogulcancelik/herdr/releases).

### Step 2: Start Your First Session

Simply run:

```bash
herdr
```

If no session exists, Herdr starts a background server and attaches your terminal to it. You will see the Herdr UI: a sidebar on the left and a terminal pane filling the rest of the screen.

If a session is already running, `herdr` reattaches to it — your previous workspaces, tabs, and panes will be exactly as you left them.

### Step 3: Learn the Prefix Key

Herdr uses a **prefix key** model similar to tmux. The default prefix is `ctrl+b`. Press the prefix first, then the action key.

Common prefix keybindings:

| Keys | Action |
|------|--------|
| `prefix + "` | Split pane down (horizontal split) |
| `prefix + %` | Split pane right (vertical split) |
| `prefix + arrow` | Move focus between panes |
| `prefix + c` | Create a new tab |
| `prefix + n` | Next tab |
| `prefix + p` | Previous tab |
| `prefix + q` | Detach from session |
| `prefix + z` | Zoom (toggle fullscreen on current pane) |

### Step 4: Split Panes and Run an Agent

Split your terminal into two panes:

```
prefix + %
```

In the left pane, start a coding agent. For example, if you have Claude Code installed:

```bash
claude
```

In the right pane, keep a shell open for running commands, checking logs, or reviewing files. The sidebar will update to show the agent's state.

### Step 5: Install an Agent Integration

Integrations make agent detection precise. Without them, Herdr relies on heuristics; with them, agents report semantic state (working, blocked, done) directly.

Install the Claude Code integration:

```bash
herdr integration install claude
```

This writes a hook script to `~/.claude/hooks/herdr-agent-state.sh` and updates `settings.json` with the appropriate hook entries.

Other available integrations:

```bash
herdr integration install codex
herdr integration install pi
herdr integration install opencode
herdr integration install hermes
```

Check what is installed:

```bash
herdr integration status
```

### Step 6: Use the Mouse

Herdr is mouse-native. You can:

- **Click** a pane to focus it
- **Drag** pane borders to resize
- **Click** workspace and tab names in the sidebar to switch
- **Scroll** within a pane to browse scrollback

If you want your terminal emulator to handle clicks instead (e.g., command-clicking URLs), set `mouse_capture = false` in the config file.

### Step 7: Detach and Reattach

When you need to close your terminal or disconnect from SSH, detach:

```
prefix + q
```

Your agents keep running in the background. To come back:

```bash
herdr
```

You are reconnected to the same session, same panes, same agents — exactly where you left off. This works identically to [[dtach-beginner-guide|dtach]] or [[sesh-beginner-guide|Sesh]] session persistence, but with Herdr's agent awareness built in.

### Step 8: Use the CLI to Control Panes

The `herdr` CLI talks to the running server over the local socket. Most commands output JSON.

Send text to a pane:

```bash
herdr pane send-text --pane <pane-id> "ls -la"
```

Run a command in a new pane:

```bash
herdr pane run "npm test"
```

Check server status:

```bash
herdr status
```

## 5. Practical Examples

### Example 1: Two Agents, One Project

Run Claude Code and Codex side by side on the same codebase:

```bash
# Start Herdr
herdr

# In the default pane, start Claude Code
claude

# Split right (prefix + %)
# In the new pane, start Codex
codex
```

The sidebar shows both agents. If Claude gets blocked waiting for approval, the pane and workspace turn "blocked" — you can see it even if you are working in a different workspace.

### Example 2: Multi-Project Dashboard

Create separate workspaces for different projects:

```bash
# From inside Herdr, use the CLI
herdr worktree create ~/projects/frontend
herdr worktree create ~/projects/backend
herdr worktree create ~/projects/infra
```

Each workspace gets its own tab and root pane. Switch between them via the sidebar or keybindings. The sidebar's rolled-up state tells you which project has agents that need attention.

### Example 3: Remote Agent Monitoring via SSH

SSH into a remote server where Herdr is running:

```bash
ssh user@server
herdr
```

You reattach to the remote session and see all your agents. Combined with [[mosh-beginner-guide|Mosh]] for a persistent connection, this gives you a robust remote agent management setup.

## 6. Hands-On Exercises

### Exercise 1: Install and Explore

1. Install Herdr from source following Step 1
2. Start a session with `herdr`
3. Create three panes (split twice) and explore switching focus with arrow keys
4. Detach with `prefix + q`, then reattach with `herdr`
5. Confirm all three panes are still there

**Success criteria:** You can detach and reattach without losing any pane.

### Exercise 2: Agent Integration

1. Install the Claude Code integration: `herdr integration install claude`
2. Start Claude Code in a Herdr pane
3. Give Claude a task and observe the sidebar state change from idle to working
4. When Claude asks a question, observe the state change to blocked
5. Answer the question and watch it return to working

**Success criteria:** The sidebar accurately reflects the agent's current state.

### Exercise 3: Multi-Workspace Workflow

1. Create two workspaces using `herdr worktree create` for two different project directories
2. Start an agent in each workspace
3. Practice switching between workspaces using the sidebar
4. Identify which workspace has a blocked agent from the sidebar alone

**Success criteria:** You can manage agents across projects without losing context.

## 7. Troubleshooting

### Herdr won't start

**Symptom:** `herdr` exits immediately or shows a connection error.

**Fix:** Check if a server is already running. If the socket file is stale, remove it:

```bash
rm -f /tmp/herdr-*.sock  # or wherever the socket lives
herdr
```

### Integration install fails

**Symptom:** `herdr integration install claude` says the config directory doesn't exist.

**Fix:** The agent's config directory must already exist. For Claude Code, make sure `~/.claude` exists (run `claude` at least once first). For Codex, ensure `~/.codex` exists.

### Agent state not updating

**Symptom:** Sidebar shows "idle" even though the agent is working.

**Fix:** Ensure the integration is installed (`herdr integration status`). Without integrations, Herdr uses heuristics which are less precise.

### Mouse not working

**Symptom:** Clicks and scrolling do nothing in panes.

**Fix:** Check that `mouse_capture` is not set to `false` in `~/.config/herdr/config.toml`. Some terminal emulators need mouse reporting enabled in their own settings.

### Detach doesn't persist

**Symptom:** After detaching and reattaching, panes are gone.

**Fix:** Make sure you are detaching with `prefix + q` (not killing the terminal process). The Herdr server must stay alive — if the machine reboots, you need to restart Herdr. Enable `resume_agents_on_restore = true` in the `[session]` config section for agent session restoration after server restarts.

## 8. References

- [Herdr Official Documentation](https://herdr.dev/docs/)
- [Herdr Quick Start](https://herdr.dev/docs/quick-start/)
- [Herdr Concepts](https://herdr.dev/docs/concepts/)
- [Herdr CLI Reference](https://herdr.dev/docs/cli-reference/)
- [Herdr Integrations](https://herdr.dev/docs/integrations/)
- [Herdr GitHub Repository](https://github.com/ogulcancelik/herdr)
- [Herdr Releases](https://github.com/ogulcancelik/herdr/releases)

## 9. Related Tutorials

- [[herdr-deep-dive|Herdr Deep Dive]] — advanced configuration, socket API, custom keybindings, and multi-agent orchestration
- [[tmux-claude-code-beginner-guide|Tmux + Claude Code Beginner Guide]] — the traditional tmux approach to running coding agents
- [[tmux-claude-code-deep-dive|Tmux + Claude Code Deep Dive]] — advanced tmux workflows with agents
- [[openmux-beginner-guide|OpenMux Beginner Guide]] — another terminal multiplexer option
- [[openmux-deep-dive|OpenMux Deep Dive]] — advanced OpenMux usage
- [[sesh-beginner-guide|Sesh Beginner Guide]] — terminal session management
- [[sesh-deep-dive|Sesh Deep Dive]] — advanced session workflows
- [[dtach-beginner-guide|Dtach Beginner Guide]] — lightweight terminal detaching
- [[dtach-deep-dive|Dtach Deep Dive]] — advanced dtach usage
- [[mosh-beginner-guide|Mosh Beginner Guide]] — persistent remote shell connections
- [[mosh-deep-dive|Mosh Deep Dive]] — advanced Mosh usage
- [[honeymux-beginner-guide|Honeymux Beginner Guide]] — multiplexer workflows
- [[honeymux-deep-dive|Honeymux Deep Dive]] — advanced Honeymux patterns
- [[maestri-beginner-guide|Maestri Beginner Guide]] — orchestrating AI agents on an infinite canvas
- [[maestri-deep-dive|Maestri Deep Dive]] — advanced agent orchestration patterns
- [[ssh-tutorial|SSH Tutorial]] — SSH fundamentals for remote access
- [[ssh-config-deep-dive|SSH Config Deep Dive]] — advanced SSH configuration
- [[git-worktrees-worktrunk-beginner-guide|Git Worktrees Beginner Guide]] — git worktrees, which Herdr can manage as workspaces
- [[git-worktrees-worktrunk-deep-dive|Git Worktrees Deep Dive]] — advanced worktree workflows

## 10. Summary

Herdr is a terminal multiplexer built specifically for the multi-agent workflow. It gives you tmux-style persistence (detach, reattach, sessions survive terminal closure) while adding agent-aware features: a sidebar that shows blocked/working/done state, integrations that hook directly into Claude Code, Codex, and other agents, and a CLI/socket API that agents themselves can use to create panes and run commands.

**Key takeaways:**

- Install from source with `cargo build --release`
- Run `herdr` to start or reattach to a session
- Use `prefix + q` to detach; agents keep running
- Install integrations (`herdr integration install claude`) for precise agent state
- The sidebar rolls up state hierarchically: agent > pane > tab > workspace
- Use `herdr worktree create` to manage git worktrees as separate workspaces

**Next steps:**

- Read the [[herdr-deep-dive|Herdr Deep Dive]] for socket API usage, custom keybindings, and advanced configuration
- Explore [[maestri-beginner-guide|Maestri]] for canvas-based agent orchestration as a complement to Herdr's terminal-native approach
- Set up [[mosh-beginner-guide|Mosh]] + Herdr for robust remote agent management
