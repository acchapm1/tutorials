---
title: "Television (tv): A Beginner's Guide to Terminal Fuzzy Finding"
date: 2026-04-10
difficulty: beginner
tags: [television, tv, fuzzy-finder, terminal, cli, rust]
---

# Television (tv): A Beginner's Guide to Terminal Fuzzy Finding

## 1. Overview

**Television** (`tv`) is a blazing-fast, terminal-based fuzzy finder written in Rust. Think of it as a smart search tool that lives in your terminal — it helps you find files, search text, navigate git repositories, browse environment variables, manage Docker containers, and much more, all without leaving your command line.

Unlike traditional `find | grep | xargs` chains that are slow and hard to remember, television gives you real-time interactive search with live previews, multi-select capability, and deep customization. It was built for systems administrators and software developers who spend their days in the terminal and want to work faster.

In this guide you will learn:

- What television is and why it saves time
- How to install and set up television on your system
- Key concepts like "channels" (search sources) and keyboard shortcuts
- Practical workflows for everyday tasks (finding files, searching code, jumping between projects)
- How to write your own custom channels to search any data source

No prior experience with fuzzy finders or terminal tools like `fzf` is assumed. If you are comfortable with basic terminal navigation (`cd`, `ls`, `cat`), you are ready to learn television.

---

## 2. Prerequisites

Before starting, make sure you have:

- **A Linux or macOS system** — television runs on Linux, macOS, and Windows (with WSL).
- **A terminal or shell** — you should be able to open a terminal and type commands. Common shells are Bash, Zsh, and Fish.
- **A package manager** — Homebrew (macOS), apt/dnf (Linux), Cargo (Rust), or your system's native package manager.
- **Basic terminal familiarity** — you know how to navigate with `cd`, list files with `ls`, and edit files with `vim` or `nano`.
- **Administrator/sudo access** — you may need `sudo` to install packages on some systems, though most modern package managers do not require it.

---

## 3. Key Concepts

### Channels

A **channel** is television's term for a search source. Television ships with several built-in channels, and you can add more from the community or write your own. Each channel defines what data to search (the "source"), how to display it (the "preview"), and optionally what actions to take on selection.

Common built-in channels:

| Channel | What it searches |
|---------|-----------------|
| `files` | Files and directories in your filesystem |
| `text` | File contents (code, config files, logs) |
| `git-repos` | Git repositories on your system |
| `env` | Environment variables |
| `docker` | Docker containers and images |

### The Remote Control

While inside television, press **`Ctrl+T`** to open the **remote control** — a menu that lets you switch channels on the fly without restarting television. It is like flipping channels on a TV.

### Preview Pane

Most channels show a live **preview pane** on the right or bottom of your screen. As you navigate the search results, the preview updates in real-time. If you are searching files, the preview shows the file contents. If you are searching Docker containers, the preview shows container details.

### Interactive Filtering

Type any text to filter the results in real-time. Television uses fuzzy matching by default, which means you do not have to type exact strings. For example, typing `cfg` will match `config`, `configure`, and `configuration`.

---

## 4. Step-by-Step Instructions

### Step 1 — Install Television

Choose the method that works best for your system.

**macOS / Linux (Homebrew)**

```bash
brew install television
```

**Rust / Cargo**

If you have Rust installed, you can build from source:

```bash
cargo install --locked television
```

**Arch Linux**

```bash
pacman -S television
```

**Nix**

```bash
nix run nixpkgs#television
```

**Linux (quick install script)**

```bash
curl -fsSL https://alexpasmantier.github.io/television/install.sh | bash
```

**Windows (via Scoop or WinGet)**

```powershell
# Scoop
scoop bucket add extras && scoop install television

# WinGet
winget install --exact --id alexpasmantier.television
```

### Step 2 — Verify Installation

After installing, verify that television is on your PATH:

```bash
tv --version
```

Expected output:

```
television 0.15.4
```

If you see a version number, you are ready to go. If you get "command not found," you may need to add the installation directory to your PATH. Consult the documentation for your package manager.

### Step 3 — Set Up Shell Integration

Shell integration lets you use keyboard shortcuts like `Ctrl+T` (file autocomplete) and `Ctrl+R` (history search) directly in your shell prompt, without typing `tv` explicitly. This is optional but highly recommended — it becomes muscle memory very quickly.

**Zsh:**

```bash
echo 'eval "$(tv init zsh)"' >> ~/.zshrc && source ~/.zshrc
```

**Bash:**

```bash
echo 'eval "$(tv init bash)"' >> ~/.bashrc && source ~/.bashrc
```

**Fish:**

```bash
echo 'tv init fish | source' >> ~/.config/fish/config.fish
```

After running the appropriate command for your shell, restart your terminal or source your shell config file again.

### Step 4 — Try It Out

Start with the simplest channel — the file browser:

```bash
tv
```

Expected behavior:

- Television launches, filling your terminal
- You see a list of files and directories from your current location
- A preview pane shows file contents
- You can type to filter the list
- Arrow keys or `j`/`k` navigate the results
- Pressing `Enter` outputs the selected file path to stdout

