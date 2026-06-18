---
title: OpenMux — Deep Dive Reference
date: 2026-04-26
difficulty: advanced
tags:
  - openmux
  - terminal-multiplexer
  - tmux
  - zellij
  - cli
  - workflow
  - configuration
  - architecture
---

# OpenMux — Deep Dive Reference

## Overview

OpenMux is a terminal multiplexer built on a UI-first architecture using SolidJS, OpenTUI, zig-pty, and libghostty-vt. Unlike tmux (C, server-client over Unix sockets, line-oriented protocol) or Zellij (Rust, WASM plugin system, layout DSL), OpenMux separates concerns into a thin UI client and a persistent background shim that owns PTY emulation and state snapshots. The result is fast attach/detach cycles, hot-swappable UI updates without touching running processes, and a reactive rendering pipeline that enables richer overlays (aggregate view, template system, command palette) than traditional multiplexers.

This deep dive covers the full architecture, every configuration surface, advanced keybinding customization, the CLI's programmatic interface, performance characteristics, and integration patterns for power-user workflows. It assumes you have already worked through [[openmux-beginner-guide|the beginner guide]] and are comfortable with basic pane/workspace/session operations.

## Prerequisites

- OpenMux installed and functional (see [[openmux-beginner-guide]])
- Familiarity with TOML configuration format
- Command-line proficiency including shell scripting
- Understanding of PTY (pseudo-terminal) concepts is helpful but not required
- Experience with at least one other multiplexer (tmux or Zellij) will help you appreciate the design differences

## Key Concepts

### Architecture: Client, Shim, and Emulator

OpenMux's architecture is a four-layer stack:

```
┌─────────────────────────┐
│  Host Terminal (TTY)    │  Your terminal emulator (Ghostty, iTerm2, etc.)
└────────────┬────────────┘
             │ input/output
             v
┌─────────────────────────┐
│ openmux UI (client)     │  SolidJS + OpenTUI reactive rendering
└────────────┬────────────┘
             │ shim protocol (detach/attach)
             v
┌─────────────────────────┐
│ shim server (background)│  Persists across detach/attach cycles
└────────────┬────────────┘
             │ PTY I/O + emulation
             v
┌─────────────────────────┐
│ zig-pty + libghostty-vt │  Native terminal emulation engine
└─────────────────────────┘
```

**Why this matters:**

- **UI binary swap**: You can update the openmux binary (the UI client) without killing running PTYs. The shim server continues independently. After updating, just reattach and the new UI connects to the existing shim.
- **PTY state snapshots**: The shim maintains terminal state snapshots. When a client attaches, it receives an immediate state dump rather than replaying output through a redraw pipeline. This makes attach feel instant even with complex terminal content.
- **Single-client steal/lock**: Only one UI client connects at a time. A new client steals the lock and the previous client detaches. This is simpler and more predictable than tmux's multi-client model.
- **Emulator ownership**: Because the shim owns emulation (via libghostty-vt), features like aggregate previews, scrollback caching, and cross-pane search are first-class rather than bolted on.
- **Lower client CPU**: The shim handles emulation; the client only renders state updates via SolidJS's reactive diff system.

### The Reactive Rendering Pipeline

OpenMux uses **SolidJS** as its reactive framework and **OpenTUI** as the terminal UI rendering layer. SolidJS compiles components to fine-grained reactive subscriptions — when terminal state changes, only the affected screen regions re-render, not the entire frame. This is fundamentally different from tmux's full-screen redraw approach and contributes to lower CPU usage during normal operation.

Overlays (command palette, session picker, aggregate view, template overlay) are SolidJS components rendered on top of the pane layer. This UI-first architecture is why OpenMux can offer richer interactive overlays than tmux or Zellij.

### PTY Management and libghostty-vt

The terminal emulation layer uses **libghostty-vt**, the virtual terminal library extracted from the Ghostty terminal emulator, paired with **zig-pty** for pseudo-terminal management. This gives OpenMux:

- Accurate terminal emulation compatible with modern applications (true color, mouse protocols, alternate screen)
- Kitty graphics protocol support for inline image display
- Efficient scrollback buffering managed at the emulator level

