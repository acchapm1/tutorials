---
title: Moom — Deep Dive
date: 2026-04-14
difficulty: advanced
tags: [macos, moom, window-management, applescript, jxa, accessibility, automation, hammerspoon, scripting]
---

# Moom — Deep Dive

## Overview

Moom is a mature, narrow tool: it resizes, moves, and saves arrangements of windows. The surface is small, but the corners are sharp. This deep dive covers how Moom interacts with macOS's Accessibility and Quartz Display Services APIs, the complete scripting surface (AppleScript and JXA), advanced integration patterns with Bunch, Shortcuts.app, Hammerspoon, and launchd, and the failure modes you'll only discover once you push Moom past "right-half, left-half."

Target reader: someone who has worked through [[moom-beginner-guide]] and wants a production-grade, scripted, multi-display, multi-Space layout system with predictable behavior across reboots, OS updates, and machine swaps.

By the end you'll understand the architecture Moom sits in, the precise semantics of snapshots vs. custom layouts, every scripting verb worth using, how to store Moom state in version control, and how to combine Moom with [[bunch-deep-dive|Bunch]], Hammerspoon, and launchd to build a zero-touch workspace.

## Prerequisites

- Comfortable with everything in [[moom-beginner-guide]]
- Familiarity with the macOS shell, `osascript`, and `defaults`
- Some AppleScript or JXA exposure
- Working knowledge of macOS TCC (Accessibility, Automation, Screen Recording)
- A dotfiles workflow ([[dotfiles-deep-dive]] or [[chezmoi-deep-dive]])
- Optional: Hammerspoon or `skhd` installed for advanced event-driven automations

## Key Concepts

### Where Moom sits in the macOS stack

```
┌──────────────────────────────────────────────────┐
│  Moom (window manager)                           │
├──────────────────────────────────────────────────┤
│  Accessibility API (AXUIElement)                 │
├──────────────────────────────────────────────────┤
│  Quartz Display Services (CGDisplay*)            │
├──────────────────────────────────────────────────┤
│  WindowServer (Apple-private)                    │
└──────────────────────────────────────────────────┘
```

- **AX API** is what Moom uses to read window positions and call `AXPosition`/`AXSize` setters. This requires the user to grant Accessibility via TCC. Without it, every setter is a silent no-op.
- **Quartz Display Services** is what Moom uses to detect display configurations (IDs, resolutions, arrangement) and to index snapshots by "which displays are attached."
- **WindowServer** is private. Nothing in userland — Moom included — can read Mission Control state, enumerate windows on inactive Spaces, or move windows between Spaces. This is the root cause of "the Spaces problem."

### Custom layouts vs. arrangements — the precise distinction

**Custom layouts:**
- Operate on the **frontmost window** at trigger time.
- Stateless — just a rule (position + size, optionally relative to display).
- Perfect for keyboard-driven nudging: "left half," "center," "top-right quarter."
- Triggered via hotkey, palette tile, or AppleScript (`tell application "Moom" to perform action "Left Half"` — syntax varies).

**Arrangements (snapshots):**
- Operate on **every window** in every running app visible at capture time.
- Stateful — they record exact (x, y, w, h) per window, keyed by window title and app.
- Tied to the **display configuration** that was active at capture. Plug in a new monitor and the old arrangement may not apply cleanly.
- Triggered via `arrange windows according to snapshot "Name"`.

Mixing the two: use layouts for "right now, put this here," arrangements for "restore my entire desktop."

### Display configurations and the "fingerprint"

Moom hashes the attached display set (IDs + resolutions + physical positions) into a fingerprint. Two snapshots captured against the same fingerprint can conflict; you'll see "this snapshot was captured against a different display configuration" if you restore across fingerprints.

Inspect your current configuration:

```bash
system_profiler SPDisplaysDataType | grep -E 'Display Type|Resolution|Online'
```

Moom uses these values internally via `CGDisplayRegisterReconfigurationCallback` — it gets a callback whenever displays change, which it uses to invalidate caches. It does **not**, by default, auto-apply snapshots on display change. That's a deliberate design choice; Shortcuts.app or Hammerspoon is where you wire that up.

### TCC grants that matter

- **Accessibility** — mandatory; without it, Moom is inert.
- **Automation** — required for cross-app AppleScript targeting Moom (e.g., a `(run)` line in Bunch, or a shell alias).
- **Screen Recording** — required only if you use Moom's "capture window screenshot to use as custom layout thumbnail" feature.

After a major macOS update, TCC sometimes loses these grants. Keep a one-liner handy for reset:

```bash
tccutil reset Accessibility com.manytricks.Moom
```

Then re-grant via System Settings.

## Step-by-Step Instructions (Advanced)

### 1. Build a disciplined custom-layout hotkey map

Sketch a layout grid before binding hotkeys. Example using `⌃⌥` as the "Moom" modifier:

| Hotkey      | Layout                               |
| ----------- | ------------------------------------ |
| `⌃⌥←`       | Left Half                            |
| `⌃⌥→`       | Right Half                           |
| `⌃⌥↑`       | Top Half                             |
| `⌃⌥↓`       | Bottom Half                          |
| `⌃⌥C`       | Center, 80% × 90%                    |
| `⌃⌥M`       | Move to next display, same rel size  |
| `⌃⌥F`       | Fullscreen (no animation)            |
| `⌃⌥Z`       | Revert (undo last Moom move)         |
| `⌃⌥1..9`    | Quarter / third custom layouts       |

Reserve `⌃⌥⌘ <digit>` for arrangement snapshots (see §2). Reserve `⌥⇧` for anything your IDE grabs; reserve `⌘⌥⌃⇧` for Hammerspoon global hotkeys.

### 2. Design arrangements per display fingerprint

Create one snapshot per canonical display fingerprint:

- `Laptop Solo` — built-in display only
- `Docked 27" 4K` — built-in + 27" external
- `Docked Dual 27"` — two externals, no built-in
- `Projector` — laptop + 1080p projector (demos)
- `Focus` — whatever displays you have, but only VS Code + Terminal visible

Rule: **don't save two snapshots against the same fingerprint** unless one is explicitly manual. Two same-fingerprint snapshots makes auto-apply ambiguous.

### 3. Script Moom with AppleScript

Inspect the full dictionary: **Script Editor → File → Open Dictionary → Moom**. The verbs that matter:

```applescript
-- Arrange by snapshot name
tell application "Moom"
    arrange windows according to snapshot "Docked 27\" 4K"
end tell

-- Enumerate all snapshots
tell application "Moom"
    return name of every snapshot
end tell

-- Invoke a named custom layout on the frontmost window
tell application "Moom"
    arrange windows according to action "Left Half"
end tell
```

Programmatic snapshot **creation** is not exposed — you must create snapshots through Moom's UI. But you can enumerate, arrange, and delete (via `delete` on `snapshot`).

### 4. Script Moom with JXA

```javascript
const Moom = Application('Moom');
Moom.arrangeWindowsAccordingToSnapshot('Docked 27" 4K');
const names = Moom.snapshots.name();
console.log(names.join('\n'));
```

JXA is sometimes easier to embed inside node scripts or Raycast/Alfred extensions. Remember to escape double-quotes if your snapshot name contains them.

### 5. Export and version Moom's settings

Moom stores its custom layouts and arrangements in `~/Library/Preferences/com.manytricks.Moom.plist`. Export via Moom's built-in export (Preferences → Custom → gear icon → Export) or copy the plist into your dotfiles:

```bash
# Capture
plutil -convert xml1 -o ~/dotfiles/Moom/com.manytricks.Moom.plist \
  ~/Library/Preferences/com.manytricks.Moom.plist

# Restore
plutil -convert binary1 -o ~/Library/Preferences/com.manytricks.Moom.plist \
  ~/dotfiles/Moom/com.manytricks.Moom.plist
defaults read com.manytricks.Moom >/dev/null   # force re-read
killall cfprefsd
```

If you use [[chezmoi-beginner-guide|chezmoi]], add the plist with `chezmoi add ~/Library/Preferences/com.manytricks.Moom.plist`; templates let you diverge per-host if your arrangements legitimately differ between machines.

### 6. Auto-apply on dock/undock — three paths

**Path A — Shortcuts.app (native, recommended):**

Automation → **When display is connected → LG UltraFine 5K** → **Run AppleScript**:

```applescript
tell application "Moom" to arrange windows according to snapshot "Docked"
```

Pair with **disconnected → Laptop Solo**. Zero maintenance, survives reboots.

**Path B — Hammerspoon (scriptable, cross-event):**

```lua
hs.screen.watcher.new(function()
  local count = #hs.screen.allScreens()
  local snap  = (count > 1) and "Docked" or "Laptop Solo"
  hs.execute("osascript -e 'tell application \"Moom\" to arrange windows according to snapshot \"" .. snap .. "\"'")
end):start()
```

Gives you full Lua control (include Wi-Fi SSID, time of day, battery state in the decision).

