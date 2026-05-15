---
title: "Dtach Beginner Guide: Detach and Reattach Terminal Sessions"
date: 2026-05-13
difficulty: beginner
tags: [dtach, terminal, session-management, detach, ssh, remote-access, linux]
---

## Overview

**dtach** is a tiny, focused Unix utility that does one thing exceptionally well: it lets you **detach a program from your terminal** and **reattach to it later**. If you've ever had an SSH session die mid-way through a long-running job and lost everything, dtach solves that problem with minimal overhead.

Think of dtach as the "detach" feature ripped out of GNU Screen and packaged as a standalone tool. It doesn't give you split panes, status bars, or window management — that's what tmux and screen do. Instead, dtach provides a **single Unix socket** that keeps your program alive regardless of what happens to your terminal connection.

**Why dtach over tmux or screen?**

- **Minimal footprint** — dtach is a single ~15 KB binary written in C with zero dependencies
- **Does one thing well** — follows the Unix philosophy; no configuration files, no learning curve
- **Composable** — works alongside tmux, inside SSH sessions, or with tools like [[mosh-beginner-guide|Mosh]]
- **Fast startup** — no configuration parsing, no plugin loading, instant launch

**What you will learn:**

1. How to install dtach on macOS and Linux
2. How to start, detach from, and reattach to sessions
3. How dtach keeps programs alive across SSH disconnections
4. How to combine dtach with SSH for resilient remote workflows
5. How dtach compares to and complements tmux

---

## Prerequisites

Before starting, you should be comfortable with:

- Basic terminal/shell usage (navigating directories, running commands)
- Understanding of what happens when you close a terminal (processes receive SIGHUP and die)
- Basic [[ssh-tutorial|SSH]] usage if you plan to use dtach remotely

**System requirements:**

- macOS with Homebrew, or a Linux distribution with apt/dnf/pacman
- A C compiler (only needed if building from source)
- For remote use: SSH access to a server or HPC cluster

---

## Key Concepts

### The Problem: Terminal-Bound Processes

When you run a program in your terminal, it is **attached** to that terminal session. If the terminal closes — whether you close the window, your SSH connection drops, or your laptop sleeps — the operating system sends a `SIGHUP` (hangup signal) to the process, which typically kills it.

```
You ──── Terminal ──── Process
         (dies)         (dies too!)
```

### The Solution: A Unix Socket as a Middleman

dtach inserts a **Unix socket** between your terminal and the program. The socket keeps the program running independently of any terminal:

```
You ──── Terminal ──── dtach socket ──── Process
         (dies)        (survives!)       (survives!)
```

Later, you can reconnect a new terminal to the same socket:

```
You ──── New Terminal ──── dtach socket ──── Process
                           (still here!)     (still running!)
```

### Key Terminology

| Term | Meaning |
|------|---------|
| **Socket** | A file (usually in `/tmp`) that dtach creates to maintain the connection between your terminal and the program |
| **Detach** | Disconnecting your terminal from the socket without killing the program |
| **Attach** | Connecting a new terminal to an existing socket |
| **Session** | A running program managed by dtach, identified by its socket path |

### How dtach Differs from tmux/screen

| Feature | dtach | tmux | screen |
|---------|-------|------|--------|
| Detach/reattach | ✅ | ✅ | ✅ |
| Multiple windows/panes | ❌ | ✅ | ✅ |
| Status bar | ❌ | ✅ | ✅ |
| Scrollback buffer | ❌ | ✅ | ✅ |
| Copy mode | ❌ | ✅ | ✅ |
| Config file | ❌ | ✅ | ✅ |
| Binary size | ~15 KB | ~1 MB | ~1 MB |
| Dependencies | None | libevent, ncurses | ncurses |
| Learning curve | Minutes | Hours | Hours |

dtach is **not a replacement** for tmux — it's a complement. Use dtach when you need bare-bones session persistence without the weight of a full multiplexer. Use tmux when you need panes, windows, and a rich terminal environment. You can even run tmux *inside* dtach if you want both.

---

## Step-by-Step Instructions

### 1. Install dtach

**On macOS (Homebrew):**