## Step-by-Step Instructions

### 1. Master the Configuration File

OpenMux loads `~/.config/openmux/config.toml` (or `$XDG_CONFIG_HOME/openmux/config.toml`). If the file does not exist, a full default config is generated on first launch. Config changes are **hot-reloaded** while OpenMux is running — layout, theme, and keybindings update live without restart.

**To reset to defaults:** delete the config file and restart OpenMux. A fresh default config will be generated.

**Environment variable overrides** take precedence over the config file for these layout values:

```bash
export OPENMUX_WINDOW_GAP=2          # Gap between panes in cells
export OPENMUX_MIN_PANE_WIDTH=20     # Minimum pane width in columns
export OPENMUX_MIN_PANE_HEIGHT=5     # Minimum pane height in rows
export OPENMUX_STACK_RATIO=0.5       # Maps to layout.defaultSplitRatio
```

### 2. Customize Keybindings

Keybindings are defined in `config.toml`. To unbind any keybinding, set its value to `null` or `"unbind"`:

```toml
[keybindings]
# Remap Alt+n to something else or disable it
"alt+n" = "unbind"

# Reassign pane creation to a different key
"alt+c" = "new-pane"
```

Refer to the full config guide at `docs/guides/config.md` in the repository for the complete list of bindable actions.

### 3. Enable Vim Mode for Overlays

OpenMux offers an opt-in vim mode for all overlay interfaces (session picker, aggregate view, template overlay, command palette). When enabled, overlays open in normal mode with vim-style navigation:

```toml
[keyboard]
vimMode = "overlays"
vimSequenceTimeoutMs = 1000
```

You can also toggle this at runtime via the command palette ("Toggle overlay vim mode").

**Vim mode keybindings in overlays:**

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate lists |
| `gg` / `G` | Jump to first / last item |
| `Enter` | Confirm / preview |
| `q` | Close overlay |
| `i` | Enter insert mode (for typing in filter/search fields) |
| `Esc` | Return to normal mode |
| `n` / `N` | Next / previous search match |

### 4. Advanced Session Management

Sessions are stored as files in `~/.config/openmux/sessions/`. Each session persists workspace layouts and pane working directories.

**CLI session management:**

```bash
# List all sessions as JSON (for scripting)
openmux session list --json
```

Expected output:

```json
[
  {"name": "default", "created": "2026-04-26T10:00:00Z", "workspaces": 3, "panes": 7},
  {"name": "dev", "created": "2026-04-25T14:30:00Z", "workspaces": 2, "panes": 4}
]
```

```bash
# Create a named session
openmux session create my-project

# Attach to a specific session
openmux attach --session my-project
```

**Session picker keyboard reference:**

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate sessions |
| `Enter` | Select or create session |
| `Ctrl+n` | Create new session |
| `Ctrl+r` | Rename session |
| `Ctrl+x` / `Ctrl+d` | Delete session |
| `Backspace` | Delete last filter character |
| `Esc` | Close picker |

### 5. Template System for Layout Persistence

Templates let you save and restore workspace layouts. This is OpenMux's answer to tmux's `tmuxinator` or Zellij's layout files, but built directly into the multiplexer.

**Save the current layout as a template:**

1. Press `Alt+t` (or `Ctrl+b` then `T`) to open the template overlay
2. Press `Tab` to switch to the Save tab
3. Type a name for your template
4. Press `Enter` to save

**Apply a saved template:**

1. Press `Alt+t` to open the template overlay
2. Navigate to the desired template with arrow keys
3. Press `Enter` to apply

**Template overlay keys:**

| Tab | Key | Action |
|-----|-----|--------|
| Apply | `↑` / `↓` | Navigate templates |
| Apply | `Enter` | Apply selected template |
| Apply | `Tab` | Switch to save tab |
| Apply | `Ctrl+x` / `Ctrl+d` | Delete template |
| Save | `Enter` | Save current layout |
| Save | `Tab` | Switch to apply tab |
| Both | `Esc` | Close overlay |

### 6. The Aggregate View (PTY Browser)

The aggregate view (`Alt+g` or `Ctrl+b g`) is a fullscreen overlay unique to OpenMux. It provides a bird's-eye view of every PTY across all workspaces.

