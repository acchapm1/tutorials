---
title: Yabai — Deep Dive
date: 2026-04-15
difficulty: advanced
tags: [macos, yabai, tiling, window-management, sip, bsp, skhd, ipc, signals]
---

# Yabai — Deep Dive

## Overview

Yabai is a tiling window manager for macOS written in C. It speaks directly to the private Accessibility and CoreGraphics APIs, manages windows via a binary-space-partitioning tree, and — when the scripting addition is loaded — injects code into Dock.app to unlock features macOS does not otherwise expose (notably, moving windows between Spaces, creating Spaces, and controlling Mission Control).

This deep-dive covers Yabai's architecture, the exact tradeoffs of the scripting addition, IPC via `yabai -m`, signal-driven automation, multi-monitor patterns, integration with [[hammerspoon-deep-dive|Hammerspoon]] and [[sketchybar-deep-dive|Sketchybar]], and the failure modes you'll hit in production (macOS updates, App Nap, SIP changes, Secure Input).

### What you will learn

- Yabai's process model and how it communicates with Dock.app
- The BSP tree: how windows are placed, split, and rebalanced
- Signals vs. rules — when to use which
- Writing robust `yabairc` and `skhdrc`
- Bridging to Hammerspoon and Sketchybar
- SIP, bputil, and Apple Silicon boot policy in 2026
- Performance: mouse-follows-focus, signals, query throughput
- Upgrading across macOS versions without breakage

## Prerequisites

- Completed [[yabai-beginner-guide]]
- Comfortable with `sudoers`, LaunchAgents, and plist editing
- Familiarity with macOS Recovery, `csrutil`, and `bputil`
- Basic shell scripting (bash or zsh)
- Helpful: Lua for [[hammerspoon-deep-dive|Hammerspoon]] interop; C-ish literacy for reading Yabai source
- A dotfiles workflow: [[dotfiles-deep-dive]] or [[chezmoi-deep-dive]]

## Key Concepts

### Architecture

```
┌───────────────────────────────────────────────┐
│  skhd / Hammerspoon  (event source)           │
├───────────────────────────────────────────────┤
│  yabai -m  (CLI, sends IPC messages)          │
├───────────────────────────────────────────────┤
│  yabai daemon                                 │
│   ├─ AXUIElement / CoreGraphics (read+write)  │
│   └─ Scripting addition → Dock.app (SIP-off)  │
├───────────────────────────────────────────────┤
│  macOS: WindowServer, Dock, Mission Control   │
└───────────────────────────────────────────────┘
```

Two components matter:

1. **The daemon** (`yabai` process) subscribes to AXNotification streams and maintains an in-memory tree of windows per Space.
2. **The scripting addition** (`yabai-sa.dylib` injected into Dock.app) exposes private function pointers that allow the daemon to manipulate Spaces, Stage Manager, and the Dock's internal state.

Without the scripting addition, Yabai's window-management operations are limited to what the Accessibility API permits — i.e., resizing, focusing, and moving windows **within a single Space on a single display**.

### BSP tree mechanics

Every Space with layout `bsp` owns a binary tree. Each internal node stores a split direction (horizontal or vertical) and a split ratio. Each leaf is a window.

Inserting a new window follows `window_placement`:

- `first_child` — new window is inserted above/left of the focused one
- `second_child` — new window is inserted below/right

The split direction on insertion is governed by `split_type`:

- `auto` — split perpendicular to the longer dimension
- `vertical` / `horizontal` — force a direction

Moving / resizing / swapping operates on this tree. The important mental model: **the tree is persistent per-Space** and survives window moves within the Space. Moving a window to another Space means rebuilding the destination tree.

### Rules vs. signals

| Aspect      | Rule                                    | Signal                                     |
| ----------- | --------------------------------------- | ------------------------------------------ |
| Trigger     | Matched at window creation / activation | Any Yabai event (`window_created`, `space_changed`, `display_added`, etc.) |
| Scope       | Per-app / per-title / per-role          | Global                                     |
| Action      | Set window properties (space, grid, float, sticky) | Run a shell command                  |
| Persistence | In `yabairc`                            | In `yabairc` (or added at runtime)         |

Rules are declarative and fast. Signals are imperative and flexible. Prefer rules when you can.

### macOS 26 / Apple Silicon context

On Apple Silicon boot policy is governed by `bputil`. The Yabai scripting addition loads into Dock.app via the legacy extension mechanism; macOS 26 preserves this compatibility, but you must:

- `csrutil disable --with kext --with dtrace --with nvram --with basesystem` in Recovery
- `bputil -nkca` (no kernel collection authentication) once booted
- Allow `yabai --load-sa` via sudoers

After every major macOS version bump you may need to reinstall the scripting addition. Do not assume it will survive.

## Step-by-Step Instructions

