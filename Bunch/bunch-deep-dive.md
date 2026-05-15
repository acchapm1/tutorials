---
title: Bunch — Deep Dive
date: 2026-04-14
difficulty: advanced
tags: [macos, bunch, automation, applescript, shell, workflow, dsl, launchd, shortcuts]
---

# Bunch — Deep Dive

## Overview

Bunch is deceptively simple on the surface — a list of apps and files with a few sigils. Underneath, it's a small, well-designed DSL with variables, frontmatter, conditionals, snippets, external triggers, and bidirectional hooks into every macOS automation mechanism worth knowing. This deep dive covers the runtime model, the full grammar, advanced patterns, and the failure modes you'll hit when you push Bunch past basic app launching.

The target reader is already comfortable with [[bunch-beginner-guide]] and wants to build production-grade workflows — project switchers, demo pipelines, on-call runbooks, CI-adjacent automations, multi-machine bunches — and fold Bunch into a broader automation stack including AppleScript, Shortcuts, Hammerspoon, and launchd.

By the end you will understand how Bunch parses and executes files, how to structure reusable fragments with `@snippets` and `(bunch)` chaining, how to parameterize with variables and frontmatter, and how to drive Bunch from the outside via URL scheme, `open -b`, and file watchers.

## Prerequisites

- Comfortable with everything in [[bunch-beginner-guide]]
- Familiarity with the macOS shell (`zsh`/`bash`), `osascript`, and `defaults`
- Some AppleScript or JXA exposure is helpful (not required)
- Working knowledge of macOS TCC (Accessibility, Automation, Full Disk Access)
- A dotfiles workflow you actually use — see [[dotfiles-deep-dive]] or [[chezmoi-deep-dive]]
- Optional: Hammerspoon or Shortcuts.app for event-driven triggers

## Key Concepts

### The execution model

Bunch reads a `.bunch` file top to bottom, parsing each non-blank, non-comment line as one of:

1. An **app line** — a string matching an app name or bundle identifier, optionally prefixed with `!` (quit) or `?` (only if not running).
2. A **file line** — a path or `~`-rooted path pointing at a document; Launch Services decides which app opens it.
3. A **URL line** — a string with a recognizable scheme (`https://`, `slack://`, `vscode://`, `x-apple-shortcuts://`, etc.).
4. A **directive** — a `(keyword)` expression like `(sleep 2)`, `(run)…`, `(bunch)…`, `(open)…`.
5. A **variable assignment** — `name = value`, available inside the file via `${name}`.
6. **Frontmatter** — YAML between `---` fences at the top of the file, setting behaviors like `ignore already running`.
7. A **snippet reference** — `@snippet-name`, injecting a block defined in `Snippets.bunch`.

Bunch executes lines sequentially but app launches are non-blocking by default — Launch Services starts the app, Bunch moves on. This is why `(sleep N)` before an `(run)osascript …` that scripts the app is the most common gotcha to internalize.

### The launch vs. quit semantic

- App listed without prefix → **ensure running** (launch if not, activate if yes).
- `!App` → **quit**.
- `?App` → **launch only if not running** (skip if already open). Also gates the following indented block.
- `!*` → **quit every app that isn't explicitly listed**, including indented references.
- `App` appearing twice is idempotent — Bunch is happy to re-assert "should be open."

Toggle behavior: clicking a running bunch in the menu bar by default **reverses** it — apps it launched get quit, apps it quit get relaunched (if `Ignore already running` is unset). This is what makes Bunch feel like "modes." Turn it off per-file with frontmatter if you want one-way launchers.

### Bundle identifiers vs. names

Names are fragile — `Visual Studio Code` vs. `Visual Studio Code - Insiders` vs. `Code`. Bundle identifiers are stable:

```text
com.microsoft.VSCode
com.microsoft.VSCode.insiders
com.apple.Safari
com.brettterpstra.Bunch
com.manytricks.Moom
```

