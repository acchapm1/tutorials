---
title: Bunch — Beginner's Guide
date: 2026-04-14
difficulty: beginner
tags: [macos, bunch, automation, productivity, workflow, app-launcher, applescript]
---

# Bunch — Beginner's Guide

## Overview

**Bunch** is a free macOS app by Brett Terpstra that opens, closes, and configures sets of applications, documents, URLs, and shell scripts from a single menu-bar click. Think of it as a text-driven "project launcher" for your Mac: you write a plain-text `.bunch` file listing what you want to happen (apps to open, files to load, websites to visit, layouts to trigger), and Bunch runs it top to bottom.

For a software developer, this is gold. Most of us have "modes" — morning standup, focused coding, writing docs, demoing to a client — each with its own set of apps, tabs, and layouts. Bunch lets you encode each mode as a tiny file you can version-control, share, and trigger with a hotkey.

This guide teaches you enough to install Bunch, write your first `.bunch` file, and build several practical developer workflows. By the end, you'll be able to spin up your whole "morning coding" environment with one click.

## Prerequisites

- A Mac running macOS 11 (Big Sur) or later
- Admin rights to install an app and grant Accessibility / Automation permissions
- A text editor you're comfortable with (VS Code, BBEdit, nvim, or Bunch's own built-in editor)
- A basic comfort with macOS concepts like menu-bar apps, System Settings, and `.app` bundles

You do **not** need scripting experience. Bunch files are plain text and you'll pick up the syntax in minutes. If you ever want to go deeper, see the [[bunch-deep-dive]].

## Key Concepts

Before touching anything, learn three words:

- **Bunch file** — a plain-text file with the extension `.bunch`. Each line is either an app to open, a document to open, a URL to visit, a shell command to run, or a Bunch directive.
- **Bunch folder** — the directory where Bunch looks for your `.bunch` files. By default it's `~/Library/Application Support/Bunch/Bunches` but you can (and should) change it to something inside your dotfiles repo.
- **Menu-bar icon** — Bunch lives in the menu bar. Clicking it shows every `.bunch` file in your Bunch folder; clicking one runs it.

Two more mental models help:

1. **Bunch is declarative-ish.** You list what you want open. Bunch opens anything that isn't already open, and (if toggled on) closes apps listed with a `!` prefix. Re-running the same bunch is idempotent.
2. **Bunch is glue.** It doesn't do window layouts itself — it calls Moom, Shortcuts.app, or a shell script for that. It doesn't do tabs itself — it opens URLs in your default browser or invokes a browser-specific script. Its superpower is sequencing.

## Step-by-Step Instructions

### 1. Install Bunch

1. Go to https://bunchapp.co and click **Download**.
2. Unzip the download and drag `Bunch.app` into `/Applications`.
3. Launch Bunch. You'll see its icon (a little B) in the menu bar.
4. Open **System Settings → Privacy & Security → Accessibility** and toggle Bunch on. This lets Bunch send keystrokes and activate apps.
5. Open **System Settings → Privacy & Security → Automation** — Bunch will request permission for each app it scripts the first time.

### 2. Choose your Bunch folder

By default Bunch stores `.bunch` files in `~/Library/Application Support/Bunch/Bunches`. For version control and portability, point it at something you actually back up:

1. Bunch menu → **Preferences → General → Bunch Folder**.
2. Choose (or create) `~/Bunches` or `~/dotfiles/bunches`.
3. Put this folder under git — Bunch files are plain text and diff beautifully. See [[dotfiles-beginner-guide]] or [[chezmoi-beginner-guide]] for versioning tips.

### 3. Write your first Bunch file

Open Bunch → **Edit Bunches** (or open your Bunch folder in any editor). Create a file called `Morning.bunch`:

```text
# Morning.bunch — my weekday coding start
Safari
Mail
Slack
Visual Studio Code
Terminal

# Open some default documents
~/code/current-project/README.md
~/notes/today.md

# Open a couple of URLs in the default browser
https://github.com/pulls/review-requested
https://calendar.google.com
```

Save it. Click the Bunch menu-bar icon — you'll see `Morning` listed. Click it. Every app launches, the two docs open, and two browser tabs appear.

### 4. Close things you don't need

Append to `Morning.bunch`:

```text
# Close distractions
!Messages
!Music
!Discord
```

A `!` prefix tells Bunch to quit that app if it's running. Re-run the bunch and watch those three quit.

### 5. Add a layout trigger (optional but delightful)

If you also use [[moom-beginner-guide|Moom]] or a similar tool, you can add:

```text
# Wait for apps to finish launching, then arrange
(sleep 2)
(run)osascript -e 'tell application "Moom" to arrange windows according to snapshot "Coding"'
```

Now one click opens your apps, closes distractions, and snaps everything into your saved window layout. See [[macos-app-layout-beginner-guide]] for the full story on layout management.

### 6. Assign a hotkey

Bunch menu → **Preferences → Shortcuts** → pick `Morning` → click **Record** → press `⌃⌥⌘ M`.

