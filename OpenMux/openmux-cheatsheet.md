---
title: OpenMux — Cheatsheet
date: 2026-04-26
difficulty: beginner
tags:
  - openmux
  - terminal-multiplexer
  - cheatsheet
  - hotkeys
  - reference
---

# OpenMux — Cheatsheet

Quick-reference card for OpenMux keybindings, CLI commands, and core concepts. Print this or keep it open in a pane while building muscle memory.

---

## Normal Mode (Alt shortcuts — no prefix needed)

| Shortcut | Action |
|----------|--------|
| `Alt+h` / `j` / `k` / `l` | Navigate panes (left / down / up / right) |
| `Alt+n` | New pane |
| `Alt+\` | Split pane vertically (side by side) |
| `Alt+-` | Split pane horizontally (top / bottom) |
| `Alt+x` | Close focused pane |
| `Alt+z` | Toggle zoom (fullscreen focused pane) |
| `Alt+m` | Enter move mode |
| `Alt+[` / `Alt+]` | Cycle layout mode (vertical → horizontal → stacked) |
| `Alt+1` – `Alt+9` | Switch to workspace 1–9 |
| `Alt+s` | Open session picker |
| `Alt+t` | Open template overlay |
| `Alt+g` | Open aggregate view (browse all PTYs) |
| `Alt+f` | Open search |
| `Alt+p` | Open command palette |

---

## Prefix Mode (Ctrl+space, then key within 2s)

| Key | Action |
|-----|--------|
| `n` / `Enter` | New pane |
| `\` | Split vertically |
| `-` | Split horizontally |
| `h` / `j` / `k` / `l` | Navigate panes |
| `m` | Enter move mode |
| `x` | Close pane |
| `z` | Toggle zoom |
| `v` | Layout: vertical |
| `H` | Layout: horizontal |
| `t` | Layout: stacked (tabbed) |
| `T` | Open template overlay |
| `1` – `9` | Switch to workspace |
| `s` | Open session picker |
| `g` | Open aggregate view |
| `/` | Open search |
| `:` | Open command palette |
| `]` / `p` | Paste from clipboard |
| `` ` `` | Toggle console overlay |
| `d` | Detach (session keeps running) |
| `q` | Quit openmux |
| `Esc` | Exit prefix mode |

---

## Move Mode (Alt+m or Ctrl+space m)

| Key | Action |
|-----|--------|
| `h` / `j` / `k` / `l` | Move focused pane (west / south / north / east) |
| `Esc` | Exit move mode |

---

## Mouse

| Action | Effect |
|--------|--------|
| Click pane | Focus pane |
| Click tab | Switch stacked pane (in stacked mode) |
| Scroll wheel | Scroll terminal history |
| Click scrollbar | Jump to position |
| Drag scrollbar | Scroll by dragging |

---

## Search Mode (Alt+f or Ctrl+space /)

| Key | Action |
|-----|--------|
| (type) | Enter search query |
| `Ctrl+n` | Next match |
| `Ctrl+p` | Previous match |
| `Enter` | Confirm and jump |
| `Esc` | Cancel search |

---

## Command Palette (Alt+p or Ctrl+space :)

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate commands |
| `Enter` | Execute selected command |
| `Esc` | Close palette |

---

## Session Picker (Alt+s or Ctrl+space s)

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate sessions |
| `Enter` | Select / create session |
| `Ctrl+n` | Create new session |
| `Ctrl+r` | Rename session |
| `Ctrl+x` / `Ctrl+d` | Delete session |
| `Esc` | Close picker |

---

## Template Overlay (Alt+t or Ctrl+space T)

| Tab | Key | Action |
|-----|-----|--------|
| Apply | `↑` / `↓` | Navigate templates |
| Apply | `Enter` | Apply selected template |
| Apply | `Ctrl+x` | Delete template |
| Apply | `Tab` | Switch to Save tab |
| Save | `Enter` | Save current layout |
| Save | `Tab` | Switch to Apply tab |
| Both | `Esc` | Close overlay |

