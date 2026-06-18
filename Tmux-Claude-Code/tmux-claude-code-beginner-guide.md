---
title: "Tmux + Claude Code — Beginner Guide"
date: 2026-05-13
difficulty: beginner
tags: [tmux, claude-code, terminal, session-management, ai-coding, agentic-coding, workflow]
---

# Tmux + Claude Code — Beginner Guide

## Overview

If you've started using Claude Code and found yourself wishing you could run it in the background, juggle multiple projects at once, or stop losing your session when your SSH connection drops — tmux is the answer.

**tmux** is a terminal multiplexer. In plain English: it lets you run multiple terminal sessions, windows, and split panes from a single terminal window. More importantly, those sessions live on the server (or your machine) independently of your terminal client — so if you close your terminal or lose your SSH connection, everything keeps running. You can reconnect later and pick up exactly where you left off.

**Claude Code** is Anthropic's official CLI for interacting with Claude as an agentic coding assistant. It can read your codebase, write and edit files, run shell commands, and work through multi-step engineering tasks autonomously. For a quick reference on Claude Code commands and flags, see [[claude-cheatsheet]].

### Why combining them is powerful

Agentic coding tools like Claude Code are fundamentally different from chatbots — they can run for minutes or even hours on complex tasks. That changes the workflow calculus entirely. tmux unlocks:

- **Multiple Claude Code sessions simultaneously** — run separate agents on your frontend, backend, and infra repos at the same time
- **Background execution** — detach from a long-running Claude Code task and go do other work; it keeps running
- **Session persistence across SSH disconnects** — critical for remote development; your Claude Code agent survives network hiccups
- **Side-by-side monitoring** — watch Claude Code writing code in one pane while your test runner shows results in real time in another
- **Instant project switching** — jump between named sessions for different projects without losing any context

This combination is especially valuable once you start giving Claude Code larger, more autonomous tasks. Instead of babysitting a single agent in a single terminal, you can orchestrate multiple agents across projects, monitor their progress, and intervene when needed — all from a clean, organized terminal workspace.

---

## Prerequisites

Before starting this tutorial, make sure you have:

- **macOS or Linux** (including WSL2 on Windows)
- **A terminal emulator** — iTerm2, Kitty, Alacritty, or Terminal.app all work well
- **tmux v3.0+** — we'll install it in Step 1
- **Node.js 18+** — required for Claude Code
- **Claude Code** installed globally (`npm install -g @anthropic-ai/claude-code`)
- **An active Anthropic API key** or a Claude Max/Pro subscription
- **Basic terminal comfort** — you should be comfortable with `cd`, `ls`, editing files, and running commands

> **New to Claude Code?** See [[claude-cheatsheet]] for a quick-reference guide to Claude Code commands, flags, and modes. For keyboard shortcuts inside Claude Code's interactive interface, see [[claude-hotkeys]].

---

## Key Concepts

### 1. tmux Sessions, Windows, and Panes

tmux has a three-level hierarchy. Understanding this upfront saves a lot of confusion:

```
Session: "myproject"
├── Window 0: editor
│   ├── Pane 0 (left):  claude (Claude Code interactive)
│   └── Pane 1 (right): npm test --watch
├── Window 1: git
│   └── Pane 0: git log --oneline
└── Window 2: server
    └── Pane 0: npm run dev
```

- **Session** — the top-level container. You name it (e.g., `coding`, `frontend`, `myapp`). Sessions persist even when you're not attached. You can have many sessions running simultaneously.
- **Window** — like a tab in a browser. Each session can have multiple windows. Each window fills your entire terminal.
- **Pane** — a split within a window. You can split any window into multiple panes horizontally or vertically. Each pane is an independent terminal.

### 2. The tmux Prefix Key

Almost all tmux keyboard shortcuts start with a **prefix key** — by default `Ctrl+B`. You press the prefix, release it, then press the command key.

For example:
- `Ctrl+B %` — split the current pane vertically (left/right)
- `Ctrl+B "` — split the current pane horizontally (top/bottom)
- `Ctrl+B d` — detach from the current session
- `Ctrl+B s` — show a list of all sessions

Think of `Ctrl+B` as "entering tmux command mode." It's the knock on the door before you give tmux an instruction.

