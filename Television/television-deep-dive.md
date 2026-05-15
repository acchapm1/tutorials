---
title: "Television (tv): Deep Dive Reference"
date: 2026-04-10
difficulty: advanced
tags: [television, tv, fuzzy-finder, terminal, cli, rust, channels, custom, scripting, docker, configuration]
---

# Television (tv): Deep Dive Reference

## 1. Overview

Television (`tv`) is a high-performance, terminal-based fuzzy finder written in Rust. While its intuitive interface makes it accessible to beginners, television's true power lies in its flexibility: custom channels, advanced configuration, deep shell integration, automation in scripts, and sophisticated Docker workflows.

This reference covers television's complete feature set: how channels work under the hood, how to write custom TOML channel definitions, advanced shell integration techniques, keyboard customization, theme configuration, performance tuning, Docker channel usage patterns, and best practices for integrating television into your development and operations workflows.

This guide assumes you are familiar with basic television concepts (channels, preview panes, fuzzy matching). For a gentler introduction, see the [Television Beginner's Guide](./television-beginner-guide.md).

---

## 2. Prerequisites

Before diving deep, you should have:

- **Television installed** — see the beginner guide for installation steps.
- **Shell integration set up** — familiarity with your shell (Bash, Zsh, Fish) and ability to edit shell config files.
- **A development environment** — source code repositories, git repositories, Docker, or similar tools you want to integrate with television.
- **Comfort with TOML syntax** — custom channels are defined in TOML format. Basic knowledge of key-value formats is helpful.
- **Understanding of shell scripting** — custom channels may reference bash/sh commands; familiarity with pipes, variables, and command substitution is useful.
- **Access to config directories** — you will edit `~/.config/television/config.toml` and create files in `~/.config/television/cable/`.

---

## 3. Key Concepts

### 3.1 Channel Architecture

A **channel** in television consists of three core components:

1. **Source** — A command that generates the list of items to search. Example: `find . -type f` for files.
2. **Preview** — A command that shows details about a selected item. Example: `cat {0}` to show file contents (where `{0}` is the selected item).
3. **Metadata** — Name, description, and UI hints (orientation, preview mode).

Television uses `ripgrep` for the `text` channel's heavy lifting, bash subshells for source and preview command execution, and real-time filtering with fuzzy matching.

### 3.2 Configuration File Structure

Television reads configuration from:

```
~/.config/television/config.toml          # Global settings
~/.config/television/cable/                # Directory for custom channels
```

The global config controls UI behavior, themes, performance, and default channels. Each custom channel is a separate TOML file in the `cable` directory.

### 3.3 Source Command Behavior

A source command runs once when television starts (or when you switch to that channel) and outputs a newline-separated list of items. Television pipes each line through the fuzzy matcher.

Examples:

```bash
# Files: find returns one file per line
find . -type f

# Environment variables: env outputs KEY=VALUE
env

# Git branches: git branch outputs one per line
git branch -a

# Docker containers: docker ps outputs one per line
docker ps --quiet
```

### 3.4 Preview Command with Placeholders

Preview commands can reference the selected item using placeholders:

- `{0}` — The entire selected line
- `{1}`, `{2}`, etc. — Specific fields if the source uses a delimiter
- `{cmd}` — The full source command (less common)

Examples:

```bash
# Show file contents
cat {0}

# Show first 20 lines of a file
head -20 {0}

# Extract a field (field 2 in docker ps output)
docker inspect {0}

# SSH config details
grep -A 10 "Host {0}" ~/.ssh/config
```

### 3.5 Channel Actions and Keybindings

Advanced channels can define multiple actions beyond just selecting and outputting. For example:

```toml
[actions.view]
command = "cat {0}"
mode = "preview"

[actions.edit]
command = "vim {0}"
mode = "execute"

[keybindings]
enter = "view"
ctrl_e = "edit"
```

This allows different keys to do different things with the same selection.

### 3.6 Shell Integration and Environment

Television respects your shell and environment. When you use shell integration (`tv init bash`), television hooks into your shell's prompt expansion. The `Ctrl+R` (history) channel uses your shell history file. Custom channels run with access to your environment variables, PATH, aliases, and functions.

---

## 4. Step-by-Step Instructions

### 4.1 Understanding the Global Configuration File

Create or view your global config:

```bash
cat ~/.config/television/config.toml
```

If the file does not exist, television uses built-in defaults. To customize, create the file:

```bash
mkdir -p ~/.config/television
touch ~/.config/television/config.toml
```

Common configuration options:

```toml
# General behavior
tick_rate = 50                           # UI refresh rate in milliseconds (lower = faster but uses more CPU)
default_channel = "files"                # Channel to open when you run bare `tv`
search_history_max_entries = 100         # How many past searches to remember
max_preview_lines = 100                  # Limit preview pane lines for speed
debounce_delay = 100                     # Delay before filtering starts (ms)

# UI appearance and layout
scale = 85                               # % of terminal to use (0-100)
orientation = "landscape"                # or "portrait" — affects how panes are arranged
theme = "default"                        # Built-in theme (default, dark, light, monokai, etc.)

# Shell behavior
shell = "/bin/bash"                      # Shell for running source/preview commands
max_history_suggestions = 20             # For Ctrl+R history search

# Performance
max_file_size = 10485760                 # Max file size to preview (10MB)
index_hidden_files = true                # Include .files in the files channel
```

### 4.2 Creating a Custom Channel (Basic)

Create a file `~/.config/television/cable/my-channel.toml`:

```toml
[metadata]
name = "my-channel"
description = "My first custom channel"

[source]
command = "ls -la /var/log"

[preview]
command = "cat {0}"
```

Run it with:

```bash
tv my-channel
```

Television executes the source command (`ls -la /var/log`), displays the output, and when you select an item, shows its preview (file contents via `cat`).

### 4.3 Creating a Custom Channel (Advanced)

Here is a more sophisticated channel with multiple actions and keybindings:

Create `~/.config/television/cable/logs.toml`:

```toml
[metadata]
name = "logs"
description = "Search system logs with actions"

[source]
command = "find /var/log -type f -name '*.log' 2>/dev/null"

[preview]
command = "tail -n 50 {0}"

[ui]
orientation = "landscape"
preview_position = "right"
preview_scale = 40                    # 40% of screen for preview

[actions.tail]
description = "Tail the log (default)"
command = "tail -f {0}"
mode = "execute"

[actions.grep]
description = "Search for a pattern in the log"
command = "fzf --preview 'grep {{q}} {0}' < {0}"
mode = "execute"

[keybindings]
enter = "tail"
ctrl_g = "grep"
```

### 4.4 Advanced Source Commands

Sources can be arbitrarily complex. They run in your shell, so you can use pipes, variable expansion, and subshells.

**Example: Git commit search**

```toml
[metadata]
name = "git-commits"
description = "Search git commits by message"

[source]
command = "git log --oneline --all -n 500"

[preview]
command = "git show --stat {0} | head -30"
```

**Example: Docker containers with status filtering**

```toml
[metadata]
name = "docker-running"
description = "Select running Docker containers only"

[source]
command = "docker ps --format 'table {{.ID}}\t{{.Names}}\t{{.Status}}'"

[preview]
command = "docker inspect {0} | head -50"
```

**Example: Kubernetes resources (if you have kubectl)**

```toml
[metadata]
name = "k8s-pods"
description = "Search Kubernetes pods in current context"

[source]
command = "kubectl get pods -A -o wide --no-headers | awk '{print $1 \"/\" $2}'"

[preview]
command = "kubectl describe pod {0} | head -40"
```

### 4.5 Field Extraction with Delimiters

If your source output has multiple columns, you can extract specific fields. Television looks for a `delimiter` option in the source section:

```toml
[metadata]
name = "docker-inspect"
description = "Inspect containers with field extraction"

[source]
command = "docker ps --format '{{.ID}}\t{{.Names}}\t{{.Status}}'"
delimiter = "\t"                       # Fields are tab-separated

[preview]
command = "docker inspect {1}"         # Use second field (Names) for inspect
```

When you search, television extracts each field separately, allowing you to fuzzy-search on any column. The entire line is still available as `{0}`.

### 4.6 Theming and Appearance

List available built-in themes:

```bash
tv --list-themes
```

Apply a theme in your config:

```toml
theme = "monokai"
```

You can also define custom themes in TOML (see the official documentation for the color scheme format).

### 4.7 Shell Integration Customization

Television's shell integration is not limited to the defaults. You can customize bindings in your shell:

**Bash/Zsh — Custom Ctrl+Shift+T for text search:**

```bash
# Add to ~/.bashrc or ~/.zshrc after running `tv init bash/zsh`
__tv_text_search() {
    tv text
}
bind -x '"\C-\M-t": __tv_text_search'  # Bash
bindkey '^[t' '__tv_text_search'        # Zsh (different syntax)
```

**Fish — Custom keybinding:**

```fish
# Add to ~/.config/fish/config.fish after running `tv init fish`
function tv_git_repos
    cd (tv git-repos)
end
bind \cg tv_git_repos
```

### 4.8 Performance Tuning

For large datasets or slow systems:

```toml
# Reduce UI refresh rate (saves CPU)
tick_rate = 20

# Disable preview pane by default
preview_enabled = false

# Increase debounce delay (wait longer before filtering)
debounce_delay = 300

# Limit preview content
max_preview_lines = 30

# Reduce history size
search_history_max_entries = 50
```

Or use command-line flags:

```bash
tv --no-preview           # Disable preview for this session
tv --take-1-fast          # Immediately return first match (no UI)
tv files --select-1       # Single match auto-selects
```

### 4.9 Docker Channel Integration

Television ships with a built-in `docker` channel. To use it effectively:

```bash
tv docker
```

This lists containers and images. You can extend it with a custom channel for Docker-specific workflows:

```toml
[metadata]
name = "docker-logs"
description = "View logs for running containers"

[source]
command = "docker ps --format '{{.Names}}'"

[preview]
command = "docker logs --tail=30 {0}"

[actions.tail]
description = "Tail logs in real-time"
command = "docker logs -f {0}"
mode = "execute"

[keybindings]
enter = "tail"
```

Or Podman if you prefer:

```toml
[metadata]
name = "podman-containers"
description = "Search Podman containers"

[source]
command = "podman ps -a --format '{{.Names}}'"

[preview]
command = "podman inspect {0}"
```

### 4.10 Scripting with Television

Use television in scripts with non-interactive flags:

```bash
#!/bin/bash

# Auto-select if only one match
file=$(tv files --select-1)

# Take first match without UI
first_file=$(tv files --take-1-fast)

# Exact matching (no fuzzy)
exact_match=$(tv files --exact)

# Skip preview for speed
fast_search=$(tv files --no-preview)

# Custom source inline
selected=$(tv --source 'find . -type f' --preview 'head -5 {0}')

# Combine with error handling
if file=$(tv files --select-1); then
    vim "$file"
else
    echo "No file selected"
    exit 1
fi
```

In scripts, television returns the selected item to stdout, exit code 0 on success, and non-zero on cancellation (Esc).

---

## 5. Practical Examples

### Example 1 — SSH Host Manager Channel

Create `~/.config/television/cable/ssh-hosts.toml`:

```toml
[metadata]
name = "ssh-hosts"
description = "Connect to SSH hosts from config"

[source]
command = "grep -E '^Host [^*]' ~/.ssh/config | awk '{print $2}'"

[preview]
command = "grep -A 5 \"Host {0}\" ~/.ssh/config"

[actions.connect]
description = "SSH into host"
command = "ssh {0}"
mode = "execute"

[actions.scp]
description = "Copy file from host"
command = "echo 'scp user@{0}:/path/to/file .'"
mode = "preview"

[keybindings]
enter = "connect"
ctrl_c = "scp"
```

Usage:

```bash
tv ssh-hosts
# Select a host, press Enter to SSH, or Ctrl+C for SCP instructions
```

### Example 2 — Git Workflow Channel

Create `~/.config/television/cable/git-workflow.toml`:

```toml
[metadata]
name = "git-workflow"
description = "Interactive git operations"

[source]
command = "git branch -a --format='%(refname:short)'"

[preview]
command = "git log -1 --format='%H%n%an%n%ai%n%B' {0} 2>/dev/null || echo 'Branch: {0}'"

[actions.checkout]
description = "Checkout branch"
command = "git checkout {0}"
mode = "execute"

[actions.delete]
description = "Delete branch (with confirmation)"
command = "git branch -D {0}"
mode = "execute"

[actions.log]
description = "Show branch log"
command = "git log --oneline {0} -n 20"
mode = "execute"

[keybindings]
enter = "checkout"
ctrl_d = "delete"
ctrl_l = "log"
```

Usage:

```bash
tv git-workflow
# Choose branch, press Enter to checkout, Ctrl+D to delete, Ctrl+L to view log
```

### Example 3 — Process Monitor Channel

Create `~/.config/television/cable/proc-monitor.toml`:

```toml
[metadata]
name = "proc-monitor"
description = "Search and manage running processes"

[source]
command = "ps aux | tail -n +2"

[preview]
command = "ps -p {0} -o pid,ppid,user,vsz,rss,comm,args && echo '---' && ps --ppid {0} 2>/dev/null"

[ui]
orientation = "portrait"

[actions.kill]
description = "Kill process"
command = "kill {0}"
mode = "execute"

[actions.strace]
description = "Trace system calls"
command = "sudo strace -p {0} 2>&1 | head -50"
mode = "execute"

[keybindings]
enter = "kill"
ctrl_t = "strace"
```

Usage:

```bash
ps aux | tv proc-monitor
# Select process, press Enter to kill, Ctrl+T to strace
```

### Example 4 — Docker Compose Service Channel

Create `~/.config/television/cable/docker-compose.toml`:

```toml
[metadata]
name = "docker-compose"
description = "Manage docker-compose services"

[source]
command = "docker-compose ps --services"

[preview]
command = "docker-compose logs --no-log-prefix --tail=20 {0}"

[actions.logs]
description = "Tail logs"
command = "docker-compose logs -f {0}"
mode = "execute"

[actions.shell]
description = "Open shell in service"
command = "docker-compose exec {0} /bin/bash"
mode = "execute"

[keybindings]
enter = "logs"
ctrl_s = "shell"
```

Usage:

```bash
cd /path/to/docker-compose.yml
tv docker-compose
# Select service, press Enter for logs or Ctrl+S for shell
```

### Example 5 — Configuration File Editor Channel

Create `~/.config/television/cable/config-files.toml`:

```toml
[metadata]
name = "config-files"
description = "Edit system and application configs"

[source]
command = "find ~/.config /etc -maxdepth 2 -name '*.conf' -o -name '*.toml' -o -name '*.yaml' 2>/dev/null | sort"

[preview]
command = "head -30 {0}"

[actions.edit]
description = "Edit with vim"
command = "vim {0}"
mode = "execute"

[actions.view]
description = "View with less"
command = "less {0}"
mode = "execute"

[keybindings]
enter = "edit"
ctrl_v = "view"
```

Usage:

```bash
tv config-files
# Fuzzy-search config files, press Enter to edit or Ctrl+V to view
```

### Example 6 — Integration with Neovim

If you use Neovim, television integrates via the `tv.nvim` plugin. Create a custom channel for Neovim:

```toml
[metadata]
name = "nvim-buffers"
description = "Neovim open buffers"

[source]
command = "nvim --version >/dev/null 2>&1 && echo 'Requires nvim server' || true"
```

For deeper Neovim integration, consult the `tv.nvim` plugin documentation.

### Example 7 — Database Query Channel

Create `~/.config/television/cable/db-query.toml`:

```toml
[metadata]
name = "db-tables"
description = "Search database tables"

[source]
# Example for PostgreSQL (requires psql configured)
command = "psql -h localhost -U postgres -d mydb -c '\\dt' -t | awk '{print $2}'"

[preview]
command = "psql -h localhost -U postgres -d mydb -c '\\d {0}'"

[actions.describe]
description = "Describe table structure"
command = "psql -h localhost -U postgres -d mydb -c '\\d {0}'"
mode = "execute"
```

### Example 8 — Combining Multiple Data Sources

Create a channel that merges multiple sources:

```toml
[metadata]
name = "all-binaries"
description = "Search all executables in PATH"

[source]
# Find all executable files in your PATH
command = "for p in $(echo $PATH | tr ':' '\n'); do [ -d \"$p\" ] && ls \"$p\" 2>/dev/null; done | sort -u"

[preview]
command = "file $(which {0})"
```

---

## 6. Hands-On Exercises

### Exercise 1 — Write Your First Custom Channel

1. Create `~/.config/television/cable/quick-edit.toml` with a source that lists frequently edited files in your home directory.
2. Set the preview to show the first 20 lines of the file.
3. Add an action to open the file with your editor.
4. Run `tv quick-edit` and verify it works.

### Exercise 2 — Extend the Docker Channel

1. Create a custom channel called `docker-advanced.toml`.
2. Use `docker ps --format` to create a source that outputs custom columns.
3. Add actions for `logs`, `shell`, `inspect`, and `restart`.
4. Bind different keys to each action.
5. Test each action.

### Exercise 3 — Performance Comparison

1. Run `tv` (file channel) and note the responsiveness.
2. Update your `~/.config/television/config.toml` with:
   - `tick_rate = 10` (slower)
   - `debounce_delay = 500`
   - `preview_enabled = false`
3. Run `tv` again and compare responsiveness.
4. Restore the defaults and verify performance returns to normal.

### Exercise 4 — Shell Integration Custom Keybinding

1. Create a custom shell function that combines television with another tool.
   - Example: `function tv_grep { grep -r $(tv) . }` — select a pattern from files and grep for it.
2. Bind a key to the function (depends on your shell).
3. Test the function with real data.

### Exercise 5 — Scripting with Television

1. Create a bash script that uses `tv files --take-1-fast` to pick a file and then process it.
2. Add error handling for when the user presses Esc (exits with non-zero).
3. Test the script multiple times and verify error handling.

### Exercise 6 — Multi-Channel Workflow

1. Create at least three custom channels relevant to your work (e.g., `logs`, `config-files`, `source-code`).
2. Set up keyboard shortcuts or aliases to quickly switch between them.
3. Use the remote control (`Ctrl+T`) to verify you can switch between all channels.

---

## 7. Troubleshooting

### Custom channel not appearing in the list

**Cause:** The TOML file has syntax errors.

**Fix:** Validate your TOML syntax. Run `tv list-channels` to see which channels loaded. Check that the file is in `~/.config/television/cable/` with a `.toml` extension.

### Source command executes but returns no results

**Cause:** The command returns no output, or the output format differs from expectations.

**Fix:** Test the source command directly in your shell:

```bash
# For a channel named 'my-channel', check its source
bash -c 'ls -la /var/log'
```

If the command works in your shell but not in television, check that the shell television uses (in config.toml) is the same as your login shell.

### Preview pane shows incorrect data

**Cause:** The placeholder `{0}` is not matching the selected item, or the preview command is malformed.

**Fix:** Test the preview command manually:

```bash
# Select an item and test the preview command
selected_item="somefile.txt"
cat "$selected_item"  # Test if this works
```

If using field extraction, verify the delimiter is correct and the field index matches.

### Channel runs slowly on large datasets

**Cause:** The source command is slow, or television is refreshing too frequently.

**Fix:**

- Optimize the source command. Use `find` with `-maxdepth` to limit directory depth, or pre-filter results.
- Increase `debounce_delay` in the config to wait longer before filtering.
- Disable the preview pane for this channel: `preview_enabled = false`.
- Use `max_preview_lines` to limit preview content.

### Shell integration not working after adding a custom channel

**Cause:** Shell integration was already initialized before you added the channel.

**Fix:** Channels added via files are automatically discovered. If a built-in channel is masked by your custom channel name, remove the conflict.

### Action command executes but does not show output

**Cause:** The action mode is set to `preview` instead of `execute`.

**Fix:** Change the action mode to `execute`:

```toml
[actions.myaction]
command = "echo {0}"
mode = "execute"  # Not "preview"
```

### Television hangs when running a preview command

**Cause:** The preview command is slow, waiting for input, or hanging indefinitely.

**Fix:** Add a timeout to the preview command or use a simpler preview:

```bash
# Before (may hang)
grep -r {0} .

# After (with timeout)
timeout 5 grep -r {0} . 2>/dev/null || echo "Search timed out"
```

---

## 8. References

- [Official Television Documentation](https://alexpasmantier.github.io/television/)
- [GitHub Repository](https://github.com/alexpasmantier/television)
- [TOML Specification](https://toml.io/) — For custom channel syntax
- [Community Channels](https://github.com/alexpasmantier/television/wiki/Cable-channels)
- [Neovim Plugin](https://github.com/alexpasmantier/tv.nvim)
- [Ripgrep Documentation](https://github.com/BurntSushi/ripgrep) — Used by the text channel
- [Shell Parameter Expansion Guide](https://pubs.opengroup.org/onlinepubs/9699919799/utilities/V3_chap02.html)

---

## 9. Related Tutorials

- [[git-worktrees-worktrunk-beginner-guide|Git Worktrees]] — Learn advanced git workflows that pair well with custom television channels
- [[linux-permissions-beginner-guide|Linux Permissions]] — Essential knowledge for auditing and managing system files and channels

---

## Summary

**Key takeaways:**

- **Channels** are composable search sources with source commands, preview commands, and actions.
- **Global configuration** in `~/.config/television/config.toml` controls UI, performance, and defaults.
- **Custom channels** live in `~/.config/television/cable/` as TOML files and can integrate any tool or data source.
- **Source commands** run in your shell with full access to environment variables, pipes, and command substitution.
- **Preview commands** use placeholders like `{0}` for the selected item and `{1}`, `{2}` for field extraction.
- **Actions** allow multiple keybindings for different behaviors (view, edit, execute, etc.).
- **Shell integration** customization extends television beyond defaults.
- **Docker channels** enable container-centric workflows.
- **Scripting flags** (`--take-1-fast`, `--select-1`, `--no-preview`) automate television in non-interactive contexts.
- **Performance tuning** balances responsiveness and CPU usage.

**Advanced workflows:**

- Create domain-specific channels for your infrastructure (databases, APIs, services).
- Combine television with shell functions and aliases for custom shortcuts.
- Layer channels in scripts to build complex, composable search interfaces.
- Use custom channels to replace repetitive command-line operations with interactive selection.
- Integrate with your editor (Neovim, vim) for seamless file and buffer navigation.

Television's flexibility transforms it from a file finder into a platform for building terminal user interfaces around any data source. Whether you are managing infrastructure, navigating a massive codebase, or automating operations, custom channels unlock unprecedented productivity.

**Next steps:**

- Build custom channels for your most common workflows.
- Share channels with your team via dotfiles or configuration management.
- Explore the community channel library for tools you use daily.
- Contribute useful channels back to the community.
- Integrate television into your scripts and automation systems.
# Related Tutorials

- [[git-worktrees-worktrunk-beginner-guide|Git Worktrees]] — Learn advanced git workflows that pair well with custom television channels
- [[linux-permissions-beginner-guide|Linux Permissions]] — Essential knowledge for auditing and managing system files and channels
- [[sesh-beginner-guide|Sesh Beginner Guide]] — Television has a built-in sesh channel for tmux session management
- [[sesh-deep-dive|Sesh Deep Dive]] — Advanced sesh workflows including television integration
- [[dotfiles-beginner-guide|Dotfiles Beginner Guide]] — Share television channels and configs across machines via dotfiles
- [[dotfiles-deep-dive|Dotfiles Deep Dive]] — Advanced dotfile management for your terminal tool configurations

- [[pet-beginner-guide|Pet Beginner Guide]] — CLI snippet manager that uses fzf/peco for interactive search, similar fuzzy-finder pattern
- [[pet-deep-dive|Pet Deep Dive]] — advanced snippet management with selector customization
