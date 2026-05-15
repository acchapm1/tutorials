---
title: "Honeymux — Beginner Guide"
date: 2026-04-28
difficulty: beginner
tags: [honeymux, tmux, terminal-multiplexer, tui, session-management, hmx]
---

# Honeymux — Beginner Guide

## Overview

**Honeymux** (hmx) is a terminal user interface (TUI) wrapper that makes tmux—a powerful but notoriously complex terminal multiplexer—accessible and enjoyable for everyone. Think of it as bringing modern UI design to the command line: toolbars, sidebars, pane tabs, window tabs, and visual session menus replace cryptic keybindings and hidden configuration.

### Why Honeymux Matters

If you've ever wanted to run multiple terminal commands at once without opening a dozen terminal windows, or if you work with servers and need persistent sessions, tmux is the answer. But tmux has a steep learning curve—it's powerful, but cryptic. Honeymux removes that friction by layering a beautiful, intuitive interface on top of tmux.

**The result:** You get terminal multiplexing superpowers without memorizing keybindings or wrestling with configuration files. Honeymux is tagged as "pre-1.0 software," so it's actively evolving, but it's already production-ready.

### What You'll Learn

By the end of this guide, you'll:
- Install and launch Honeymux
- Understand how sessions, windows, and panes work (no tmux knowledge required)
- Navigate the Honeymux UI with confidence
- Create and manage terminal workspaces
- Split screens and organize your work
- Save and reuse workspace layouts
- Extend Honeymux with hooks for monitoring long-running processes
- Connect to remote servers via SSH
- Customize themes to match your style

---

## Prerequisites

### System Requirements
- **macOS** or **Linux** (including WSL2 on Windows)
- A modern terminal emulator (Kitty, iTerm2, Alacritty, or Terminal.app all work)
- **Homebrew** (optional, for easy installation on macOS)

### Knowledge Requirements
- **Basic terminal/CLI comfort:** You know how to open a terminal and run commands like `ls` and `cd`
- **No tmux knowledge needed:** Honeymux handles all the tmux complexity for you
- **No configuration experience needed:** Honeymux works out of the box with zero config

### Nice-to-Have
- Familiarity with terminal editors (nano, vim) or a GUI text editor
- SSH access to a remote server (optional, for the SSH pane stitching section)
- 15 minutes to follow along with the hands-on examples

---

## Key Concepts

Before you launch Honeymux, let's demystify the concepts it's built on. Don't worry—they're simpler than they sound.

### The tmux Foundation: Sessions, Windows, and Panes

Honeymux is built on **tmux**, a terminal multiplexer created in 2007. Here's the hierarchy:

```
Session (Your workspace)
├── Window (Like a tab in your workspace)
│   ├── Pane (A split within that tab)
│   └── Pane (Another split)
└── Window 2
    ├── Pane
    └── Pane
```

**Session:** A complete workspace. You might have a "work" session and a "personal" session. Sessions persist—if you disconnect, they wait for you.

**Window:** Like a tab. A session can have many windows. Switch between them quickly.

**Pane:** A subdivided area within a window. One window can have 2, 4, or 20 panes arranged however you like.

**Why this matters:** You can organize your work logically. A "dev" session might have a window for your editor, another for running servers, another for logs—all without opening new terminal windows.

### The Honeymux UI Layer

Honeymux wraps tmux with a modern interface:

**Toolbar (top):** Keyboard shortcuts, quick commands, status info
**Sidebar (left):** Your sessions and windows, organized and clickable
**Pane Tabs:** Each pane gets a tab so you can click between them
**Window Tabs:** Each window gets a tab
**Command Palette:** Press `Ctrl+K` to search and run commands
**Session Menu:** Create, delete, and rename sessions with a mouse or keyboard

### Layout Profiles

Honeymux lets you save and reload workspace layouts. Set up your perfect "dev" workspace once, save it, and reload it whenever you need it. Layouts are portable and version-controllable.

### Base16 Theming

Honeymux supports Base16 color schemes. If you love terminal themes, you can customize colors to match your editor and terminal.

### Hook-Based Agent Monitoring

Honeymux can monitor long-running processes (like CI/CD agents, data pipelines, or training scripts) and visually notify you when they change state. This is perfect for developers working with coding agents.

### Remote Pane Stitching

With SSH support, you can merge tmux panes from your local machine with panes on a remote server. All in one Honeymux session.