### 3. Detach and Reattach

This is tmux's killer feature. When you **detach** from a session (`Ctrl+B d`), you leave the session running in the background. Your processes keep running — Claude Code keeps working, your server keeps serving, your tests keep running. You can:

- Close your terminal entirely
- Log out and log back in
- Disconnect from SSH and reconnect later

Then **reattach** with `tmux attach -t session-name` and everything is exactly as you left it.

### 4. Claude Code Basics

Claude Code has several usage modes relevant to a tmux workflow:

| Mode | Command | Description |
|---|---|---|
| Interactive | `claude` | Opens a REPL-style session; you chat back and forth with Claude Code |
| One-shot | `claude "task description"` | Runs a single task and exits |
| Continue | `claude -c` | Resumes the most recent conversation |
| Resume specific | `claude -r <session-id>` | Resumes a specific past conversation |

In a tmux workflow, you'll mostly use **interactive mode** (`claude`) — launch it in one pane and let it run while you work in others.

### 5. Why tmux + Claude Code Together

The practical scenarios where this combination shines:

- **Long autonomous tasks** — Give Claude Code a big refactor task, detach, come back when it's done
- **Multiple projects** — Three sessions, three codebases, three Claude Code agents — all running simultaneously
- **Real-time feedback loops** — Claude Code writes code in pane 1, test results appear in pane 2 automatically
- **Remote development** — SSH to your dev server, start Claude Code in tmux, detach, go home, SSH back in and pick up where you left off
- **Pair-programming style** — Watch Claude Code's output in one pane while you review git diffs in another

---

## Step-by-Step Instructions

### Step 1: Install tmux

**macOS (with Homebrew):**

```bash
brew install tmux
```

**Ubuntu / Debian / WSL2:**

```bash
sudo apt update && sudo apt install tmux
```

**Fedora / RHEL:**

```bash
sudo dnf install tmux
```

Verify the installation:

```bash
tmux -V
```

Expected output:

```
tmux 3.4
```

Any version 3.0 or later works for this tutorial.

---

### Step 2: Install Claude Code

If you haven't installed Claude Code yet:

```bash
npm install -g @anthropic-ai/claude-code
```

Verify it's installed and accessible:

```bash
claude --version
```

Expected output:

```
1.x.x (or similar version number)
```

If you get `command not found`, make sure your npm global bin directory is on your `PATH`. Run `npm bin -g` to find it and add it to your shell profile.

---

### Step 3: Start Your First tmux Session

Create a new named session:

```bash
tmux new-session -s coding
```

The `-s coding` flag names the session "coding." You'll see your terminal transform — the content of your screen stays the same, but a **status bar** appears at the bottom. It looks something like:

```
[coding] 0:bash*                                         "hostname" 14:32 13-May-26
```

Breaking that down:
- `[coding]` — the session name
- `0:bash*` — window 0, running bash, the `*` means it's the active window
- `"hostname"` — your machine's hostname
- `14:32 13-May-26` — time and date

You're now inside a tmux session. Everything you do here is persistent.

---

### Step 4: Split Panes for Claude Code + Monitoring

A single pane is useful, but the real power comes from splitting. Let's set up a two-pane layout.

**Split vertically (creates left and right panes):**

```
Ctrl+B %
```

**Split horizontally (creates top and bottom panes):**

```
Ctrl+B "
```

**Navigate between panes:**

```
Ctrl+B ←    move to left pane
Ctrl+B →    move to right pane
Ctrl+B ↑    move to pane above
Ctrl+B ↓    move to pane below
```

For a typical Claude Code workflow, split vertically (`Ctrl+B %`) to get a left pane for Claude Code and a right pane for monitoring. You can resize panes by pressing `Ctrl+B` then holding `Ctrl` and pressing the arrow keys.

**Zoom into a single pane (full screen):**

```
Ctrl+B z
```

Press `Ctrl+B z` again to zoom back out. This is handy when you need to read Claude Code's full output without squinting at a half-pane.

---

### Step 5: Launch Claude Code in One Pane

Navigate to the pane where you want Claude Code to run (use `Ctrl+B ←/→`), then:

```bash
cd ~/projects/myapp
claude
```

