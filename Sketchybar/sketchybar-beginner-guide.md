---
title: Sketchybar — Beginner's Guide
date: 2026-04-15
difficulty: beginner
tags: [macos, sketchybar, status-bar, customization, menubar, ricing]
---

# Sketchybar — Beginner's Guide

## Overview

Sketchybar is a highly customizable replacement — or augmentation — for the macOS menu bar. Written in C by Felix Kratz, it draws its own status bar, fully controllable from shell scripts: background colors, icons, fonts, animations, per-item update intervals, and event subscriptions. If you've seen screenshots of beautifully themed macOS desktops with a Linux-like status bar at the top, you've seen Sketchybar.

Sketchybar pairs exceptionally well with [[yabai-beginner-guide|Yabai]] — Yabai can push events (space changed, window focused, display changed) that Sketchybar responds to.

By the end of this guide you'll have Sketchybar installed, running as a LaunchAgent, and displaying: the current date, battery, focused app, and Yabai space indicators.

## Prerequisites

- macOS 12+ (macOS 14+ recommended; macOS 26 supported)
- [Homebrew](https://brew.sh)
- Comfort with the terminal and basic shell scripting
- A [Nerd Font](https://www.nerdfonts.com/) for icon glyphs (we'll install SF Symbols helper and Hack Nerd Font)
- Optional: [[yabai-beginner-guide|Yabai]] installed for space-aware items
- Optional: a [[dotfiles-beginner-guide|dotfiles]] workflow

## Key Concepts

**Bar.** The top-level container. Height, position, color, padding are bar-level properties.

**Items.** Units of content — a clock, a battery indicator, a space button. Each item has a name, position (`left` | `right` | `center`), update frequency, script, and optional event subscriptions.

**Plugins.** Shell scripts that an item's `script` property invokes. They use environment variables provided by Sketchybar (`$NAME`, `$SELECTED`, `$SENDER`, ...) and call `sketchybar --set ...` to update appearance.

**Events.** Named signals an item subscribes to. Built-in events include `system_woke`, `front_app_switched`, `volume_change`, `brightness_change`, `wifi_change`. Custom events can be added (`sketchybar --add event my_event`) and triggered (`sketchybar --trigger my_event`). Yabai publishes custom events by calling `sketchybar --trigger`.

**Animation.** Sketchybar supports smooth animations (`--animate tanh 30 ...`).

## Step-by-Step Instructions

### 1. Install Sketchybar

```bash
brew tap FelixKratz/formulae
brew install sketchybar
```

### 2. Install a Nerd Font

```bash
brew install --cask font-hack-nerd-font
brew install --cask sf-symbols
```

Sketchybar ships a companion app font (`sketchybar-app-font`) for consistent app icons:

```bash
curl -L https://github.com/kvndrsslr/sketchybar-app-font/releases/download/v2.0.31/sketchybar-app-font.ttf \
  -o ~/Library/Fonts/sketchybar-app-font.ttf
```

### 3. Create the config skeleton

```bash
mkdir -p ~/.config/sketchybar/plugins
touch ~/.config/sketchybar/sketchybarrc
chmod +x ~/.config/sketchybar/sketchybarrc
```

### 4. Starter `sketchybarrc`

```bash
#!/usr/bin/env bash

# ----- bar -----
sketchybar --bar height=36 \
                 position=top \
                 padding_left=8 \
                 padding_right=8 \
                 color=0xff1e1e2e \
                 border_width=0 \
                 blur_radius=0 \
                 sticky=on \
                 topmost=off

# ----- defaults -----
sketchybar --default updates=when_shown \
                     icon.font="Hack Nerd Font:Bold:14.0" \
                     label.font="Hack Nerd Font:Bold:12.0" \
                     icon.color=0xffcdd6f4 \
                     label.color=0xffcdd6f4 \
                     padding_left=5 \
                     padding_right=5 \
                     label.padding_left=4 \
                     label.padding_right=4 \
                     icon.padding_left=4 \
                     icon.padding_right=4

# ----- left items -----

# Apple logo
sketchybar --add item apple.logo left \
           --set   apple.logo icon="" \
                               icon.font="Hack Nerd Font:Bold:18.0" \
                               icon.color=0xfff38ba8 \
                               label.drawing=off

# Front app
sketchybar --add item front_app left \
           --set   front_app script="$CONFIG_DIR/plugins/front_app.sh" \
                             icon.drawing=off \
           --subscribe front_app front_app_switched

# ----- right items -----

sketchybar --add item clock right \
           --set   clock update_freq=10 \
                          icon="" \
                          script="$CONFIG_DIR/plugins/clock.sh"

sketchybar --add item battery right \
           --set   battery update_freq=120 \
                            script="$CONFIG_DIR/plugins/battery.sh" \
           --subscribe battery system_woke power_source_change

# ----- apply -----
sketchybar --update

echo "sketchybar: configuration loaded"
```

Note: `$CONFIG_DIR` is automatically set to the directory containing `sketchybarrc`.

### 5. Plugin scripts

`~/.config/sketchybar/plugins/clock.sh`:

```bash
#!/usr/bin/env bash
sketchybar --set "$NAME" label="$(date '+%a %b %-d  %-I:%M %p')"
```

`~/.config/sketchybar/plugins/front_app.sh`:

```bash
#!/usr/bin/env bash
if [ "$SENDER" = "front_app_switched" ]; then
  sketchybar --set "$NAME" label="$INFO"
fi
```

`~/.config/sketchybar/plugins/battery.sh`:

```bash
#!/usr/bin/env bash
PCT=$(pmset -g batt | grep -Eo "[0-9]+%" | cut -d% -f1)
CHARGING=$(pmset -g batt | grep 'AC Power')

if [ "$PCT" = "" ]; then exit 0; fi

case ${PCT} in
  9[0-9]|100) ICON="";;
  [6-8][0-9]) ICON="";;
  [3-5][0-9]) ICON="";;
  [1-2][0-9]) ICON="";;
  *)          ICON="";;
esac

[ -n "$CHARGING" ] && ICON=""

sketchybar --set "$NAME" icon="$ICON" label="${PCT}%"
```

Make them executable:

```bash
chmod +x ~/.config/sketchybar/plugins/*.sh
```

### 6. Start Sketchybar as a service

```bash
brew services start sketchybar
```

You should see the bar appear at the top of your screen. If you already have the macOS menu bar showing, Sketchybar will sit on top of it — enable **auto-hide menu bar** in System Settings → Control Center for a clean look.

### 7. Reload on edit

```bash
sketchybar --reload
```

Alias in your shell:

```bash
alias sbr="sketchybar --reload"
```

## Practical Examples

### Example 1 — Yabai spaces

Install this only if you have [[yabai-beginner-guide|Yabai]] running.

In `sketchybarrc`:

```bash
SPACE_ICONS=("1" "2" "3" "4")

for i in "${!SPACE_ICONS[@]}"; do
  sid=$((i+1))
  sketchybar --add space space."$sid" left \
             --set space."$sid" space="$sid" \
                                icon="${SPACE_ICONS[$i]}" \
                                icon.padding_left=8 \
                                icon.padding_right=8 \
                                background.color=0x44585b70 \
                                background.corner_radius=5 \
                                background.height=24 \
                                background.drawing=off \
                                script="$CONFIG_DIR/plugins/space.sh" \
             --subscribe space."$sid" space_change
done
```

`plugins/space.sh`:

```bash
#!/usr/bin/env bash
if [ "$SELECTED" = "true" ]; then
  sketchybar --set "$NAME" background.drawing=on icon.color=0xff1e1e2e \
                           background.color=0xfff38ba8
else
  sketchybar --set "$NAME" background.drawing=off icon.color=0xffcdd6f4
fi
```

In your Yabai `yabairc`:

```bash
yabai -m signal --add event=space_changed action="sketchybar --trigger space_change"
```

### Example 2 — CPU usage

```bash
sketchybar --add item cpu right \
           --set   cpu update_freq=5 \
                        script="$CONFIG_DIR/plugins/cpu.sh" \
                        icon=""
```

`plugins/cpu.sh`:

```bash
#!/usr/bin/env bash
USAGE=$(ps -A -o %cpu | awk '{s+=$1} END {printf "%.0f", s}')
sketchybar --set "$NAME" label="${USAGE}%"
```

### Example 3 — Volume slider

```bash
sketchybar --add slider volume right 100 \
           --set   volume script="$CONFIG_DIR/plugins/volume.sh" \
                          slider.highlight_color=0xfff38ba8 \
                          slider.background.height=6 \
                          slider.background.corner_radius=3 \
                          slider.background.color=0xff45475a \
                          slider.knob=􀀁 \
           --subscribe volume volume_change
```

`plugins/volume.sh`:

```bash
#!/usr/bin/env bash
if [ "$SENDER" = "volume_change" ]; then
  sketchybar --set "$NAME" slider.percentage="$INFO"
fi
```

### Example 4 — Weather

```bash
sketchybar --add item weather right \
           --set   weather update_freq=900 \
                            script="$CONFIG_DIR/plugins/weather.sh"
```

```bash
#!/usr/bin/env bash
W=$(curl -s 'wttr.in/?format=%t+%c' 2>/dev/null)
[ -n "$W" ] && sketchybar --set "$NAME" label="$W"
```

## Hands-On Exercises

1. **Theme switch.** Duplicate your `sketchybarrc` as `sketchybarrc.light` and `sketchybarrc.dark`. Write an alias that symlinks the active one and reloads.
2. **Rounded bar.** Give the bar corner radius, padding, and a margin so it floats below the display edge.
3. **Space item.** If you run Yabai, implement the space item from Example 1 and confirm the active space updates on `⌥ 1..4`.
4. **Battery threshold alert.** Modify `battery.sh` to turn the icon red when below 20%.
5. **Media player.** Build an item that shows the currently playing track, using `osascript` against `Music.app` or Spotify.
6. **Custom event.** Create a `my_pomodoro` event; trigger it from a shell script; have a sketchybar item update its label in response.
7. **Focus animation.** Make the `front_app` label fade in with `--animate tanh 20 front_app label.color=...`.

## Troubleshooting

**Bar doesn't appear.**
Check the service: `brew services list | grep sketchybar`. If it's `error`, look at the log: `tail -f /opt/homebrew/var/log/sketchybar/sketchybar.out.log`.

**Icons show as boxes or question marks.**
Missing Nerd Font or wrong font name. Run `fc-list | grep -i nerd` and fix the `icon.font` string accordingly.

**Sketchybar overlaps macOS menu bar.**
Set System Settings → Control Center → Automatically hide and show the menu bar → **Always**. Adjust `sketchybar --bar y_offset=0 margin=0`.

**Yabai and Sketchybar leave a gap or clip.**
In Yabai: `yabai -m config external_bar all:36:0` where 36 is Sketchybar's height.

**`sketchybar: command not found` inside a plugin.**
Plugins run in a minimal shell. Use the full path: `/opt/homebrew/bin/sketchybar`, or set `PATH` at the top of the plugin.

**Plugin fires but nothing changes.**
You may be missing quotes around `$NAME`. Always quote: `sketchybar --set "$NAME" label="$VALUE"`.

**High CPU.**
An item with `update_freq=1` and a slow script will burn CPU. Bump to 5+ seconds or switch to event-driven (`--subscribe`).

## References

- Sketchybar home — https://felixkratz.github.io/SketchyBar/
- GitHub — https://github.com/FelixKratz/SketchyBar
- Config docs — https://felixkratz.github.io/SketchyBar/config/bar
- Examples gallery — https://github.com/FelixKratz/SketchyBar#showcase
- App font — https://github.com/kvndrsslr/sketchybar-app-font
- Community config collection — https://github.com/FelixKratz/SketchyBar/discussions

## Related Tutorials

- [[sketchybar-deep-dive]] — lua plugin, advanced animations, event-driven design
- [[yabai-beginner-guide|Yabai Beginner Guide]] — the natural pairing
- [[yabai-deep-dive]] — signal integration with Sketchybar
- [[hammerspoon-beginner-guide|Hammerspoon Beginner Guide]] — can also drive Sketchybar via custom events
- [[hammerspoon-deep-dive]]
- [[dotfiles-beginner-guide]] — version your `~/.config/sketchybar`
- [[chezmoi-beginner-guide]] — templated themes per machine
- [[macos-app-layout-beginner-guide]]
- [[karabiner-elements-beginner-guide|Karabiner-Elements Beginner Guide]] — remap keys to launch Sketchybar interactions from Hyper/Meh shortcuts

## Summary

Sketchybar gives you a fully programmable status bar on macOS. It is less "configure a menu bar" and more "build your own HUD." Items are shell-scripted, event-driven, and animate smoothly.

**Key takeaways:**

- Bar defines global look; items define content; plugins define behavior
- Prefer `--subscribe` (event-driven) over `update_freq` (polling)
- Pair with [[yabai-beginner-guide|Yabai]] for a cohesive tiling-window workflow
- Nerd Fonts + SF Symbols give you an enormous icon library
- Version-control `~/.config/sketchybar` — it grows quickly

**Next steps:** theme the starter config to your taste, wire up Yabai space integration, and read [[sketchybar-deep-dive]] for the new Lua plugin system and animation details.
