---
title: Moom — Beginner's Guide
date: 2026-04-14
difficulty: beginner
tags: [macos, moom, window-management, productivity, layouts, hotkeys, applescript]
---

# Moom — Beginner's Guide

## Overview

**Moom** is a macOS window manager by Many Tricks. It lets you resize, reposition, and arrange windows into saved layouts using a tiny floating palette, keyboard shortcuts, or saved **snapshots**. It's the most widely used "real" window manager on the Mac that doesn't require disabling System Integrity Protection, and it pairs beautifully with text-driven orchestrators like [[bunch-beginner-guide|Bunch]].

If you've ever wanted to press a hotkey and instantly send a window to the right half, or plug in your external monitor and have all your apps snap back to their "docked" positions, Moom is the shortest path there. It costs about `$10` on manytricks.com or the Mac App Store.

This guide teaches you to install Moom, use the palette, define custom layouts and snapshots, bind hotkeys, and script it from AppleScript. By the end you'll have three saved layouts and at least two hotkeys you'll use every day.

## Prerequisites

- A Mac running macOS 11 (Big Sur) or later (check Moom's current minimum at [manytricks.com/moom](https://manytricks.com/moom/))
- Admin rights to install an app and grant **Accessibility** permission
- About `$10` for a license (Moom runs in free trial mode with periodic nags)
- No scripting experience required — but we'll touch AppleScript in one optional section

## Key Concepts

Six terms cover 95% of Moom:

- **Palette** — the little floating panel that pops up when you hover the green zoom button on any window. Click a tile to resize/move.
- **Grid** — a configurable grid (default 6×3) on which palette moves snap.
- **Custom layout** — a named rule like "left half," "center two-thirds," or "top-right quarter" that you can assign a hotkey or palette tile.
- **Arrangement of windows (snapshot)** — a saved configuration of *many* windows across *many* apps — the full desktop state — that you can re-arrange-to with one click or AppleScript call.
- **Trigger** — a keyboard shortcut that fires any custom layout or arrangement.
- **Accessibility permission** — the macOS privilege that lets Moom move windows belonging to other apps. Without it, Moom is inert.

Two mental models worth adopting early:

1. **Layouts operate on the frontmost window; arrangements operate on every window.** Reach for layouts for single-window nudges ("send this to the left half"), arrangements for whole-desktop restores ("set up my coding environment").
2. **Moom doesn't launch apps; it only moves them.** Pair with [[bunch-beginner-guide|Bunch]] or Shortcuts.app if you want one click to launch apps *and* arrange them.

## Step-by-Step Instructions

### 1. Install Moom

1. Download from [manytricks.com/moom](https://manytricks.com/moom) or buy/install from the Mac App Store (`$10`).
2. Drag `Moom.app` to `/Applications` (only needed for the direct download).
3. Launch Moom. You'll see its icon in the menu bar.
4. Open **System Settings → Privacy & Security → Accessibility** and toggle Moom on. Without this, Moom can't move windows.
5. Optionally: Moom menu → **Preferences → General → Launch at login** — turn on so Moom is always there.

### 2. Meet the palette

Hover the green traffic-light button on any window. After a beat, a small grid appears:

- Click a half-tile to snap the window to that half of the screen.
- Click a corner-tile for a quarter.
- Click and drag across tiles to make custom sizes on the fly.
- Click the tiny gear for special actions (center, revert, etc.).

That's the whole palette. Practice on three apps now.

### 3. Define your first custom layout

Moom menu → **Preferences → Custom** → click **+** → **Move & Zoom**.

- **Name:** `Left Half`
- **Action:** Move & Zoom
- **Position:** pick the left half of the mini-screen preview
- **Size:** auto-fills to 50% x 100%
- Bind a hotkey by clicking the **Trigger** box: `⌃⌥← ` (Control + Option + Left Arrow)
- Click **Save**

Repeat for `Right Half` (`⌃⌥→`), `Top Half` (`⌃⌥↑`), `Bottom Half` (`⌃⌥↓`), and `Center` (`⌃⌥C`).

Congratulations — you now have Rectangle/Divvy-style quick snapping without installing a second tool.

### 4. Save a multi-window arrangement (snapshot)

This is the superpower. Arrange *your entire desktop* the way you like it — Safari on the left, VS Code middle, Slack right — then:

1. Moom menu → **Preferences → Custom** → **+** → **Arrangement of Windows**.
2. Name it `Coding`.
3. Click **Update Snapshot** (or **Capture**) to record the current positions and sizes of every visible window.
4. Assign a trigger, e.g., `⌃⌥⌘ 1`.
5. Save.

Now move windows around randomly, then press `⌃⌥⌘ 1`. Moom puts every window back where you told it to be. This is the single most important Moom feature.

### 5. Create per-display arrangements

Snapshots are tied to the display configuration that was active when you captured them. So:

1. Disconnect your external monitor. Arrange windows for laptop-only use. Save an arrangement called `Laptop Solo`.
2. Re-connect. Arrange windows for docked use. Save as `Docked`.
3. Moom now has two arrangements; trigger each with its own hotkey.

Moom does **not** auto-switch on dock/undock — that's [[macos-app-layout-beginner-guide|Layoutish]]'s niche, or a Shortcuts.app automation. See the Practical Examples below.

### 6. Use the grid for precision

Moom → **Preferences → Grid** — choose a grid (6×3 is the default, 12×4 gives you more precision). Press `⌃⌥⌘ G` (or whatever hotkey you set) and Moom overlays the grid on every display. Click-drag to size the frontmost window exactly.

Great for writing where you want the text column to be exactly 2/3 width and a reference panel 1/3.

### 7. Script Moom with AppleScript (optional)

Moom is fully scriptable. From Terminal:

```bash
osascript -e 'tell application "Moom" to arrange windows according to snapshot "Coding"'
```

List your arrangements:

```bash
osascript -e 'tell application "Moom" to get name of every snapshot'
# {"Laptop Solo", "Docked", "Coding", "Writing"}
```

This is how Bunch, Shortcuts, Hammerspoon, and launchd trigger Moom layouts. See [[moom-deep-dive]] for the full scripting dictionary.

## Practical Examples

### Example 1 — Three layouts, three hotkeys (no arrangements)

If you hate saving snapshots, just use custom layouts:

| Hotkey    | Layout                       |
| --------- | ---------------------------- |
| `⌃⌥←`     | Left half                    |
| `⌃⌥→`     | Right half                   |
| `⌃⌥C`     | Center, 80% width, 90% height|
| `⌃⌥F`     | Fullscreen (no animation)    |
| `⌃⌥Z`     | Revert (undo last Moom move) |

Set these in Preferences → Custom and you'll never reach for the palette again.

### Example 2 — Coding arrangement

1. Arrange: VS Code filling the left 60% of your main display; Safari docs on the right 40%; Slack on a second display, right edge.
2. Save as `Coding`, trigger `⌃⌥⌘ C`.
3. Press from any layout — boom, back to coding setup.

### Example 3 — Writing arrangement

1. Arrange: Obsidian (or your editor) centered, 50% width, 90% height; Safari with references behind it.
2. Save as `Writing`, trigger `⌃⌥⌘ W`.

### Example 4 — Auto-arrange on dock via Shortcuts.app

Moom doesn't watch display changes, but Shortcuts.app does:

1. Shortcuts → **Automation** → **+** → **When display is connected → [your external display]**.
2. Add action **Run AppleScript**:

```applescript
tell application "Moom" to arrange windows according to snapshot "Docked"
```

3. Save. Add a companion automation for **disconnected** that triggers `Laptop Solo`.

Now plugging and unplugging your monitor snaps everything into place — Moom doing the layout, Shortcuts doing the event handling.

### Example 5 — Pair with Bunch for app launch + arrange

`~/Bunches/Morning.bunch`:

```text
Safari
Mail
Slack
Visual Studio Code

(sleep 2)
(run)osascript -e 'tell application "Moom" to arrange windows according to snapshot "Coding"'
```

One click: apps launch, Moom arranges them. See [[bunch-beginner-guide]] for the Bunch side.

### Example 6 — Present-mode hotkey

A custom layout called `Present` with:

- Action: Move & Zoom
- Position/Size: full screen on your external display only
- Trigger: `⌃⌥P`

Before a screen share, press `⌃⌥P` on each window you want on the external display. Quickest way to avoid "let me move this window" during demos.

## Hands-On Exercises

1. **Bind five quick layouts** — Left Half, Right Half, Top Half, Bottom Half, Center — each to a `⌃⌥` + arrow/letter hotkey. Use each one at least five times today.

2. **Save one arrangement** for your most common setup. Trigger it with `⌃⌥⌘ 1`. Randomize your windows, press the hotkey, watch them snap back.

3. **Create a second arrangement** for a different task (Writing, Email Triage, Research). Give it `⌃⌥⌘ 2`.

4. **Make a dock/undock pair** — `Laptop Solo` and `Docked` arrangements, plus two Shortcuts.app automations that trigger them on display connect/disconnect.

5. **Change the grid** to 12×4. Use Grid mode (`⌃⌥⌘ G` or your chosen hotkey) to precisely size a window to 8 columns wide.

6. **Write a shell alias** `moom-list` that runs:
   ```bash
   osascript -e 'tell application "Moom" to get name of every snapshot'
   ```
   Run it to remind yourself which arrangements you've saved.

7. **Integrate with Bunch** — follow Example 5 to make a bunch that opens three apps and triggers a Moom arrangement.

## Troubleshooting

**"Moom isn't moving windows at all."**
Accessibility permission. Open **System Settings → Privacy & Security → Accessibility**, find Moom, toggle off and on. If that fails, remove Moom with the `-` button and re-add with `+`. Restart Moom.

**"The palette doesn't appear when I hover the green button."**
Moom → **Preferences → Mouse** — ensure "Show a palette while hovering the zoom button" is on. Some macOS full-screen states disable it — exit fullscreen first.

**"Windows land a few pixels off."**
Retina scaling quirk. Re-save the arrangement at the final display resolution (connect the external before capturing). Also toggle **Preferences → Advanced → Use "zoom" effect** off if the animation is the culprit.

**"Arrangement works but an app isn't in it."**
Moom only captures windows visible at the moment you saved. Open the app, position it, then re-open Preferences → Custom → select the arrangement → click **Update Snapshot**.

**"The same hotkey works in some apps but not others."**
Another app is consuming it. Use [Karabiner-Elements' Event Viewer](https://karabiner-elements.pqrs.org/) or macOS's built-in **Keyboard → Shortcuts** pane to find the conflict. Pick a new hotkey with `⌃⌥⌘` — very few apps grab three modifiers plus a letter.

**"An app ends up on the wrong Space after Moom arranges."**
Moom doesn't move windows between Spaces (macOS forbids it). The fix: right-click the app in the Dock → **Options → Assign to → This Desktop** (or **Display**). Moom's size/position will then apply on that Space automatically when you switch to it.

**"Auto-apply on dock/undock isn't firing."**
Moom doesn't do it; Shortcuts.app does (see Example 4). Check your automation in Shortcuts → **Automation**. Make sure "Run Immediately" is on (not "Ask Before Running") or the automation won't fire without user tap.

**"AppleScript call fails with error -600."**
Moom isn't running. Add `open -b com.manytricks.Moom` before the osascript call, plus a short sleep:

```bash
open -b com.manytricks.Moom
sleep 1
osascript -e 'tell application "Moom" to arrange windows according to snapshot "Docked"'
```

**"AppleScript call fails with error -1743."**
Automation permission denied. In **System Settings → Privacy & Security → Automation**, ensure your calling app (Terminal, Bunch, Shortcuts) has Moom toggled on.

## Related Tutorials

- [[bunch-beginner-guide|Bunch Beginner Guide]] — the most natural pairing; open apps with Bunch, arrange them with Moom
- [[bunch-deep-dive|Bunch Deep Dive]] — advanced bunch patterns that drive Moom
- [[macos-app-layout-beginner-guide]] — where Moom fits alongside Layoutish, Shortcuts, and Hammerspoon
- [[macos-app-layout-deep-dive]] — comprehensive deep-dive including Moom internals
- [[moom-deep-dive]] — scripting dictionary, JXA, advanced patterns, and integration strategies
- [[dotfiles-beginner-guide]] — versioning Moom's exported preferences
- [[dotfiles-deep-dive]] — versioning Moom snapshots alongside other config
- [[chezmoi-beginner-guide]] — syncing Moom exports across Macs

## References

- Moom homepage — https://manytricks.com/moom/
- Moom help / docs — https://manytricks.com/moom/help/
- Moom scripting dictionary — https://manytricks.com/osd/moom/
- Apple: Move and resize windows — https://support.apple.com/guide/mac-help/work-with-windows-mchlp1508/mac
- Many Tricks support — https://manytricks.com/support/

## Summary

Moom is the quickest path to keyboard-driven window management on macOS without compromise. You install it, grant Accessibility, define a handful of layouts, save a couple of arrangements, and within a day you're pressing `⌃⌥→` and `⌃⌥⌘ 1` on reflex.

**Key takeaways:**

- **Custom layouts** move the frontmost window; bind them to `⌃⌥` + arrows/letters.
- **Arrangements (snapshots)** restore every window at once; bind them to `⌃⌥⌘` + digits.
- Moom doesn't auto-switch on dock/undock — use Shortcuts.app automations for that.
- Moom is fully scriptable; that's how [[bunch-beginner-guide|Bunch]], Shortcuts, Hammerspoon, and launchd drive it.
- Grant Accessibility once and forget, except after major macOS updates.

**Next steps:** set up the five quick layouts, save one arrangement you'll use daily, and either read [[moom-deep-dive]] for advanced scripting or [[bunch-beginner-guide]] to learn the orchestrator that makes Moom even more useful.
# Related Tutorials

- [[hammerspoon-beginner-guide]] — pair Moom with Hammerspoon
- [[yabai-beginner-guide]] — tiling alternative
- [[sketchybar-beginner-guide]] — status bar pairing