**What the aggregate view shows:**

- **Card-style PTY list** with directory path, process name, and git branch
- **Interactive terminal preview** with full input support (keyboard and mouse)
- **Filter by typing** to search by process name, directory, or git branch
- **Scope toggle** between all workspaces and current workspace only

**Workflow pattern — aggregate view as a process finder:**

1. Press `Alt+g` to open the aggregate view
2. Type to filter (e.g., "node" to find all Node.js processes)
3. Press `Enter` to preview a PTY and interact with it
4. Press `Alt+Esc` to return to the list
5. Press `Tab` to jump directly to the selected PTY's workspace and close the view

This replaces the common tmux pattern of `Ctrl+b w` (window list) with a much richer, filterable interface.

**Aggregate view keys:**

| Context | Key | Action |
|---------|-----|--------|
| List | `↑` / `↓` | Navigate PTYs |
| List | `Enter` | Preview selected PTY |
| List | `Tab` | Jump to PTY and close view |
| List | `Alt+a` | Toggle scope (all vs current workspace) |
| List | `Alt+x` | Kill selected PTY |
| List | `Alt+Esc` | Close aggregate view |
| Preview | `Alt+Esc` | Return to list |
| Preview | `Alt+f` | Open search in preview |
| Preview | `Alt+x` | Kill current PTY |

### 7. Programmatic Control via CLI

OpenMux's CLI enables scripting and automation. All pane commands require a running UI instance (they communicate via a control socket).

```bash
# Split a pane in a specific workspace
openmux pane split --direction vertical --workspace 2
openmux pane split --direction horizontal --workspace 1

# Send keystrokes to the focused pane
openmux pane send --pane focused --text "cd ~/projects/api\n"
openmux pane send --pane focused --text "cargo run\n"

# Capture terminal output (useful for logging/testing)
openmux pane capture --pane focused --lines 200 --format ansi
```

The `pane send` command supports C-style escape sequences: `\n` (newline), `\t` (tab), `\xNN` (hex byte), `\uXXXX` (Unicode codepoint).

**Integration with just:**

```just
# justfile — launch a development environment
dev:
    openmux session create dev 2>/dev/null || true
    openmux attach --session dev &
    sleep 1
    openmux pane send --pane focused --text "npm run dev\n"
    openmux pane split --direction vertical --workspace 1
    openmux pane send --pane focused --text "npm test -- --watch\n"
```

See [[just-deep-dive|Just Deep Dive]] for more on task automation.

### 8. Move Mode for Pane Rearrangement

Move mode lets you physically reposition panes within the layout tree:

1. Press `Alt+m` (or `Ctrl+b m`) to enter move mode
2. Use `h/j/k/l` to move the focused pane west/south/north/east
3. Press `Esc` to exit move mode

This is useful for reorganizing your master-stack layout without closing and recreating panes.

### 9. Search Across Terminal Content

Search mode (`Alt+f` or `Ctrl+b /`) lets you search through the scrollback buffer of the focused pane:

| Key | Action |
|-----|--------|
| (type) | Search query |
| `Ctrl+n` | Next match |
| `Ctrl+p` | Previous match |
| `Enter` | Confirm and jump |
| `Esc` | Cancel search |
| `Backspace` | Delete last character |

Search is also available inside the aggregate view preview (`Alt+f` while previewing a PTY).

## Practical Examples

### Example 1: Scripted Development Environment

Create a shell function that sets up your entire dev environment:

```bash
# Add to ~/.zshrc or ~/.bashrc
dev-env() {
    local project="${1:-default}"

    # Create or attach to a project session
    openmux session create "$project" 2>/dev/null
    openmux attach --session "$project" &
    sleep 1

    # Workspace 1: Code + server
    openmux pane send --pane focused --text "cd ~/projects/$project\n"
    openmux pane split --direction vertical --workspace 1
    openmux pane send --pane focused --text "cd ~/projects/$project && npm run dev\n"

    # Workspace 2: Testing
    # (User switches to workspace 2 manually with Alt+2)
}
```

Usage:

```bash
dev-env my-app
```