You'll see Claude Code's welcome screen and interactive prompt. This pane now belongs to Claude Code. You can give it tasks, answer its questions, or just let it run.

Example: start a task and let it work autonomously:

```
> Add input validation to all API endpoints in the routes/ directory. Use Zod for schema validation. Run the tests after each file to make sure nothing breaks.
```

Claude Code will start reading your codebase, making a plan, and executing changes. Now switch to your other pane (`Ctrl+B →`) and continue working.

---

### Step 6: Use Other Panes for Testing and Monitoring

With Claude Code running in pane 1, your second pane is free for anything. Common uses:

**Watch test results in real time:**

```bash
npm test -- --watch
# or
pytest --watch
# or
go test ./... -watch
```

**Monitor git changes:**

```bash
watch -n 2 'git diff --stat'
```

**Tail application logs:**

```bash
tail -f logs/development.log
```

**Check system resources:**

```bash
htop
```

**Review what Claude Code has changed so far:**

```bash
git diff
```

The panes update independently and simultaneously. You can see Claude Code's output on the left and your test suite's response on the right — a tight, real-time feedback loop with no alt-tabbing required.

---

### Step 7: Detach and Reattach

This is the step that makes everything click. When you need to step away — or want to close your terminal — you don't have to stop Claude Code. Just detach:

```
Ctrl+B d
```

Your terminal returns to the normal prompt and shows:

```
[detached (from session coding)]
```

Claude Code is still running. Your tests are still running. Everything continues in the background.

**List all running sessions:**

```bash
tmux ls
```

Output:

```
coding: 1 windows (created Wed May 13 14:32:01 2026) [220x50]
```

**Reattach to the session:**

```bash
tmux attach -t coding
```

You're back in, exactly where you left off. Claude Code's output has been scrolling while you were gone — use `Ctrl+B [` to enter scroll/copy mode and review what happened (arrow keys or Page Up/Down to scroll, `q` to exit).

> **Key insight:** This is the single most powerful thing about tmux for agentic coding. You can give Claude Code a 30-minute task, detach, go to a meeting, come back, and review the results.

---

### Step 8: Create Named Sessions per Project

For multi-project workflows, create a dedicated session for each project:

```bash
# In separate terminal windows, or one after another (detach between each)
tmux new-session -s frontend
tmux new-session -s backend
tmux new-session -s infra
```

Each session can have its own Claude Code instance, its own working directory, and its own pane layout. They all run simultaneously.

**Switch between sessions interactively:**

```
Ctrl+B s
```

This opens a session picker — use arrow keys to navigate, Enter to switch. It looks like:

```
(0) + coding: 1 windows
(1) + frontend: 2 windows
(2) + backend: 3 windows
(3) + infra: 1 windows
```

**Switch directly by name:**

```bash
tmux switch-client -t frontend
```

**Kill a session when you're done:**

```bash
tmux kill-session -t infra
```

---

### Step 9: Configure tmux for Claude Code Workflow

The default tmux configuration is functional but not optimized for Claude Code's output-heavy sessions. Create or edit `~/.tmux.conf`:

```bash
# Enable mouse support (click to switch panes, resize with drag)
set -g mouse on

# Start window and pane numbering at 1 (easier to reach on keyboard)
set -g base-index 1
set -g pane-base-index 1

# Increase scrollback buffer — critical for Claude Code's verbose output
set -g history-limit 50000

# Renumber windows when one is closed
set -g renumber-windows on

# Better status bar styling
set -g status-style 'bg=#333333 fg=#ffffff'
set -g status-left '[#S] '
set -g status-left-length 30
set -g status-right ' %H:%M %d-%b-%y '

# Fix terminal colors
set -g default-terminal "xterm-256color"
set -ga terminal-overrides ",xterm-256color:Tc"

# Quick pane switching with Alt+Arrow (no prefix needed)
bind -n M-Left select-pane -L
bind -n M-Right select-pane -R
bind -n M-Up select-pane -U
bind -n M-Down select-pane -D

# Reload config with prefix+r
bind r source-file ~/.tmux.conf \; display "Config reloaded!"

# Split panes using | and - (more intuitive than % and ")
bind | split-window -h -c "#{pane_current_path}"
bind - split-window -v -c "#{pane_current_path}"

# New windows open in current directory
bind c new-window -c "#{pane_current_path}"
```

