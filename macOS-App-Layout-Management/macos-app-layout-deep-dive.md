---
title: macOS App Layout Management — Deep Dive
date: 2026-04-14
difficulty: advanced
tags: [macos, window-management, layoutish, moom, bunch, applescript, spaces, displays, accessibility, automation]
---

# macOS App Layout Management: Deep Dive

## Overview

This reference goes beyond "install and save a layout" and examines **how** macOS window management actually works, **why** every third-party tool hits the same walls, and **how** to build a robust, scriptable, multi-display, multi-Space workflow around **Layoutish** and **Moom + Bunch**.

The target reader already knows the basics (see [[macos-app-layout-beginner-guide]]) and wants to understand the internals, the edge cases, and how to glue these tools together with the rest of a power-user's macOS setup (Shortcuts, AppleScript, Hammerspoon, Dock assignments, `defaults`, and launchd).

### What you will learn

- The macOS window-management architecture: WindowServer, Dock, Spaces, and the Accessibility API
- Why no third-party tool can reliably move windows across inactive Spaces
- How Layoutish models layouts and triggers them on display-change events
- How Moom snapshots work under the hood and how to drive them with AppleScript/JXA
- How to write non-trivial Bunch files, including conditional logic and external triggers
- How to combine these tools with Shortcuts.app, Hammerspoon, and launchd for full automation
- Performance, reliability, and failure-mode considerations

## Prerequisites

- Comfortable with the contents of [[macos-app-layout-beginner-guide]]
- Familiarity with the macOS shell (`zsh`/`bash`), `osascript`, and `defaults`
- Optional: some AppleScript or JXA (JavaScript for Automation) experience
- Optional: Hammerspoon or `skhd` installed if you want to extend beyond Moom + Bunch
- Administrator access and an understanding of what **Accessibility**, **Automation**, and **Screen Recording** permissions do

## Key Concepts

### The macOS window-management stack

```
┌──────────────────────────────────────────────────┐
│  Your window manager  (Layoutish / Moom / Yabai) │
├──────────────────────────────────────────────────┤
│      Accessibility API (AXUIElement)             │
├──────────────────────────────────────────────────┤
│  Dock (Spaces + Mission Control + Exposé)        │
├──────────────────────────────────────────────────┤
│  WindowServer (compositor, display topology)     │
├──────────────────────────────────────────────────┤
│  SkyLight / CoreGraphics private frameworks      │
└──────────────────────────────────────────────────┘
```

Third-party tools live at the top, reaching down through the **Accessibility API** to read and move windows. The Accessibility API only exposes windows on the **currently active Space** for each display. Spaces themselves are managed by the Dock and WindowServer, and Apple does not ship a public API to enumerate, create, or move windows between Spaces.

This is the root cause of "the Spaces problem" — every tool from Moom to Yabai to Rectangle Pro to Layoutish is subject to it.

### App-to-Space assignment

The only reliable, Apple-supported way to put an app on a specific Space is the Dock's **Assign To → This Desktop / All Desktops / None** setting. This writes to the Dock's preferences and is applied by WindowServer the next time the app's window is created. It survives reboots and display changes and is the cornerstone of any robust multi-Space setup.

You can inspect the assignments with:

```bash
defaults read com.apple.dock persistent-apps | grep -E 'bundle-identifier|workspaces' | head
```

### Display configurations

macOS identifies a display by its **display ID** (a `uint32` derived from vendor, product, serial, and connection). A "configuration" is the tuple of all currently connected displays. Tools that auto-detect dock/undock compare configurations by hashing this tuple.

When you plug or unplug a display, macOS emits a `kCGDisplayReconfigurationCallback` event. Layoutish listens for it via the `CGDisplayRegisterReconfigurationCallback` API. Moom does too, but exposes it differently — it has no "auto-apply" UI; you trigger snapshots manually or via AppleScript.

### Accessibility, Automation, and Screen Recording permissions

- **Accessibility** — required to read/move windows. Without it, every layout tool is a no-op.
- **Automation** — required for cross-app AppleScript (e.g., Bunch → Moom). Prompts appear per target app the first time a script tries to control it.
- **Screen Recording** — not required for layout tools, but some utilities (e.g., window previews) need it.

Permissions are stored in the system's TCC database. If they get wedged, the nuclear reset is:

```bash
tccutil reset Accessibility
tccutil reset AppleEvents
```

Then re-grant from **System Settings → Privacy & Security**.

## Step-by-Step Instructions

### 1. Build a bulletproof Dock assignment map

Before any layout tool, lock down which Space each app lives on:

