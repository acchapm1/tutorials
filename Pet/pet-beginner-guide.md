---
title: "Pet: A Beginner's Guide to CLI Snippet Management"
date: 2026-05-15
difficulty: beginner
tags: [pet, snippet-manager, cli, shell, productivity, go]
---

# Pet: A Beginner's Guide to CLI Snippet Management

## 1. Overview

**Pet** is a simple command-line snippet manager written in Go. It solves a universal developer problem: you encounter a useful command, use it once or twice, and then forget it entirely. Shell history helps, but scrolling through thousands of entries for that one `openssl` invocation you ran six months ago is painful.

Pet lets you save commands with descriptions and tags, search them interactively with a fuzzy finder, and execute them directly — all from your terminal. You can also use variables (parameters) in your snippets so a single saved template works across different situations.

**What you will learn in this guide:**

- How to install Pet and its required fuzzy finder dependency
- How to create, search, edit, and execute snippets
- How to use parameters (variables) in your snippets
- How to tag and organize your snippet collection
- How to integrate Pet into your shell for quick access
- How to sync your snippets across machines using GitHub Gist or GitLab Snippets

No prior experience with snippet managers is required. If you are comfortable typing commands in a terminal, you have everything you need to get started.

---

## 2. Prerequisites

Before installing Pet, make sure you have:

- **A terminal** — Terminal.app on macOS, any terminal emulator on Linux, or WSL on Windows
- **A shell** — Bash, Zsh, or Fish (Pet supports all three)
- **Homebrew** (recommended on macOS) — or access to download binary releases
- **A text editor** — Pet uses your system editor (set via `$EDITOR`). Vim, nano, or VS Code all work.