You now have a hotkey-driven project launcher. Use it every morning.

## Practical Examples

These are the real-world developer workflows that have earned Bunch a permanent spot in the menu bar.

### Example 1 — Start a focused coding session

`~/Bunches/Focus.bunch`:

```text
# Focus mode: editor, terminal, docs, nothing else
Visual Studio Code
Ghostty
Safari

# Close everything that steals attention
!Slack
!Mail
!Messages
!Discord
!Music

# Open the project you're working on
~/code/payments-service

# Load the task list
~/notes/tasks.md

# Arrange windows
(sleep 1)
(run)osascript -e 'tell application "Moom" to arrange windows according to snapshot "Focus"'

# Enable Do Not Disturb (Shortcuts.app)
(run)shortcuts run "Start Focus"
```

Bind it to `⌃⌥⌘ F`. Press it and the whole Mac transforms into a coding booth.

### Example 2 — End of day shutdown

`~/Bunches/EndOfDay.bunch`:

```text
# Quit work apps and clean up
!Slack
!Mail
!Zoom
!Visual Studio Code
!Ghostty
!Docker

# Open reflection doc
~/notes/eod-reflection.md

# Start personal browser
Arc

# Disable Focus
(run)shortcuts run "End Focus"
```

### Example 3 — Spin up a client demo

`~/Bunches/DemoAcme.bunch`:

```text
# Clean slate — quit everything first
!*

# (Re)open just what the demo needs
Keynote
Safari
Zoom

# Load the deck and the staging URL
~/decks/acme-demo.key
https://staging.example.com/acme

# Silence the machine
(run)osascript -e 'set volume output muted true'

# Full-screen Keynote after a brief wait
(sleep 3)
(run)osascript -e 'tell application "Keynote" to activate'
(run)osascript -e 'tell application "System Events" to keystroke "p" using {option down, command down}'
```

The `!*` special token quits everything not listed in the bunch — a nuclear clean slate.

### Example 4 — Project switcher

One `.bunch` per repo. Each opens that repo's folder in VS Code, launches its dev server in a tagged terminal, and points the browser at `localhost:3000`:

`~/Bunches/api.bunch`:

```text
Visual Studio Code
Ghostty
Safari

~/code/api

(run)osascript -e 'tell application "Ghostty" to activate'
(run)osascript -e 'tell application "System Events" to keystroke "n" using {command down}'
(sleep 1)
(run)osascript -e 'tell application "System Events" to keystroke "cd ~/code/api && pnpm dev\r"'

http://localhost:3000
```

Repeat for every project you juggle. Your menu bar becomes a project switcher.

### Example 5 — Documentation mode

`~/Bunches/Docs.bunch`:

```text
Obsidian
Safari

# Research tabs
https://docs.python.org/3/
https://developer.mozilla.org/
https://news.ycombinator.com

# Close noisy apps
!Slack
!Discord

# Layout: Obsidian left, Safari right
(sleep 2)
(run)osascript -e 'tell application "Moom" to arrange windows according to snapshot "Reading"'
```

Great for technical writing, doc review, or deep research sessions. See [[engineering:documentation]] for the writing itself.

### Example 6 — On-call / incident mode

`~/Bunches/Incident.bunch`:

```text
Safari
Slack
Zoom
Ghostty

# Open dashboards
https://grafana.example.com/d/overview
https://sentry.io/organizations/acme/issues/
https://status.example.com

# Jump into the incident channel
(run)open slack://channel?team=T123&id=C456

# Start a runbook note
~/notes/incident-$(date +%F-%H%M).md
```

One click, entire on-call workspace ready. See [[engineering:incident-response]] for the process side.

## Hands-On Exercises

1. **Write a `Morning.bunch`** that opens your three most-used apps, closes Slack and Music, and opens one document. Assign it `⌃⌥⌘ M`.

2. **Add a URL bundle** — extend `Morning.bunch` so it opens your GitHub PR review queue, your calendar, and your team's Slack channel as browser tabs.

3. **Build a `Focus.bunch`** that quits Slack, Mail, and Messages and opens VS Code plus your current project folder. Compare "before" and "after" screenshots.

4. **Make a `ProjectX.bunch`** for one of your actual repos. Include the editor, a terminal, the repo folder, and the localhost URL for its dev server.

5. **Experiment with `!*`** — the "quit everything not listed" token. Create a `CleanSlate.bunch` that uses it, run it, and observe what happens.

6. **Version your bunches** — add `~/Bunches` (or wherever you moved it) to a dotfiles git repo. Commit. See [[dotfiles-beginner-guide]].

7. **Wire up a dock/undock trigger** — set up a Shortcuts.app automation that runs `open -b com.brettterpstra.Bunch ~/Bunches/Docked.bunch` when your external monitor connects.

## Troubleshooting

**"Bunch menu doesn't show my new file."**
Bunch watches its Bunch folder live, but sometimes needs a kick. Click the menu-bar icon → **Refresh**. If that fails, confirm your Bunch folder in Preferences and make sure the file ends in `.bunch`.

