---
title: macOS App Layout Management — Beginner's Guide
date: 2026-04-14
difficulty: beginner
tags: [macos, window-management, layoutish, moom, bunch, spaces, dock, productivity]
---

# macOS App Layout Management: Beginner's Guide

## Overview

If you use a MacBook that you regularly **dock** to an external display and **undock** when you're mobile, you've probably felt the pain: every time the display configuration changes, your windows scramble — apps pile onto the wrong screen, sizes get squished, and carefully curated Spaces fall apart.

This guide shows you two beginner-friendly ways to solve that problem:

1. **Layoutish** — an auto-detect dock/undock tool that saves and restores your full window layout with one click.
2. **Moom + Bunch** — a classic power-user combo where Moom snaps windows into saved layouts and Bunch launches apps and triggers layouts together.

You'll learn enough to pick the right tool, install it, save your first layout, and recover gracefully from the most common pitfalls (especially the "Spaces problem" that affects every third-party window manager on macOS).

### What you will learn

- The core concepts behind macOS window management (Spaces, displays, app assignments)
- How to install and use Layoutish for auto-detect dock/undock layouts
- How to build a Moom + Bunch workflow for scripted, hotkey-driven layouts
- How to work around macOS's Spaces limitations
- Which tool fits which kind of workflow

## Prerequisites

Before starting, make sure you have:

- A Mac running **macOS 13 Ventura** or newer (both tools support older versions, but this guide targets modern macOS).
- Administrator access on your Mac (needed to grant Accessibility permissions).
- A workflow you already use — ideally a laptop you dock to at least one external display.
- Optional but recommended: an understanding of macOS **Spaces** (virtual desktops). If you're new to Spaces, open Mission Control (swipe up with three fingers, or press `Control + Up Arrow`) and add a second Space with the `+` button.

You do **not** need:

- Any scripting knowledge (we'll cover a small amount of AppleScript in the Moom + Bunch section, but it's optional).
- A paid Apple Developer account.

## Key Concepts

Before touching any tool, get comfortable with these ideas. Misunderstanding them is the #1 source of "why didn't my layout restore?" frustration.

**Spaces.** macOS lets you have multiple virtual desktops ("Spaces") per display. You can assign an app to a specific Space via right-click on its Dock icon → **Options → Assign To → This Desktop**. This assignment sticks across reboots and display changes and is the most reliable way to keep apps on the right Space.

**Display configurations.** macOS sees "laptop only" and "laptop + external display" as two different display configurations. Most layout tools let you save a separate layout per configuration and auto-switch.

**The Spaces problem.** macOS does not let third-party apps read or move windows in Spaces that aren't currently visible. This is a system-wide limitation, not a bug in any one tool. The practical consequence: layout tools can reliably position and size windows on the **active** Space, but moving an app from Space 3 to Space 7 programmatically is unreliable. The workaround is to **assign apps to Spaces via the Dock** and use layout tools only for sizing/positioning within a Space.

**Accessibility permissions.** Every window manager on macOS needs Accessibility permission to read and move windows. You'll grant this in **System Settings → Privacy & Security → Accessibility**.

## Step-by-Step Instructions

### Path A — Layoutish (recommended for most people)

#### 1. Install Layoutish