Get an app's bundle ID:

```bash
osascript -e 'id of app "Visual Studio Code"'
# com.microsoft.VSCode
```

Prefer bundle IDs in any bunch that ships to other machines or CI-like contexts.

### The Bunches folder and snippets

Bunch treats one directory as the root of your bunches. Inside it, three filenames have special meaning:

- `Snippets.bunch` — a library of reusable named blocks you reference with `@name`.
- `Defaults.bunch` — lines run before every bunch (rarely used; careful).
- `Display Configurations.bunch` — conditional blocks keyed on which displays are attached.

Everything else is a user bunch. Subdirectories become submenus in the menu bar. Prefix a filename with `_` to hide it from the menu but keep it callable via `(bunch)` or URL scheme.

## Step-by-Step Instructions (Advanced Techniques)

### 1. Structure a bunch with frontmatter

Frontmatter sets file-local behaviors. Put it at the very top:

```text
---
ignore: true
prevent sleep: true
open each: 0.2
display: LG UltraFine 5K
---

# Bunch is now one-way (clicking again doesn't reverse it),
# prevents sleep while running, waits 200ms between each app launch,
# and only runs if the LG UltraFine 5K is attached.
Safari
Mail
Slack
```

Useful frontmatter keys:

- `ignore: true` — treat as one-way (don't reverse on re-click).
- `ignore already running: true` — skip apps already running (avoid re-activation).
- `prevent sleep: true` — hold a `caffeinate` lock while running.
- `open each: 0.5` — pause N seconds between app launches.
- `display: "Display Name"` — gate on a connected display.
- `startup: true` — run automatically when Bunch launches.

### 2. Parameterize with variables

Bunch supports inline variables scoped to the file:

```text
project = ~/code/payments-service
port = 3000
branch = feature/checkout-flow

Visual Studio Code
Ghostty

${project}

(run)osascript -e 'tell application "Ghostty" to activate'
(run)osascript -e 'tell application "System Events" to keystroke "cd ${project} && git checkout ${branch} && pnpm dev\r"'

http://localhost:${port}
```

This lets you clone a bunch as a template and change three lines to spin up a new project switcher.

### 3. Define and use snippets

Create `~/Bunches/Snippets.bunch`:

```text
@close-chat
!Slack
!Messages
!Discord
@end

@do-not-disturb
(run)shortcuts run "Start Focus"
@end

@arrange-focus
(sleep 1)
(run)osascript -e 'tell application "Moom" to arrange windows according to snapshot "Focus"'
@end
```

Now any bunch can compose them:

```text
Visual Studio Code
Ghostty

@close-chat
@do-not-disturb
@arrange-focus
```

Changing the snippet once updates every bunch that uses it — the DRY principle applied to your workflows.

### 4. Conditional blocks

Four conditional forms to know:

```text
# (a) App gate — the following indented block runs only if Slack isn't open
?Slack
  Slack
  (sleep 2)
  (run)open "slack://channel?team=T123&id=C456"

# (b) Display gate — inline via frontmatter (see §1) or:
(display "LG UltraFine 5K")
  (bunch)~/Bunches/Docked.bunch

# (c) Time gate — run different blocks by hour
(if time is before 12:00)
  (bunch)~/Bunches/Morning.bunch
(if time is after 17:00)
  (bunch)~/Bunches/EndOfDay.bunch

# (d) Shell gate — arbitrary condition
(if (run)[ -f ~/.on-call ])
  (bunch)~/Bunches/Incident.bunch
```

The exact syntax for (b)–(d) may vary between Bunch versions — always cross-check https://bunchapp.co/docs/. The core pattern — indentation defines the conditional block — is stable.

### 5. Compose bunches

Bunches chain. Keep them small and single-purpose, then compose:

```text
# ~/Bunches/Docked.bunch
(bunch)_apps-work.bunch
(bunch)_quit-distractions.bunch
(bunch)_layout-docked.bunch
```

Each `_`-prefixed bunch is hidden from the menu bar but callable. This is the Bunch equivalent of Unix pipelines — compose small tools, don't build monoliths.

### 6. Drive Bunch from outside

Three invocation surfaces:

**`open -b com.brettterpstra.Bunch`:**

```bash
open -b com.brettterpstra.Bunch ~/Bunches/Morning.bunch
```

Great from shell scripts, launchd jobs, Shortcuts.app, or git hooks.

**URL scheme:**

```text
x-bunch://open/Morning
x-bunch://open/Morning?var=override
x-bunch://toggle/Morning
```

Useful from anywhere you can emit a URL — Raycast, Alfred, Keyboard Maestro, a browser bookmark.

**AppleScript:**

```applescript
tell application "Bunch" to open bunch "Morning"
```

Handy inside larger AppleScript/JXA flows that already talk to Moom, Mail, Reminders, etc.

### 7. External triggers — dock/undock, login, cron-like

**Shortcuts.app automation — display connected:**

Shortcuts → Automation → **When display is connected → LG UltraFine 5K** → **Run Shell Script**:

```bash
open -b com.brettterpstra.Bunch "$HOME/Bunches/Docked.bunch"
```

Add a **display disconnected** companion for `Laptop.bunch`. This is the cleanest native path; nothing beats Shortcuts for zero-maintenance event plumbing.

**Launchd — weekday 9am:**

`~/Library/LaunchAgents/com.acchapm.bunch.morning.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.acchapm.bunch.morning</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/open</string>
    <string>-b</string>
    <string>com.brettterpstra.Bunch</string>
    <string>/Users/acchapm/Bunches/Morning.bunch</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict>
      <key>Weekday</key><integer>1</integer>
      <key>Hour</key><integer>9</integer>
      <key>Minute</key><integer>0</integer>
    </dict>
    <!-- repeat for Weekday 2..5 -->
  </array>
</dict>
</plist>
```

Load it:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.acchapm.bunch.morning.plist
```

**Hammerspoon — arbitrary Lua triggers:**

```lua
hs.hotkey.bind({"ctrl", "alt", "cmd"}, "M", function()
  hs.execute("open -b com.brettterpstra.Bunch $HOME/Bunches/Morning.bunch")
end)

-- Run EndOfDay when battery crosses 20% on the laptop
hs.battery.watcher.new(function()
  if hs.battery.percentage() < 20 and not hs.battery.isCharging() then
    hs.execute("open -b com.brettterpstra.Bunch $HOME/Bunches/LowBattery.bunch")
  end
end):start()
```

## Practical Examples

### Example 1 — A four-mode project switcher

`~/Bunches/Snippets.bunch`:

```text
@quit-all-work
!Slack
!Mail
!Zoom
!Visual Studio Code
!Ghostty
!Docker
@end

@layout-focus
(sleep 1)
(run)osascript -e 'tell application "Moom" to arrange windows according to snapshot "Focus"'
@end
```

`~/Bunches/_project.bunch` (hidden template, called via variables):

```text
---
ignore already running: true
---

Visual Studio Code
Ghostty
Safari

${root}

(run)osascript -e 'tell application "Ghostty" to activate'
(run)osascript -e 'tell application "System Events" to keystroke "cd ${root} && ${start}\r"'

http://localhost:${port}

@layout-focus
```

`~/Bunches/api.bunch`:

```text
root = ~/code/api
start = pnpm dev
port = 3000
(bunch)_project.bunch
```

`~/Bunches/web.bunch`:

```text
root = ~/code/web
start = pnpm dev
port = 5173
(bunch)_project.bunch
```

Add new repos in 3 lines each. Your menu bar becomes a project dashboard.

### Example 2 — Demo pipeline with safety checks

```text
---
ignore: true
prevent sleep: true
---

# Refuse to run unless on AC power and external display attached
(if (run)[ "$(pmset -g ps | head -1 | grep -c AC)" = "1" ])
(display "LG UltraFine 5K")
  # Clean slate
  !*

  # Core apps
  Keynote
  Safari
  Zoom

  # Content
  ~/decks/demo-2026-04-14.key
  https://staging.example.com

  # Silence
  (run)osascript -e 'set volume output muted true'
  (run)shortcuts run "Start Focus"

  # Full-screen after Keynote loads
  (sleep 3)
  (run)osascript -e 'tell application "Keynote" to activate'
  (run)osascript -e 'tell application "System Events" to keystroke "p" using {option down, command down}'
```

The nested conditionals make the bunch a no-op unless the environment is demo-ready. No more "oops, ran the demo bunch at a coffee shop."

### Example 3 — Incident response runbook

```text
---
ignore already running: true
prevent sleep: true
---

Safari
Slack
Zoom
Ghostty

# Dashboards
https://grafana.example.com/d/overview
https://sentry.io/organizations/acme/issues/
https://status.example.com

# Jump into incident channel
(run)open "slack://channel?team=T123&id=CINCIDENT"

# Create dated incident note
(run)bash -lc 'mkdir -p ~/notes/incidents && touch ~/notes/incidents/$(date +%F-%H%M).md && open ~/notes/incidents/$(date +%F-%H%M).md'

# Start a screen recording (Shortcuts)
(run)shortcuts run "Start Screen Recording"

(sleep 2)
(run)osascript -e 'tell application "Moom" to arrange windows according to snapshot "Incident"'
```

Pairs neatly with [[engineering:incident-response]] — the runbook opens itself.

### Example 4 — Multi-machine bunch via Chezmoi templating

Store `~/Bunches/Morning.bunch.tmpl` in chezmoi:

```text
{{- if eq .chezmoi.hostname "work-mbp" }}
Slack
Mail
{{ .work.editor }}
~/code/{{ .work.currentProject }}
(run)osascript -e 'tell application "Moom" to arrange windows according to snapshot "Work"'
{{- else if eq .chezmoi.hostname "home-imac" }}
Arc
Obsidian
~/writing/current.md
(run)osascript -e 'tell application "Moom" to arrange windows according to snapshot "Writing"'
{{- end }}
```

`chezmoi apply` renders the right bunch on each machine. See [[chezmoi-deep-dive]].

## Hands-On Exercises

1. **Add frontmatter** to your `Morning.bunch` setting `ignore already running: true` and `prevent sleep: true`. Verify a second click doesn't re-activate apps.

2. **Write a `Snippets.bunch`** with at least three reusable blocks (`@close-chat`, `@layout-focus`, `@do-not-disturb`). Refactor two existing bunches to use them.

3. **Parameterize a project bunch** — extract `root`, `start`, and `port` as variables; create three child bunches that set them and call the template.

4. **Build a display-gated bunch** — one block runs only when your external display is attached, another only when it's not. Test by plugging/unplugging.

5. **Write a launchd plist** that runs `Morning.bunch` at 9am on weekdays. Load it, verify `launchctl list | grep bunch` shows it, and confirm it fires on the next scheduled day.

6. **Script a Hammerspoon hotkey** that toggles `Focus.bunch` via `open -b com.brettterpstra.Bunch`. Assign `⌃⌥⌘ F`.

7. **Template a bunch with Chezmoi** — move one of your bunches into a chezmoi template, add a hostname conditional, apply on two machines, and diff the outputs.

8. **Break permissions on purpose** — remove Bunch from **Accessibility**, run a bunch that uses `(run)osascript …`, and observe the exact failure. This is the error you'll see any time macOS forgets the grant.

9. **Instrument a bunch** — prepend and append `(run)date >> ~/.bunch-runs.log` to `Morning.bunch`; after a week, inspect the log and compute average run duration.

## Troubleshooting

**`(run)osascript …` fails silently.**
Bunch's `(run)` directive is non-blocking; stderr disappears. Re-issue the command from Terminal to see the real error. If it's `-1743` (Automation not granted) or `-600` (app not running), the fix is respectively re-approving Automation in System Settings or adding an `open -b <bundle-id>` and `(sleep 1)` before the osascript line.

**Reverse-on-click is closing apps you didn't expect.**
Bunch tracks what a bunch "opened" and reverses only those. If you manually quit an app between the two clicks, its reverse step is a no-op. If you added a line to the bunch since the last click, the reverse tracking uses the **previous** version. To get predictable one-way semantics, set `ignore: true` in frontmatter.

**Variables aren't interpolating.**
Assignments must be `name = value` (spaces around `=` optional), and references are `${name}`, not `$name` or `{{name}}`. Variables are scoped to the file; chained bunches (`(bunch)other.bunch`) get their own variable table. To propagate a variable, pass it via URL scheme or set it in the chained bunch too.

**`(sleep N)` isn't waiting long enough for an Electron app.**
Electron apps (VS Code, Slack, Discord) can take 3–5 seconds from launch to "accepts AppleScript." Use `(sleep 3)` at minimum, or poll:

```text
(run)bash -lc 'until osascript -e "tell app \"Slack\" to count windows" >/dev/null 2>&1; do sleep 0.5; done'
```

**`!*` quit Finder / Dock / CoreServices.**
It shouldn't — Bunch filters system apps — but list exclusions defensively if you see anomalies:

```text
Finder
Dock
!*
```

**Bunch launches the wrong app for a URL.**
Launch Services, not Bunch, decides. Inspect with `duti -x https` (install `duti` via Homebrew). Fix with `duti -s com.google.Chrome https` or route per-URL via `(run)open -a …`.

**Bunch runs before the network is ready at login.**
Wrap network-dependent actions in a poll:

```text
(run)bash -lc 'until curl -s --max-time 2 https://www.google.com >/dev/null; do sleep 1; done'
```

Or move those actions to a Shortcuts automation gated on "Wi-Fi is connected."

**Permissions re-prompt every macOS update.**
TCC occasionally forgets grants on major updates. Re-approve Accessibility and Automation for Bunch, then run the AppleScript lines manually once from Script Editor to re-trigger per-target prompts.

**`(bunch)` chaining creates a runaway loop.**
Nothing stops `A.bunch → B.bunch → A.bunch`. Audit `(bunch)` references and treat them like imports — DAG, not cycle.

## Advanced Topics

### Bunch's state file

Bunch persists "which bunches are currently toggled on" at `~/Library/Application Support/Bunch/OpenBunches.plist`. You can read it:

```bash
plutil -p ~/Library/Application\ Support/Bunch/OpenBunches.plist
```

If clicking a bunch behaves unexpectedly (reverses when you didn't expect it), delete this plist while Bunch is quit and restart Bunch to reset state.

### Performance

- App launch dominates. Bunch parses a 50-line bunch in <10ms. The long tail is Launch Services opening the apps.
- Use `open each: 0.2` in frontmatter if simultaneous launches cause login storm (7+ apps at once).
- `(bunch)` chains add negligible overhead (~5ms each).

### Security model

- Bunch runs with your user's permissions. `(run)` commands inherit your shell environment.
- Store secrets in the macOS Keychain and fetch with `security find-generic-password` inside `(run)` blocks, not as plaintext variables in a bunch.
- If you version your Bunches folder, `.gitignore` any bunch that contains tokens, or template tokens with chezmoi + GPG-encrypted vars.

### Integration with Shortcuts.app

Bunch → Shortcuts:

```text
(run)shortcuts run "Start Focus"
(run)shortcuts run "Archive Inbox" --input-path ~/Downloads/report.pdf
```

Shortcuts → Bunch:

Add a **Run Shell Script** action: `open -b com.brettterpstra.Bunch ~/Bunches/Morning.bunch`.

This pairing solves the "Bunch lacks a GUI condition builder; Shortcuts lacks ergonomic sequencing" problem. Use each for what it's best at.

### Integration with Moom

Bunch sequences; [[moom-deep-dive|Moom]] sizes and positions. A representative pipeline:

```text
?Slack
?Mail
?Safari
?Visual Studio Code

(sleep 2)
(run)osascript -e 'tell application "Moom" to arrange windows according to snapshot "Docked"'
(run)osascript -e 'tell application "System Events" to tell process "Finder" to set position of window 1 to {0, 0}'
```

The `?` prefix means "launch only if not open" — re-running the bunch is fast and doesn't flash windows.

## Related Tutorials

- [[bunch-beginner-guide]] — start here if you're new to Bunch
- [[moom-beginner-guide|Moom Beginner Guide]] — the window-layout tool most bunches trigger
- [[moom-deep-dive|Moom Deep Dive]] — scripting Moom in depth
- [[macos-app-layout-beginner-guide]] — Bunch + Moom in a layout workflow
- [[macos-app-layout-deep-dive]] — the broader automation stack (Layoutish, Hammerspoon, launchd)
- [[dotfiles-beginner-guide]] — versioning your Bunches folder
- [[dotfiles-deep-dive]] — advanced dotfile patterns
- [[chezmoi-beginner-guide]] — syncing `.bunch` files across Macs
- [[chezmoi-deep-dive]] — templating bunches per-host
- [[engineering:incident-response]] — pairs with an `Incident.bunch`
- [[engineering:documentation]] — pairs with a `Docs.bunch`
- [[karabiner-elements-beginner-guide|Karabiner-Elements Beginner Guide]] — bind Hyper shortcuts to toggle Bunches
- [[karabiner-elements-deep-dive|Karabiner-Elements Deep Dive]] — shell_command rules for opening Bunches from key presses

## References

- Bunch documentation — https://bunchapp.co/docs/
- Brett Terpstra's Bunch project page — https://brettterpstra.com/projects/bunch/
- Bunch cheatsheet — https://bunchapp.co/docs/cheatsheet/
- AppleScript Language Guide — https://developer.apple.com/library/archive/documentation/AppleScript/Conceptual/AppleScriptLangGuide/
- launchd tutorial — https://www.launchd.info
- Hammerspoon API — https://www.hammerspoon.org/docs/
- Apple: Automation permissions — https://support.apple.com/guide/mac-help/allow-apps-to-access-your-mac-data-mh35782/mac

## Summary

**Key takeaways:**

- Bunch is a parser plus an orchestrator — it reads a `.bunch` file, resolves apps/URLs/files/directives, and sequences their execution.
- Frontmatter, variables, snippets, conditionals, and `(bunch)` composition are the five tools that scale you from one-file toys to maintainable, shared workflows.
- Prefer bundle IDs over app names. Prefer snippets over copy-paste. Prefer small composable bunches over monoliths.
- The Bunch folder is your automation source code — version it, review it, share it.
- Bunch is at its best when it's the glue, not the engine: let Moom do layouts, Shortcuts handle events, Hammerspoon handle hotkeys, launchd handle schedules, and Bunch sequence them.

**Next steps:** collapse your ad-hoc scripts into a `Snippets.bunch`, rewrite three of your most-used bunches as composed small files, move the whole folder into your chezmoi-managed dotfiles, and wire dock/undock to `Docked.bunch` / `Laptop.bunch`. Revisit the Hands-On Exercises whenever you hit a new edge case.
# Related Tutorials

- [[hammerspoon-beginner-guide]] — trigger Bunch files from Hammerspoon hotkeys
- [[hammerspoon-deep-dive]] — advanced Bunch + Hammerspoon patterns
- [[yabai-beginner-guide]] — tiling manager complementing Bunch-driven layouts
- [[sketchybar-beginner-guide]] — status bar pairing