```text
Space 1  →  VS Code, iTerm
Space 2  →  Safari (web research)
Space 3  →  Slack, Messages, Mail
Space 4  →  Notion, Obsidian
Space 5  →  Figma, Linear
Space 6  →  Music, reading
Space 7  →  Scratch
Space 8  →  Monitoring (Grafana, kubectl shell)
```

For each app, right-click its Dock icon → **Options → Assign To → This Desktop** while you're on the intended Space. Then add each app to **System Settings → General → Login Items** so a fresh boot re-creates the Space layout.

### 2. Configure Layoutish for multi-config auto-switching

Layoutish stores layouts in `~/Library/Application Support/Layoutish/layouts.json`. Each layout entry contains:

- a `displayFingerprint` (hash of display IDs + resolutions)
- per-app window frames (`{x, y, w, h, displayIndex}`)
- a `triggerMode` (`manual` or `auto`)

To audit the store:

```bash
cat ~/Library/Application\ Support/Layoutish/layouts.json | jq '.layouts[] | {name, displayFingerprint, triggerMode}'
```

Expected output:

```json
{ "name": "Laptop Only",    "displayFingerprint": "a1b2c3", "triggerMode": "auto" }
{ "name": "Docked 27\" 4K", "displayFingerprint": "d4e5f6", "triggerMode": "auto" }
```

If two layouts share a fingerprint, the second one wins on auto-apply — so **do not save two layouts against the same display config** unless one is manual.

### 3. Script Moom with AppleScript and JXA

Moom exposes a scripting dictionary. Inspect it with **Script Editor → File → Open Dictionary → Moom**.

AppleScript — arrange by name:

```applescript
tell application "Moom"
    arrange windows according to snapshot "Docked"
end tell
```

JXA — same thing:

```javascript
const Moom = Application('Moom');
Moom.arrangeWindowsAccordingToSnapshot('Docked');
```

Programmatic snapshot creation is **not** exposed; you must create snapshots through Moom's UI. But you *can* enumerate them:

```applescript
tell application "Moom"
    get name of every snapshot
end tell
```

Expected output:

```text
{"Laptop solo", "Docked 27\" 4K", "Docked Dual 27\"", "Focus"}
```

### 4. Write non-trivial Bunch files

Bunch is a line-oriented DSL. Useful primitives:

```text
# Comments begin with '#'
Safari
Mail
Slack

# Open a URL in the default browser
https://linear.app

# Open a file
~/Documents/planning.md

# Run a shell command and wait
(run)osascript -e 'tell application "Moom" to arrange windows according to snapshot "Docked"'

# Sleep
(sleep 2)

# Conditional: only run if an app isn't already open
?Discord

# Trigger another Bunch
(bunch)~/Bunches/Focus.bunch
```

Advanced pattern — one Bunch per display configuration, dispatched by a parent:

```text
# Root.bunch
(run)osascript -e 'tell application "System Events" to set displayCount to count of desktops'
# (…use the result via a shell script to decide which child bunch to run…)
```

In practice, it's simpler to skip the conditional dispatch inside Bunch and do it in a shell script that Shortcuts.app calls.

### 5. Glue everything with Shortcuts.app

Shortcuts.app gained a **When display connected** trigger in macOS 14. Create a shortcut:

- Trigger: **When display connected** → pick your external display.
- Action 1: **Run Shell Script** →
  ```bash
  open -b com.brettterpstra.Bunch "$HOME/Bunches/Docked.bunch"
  ```
- Action 2: **Run AppleScript** (optional fallback) →
  ```applescript
  tell application "Moom" to arrange windows according to snapshot "Docked"
  ```

Create a second shortcut for **When display disconnected** that calls `Laptop.bunch`.

### 6. launchd for scheduled re-arrangement

If you want your layout re-applied every weekday morning at 9am (e.g., to recover from overnight Slack updates that reposition windows), drop this into `~/Library/LaunchAgents/com.alan.morninglayout.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.alan.morninglayout</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/osascript</string>
    <string>-e</string>
    <string>tell application "Moom" to arrange windows according to snapshot "Docked"</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
    <dict><key>Weekday</key><integer>2</integer><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
    <dict><key>Weekday</key><integer>3</integer><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
    <dict><key>Weekday</key><integer>4</integer><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
    <dict><key>Weekday</key><integer>5</integer><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
  </array>
</dict>
</plist>
```

Load it with:

```bash
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.alan.morninglayout.plist
```

## Practical Examples

### Example 1 — A complete Layoutish + Dock-assignment workflow

Goal: 8 Spaces, two display configurations, zero manual intervention on dock/undock.