**Path C — `SleepWatcher` / `launchd` (scheduled, not event-driven):**

For "arrange every weekday at 9am":

```xml
<!-- ~/Library/LaunchAgents/com.acchapm.moom.morning.plist -->
<plist version="1.0">
<dict>
  <key>Label</key><string>com.acchapm.moom.morning</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/osascript</string>
    <string>-e</string>
    <string>tell application "Moom" to arrange windows according to snapshot "Docked"</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
    <!-- repeat for Weekday 2..5 -->
  </array>
</dict>
</plist>
```

Load with `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.acchapm.moom.morning.plist`.

### 7. Chain Moom with Bunch

A bunch that launches apps, pauses, arranges:

```text
?Slack
?Mail
?Safari
?Visual Studio Code

(sleep 2)
(run)osascript -e 'tell application "Moom" to arrange windows according to snapshot "Coding"'
```

The `?` prefix means "only if not already running" — re-runs are fast. See [[bunch-deep-dive]] for the full Bunch repertoire.

### 8. Capture + restore at scene boundaries

Treat snapshots like git stashes for your desktop:

```bash
# Before a demo — save current state
osascript -e 'tell application "Moom" to save snapshot "Pre-Demo"'  # NB: may require UI workaround; see Troubleshooting

# After — restore
osascript -e 'tell application "Moom" to arrange windows according to snapshot "Pre-Demo"'
```

If `save snapshot` isn't exposed in your Moom version's scripting dictionary, script the UI with System Events:

```applescript
tell application "System Events" to tell process "Moom"
    click menu item "Save Current Arrangement…" of menu "File" of menu bar 1
    -- then set the text field…
end tell
```

Fragile, but works.

## Practical Examples

### Example 1 — A complete work/home switcher

Two snapshots, two arrangements, two hotkeys:

```applescript
-- ~/bin/moom-work
tell application "Moom" to arrange windows according to snapshot "Work"

-- ~/bin/moom-home
tell application "Moom" to arrange windows according to snapshot "Home"
```

Make them executable, symlink to `/usr/local/bin`, bind Hammerspoon hotkeys:

```lua
hs.hotkey.bind({"ctrl", "alt", "cmd"}, "1", function() hs.execute("moom-work") end)
hs.hotkey.bind({"ctrl", "alt", "cmd"}, "2", function() hs.execute("moom-home") end)
```

### Example 2 — Dynamic snapshot selection by SSID

```lua
-- ~/.hammerspoon/init.lua
local function applyLayoutForSSID()
  local ssid = hs.wifi.currentNetwork()
  local mapping = {
    ["HomeWiFi"]   = "Home",
    ["OfficeWiFi"] = "Work",
    ["Coffee"]     = "Laptop Solo",
  }
  local snap = mapping[ssid] or "Laptop Solo"
  hs.execute("osascript -e 'tell application \"Moom\" to arrange windows according to snapshot \"" .. snap .. "\"'")
end

hs.wifi.watcher.new(applyLayoutForSSID):start()
```

Now your layout tracks *where you are*, not just which displays are attached.

### Example 3 — Focus guard

Combine Moom + a Focus filter. Hammerspoon listens for a Focus change, arranges accordingly:

```lua
-- Pseudocode — macOS doesn't expose Focus state cleanly; use Shortcuts as the trigger.
-- Shortcuts automation: "When Focus Work is on" → Run AppleScript:
--   tell application "Moom" to arrange windows according to snapshot "Focus"
```

See [[macos-app-layout-deep-dive]] for the full Shortcuts recipe.

### Example 4 — Per-project layouts orchestrated by Bunch

```text
# ~/Bunches/project-api.bunch
?Visual Studio Code
?Ghostty
?Safari
~/code/api
(sleep 2)
(run)osascript -e 'tell application "Moom" to arrange windows according to snapshot "Project-API"'
```

One Moom snapshot per project, one bunch per project, one hotkey per project. Your menu bar becomes a project switcher. See [[bunch-beginner-guide]] Example 4.

### Example 5 — Dual-machine parity with chezmoi

```yaml
# ~/.config/chezmoi/chezmoi.yaml
data:
  moom:
    work_snapshot: "Docked Dual 27\""
    home_snapshot: "Home Desk"
```

Template a Hammerspoon config that references `{{ .moom.work_snapshot }}`, apply with `chezmoi apply`, and the same hotkey does the right thing on both machines. See [[chezmoi-deep-dive]].

## Hands-On Exercises

1. **Audit your current layouts.** Run `osascript -e 'tell application "Moom" to get name of every snapshot'` and `defaults read com.manytricks.Moom | wc -l`. Note the count. Delete three you no longer use.