Apply the configuration without restarting tmux:

```bash
tmux source-file ~/.tmux.conf
```

Or inside tmux: `Ctrl+B r` (if you added the reload binding above).

**Why these settings matter for Claude Code:**

- `history-limit 50000` — Claude Code generates a lot of output, especially during large refactors or when it explains its reasoning. The default limit of 2000 lines means you lose earlier output. 50k keeps much more history accessible.
- `mouse on` — makes it much easier to click between panes and resize them without memorizing resize key combos
- `xterm-256color` — Claude Code uses colors in its output; this ensures they render correctly

---

### Step 10: Set Up a Claude Code Workspace Script

Once you have a preferred layout, automate it. Create a startup script that builds your entire workspace in one command:

```bash
#!/bin/bash
# ~/scripts/claude-workspace.sh
# Usage: ./claude-workspace.sh [project-path]

SESSION="claude-dev"
PROJECT_PATH="${1:-~/projects/myapp}"

# Don't create a duplicate session
tmux has-session -t $SESSION 2>/dev/null
if [ $? == 0 ]; then
  echo "Session $SESSION already exists. Attaching..."
  tmux attach -t $SESSION
  exit
fi

# Create the session with a first window named "editor"
tmux new-session -d -s $SESSION -n editor

# Pane 0 (default): Launch Claude Code
tmux send-keys -t $SESSION:editor "cd $PROJECT_PATH && claude" C-m

# Split right: test watcher
tmux split-window -h -t $SESSION:editor
tmux send-keys -t $SESSION:editor.right "cd $PROJECT_PATH && npm test -- --watch 2>&1" C-m

# Create a second window for git work
tmux new-window -t $SESSION -n git
tmux send-keys -t $SESSION:git "cd $PROJECT_PATH && git log --oneline -20" C-m

# Create a third window for logs
tmux new-window -t $SESSION -n logs
tmux send-keys -t $SESSION:logs "cd $PROJECT_PATH && tail -f logs/development.log 2>/dev/null || echo 'No log file yet'" C-m

# Return focus to the editor window, Claude Code pane
tmux select-window -t $SESSION:editor
tmux select-pane -t $SESSION:editor.left

# Attach to the session
tmux attach -t $SESSION
```

Make it executable and run it:

```bash
chmod +x ~/scripts/claude-workspace.sh
~/scripts/claude-workspace.sh ~/projects/myapp
```

You'll land in a fully configured workspace: Claude Code on the left, tests on the right, git and logs in separate windows.

---

## Practical Examples

### Example 1: Multi-Project Claude Code Setup

Suppose you're working on a full-stack application with a separate frontend repo, a backend API repo, and infrastructure-as-code. Here's how to run three Claude Code instances simultaneously:

```bash
# Terminal 1: Frontend session
tmux new-session -s frontend -d
tmux send-keys -t frontend "cd ~/projects/myapp-frontend && claude" C-m

# Terminal 2: Backend session
tmux new-session -s backend -d
tmux send-keys -t backend "cd ~/projects/myapp-backend && claude" C-m

# Terminal 3: Infrastructure session
tmux new-session -s infra -d
tmux send-keys -t infra "cd ~/projects/myapp-infra && claude" C-m

# Attach to whichever you want to interact with
tmux attach -t frontend
```

Switch between them with `Ctrl+B s`. Each Claude Code instance has full context of its respective codebase. You can give each one a task, detach, switch to the next, give it a task, and cycle back to check progress.

---

### Example 2: Claude Code + Live Test Feedback

This is the tightest feedback loop you can build. Split your window vertically:

```
┌─────────────────────────┬─────────────────────────┐
│                         │                         │
│   Claude Code           │   Test Runner           │
│                         │                         │
│   > Add unit tests for  │   PASS  auth.test.js    │
│     the auth module     │   FAIL  user.test.js    │
│                         │   ● user.create should  │
│   Reading files...      │     return 201...       │
│   Writing tests...      │                         │
│                         │   Tests: 12 passed,     │
│                         │         1 failed        │
└─────────────────────────┴─────────────────────────┘
```

Setup commands:

