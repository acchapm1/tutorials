---
title: Hammerspoon — Deep Dive
date: 2026-04-15
difficulty: advanced
tags: [macos, hammerspoon, lua, automation, window-management, spoons, accessibility, event-driven]
---

# Hammerspoon — Deep Dive

## Overview

Hammerspoon is a Lua-scripted bridge to macOS. Under the hood it's a Cocoa app that embeds LuaJIT and exposes a catalog of bindings — `hs.window`, `hs.screen`, `hs.hotkey`, `hs.eventtap`, `hs.pathwatcher`, `hs.wifi`, `hs.caffeinate`, `hs.audiodevice`, and dozens more — as Lua modules backed by Objective-C. Because it talks directly to macOS frameworks (CoreGraphics, Accessibility, IOKit, NSWorkspace, CoreAudio), it's the most capable scriptable automation surface available on the Mac without disabling System Integrity Protection.

This deep-dive covers Hammerspoon's architecture, its event-driven programming model, the module system (Spoons), advanced patterns for window management, reliable interop with [[moom-deep-dive|Moom]], [[bunch-deep-dive|Bunch]], and [[yabai-deep-dive|Yabai]], performance tuning, and the failure modes you only hit when you push Hammerspoon past "bind a hotkey to resize a window."

### What you will learn

- Hammerspoon's runtime model and its interaction with macOS frameworks
- The Lua environment: LuaJIT, garbage collection, coroutines, and how they affect script design
- Event sources: hotkeys, `eventtap`, watchers, timers, and streams
- Building, packaging, and loading Spoons
- Advanced window management: layouts, screen geometry, Spaces caveats
- Inter-process automation: shelling out, AppleScript, URL handlers, JSON IPC
- Performance, leaks, and debugging via the console
- Failure modes around Accessibility grants, SIP, and macOS updates

## Prerequisites

- Everything in [[hammerspoon-beginner-guide]]
- Comfort with Lua syntax (tables, closures, metatables) — or willingness to learn quickly
- Familiarity with macOS permission model (Accessibility, Screen Recording, Automation)
- Understanding of screen coordinates and `NSRect`-style frames
- A dotfiles workflow: [[dotfiles-deep-dive]] or [[chezmoi-deep-dive]]
- Optional: experience with [[moom-deep-dive|Moom]], [[yabai-deep-dive|Yabai]], or [[bunch-deep-dive|Bunch]]

## Key Concepts

### Runtime architecture

```
┌─────────────────────────────────────────────────────┐
│  init.lua  (your code + loaded Spoons)              │
├─────────────────────────────────────────────────────┤
│  hs.* modules (Lua)                                 │
├─────────────────────────────────────────────────────┤
│  LuaSkin bridge (Lua ↔ Objective-C)                 │
├─────────────────────────────────────────────────────┤
│  LuaJIT 2.1 beta / Obj-C runtime                    │
├─────────────────────────────────────────────────────┤
│  Hammerspoon.app (Cocoa)                            │
├─────────────────────────────────────────────────────┤
│  macOS: AX, CG, CoreAudio, IOKit, NSWorkspace, ...  │
└─────────────────────────────────────────────────────┘
```

Hammerspoon runs a single Lua state on the main thread. Most `hs.*` calls are synchronous bindings to macOS APIs. A few modules (notably `hs.task`, `hs.http.asyncGet`) use background queues and deliver results via callbacks scheduled on the main loop.

### The Lua environment

- **LuaJIT 2.1 beta** with the Lua 5.1 standard library plus `bit`, `ffi`, and pairs/ipairs optimizations.
- Global `hs` is the entry point to all bindings.
- `require` searches `~/.hammerspoon/?.lua` and `~/.hammerspoon/Spoons/?.spoon/init.lua`.
- Strings, tables, and closures behave exactly like standard Lua. Numbers are doubles (no integer type at the Lua level).
- Garbage collection runs on the main thread; avoid allocating huge tables in hot paths.

### Event sources

Hammerspoon is event-driven. Every useful config boils down to:

1. Register interest in an event (hotkey press, screen change, Wi-Fi change, filesystem modification, timer tick).
2. Provide a Lua callback.
3. Hammerspoon schedules the callback on the main thread when the event fires.

The main event sources:

| Module                | Purpose                                      |
| --------------------- | -------------------------------------------- |
| `hs.hotkey`           | Global keyboard shortcuts                    |
| `hs.eventtap`         | Low-level key/mouse event interception       |
| `hs.pathwatcher`      | File/directory change notifications          |
| `hs.wifi.watcher`     | Wi-Fi SSID and power-state changes           |
| `hs.screen.watcher`   | Display connect/disconnect, resolution       |
| `hs.application.watcher` | App launch, terminate, activate, hide     |
| `hs.audiodevice.watcher` | Default output/input device changes       |
| `hs.battery.watcher`  | Power source, percentage, cycle count        |
| `hs.caffeinate.watcher` | Sleep, wake, lock, unlock, session events  |
| `hs.usb.watcher`      | USB attach/detach events                     |
| `hs.timer`            | One-shot or repeating timers                 |
| `hs.spaces.watcher`   | Space change (with caveats, see below)       |

### Windows, screens, and frames

- `hs.window.focusedWindow()` returns the window that currently has key focus, or `nil`.
- `hs.screen.mainScreen()` returns the screen containing the mouse cursor.
- `hs.screen:frame()` returns the *visible* frame (Dock and menu-bar excluded).
- `hs.screen:fullFrame()` returns the full monitor rectangle.
- Coordinates: the top-left of the primary screen is `(0,0)`, Y increases downward. Secondary displays can have negative coordinates depending on the System Settings → Displays arrangement.

### Spaces — the permanent caveat

macOS does not provide a public API to move windows between Spaces. Hammerspoon inherits this limitation from every other tool. Workarounds include:

- Use `hs.spaces.moveWindowToSpace` (private API, requires Accessibility, can break after OS updates)
- Drag-by-synthetic-event through `hs.eventtap`
- Delegate Spaces work to [[yabai-deep-dive|Yabai]] via `yabai -m window --space` shell-outs

This is the same root cause described in [[macos-app-layout-deep-dive]] — every window manager is subject to it.

### Spoons — the module system

A Spoon is a directory `Foo.spoon/` containing at minimum an `init.lua` that returns a table with a well-known shape:

```lua
-- Foo.spoon/init.lua
local obj = {}
obj.__index = obj
obj.name = "Foo"
obj.version = "1.0"
obj.author = "You"
obj.license = "MIT"

function obj:init() end
function obj:start() return self end
function obj:stop() return self end
function obj:bindHotkeys(mapping) ... end

return obj
```

Install with `hs.loadSpoon("Foo")`. Good Spoons are idempotent, don't leak watchers, and expose a stable `bindHotkeys` contract.

## Step-by-Step Instructions

### 1. Version-control your config

Treat `~/.hammerspoon` like any other dotfile directory. With [[chezmoi-deep-dive|chezmoi]]:

```bash
chezmoi add ~/.hammerspoon
```

Or a plain bare-repo dotfiles setup:

```bash
cd ~/.hammerspoon
git init
echo "Spoons/*/init.lua" > .gitignore  # if you vendor Spoons via submodules
```

Commit your `init.lua`, any helper modules, and your curated Spoon list.

### 2. Structure `init.lua` for scale

Anything non-trivial deserves module separation:

```
~/.hammerspoon/
├── init.lua
├── modules/
│   ├── hotkeys.lua
│   ├── layouts.lua
│   ├── watchers.lua
│   └── apps.lua
└── Spoons/
    ├── ReloadConfiguration.spoon/
    └── Seal.spoon/
```

`init.lua` becomes a manifest:

```lua
-- init.lua
local hyper = {"cmd", "alt", "ctrl"}
_G.hyper = hyper  -- or pass it explicitly

require("modules.watchers")
require("modules.layouts")
require("modules.hotkeys")
require("modules.apps")

hs.loadSpoon("ReloadConfiguration"):start()
hs.alert.show("config loaded", 0.8)
```

### 3. Hot-reload on save

```lua
-- modules/watchers.lua
hs.pathwatcher.new(os.getenv("HOME") .. "/.hammerspoon/", function(files)
  for _, f in ipairs(files) do
    if f:match("%.lua$") then
      hs.reload()
      return
    end
  end
end):start()
```

This removes the "reload, wait, test" friction. You save a file and the new config is live.

### 4. Build a layout engine

```lua
-- modules/layouts.lua
local M = {}

-- Laptop Solo: editor left 60%, browser right 40%
function M.laptopSolo()
  local editor = hs.application.find("Zed") or hs.application.find("Ghostty")
  local browser = hs.application.find("Arc") or hs.application.find("Google Chrome")
  local screen = hs.screen.primaryScreen()
  local f = screen:frame()

  if editor then
    editor:mainWindow():setFrame({x=f.x, y=f.y, w=f.w*0.6, h=f.h})
  end
  if browser then
    browser:mainWindow():setFrame({x=f.x+f.w*0.6, y=f.y, w=f.w*0.4, h=f.h})
  end
end

-- Auto-apply on screen change
hs.screen.watcher.new(function()
  local count = #hs.screen.allScreens()
  if count == 1 then M.laptopSolo() end
end):start()

return M
```