Press `Esc` to exit without selecting anything, or select a file and press `Enter`.

### Step 5 — Try Another Channel

Now search file contents instead of just file names:

```bash
tv text
```

Type a search term (e.g., `error` or `import`) and television will find all files containing that text and show you the matching lines.

### Step 6 — Explore Git Repositories

If you have git repositories on your system, jump to one:

```bash
cd $(tv git-repos)
```

Television lists all git repos it can find, you select one, and the `cd` takes you there.

---

## 5. Practical Examples

### Example 1 — Edit a File with Fuzzy Search

Instead of typing a long file path, use television:

```bash
vim $(tv)
```

Television opens the file browser. You type part of the filename, select it, press `Enter`, and `vim` opens that file. Much faster than remembering the full path.

### Example 2 — Search Code for a Function Name

You want to find where a function is defined in your codebase:

```bash
tv text
```

Type the function name (e.g., `processData`), and television shows you every file and line where it appears. Select the one you want and the file path outputs.

### Example 3 — Jump to a Project Directory

Instead of remembering where all your projects live:

```bash
cd $(tv git-repos)
```

Television lists every git repository, you fuzzy-search for the one you want, and `cd` takes you there.

You might create an alias:

```bash
alias proj='cd $(tv git-repos)'
```

Then just type `proj` whenever you want to jump to a project.

### Example 4 — Browse Environment Variables

Audit what environment variables are set:

```bash
tv env
```

Useful for debugging configuration issues, especially in deployment environments where you have many variables set.

### Example 5 — Manage Docker Containers

Open a shell in a running Docker container:

```bash
docker exec -it $(tv docker) /bin/bash
```

Television lists your containers, you select one, and `docker exec` drops you into a shell inside that container.

Or view logs for a container:

```bash
docker logs $(tv docker)
```

### Example 6 — Delete Multiple Files Interactively

Press `Tab` to multi-select files instead of single-selecting:

```bash
tv | xargs rm -i
```

Television opens the file browser, you press `Tab` on each file you want to delete, then `Enter` outputs all selected files, and `xargs rm -i` deletes them with confirmation.

### Example 7 — Pipe Any Command Output

Television works with the output of any command. For example, find and checkout a git branch:

```bash
git branch | tv | xargs git checkout
```

`git branch` outputs your branches, television lets you fuzzy-search and select one, and `git checkout` switches to it.

### Example 8 — Filter Running Processes

Find and kill a process interactively:

```bash
ps aux | tv | awk '{print $2}' | xargs kill
```

Or more targeted:

```bash
ps aux | grep nginx | tv
```

### Example 9 — Select an SSH Host

If you have hosts defined in your SSH config:

```bash
grep "^Host " ~/.ssh/config | awk '{print $2}' | tv | xargs ssh
```

Television shows your SSH hosts, you select one, and you are connected.

### Example 10 — Automate with Script Flags

In scripts where you do not want the interactive UI, television offers flags to control behavior:

```bash
# Auto-select if only one match (non-interactive)
tv files --select-1

# Take the first result immediately (fully automated)
tv files --take-1-fast

# Exact matching (no fuzzy)
tv files --exact

# Skip the preview panel for speed
tv files --no-preview

# Custom source and preview
tv --source 'ls -la /etc' --preview 'cat {0}'
```

---

## 6. Hands-On Exercises

### Exercise 1 — Basic File Navigation

1. Open television with `tv`.
2. Type a partial filename from your home directory (e.g., `.bash` to find `.bashrc`).
3. Verify the preview pane updates as you type.
4. Press `Enter` to output the selected file.
5. Press `Esc` to exit without selecting.

### Exercise 2 — Search File Contents

1. Run `tv text` from a directory with source code or config files.
2. Search for a common word (e.g., `import`, `localhost`, `password`).
3. Verify that television shows files and lines containing that word.
4. Select one result and note the output.

### Exercise 3 — Multi-Select

1. Run `tv` to open the file browser.
2. Navigate to a directory with multiple files.
3. Press `Tab` on at least three files to select them.
4. Press `Enter` and verify all selected files are output (one per line).

### Exercise 4 — Using the Remote Control

1. Run `tv` (start with the `files` channel).
2. Press `Ctrl+T` to open the remote control menu.
3. Select a different channel (e.g., `env` or `docker` if available).
4. Verify that television switches to the new channel.

### Exercise 5 — Pipe Command Output

1. Run `git branch | tv` (if you are in a git repository).
2. Verify that television shows your git branches.
3. Select one and press `Enter` — note the branch name in the output.
4. Try with other commands: `ps aux | tv`, `ls -la /etc | tv`, etc.

### Exercise 6 — Create an Alias

1. Add this line to your shell config (`~/.bashrc`, `~/.zshrc`, or `~/.config/fish/config.fish`):
   ```bash
   alias proj='cd $(tv git-repos)'
   ```
2. Reload your shell config or restart your terminal.
3. Run `proj` and verify it opens the git repo browser.
4. Select a repo and verify you are `cd`'d to it.