1. Assign every app to its Space via the Dock (see step 1).
2. Boot the Mac, let login items open all apps; each lands on its assigned Space.
3. Press `F3` (Mission Control) to audit — every app should be on its expected Space.
4. Save a `Laptop Only` layout in Layoutish.
5. Dock, wait for apps to redistribute, resize/reposition as desired, save `Docked` in Layoutish.
6. Enable auto-apply. Done.

Result: docking triggers sizing, Dock assignments keep Spaces intact, and you never touch Mission Control.

### Example 2 — A Moom + Bunch + Shortcuts pipeline

```text
# ~/Bunches/Docked.bunch
?Slack
?Mail
?Safari
?VS Code
(sleep 2)
(run)osascript -e 'tell application "Moom" to arrange windows according to snapshot "Docked"'
(run)osascript -e 'tell application "System Events" to key code 18 using {control down}'   # jump to Space 1
```

Pair with a Shortcut triggered by **When display connected → LG 27UP850**.

### Example 3 — Hammerspoon as an escape hatch

Layoutish and Moom can't do everything. Hammerspoon (Lua-scriptable macOS automation) can fill gaps like "move window to the next Space" (subject to the same Spaces caveats):

```lua
-- ~/.hammerspoon/init.lua
hs.hotkey.bind({"ctrl", "alt", "cmd"}, "D", function()
  hs.execute("osascript -e 'tell application \"Moom\" to arrange windows according to snapshot \"Docked\"'")
end)

hs.screen.watcher.new(function()
  local count = #hs.screen.allScreens()
  local snap  = (count > 1) and "Docked" or "Laptop solo"
  hs.execute("osascript -e 'tell application \"Moom\" to arrange windows according to snapshot \"" .. snap .. "\"'")
end):start()
```

This replicates Layoutish's auto-apply without buying Layoutish — at the cost of maintaining Lua.

## Hands-On Exercises

1. **Audit your Dock Space assignments.** Run `defaults read com.apple.dock persistent-apps` and identify which apps already have an assigned Space. Fill in the gaps.
2. **Inspect Layoutish's JSON store.** Open the file, identify the display fingerprints, then plug/unplug displays and watch the fingerprint change.
3. **Enumerate every Moom snapshot** via AppleScript. Bonus: write a shell alias `moom-list` that prints them.
4. **Write a Bunch file** that opens three apps, pauses, and triggers a Moom snapshot — but only if a specific display is connected. Use a `(run)` shell script to gate the trigger.
5. **Replace Layoutish with Hammerspoon** for display detection only. Measure latency (time from plug-in to layout applied) against Layoutish.
6. **Set up the launchd agent** from step 6 but schedule it for 5 minutes from now to verify it actually fires. Then re-schedule to weekdays-9am.
7. **Break Accessibility on purpose** (remove Moom from the Accessibility list). Run an AppleScript and observe the exact error message. This is the error you'll see any time a coworker has wedged permissions.

## Troubleshooting

**`execution error: Moom got an error: Application isn't running. (-600)`**
Moom must be running before you send it AppleScript. Add `open -b com.manytricks.Moom` and `sleep 1` before the `osascript` call, or add Moom to Login Items.

**Layout applies but windows end up half off-screen.**
The saved frame references a resolution that no longer exists (display was rotated, scaled, or swapped). Delete the layout and re-save it under the current configuration. In Layoutish, **Update Layout** is non-destructive only if the display fingerprint matches.

**Auto-apply runs too early — apps haven't finished launching.**
Add `(sleep N)` in Bunch before `(run)`, or increase Layoutish's debounce in **Settings → Advanced → Apply delay**.

**Windows on Space 5 never get moved.**
macOS does not expose windows on inactive Spaces to the Accessibility API. Rely on Dock → Assign To instead; layout tools can only resize within a Space.

**Login Items ignore Space assignments on first boot.**
The Dock writes app-to-Space mappings to `com.apple.spaces.plist`. A fresh boot can race the Dock. Work around it by logging in, running `killall Dock`, and using a launchd agent that fires one `open` per app after Dock relaunches.

**TCC prompts keep reappearing after macOS updates.**
After major macOS updates, TCC sometimes loses the Automation grant between Bunch → Moom. Open Script Editor, run the AppleScript once manually to re-trigger the prompt, approve, and the grant will persist.

**Hammerspoon and Moom fight each other.**
Disable Moom's own hotkeys if you drive it from Hammerspoon to prevent double-trigger loops.

**`launchctl bootstrap` fails with `Bootstrap failed: 5: Input/output error`.**
The plist is malformed or already loaded. Run `launchctl bootout gui/$UID/com.alan.morninglayout` first, then bootstrap again.

## Architecture / Design Rationale

### Why three tools instead of one?

