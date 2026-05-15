---
title: Sketchybar — Deep Dive
date: 2026-04-15
difficulty: advanced
tags: [macos, sketchybar, status-bar, lua, sbarlua, animations, yabai, performance]
---

# Sketchybar — Deep Dive

## Overview

Sketchybar is a C program that draws an arbitrary status bar on macOS using CoreGraphics and subscribes to system notifications via the Mach / distributed notification layer. Unlike menu-bar extras or SwiftUI apps, Sketchybar has a minuscule resident set (typically under 15 MB) and sub-millisecond draw latency. Its configuration language is shell-first, but with `SbarLua` it also supports a Lua API for composable, stateful configurations.

This deep-dive covers Sketchybar's architecture, the event model and its interactions with macOS notification sources, performance characteristics, advanced animations, the Lua plugin (`SbarLua`), multi-display strategies, and deep integration with [[yabai-deep-dive|Yabai]] and [[hammerspoon-deep-dive|Hammerspoon]].

### What you will learn

- How Sketchybar draws and updates
- Event sources and how to add custom ones
- Shell-based vs. Lua-based configurations: tradeoffs
- Performant plugin patterns (caching, batching, event debouncing)
- Multi-display and notch handling
- Deep Yabai integration: signals, state sync, space / display items
- Animations, bracketed groups, and layered compositing

## Prerequisites

- Completed [[sketchybar-beginner-guide]]
- Comfort with bash/zsh scripting and `jq`
- Familiarity with macOS notification types (NSWorkspace, CoreAudio, IOKit)
- Optional but recommended: Lua (Lua 5.4)
- Running [[yabai-beginner-guide|Yabai]] to exercise integration examples

## Key Concepts

### Process and draw model

```
┌───────────────────────────────────────────────┐
│  sketchybar daemon (C)                        │
│   ├─ Mach notification listener               │
│   ├─ Item registry (tree: bar → brackets → items) │
│   ├─ Animation engine (tanh, sin2, flip, ...) │
│   └─ CGContext renderer (per-display layer)   │
├───────────────────────────────────────────────┤
│  Plugins (shell scripts or Lua via sbarlua)   │
├───────────────────────────────────────────────┤
│  macOS: NSDistributedNotificationCenter,      │
│         NSWorkspace, IOKit, CoreAudio, WiFi    │
└───────────────────────────────────────────────┘
```

The daemon maintains an item tree. `--set` commands mutate item state; an invalidation flag triggers redraw at up to 60 Hz. Animation interpolates property values over a tick count.

### Event sources

Built-in event sources:

| Event                     | Trigger                                      |
| ------------------------- | -------------------------------------------- |
| `front_app_switched`      | `NSWorkspace` active app change              |
| `space_change` (from Yabai)| Custom, pushed by Yabai signal              |
| `display_change`          | Display add/remove                           |
| `system_woke`             | IOKit wake                                   |
| `power_source_change`     | Battery source change                        |
| `volume_change`           | CoreAudio output volume                      |
| `brightness_change`       | IOKit display brightness                     |
| `wifi_change`             | SCDynamicStore wifi change                   |
| `mouse.clicked` / `mouse.entered` / `mouse.exited` | per-item mouse events |

Custom events are added with `sketchybar --add event NAME [PATTERN]`. If the optional `PATTERN` is given, Sketchybar also listens for the corresponding `NSDistributedNotification` and fires your event automatically.

### Item types

- **item** — default, shows icon + label
- **bracket** — groups other items to share properties (background, drawing, animation)
- **alias** — mirrors a macOS menu extra (e.g., system clock, battery), sampled via private CG window-list access
- **graph** — histogram-style graph for numeric values
- **space** — built-in space item with Mission Control API hooks
- **slider** — horizontal slider with knob; pairs well with volume/brightness

### Bracket composition

Brackets let you style a group:

```bash
sketchybar --add bracket status battery wifi volume \
           --set   status background.color=0x44585b70 \
                          background.corner_radius=8 \
                          background.height=26
```

Now battery / wifi / volume share a single pill background, regardless of their individual drawing.

## Step-by-Step Instructions

### 1. Layout architecture