---

## Step-by-Step Instructions

### 1. Installation

#### Option A: Homebrew (Recommended for macOS)

```bash
brew install honeymux/tap/hmx
```

Verify the installation:
```bash
hmx --version
```

You should see output like: `hmx 0.x.x`

#### Option B: Universal Installer (macOS & Linux)

```bash
curl -fsSL https://get.hmx.dev | bash
```

This script detects your OS and installs Honeymux. After installation, restart your terminal or run:
```bash
source ~/.bashrc  # or ~/.zshrc if you use zsh
```

#### Verify Installation

```bash
which hmx
hmx --help
```

### 2. First Launch

Open your terminal and type:

```bash
hmx
```

**What you'll see:** The Honeymux TUI appears with:
- A **toolbar** at the top showing keybindings
- A **sidebar** on the left (initially empty)
- The main **session area** in the center
- A **status bar** at the bottom

Congratulations—you're running Honeymux!

### 3. Understanding the UI

#### The Toolbar
At the very top, you'll see helpful hints like:
- `^C`: Quit
- `^K`: Command palette
- Navigation shortcuts

These change based on what you're doing.

#### The Sidebar
The sidebar (left side) shows:
- **Sessions:** Click or press arrow keys to switch between sessions
- **Windows:** Under each session, click to switch windows
- **Current pane indicator:** Shows which pane is active

#### Pane Tabs
Within a window, if you have multiple panes, each pane gets a tab at the top. Click to switch panes.

#### The Command Palette
Press `Ctrl+K` to open a searchable command menu. Start typing to find commands like "new session," "split pane," or "save layout."

### 4. Creating Your First Session

Press `Ctrl+K` and search for "new session":

```
> new session
```

You'll see a prompt asking for a session name. Type:

```
mywork
```

Press `Enter`. Honeymux creates a session named "mywork" and opens it in the sidebar. You now have a blank terminal ready to use.

**Try it:** Type a command, like `ls -la`. It works exactly like a normal terminal.

### 5. Splitting Panes

Now let's split your pane into multiple parts. Press `Ctrl+K` and search for "split":

```
> split pane vertical
```

Press `Enter`. Your pane splits into two columns. You now have two independent terminals side-by-side.

**Try it:**
- Left pane: `while true; do date; sleep 1; done` (shows the time updating)
- Right pane: `top` (shows running processes)

Click between the pane tabs (or press arrow keys) to switch focus between them.

**Horizontal split:** Use `Ctrl+K` → "split pane horizontal" to split vertically into top/bottom.

### 6. Creating Windows

Windows are like tabs for multiple layouts. Press `Ctrl+K` and search for "new window":

```
> new window
```

A new window appears in the sidebar. You're in a fresh workspace. This is useful for grouping related tasks.

**Example workflow:**
- Window 1: Code editor
- Window 2: Running servers
- Window 3: Monitoring logs

Click the window tabs to switch between them.

### 7. Using the Session Menu

Press `Ctrl+K` and search for "session menu":

```
> session menu
```

A visual menu appears listing all your sessions. You can:
- Click to switch sessions
- Create a new session
- Rename the current session
- Delete a session

Try renaming "mywork" to something more descriptive.

### 8. Saving and Loading Layout Profiles

Layout profiles save your entire workspace structure (sessions, windows, panes, and their arrangement).

**Save a layout:**

Press `Ctrl+K` and search for "save layout":

```
> save layout
```

Name it something memorable, like `dev-workspace`. Honeymux saves the layout.

**Load a layout:**

Press `Ctrl+K` and search for "load layout":

```
> load layout
```

Select `dev-workspace`. Honeymux recreates your entire workspace instantly.

**Where layouts are stored:** `~/.config/hmx/layouts/` (you can version-control these!)

### 9. Using the Command Palette

The command palette (`Ctrl+K`) is your gateway to Honeymux. Get comfortable with it:

```
Ctrl+K → "split" → Enter
Ctrl+K → "new window" → Enter
Ctrl+K → "theme" → Enter
Ctrl+K → "help" → Enter
```

Type partial commands—the search is smart. Type "split" and you'll see both "split pane vertical" and "split pane horizontal."

### 10. Taking Screenshots

Press `Ctrl+K` and search for "screenshot":

```
> screenshot
```

Honeymux captures your current session layout and saves it to `~/.config/hmx/screenshots/`. Useful for documentation or sharing your setup.