```bash
brew install dtach
```

**On Ubuntu/Debian:**

```bash
sudo apt update
sudo apt install dtach
```

**On Fedora/RHEL:**

```bash
sudo dnf install dtach
```

**On Arch Linux:**

```bash
sudo pacman -S dtach
```

**From source (any Unix system):**

```bash
git clone https://github.com/crigler/dtach.git
cd dtach
./configure
make
sudo make install
```

Verify installation:

```bash
dtach --help
```

Expected output:

```
dtach - version 0.9
Usage: dtach -a <socket> <options>
       dtach -A <socket> <options> <command> <args>
       dtach -c <socket> <options> <command> <args>
       dtach -n <socket> <options> <command> <args>
       dtach -N <socket> <options> <command> <args>
       dtach -p <socket>
```

### 2. Create Your First dtach Session

The `-c` flag creates a new session and immediately attaches to it:

```bash
dtach -c /tmp/my-session bash
```

This does three things:

1. Creates a Unix socket at `/tmp/my-session`
2. Starts `bash` as the managed program
3. Attaches your current terminal to the session

You're now inside a dtach-managed shell. Everything looks normal — you're just in a regular bash session — but now it's protected from terminal disconnection.

### 3. Detach from a Session

To detach (leave the session running in the background), press:

```
Ctrl+\
```

This is the default detach key. Your terminal returns to where you were before, and the session continues running in the background.

Expected output after detaching:

```
[detached]
```

### 4. Reattach to a Session

To reconnect to your running session:

```bash
dtach -a /tmp/my-session
```

You're back exactly where you left off. Any output the program produced while you were detached will be visible (depending on the terminal buffer).

### 5. Create a Session Without Attaching

The `-n` flag starts a session in the background without attaching:

```bash
dtach -n /tmp/background-job bash -c "sleep 300 && echo 'Done!' > /tmp/result.txt"
```

This is perfect for fire-and-forget tasks. The job runs in the background, and you can check on it later:

```bash
dtach -a /tmp/background-job
```

### 6. The Smart Create-or-Attach Flag

The `-A` flag is the most convenient: it attaches to an existing session if the socket exists, or creates a new one if it doesn't:

```bash
dtach -A /tmp/my-session bash
```

This is ideal for aliases and scripts because you don't need to remember whether a session is already running.

### 7. Clean Up Finished Sessions

When the program inside dtach exits, the socket file is automatically removed. But if something goes wrong, you may need to clean up manually:

```bash
# Check if a socket still exists
ls -la /tmp/my-session

# Remove a stale socket
rm /tmp/my-session
```

---

## Practical Examples

### Example 1: Keep a Long-Running Script Alive Over SSH

You're connected to a remote server via [[ssh-tutorial|SSH]] and need to run a data processing script that takes hours:

```bash
# SSH to your server
ssh user@server.example.com

# Start the job inside dtach
dtach -n /tmp/data-processing bash -c "python process_data.py > /tmp/output.log 2>&1"

# You can now safely disconnect from SSH
exit
```

The next day, check on your job:

```bash
ssh user@server.example.com
dtach -a /tmp/data-processing
```

### Example 2: Persistent Development Environment

Create a session for your development work that survives SSH drops:

```bash
# Create or attach to your dev session
dtach -A /tmp/dev-session bash
```

Inside the session, start your dev server, run tests, edit files — whatever you need. When your WiFi drops or you close your laptop, just reconnect later:

```bash
dtach -a /tmp/dev-session
```

### Example 3: Running Multiple Independent Background Jobs

Unlike tmux windows, dtach sessions are completely independent. This is actually an advantage for isolated tasks:

```bash
# Start three independent jobs
dtach -n /tmp/job-compile bash -c "make -j8 2>&1 | tee /tmp/compile.log"
dtach -n /tmp/job-test bash -c "pytest tests/ 2>&1 | tee /tmp/test.log"
dtach -n /tmp/job-backup bash -c "rsync -avz /data /backup/ 2>&1 | tee /tmp/backup.log"

# Check on any of them
dtach -a /tmp/job-compile    # Ctrl+\ to detach
dtach -a /tmp/job-test       # Ctrl+\ to detach
dtach -a /tmp/job-backup     # Ctrl+\ to detach
```