Organize configuration so `sketchybarrc` is a thin orchestrator:

```
~/.config/sketchybar/
├── sketchybarrc
├── colors.sh
├── icons.sh
├── bar.sh
├── default.sh
├── items/
│   ├── front_app.sh
│   ├── clock.sh
│   ├── battery.sh
│   ├── spaces.sh
│   └── media.sh
└── plugins/
    ├── front_app.sh
    ├── clock.sh
    ├── battery.sh
    ├── space.sh
    └── media.sh
```

`sketchybarrc`:

```bash
#!/usr/bin/env bash
CONFIG_DIR="$HOME/.config/sketchybar"

source "$CONFIG_DIR/colors.sh"
source "$CONFIG_DIR/icons.sh"
source "$CONFIG_DIR/bar.sh"
source "$CONFIG_DIR/default.sh"

ITEM_DIR="$CONFIG_DIR/items"
for f in "$ITEM_DIR"/*.sh; do source "$f"; done

sketchybar --update
```

### 2. Use SbarLua for stateful configs

`SbarLua` embeds Lua 5.4 into Sketchybar:

```bash
brew install FelixKratz/formulae/sbarlua
```

Create `~/.config/sketchybar/sketchybarrc` (now a shim):

```bash
#!/usr/bin/env bash
lua "$HOME/.config/sketchybar/init.lua"
```

`init.lua`:

```lua
require("sketchybar")

sbar.bar({
  height   = 36,
  position = "top",
  color    = 0xff1e1e2e,
  padding_left  = 8,
  padding_right = 8,
})

sbar.default({
  updates = "when_shown",
  icon = { font = "Hack Nerd Font:Bold:14.0", color = 0xffcdd6f4 },
  label = { font = "Hack Nerd Font:Bold:12.0", color = 0xffcdd6f4 },
})

require("items.front_app")
require("items.clock")
require("items.battery")
require("items.spaces")
```

Items become Lua tables with event handlers:

```lua
-- items/clock.lua
local clock = sbar.add("item", "clock", {
  position = "right",
  update_freq = 10,
  icon = { string = "" },
})

clock:subscribe({"routine", "forced"}, function()
  clock:set({ label = os.date("%a %b %-d  %-I:%M %p") })
end)

return clock
```

Payoff: no plugin-per-item shell overhead, tight control, access to Lua state across events.

### 3. Animated space item (Yabai integration)

`items/spaces.lua`:

```lua
local colors = require("colors")

for i = 1, 10 do
  local space = sbar.add("space", "space." .. i, {
    space = i,
    icon = { string = tostring(i), padding_left = 10, padding_right = 10 },
    label = { drawing = false },
    background = {
      color = colors.bg1,
      corner_radius = 6,
      height = 26,
      drawing = false,
    },
    padding_left = 4,
    padding_right = 4,
  })

  space:subscribe("space_change", function(env)
    local selected = env.SELECTED == "true"
    space:set({
      icon = { color = selected and colors.bg0 or colors.fg },
      background = {
        drawing = selected,
        color = selected and colors.pink or colors.bg1,
      },
    })
  end)

  space:subscribe("mouse.clicked", function()
    sbar.exec("yabai -m space --focus " .. i)
  end)
end
```

And Yabai's `yabairc`:

```bash
yabai -m signal --add event=space_changed    action="sketchybar --trigger space_change SELECTED=true SID=\$YABAI_SPACE_ID"
yabai -m signal --add event=window_focused   action="sketchybar --trigger window_focus"
yabai -m signal --add event=display_changed  action="sketchybar --trigger display_change"
```

### 4. Front app icon font

Use the `sketchybar-app-font` to show real app glyphs by bundle ID:

```lua
local app_icons = require("helpers.app_icons")

sbar.add("item", "front_app", {
  position = "left",
  icon = { font = "sketchybar-app-font:Regular:16.0", y_offset = 1 },
  label = { drawing = true },
}):subscribe("front_app_switched", function(env)
  local icon = app_icons[env.INFO] or ":default:"
  sbar.exec("sketchybar --set front_app icon=" .. icon .. " label=\"" .. env.INFO .. "\"")
end)
```

### 5. Animations

Shell-level:

```bash
sketchybar --animate tanh 30 \
           --set front_app label.color=0xfff38ba8
```

Lua-level:

```lua
sbar.animate("tanh", 30, function()
  item:set({ label = { color = 0xfff38ba8 } })
end)
```

Easing functions available: `linear`, `quadratic`, `tanh`, `sin`, `circ`, `over`. Tick counts map to frames at ~60 fps.

### 6. Multi-display

Sketchybar draws one bar per display by default. Control which displays show the bar:

```bash
sketchybar --bar display=all        # every display
sketchybar --bar display=main       # only primary
sketchybar --bar display=1,2        # specific indices
```

For per-item display targeting:

```bash
sketchybar --set front_app display=active  # only the display with mouse focus
```

Combined with Yabai `display_change` events, you can build a bar that redraws when monitors are attached.

### 7. Performance patterns

- **Prefer `--subscribe` over `update_freq`**. A CPU item polling every second costs ~1% CPU; subscribing to a custom Yabai event costs nothing at idle.
- **Batch `--set`**. One call with 10 arguments is cheaper than 10 calls with 1 argument.
- **Debounce**. If an event fires 60×/sec during a drag, update every 5th invocation by tracking ticks.
- **Cache** slow reads. For the battery plugin, cache `pmset` output for 30 seconds.
- **Exit plugins fast**. If a plugin sleeps or blocks on network, queue it with `&` or move to Lua with async shell.

## Practical Examples

### Example 1 — Media player with album-art preview

Use `osascript` to poll Spotify / Music, populate an item, and on click open a popup showing the artwork.

```lua
local media = sbar.add("item", "media", { position = "right" })

media:subscribe({"media_change", "routine"}, function()
  local script = [[
    tell application "Music"
      if player state is playing then
        return (name of current track) & " — " & (artist of current track)
      end if
    end tell
  ]]
  local out = sbar.exec("osascript -e '"..script.."'")
  if out and #out > 0 then media:set({ label = out }) end
end)
```

Trigger `media_change` from Hammerspoon's `hs.spotify.watcher` or similar.

### Example 2 — Popup menus

```lua
local wifi = sbar.add("item", "wifi", { position = "right" })
local wifi_pop = sbar.add("item", "wifi.popup", {
  position = "popup.wifi",
  label = { string = "(connecting...)" },
})

wifi:subscribe("mouse.clicked", function()
  wifi:set({ popup = { drawing = "toggle" } })
end)
```

### Example 3 — Graph items

```lua
local cpu = sbar.add("graph", "cpu", 50, {
  position = "right",
  graph = { color = 0xfff38ba8 },
  update_freq = 2,
})

cpu:subscribe("routine", function()
  local usage = tonumber(sbar.exec("ps -A -o %cpu | awk '{s+=$1} END {print s}'"))
  cpu:push({ (usage or 0) / 100 })
  cpu:set({ label = string.format("%.0f%%", usage or 0) })
end)
```

### Example 4 — Hotload on file change

With [[hammerspoon-deep-dive|Hammerspoon]]:

```lua
hs.pathwatcher.new(os.getenv("HOME") .. "/.config/sketchybar/", function()
  hs.execute("/opt/homebrew/bin/sketchybar --reload")
end):start()
```

### Example 5 — Notch-aware padding

macOS laptops with a notch report their `SafeAreaInsets`. Wrap your bar height:

```bash
sketchybar --bar height=38 y_offset=-4 margin=0 padding_left=250 padding_right=250
```

Adjust paddings to leave room for the notch. Or split into two bars: one on top (lower portion of screen) via `y_offset`.

## Hands-On Exercises

1. **Convert to Lua.** Port one of your shell items to Lua using SbarLua. Measure startup time.
2. **Animation showcase.** Implement `front_app` such that on change, the label slides out right with `tanh 15` and slides in left.
3. **Space coloring.** Extend the space item to color itself by currently focused app's type (browser, editor, chat).
4. **Dynamic theme.** Add a hotkey that cycles between 3 color schemes without full reload, animating the transition.
5. **Graph item.** Build a network throughput graph (Rx/Tx bytes/sec) sampled from `netstat -ib`.
6. **Popup calendar.** Clicking the clock opens a popup showing the next 5 calendar events (via `icalBuddy`).
7. **Health check.** Write a `plugins/healthcheck.sh` that verifies PATH, fonts, and yabai socket and prints diagnostics.