**"An app I listed didn't launch."**
Bunch matches app names and bundle identifiers. If the app has a non-standard name (e.g., `Visual Studio Code - Insiders`), use the exact name as it appears in `/Applications`. For reliability, use the bundle ID:

```text
com.microsoft.VSCode
```

List bundle IDs with `osascript -e 'id of app "Visual Studio Code"'`.

**"AppleScript in `(run)` line fails silently."**
Check **System Settings → Privacy & Security → Automation** — the first time Bunch tries to script a given app, macOS prompts for approval. If you miss the prompt, the call fails and Bunch moves on. Run the AppleScript manually once from Script Editor to re-trigger the prompt.

**"URLs open in the wrong browser."**
Bunch uses your default browser. Change it in **System Settings → Desktop & Dock → Default web browser**. For a specific URL to open in a specific browser, use:

```text
(run)open -a "Firefox" https://example.com
```

**"`!*` closed something I care about (like Finder)."**
`!*` quits everything except what's listed. Add the app to your bunch (even without opening it) to preserve it. Or use explicit `!AppName` lines instead.

**"Bunch ran twice because I clicked too fast."**
Enable **Preferences → General → Prevent rapid re-fire** if available in your Bunch version, or set a small debounce in your workflow (e.g., a `(sleep 1)` at the very top).

**"It worked yesterday, broke after an OS update."**
macOS updates occasionally reset TCC (the permissions database). Re-grant Accessibility and Automation permissions in System Settings. This is also documented in [[macos-app-layout-deep-dive]].

## Bunch Syntax Cheat Sheet

| Line                                    | What it does                                                          |
| --------------------------------------- | --------------------------------------------------------------------- |
| `AppName`                               | Launch or activate the app                                            |
| `!AppName`                              | Quit the app                                                          |
| `!*`                                    | Quit all apps not listed in this bunch                                |
| `~/path/to/file.md`                     | Open the document with its default app                                |
| `https://example.com`                   | Open the URL in the default browser                                   |
| `# comment`                             | Human-readable note, ignored by Bunch                                 |
| `(sleep 2)`                             | Pause for N seconds before the next line                              |
| `(run)cmd ...`                          | Run a shell command (non-blocking unless using `(run!)`)              |
| `?AppName`                              | Conditional — only run this block if AppName is **not** already open  |
| `(bunch)~/path/to/Other.bunch`          | Chain into another bunch                                              |

## Related Tutorials

- [[moom-beginner-guide|Moom Beginner Guide]] — the window-layout tool Bunch most often triggers
- [[moom-deep-dive|Moom Deep Dive]] — scripting Moom from Bunch `(run)` lines
- [[macos-app-layout-beginner-guide]] — how Bunch fits into a full macOS layout workflow
- [[macos-app-layout-deep-dive]] — advanced orchestration with Bunch, Moom, Shortcuts, Hammerspoon, and launchd
- [[bunch-deep-dive]] — internals, advanced patterns, frontmatter, and scripting
- [[dotfiles-beginner-guide]] — where to store `.bunch` files
- [[dotfiles-deep-dive]] — versioning `.bunch` files and Moom snapshots
- [[chezmoi-beginner-guide]] — syncing your `.bunch` files across machines
- [[chezmoi-deep-dive]] — templating `.bunch` files per host
- [[karabiner-elements-beginner-guide|Karabiner-Elements Beginner Guide]] — bind Hyper key shortcuts to open Bunch files
- [[karabiner-elements-deep-dive|Karabiner-Elements Deep Dive]] — shell_command integration for triggering Bunches from key presses

## References

- Bunch homepage — https://bunchapp.co
- Bunch documentation — https://bunchapp.co/docs/
- Brett Terpstra's Bunch articles — https://brettterpstra.com/projects/bunch/
- Bunch Discord community — linked from the homepage
- Apple: Automation permissions — https://support.apple.com/guide/mac-help/allow-apps-to-access-your-mac-data-mh35782/mac

## Summary

Bunch is the fastest way to turn "the five things I always do at the start of my coding day" into one click. It's plain text, version-controllable, hotkey-triggerable, and pairs beautifully with Moom, Shortcuts.app, and shell scripts.

**Key takeaways:**

- A `.bunch` file is a plain-text list of apps, files, URLs, and directives.
- `!AppName` quits, `!*` quits everything else, `(sleep N)` pauses, `(run)cmd` shells out.
- Store your Bunch folder in a version-controlled dotfiles repo.
- Grant Accessibility and Automation permissions once, then forget about them.
- Start with a morning launcher, then grow into focus mode, project switchers, demo mode, and incident mode.

**Next steps:** read [[bunch-deep-dive]] to learn frontmatter, conditional logic, external triggers, and the patterns that scale Bunch from "cute toy" to "central nervous system of your Mac."
# Related Tutorials

- [[hammerspoon-beginner-guide]] — trigger Bunches from Hammerspoon
- [[yabai-beginner-guide]] — tiling manager alongside Bunch
- [[sketchybar-beginner-guide]] — status bar pairing