```bash
# Start a session and split it
tmux new-session -s dev
# (Now inside tmux)
# Split vertically
# Ctrl+B %

# Left pane: Claude Code
# cd ~/projects/myapp && claude

# Right pane (Ctrl+B →): Test watcher
# npm test -- --watch --verbose
```

Now give Claude Code a task like "Add unit tests for the auth module, fix any failures you find." Watch the right pane update as Claude Code writes tests — failures appear immediately, and if Claude Code is in a loop, you'll see the test count climbing toward green.

---

### Example 3: Remote Development via SSH

One of the most compelling use cases — especially for teams using cloud dev boxes or those who work from multiple locations.

```bash
# At the office: SSH to your dev server and start working
ssh dev-server.company.com
tmux new-session -s remote-claude
cd ~/projects/bigproject
claude
```

Give Claude Code a large task — something that might take 20-30 minutes:

```
> Migrate all database queries in the models/ directory from raw SQL to TypeORM. Preserve all existing behavior. Run the full test suite after each file.
```

Now detach and close your SSH connection:

```
Ctrl+B d
exit
```

Claude Code is still running on the server. You can close your laptop, go home, commute, and reconnect later:

```bash
# At home: SSH back in
ssh dev-server.company.com
tmux ls
# remote-claude: 1 windows (created ...)
tmux attach -t remote-claude
# Claude Code has been working the whole time!
```

---

### Example 4: Monitoring Claude Code Progress

For longer autonomous tasks, set up a monitoring pane so you don't have to interrupt Claude Code to see what's changed:

```bash
# Pane 1: Claude Code running a large refactor
claude "Refactor the auth module to use JWT tokens instead of sessions. Update all tests."

# Pane 2 (Ctrl+B " to split, then Ctrl+B ↓ to navigate there):
# Watch file changes in real time
watch -n 3 'git diff --stat && echo "---" && git status --short'
```

You'll see files appearing in the diff output as Claude Code modifies them — without having to interrupt or query Claude Code directly. When the diff stops changing and the status shows `nothing to commit`, you know Claude Code has finished and committed its work.

---

## Hands-On Exercises

Work through these exercises in order. Each one builds on skills from the previous.

### Exercise 1: Basic tmux + Claude Code

**Goal:** Get comfortable with the core tmux + Claude Code loop.

1. Open a fresh terminal
2. Create a tmux session: `tmux new-session -s practice`
3. Split into two vertical panes: `Ctrl+B %`
4. In the left pane, navigate to a project directory and run `claude`
5. In the right pane (`Ctrl+B →`), run `htop`
6. Practice navigating between panes with `Ctrl+B ←` and `Ctrl+B →`
7. Zoom into the left pane with `Ctrl+B z`, then zoom back out
8. Detach with `Ctrl+B d`
9. Verify the session is running: `tmux ls`
10. Reattach: `tmux attach -t practice`

**What to observe:** Both panes are exactly as you left them. Claude Code's prompt is waiting.

---

### Exercise 2: Multi-Window Workspace

**Goal:** Use tmux windows to organize different concerns.

1. Start a session: `tmux new-session -s multiwindow`
2. This is Window 1 — run `claude` here (interactive mode)
3. Create Window 2: `Ctrl+B c`, then run `git log --oneline -20`
4. Create Window 3: `Ctrl+B c`, then run your dev server or `python -m http.server 8000`
5. Practice switching windows:
   - `Ctrl+B 1` — jump to window 1 (Claude Code)
   - `Ctrl+B 2` — jump to window 2 (git log)
   - `Ctrl+B 3` — jump to window 3 (server)
   - `Ctrl+B n` — next window
   - `Ctrl+B p` — previous window
6. Give Claude Code a small task in window 1, switch to window 2 and watch `git log`, switch back to window 1 to review

**What to observe:** Claude Code runs uninterrupted regardless of which window you're viewing.

---

### Exercise 3: Persistence Test

**Goal:** Prove to yourself that tmux sessions truly persist.

1. Start a session: `tmux new-session -s persist-test`
2. Run Claude Code: `claude`
3. Give it a task with a deliberate delay, or just start an interactive session and type a message
4. Detach: `Ctrl+B d`
5. **Close your terminal window completely** — not just detach, actually close the app
6. Open a brand new terminal
7. List sessions: `tmux ls`
8. Reattach: `tmux attach -t persist-test`