### Example 4: Using dtach with SSH and a Custom Alias

Add these to your `~/.bashrc` or `~/.zshrc` for convenience:

```bash
# Quick dtach session management
ds() {
    # Create or attach to a named session
    dtach -A "/tmp/dtach-${1:-default}" bash
}

# List active dtach sessions
dl() {
    echo "Active dtach sessions:"
    ls /tmp/dtach-* 2>/dev/null || echo "  (none)"
}
```

Usage:

```bash
ds work        # Create/attach to "work" session
# Ctrl+\ to detach
ds analysis    # Create/attach to "analysis" session
# Ctrl+\ to detach
dl             # List all sessions
```

For more advanced shell customization, see [[dotfiles-beginner-guide|Dotfiles Beginner Guide]].

### Example 5: dtach + SSH One-Liner for Remote Jobs

Start a remote job without even opening an interactive session:

```bash
ssh user@server "dtach -n /tmp/remote-job bash -c 'python train_model.py > /tmp/training.log 2>&1'"
```

This SSHs in, starts the job under dtach, and immediately returns control to your local terminal. Check on it later:

```bash
ssh -t user@server "dtach -a /tmp/remote-job"
```

Note the `-t` flag — it forces SSH to allocate a pseudo-terminal, which dtach needs for reattachment.

---

## Hands-On Exercises

### Exercise 1: Basic Create, Detach, Reattach

1. Create a dtach session: `dtach -c /tmp/exercise1 bash`
2. Inside the session, run: `echo "Hello from dtach" && sleep 120`
3. Detach with `Ctrl+\`
4. Verify the socket exists: `ls -la /tmp/exercise1`
5. Reattach: `dtach -a /tmp/exercise1`
6. Verify the sleep is still running: `ps aux | grep sleep`

**Expected outcome:** The sleep command survives your detachment.

### Exercise 2: Background Job Without Attaching

1. Start a background job: `dtach -n /tmp/exercise2 bash -c "for i in $(seq 1 10); do echo \"Count: $i\" >> /tmp/exercise2.log; sleep 5; done"`
2. Monitor the log: `tail -f /tmp/exercise2.log`
3. Wait for a few entries, then attach: `dtach -a /tmp/exercise2`
4. Watch the output in real-time inside the session

**Expected outcome:** The job has been running and logging while you were away.

### Exercise 3: The -A Flag (Create-or-Attach)

1. Run: `dtach -A /tmp/exercise3 bash` — this creates a new session
2. Inside, run: `echo $RANDOM > /tmp/exercise3-id.txt`
3. Detach with `Ctrl+\`
4. Run the same command again: `dtach -A /tmp/exercise3 bash`
5. Check: `cat /tmp/exercise3-id.txt` — it should be the same number (same session)
6. Exit the shell: `exit`
7. Run the command once more: `dtach -A /tmp/exercise3 bash`
8. Check: `cat /tmp/exercise3-id.txt` — now it's a different number (new session, since the old one ended)

**Expected outcome:** You understand how `-A` intelligently creates or attaches.

### Exercise 4: SSH + dtach Workflow

1. If you have SSH access to a remote machine, SSH in: `ssh user@remote`
2. Create a dtach session: `dtach -c /tmp/ssh-test bash`
3. Start a long-running command: `ping localhost > /tmp/ping.log &`
4. Detach: `Ctrl+\`
5. Disconnect SSH: `exit`
6. Reconnect: `ssh user@remote`
7. Reattach: `dtach -a /tmp/ssh-test`
8. Verify pings are still running: `tail /tmp/ping.log`

**Expected outcome:** The ping command survived the SSH disconnection.

---

## Troubleshooting

### Problem: "No such file or directory" When Attaching

**Cause:** The socket file doesn't exist — either the session was never created, the program inside exited, or the socket was manually deleted.

**Solution:**

```bash
# Check if the socket exists
ls -la /tmp/my-session