### 5. Interop with Moom, Bunch, and Yabai

Hammerspoon becomes the conductor. Moom supplies geometry, Bunch sequences apps, Yabai handles tiling in Spaces:

```lua
-- Trigger a Moom snapshot
hs.hotkey.bind(hyper, "1", function()
  hs.osascript.applescript([[
    tell application "Moom"
      arrange windows according to snapshot "Docked Dual 27\""
    end tell
  ]])
end)

-- Run a Bunch
hs.hotkey.bind(hyper, "B", function()
  hs.execute("open -b com.brettterpstra.Bunch x-bunch://open/Morning")
end)

-- Ask Yabai to move the focused window one space right
hs.hotkey.bind(hyper, ";", function()
  hs.execute("/opt/homebrew/bin/yabai -m window --space next")
end)
```

### 6. Defensive patterns for watchers

Watchers are long-lived references. Lose the reference and Lua GC will tear the watcher down, silently killing your feature:

```lua
-- BAD
hs.wifi.watcher.new(callback):start()  -- no reference held!

-- GOOD
local wifi = hs.wifi.watcher.new(callback):start()
_G.__keepalive_wifi = wifi              -- survive GC
```

Or collect into a module-level table:

```lua
local watchers = {}
table.insert(watchers, hs.wifi.watcher.new(cb):start())
table.insert(watchers, hs.screen.watcher.new(cb):start())
return watchers
```

### 7. Debugging with the console

Click the menu-bar icon → **Console**. The console is a full REPL with access to your globals. Useful helpers:

```lua
-- Inspect a table
hs.inspect(hs.screen.allScreens())

-- Print the current focused window frame
print(hs.inspect(hs.window.focusedWindow():frame()))

-- Enable verbose logging on a module
hs.logger.defaultLogLevel = 'debug'
```

### 8. Package a Spoon

Any reusable module can become a Spoon:

```
~/.hammerspoon/Spoons/PomodoroBar.spoon/
├── init.lua
└── docs.json  (optional)
```

```lua
-- PomodoroBar.spoon/init.lua
local obj = {}
obj.__index = obj
obj.name = "PomodoroBar"
obj.version = "0.1"

function obj:init()
  self.menubar = hs.menubar.new()
  self.menubar:setTitle("🍅 25:00")
  return self
end

function obj:start(duration)
  self.end_at = os.time() + (duration or 25*60)
  self.timer = hs.timer.doEvery(1, function() self:tick() end)
  return self
end

function obj:tick()
  local remaining = self.end_at - os.time()
  if remaining <= 0 then
    self.timer:stop()
    hs.notify.new({title="Pomodoro", informativeText="Done"}):send()
    self.menubar:setTitle("🍅 --:--")
    return
  end
  local m = math.floor(remaining / 60)
  local s = remaining % 60
  self.menubar:setTitle(string.format("🍅 %02d:%02d", m, s))
end

return obj
```

Load from `init.lua`:

```lua
hs.loadSpoon("PomodoroBar"):init():start(25*60)
```

## Practical Examples

### Example 1 — Focus-mode hyperkey via `eventtap`

Remap Caps Lock to "Hyper" (⌘⌥⌃⇧) at the Hammerspoon layer:

```lua
-- Intercept Caps Lock and emit hyper down/up
local hyperUp = false
local hyper = hs.eventtap.new({hs.eventtap.event.types.flagsChanged}, function(e)
  local flags = e:getFlags()
  if flags.fn then
    hs.eventtap.keyStroke({"cmd","alt","ctrl","shift"}, nil, 0)
    return true
  end
  return false
end)
hyper:start()
```