2. **Build the display-fingerprint table.** Plug/unplug every display combination you ever use; for each, run `system_profiler SPDisplaysDataType | grep Resolution`; note the set. Save one snapshot per fingerprint.

3. **Enumerate via AppleScript.** Write `~/bin/moom-list`:
   ```bash
   #!/usr/bin/env bash
   osascript -e 'tell application "Moom" to get name of every snapshot'
   ```
   `chmod +x ~/bin/moom-list` and `moom-list` from anywhere.

4. **Write a Shortcuts automation** that triggers `Docked` when your external display connects. Time from plug-in to windows arranged (should be < 2 seconds).

5. **Script Moom from Hammerspoon** — bind `⌥⌃⌘ 1..5` to five arrangements. Reload config, test each.

6. **Version the plist.** `chezmoi add ~/Library/Preferences/com.manytricks.Moom.plist`. Commit. On a second Mac (or after a reinstall), `chezmoi apply` and verify all snapshots come back.

7. **Break Accessibility on purpose.** Remove Moom from Accessibility, attempt a layout. Observe the exact error (silent failure). This is the error shape any time a coworker has wedged their permissions.

8. **Pair with Bunch.** Refactor one of your bunches to use `?App` prefixes and a `(run)osascript` call to Moom; re-run and verify the second run is fast.

9. **Instrument.** Add to your Hammerspoon config:
   ```lua
   hs.execute("date +%s >> ~/.moom-applied.log")
   ```
   before every `arrange` call; after a week, compute mean time between arrangement triggers to see which snapshots you actually use.

## Troubleshooting

**`execution error: Moom got an error: Application isn't running. (-600)`**
Moom must be running before you send AppleScript. Prepend `open -b com.manytricks.Moom` and `sleep 1`, or add Moom to **Login Items**.

**`execution error: Not authorized to send Apple events to Moom. (-1743)`**
The *calling* process lacks Automation permission for Moom. Grant in **System Settings → Privacy & Security → Automation** under the caller (Terminal, iTerm, Bunch, Shortcuts). Re-run the script manually from Script Editor to re-trigger the prompt.

**Snapshot applies but windows end up half off-screen.**
The snapshot was captured at a different display resolution than the current one. Either re-capture, or delete the stale snapshot and save a new one at the correct resolution. Retina/non-Retina transitions are particularly prone to this.

**"Arrangement ignores one of my apps."**
Moom captures windows visible at save time. If the app was hidden, minimized, or on a different Space, it wasn't recorded. Bring the app's window forward, update the snapshot (**Preferences → Custom → Update Snapshot**).

**Snapshot works from Script Editor but not from Bunch / launchd / Shortcuts.**
Different calling process = different TCC grant. In **System Settings → Privacy & Security → Automation**, find the calling process, expand, and toggle Moom on. Run the script once manually from that caller to cement the grant.

**Custom layout hotkey conflicts with an app's own shortcut.**
Use **System Settings → Keyboard → Keyboard Shortcuts → App Shortcuts** to inspect conflicts. Choose `⌃⌥⌘` + a letter/digit to minimize overlap. Tools like Karabiner-Elements can remap at the event layer if needed.

**Snapshot restore takes >1 second.**
Normal is 50–200ms on Apple Silicon. If it's slow:
- Animations on: `defaults write com.manytricks.Moom DisableAnimations -bool YES` (undocumented; may not exist in your version).
- Many windows: Moom iterates; with 30+ windows expect 300–500ms.
- Electron apps respond to AX sets slowly; there's no workaround beyond fewer Electron apps.

**Moom forgets Accessibility after macOS update.**
Run `tccutil reset Accessibility com.manytricks.Moom`, then re-grant in System Settings. This is a macOS quirk, not a Moom bug.

**Windows end up on the wrong Space.**
Moom cannot move windows between Spaces. Use **Dock → right-click app → Options → Assign To → This Desktop** to pin apps. Moom will then arrange them *on that Space* when you switch.

**`defaults read com.manytricks.Moom` shows a huge plist.**
Normal. Moom stores every custom layout, arrangement, trigger, and preference there. Use the Moom UI to prune; don't edit the plist by hand.

## Advanced Topics

### Concurrency and race conditions

AppleScript `arrange` is synchronous (blocks until Moom reports done), but the windows it moves are owned by other apps whose event loops are asynchronous. If you immediately query window positions after `arrange`, you may read pre-move values. Insert `delay 0.3` (AppleScript) or `sleep 0.3` (shell) between arrange and any read.