---

## Aggregate View (Alt+g or Ctrl+space g)

**List:**

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate PTYs |
| `Enter` | Preview selected PTY |
| `Tab` | Jump to PTY and close view |
| `Alt+a` | Toggle scope (all / current workspace) |
| `Alt+x` | Kill selected PTY |
| (type) | Filter by process / directory / git branch |
| `Alt+Esc` | Close aggregate view |

**Preview:**

| Key | Action |
|-----|--------|
| `Alt+Esc` | Return to list |
| `Alt+f` | Open search in preview |
| `Alt+x` | Kill current PTY |

---

## Vim Mode (opt-in, overlays only)

Enable: command palette → "Toggle overlay vim mode" — or in `config.toml`:

```toml
[keyboard]
vimMode = "overlays"
```

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate lists |
| `gg` / `G` | First / last item |
| `Enter` | Confirm / preview |
| `q` | Close overlay |
| `i` | Insert mode |
| `Esc` | Normal mode |
| `n` / `N` | Next / previous match |

---

## Confirmation Dialog

| Key | Action |
|-----|--------|
| `h` / `←` or `l` / `→` | Focus confirm / cancel |
| `Tab` | Toggle focus |
| `Enter` | Confirm |
| `Esc` | Cancel |

---

## CLI Commands

```bash
# Launch or reattach
openmux

# Session management
openmux session list --json
openmux session create <name>
openmux attach --session <name>

# Pane control (requires running UI)
openmux pane split --direction vertical --workspace <N>
openmux pane split --direction horizontal --workspace <N>
openmux pane send --pane focused --text "command\n"
openmux pane capture --pane focused --lines 200 --format ansi

# Update
openmux update
openmux update --yes
```

---

## Layout Modes

| Mode | Icon | Description |
|------|------|-------------|
| Vertical | `│` | Master left, stack right (vertical split) |
| Horizontal | `─` | Master top, stack bottom (horizontal split) |
| Stacked | `▣` | Master left, stack tabbed right |

Cycle with `Alt+[` / `Alt+]` or set explicitly via prefix: `v` (vertical), `H` (horizontal), `t` (stacked).

---

## Configuration

| Item | Location |
|------|----------|
| Config file | `~/.config/openmux/config.toml` |
| Sessions | `~/.config/openmux/sessions/` |
| XDG override | `$XDG_CONFIG_HOME/openmux/config.toml` |

**Environment variable overrides:**

| Variable | Maps to |
|----------|---------|
| `OPENMUX_WINDOW_GAP` | Gap between panes |
| `OPENMUX_MIN_PANE_WIDTH` | Minimum pane width |
| `OPENMUX_MIN_PANE_HEIGHT` | Minimum pane height |
| `OPENMUX_STACK_RATIO` | `layout.defaultSplitRatio` |

Config changes **hot-reload** — no restart needed.

---

## Architecture (Quick Reference)

```
Host Terminal → openmux UI (SolidJS + OpenTUI)
                    ↕ shim protocol
               shim server (background, persists across detach)
                    ↕ PTY I/O
               zig-pty + libghostty-vt
```

- **Detach:** `Ctrl+b d` — UI exits, shim keeps PTYs alive
- **Reattach:** run `openmux` — UI reconnects to shim, instant state restore
- **Update:** install new version, reattach — UI swaps, PTYs untouched

---

## Related Tutorials

- [[openmux-beginner-guide|OpenMux Beginner Guide]] — full walkthrough for new users
- [[openmux-deep-dive|OpenMux Deep Dive]] — architecture, advanced config, scripting
- [[sesh-beginner-guide|Sesh Beginner Guide]] — terminal session management
- [[mosh-deep-dive|Mosh Deep Dive]] — remote terminal with multiplexer integration
- [[just-beginner-guide|Just Beginner Guide]] — task runner for automation
- [[dotfiles-beginner-guide|Dotfiles Beginner Guide]] — sync your config across machines