---

## 7. Troubleshooting

### "command not found" when running `tv`

**Cause:** Television is not in your PATH.

**Fix:** Check that television installed correctly by running the install command again. If using a non-standard shell or shell configuration, you may need to restart your terminal or explicitly reload your shell config file (e.g., `source ~/.bashrc`).

### Shell integration shortcuts (`Ctrl+T`, `Ctrl+R`) do not work

**Cause:** Shell integration was not set up correctly.

**Fix:** Re-run the setup command for your shell:

```bash
# Zsh
echo 'eval "$(tv init zsh)"' >> ~/.zshrc && source ~/.zshrc

# Bash
echo 'eval "$(tv init bash)"' >> ~/.bashrc && source ~/.bashrc

# Fish
echo 'tv init fish | source' >> ~/.config/fish/config.fish
```

After running, restart your terminal.

### Preview pane shows nothing

**Cause:** The preview command may not be compatible with the data, or the file is binary.

**Fix:** Press `Ctrl+F` to cycle to the next preview command, or press `Ctrl+F` again to disable the preview. This is not a problem — television still works for selection.

### Television is slow or unresponsive

**Cause:** Television may be scanning a very large directory tree (e.g., a monorepo with millions of files, or a mounted network share).

**Fix:**

- Use a more specific source. For example, instead of `tv` from `/`, try `tv files ~/myproject`.
- Use command-line flags to speed things up: `tv --no-preview` or `tv --take-1-fast`.
- Check if your filesystem has indexing enabled (e.g., `locate` or `mlocate` on Linux).

### "Operation not permitted" errors

**Cause:** You do not have permission to read certain files or directories.

**Fix:** This is expected in systems with strict permissions. Television will skip files it cannot read and continue with the ones you can access. If you need to search everywhere, use `sudo tv`, but be cautious — this runs television as root.

### Selected file path looks wrong or is truncated

**Cause:** Television outputs to stdout, and the output might be wrapped in your terminal or shell.

**Fix:** This is usually fine. When you pipe the output to another command (e.g., `vim $(tv)`), the shell handles the parsing correctly.

---

## 8. References

- [Official Television Site](https://alexpasmantier.github.io/television/)
- [GitHub Repository](https://github.com/alexpasmantier/television)
- [Community Channels Wiki](https://github.com/alexpasmantier/television/wiki/Cable-channels)
- [Neovim Plugin](https://github.com/alexpasmantier/tv.nvim)
- [Latest Releases](https://github.com/alexpasmantier/television/releases)

---

## 9. Related Tutorials

- [[git-worktrees-worktrunk-beginner-guide|Git Worktrees]] — Learn how to manage multiple git branches efficiently
- [[linux-permissions-beginner-guide|Linux Permissions]] — Understand file permissions for secure system administration

---

## Summary

**Key takeaways:**

- **Television** is a fuzzy finder that lets you search files, code, git repos, environment variables, Docker containers, and more from the terminal.
- **Install** with your system's package manager (Homebrew, apt, cargo, etc.).
- **Channels** are search sources (files, text, git-repos, env, docker). Use `Ctrl+T` (remote control) to switch channels on the fly.
- **Preview pane** shows live updates as you type and navigate.
- **Fuzzy matching** means you do not have to type exact strings — `cfg` finds `config`.
- **Pipe command output** into television with `command | tv` to turn any output into an interactive selector.
- **Multi-select** with `Tab`, then press `Enter` to output all selections.
- **Shell integration** (`tv init bash/zsh/fish`) unlocks `Ctrl+T` and `Ctrl+R` shortcuts in your shell prompt.

**Next steps:**

- Explore the built-in channels with `tv list-channels`.
- Set up shell integration for faster workflows.
- Write a custom channel for data you search often (see the deep dive guide).
- Use television in your scripts and aliases to automate common tasks.
- Check the official documentation and community channels as your skills grow.

Television transforms terminal work from repetitive command-line typing into fast, visual, interactive searching. It takes a few minutes to learn but pays dividends in every terminal session.
# Related Tutorials

- [[git-worktrees-worktrunk-beginner-guide|Git Worktrees]] — Learn how to manage multiple git branches efficiently
- [[linux-permissions-beginner-guide|Linux Permissions]] — Understand file permissions for secure system administration
- [[sesh-beginner-guide|Sesh Beginner Guide]] — Use television's sesh channel to manage tmux sessions
- [[sesh-deep-dive|Sesh Deep Dive]] — Advanced sesh configuration and television integration
- [[dotfiles-beginner-guide|Dotfiles Beginner Guide]] — Manage your television config and other dotfiles across machines
- [[dotfiles-deep-dive|Dotfiles Deep Dive]] — Advanced cross-platform dotfile management

- [[pet-beginner-guide|Pet Beginner Guide]] — CLI snippet manager that uses fzf/peco as its interactive selector
- [[pet-deep-dive|Pet Deep Dive]] — advanced Pet configuration, parameters, and sync patterns
