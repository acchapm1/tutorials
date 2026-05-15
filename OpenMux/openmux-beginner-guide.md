---
title: OpenMux — Beginner-Friendly Guide
date: 2026-04-26
difficulty: beginner
tags:
  - openmux
  - terminal-multiplexer
  - tmux
  - zellij
  - cli
  - workflow
---

# OpenMux — Beginner-Friendly Guide

## Overview

OpenMux is a modern terminal multiplexer — a tool that lets you split your terminal into multiple panes, manage multiple workspaces, and keep sessions running in the background even after you close your terminal window. If you have ever wished you could see your code editor, a running server, and a test suite all at once without juggling multiple terminal windows, a multiplexer is exactly what you need.

OpenMux takes inspiration from **tmux** (the venerable standard) and **Zellij** (the newer Rust-based alternative), but it is built from scratch with a modern UI-first architecture using SolidJS and OpenTUI. It offers a master-stack tiling layout out of the box, vim-style `hjkl` navigation, a tmux-compatible `Ctrl+b` prefix key, 9 workspaces, session persistence, and a unique aggregate view for browsing all your running terminal processes at a glance.

**What you will learn in this guide:**

- How to install and launch OpenMux
- Core concepts: panes, workspaces, sessions, and layout modes
- Navigating and managing panes with keyboard shortcuts
- Creating, switching, and persisting sessions
- Detaching and reattaching to keep work running in the background
- Basic configuration via `config.toml`

## Prerequisites

- **A terminal emulator** — any modern terminal works (Ghostty, iTerm2, Kitty, Alacritty, WezTerm, macOS Terminal, Windows Terminal, etc.)
- **Node.js or Bun installed** — OpenMux is distributed as an npm/bun package. You can also use the standalone install script or download a binary from GitHub Releases.
- **Basic command-line familiarity** — you should be comfortable running commands, navigating directories, and editing text files. If you need a refresher, see [[linux-permissions-beginner-guide|Linux Permissions Beginner Guide]].
- No prior multiplexer experience is required. If you have used tmux before, many concepts will feel familiar.

## Key Concepts

Before diving in, here are the mental models that make OpenMux click.

### Panes

A **pane** is a single terminal instance inside OpenMux. You can have one pane taking up the whole screen, or split the screen into multiple panes arranged side by side or stacked. Each pane runs its own shell (or any command).

### Workspaces

OpenMux provides **9 workspaces** (numbered 1–9), similar to virtual desktops in a window manager like i3 or sway. Each workspace has its own independent set of panes and its own layout mode. The status bar at the bottom shows which workspaces have panes in them — empty workspaces are hidden. Think of workspaces as project contexts: workspace 1 for your web server, workspace 2 for database work, workspace 3 for documentation.

### Sessions

A **session** is a named collection of workspaces and their pane layouts. Sessions are auto-saved to `~/.config/openmux/sessions/` and persist across detach/attach cycles. You can create a "dev" session for development work and a "ops" session for monitoring, then switch between them without losing state.

### Layout Modes

Each workspace uses one of three layout modes:

- **Vertical** (`│`): A main pane on the left with additional panes stacked vertically on the right
- **Horizontal** (`─`): A main pane on top with additional panes arranged horizontally on the bottom
- **Stacked** (`▣`): A main pane on the left with additional panes tabbed on the right (only the active tab is visible)

This is a "master-stack" layout, inspired by Zellij and tiling window managers. The master pane gets the most screen real estate while secondary panes share the remaining space.

### The Shim Architecture

OpenMux uses a two-part architecture: a **UI client** that you interact with, and a **background shim server** that manages your actual terminal processes (PTYs). When you detach, the shim keeps running so your processes stay alive. When you reattach, the client reconnects to the shim and restores your terminal state instantly. This is similar to how tmux works with its server, but OpenMux uses PTY state snapshots for faster attach.

## Step-by-Step Instructions

### Step 1: Install OpenMux

Since you have Bun available, the simplest installation method is:

```bash
bun add -g openmux
```

**Alternative installation methods:**

```bash
# Via npm
npm install -g openmux

# Via the install script (downloads the latest release)
curl -fsSL https://raw.githubusercontent.com/monotykamary/openmux/main/scripts/install.sh | bash
```

Verify the installation:

```bash
openmux --help
```

Expected output:

```
Usage: openmux [command] [options]

Commands:
  (default)       Launch the UI (or reattach to existing session)
  session         Manage sessions (list, create, attach)
  pane            Manage panes (split, send, capture)
  attach          Attach to a session
  update          Update openmux to latest version
```

### Step 2: Launch OpenMux for the First Time

Simply run:

```bash
openmux
```

You will see your terminal transform into the OpenMux interface: a single pane with your shell, a status bar at the bottom showing the current workspace number, session name, and layout mode. A default `config.toml` is generated at `~/.config/openmux/config.toml` on first launch.

### Step 3: Create Your First Split

With OpenMux running, try creating a new pane:

- Press **`Alt+n`** to open a new pane (splits the screen)
- Or press **`Alt+\`** to split vertically (side by side)
- Or press **`Alt+-`** to split horizontally (top and bottom)

You now have two panes. The focused pane has a highlighted border.

### Step 4: Navigate Between Panes

Use vim-style navigation to move focus between panes:

- **`Alt+h`** — move focus left
- **`Alt+j`** — move focus down
- **`Alt+k`** — move focus up
- **`Alt+l`** — move focus right

You can also **click** on a pane with your mouse to focus it.

### Step 5: Switch Layout Modes

Cycle through the three layout modes to find what works best for your current task:

- **`Alt+[`** or **`Alt+]`** — cycle through Vertical → Horizontal → Stacked

Watch how your panes rearrange. With two panes in vertical mode you get a left-right split; in horizontal mode you get a top-bottom split; in stacked mode the secondary pane becomes a tab.

### Step 6: Use Workspaces

Switch to a different workspace to set up a separate context:

- **`Alt+2`** — switch to workspace 2 (a fresh, empty workspace)
- Create a pane here with **`Alt+n`**
- **`Alt+1`** — switch back to workspace 1

The status bar updates to show which workspaces have content. You can use **`Alt+1`** through **`Alt+9`** to jump to any workspace.

### Step 7: Zoom a Pane

When you need to focus on one pane temporarily:

- **`Alt+z`** — toggle zoom (the focused pane goes fullscreen)
- **`Alt+z`** again — return to the normal layout

This is invaluable when you need to read a long log or focus on writing code.

### Step 8: Close a Pane

When you are done with a pane:

- **`Alt+x`** — close the focused pane

If only one pane remains and you close it, the workspace becomes empty.

### Step 9: Use the Prefix Key (tmux-style)

If you are coming from tmux, OpenMux also supports a **`Ctrl+b`** prefix key with a 2-second timeout. Press `Ctrl+b` and then:

- **`n`** or **`Enter`** — new pane
- **`\`** — vertical split
- **`-`** — horizontal split
- **`h/j/k/l`** — navigate panes
- **`z`** — zoom
- **`x`** — close pane
- **`s`** — open session picker
- **`d`** — detach (leave running in background)
- **`q`** — quit OpenMux

### Step 10: Detach and Reattach

This is the killer feature of any multiplexer. Detach from your session while keeping everything running:

1. Press **`Ctrl+b`** then **`d`** to detach
2. You return to your regular terminal prompt. The shim server keeps all your panes alive in the background.
3. Run **`openmux`** again to reattach. Your panes, workspaces, and session state are restored instantly.

This means you can start a long-running process (a build, a server, a training job), detach, close your terminal, come back later, and pick up exactly where you left off.

### Step 11: Manage Sessions

Open the session picker to create or switch sessions:

- Press **`Alt+s`** (or `Ctrl+b` then `s`) to open the session picker
- Use **arrow keys** to navigate existing sessions
- Press **`Ctrl+n`** to create a new session (type a name, press Enter)
- Press **`Ctrl+r`** to rename the current session
- Press **`Ctrl+x`** to delete a session
- Press **`Enter`** to switch to the selected session

### Step 12: Use the Command Palette

OpenMux has a command palette (like VS Code) for discovering commands:

- Press **`Alt+p`** (or `Ctrl+b` then `:`) to open it
- Type to filter commands
- Press **`Enter`** to execute

## Practical Examples

### Example 1: Web Development Workflow

Set up a three-pane layout for a typical web development workflow:

```bash
# Launch openmux
openmux

# In the first pane, start your dev server
npm run dev

# Press Alt+\ to split vertically, then run tests
# (now in the second pane)
npm test -- --watch