---

## Practical Examples

### Example 1: Development Workspace

Let's create a realistic development setup: code editor, running server, and logs side-by-side.

**Step 1:** Create a new session named "dev"

```bash
hmx
# Ctrl+K → "new session" → "dev"
```

**Step 2:** Split horizontally to create top and bottom panes

```
Ctrl+K → "split pane horizontal"
```

**Step 3:** In the top pane, open your code editor

```bash
nvim .  # or nano, vim, code, etc.
```

**Step 4:** Click the bottom pane (or press arrow keys to focus it)

```bash
npm start  # or python app.py, ruby app.rb, etc.
```

**Step 5:** Create a new window for logs

```
Ctrl+K → "new window"
```

**Step 6:** In this window, tail a log file

```bash
tail -f ~/logs/app.log
```

**Step 7:** Save this layout

```
Ctrl+K → "save layout" → "dev-workspace"
```

Now every time you need this setup, just load the layout and you're ready to code.

### Example 2: Monitoring Long-Running Processes with Hook-Based Agent Monitoring

Suppose you're running an AI coding agent or a CI/CD pipeline. Honeymux can monitor it and alert you when it finishes.

**Step 1:** Create a session for agent monitoring

```bash
hmx
# Ctrl+K → "new session" → "agents"
```

**Step 2:** Start your agent in one pane

```bash
python my_agent.py --config production.yaml
```

**Step 3:** Configure a hook (this requires editing a config file, but Honeymux handles it)