**What to observe:** Claude Code is still running. The terminal output is intact. Nothing was lost.

---

### Exercise 4: Workspace Script

**Goal:** Automate your personal Claude Code workspace.

1. Copy the workspace script from Step 10 into `~/scripts/claude-workspace.sh`
2. Edit it to point at a real project you have on disk
3. Change the test command to whatever your project uses (`pytest`, `cargo test`, `go test ./...`, etc.)
4. Make it executable: `chmod +x ~/scripts/claude-workspace.sh`
5. Run it: `~/scripts/claude-workspace.sh`
6. Verify all three windows are created and the correct commands are running
7. Detach, then reattach — confirm everything survives

**Bonus:** Add an alias to your shell profile: `alias cw='~/scripts/claude-workspace.sh'`

---

## Troubleshooting

### "tmux: command not found"

tmux isn't installed or isn't on your PATH. Run the install command for your OS from Step 1. On macOS, make sure Homebrew is installed first: `brew --version`.

---

### Claude Code not found inside tmux / "claude: command not found"

This happens when tmux doesn't inherit your full shell PATH. The fix is to source your shell profile explicitly, or configure tmux to launch a login shell.

**Quick fix — add to `~/.tmux.conf`:**

```bash
set -g default-command "${SHELL}"
```

**Or source your profile manually when the issue occurs:**

```bash
source ~/.zshrc   # for zsh
source ~/.bashrc  # for bash
```

**Permanent fix for zsh users — add to `~/.zshenv`:**

```bash
export PATH="$PATH:$(npm bin -g)"
```

---

### Copy/paste not working in tmux

With mouse mode enabled, text selection works differently. Two options:

**Option 1 — tmux copy mode** (keyboard-based):
- Enter copy mode: `Ctrl+B [`
- Navigate with arrow keys or Page Up/Down
- Start selection: press `Space`, move to end of selection, press `Enter` to copy
- Paste: `Ctrl+B ]`

**Option 2 — Hold Shift while clicking** to bypass tmux and use your terminal emulator's native selection

**Option 3 — iTerm2 users:** In iTerm2 preferences → Profiles → Terminal, enable "Applications in terminal may access clipboard"

---

### Panes are too small for Claude Code output

**Resize a pane:**

```
Ctrl+B :resize-pane -D 10    (grow downward 10 lines)
Ctrl+B :resize-pane -U 10    (shrink upward 10 lines)
Ctrl+B :resize-pane -R 20    (grow rightward 20 cols)
Ctrl+B :resize-pane -L 20    (shrink leftward 20 cols)
```

**Or zoom to full screen temporarily:** `Ctrl+B z` (toggle)

**Or just resize your terminal window** — tmux panes resize automatically.

---

### Terminal colors look wrong in tmux

Claude Code uses ANSI colors. If they look off, ensure this is in your `~/.tmux.conf`:

```bash
set -g default-terminal "xterm-256color"
set -ga terminal-overrides ",xterm-256color:Tc"
```

Then restart tmux or source the config.

---

### "I lost my Claude Code session"

If you think you lost work, check for running tmux sessions first:

```bash
tmux ls
```

If your session is listed, attach to it:

```bash
tmux attach -t <session-name>
```

If you don't see it, it may have exited cleanly (Claude Code finished its task) or been killed. Check `~/.claude/` for conversation logs — Claude Code saves session history there.

---

### Can't scroll Claude Code output in tmux

Normal scrolling doesn't work inside tmux by default. Use tmux's copy/scroll mode:

1. Enter scroll mode: `Ctrl+B [`
2. Scroll up: `Page Up` or `↑` (line by line)
3. Scroll down: `Page Down` or `↓`
4. Search backward: `/` then type search term, `n` for next match
5. Exit scroll mode: `q`

The `history-limit 50000` setting in your `~/.tmux.conf` (from Step 9) ensures you have plenty of scrollback to review.

---

## References

