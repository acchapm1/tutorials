---
title: Yabai — Beginner's Guide
date: 2026-04-15
difficulty: beginner
tags: [macos, yabai, tiling, window-management, skhd, sip, productivity]
---

# Yabai — Beginner's Guide

## Overview

Yabai is a tiling window manager for macOS. Unlike [[moom-beginner-guide|Moom]] or Rectangle, which *snap* floating windows, Yabai *tiles* them automatically: every window you open takes a deterministic slot in a binary-space-partitioned grid. If you've used i3, bspwm, or Sway on Linux, Yabai's mental model will feel familiar.

Yabai is powerful but opinionated. Full tiling requires disabling **System Integrity Protection** (SIP) partially so Yabai can inject into Dock.app. If you don't want to disable SIP, you get a more limited "basic" mode that still supports automatic layouts for most apps.

This guide walks through installation on **macOS 26 (Tahoe)**, basic configuration, and pairing Yabai with **skhd** for keyboard bindings. By the end you'll have a working tiled workspace with keybindings to move, focus, swap, and resize windows.

## Prerequisites

- macOS 26 (Tahoe) on Apple Silicon (or Intel — still supported)
- Administrator password
- [Homebrew](https://brew.sh) installed
- Comfort in the terminal (`zsh` or `bash`)
- A backup or Time Machine snapshot (we're touching SIP)
- Decision: are you willing to disable SIP partially? (Recommended for the real Yabai experience.)

Optional but highly recommended:

- [[hammerspoon-beginner-guide|Hammerspoon]] for event-driven logic
- [[sketchybar-beginner-guide|Sketchybar]] for a status bar that displays Yabai state
- [[dotfiles-beginner-guide|Dotfiles]] workflow for your `.yabairc` and `.skhdrc`

> Note: The upstream repository moved from `koekeishiya/yabai` to `asmvik/yabai`. The `brew` tap handles this transparently.

## Key Concepts

**Binary-space-partitioning (BSP).** Yabai's default layout. Each new window splits the currently focused window either horizontally or vertically, producing a nested rectangle tree.

**Spaces.** macOS's native concept of desktop tabs. Yabai respects Spaces but can't programmatically move windows between them without the scripting addition enabled (see SIP below).

**Signals.** Yabai fires shell commands when window events happen (created, destroyed, focused, moved). This is how you automate behavior — for example, move Slack to Space 4 when launched.

**Rules.** Static assignments by app name, title, or role. "Firefox always opens floating" is a rule.

**Scripting Addition (sa).** An optional in-process code injection into Dock.app that unlocks features like moving windows between Spaces and controlling mission-control. **This requires disabling SIP partially.**

**skhd.** Simple Hotkey Daemon. Not part of Yabai itself, but the canonical keyboard front-end. Yabai uses IPC; skhd maps key chords to `yabai -m ...` calls.

## Step-by-Step Instructions

### 1. (Optional) Disable SIP partially

Full Yabai features need SIP weakened. Skip this step if you want basic mode only.

1. Reboot into macOS Recovery: shut down, then hold the Power button until you see "Loading startup options."
2. Select **Options → Continue**.
3. Open **Utilities → Terminal**.
4. Run:
   ```bash
   csrutil disable --with kext --with dtrace --with nvram --with basesystem
   ```
5. For Apple Silicon, also reduce boot security:
   ```bash
   /usr/sbin/bputil -nkca
   ```
6. Reboot back into macOS.
7. Verify:
   ```bash
   csrutil status
   ```
   Expected output:
   ```
   System Integrity Protection status: unknown (Custom Configuration).
   ```

### 2. Install Yabai and skhd

```bash
brew install koekeishiya/formulae/yabai
brew install koekeishiya/formulae/skhd
```

*(The formula names still reference the original author — this is expected.)*

### 3. Install the scripting addition (only if you disabled SIP)

```bash
sudo yabai --install-sa
sudo yabai --load-sa
```

Add a `sudoers` stanza so Yabai can load-sa on startup without a password prompt:

```bash
sudo visudo -f /private/etc/sudoers.d/yabai
```

Paste (replace `<USER>` with your username and `<SHASUM>` with the value from `shasum -a 256 $(which yabai)`):

```
<USER> ALL=(root) NOPASSWD: sha256:<SHASUM> /opt/homebrew/bin/yabai --load-sa
```

### 4. Create `~/.config/yabai/yabairc`

```bash
mkdir -p ~/.config/yabai
touch ~/.config/yabai/yabairc
chmod +x ~/.config/yabai/yabairc
```

A minimal starter config:

```bash
#!/usr/bin/env sh

# Only run --load-sa if SIP was disabled
sudo yabai --load-sa 2>/dev/null

# Global settings
yabai -m config layout                      bsp
yabai -m config window_placement            second_child
yabai -m config split_ratio                 0.50
yabai -m config auto_balance                off
yabai -m config mouse_modifier              fn
yabai -m config mouse_action1               move
yabai -m config mouse_action2               resize
yabai -m config mouse_drop_action           swap

# Padding / gaps
yabai -m config top_padding                 12
yabai -m config bottom_padding              12
yabai -m config left_padding                12
yabai -m config right_padding               12
yabai -m config window_gap                  08

# Apps that refuse to tile
yabai -m rule --add app="^System Settings$" manage=off
yabai -m rule --add app="^Calculator$"      manage=off
yabai -m rule --add app="^Finder$" title="^Info$" manage=off
yabai -m rule --add app="^Raycast$"          manage=off

echo "yabai configuration loaded.."
```

### 5. Create `~/.config/skhd/skhdrc`

```bash
mkdir -p ~/.config/skhd
touch ~/.config/skhd/skhdrc
```

```
# Focus
alt - h : yabai -m window --focus west
alt - j : yabai -m window --focus south
alt - k : yabai -m window --focus north
alt - l : yabai -m window --focus east

# Swap
shift + alt - h : yabai -m window --swap west
shift + alt - j : yabai -m window --swap south
shift + alt - k : yabai -m window --swap north
shift + alt - l : yabai -m window --swap east

# Resize
ctrl + alt - h : yabai -m window --resize left:-40:0 || yabai -m window --resize right:-40:0
ctrl + alt - l : yabai -m window --resize left:40:0  || yabai -m window --resize right:40:0

# Toggle float
alt - t : yabai -m window --toggle float --grid 4:4:1:1:2:2

# Balance tree
alt - b : yabai -m space --balance

# Send to space
shift + alt - 1 : yabai -m window --space 1
shift + alt - 2 : yabai -m window --space 2
shift + alt - 3 : yabai -m window --space 3

# Focus space
alt - 1 : yabai -m space --focus 1
alt - 2 : yabai -m space --focus 2
alt - 3 : yabai -m space --focus 3

# Restart Yabai
ctrl + alt + cmd - r : yabai --restart-service
```

### 6. Start the services

```bash
yabai --start-service
skhd --start-service
```

Expected output: no errors. Check status:

```bash
brew services list | grep -E 'yabai|skhd'
```

You should see both as `started`.

### 7. Grant permissions

Yabai will prompt for **Accessibility** permission. Approve it in:

```
System Settings → Privacy & Security → Accessibility → Yabai
```

Then restart Yabai:

```bash
yabai --restart-service
```

Open two or three apps. They should automatically tile.

## Practical Examples

### Example 1 — Dedicate Space 3 to Slack

Add a rule to `yabairc`:

```bash
yabai -m rule --add app="^Slack$" space=3
```

When Slack launches, it always appears on Space 3.

### Example 2 — Float specific Finder windows

```bash
yabai -m rule --add app="^Finder$" title="(Copy|Move|Info)" manage=off
```

Copy / Move / Info dialogs float; the main Finder window still tiles.

### Example 3 — Auto-balance when a window closes

Append to `yabairc`:

```bash
yabai -m signal --add event=window_destroyed action="yabai -m space --balance"
```

### Example 4 — Hammerspoon bridge

From [[hammerspoon-beginner-guide|Hammerspoon]]:

```lua
hs.hotkey.bind({"cmd","alt","ctrl"}, "Return", function()
  hs.execute("/opt/homebrew/bin/yabai -m window --toggle zoom-fullscreen")
end)
```

### Example 5 — Stack mode for cluttered workflows

```
alt - s : yabai -m space --layout stack
alt - e : yabai -m space --layout bsp
```

Stack layout turns a space into a tabbed single-pane view, handy for browsers.

## Hands-On Exercises

1. **First tiles.** Open Ghostty, Safari, and Finder. Confirm they each take 1/3 of the screen. Swap their positions with `⇧⌥ H/L`.
2. **Float a calculator.** Verify the Calculator rule floats rather than tiles.
3. **Spaces.** Move Slack to Space 3 with `⇧⌥ 3`. Focus back with `⌥ 3`.
4. **Gap tuning.** Change `window_gap` from 8 to 16 and reload (`yabai --restart-service`). Do you prefer it?
5. **Rule for your IDE.** Add a rule pinning your IDE to Space 1. Kill and relaunch to verify.
6. **Signal.** Write a signal that runs `osascript -e 'display notification "tiled"'` when a new window is created.
7. **Sketchybar integration.** If you have [[sketchybar-beginner-guide|Sketchybar]] installed, add a Yabai signal that updates a Sketchybar item showing the current Space index.

## Troubleshooting

**`Yabai could not load the scripting addition`.**
SIP is still fully enabled, or you forgot `sudo yabai --load-sa`. Double-check `csrutil status`.

**Windows don't tile after reboot.**
Yabai service may have failed to start before Dock was ready. Try:
```bash
yabai --restart-service
```
If that works, add `defaults write com.apple.dock autohide -bool false` or delay Yabai start via a LaunchAgent with `KeepAlive`.

**skhd hotkeys stop working.**
Input Monitoring permission may have been revoked after an update. Check System Settings → Privacy & Security → Input Monitoring → skhd.

**`Accessibility is not enabled`.**
Remove and re-add Yabai in the Accessibility list; toggling alone sometimes doesn't stick.

**App won't tile no matter what.**
Some apps (System Settings, 1Password mini, menu-bar apps) set `non-resizable` on their windows. Add `manage=off` rules and move on.

**Yabai crashes after macOS update.**
Reinstall the scripting addition: `sudo yabai --uninstall-sa && sudo yabai --install-sa && sudo yabai --load-sa`.

**You use [[moom-beginner-guide|Moom]] and now they fight.**
Running Yabai plus Moom on the same windows is a recipe for visual jitter. Pick one per Space, or use Moom for floating apps and let Yabai manage tiled Spaces only.

## References

- Yabai GitHub — https://github.com/asmvik/yabai
- Wiki / install — https://github.com/asmvik/yabai/wiki/Installing-yabai-(latest-release)
- skhd — https://github.com/asmvik/skhd
- Disabling SIP — https://github.com/asmvik/yabai/wiki/Disabling-System-Integrity-Protection
- Configuration reference — https://github.com/asmvik/yabai/wiki/Commands

## Related Tutorials

- [[yabai-deep-dive]] — IPC, signals internals, multi-monitor strategies
- [[sketchybar-beginner-guide|Sketchybar Beginner Guide]] — status bar that pairs with Yabai
- [[sketchybar-deep-dive]]
- [[hammerspoon-beginner-guide|Hammerspoon Beginner Guide]] — trigger Yabai commands from Lua
- [[hammerspoon-deep-dive]]
- [[moom-beginner-guide|Moom Beginner Guide]] — snap-style alternative; can coexist with Yabai
- [[macos-app-layout-beginner-guide]] — where Yabai fits among Moom, Bunch, Shortcuts
- [[macos-app-layout-deep-dive]] — SIP caveats, Spaces API limits
- [[dotfiles-beginner-guide]] — version `yabairc` and `skhdrc`
- [[chezmoi-beginner-guide]] — templated configs per machine
- [[linux-permissions-beginner-guide]] — permission model parallels
- [[karabiner-elements-beginner-guide|Karabiner-Elements Beginner Guide]] — remap keys to drive Yabai shortcuts from home row mods and Hyper key
- [[karabiner-elements-deep-dive|Karabiner-Elements Deep Dive]] — app-specific rules and per-device keyboard layouts for Yabai workflows

## Summary

Yabai gives you deterministic, keyboard-driven tiling on macOS. It's the most powerful window manager on the platform, at the cost of partially disabling SIP and accepting that some macOS updates will break the scripting addition briefly.

**Key takeaways:**

- BSP layout handles geometry; you handle policy via rules and signals
- skhd is your keyboard front-end; Yabai handles window state
- SIP-off unlocks Spaces control; SIP-on still gives you 80% of the value
- Pair with [[hammerspoon-beginner-guide|Hammerspoon]] for logic and [[sketchybar-beginner-guide|Sketchybar]] for visibility
- Expect a day of tinkering before it feels natural; then it disappears into muscle memory

**Next steps:** work through the hands-on exercises, then read [[yabai-deep-dive]] for IPC internals, advanced signals, and performance tuning.