# Press Alt+- to split horizontally from the second pane
# (now in the third pane - use this for git operations)
git status
```

You now have your dev server on the left (master pane), tests running top-right, and a git shell bottom-right.

### Example 2: Multi-Project Workspaces

Use workspaces to separate projects:

```bash
# Workspace 1 (Alt+1): Frontend project
cd ~/projects/frontend
npm run dev

# Switch to workspace 2 (Alt+2): Backend API
cd ~/projects/api
cargo watch -x run

# Switch to workspace 3 (Alt+3): Database monitoring
psql -h localhost mydb
```

Switch between projects instantly with `Alt+1`, `Alt+2`, `Alt+3`.

### Example 3: Using Sessions for Context Switching

```bash
# Create a "dev" session via CLI before launching
openmux session create dev
openmux attach --session dev

# ... set up your development panes ...

# Detach (Ctrl+b d), create another session
openmux session create ops
openmux attach --session ops

# ... set up monitoring panes ...
```

Now you can switch between your "dev" and "ops" sessions using the session picker (`Alt+s`).

### Example 4: CLI Automation with Pane Commands

OpenMux ships a headless CLI that can control a running instance:

```bash
# List sessions as JSON (useful for scripting)
openmux session list --json

# Split a pane in workspace 2
openmux pane split --direction vertical --workspace 2

# Send a command to the focused pane (note the \n for Enter)
openmux pane send --pane focused --text "npm test\n"

# Capture the last 200 lines of output from the focused pane
openmux pane capture --pane focused --lines 200 --format ansi
```

This makes OpenMux scriptable and automatable — you can integrate it with [[just-beginner-guide|just]] task runners or shell scripts. The `pane send` command supports C-style escape sequences like `\n`, `\t`, `\xNN`, and `\uXXXX`.

## Hands-On Exercises

### Exercise 1: Basic Navigation Drill

**Goal:** Build muscle memory for pane management.

1. Launch `openmux`
2. Create 4 panes using `Alt+n` three times
3. Navigate to each pane using `Alt+h/j/k/l` — notice how focus moves
4. Try all three layout modes with `Alt+[` and `Alt+]`
5. Zoom into a pane with `Alt+z`, then zoom out
6. Close two panes with `Alt+x`
7. Practice took less than 2 minutes? You are ready for daily use.

### Exercise 2: Workspace Organization

**Goal:** Practice separating contexts across workspaces.

1. In workspace 1, create two panes and run `top` in one
2. Switch to workspace 2 (`Alt+2`), create a pane, run `watch -n 1 date`
3. Switch to workspace 3 (`Alt+3`), create a pane, run `htop` (or `top`)
4. Rapidly switch between workspaces with `Alt+1`, `Alt+2`, `Alt+3`
5. Notice the status bar shows only workspaces with content

### Exercise 3: Detach / Reattach Cycle

**Goal:** Verify session persistence works.

1. Open openmux and create 3 panes in workspace 1
2. Run `echo "I was here"` in one pane
3. Press `Ctrl+b d` to detach
4. Confirm you are back at your regular shell prompt
5. Run `openmux` to reattach
6. Verify your panes and their content are intact

### Exercise 4: Session Management

**Goal:** Create and switch between named sessions.

1. Open the session picker with `Alt+s`
2. Press `Ctrl+n` to create a new session called "project-a"
3. Set up some panes in this session
4. Open the session picker again, create "project-b"
5. Switch between them using the session picker
6. Delete one session with `Ctrl+x` in the picker

### Exercise 5: Aggregate View Exploration

**Goal:** Use the aggregate view to browse all PTYs.

1. Create panes in workspaces 1, 2, and 3
2. Run different commands in each (`ls`, `top`, `python3`)
3. Press `Alt+g` to open the aggregate view
4. Browse the PTY list — notice the directory, process name, and git branch shown
5. Press `Enter` to preview a PTY, interact with it
6. Press `Alt+Esc` to return to the list, `Tab` to jump to a selected PTY

## Troubleshooting

**OpenMux does not launch / "command not found"**
Ensure the global bun or npm bin directory is in your `PATH`. Run `bun pm bin -g` or `npm bin -g` to check the path. Add it to your shell config if needed:

```bash
# For bun (add to ~/.zshrc or ~/.bashrc)
export PATH="$HOME/.bun/bin:$PATH"