- **Dock assignments** are Apple-supported, survive reboots, and solve the Spaces problem.
- **Layoutish or Moom** solve the **sizing and positioning** problem on the active Space.
- **Bunch (or Shortcuts, or launchd)** solves the **orchestration** problem — launching apps, sequencing waits, and reacting to events.

Each tool does one thing well. Trying to replace all three with a single "window manager" (Yabai, Rectangle Pro, Amethyst) typically results in either fighting macOS's Spaces model or disabling SIP — neither of which is worth it for most users.

### When to disable SIP for Yabai

Yabai's fully tiled mode requires disabling System Integrity Protection so it can inject into Dock.app. Unless you need true tiling window management (i3-style), **don't**. The Layoutish/Moom approach gets you 90% of the benefit with 0% of the SIP tradeoff.

### Performance

- Layoutish applies a full layout in ~150–400 ms on Apple Silicon.
- Moom applies a snapshot in ~50–200 ms.
- Bunch startup latency is dominated by app launch time (seconds), not the DSL itself.

The slowest step is almost always macOS reflowing apps after a display change, which can take 1–3 seconds before any third-party tool sees the new configuration. This is why `(sleep 2)` is a good default.

## References

- Apple Developer: Accessibility API — https://developer.apple.com/documentation/applicationservices/accessibility_api
- Apple Developer: Quartz Display Services — https://developer.apple.com/documentation/coregraphics/quartz_display_services
- Layoutish documentation — https://layoutish.app/docs
- Moom scripting dictionary — https://manytricks.com/osd/moom/
- Bunch documentation — https://bunchapp.co/docs
- Hammerspoon API — https://www.hammerspoon.org/docs/
- Yabai (for contrast) — https://github.com/koekeishiya/yabai
- Brett Terpstra's Bunch articles — https://brettterpstra.com/projects/bunch/
- launchd tutorial — https://www.launchd.info

## Related Tutorials

- [[macos-app-layout-beginner-guide]] — Start here if you're new to window layout management on macOS
- [[bunch-beginner-guide|Bunch Beginner Guide]] — Generic Bunch tutorial (outside the layout-management context)
- [[bunch-deep-dive|Bunch Deep Dive]] — Bunch internals, snippets, frontmatter, and composition
- [[moom-beginner-guide|Moom Beginner Guide]] — Generic Moom tutorial
- [[moom-deep-dive|Moom Deep Dive]] — Moom scripting, display fingerprints, and integration patterns
- [[dotfiles-deep-dive]] — Versioning `.bunch` files and Moom exports
- [[dotfiles-beginner-guide]] — Initial dotfile organization
- [[chezmoi-deep-dive]] — Cross-Mac configuration sync (including Bunch files)
- [[chezmoi-beginner-guide]] — Chezmoi fundamentals
- [[sesh-deep-dive]] — Terminal session management for the editor Space
- [[sesh-beginner-guide]] — Sesh fundamentals
- [[television-deep-dive]] — Fast terminal UI picker
- [[kubernetes-macos-docker-desktop-tutorial]] — macOS-specific dev setup tips
- [[karabiner-elements-beginner-guide|Karabiner-Elements Beginner Guide]] — build Hyper/Meh layers for layout-switching shortcuts
- [[karabiner-elements-deep-dive|Karabiner-Elements Deep Dive]] — app-specific rules and shell_command integration for layout automation

## Summary

- macOS's window model is **WindowServer + Dock + Accessibility API**; no third-party tool can bypass the Spaces restriction.
- **Dock → Assign To** is the only reliable Space-assignment primitive. Build on it.
- **Layoutish** is the simplest auto-apply-on-display-change tool, backed by a readable JSON store.
- **Moom** gives you hotkey- and script-driven layouts; **Bunch** orchestrates app launches and triggers Moom.
- **Shortcuts.app**, **Hammerspoon**, and **launchd** fill every remaining automation gap.
- Disabling SIP for a tiling window manager is rarely worth it — Layoutish + Moom covers 90% of the use cases.

**Next steps:** pick the stack that matches your tolerance for scripting (Layoutish-only, or Moom + Bunch + Shortcuts), commit your `.bunch` files and Moom exports to your dotfiles repo (see [[chezmoi-deep-dive]]), and revisit the Hands-On Exercises whenever you change display hardware.
# Related Tutorials

- [[hammerspoon-beginner-guide]] — Hammerspoon starter guide
- [[hammerspoon-deep-dive]] — Hammerspoon internals and advanced patterns
- [[yabai-beginner-guide]] — Yabai tiling window manager
- [[yabai-deep-dive]] — Yabai internals, signals, SIP considerations
- [[sketchybar-beginner-guide]] — Sketchybar status bar
- [[sketchybar-deep-dive]] — Sketchybar internals and Yabai integration