You will also need a **fuzzy finder** — Pet requires either [fzf](https://github.com/junegunn/fzf) or [peco](https://github.com/peco/peco) to provide its interactive search interface. If you have used [[television-beginner-guide|Television (tv)]], fzf works on the same principle — type partial text and the list narrows in real time.

---

## 3. Key Concepts

Before diving in, here are the core ideas behind Pet:

**Snippet** — A saved command paired with a description. Snippets live in a TOML file on your filesystem. Each snippet can optionally include tags and recorded output.

**Parameter** — A placeholder in a snippet written as `<name>` or `<name=default_value>`. When you execute a snippet, Pet prompts you to fill in each parameter. This turns a specific command into a reusable template.

**Selector** — The interactive fuzzy finder (fzf or peco) that Pet uses for searching and selecting snippets. You type partial text, and the list filters in real time.

**Sync** — Pet can upload and download your snippet file to GitHub Gist or GitLab Snippets, keeping your collection consistent across multiple machines.

**Tags** — Space-delimited labels you attach to snippets for faster filtering. For example, tagging networking commands with `network` lets you search only that subset.

**TOML file** — Pet stores all snippets in a single TOML configuration file (by default at `~/.config/pet/snippet.toml`). You can edit this file directly with any text editor.

---

## 4. Step-by-Step Instructions

### Step 1 — Install a fuzzy finder

Pet needs fzf or peco to work. fzf is recommended:

```bash
# macOS
brew install fzf

# Ubuntu/Debian
sudo apt install fzf

# Arch Linux
sudo pacman -S fzf
```

Verify the install:

```bash
fzf --version
# Expected output (version may vary):
# 0.54.0 (brew)
```

### Step 2 — Install Pet

**macOS (Homebrew):**

```bash
brew install pet
```

**Linux (Debian/Ubuntu) — download the `.deb` from GitHub releases:**

```bash
# Check https://github.com/knqyf263/pet/releases for the latest version
wget https://github.com/knqyf263/pet/releases/download/v1.0.1/pet_1.0.1_linux_amd64.deb
sudo dpkg -i pet_1.0.1_linux_amd64.deb
```

**Any platform — download the binary directly:**

Go to the [releases page](https://github.com/knqyf263/pet/releases), download the zip for your OS and architecture, extract it, and place the `pet` binary somewhere in your `$PATH` (like `/usr/local/bin/`).

Verify the install:

```bash
pet version
# Expected output:
# pet version 1.0.1
```

### Step 3 — Create your first snippet

Run `pet new` and follow the prompts:

```bash
pet new
# Prompt: Command> find . -name "*.log" -mtime +30 -delete
# Prompt: Description> Delete log files older than 30 days
```

Pet saves this command and description to your snippet file.

### Step 4 — Search and view your snippets

Search interactively with the fuzzy finder:

```bash
pet search
```

This opens fzf with all your snippets listed. Type part of the description or command to filter. Press `Enter` to select a snippet — Pet prints the command to stdout.

To see all snippets without the interactive selector:

```bash
pet list
```

Expected output:

```
    Command: find . -name "*.log" -mtime +30 -delete
Description: Delete log files older than 30 days
------------------------------
```

### Step 5 — Execute a snippet directly

Instead of copying a command and pasting it, run it directly:

```bash
pet exec
```

This opens the fuzzy finder. Select a snippet and Pet executes it immediately.

### Step 6 — Edit your snippet file

Open the raw TOML snippet file in your editor:

```bash
pet edit
```

This is useful for bulk edits, fixing typos, or reorganizing snippets. The file format looks like this:

```toml
[[snippets]]
  description = "Delete log files older than 30 days"
  command = "find . -name \"*.log\" -mtime +30 -delete"
  tag = []
  output = ""
```

### Step 7 — Configure Pet

Open the configuration file:

```bash
pet configure
```

Key settings to review:

```toml
[General]
  snippetfile = "/path/to/snippet.toml"  # where snippets are stored
  editor = "vim"                          # your preferred editor
  selectcmd = "fzf"                       # fzf or peco
  sortby = "description"                  # how snippets are sorted
```

If you manage your [[dotfiles-beginner-guide|dotfiles]] with a tool like chezmoi or a bare Git repo, consider including Pet's config and snippet files in your dotfiles.

---

## 5. Practical Examples

### Example 1 — Save a complex command you always forget

```bash
pet new
# Command> echo | openssl s_client -connect <host>:443 2>/dev/null | openssl x509 -dates -noout
# Description> Check SSL certificate expiration date
```

The `<host>` placeholder becomes a parameter. When you run `pet exec` and select this snippet, Pet prompts you to fill in the hostname.

### Example 2 — Create a snippet with a default parameter value

```bash
pet new
# Command> ssh <user=admin>@<host> -p <port=22>
# Description> SSH into a remote server
```

When executed, Pet pre-fills `admin` for user and `22` for port, but lets you change them. This pairs well with your [[ssh-tutorial|SSH configuration]] for hosts you connect to occasionally.

### Example 3 — Create a snippet with multiple default values

```bash
pet new
# Command> kubectl get pods -n <namespace=|_default_||_kube-system_||_monitoring_|>
# Description> List Kubernetes pods in a namespace
```

Pet presents a selection of the three namespace options when you execute this snippet.

### Example 4 — Tag a snippet for filtered searching

```bash
pet new -t
# Command> docker system prune -af --volumes
# Description> Remove all unused Docker resources
# Tag> docker cleanup
```

Later, search only Docker-related snippets:

```bash
pet exec -t docker
```

### Example 5 — Register the previous command automatically

Add this function to your `.zshrc`:

```zsh
function prev() {
  PREV=$(fc -lrn | head -n 1)
  sh -c "pet new `printf %q "$PREV"`"
}
```

Now after running a useful command, just type `prev` to save it immediately.

### Example 6 — Copy a snippet to clipboard

```bash
pet search | pbcopy  # macOS
pet search | xclip   # Linux
```

Or use the built-in clip command:

```bash
pet clip
```

---

## 6. Hands-On Exercises

### Exercise 1 — Build a starter collection

Create at least five snippets from commands you use regularly but can never remember exactly. Good candidates include:

- A `find` command with specific flags
- A `git` command with unusual options (such as `git log --oneline --graph --all`)
- A `curl` command for an API you use
- A `tar` command (because nobody remembers tar flags)
- A system monitoring command (`du -sh * | sort -rh | head -10`)

**Success criteria:** `pet list` shows all five snippets with clear descriptions.

### Exercise 2 — Use parameters

Create a snippet that uses at least two parameters with default values. For example:

```
rsync -avz --progress <source> <user=deploy>@<host>:<dest=/var/www/>
```

Execute it with `pet exec` and verify that Pet prompts you for each parameter.

**Success criteria:** The snippet executes correctly after you fill in the parameter prompts.

### Exercise 3 — Set up shell integration

Add the `pet-select` function to your shell configuration so you can search snippets with a keyboard shortcut (Ctrl+S for Zsh, Ctrl+X Ctrl+R for Bash):

**Zsh:**

```zsh
function pet-select() {
  BUFFER=$(pet search --query "$LBUFFER")
  CURSOR=$#BUFFER
  zle redisplay
}
zle -N pet-select
stty -ixon
bindkey '^s' pet-select
```

**Bash:**

```bash
function pet-select() {
  BUFFER=$(pet search --query "$READLINE_LINE")
  READLINE_LINE=$BUFFER
  READLINE_POINT=${#BUFFER}
}
bind -x '"\C-x\C-r": pet-select'
```

Reload your shell and test the keyboard shortcut.

**Success criteria:** Pressing the key binding opens Pet's fuzzy search inline, and selecting a snippet inserts the command at your prompt.

### Exercise 4 — Sync to Gist

1. Create a GitHub personal access token with `gist` scope at <https://github.com/settings/tokens/new>.
2. Run `pet configure` and add the token to `[Gist] access_token`.
3. Run `pet sync` to upload your snippets.
4. Check your GitHub Gists to verify the upload.

**Success criteria:** Your snippets appear as a Gist on GitHub, and `pet sync` reports "Upload success." See [[gh-cli-beginner-guide|GitHub CLI Beginner Guide]] for more on working with GitHub from the terminal.

---

## 7. Troubleshooting

**Problem: `pet search` shows "command not found: fzf"**
Pet requires a fuzzy finder. Install fzf with `brew install fzf` (macOS) or your package manager. Then run `pet configure` and verify `selectcmd = "fzf"`.

**Problem: Snippets are not showing up after `pet new`**
Check which snippet file Pet is using: `pet configure` and look at the `snippetfile` path. Open that file to verify your snippet was saved. If you have `snippetdirs` set, new snippets go to a time-stamped file in the first directory.

**Problem: `pet exec` runs the wrong shell**
By default, Pet executes snippets with `["sh", "-c"]`. If your snippet uses Bash or Zsh-specific syntax, update the `cmd` setting in `pet configure`:

```toml
[General]
  cmd = ["bash", "-c"]
```

**Problem: Parameters are not being recognized**
Parameters must use angle brackets: `<name>` or `<name=default>`. Make sure there are no extra spaces inside the brackets. The format `< name >` will not work.

**Problem: `pet sync` fails with authentication errors**
Verify your access token has the correct scope (`gist` for GitHub, appropriate scope for GitLab). Try regenerating the token. You can also set the token via the environment variable `$PET_GITHUB_ACCESS_TOKEN` instead of putting it in the config file.

**Problem: Multiline commands are not saving correctly**
Use the `--multiline` flag: `pet new --multiline`. This lets you enter commands that span multiple lines.

---

## 8. References

- [Pet GitHub Repository](https://github.com/knqyf263/pet) — official source, README, and releases
- [fzf — Fuzzy Finder](https://github.com/junegunn/fzf) — the recommended selector for Pet
- [peco](https://github.com/peco/peco) — alternative selector supported by Pet
- [TOML Specification](https://toml.io/) — the format Pet uses for configuration and snippet storage
- [GitHub Gist Documentation](https://docs.github.com/en/get-started/writing-on-github/editing-and-sharing-content-with-gists) — for understanding Gist sync
- [Pet Blog Post by Copperlight](https://copperlight.github.io/shell/pet-cli-snippet-manager/) — community tutorial

---

## Related Tutorials

- [[pet-deep-dive|Pet Deep Dive]] — advanced configuration, multi-directory setups, GitLab sync, and automation patterns
- [[television-beginner-guide|Television Beginner Guide]] — another fuzzy-finder-based terminal tool for searching files, repos, and more
- [[television-deep-dive|Television Deep Dive]] — advanced Television patterns and custom channels
- [[dotfiles-beginner-guide|Dotfiles Beginner Guide]] — managing your shell configuration files, including Pet's config
- [[dotfiles-deep-dive|Dotfiles Deep Dive]] — advanced dotfile management with chezmoi and version control
- [[gh-cli-beginner-guide|GitHub CLI Beginner Guide]] — working with GitHub (including Gists) from the terminal
- [[gh-cli-deep-dive|GitHub CLI Deep Dive]] — advanced GitHub CLI workflows
- [[ssh-tutorial|SSH Tutorial]] — SSH configuration that pairs with Pet's SSH snippets
- [[sesh-beginner-guide|Sesh Beginner Guide]] — another terminal productivity tool for session management

---

## 9. Summary

**Key takeaways:**

- **Pet saves commands** with descriptions so you never have to dig through shell history for that complex one-liner you used three months ago.
- **Parameters** (`<name>` and `<name=default>`) turn specific commands into reusable templates — save once, use with different values every time.
- **Tags** let you organize snippets into categories and filter searches to just the subset you need.
- **Shell integration** (the `pet-select` function) puts snippet search at your fingertips with a keyboard shortcut, right at your prompt.
- **Gist sync** keeps your snippets backed up and consistent across every machine you work on.
- Snippets are stored in a plain **TOML file** that you can edit directly, version-control, or share with teammates.

**Next steps:** Build up your snippet collection over the next week by running `prev` (or `pet new`) whenever you find yourself using a command worth remembering. Set up the shell keybinding so searching snippets becomes muscle memory. Once you have 20 or more snippets, enable Gist auto-sync so your collection is always backed up. For advanced patterns like multi-directory setups, inline parameter expansion, and automation, continue to [[pet-deep-dive|Pet Deep Dive]].