### 1. Hardened install

```bash
brew install koekeishiya/formulae/yabai
brew install koekeishiya/formulae/skhd

# Version-pin for reproducibility
echo "yabai 7.x" >> ~/.dotfiles/Brewfile
```

### 2. Scripting addition and sudoers

```bash
sudo yabai --install-sa
sudo yabai --load-sa

SHA=$(shasum -a 256 $(which yabai) | awk '{print $1}')
USER=$(whoami)
sudo tee /private/etc/sudoers.d/yabai >/dev/null <<EOF
${USER} ALL=(root) NOPASSWD: sha256:${SHA} $(which yabai) --load-sa
EOF
sudo chmod 440 /private/etc/sudoers.d/yabai
```

Every time `yabai` upgrades (brew), rerun the sha computation. Otherwise `--load-sa` will silently prompt for a password on the next login.

### 3. Robust `yabairc`

```bash
#!/usr/bin/env sh
set -eu

# Scripting addition
sudo yabai --load-sa 2>/dev/null || true

# ----- layout -----
yabai -m config layout                     bsp
yabai -m config split_type                 auto
yabai -m config window_placement           second_child
yabai -m config auto_balance               off
yabai -m config split_ratio                0.50

# ----- gaps / padding -----
yabai -m config top_padding                10
yabai -m config bottom_padding             10
yabai -m config left_padding               10
yabai -m config right_padding              10
yabai -m config window_gap                 08
yabai -m config external_bar               all:36:0   # leave room for Sketchybar

# ----- focus / mouse -----
yabai -m config focus_follows_mouse        autoraise
yabai -m config mouse_follows_focus        on
yabai -m config mouse_modifier             fn
yabai -m config mouse_action1              move
yabai -m config mouse_action2              resize
yabai -m config mouse_drop_action          swap

# ----- window decoration -----
yabai -m config window_shadow              float
yabai -m config window_opacity             off
yabai -m config window_animation_duration  0.15

# ----- rules -----
yabai -m rule --add app="^System Settings$"   manage=off
yabai -m rule --add app="^System Preferences$" manage=off
yabai -m rule --add app="^Calculator$"        manage=off layer=above
yabai -m rule --add app="^1Password$"         manage=off
yabai -m rule --add app="^Raycast$"           manage=off
yabai -m rule --add app="^Finder$" title="^(Copy|Move|Info|Preferences)$" manage=off
yabai -m rule --add app="^Slack$"             space=3
yabai -m rule --add app="^Obsidian$"          space=2

# ----- signals -----
yabai -m signal --add event=window_destroyed \
  action="yabai -m query --windows --window &> /dev/null || yabai -m space --balance"

yabai -m signal --add event=display_added    action="$HOME/.config/yabai/on-display.sh"
yabai -m signal --add event=display_removed  action="$HOME/.config/yabai/on-display.sh"

# ----- sketchybar feedback -----
yabai -m signal --add event=window_focused    action="sketchybar --trigger window_focus"
yabai -m signal --add event=space_changed     action="sketchybar --trigger space_change"
yabai -m signal --add event=display_changed   action="sketchybar --trigger display_change"

echo "yabai: config loaded"
```

### 4. Modular skhd

```
# ~/.config/skhd/skhdrc

# Reloads
ctrl + alt + cmd - r : yabai --restart-service && skhd --reload

# Focus (vim keys)
alt - h : yabai -m window --focus west  || yabai -m display --focus west
alt - j : yabai -m window --focus south || yabai -m display --focus south
alt - k : yabai -m window --focus north || yabai -m display --focus north
alt - l : yabai -m window --focus east  || yabai -m display --focus east

# Swap / warp
shift + alt - h : yabai -m window --swap west
shift + alt - j : yabai -m window --swap south
shift + alt - k : yabai -m window --swap north
shift + alt - l : yabai -m window --swap east

ctrl + shift + alt - h : yabai -m window --warp west
ctrl + shift + alt - j : yabai -m window --warp south
ctrl + shift + alt - k : yabai -m window --warp north
ctrl + shift + alt - l : yabai -m window --warp east

# Rotate tree / mirror axis
alt - r : yabai -m space --rotate 270
alt - y : yabai -m space --mirror y-axis
alt - x : yabai -m space --mirror x-axis

# Float + center
alt - t : yabai -m window --toggle float && \
          yabai -m window --grid 6:6:1:1:4:4

# Fullscreen
alt - f  : yabai -m window --toggle zoom-fullscreen
alt - m  : yabai -m window --toggle native-fullscreen

# Spaces
alt - 1 : yabai -m space --focus 1
alt - 2 : yabai -m space --focus 2
alt - 3 : yabai -m space --focus 3
alt - 4 : yabai -m space --focus 4

shift + alt - 1 : yabai -m window --space 1; yabai -m space --focus 1
shift + alt - 2 : yabai -m window --space 2; yabai -m space --focus 2
shift + alt - 3 : yabai -m window --space 3; yabai -m space --focus 3
shift + alt - 4 : yabai -m window --space 4; yabai -m space --focus 4

# Create / destroy space
ctrl + alt - n : yabai -m space --create
ctrl + alt - w : yabai -m space --destroy
```