### Example 2: Config for Comfortable Tmux Migration

If you are migrating from tmux and want to lean on the prefix key while building new habits:

```toml
# ~/.config/openmux/config.toml

[keyboard]
# Use prefix mode as primary (tmux muscle memory)
vimMode = "overlays"  # vim-style overlay navigation

[layout]
defaultSplitRatio = 0.6  # Give master pane 60% of space
windowGap = 1
```

Key mapping comparison for tmux users:

| tmux | OpenMux (prefix) | OpenMux (Alt) |
|------|-------------------|---------------|
| `Ctrl+b "` | `Ctrl+b -` | `Alt+-` |
| `Ctrl+b %` | `Ctrl+b \` | `Alt+\` |
| `Ctrl+b o` | `Ctrl+b j/k` | `Alt+j/k` |
| `Ctrl+b c` | `Ctrl+b n` | `Alt+n` |
| `Ctrl+b x` | `Ctrl+b x` | `Alt+x` |
| `Ctrl+b d` | `Ctrl+b d` | — |
| `Ctrl+b z` | `Ctrl+b z` | `Alt+z` |
| `Ctrl+b w` | `Ctrl+b g` | `Alt+g` |
| `Ctrl+b s` | `Ctrl+b s` | `Alt+s` |

### Example 3: Using OpenMux with sesh

[[sesh-deep-dive|Sesh]] is a terminal session manager. You can use sesh to orchestrate which OpenMux session to attach to:

```bash
# List openmux sessions and pipe to sesh-style selection
openmux session list --json | jq -r '.[].name' | fzf --prompt="session> " | xargs -I {} openmux attach --session {}
```

### Example 4: Monitoring Dashboard

Set up a persistent monitoring workspace:

```bash
# Create a dedicated session
openmux session create monitoring
openmux attach --session monitoring

# Workspace 1: System monitoring (vertical layout)
# Pane 1 (master): htop
# Pane 2: disk usage watcher
# Pane 3: network monitor

# Workspace 2: Log tailing (horizontal layout)
# Pane 1 (master): application logs
# Pane 2: system logs

# Save this as a template (Alt+t → Tab → "monitoring" → Enter)
# Next time, just apply the template to recreate the layout
```

### Example 5: Pane Capture for CI/Testing

Use the CLI capture feature to extract terminal output programmatically:

```bash
#!/bin/bash
# run-and-capture.sh — run tests and capture output

openmux pane send --pane focused --text "npm test 2>&1\n"
sleep 10  # Wait for tests to complete

# Capture last 500 lines of output
output=$(openmux pane capture --pane focused --lines 500 --format ansi)

# Check for failures
if echo "$output" | grep -q "FAIL"; then
    echo "Tests failed!"
    echo "$output" > test-failure-$(date +%Y%m%d-%H%M%S).log
    exit 1
fi