- [tmux official documentation and wiki](https://github.com/tmux/tmux/wiki)
- [Claude Code documentation](https://docs.anthropic.com/en/docs/claude-code)
- [tmux cheat sheet (tmuxcheatsheet.com)](https://tmuxcheatsheet.com/)
- [Claude Code on GitHub](https://github.com/anthropics/claude-code)

---

## Related Tutorials

- [[tmux-claude-code-deep-dive|Tmux + Claude Code Deep Dive]] — Advanced tmux + Claude Code patterns
- [[sesh-beginner-guide|Sesh Beginner Guide]] — Smart tmux session manager (great companion for Claude Code)
- [[sesh-deep-dive|Sesh Deep Dive]] — Advanced sesh configuration
- [[honeymux-beginner-guide|Honeymux Beginner Guide]] — TUI wrapper for tmux
- [[honeymux-deep-dive|Honeymux Deep Dive]] — Advanced Honeymux features
- [[openmux-beginner-guide|OpenMux Beginner Guide]] — Modern terminal multiplexer alternative
- [[openmux-deep-dive|OpenMux Deep Dive]] — Advanced OpenMux usage
- [[dtach-beginner-guide|Dtach Beginner Guide]] — Minimal detach/reattach tool
- [[dtach-deep-dive|Dtach Deep Dive]] — Advanced dtach patterns
- [[mosh-beginner-guide|Mosh Beginner Guide]] — Better SSH for mobile connections
- [[mosh-deep-dive|Mosh Deep Dive]] — Advanced Mosh configuration
- [[ssh-tutorial|SSH Tutorial]] — SSH fundamentals
- [[claude-cheatsheet|Claude Code Cheatsheet]] — Quick reference for Claude Code commands
- [[claude-hotkeys|Claude Code Hotkeys]] — Keyboard shortcuts for Claude Code
- [[claude-code-vscode-go-beginner-guide|Claude Code + VSCode + Go Beginner Guide]] — Claude Code in IDE workflows
- [[dotfiles-beginner-guide|Dotfiles Beginner Guide]] — Managing your tmux.conf and configs
- [[dotfiles-deep-dive|Dotfiles Deep Dive]] — Advanced dotfile management
- [[chezmoi-beginner-guide|Chezmoi Beginner Guide]] — Dotfile management across machines
- [[chezmoi-deep-dive|Chezmoi Deep Dive]] — Advanced Chezmoi usage
- [[git-worktrees-worktrunk-beginner-guide|Git Worktrees Beginner Guide]] — Run Claude Code on separate worktrees
- [[git-worktrees-worktrunk-deep-dive|Git Worktrees Deep Dive]] — Advanced worktree patterns
- [[gh-cli-beginner-guide|GitHub CLI Beginner Guide]] — GitHub from the terminal
- [[television-beginner-guide|Television Beginner Guide]] — Fuzzy finder for terminal workflows

---

## Summary

You now have everything you need to use tmux and Claude Code together effectively. Here are the key takeaways:

1. **tmux sessions persist** — Claude Code keeps working even after you detach, close your terminal, or lose your SSH connection. This is the foundational benefit.
2. **Run multiple Claude Code instances simultaneously** — one session per project, each with its own agent working autonomously.
3. **Split panes create powerful feedback loops** — Claude Code writes code in one pane while your test runner, log tail, or git diff shows results in real time in another.
4. **Named sessions keep projects organized** — use `Ctrl+B s` to switch between them instantly.
5. **Startup scripts automate your workspace** — one command builds your entire multi-window, multi-pane dev environment.
6. **The combination is especially powerful for remote development** — SSH into a dev server, start a long-running Claude Code task in tmux, detach, disconnect, and pick up where you left off from anywhere.

**Suggested next steps:**

- Try [[sesh-beginner-guide|sesh]] for smarter, fuzzy-searchable tmux session management — it pairs extremely well with this workflow
- Read [[tmux-claude-code-deep-dive]] to explore advanced patterns: workspace templates, Claude Code automation scripts, multi-agent orchestration, and tmux scripting
- Check [[dotfiles-beginner-guide]] to version-control your `~/.tmux.conf` so your setup is reproducible across machines
- Explore [[git-worktrees-worktrunk-beginner-guide|git worktrees]] to run Claude Code on isolated branches without juggling stashes
# Related Tutorials

- [[herdr-beginner-guide|Herdr Beginner Guide]] — terminal-native agent runtime with built-in agent state awareness