### 5. Multi-display `on-display.sh`

```bash
#!/usr/bin/env bash
displays=$(yabai -m query --displays | jq length)

if [ "$displays" -ge 2 ]; then
  yabai -m config window_gap 10
  yabai -m space --layout bsp
else
  yabai -m config window_gap 6
  yabai -m space --layout bsp
fi

# Rebalance every space
for sp in $(yabai -m query --spaces | jq '.[].index'); do
  yabai -m space "$sp" --balance
done
```

### 6. IPC — `yabai -m query`

Everything Yabai knows is queryable as JSON.

```bash
yabai -m query --windows
yabai -m query --windows --window   # focused
yabai -m query --spaces --space
yabai -m query --displays
```

Example — count windows on current space:

```bash
yabai -m query --windows --space | jq length
```

Example — move the focused window to the largest other window:

```bash
target=$(yabai -m query --windows --space \
  | jq 'map(select(.["has-focus"] == false))
        | sort_by(.frame.w * .frame.h)
        | reverse[0].id')
yabai -m window --warp "$target"
```

## Practical Examples

### Example 1 — Space naming via Sketchybar

Sketchybar can show per-space labels. Yabai publishes changes; Sketchybar redraws.

```bash
# yabairc
yabai -m signal --add event=space_changed \
  action="sketchybar --trigger space_change SID=\$YABAI_SPACE_ID"
```

```bash
# sketchybar space item
sketchybar --add event space_change
sketchybar --add item space.current left \
           --set space.current update_freq=0 \
           --subscribe space.current space_change \
           --set space.current script="$CONFIG_DIR/plugins/space.sh"
```

See [[sketchybar-deep-dive]] for the companion setup.

### Example 2 — Stage Manager toggles

```bash
alt - 0 : yabai -m config window_placement first_child; \
          yabai -m space --layout float   # temporary floating
alt - p : yabai -m space --layout bsp
```

### Example 3 — Hammerspoon-driven focus persistence

```lua
-- Remember the focused app per Space, restore on switch
local memory = {}
local function remember()
  local space = hs.execute("yabai -m query --spaces --space | jq .index")
  memory[tonumber(space)] = hs.application.frontmostApplication():bundleID()
end

hs.timer.doEvery(2, remember)

hs.hotkey.bind({"alt"}, "tab", function()
  local space = hs.execute("yabai -m query --spaces --space | jq .index")
  local bid = memory[tonumber(space)]
  if bid then hs.application.launchOrFocusByBundleID(bid) end
end)
```

### Example 4 — App Nap workaround for Electron apps

Some Electron apps (Slack, Discord) halt event delivery when backgrounded, confusing Yabai's tree. Add:

```bash
yabai -m rule --add app="^Slack$"   app_nap=off
yabai -m rule --add app="^Discord$" app_nap=off
```

### Example 5 — Focus follows mouse only on external displays

```bash
yabai -m signal --add event=display_changed action='
  if [ $(yabai -m query --displays | jq length) -gt 1 ]; then
    yabai -m config focus_follows_mouse autoraise
  else
    yabai -m config focus_follows_mouse off
  fi
'
```

## Hands-On Exercises

1. **Diff rules.** Enumerate `yabai -m rule --list` before and after a reload, diff to confirm idempotence.
2. **Signal budget.** Add a signal with `sleep 0.5; echo` and measure whether window_focused events back up during rapid Cmd-Tab.
3. **External bar calibration.** Run Sketchybar at heights 28 / 36 / 44 and adjust `external_bar` until windows don't clip or leave a gap.
4. **SIP audit.** Write a shell script that checks `csrutil status`, verifies `yabai --check-sa`, and re-loads SA if needed.
5. **Crash recovery.** Kill `yabai` mid-session (`pkill yabai`). Confirm LaunchAgent restarts it within 2s. If not, write a `KeepAlive`.
6. **Benchmark queries.** Time 1,000 `yabai -m query --windows` calls. Is it worth caching?
7. **Macro.** Build a skhd chord that saves the current tree layout to JSON and restores it later via `yabai -m window --insert` commands.
8. **Hammerspoon bridge.** Port one of your skhd bindings to Hammerspoon. Discuss tradeoffs.

## Troubleshooting

**`error: could not locate window`.**
Yabai's AX notification stream missed a creation event. Restart: `yabai --restart-service`.