echo "All tests passed."
```

## Hands-On Exercises

### Exercise 1: Custom Keybinding Configuration

**Goal:** Personalize your keybindings and verify hot-reload.

1. Open `~/.config/openmux/config.toml` in your editor (in a separate pane inside OpenMux — meta!)
2. Unbind a default keybinding you do not use
3. Add a custom binding for an action you use frequently
4. Save the file — observe that the change takes effect immediately without restart
5. Test the new binding

### Exercise 2: Template Workflow

**Goal:** Create, save, and restore a workspace layout.

1. Set up a 3-pane layout in workspace 1 with vertical mode
2. Run different commands in each pane (`ls -la`, `watch date`, `top`)
3. Save as a template named "three-pane-monitor" via `Alt+t` → Tab → type name → Enter
4. Close all panes (`Alt+x` three times)
5. Apply the template via `Alt+t` → select → Enter
6. Verify the layout is restored (commands will not be restored — only pane geometry and working directories)

### Exercise 3: Aggregate View Power Usage

**Goal:** Use the aggregate view as your primary navigation tool.

1. Create panes across workspaces 1, 2, and 3 (at least 6 total)
2. Run distinct commands in each (different directories, different processes)
3. Open the aggregate view (`Alt+g`)
4. Type a filter to narrow down to a specific process
5. Preview a PTY from a different workspace, interact with it
6. Use `Tab` to jump directly to that PTY's location
7. Open aggregate view again, toggle scope with `Alt+a`

### Exercise 4: CLI Scripting

**Goal:** Automate pane setup via the CLI.

1. Write a shell script that:
   - Creates a session named "test-automation"
   - Attaches to it
   - Splits two panes
   - Sends `echo "pane 1"` to one and `echo "pane 2"` to the other
2. Run the script and verify the output
3. Use `openmux pane capture` to extract and verify the output

### Exercise 5: Vim Mode Exploration

**Goal:** Enable and practice vim mode in overlays.

1. Enable vim mode via the command palette (`Alt+p` → type "vim" → Enter)
2. Open the session picker (`Alt+s`) — notice you are in normal mode
3. Navigate with `j/k`, jump with `gg`/`G`
4. Press `i` to enter insert mode (for typing a filter)
5. Press `Esc` to return to normal mode
6. Close with `q`
7. If you prefer, disable vim mode via the command palette

## Troubleshooting

### Alt key conflicts with terminal emulator

**Symptom:** Alt shortcuts do nothing or produce garbage characters.

**Cause:** Your terminal emulator is interpreting Alt as a modifier for its own functions or sending `ESC` + key instead of the proper Alt sequence.

**Solutions by terminal:**

- **iTerm2:** Preferences → Profiles → Keys → set "Left Option Key" to "Esc+"
- **macOS Terminal:** Preferences → Profiles → Keyboard → check "Use Option as Meta key"
- **Ghostty:** Alt key should work out of the box
- **Kitty:** `macos_option_as_alt yes` in `kitty.conf`
- **Alacritty:** No special configuration needed on Linux; on macOS use `option_as_alt: Both` in config

**Workaround:** Use `Ctrl+b` prefix mode exclusively. All Alt shortcuts have prefix equivalents.

### Shim server left running after crash

**Symptom:** Cannot start a new OpenMux instance; port/socket conflicts.

**Solution:** Find and kill the orphaned shim process:

```bash
# Find openmux shim processes
ps aux | grep openmux