Edit `~/.config/hmx/config.yaml` (create if it doesn't exist):

```yaml
hooks:
  - name: "agent-complete"
    command: "test -f /tmp/agent_done"
    on_success:
      - notify: "Agent finished! Check results."
      - color: green
```

Honeymux will periodically check if your agent has completed and notify you visually.

**Step 4:** Arrange your panes to show related info

```bash
# Pane 1: Agent output
python my_agent.py

# Pane 2: Monitor logs
tail -f /tmp/agent.log

# Pane 3: Check results
watch -n 1 'ls -lh /tmp/results'
```

Now you can see your agent's progress at a glance without switching windows.

### Example 3: Remote Servers via SSH Pane Stitching

Honeymux can merge local and remote tmux sessions. Imagine working on a local machine and a remote server in the same Honeymux session.

**Step 1:** Ensure the remote server has tmux installed

```bash
ssh user@remote.server
tmux --version  # Verify tmux is available
exit
```

**Step 2:** Create a local session with Honeymux

```bash
hmx
# Ctrl+K → "new session" → "work"
```

**Step 3:** In one pane, SSH to your server

```bash
ssh user@remote.server
```

**Step 4:** Use Honeymux's SSH pane stitching (via command palette)

```
Ctrl+K → "attach remote" → "user@remote.server"
```

Honeymux now shows panes from both your local machine and the remote server. You can copy/paste between them seamlessly.

### Example 4: Customizing Themes with Base16

Honeymux supports Base16 color schemes. To change themes:

**Step 1:** List available themes

```bash
hmx --list-themes
# or via command palette
Ctrl+K → "theme"
```

**Step 2:** Switch to a theme you like

```
Ctrl+K → "theme" → Select "dracula" (or your favorite)
```

**Step 3:** Make it permanent by editing `~/.config/hmx/config.yaml`

```yaml
theme: "dracula"  # or "gruvbox", "nord", "solarized", etc.
```

Now all your Honeymux sessions use your chosen theme.

---

## Comparison with Other tmux Session Managers

Honeymux isn't the only terminal multiplexer or tmux wrapper out there. Here's how it compares:

| Feature | Honeymux | OpenMux | tmuxp | tmuxinator | Sesh | tmux-resurrect |
|---------|----------|---------|-------|-----------|------|-----------------|
| **UI Type** | Modern TUI (toolbar, sidebar, tabs) | Full TUI (Rust, own PTY) | Config-based | Config-based | Session switcher | tmux plugin |
| **Built on tmux** | Yes (tmux wrapper) | No (replaces tmux) | Yes (wrapper) | Yes (wrapper) | Alongside tmux | tmux plugin |
| **Layout profiles** | Yes (built-in) | Yes | Yes (YAML) | Yes (YAML) | No | Yes (session persistence) |
| **Session persistence** | Yes | Yes | Yes | Yes | Yes | Yes (primary focus) |
| **Pane tabs** | Yes (visual) | Yes | No | No | No | No |
| **Hook-based monitoring** | Yes (agents, processes) | Limited | No | No | No | No |
| **SSH pane stitching** | Yes (remote-backed) | No | No | No | No | No |
| **Keyboard-first** | Yes, but mouse-friendly | Yes | No (config-first) | No (config-first) | Yes | Not applicable |
| **Theming** | Base16 support | Full | No | No | No | No |
| **Learning curve** | Shallow (UI guides you) | Moderate | Moderate | Moderate | Shallow | Shallow (if you know tmux) |
| **Best for** | Terminal beginners, modern UX lovers | Replacing tmux entirely | DevOps, reproducible setups | DevOps, reproducible setups | Quick session switching | Session recovery |

### Key Differences Explained

**Honeymux vs. OpenMux:**
- OpenMux is a complete terminal multiplexer written in Rust with its own PTY layer. It's not a tmux wrapper—it replaces tmux entirely. Honeymux, by contrast, wraps tmux and adds a UI layer. If you need tmux-specific features or plugins, use Honeymux. If you want a modern alternative to tmux from scratch, try OpenMux.

**Honeymux vs. tmuxp/tmuxinator:**
- tmuxp and tmuxinator save session layouts in YAML files. They're great for DevOps but require editing config files. Honeymux gives you a visual interface to build layouts interactively, then saves them automatically.

**Honeymux vs. Sesh:**
- Sesh is a terminal session manager that works *alongside* tmux. It excels at session switching. Honeymux is more comprehensive—it enhances tmux with a full UI layer, including pane management, window tabs, and more.

**Honeymux vs. tmux-resurrect/tmux-continuum:**
- These are tmux plugins focused on session persistence and recovery. Honeymux includes session persistence out of the box, plus many other features (UI, layout profiles, monitoring).

---

## Hands-On Exercises

Try these to solidify what you've learned:

### Exercise 1: Build a Multi-Window Workspace

**Goal:** Create a session with 3 windows and save the layout.

1. Launch Honeymux: `hmx`
2. Create a session: `Ctrl+K` → "new session" → "practice"
3. In Window 1, split panes horizontally: `Ctrl+K` → "split pane horizontal"
   - Top pane: `echo "This is pane 1" && sleep 60`
   - Bottom pane: `echo "This is pane 2" && sleep 60`
4. Create a new window: `Ctrl+K` → "new window"
   - Run: `echo "Window 2"` 
5. Create another window: `Ctrl+K` → "new window"
   - Run: `date` and `sleep 30`
6. Save the layout: `Ctrl+K` → "save layout" → "practice-setup"
7. Quit Honeymux: `Ctrl+C`
8. Relaunch and load your layout: `Ctrl+K` → "load layout" → "practice-setup"

**Success:** Your multi-window workspace reappears exactly as you left it.

### Exercise 2: Organize a Real Workflow

**Goal:** Create a realistic development session and navigate it smoothly.

1. Launch Honeymux: `hmx`
2. Create a session: `Ctrl+K` → "new session" → "myapp"
3. Split the current pane horizontally
4. In the top pane, navigate to a project: `cd ~/my_project && ls -la`
5. In the bottom pane, check system resources: `top`
6. Create a new window for documentation: `Ctrl+K` → "new window"
7. Run: `python -m http.server 8000` (starts a local web server)
8. Switch back to the first window using the sidebar or tabs
9. Try different split arrangements using `Ctrl+K` → "split"

**Success:** You can smoothly navigate between windows and panes without losing your place.

### Exercise 3: Explore the Command Palette

**Goal:** Get comfortable with command discovery.

1. Launch Honeymux: `hmx`
2. Create a session: `Ctrl+K` → "new session" → "explore"
3. Try these command palette searches:
   - `Ctrl+K` → "help" (read the guide)
   - `Ctrl+K` → "new" (see all creation commands)
   - `Ctrl+K` → "kill" (see deletion commands)
   - `Ctrl+K` → "zoom" (explore pane zoom)
   - `Ctrl+K` → "theme" (preview themes)
4. Bonus: Change to a theme you like using the palette

**Success:** You're confident using `Ctrl+K` to find commands without memorizing them.

### Exercise 4: Save and Restore a Layout

**Goal:** Practice the layout persistence workflow.

1. Launch Honeymux: `hmx`
2. Create a complex session:
   - Session: "backup"
   - Window 1: Split into 4 panes (split vertical, then split each horizontally)
   - Window 2: Just one pane
   - Window 3: Split horizontally
3. Add content to each pane (e.g., `date`, `hostname`, `pwd`)
4. Save the layout: `Ctrl+K` → "save layout" → "my-complex-layout"
5. Close and reopen Honeymux
6. Load the layout: `Ctrl+K` → "load layout" → "my-complex-layout"

**Success:** Every window, pane, and working directory is restored exactly as you set it up.

---

## Troubleshooting

### Issue: "Command not found: hmx"

**Cause:** Honeymux isn't installed or not in your PATH.

**Solution:**
```bash
# Verify installation
which hmx

# If not found, reinstall
brew install honeymux/tap/hmx
# or
curl -fsSL https://get.hmx.dev | bash

# Restart your shell
exec $SHELL
```

### Issue: Honeymux doesn't display colors correctly

**Cause:** Your terminal doesn't support the color scheme or TERM variable is wrong.

**Solution:**
```bash
# Check your TERM setting
echo $TERM

# It should be something like 'xterm-256color' or 'tmux-256color'
# If not, set it
export TERM=xterm-256color

# Add to your shell config (~/.bashrc, ~/.zshrc) to make permanent
echo 'export TERM=xterm-256color' >> ~/.bashrc
```

### Issue: Pane tabs aren't showing

**Cause:** Your terminal is too small or Honeymux is running in a compatibility mode.

**Solution:**
- Maximize your terminal window
- Use a terminal emulator that supports Honeymux well (Kitty, iTerm2, Alacritty)
- Check that you're using a recent version: `hmx --version`

### Issue: Kitty keyboard protocol not working

**Cause:** Kitty protocol support requires a compatible terminal and Honeymux configuration.

**Solution:**
```bash
# Verify your terminal supports it (Kitty, WezTerm, Foot)
# In ~/.config/hmx/config.yaml, ensure:
enable_kitty_protocol: true

# Restart Honeymux
```

### Issue: SSH pane stitching doesn't work

**Cause:** Remote server doesn't have tmux installed or SSH keys aren't configured.

**Solution:**
```bash
# On the remote server, install tmux
ssh user@remote.server
sudo apt install tmux  # or brew install tmux on macOS

# Verify SSH key access (no password required)
ssh -o PasswordAuthentication=no user@remote.server echo "Success"
```

### Issue: Layout profiles aren't loading

**Cause:** Layout file is corrupted or in the wrong location.

**Solution:**
```bash
# Layouts are stored here
ls -la ~/.config/hmx/layouts/

# Check for issues
cat ~/.config/hmx/layouts/myLayout  # View the file

# If corrupted, delete and recreate
rm ~/.config/hmx/layouts/myLayout
# Recreate the layout in Honeymux
```

### Issue: Honeymux crashes or hangs

**Cause:** Conflict with existing tmux sessions or buggy plugin.

**Solution:**
```bash
# Quit all tmux sessions
tmux kill-server

# Reset Honeymux config to defaults
mv ~/.config/hmx ~/.config/hmx.backup

# Relaunch Honeymux
hmx
```

### Issue: First-run problems or unexpected behavior

**Cause:** Configuration conflicts or old tmux version.

**Solution:**
```bash
# Ensure tmux is up-to-date
brew upgrade tmux

# Check Honeymux version (requires 0.x or later)
hmx --version

# View Honeymux logs for errors
cat ~/.config/hmx/logs/*  # if logs exist

# Check GitHub issues
# https://github.com/honeymux/hmx/issues
```

---

## References

### Official Honeymux Resources
- **Website:** https://hmx.dev
- **Documentation:** https://docs.hmx.dev
- **GitHub:** https://github.com/honeymux/hmx
- **Interactive Demo:** https://hmx.dev (try it in your browser before installing)

### tmux Resources
- **Official tmux manual:** https://man.openbsd.org/tmux
- **tmux GitHub:** https://github.com/tmux/tmux
- **Learn tmux basics:** https://github.com/tmux/tmux/wiki (if you want deeper knowledge)

### Related Tools & Concepts
- **Base16 color schemes:** https://base16.io/ (for theme customization)
- **Terminal emulators:** Kitty, iTerm2, Alacritty, WezTerm (Honeymux works best with modern emulators)
- **Dotfiles management:** See [[dotfiles-beginner-guide]] and [[chezmoi-beginner-guide]] for managing Honeymux configs in version control

### Next Steps
Once you've mastered Honeymux, explore:
- **Advanced tmux config:** For power users who want to customize beyond Honeymux's UI
- **Integration with other tools:** SSH, Docker, scripting
- **Honeymux Deep Dive:** [[honeymux-deep-dive]] for advanced features and customization

---

## Related Tutorials

Once you've mastered Honeymux, check out these related guides:

**Alternative Terminal Multiplexers:**
- [[openmux-beginner-guide|OpenMux Beginner Guide]] — A modern alternative built from scratch
- [[openmux-deep-dive|OpenMux Deep Dive]] — Advanced OpenMux features
- [[sesh-beginner-guide|Sesh Beginner Guide]] — Terminal session switching
- [[sesh-deep-dive|Sesh Deep Dive]] — Sesh for power users

**Remote & Connection Tools:**
- [[mosh-beginner-guide|Mosh Beginner Guide]] — SSH alternative with better handling of network changes
- [[mosh-deep-dive|Mosh Deep Dive]] — Advanced remote connection techniques

**Configuration & Automation:**
- [[dotfiles-beginner-guide|Dotfiles Beginner Guide]] — Version-control your Honeymux configs
- [[chezmoi-beginner-guide|Chezmoi Beginner Guide]] — Dotfile management with Chezmoi
- [[just-beginner-guide|Just Beginner Guide]] — Automate Honeymux workflows with task runners

**Testing & Infrastructure:**
- [[docker-test-container-beginner-guide|Docker Test Container Beginner Guide]] — Test tmux configs in containers
- [[honeymux-deep-dive|Honeymux Deep Dive]] — Advanced Honeymux features and hooks

**macOS Automation & App Orchestration:**
- [[hammerspoon-deep-dive|Hammerspoon Deep Dive]] — Automate terminal and app workflows on macOS
- [[bunch-deep-dive|Bunch Deep Dive]] — Orchestrate apps and terminal workflows

---

## Summary

Congratulations! You now understand Honeymux and how to use it. Here's what you've learned:

### Key Takeaways

1. **Honeymux makes tmux accessible.** No need to memorize keybindings—use the UI.
2. **Sessions, windows, and panes** organize your terminal work logically.
3. **Layout profiles** let you save and restore entire workspaces instantly.
4. **The command palette** (`Ctrl+K`) is your friend—it guides you to every feature.
5. **Honeymux has superpowers** that plain tmux lacks: visual pane tabs, SSH stitching, hook-based monitoring, and more.
6. **It's perfect for beginners** because the UI teaches you as you go, but **it's powerful for experts** who need advanced multiplexing.

### Next Steps

1. **Install Honeymux** using Homebrew or the curl installer
2. **Launch it** with `hmx` and explore the UI
3. **Follow Exercise 1** to build your first multi-window workspace
4. **Create a layout profile** for your most-used workflow
5. **Bookmark the docs** at https://docs.hmx.dev for reference
6. **Join the community** on GitHub if you hit issues or want to contribute

### Your Terminal, Transformed

Honeymux transforms how you work in the terminal. Instead of juggling multiple windows, you now have one cohesive workspace with visual organization, persistence, and room to grow. You've reached "terminal velocity."

Happy multiplexing!

---

**Last Updated:** 2026-04-28  
**Version:** 1.0 (for Honeymux pre-1.0)
# Related Tutorials
- [[ssh-tutorial|SSH Tutorial]]
- [[maestri-beginner-guide|Maestri Beginner Guide]] — An alternative approach to terminal multiplexing using an infinite canvas with AI agent orchestration
- [[maestri-deep-dive|Maestri Deep Dive]] — Advanced Maestri patterns; complements Honeymux for remote session management

- [[dtach-beginner-guide|Dtach Beginner Guide]] — minimal detach/reattach when you don't need full multiplexing
- [[dtach-deep-dive|Dtach Deep Dive]] — dtach as a lightweight alternative or complement to tmux

- [[tmux-claude-code-beginner-guide|Tmux + Claude Code Beginner Guide]] — Using tmux with Claude Code for agentic coding workflows
- [[tmux-claude-code-deep-dive|Tmux + Claude Code Deep Dive]] — Advanced tmux + Claude Code patterns