Download from [layoutish.app](https://layoutish.app) or the Mac App Store. Drag the app to `/Applications`, then launch it.

#### 2. Grant Accessibility permission

On first launch, Layoutish will prompt you. Open **System Settings → Privacy & Security → Accessibility**, toggle **Layoutish** on, and return to the app.

#### 3. Arrange your apps the way you want them

With your laptop undocked, open the apps you use (Safari, Mail, Slack, VS Code, etc.) and arrange them on the screen exactly how you like.

#### 4. Save your first layout

In Layoutish, click **Save Current Layout** and name it `Laptop Only`. Layoutish records which apps are open, where each window is, and what size it is.

#### 5. Dock your laptop and repeat

Connect your external display. Rearrange your apps across the built-in and external displays the way you prefer. In Layoutish, click **Save Current Layout** and name it `Docked`.

#### 6. Enable auto-detect

In Layoutish settings, turn on **Auto-apply layout on display change** and pair each layout with its display configuration. From now on, docking and undocking will trigger the matching layout.

#### 7. Tune it

If a layout doesn't restore perfectly, re-open the app, reposition it, and click **Update Layout** while the layout is selected.

### Path B — Moom + Bunch (recommended for scripters / hotkey lovers)

#### 1. Install Moom

Download from [manytricks.com/moom](https://manytricks.com/moom) or the Mac App Store (`$10`). Launch it and grant Accessibility permission the same way.

#### 2. Define a custom layout in Moom

Open Moom's preferences → **Custom** tab → click **+** → **New Arrangement of Windows**. Arrange your windows exactly how you want them, then save the arrangement with a descriptive name like `Docked 3-monitor` or `Laptop solo`.

#### 3. Assign a hotkey (optional)

In the same pane, pick a trigger like `⌃⌥⌘ 1` for `Laptop solo` and `⌃⌥⌘ 2` for `Docked`.

#### 4. Install Bunch

Download from [bunchapp.co](https://bunchapp.co) (free). Drop it in `/Applications` and launch.

#### 5. Write your first Bunch file

Open Bunch → **Edit Bunches** → create a new `.bunch` file named `Work.bunch` with contents like:

```text
Safari
Mail
Slack
VS Code

# Trigger a Moom layout after launching apps
(run)osascript -e 'tell application "Moom" to arrange windows according to snapshot "Docked"'
```

Save, then click the Bunch's icon in the menu bar to run it.

#### 6. Wire it to dock/undock (optional)

Bunch doesn't auto-detect displays on its own. The simplest trick: use **Shortcuts.app** with a **When display connected** trigger that runs `open -b com.brettterpstra.Bunch /path/to/Work.bunch`.

## Practical Examples

### Example 1 — A simple Layoutish workflow

```text
Layoutish layouts:
  Laptop Only       → Safari full-screen, Messages + Mail side-by-side
  Docked 27" 4K     → VS Code + iTerm on external, Slack + Mail on laptop
  Docked Dual 27"   → VS Code left external, Figma right external, Slack + Mail on laptop
```

Docking the laptop triggers `Docked 27" 4K` automatically; unplugging snaps back to `Laptop Only`.

### Example 2 — A Moom + Bunch "start my workday" script

`~/Bunches/Morning.bunch`:

```text
Safari
Mail
Slack
1Password

# Wait two seconds for apps to settle, then apply layout
(sleep 2)
(run)osascript -e 'tell application "Moom" to arrange windows according to snapshot "Docked"'
```

Expected behaviour when you click the Bunch in the menu bar: the four apps launch, Moom waits two seconds, then arranges them into the saved `Docked` snapshot.

### Example 3 — Assigning apps to Spaces (works with either tool)

1. Right-click the **Slack** icon in the Dock → **Options → Assign To → This Desktop** while you're on Space 3.
2. Right-click the **VS Code** icon → **Options → Assign To → This Desktop** while you're on Space 1.
3. Restart both apps. They will now always open on their assigned Space, regardless of display configuration.

This is the most reliable way to keep apps on the right Space. Layout tools handle sizing; Dock assignments handle which Space they land on.

## Hands-On Exercises

1. **Save two layouts in Layoutish** — one undocked, one docked. Unplug and plug your display; confirm both layouts trigger automatically.
2. **Build one Moom snapshot** for your favourite "focus" layout (e.g., editor left-half, browser right-half) and bind it to `⌃⌥⌘ F`. Press the shortcut from any layout and watch the windows snap.
3. **Write a `.bunch` file** that launches your three most-used apps and triggers a Moom snapshot. Run it and see how close it gets to a full "morning setup" in one click.
4. **Assign two apps to Spaces** via the Dock. Reboot, dock/undock, and confirm the assignments survive.
5. **Audit the Spaces problem** — pick an app that lives in Space 5 and try to get a layout tool to reposition it without visiting Space 5. Observe the failure, then solve it with a Dock Space assignment.

## Troubleshooting

**"Nothing happens when I restore a layout."**
You almost certainly haven't granted Accessibility permission. Open **System Settings → Privacy & Security → Accessibility** and make sure Layoutish / Moom / Bunch are listed and toggled on. If they're listed but the toggle looks correct, remove them with the `-` button and re-add them.

**"My layout works on my external display but not on the laptop."**
macOS treats the two configurations as different. Save a separate layout for each and pair them with the correct display configuration in Layoutish, or create separate Moom snapshots per config.

**"An app ends up on the wrong Space after docking."**
Layout tools can't reliably move windows between Spaces. Use **Dock → Options → Assign To → This Desktop** on the app to pin it to a Space.

**"Windows shift by a few pixels on restore."**
This is usually a Retina scaling quirk. In Moom, save the snapshot while the display is at its final resolution. In Layoutish, use **Update Layout** after a dock/undock cycle to capture the real pixel positions.

**"Bunch fails to trigger Moom."**
Verify Moom is running before Bunch fires the AppleScript — add `(sleep 2)` before the `(run)` line. If the error persists, run `osascript -e 'tell application "Moom" to arrange windows according to snapshot "Docked"'` from the Terminal to isolate the problem.

**"Display change doesn't trigger anything."**
In Layoutish, check that **Auto-apply layout on display change** is on. In Shortcuts.app (for Bunch), confirm you picked **When display connected**, not **When Mac starts**.

## Comparison: Layoutish vs. Moom + Bunch

| Dimension | Layoutish | Moom + Bunch |
| --- | --- | --- |
| Auto-detect dock/undock | Yes, built-in | No (requires Shortcuts.app or third-party trigger) |
| Per-display layouts | Yes | Yes (via multiple snapshots) |
| Scripting / AppleScript | Limited | Extensive — Moom is fully scriptable, Bunch is a DSL |
| App launching | No (apps must already be open) | Yes (Bunch launches apps) |
| Learning curve | Minimal — save + apply | Moderate — you write `.bunch` files |
| Price | One-time purchase | `$10` Moom + free Bunch |
| Best for | Users who just want "dock = this layout, undock = that layout" | Users who want multiple hotkey-driven layouts per day |

**Rule of thumb:** start with Layoutish. Add Moom + Bunch if you find yourself wanting more than two layouts, hotkey triggers, or "open these apps and then arrange them" scripts.

## References

- Layoutish — https://layoutish.app
- Moom (Many Tricks) — https://manytricks.com/moom
- Bunch (Brett Terpstra) — https://bunchapp.co
- Apple: Use Spaces on Mac — https://support.apple.com/guide/mac-help/work-in-multiple-spaces-mh14112/mac
- Display Maid — https://displaymaidapp.com
- AppleScript Language Guide — https://developer.apple.com/library/archive/documentation/AppleScript/Conceptual/AppleScriptLangGuide/

## Related Tutorials

- [[macos-app-layout-deep-dive]] — Deeper coverage of the same tools, including scripting and edge cases
- [[bunch-beginner-guide|Bunch Beginner Guide]] — Generic tutorial on Bunch, the app launcher and orchestrator used here
- [[bunch-deep-dive|Bunch Deep Dive]] — Advanced Bunch patterns, frontmatter, snippets, and composition
- [[moom-beginner-guide|Moom Beginner Guide]] — Generic tutorial on Moom, the window manager used here
- [[moom-deep-dive|Moom Deep Dive]] — Moom internals, scripting, and advanced integrations
- [[dotfiles-beginner-guide]] — Where to store your `.bunch` files and Moom exports
- [[dotfiles-deep-dive]] — Versioning macOS configuration
- [[chezmoi-beginner-guide]] — Syncing dotfiles across Macs
- [[sesh-beginner-guide]] — Terminal session management (pairs with per-Space editor workflows)
- [[television-beginner-guide]] — Fast terminal UI picker
- [[kubernetes-macos-docker-desktop-tutorial]] — macOS-specific developer setup
- [[karabiner-elements-beginner-guide|Karabiner-Elements Beginner Guide]] — remap keys to trigger layout changes via Hyper shortcuts
- [[karabiner-elements-deep-dive|Karabiner-Elements Deep Dive]] — app-specific keyboard rules that complement layout management

## Summary

- macOS layout chaos on dock/undock is a solved problem — you just need the right tool.
- **Layoutish** is the easiest path: save layouts per display config and forget about them.
- **Moom + Bunch** is the power-user combo: scripted, hotkey-driven, launches apps and arranges them.
- The **Spaces problem** is a macOS limitation; use Dock → Assign To → This Desktop to pin apps to Spaces, and let layout tools handle sizing.
- Grant Accessibility permission once, and everything else is a matter of saving good layouts.

**Next steps:** install Layoutish, save your two main layouts (docked and undocked), and try Path B only if you want more than two. When you're ready for the architecture, scripting, and edge-case deep dive, continue to [[macos-app-layout-deep-dive]].
# Related Tutorials

- [[hammerspoon-beginner-guide]] — Hammerspoon starter guide
- [[yabai-beginner-guide]] — Yabai tiling window manager
- [[sketchybar-beginner-guide]] — Sketchybar status bar