# For npm
export PATH="$(npm bin -g):$PATH"
```

**Alt key shortcuts do not work**
Some terminal emulators intercept Alt key combinations for their own menus. In iTerm2, go to Preferences → Profiles → Keys and set "Left Option Key" to "Esc+" instead of "Normal". In macOS Terminal, check Preferences → Profiles → Keyboard → "Use Option as Meta key". Alternatively, use the `Ctrl+b` prefix mode which avoids Alt entirely.

**Panes appear too small**
OpenMux has minimum pane size constraints. Make your terminal window larger, or reduce the number of panes. You can adjust minimums via environment variables:

```bash
export OPENMUX_MIN_PANE_WIDTH=20
export OPENMUX_MIN_PANE_HEIGHT=5
```

**Cannot reattach after detaching**
If the shim server crashed, you may need to start a fresh session. Check for stale socket files in the OpenMux config directory and remove them if needed.

**Config changes not taking effect**
OpenMux hot-reloads `config.toml` — changes to layout, theme, and keybindings should apply immediately. If they do not, try restarting OpenMux. Ensure your TOML syntax is valid.

## References

- [OpenMux GitHub Repository](https://github.com/monotykamary/openmux) — source code, issues, and releases
- [OpenMux on npm](https://www.npmjs.com/package/openmux) — package page
- [OpenMux CLI Guide](https://github.com/monotykamary/openmux/blob/main/docs/guides/cli.md) — full CLI spec and exit codes
- [OpenMux Config Guide](https://github.com/monotykamary/openmux/blob/main/docs/guides/config.md) — full generated config reference
- [tmux documentation](https://man7.org/linux/man-pages/man1/tmux.1.html) — for comparison and migration
- [Zellij documentation](https://zellij.dev/documentation/) — for comparison of layout concepts

## Related Tutorials

- [[openmux-deep-dive|OpenMux Deep Dive]] — advanced configuration, architecture internals, and power-user patterns
- [[openmux-cheatsheet|OpenMux Cheatsheet]] — quick-reference card for all keybindings and commands
- [[sesh-beginner-guide|Sesh Beginner Guide]] and [[sesh-deep-dive|Sesh Deep Dive]] — terminal session management (complementary tool)
- [[mosh-beginner-guide|Mosh Beginner Guide]] and [[mosh-deep-dive|Mosh Deep Dive]] — remote terminal with tmux/multiplexer integration
- [[just-beginner-guide|Just Beginner Guide]] — task runner that pairs well with multiplexer workflows
- [[dotfiles-beginner-guide|Dotfiles Beginner Guide]] and [[chezmoi-beginner-guide|Chezmoi Beginner Guide]] — managing your OpenMux config across machines
- [[television-beginner-guide|Television Beginner Guide]] — terminal UI fuzzy finder
- [[linux-permissions-beginner-guide|Linux Permissions Beginner Guide]] — foundational CLI knowledge

## Summary

**Key takeaways:**

1. OpenMux is a modern terminal multiplexer with master-stack tiling, 9 workspaces, and session persistence.
2. Two input modes: **Alt shortcuts** (no prefix, immediate) and **Ctrl+b prefix** (tmux-compatible, 2-second timeout).
3. **Panes** are individual terminals; **workspaces** group panes by context; **sessions** persist everything to disk.
4. The **shim architecture** keeps your processes alive when you detach — reattach anytime with `openmux`.
5. Configuration lives at `~/.config/openmux/config.toml` and hot-reloads.
6. The **aggregate view** (`Alt+g`) is unique to OpenMux — browse and filter all PTYs across all workspaces.
7. The **CLI** (`openmux pane send`, `openmux pane capture`) makes OpenMux scriptable for automation.

**Next steps:** Explore the [[openmux-deep-dive|Deep Dive]] for advanced configuration (custom keybindings, vim mode, theming), architecture internals, and integration patterns with tools like [[sesh-deep-dive|sesh]] and [[just-deep-dive|just]]. Keep the [[openmux-cheatsheet|Cheatsheet]] open in a pane while you build muscle memory.
# Related Tutorials

- [[honeymux-beginner-guide|Honeymux Beginner Guide]] and [[honeymux-deep-dive|Honeymux Deep Dive]] — a TUI wrapper for tmux (alternative approach to terminal multiplexing)
- [[docker-test-container-beginner-guide|Docker Test Container Beginner Guide]] — test terminal configs safely in containers

- [[dtach-beginner-guide|Dtach Beginner Guide]] — minimal session persistence without a full multiplexer
- [[dtach-deep-dive|Dtach Deep Dive]] — advanced dtach patterns and integration with multiplexers