## Troubleshooting

**`sketchybar-app-font` glyphs don't show.**
Font may be cached by macOS. `atsutil databases -remove` (then log out/in) forces a rebuild.

**`display=active` doesn't update when switching displays.**
Subscribe the affected items to `display_change` and re-issue `--set display=active`.

**Plugins block the UI.**
Any plugin longer than ~50 ms shows as stutter. Background with `&`, or move to Lua with async shell:
```lua
sbar.exec("curl -s slow.example.com", function(result) ... end)
```

**Lua plugin throws `bad argument`.**
`sbar.add` returns a table; ensure you capture it. Calling `:subscribe` on a nil reference throws confusing errors.

**Bar disappears after macOS update.**
Permissions drift (Accessibility, Screen Recording). Revisit System Settings → Privacy & Security.

**Yabai `external_bar` gap wrong after adding a new item.**
Height of bar might have changed if an item set `--set default icon.font=...` with larger size. Recompute: bar height should match `external_bar`.

**Popup doesn't close.**
You probably toggled `drawing = "on"` instead of `"toggle"`. Or another item is re-toggling it on each frame.

**Animations stutter.**
Heavy plugin callbacks starve the animation frame. Move work off the main thread.

**Custom notification doesn't fire.**
`--add event NAME NSDistributedNotificationName` requires the pattern to match exactly, including sender. Use `log stream --predicate 'sender == "NSDistributedNotificationCenter"'` to confirm.

## Performance targets

- Idle CPU: < 0.5%
- Event latency (trigger → draw): < 16 ms
- Memory: < 30 MB RSS
- Plugin execution: ≤ 5 ms p95

If you exceed any of these, audit event subscriptions and plugin shell costs.

## References

- Sketchybar docs — https://felixkratz.github.io/SketchyBar/
- Source — https://github.com/FelixKratz/SketchyBar
- SbarLua — https://github.com/FelixKratz/SbarLua
- Sketchybar-app-font — https://github.com/kvndrsslr/sketchybar-app-font
- Yabai integration — https://github.com/asmvik/yabai/wiki/Commands#signal
- macOS distributed notifications — https://developer.apple.com/documentation/foundation/nsdistributednotificationcenter

## Related Tutorials

- [[sketchybar-beginner-guide]] — first-time setup
- [[yabai-beginner-guide|Yabai Beginner Guide]]
- [[yabai-deep-dive]] — signal integration in depth
- [[hammerspoon-beginner-guide|Hammerspoon Beginner Guide]]
- [[hammerspoon-deep-dive]] — custom events, path watching, trigger Sketchybar updates
- [[dotfiles-deep-dive]] — version `~/.config/sketchybar`
- [[chezmoi-deep-dive]] — templated color schemes per machine
- [[macos-app-layout-deep-dive]] — Sketchybar's role in the window-manager stack
- [[moom-deep-dive]] — snap alternative; Sketchybar can show Moom snapshot name
- [[karabiner-elements-deep-dive|Karabiner-Elements Deep Dive]] — Hyper/Meh key shortcuts to trigger Sketchybar events

## Summary

Sketchybar is a small, fast, highly programmable status bar. Used alone it replaces the macOS menu bar with something you control pixel-by-pixel. Used with [[yabai-deep-dive|Yabai]] and [[hammerspoon-deep-dive|Hammerspoon]], it becomes the visible surface of an entirely custom desktop environment.

**Key takeaways:**

- The item tree, events, and animation ticks are the three primitives
- Shell plugins are simple; SbarLua is better for stateful configs
- Event-driven items scale; polling items don't
- Yabai signals are the canonical trigger source for space / window / display state
- Budget ~5ms per plugin; exceeding that shows as perceptible stutter

**Next steps:** migrate shell plugins to SbarLua, add animated brackets around grouped items, wire Yabai signals for space and display changes, and version-control the whole `~/.config/sketchybar` directory with [[chezmoi-deep-dive|chezmoi]].