### Multi-user machines

Moom's preferences are per-user (`~/Library/Preferences/com.manytricks.Moom.plist`). Snapshots don't share across user accounts. If you want shared behavior, script it — keep a shell-scripted "setup-moom" that `plutil`-merges a known-good plist on login.

### Performance envelope

- Custom layout (single window): 10–50ms.
- Arrangement (10 windows): 60–200ms.
- Arrangement (30+ windows): 300ms–1s; Electron apps dominate.
- The Moom daemon uses <0.1% CPU when idle; <2% during arrangement.

### Comparison to alternatives

| Tool         | Strength                                    | Weakness                                  |
| ------------ | ------------------------------------------- | ----------------------------------------- |
| **Moom**     | Snapshots + custom layouts + scripting      | No auto-apply on display change            |
| **Layoutish**| Built-in dock/undock auto-apply             | Fewer triggers; simpler scripting surface |
| **Rectangle**| Free; hotkey-snapping                       | No multi-window arrangements              |
| **Yabai**    | True tiling                                  | Requires disabling SIP                    |
| **Hammerspoon** | Full Lua; arbitrary triggers              | You write all the logic yourself          |

Most power users end up with **Moom + Hammerspoon + Bunch**: Moom does the geometry, Hammerspoon handles events and hotkeys, Bunch sequences apps. See [[macos-app-layout-deep-dive]] for a side-by-side.

### Security model

Moom runs with your user's permissions and holds an AX grant. That grant, if compromised, lets an attacker read window contents (via `AXValue`) and move windows. Keep the app auto-updating, prefer the Mac App Store build, and don't grant Accessibility to untrusted apps.

## Related Tutorials

- [[moom-beginner-guide]] — start here
- [[bunch-beginner-guide|Bunch Beginner Guide]] — the most common Moom trigger
- [[bunch-deep-dive|Bunch Deep Dive]] — advanced Bunch patterns
- [[macos-app-layout-beginner-guide]] — Moom in the broader layout toolkit
- [[macos-app-layout-deep-dive]] — the full layout automation stack
- [[dotfiles-beginner-guide]] — versioning Moom's plist
- [[dotfiles-deep-dive]] — advanced dotfile patterns
- [[chezmoi-beginner-guide]] — syncing Moom exports across Macs
- [[chezmoi-deep-dive]] — templating per-host Moom configs

## References

- Moom homepage — https://manytricks.com/moom/
- Moom help / docs — https://manytricks.com/moom/help/
- Moom scripting dictionary — https://manytricks.com/osd/moom/
- Apple Accessibility API — https://developer.apple.com/documentation/applicationservices/axuielement
- Quartz Display Services — https://developer.apple.com/documentation/coregraphics/quartz_display_services
- Hammerspoon API — https://www.hammerspoon.org/docs/
- launchd tutorial — https://www.launchd.info
- AppleScript Language Guide — https://developer.apple.com/library/archive/documentation/AppleScript/Conceptual/AppleScriptLangGuide/

## Summary

**Key takeaways:**

- Moom sits on top of the Accessibility API and Quartz Display Services; everything it can and can't do flows from those.
- Custom layouts act on the frontmost window; arrangements act on all windows. Don't confuse them.
- Arrangements are keyed to display fingerprints — one canonical snapshot per fingerprint keeps your life simple.
- Auto-apply on dock/undock is not built in; wire it via Shortcuts.app (easy), Hammerspoon (flexible), or launchd (scheduled).
- Moom's plist is portable — version it with chezmoi and your layouts survive reinstalls and new machines.
- Moom's sweet spot is as the geometry engine in a stack that also includes [[bunch-deep-dive|Bunch]] (orchestration), Shortcuts (events), and Hammerspoon (arbitrary logic).

**Next steps:** prune your snapshot list to canonical fingerprints, version `com.manytricks.Moom.plist` with chezmoi, wire Shortcuts automations for dock/undock, and script Moom from Bunch/Hammerspoon rather than clicking through menus. Revisit the Hands-On Exercises whenever you add a new display or automation.
# Related Tutorials

- [[hammerspoon-beginner-guide]] — pair with Moom for event-driven triggers
- [[hammerspoon-deep-dive]] — advanced Hammerspoon + Moom scripting
- [[yabai-beginner-guide]] — tiling alternative
- [[yabai-deep-dive]] — Yabai SIP and scripting addition
- [[sketchybar-beginner-guide]] — status bar pairing
- [[sketchybar-deep-dive]] — advanced Sketchybar integration