For a more robust implementation, install the [Karabiner-Elements](https://karabiner-elements.pqrs.org/) complex modifier; Hammerspoon's `eventtap` approach struggles with key repeat.

### Example 2 — Dock/undock automation

```lua
local layoutDocked = { ... }   -- hs.layout definitions
local layoutSolo   = { ... }

local function applyForScreens()
  local n = #hs.screen.allScreens()
  if n >= 2 then
    hs.layout.apply(layoutDocked)
    hs.alert("Docked layout")
  else
    hs.layout.apply(layoutSolo)
    hs.alert("Solo layout")
  end
end

local screenWatcher = hs.screen.watcher.new(applyForScreens):start()
applyForScreens()
```

### Example 3 — Slack status by calendar

Combine `hs.task` + `hs.json` + a shell call to your calendar CLI:

```lua
hs.timer.doEvery(300, function()
  hs.task.new("/opt/homebrew/bin/icalBuddy",
    function(exitCode, stdout, stderr)
      if exitCode ~= 0 then return end
      local inMeeting = stdout:match("Right now")
      if inMeeting then
        hs.execute([[shortcuts run "Set Slack DND"]])
      end
    end,
    {"eventsNow"}):start()
end)
```

### Example 4 — Swap an HDMI-triggered soundbar

```lua
local function onUSB(data)
  if data.productName == "USB Audio" and data.eventType == "added" then
    hs.audiodevice.findOutputByName("Living Room"):setDefaultOutputDevice()
  end
end
local usb = hs.usb.watcher.new(onUSB):start()
```

### Example 5 — JSON IPC with external scripts

Expose a URL handler so Shortcuts.app or CLI scripts can trigger Lua:

```lua
hs.urlevent.bind("layout", function(_, params)
  if params.name == "writing" then
    require("modules.layouts").writing()
  end
end)
```

Trigger from the shell:

```bash
open "hammerspoon://layout?name=writing"
```

## Hands-On Exercises

1. **Watcher audit.** Write a debug helper that lists every active watcher and timer in your config.
2. **Hot-reload safety.** Modify your hot-reload path watcher to diff `init.lua` bytes and skip reload if only whitespace changed.
3. **Layout parity.** Port one of your [[moom-deep-dive|Moom]] snapshots to a pure `hs.layout.apply` definition. Benchmark the apply time against Moom's.
4. **Spoon from scratch.** Build a `BatteryAlert.spoon` that notifies at 20% / 10% / 5%, with a `bindHotkeys` method exposing a "dismiss today" toggle.
5. **Space bridge.** Write a function that moves the focused window to the next Space by shelling out to `yabai -m window --space next`. Handle the case where Yabai isn't running.
6. **Memory test.** Start 200 watchers, then stop and nil them. Verify RSS returns close to baseline via `ps -o rss= -p $(pgrep Hammerspoon)`.
7. **URL API.** Add three URL-event handlers (`focus`, `layout`, `quit-all`) and call them from a Shortcut triggered by Stream Deck.

## Troubleshooting

**Console shows `LuaSkin: attempt to call a nil value`.**
A macOS update changed an API signature, or you're calling a deprecated method. Check the Hammerspoon release notes.

**Hotkeys stop working after macOS update.**
Revisit System Settings → Privacy & Security → Accessibility, Input Monitoring, Screen Recording. All three can silently reset.

**`hs.reload()` produces duplicated watchers.**
You aren't stopping watchers on reload. Solution: keep them in a module-level table and write a cleanup function invoked via `hs.shutdownCallback = function() ... end`.

**Window `setFrame` returns but the window doesn't move.**
Common causes:

- The app is a Java Swing / Electron app with custom frame behavior. Add `hs.window.animationDuration = 0` and call `setFrame` twice.
- The target window is on a different Space; `setFrame` works but you're looking at the wrong Space.
- Full-screen app — `setFrame` is a no-op.

**`hs.task` hangs macOS.**
You probably invoked a blocking shell call on the main thread via `hs.execute` instead of `hs.task.new`. Use `hs.task` for anything slower than a few ms.

**Caps Lock hyper eats repeat events.**
Use Karabiner-Elements for the remap; Hammerspoon's event tap is fine for chords but not for held-key repeat.

**"Hammerspoon is running slowly."**
Open the console → run `hs.hsdocs()` to confirm the bridge is responsive. If `hs.application.runningApplications()` is slow, you likely have an `hs.application.watcher` callback that's doing heavy work synchronously.

**Code runs twice after save.**
Your path watcher and the menu-bar reload are both firing. Pick one.

## Analyzing your existing `~/.hammerspoon` config

The source request asked for a review of your `~/.hammerspoon` directory. That directory lives outside this automated job's sandbox, so an automatic scan wasn't possible. Run the following yourself and compare against the checklist:

```bash
# Size and inventory
ls -la ~/.hammerspoon
tree ~/.hammerspoon -L 2

# Lint your Lua (install luacheck: `brew install luacheck`)
luacheck ~/.hammerspoon/

# Find stale watchers / missing references
grep -rn "hs\.\(wifi\|screen\|application\|pathwatcher\|usb\|audiodevice\)\.watcher" ~/.hammerspoon | \
  grep -v "local "

# Inventory bound hotkeys (detect collisions with Moom, Raycast, etc.)
grep -rn "hs\.hotkey\.bind" ~/.hammerspoon
```

**Improvement checklist to apply to any existing config:**

1. **Modularize.** If `init.lua` is over ~200 lines, split into `modules/`.
2. **Reserve a modifier.** Use `⌘⌥⌃⇧` (hyper) exclusively for Hammerspoon so nothing collides with [[moom-deep-dive|Moom]], Raycast, or Zed.
3. **Retain watchers.** Every `watcher.new(...)` must be stored in a variable that lives for the config's lifetime.
4. **Hot-reload.** Install `ReloadConfiguration.spoon` or a custom `hs.pathwatcher`.
5. **Guard `hs.window.focusedWindow()`** — always `nil`-check.
6. **Version control.** `~/.hammerspoon` belongs in [[chezmoi-deep-dive|chezmoi]] or a bare git repo.
7. **Prune Spoons.** Delete unused `.spoon` directories; they still load `hs.loadSpoon` by default on some configs.
8. **Remove `os.execute`.** Replace with `hs.task.new` to avoid blocking the main thread.
9. **Animation budget.** Set `hs.window.animationDuration = 0` for snappy window moves.
10. **Logging.** Use `hs.logger.new("area", "info")` rather than `print`; you can turn modules up to `debug` without editing code.

## References

- Hammerspoon home — https://www.hammerspoon.org
- API reference — https://www.hammerspoon.org/docs/
- Getting started — https://www.hammerspoon.org/go/
- Spoons index — https://www.hammerspoon.org/Spoons/
- Source — https://github.com/Hammerspoon/hammerspoon
- Mailing list / discussions — https://groups.google.com/g/hammerspoon
- LuaJIT manual — https://luajit.org/luajit.html
- Lua 5.1 reference — https://www.lua.org/manual/5.1/
- macOS Accessibility overview — https://developer.apple.com/documentation/appkit/nsaccessibility
- Karabiner-Elements — https://karabiner-elements.pqrs.org

## Related Tutorials

- [[hammerspoon-beginner-guide]] — the starter guide
- [[moom-deep-dive]] — pairing Hammerspoon with Moom for geometry
- [[moom-beginner-guide|Moom Beginner Guide]]
- [[bunch-deep-dive]] — driving Bunch files from Hammerspoon hotkeys
- [[bunch-beginner-guide|Bunch Beginner Guide]]
- [[yabai-beginner-guide|Yabai Beginner Guide]] — tiling manager often paired with Hammerspoon
- [[yabai-deep-dive]] — Yabai internals, IPC, and Hammerspoon bridging
- [[sketchybar-beginner-guide|Sketchybar Beginner Guide]] — Hammerspoon can push events to Sketchybar
- [[macos-app-layout-deep-dive]] — the full stack this fits into
- [[dotfiles-deep-dive]] — versioning `~/.hammerspoon`
- [[chezmoi-deep-dive]] — templated configs across machines
- [[linux-permissions-beginner-guide]] — permission concepts that transfer to macOS TCC
- [[karabiner-elements-beginner-guide|Karabiner-Elements Beginner Guide]] — build Hyper/Meh keys to pair with Hammerspoon hotkeys
- [[karabiner-elements-deep-dive|Karabiner-Elements Deep Dive]] — shell_command integration, variables, and modal layers alongside Hammerspoon

## Summary

Hammerspoon is the closest thing macOS has to a first-class scripting environment for the whole OS. Its event-driven model, combined with LuaJIT's performance, makes it a sound choice for any automation that would otherwise require duct-taping AppleScript, `osascript`, and Shortcuts.app together.

**Key takeaways:**

- Single-threaded Lua runtime on top of macOS frameworks; design accordingly
- Watchers need stored references, or GC kills them silently
- Spoons are your reuse unit — write them, commit them, share them
- Hot-reload on file save is the single biggest ergonomics win
- Use Hammerspoon as the *event router* — delegate geometry to [[moom-deep-dive|Moom]], app launches to [[bunch-deep-dive|Bunch]], tiling to [[yabai-deep-dive|Yabai]]
- The Spaces API limitation is a macOS constraint, not a Hammerspoon one

**Next steps:** modularize your config, version-control it with [[chezmoi-deep-dive|chezmoi]], prune unused Spoons, and pick one of the hands-on exercises above as your next Saturday-morning project.
# Related Tutorials

- [[maestri-beginner-guide|Maestri Beginner Guide]] — AI agent orchestration canvas; can be launched and controlled alongside Hammerspoon automation
- [[maestri-deep-dive|Maestri Deep Dive]] — Advanced Maestri workflows that complement Hammerspoon for macOS automation
