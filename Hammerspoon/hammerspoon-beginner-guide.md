---
title: Hammerspoon — Beginner's Guide
date: 2026-04-15
difficulty: beginner
tags: [macos, hammerspoon, lua, automation, window-management, productivity]
---

# Hammerspoon — Beginner's Guide

## Overview

Hammerspoon is a free, open-source macOS automation tool that bridges the operating system's native APIs (windows, displays, Wi-Fi, audio, hotkeys, USB, filesystem events, and more) into a scriptable **Lua** environment. If AppleScript feels clunky and Shortcuts.app feels limiting, Hammerspoon is the power-user's answer: a few lines of Lua can rearrange every window on your screen, toggle your mute button on a meeting, re-map caps lock, or fire a notification when your external monitor connects.

By the end of this guide you will have Hammerspoon installed, understand its `init.lua` entry point, and have a working configuration with hotkeys for window snapping, a reload shortcut, and a simple event watcher. This guide pairs well with [[moom-beginner-guide|Moom]] and [[bunch-beginner-guide|Bunch]] — Hammerspoon is often the "glue" that wires those tools to events.

## Prerequisites

- macOS 12 (Monterey) or newer — macOS 15+ recommended
- Administrator access on your Mac
- [Homebrew](https://brew.sh) installed (optional but recommended)
- Comfort editing a text file in your terminal or a GUI editor
- Familiarity with basic macOS Accessibility permissions
- Optional: familiarity with [[dotfiles-beginner-guide]] for versioning your config

You do **not** need prior Lua experience. You will pick up enough Lua from the examples below to be productive.

## Key Concepts

**`hs` global.** Every Hammerspoon API is reachable through the `hs` namespace: `hs.hotkey`, `hs.window`, `hs.screen`, `hs.wifi`, `hs.application`, and so on.

**`~/.hammerspoon/init.lua`.** This is the single Lua file Hammerspoon executes at launch. Everything else — modules, spoons, helpers — is loaded from here.

**Spoons.** Reusable Lua modules with a `.spoon` extension. Think of them like plugins. Install into `~/.hammerspoon/Spoons/` and load with `hs.loadSpoon("Name")`.

**Accessibility API.** Hammerspoon manipulates windows via macOS's Accessibility framework, the same mechanism used by [[moom-deep-dive|Moom]], [[yabai-beginner-guide|Yabai]], and similar tools. You must grant Hammerspoon Accessibility permission in System Settings.

**Reload pattern.** Changes to `init.lua` require a reload. You will bind a hotkey for this so you don't have to click the menu bar every time.

## Step-by-Step Instructions

### 1. Install Hammerspoon

```bash
brew install --cask hammerspoon
```

Expected output (abridged):

```
==> Downloading https://github.com/Hammerspoon/hammerspoon/releases/...
🍺  hammerspoon was successfully installed!
```

Alternatively, download the `.zip` from [hammerspoon.org](https://www.hammerspoon.org) and drag `Hammerspoon.app` to `/Applications`.

### 2. Launch Hammerspoon and grant permissions

Open Hammerspoon from `/Applications` or Spotlight. You'll see a new menu-bar icon. The app will prompt for **Accessibility** permission.

```
System Settings → Privacy & Security → Accessibility → toggle Hammerspoon ON
```

If you skip this, every window-manipulation call will fail silently.

### 3. Create your `init.lua`

```bash
mkdir -p ~/.hammerspoon
touch ~/.hammerspoon/init.lua
open -e ~/.hammerspoon/init.lua
```

### 4. Add a "Hello, Hammerspoon" and a reload hotkey

Paste this into `init.lua`:

```lua
-- ~/.hammerspoon/init.lua

-- A friendly confirmation that the config loaded
hs.alert.show("Hammerspoon config loaded", 1)

-- Reload config with ⌘⌥⌃ R
hs.hotkey.bind({"cmd", "alt", "ctrl"}, "R", function()
  hs.reload()
end)
```

Click the Hammerspoon menu-bar icon → **Reload Config**. You should see a semi-transparent banner appear briefly.

### 5. Add window snapping hotkeys

```lua
-- Move focused window to left half of screen
hs.hotkey.bind({"cmd", "alt", "ctrl"}, "Left", function()
  local win = hs.window.focusedWindow()
  if not win then return end
  local f = win:screen():frame()
  win:setFrame({x = f.x, y = f.y, w = f.w / 2, h = f.h})
end)

-- Right half
hs.hotkey.bind({"cmd", "alt", "ctrl"}, "Right", function()
  local win = hs.window.focusedWindow()
  if not win then return end
  local f = win:screen():frame()
  win:setFrame({x = f.x + f.w / 2, y = f.y, w = f.w / 2, h = f.h})
end)

-- Maximize
hs.hotkey.bind({"cmd", "alt", "ctrl"}, "M", function()
  local win = hs.window.focusedWindow()
  if not win then return end
  win:maximize()
end)
```

Press `⌘⌥⌃ ←` with any window focused. It will jump to the left half of your screen.

### 6. Persist across logins

Hammerspoon has a "Launch at Login" option in its preferences dialog. Turn it on so your automations survive reboots.

## Practical Examples

### Example 1 — Auto-mute the system when headphones disconnect

```lua
local function onAudioDeviceChange()
  local out = hs.audiodevice.defaultOutputDevice()
  if out and not out:name():match("Head") then
    hs.audiodevice.defaultOutputDevice():setMuted(true)
    hs.alert.show("Speakers muted (headphones disconnected)")
  end
end

hs.audiodevice.watcher.setCallback(onAudioDeviceChange)
hs.audiodevice.watcher.start()
```

### Example 2 — Layout on Wi-Fi network change

Perfect for "when I connect to OfficeWiFi, move Slack to Space 2."

```lua
local wifiWatcher = hs.wifi.watcher.new(function()
  local ssid = hs.wifi.currentNetwork()
  if ssid == "OfficeWiFi" then
    hs.application.launchOrFocus("Slack")
    hs.alert.show("Office mode")
  elseif ssid == "HomeWiFi" then
    hs.application.launchOrFocus("Music")
    hs.alert.show("Home mode")
  end
end)
wifiWatcher:start()
```

### Example 3 — App launcher hotkeys

```lua
local apps = {
  c = "Google Chrome",
  s = "Slack",
  t = "Ghostty",
  o = "Obsidian",
}

for key, app in pairs(apps) do
  hs.hotkey.bind({"cmd", "alt", "ctrl"}, key, function()
    hs.application.launchOrFocus(app)
  end)
end
```

### Example 4 — Caffeine replacement

```lua
local caffeine = hs.menubar.new()
local function setCaffeineDisplay(state)
  caffeine:setTitle(state and "☕️" or "💤")
end
caffeine:setClickCallback(function()
  setCaffeineDisplay(hs.caffeinate.toggle("displayIdle"))
end)
setCaffeineDisplay(hs.caffeinate.get("displayIdle"))
```

## Hands-On Exercises

1. **Reload hotkey.** Add a hotkey that reloads your config with a sound effect (`hs.sound.getByName("Glass"):play()`).
2. **Center a window.** Write a hotkey that centers the focused window to 60% width × 70% height of the current screen.
3. **Move between screens.** Bind `⌘⌥⌃ N` to push the focused window to the next screen (`hs.window.focusedWindow():moveToScreen(next_screen)`).
4. **Battery notification.** Write a watcher that shows a `hs.notify` banner whenever battery drops below 20%.
5. **Spoon install.** Install the `ReloadConfiguration` spoon and replace your hand-rolled reload logic with it.
6. **File-change reload.** Use `hs.pathwatcher.new` to auto-reload when `init.lua` changes on disk.

## Troubleshooting

**Nothing happens when I press a hotkey.**
Check the Hammerspoon console (menu-bar icon → **Console**). Most errors show there. The most common culprit is a missing Accessibility grant — revisit System Settings.

**Two hotkeys conflict.**
Only one app can own a given keystroke. If a system shortcut or another app (Rectangle, Moom, Raycast) already binds `⌘⌥⌃ ←`, Hammerspoon's `bind` will silently lose. Change one of them. See [[moom-deep-dive]] for advice on reserving the `⌘⌥⌃⇧` modifier strictly for Hammerspoon.

**`hs.window.focusedWindow()` returns `nil`.**
You may be targeting a non-standard window (menu extras, Control Center). Guard with `if not win then return end`.

**My config loaded but changes don't apply.**
You need to reload. Click the menu-bar icon → **Reload Config**, or press your reload hotkey.

**Permission drift after a macOS update.**
After major macOS upgrades, Accessibility grants can silently reset. Re-toggle Hammerspoon in Privacy & Security.

## References

- Hammerspoon home — https://www.hammerspoon.org
- Getting started — https://www.hammerspoon.org/go/
- API reference — https://www.hammerspoon.org/docs/
- Spoons index — https://www.hammerspoon.org/Spoons/
- GitHub — https://github.com/Hammerspoon/hammerspoon

## Related Tutorials

- [[hammerspoon-deep-dive]] — internals, event model, and advanced patterns
- [[moom-beginner-guide|Moom Beginner Guide]] — pair Moom for layouts with Hammerspoon for triggers
- [[moom-deep-dive]] — scripting Moom from Hammerspoon
- [[bunch-beginner-guide|Bunch Beginner Guide]] — launch app bundles triggered by Hammerspoon hotkeys
- [[macos-app-layout-beginner-guide]] — where Hammerspoon fits in the macOS automation stack
- [[macos-app-layout-deep-dive]] — complete stack: Moom, Bunch, Shortcuts, Hammerspoon, launchd
- [[yabai-beginner-guide|Yabai Beginner Guide]] — tiling window manager; often paired with Hammerspoon
- [[dotfiles-beginner-guide]] — version your `~/.hammerspoon` directory
- [[chezmoi-beginner-guide]] — templated Hammerspoon configs across machines
- [[karabiner-elements-beginner-guide|Karabiner-Elements Beginner Guide]] — remap keys and build Hyper/Meh layers that trigger Hammerspoon hotkeys
- [[karabiner-elements-deep-dive|Karabiner-Elements Deep Dive]] — advanced keyboard remapping with shell_command integration for Hammerspoon

## Summary

Hammerspoon turns macOS into a programmable workstation. With a dozen lines of Lua you can build window tilers, audio watchers, Wi-Fi-aware launchers, and app-specific keymaps that rival commercial apps. The mental model is simple: events come in, Lua callbacks run, macOS APIs are called.

**Key takeaways:**

- One file — `~/.hammerspoon/init.lua` — is your entire configuration
- Bind a reload hotkey first; iterate fast
- Accessibility permission is mandatory
- Spoons package common patterns for reuse
- Hammerspoon excels as the *event layer* in a stack with [[moom-beginner-guide|Moom]] (geometry) and [[bunch-beginner-guide|Bunch]] (app orchestration)

**Next steps:** read the [[hammerspoon-deep-dive]] for architectural details, install one or two Spoons from the gallery, and version-control your `~/.hammerspoon` directory with [[chezmoi-beginner-guide|chezmoi]] or a plain dotfiles repo.