# Kill the shim server
kill <shim-pid>
```

### Config TOML syntax errors

**Symptom:** OpenMux ignores config changes or fails to start.

**Solution:** Validate your TOML:

```bash
# Quick syntax check (requires python3)
python3 -c "import tomllib; tomllib.load(open('$HOME/.config/openmux/config.toml', 'rb'))"
```

If the file is corrupted, delete it and let OpenMux regenerate the defaults.

### Performance: high CPU during heavy output

**Symptom:** CPU spikes when a process produces massive output (e.g., `cat` on a large file, verbose build logs).

**Explanation:** The shim's emulator processes every byte of output to maintain accurate terminal state. This is by design — it enables accurate snapshots and aggregate previews.

**Mitigations:**

- Pipe high-volume output through `less` or redirect to a file
- Use `Alt+z` to zoom the noisy pane (reduces rendering overhead for other panes)
- Reduce scrollback buffer size in config if you do not need deep history

### Kitty graphics not displaying

**Symptom:** Images sent via the Kitty graphics protocol do not render.

**Cause:** Your host terminal emulator must also support the Kitty graphics protocol. OpenMux passes graphics through the emulation layer.

**Compatible terminals:** Kitty, Ghostty, WezTerm. iTerm2 uses its own inline image protocol instead.

## References

- [OpenMux GitHub Repository](https://github.com/monotykamary/openmux) — source code, architecture docs, issues
- [OpenMux npm package](https://www.npmjs.com/package/openmux) — releases and version history
- [OpenMux CLI Guide](https://github.com/monotykamary/openmux/blob/main/docs/guides/cli.md) — full CLI specification with exit codes
- [OpenMux Config Guide](https://github.com/monotykamary/openmux/blob/main/docs/guides/config.md) — complete generated config reference
- [OpenTUI](https://github.com/nicksenger/opentui) — the terminal UI library behind OpenMux
- [SolidJS](https://www.solidjs.com/) — the reactive framework powering the UI
- [libghostty](https://github.com/ghostty-org/ghostty) — the terminal emulation engine (via Ghostty)
- [tmux Wiki](https://github.com/tmux/tmux/wiki) — for migration reference
- [Zellij documentation](https://zellij.dev/documentation/) — for comparing layout and plugin concepts

## Related Tutorials

- [[openmux-beginner-guide|OpenMux Beginner Guide]] — start here if you are new
- [[openmux-cheatsheet|OpenMux Cheatsheet]] — quick-reference card for all keybindings
- [[sesh-beginner-guide|Sesh Beginner Guide]] and [[sesh-deep-dive|Sesh Deep Dive]] — session management that complements OpenMux
- [[mosh-beginner-guide|Mosh Beginner Guide]] and [[mosh-deep-dive|Mosh Deep Dive]] — remote terminal; OpenMux can replace tmux in a Mosh + multiplexer stack
- [[just-beginner-guide|Just Beginner Guide]] and [[just-deep-dive|Just Deep Dive]] — task automation with OpenMux CLI integration
- [[dotfiles-beginner-guide|Dotfiles Beginner Guide]] and [[dotfiles-deep-dive|Dotfiles Deep Dive]] — syncing your `config.toml` across machines
- [[chezmoi-beginner-guide|Chezmoi Beginner Guide]] and [[chezmoi-deep-dive|Chezmoi Deep Dive]] — dotfile management with templating
- [[television-beginner-guide|Television Beginner Guide]] and [[television-deep-dive|Television Deep Dive]] — TUI fuzzy finder
- [[linux-permissions-beginner-guide|Linux Permissions Beginner Guide]] — foundational shell knowledge
- [[hammerspoon-deep-dive|Hammerspoon Deep Dive]] — macOS automation that can launch OpenMux sessions
- [[bunch-deep-dive|Bunch Deep Dive]] — app orchestration that can include terminal multiplexer setup

## Summary

**Key takeaways:**

1. **Architecture matters.** The client/shim/emulator separation gives OpenMux unique capabilities: UI binary swap without process loss, instant attach via state snapshots, and first-class aggregate views.
2. **Configuration is hot-reloaded.** Edit `config.toml`, save, and changes apply immediately. Environment variables override config values for layout parameters.
3. **Two input paradigms.** Alt shortcuts for speed, Ctrl+b prefix for tmux compatibility. Vim mode adds a third layer for overlay navigation.
4. **Templates replace external tools.** Built-in template save/apply replaces tmuxinator/tmuxp for layout persistence.
5. **The aggregate view is the killer feature.** No other multiplexer offers a filterable, previewable browser across all PTYs in all workspaces.
6. **The CLI enables automation.** `openmux pane send/capture/split` and `openmux session create/list` make OpenMux scriptable for CI, [[just-deep-dive|just]] recipes, and shell functions.
7. **Escape hatches exist.** If Alt keys conflict with your terminal, prefix mode covers everything. If config breaks, delete and regenerate.

**Further exploration:** Watch the GitHub repository for new features (the roadmap includes additional layout modes and plugin capabilities). Experiment with integrating OpenMux CLI commands into your [[just-beginner-guide|justfiles]] and [[dotfiles-deep-dive|dotfile]] management. Consider replacing tmux in your [[mosh-deep-dive|Mosh]] workflow for a more modern experience.
# Related Tutorials

- [[honeymux-beginner-guide|Honeymux Beginner Guide]] and [[honeymux-deep-dive|Honeymux Deep Dive]] — a TUI wrapper for tmux (compare with OpenMux's independent approach)
- [[docker-test-container-beginner-guide|Docker Test Container Beginner Guide]] and [[docker-test-container-deep-dive|Docker Test Container Deep Dive]] — test terminal multiplexer configs safely in containers

- [[dtach-beginner-guide|Dtach Beginner Guide]] — lightweight detach/reattach for simple use cases
- [[dtach-deep-dive|Dtach Deep Dive]] — dtach internals and composability with other tools

- [[herdr-beginner-guide|Herdr Beginner Guide]] — agent-aware terminal multiplexer
- [[herdr-deep-dive|Herdr Deep Dive]] — advanced Herdr configuration and socket API