# If it doesn't exist, the session ended. Create a new one:
dtach -c /tmp/my-session bash
```

### Problem: "Address already in use" When Creating

**Cause:** A socket file already exists at that path, either from a running session or a stale leftover.

**Solution:**

```bash
# Try attaching first — maybe it's still running
dtach -a /tmp/my-session

# If that fails, remove the stale socket
rm /tmp/my-session

# Now create a fresh session
dtach -c /tmp/my-session bash
```

Or simply use `-A` to handle this automatically.

### Problem: Detach Key (Ctrl+\) Doesn't Work

**Cause:** Your terminal or shell may intercept `Ctrl+\` (it's the default `SIGQUIT` key).

**Solution:** Use a different detach key with the `-e` flag:

```bash
# Use Ctrl+Q as the detach key
dtach -c /tmp/my-session -e '^Q' bash

# Use Ctrl+Z as the detach key
dtach -c /tmp/my-session -e '^Z' bash
```

### Problem: No Scrollback / Can't See Previous Output

**Cause:** dtach does not provide a scrollback buffer. It only shows what the program outputs while you're attached.

**Solution:** This is by design — dtach is minimal. To get scrollback:

- Redirect output to a log file: `my_command 2>&1 | tee /tmp/output.log`
- Use dtach inside tmux (tmux provides the scrollback)
- Use the `-r` flag when attaching to redraw from the last screen state: `dtach -a /tmp/my-session -r winch`

### Problem: Socket Files Accumulate in /tmp

**Cause:** Programs that crash (rather than exit cleanly) may leave socket files behind.

**Solution:**

```bash
# Find and remove stale dtach sockets
for sock in /tmp/dtach-*; do
    dtach -a "$sock" -e '' 2>/dev/null || rm -f "$sock"
done
```

Or use a custom directory that you clean periodically:

```bash
mkdir -p ~/.dtach
dtach -c ~/.dtach/my-session bash
```

---

## Related Tutorials

- [[mosh-beginner-guide|Mosh Beginner Guide]] — Mosh keeps your connection alive over flaky networks; pair it with dtach for both connection resilience and session persistence
- [[mosh-deep-dive|Mosh Deep Dive]] — Advanced Mosh usage and how it complements dtach for remote work
- [[ssh-tutorial|SSH Tutorial]] — Foundation for remote access; dtach is most useful over SSH connections
- [[ssh-config-deep-dive|SSH Config Deep Dive]] — Configure SSH for smoother remote workflows with dtach
- [[sesh-beginner-guide|Sesh Beginner Guide]] — Session management with tmux; understand when to use a full multiplexer vs. dtach
- [[sesh-deep-dive|Sesh Deep Dive]] — Advanced session management patterns
- [[honeymux-beginner-guide|Honeymux Beginner Guide]] — TUI wrapper for tmux; an alternative approach to session management
- [[openmux-beginner-guide|OpenMux Beginner Guide]] — Modern terminal multiplexer as another option alongside dtach
- [[dotfiles-beginner-guide|Dotfiles Beginner Guide]] — Manage your shell aliases and configurations including dtach helpers
- [[dtach-deep-dive|Dtach Deep Dive]] — Advanced dtach usage, scripting patterns, and integration strategies

---

## Summary

**dtach is the simplest way to protect a terminal program from disconnection.** Here's what you now know:

1. **dtach creates a Unix socket** that keeps your program running independently of your terminal
2. **Four main flags** cover all use cases: `-c` (create+attach), `-n` (create, no attach), `-a` (attach), `-A` (smart create-or-attach)
3. **Detach with `Ctrl+\`** and reattach anytime with `dtach -a <socket>`
4. **dtach + SSH** is a lightweight alternative to tmux for keeping remote jobs alive
5. **dtach is not a replacement for tmux** — it's a complement; use dtach for simple persistence and tmux for rich terminal features
6. **No configuration needed** — dtach works out of the box with zero setup

**Next steps:**

- Install dtach and practice the create/detach/attach cycle
- Set up shell aliases to make dtach usage even faster
- Read [[dtach-deep-dive]] for advanced patterns like scripting, tmux integration, and daemon management
- Explore [[mosh-beginner-guide|Mosh]] for connection resilience to pair with dtach's session persistence