**Windows jitter when dragged.**
`mouse_follows_focus` and mouse-drop-action fighting. Set `mouse_follows_focus off` or switch `mouse_drop_action` to `stack`.

**Scripting addition silently unloads.**
Happens after sleep/wake on some machines. Add to `yabairc`:
```bash
yabai -m signal --add event=system_woke action="sudo yabai --load-sa"
```

**`Accessibility denied` after brew upgrade.**
The binary hash changed; TCC re-prompts. Approve again, then refresh the sudoers sha256.

**Stage Manager enabled — Yabai behaves oddly.**
Stage Manager reparents windows. Either disable Stage Manager or disable Yabai on that display: `yabai -m config --display X manage=off`.

**Secure Input blocks skhd.**
1Password or VS Code occasionally leaves Secure Input enabled, which blocks all global hotkeys. Check with:
```bash
ioreg -l -w 0 | grep SecureInput
```
Kill the offending app's auxiliary process; restart skhd.

**LaunchAgent fails on login.**
Permissions on `/opt/homebrew/bin/yabai` may be wrong after an OS upgrade. `brew reinstall yabai` fixes most cases.

**Yabai conflicts with Moom.**
Expected. Pick a per-Space strategy: Yabai for tiled Spaces, [[moom-deep-dive|Moom]] for floating Spaces. Do not run both against the same window.

**macOS 26.x patch broke SA.**
Classic. Reinstall: `sudo yabai --uninstall-sa; sudo yabai --install-sa; sudo yabai --load-sa`. If unrecoverable, fall back to SIP-on mode and degrade features until the next Yabai release.

## Performance notes

- `yabai -m query` spawns a new process — fine for occasional use, **not** fine in a tight signal loop. Debounce with `sleep` or use Hammerspoon to batch.
- Signals execute synchronously from Yabai's main loop. Keep them under ~10 ms. Fork long tasks to background with `&`.
- `window_animation_duration > 0.2` feels laggy on Apple Silicon. Default 0.15 is the sweet spot.
- A Space with more than ~20 windows will show noticeable BSP insertion lag. Split into separate Spaces.

## References

- Yabai repo — https://github.com/asmvik/yabai
- Wiki — https://github.com/asmvik/yabai/wiki
- Commands reference — https://github.com/asmvik/yabai/wiki/Commands
- Signals — https://github.com/asmvik/yabai/wiki/Commands#signal
- Disabling SIP — https://github.com/asmvik/yabai/wiki/Disabling-System-Integrity-Protection
- skhd — https://github.com/asmvik/skhd
- Sketchybar — https://felixkratz.github.io/SketchyBar/
- Hammerspoon API — https://www.hammerspoon.org/docs/
- Apple bputil — `man bputil`

## Related Tutorials

- [[yabai-beginner-guide]] — install and first configuration
- [[sketchybar-beginner-guide|Sketchybar Beginner Guide]] — status bar complementing Yabai
- [[sketchybar-deep-dive]] — Yabai ↔ Sketchybar signal integration
- [[hammerspoon-beginner-guide|Hammerspoon Beginner Guide]]
- [[hammerspoon-deep-dive]] — drive Yabai via shell from Lua
- [[moom-beginner-guide|Moom Beginner Guide]]
- [[moom-deep-dive]] — the snap-style alternative, coexistence patterns
- [[macos-app-layout-beginner-guide]]
- [[macos-app-layout-deep-dive]] — Yabai in context of the macOS automation stack
- [[dotfiles-deep-dive]] — versioning `~/.config/yabai` and `~/.config/skhd`
- [[chezmoi-deep-dive]] — templated configs per machine
- [[linux-permissions-beginner-guide]] — conceptual bridge to TCC / Accessibility
- [[karabiner-elements-beginner-guide|Karabiner-Elements Beginner Guide]] — home row mods and Hyper key for Yabai bindings
- [[karabiner-elements-deep-dive|Karabiner-Elements Deep Dive]] — conditions, variables, and app-specific rules that complement skhd

## Summary

Yabai is the most powerful window manager on macOS, period. That power costs you: a partial SIP disable, a yearly dance with the scripting addition after macOS upgrades, and a willingness to treat window management as a system to be configured rather than a set of features to be toggled.

**Key takeaways:**

- The BSP tree is per-Space and persistent; treat it as a data structure
- Prefer rules to signals; prefer signals to out-of-band polling
- External IPC (`yabai -m query`) is your escape hatch for anything the config language doesn't cover
- Pair with [[sketchybar-deep-dive|Sketchybar]] for visibility and [[hammerspoon-deep-dive|Hammerspoon]] for logic
- Reserve one day per macOS major upgrade to repair the scripting addition

**Next steps:** lock down your `yabairc` under version control, wire Sketchybar signals for visible feedback, and build a pre-upgrade checklist for macOS major releases so SA repair is a 5-minute task instead of a day.
