---
title: "Dotfiles Management Beginner Guide"
date: 2026-04-11
difficulty: beginner
tags:
  - dotfiles
  - configuration
  - macOS
  - Linux
  - environment-setup
---

## Overview

Dotfiles are hidden configuration files in your home directory that store settings for applications and tools you use daily. They're called "dotfiles" because they start with a dot (`.`), which hides them from normal directory listings. Examples include `.bashrc`, `.zshrc`, `.gitconfig`, and entire directories like `.config/nvim/` for Neovim configuration.

Managing dotfiles manually across multiple machines creates problems: you either lose configurations when switching computers, or spend hours recreating settings by hand. The solution is simple—put your dotfiles in version control using Git, then synchronize them across all your machines.

**Why this matters:** Once you have a dotfiles repository, setting up a new computer becomes a 5-minute task instead of several hours. Your terminal theme, editor configuration, shell aliases, and git settings follow you everywhere. You can also track changes to your setup over time, just like you track changes to code.

This guide covers two proven approaches: **GNU Stow** (simple and transparent) and **chezmoi** (powerful and flexible). Both tools solve the same problem in different ways—you'll learn when to use each.

---

## Prerequisites

Before starting, you'll need:

- **Git installed** on your machine (`git --version` to check)
- **GitHub or GitLab account** (for pushing your dotfiles repository)
- **macOS (10.14+) or Linux** running bash, zsh, or another POSIX shell
- **Comfort with the terminal** and basic commands like `cd`, `mkdir`, `ls`
- **A text editor** you prefer (vim, nano, VS Code, etc.)
- **SSH access to GitHub/GitLab** configured (or HTTPS if you prefer)

**Test your setup:**
```bash
git --version
echo $HOME
ls -la ~/.bashrc  # Or ~/.zshrc if you use zsh
```

---

## Key Concepts

### What Are Dotfiles?

Hidden files starting with `.` are configuration files for shell, git, editor, and terminal applications:

```bash
# Common dotfiles:
~/.bashrc              # Bash shell configuration
~/.zshrc               # Zsh shell configuration
~/.gitconfig           # Git configuration
~/.config/nvim/init.lua     # Neovim editor config
~/.config/sesh/sesh.toml    # sesh session manager config
~/.config/ghostty/config    # Ghostty terminal emulator config
```

Display hidden files with `ls -la` or `ls -A`.

### Symlinks: The Foundation

Both management tools rely on **symlinks** (symbolic links)—shortcuts to files stored elsewhere. Instead of duplicating your config file, you:

1. Store the real file in a version-controlled dotfiles repository
2. Create a symlink in your home directory pointing to the real file
3. Any changes to the real file are reflected everywhere the symlink points

**Example:**
```bash
# Real file lives in your repo:
~/dotfiles/shell/zshrc

# Symlink created in home:
~/.zshrc -> ~/dotfiles/shell/zshrc

# Editing ~/.zshrc actually edits ~/dotfiles/shell/zshrc
```

### The Dotfiles Repository Pattern

Store dotfiles in a single Git repository, typically organized in subdirectories matching `~/.config` structure:

```
dotfiles/
├── shell/
│   ├── bashrc
│   ├── zshrc
│   └── aliases
├── git/
│   └── gitconfig
├── nvim/
│   └── init.lua
├── sesh/
│   └── sesh.toml
├── ghostty/
│   └── config
└── README.md
```

### GNU Stow vs chezmoi: Comparison

| Feature | GNU Stow | chezmoi |
|---------|----------|---------|
| **Complexity** | Simple, transparent | More features, steeper learning curve |
| **What it does** | Creates symlinks to your dotfiles | Manages dotfiles with encryption, templating |
| **File organization** | Mirrored directory structure | Simpler flat or nested structure |
| **Cross-machine differences** | Manual shell scripts | Built-in templating system |
| **Learning curve** | < 5 minutes | 15-30 minutes |
| **Best for** | Minimal setups, learning | Complex multi-machine setups |
| **Encryption** | No | Yes (for sensitive configs) |

**Choose GNU Stow if:** You want something simple, transparent, and easy to debug.

**Choose chezmoi if:** You manage multiple machines with different OS configs, or you want encrypted secrets.

---

## Step-by-Step Instructions

### Step 1: Audit Your Existing Dotfiles

Before creating a repo, identify which dotfiles you actually use and want to manage:

```bash
# List all dotfiles in your home directory
ls -la ~/ | grep "^\."

# Check which shell you use
echo $SHELL

# Check for .config directory
ls -la ~/.config/
```

**Make a list** of files you want to manage. Start small—just `.zshrc`, `.bashrc`, `.gitconfig`, and any editor configs you regularly customize.

**Don't** include:
- `.ssh/` (contains private keys)
- `.aws/` (contains credentials)
- `.kube/config` (contains tokens)
- Session-specific cache files

### Step 2: Create a Dotfiles Repository

Create a new repository on GitHub or GitLab (empty, no README):

```bash
# Clone it locally
git clone git@github.com:yourusername/dotfiles.git
cd dotfiles

# Create a basic structure
mkdir -p shell git nvim sesh ghostty
touch README.md

# Initialize git (it's already a repo, but let's verify)
git config user.email "you@example.com"
git config user.name "Your Name"
```

Add a `README.md` to document your setup:

```bash
cat > README.md << 'EOF'
# My Dotfiles

Configuration for zsh, git, neovim, and terminal tools.

## Quick Start

```bash
git clone git@github.com:yourusername/dotfiles.git
cd dotfiles
# Then follow Step 3 or Step 4 below
```
EOF

git add README.md
git commit -m "Initial commit: add README"
git push origin main
```

### Step 3: Quick Start with GNU Stow

**Install GNU Stow:**

```bash
# macOS
brew install stow

# Ubuntu/Debian
sudo apt-get install stow

# Verify
stow --version
```

**Organize your dotfiles** in the repo matching the home directory structure:

```bash
# In your ~/dotfiles directory, create this structure:
mkdir -p shell git nvim sesh ghostty

# Add your existing configs
cp ~/.zshrc shell/zshrc
cp ~/.bashrc shell/bashrc
cp ~/.gitconfig git/gitconfig
cp ~/.config/nvim/init.lua nvim/init.lua
cp ~/.config/sesh/sesh.toml sesh/sesh.toml
cp ~/.config/ghostty/config ghostty/config
```

**Stow your dotfiles:**

```bash
cd ~/dotfiles

# Stow creates symlinks for everything in shell/
stow shell

# Verify symlinks were created
ls -la ~/ | grep zshrc
# Output: zshrc -> dotfiles/shell/zshrc

# Stow other directories
stow git nvim sesh ghostty

# Verify all symlinks
stow --verbose --simulate shell git nvim sesh ghostty
```

**Commit to git:**

```bash
cd ~/dotfiles
git add -A
git commit -m "Add initial dotfiles: shell, git, editor configs"
git push origin main
```

**On a new machine**, clone and stow:

```bash
git clone git@github.com:yourusername/dotfiles.git
cd dotfiles
stow shell git nvim sesh ghostty
```

### Step 4: Quick Start with chezmoi

**Install chezmoi:**

```bash
# macOS
brew install chezmoi

# Ubuntu/Debian
curl -fsS https://git.io/chezmoi | sh

# Verify
chezmoi --version
```

**Initialize chezmoi** and add your dotfiles:

```bash
# Initialize (creates ~/.local/share/chezmoi/)
chezmoi init

# Add your dotfiles
chezmoi add ~/.zshrc
chezmoi add ~/.bashrc
chezmoi add ~/.gitconfig
chezmoi add ~/.config/nvim
chezmoi add ~/.config/sesh/sesh.toml
chezmoi add ~/.config/ghostty/config

# See what you've added
chezmoi managed

# View the chezmoi source directory
ls -la ~/.local/share/chezmoi/
```

**Create a remote repository:**

```bash
# Initialize git in chezmoi's directory
chezmoi git init

# Add and commit
chezmoi git add .
chezmoi git commit -m "Initial commit: dotfiles"

# Link to GitHub (after creating empty repo)
chezmoi git remote add origin git@github.com:yourusername/dotfiles-chezmoi.git
chezmoi git push -u origin main
```

**On a new machine**, initialize and apply:

```bash
chezmoi init --apply git@github.com:yourusername/dotfiles-chezmoi.git

# Or in two steps:
chezmoi init git@github.com:yourusername/dotfiles-chezmoi.git
chezmoi apply
```

### Step 5: Push to Remote and Clone on a New Machine

**Test your setup** on another computer or VM:

```bash
# Clone your dotfiles
git clone git@github.com:yourusername/dotfiles.git

# If using Stow:
cd dotfiles
stow shell git nvim sesh ghostty

# Verify symlinks
ls -la ~/ | grep -E "bashrc|zshrc|gitconfig"
# Should see arrows -> pointing to your dotfiles repo

# Test your configuration
zsh   # Should load your config
git config --list | grep user.name  # Should show your config
```

---

## Practical Examples

### Example 1: .zshrc with Aliases and Environment Variables

Store shell configuration in `shell/zshrc`:

```bash
# ~/dotfiles/shell/zshrc

# Enable completion
autoload -Uz compinit && compinit

# Custom aliases
alias ll='ls -lh'
alias ..='cd ..'
alias gs='git status'
alias ga='git add'
alias gc='git commit'

# Useful functions
mkcd() {
  mkdir -p "$1"
  cd "$1"
}

# Prompt
PS1='%F{green}%n%f %F{blue}%~%f %# '

# Path additions
export PATH="$HOME/.local/bin:$PATH"
```

### Example 2: .gitconfig for Git Settings

Store in `git/gitconfig`:

```ini
[user]
    name = Your Name
    email = you@example.com

[core]
    editor = nvim
    excludesfile = ~/.gitignore_global

[alias]
    st = status
    co = checkout
    br = branch
    lg = log --graph --oneline --all

[push]
    default = current

[pull]
    rebase = true
```

### Example 3: Neovim Configuration

Store in `nvim/init.lua`:

```lua
-- Basic neovim settings
vim.opt.number = true
vim.opt.relativenumber = true
vim.opt.tabstop = 2
vim.opt.shiftwidth = 2
vim.opt.expandtab = true

-- Key bindings
vim.keymap.set('n', '<leader>w', ':w<CR>', { noremap = true })
vim.keymap.set('n', '<leader>q', ':q<CR>', { noremap = true })

-- Status line
vim.opt.statusline = "%f %h%w%m%r %=%l,%c %P"
```

### Example 4: Cross-Platform Handling

When your dotfiles differ between macOS and Linux, use chezmoi's templating:

```bash
# In chezmoi, create a template
~/.local/share/chezmoi/dot_zshrc.tmpl

# With conditional sections:
{{- if eq .chezmoi.os "darwin" }}
# macOS-only settings
export BREWPATH="/opt/homebrew/bin"
{{- else if eq .chezmoi.os "linux" }}
# Linux-only settings
export BREWPATH="/home/linuxbrew/.linuxbrew/bin"
{{- end }}
```

---

## Hands-On Exercises

### Exercise 1: Set Up a Dotfiles Repo with GNU Stow

**Time: 15 minutes**

1. Create a repository on GitHub named "dotfiles"
2. Clone it: `git clone git@github.com:yourusername/dotfiles.git`
3. Organize your actual dotfiles into the stow structure
4. Copy your `.zshrc` and `.gitconfig` into the repo
5. Run `stow shell git` to create symlinks
6. Verify with `ls -la ~/ | grep bashrc` or `~/.zshrc`
7. Commit and push: `git add -A && git commit -m "Initial dotfiles" && git push`

**Success criteria:** Running `zsh` loads your custom aliases and prompt. `git config --list` shows your settings.

### Exercise 2: Migrate to chezmoi

**Time: 20 minutes**

1. Install chezmoi
2. Run `chezmoi init`
3. Add your dotfiles: `chezmoi add ~/.zshrc ~/.gitconfig ~/.config/nvim`
4. Create a GitHub repo and push your chezmoi config
5. Remove the old stow symlinks: `stow --delete shell git`
6. Apply chezmoi: `chezmoi apply`
7. Verify your setup still works

**Success criteria:** `.zshrc` is now managed by chezmoi. Check `chezmoi managed` to see tracked files.

### Exercise 3: Clone on Another Machine

**Time: 10 minutes**

On a second computer or VM:

1. Install your shell (bash or zsh) and git
2. Clone your dotfiles: `git clone git@github.com:yourusername/dotfiles.git`
3. Apply them: `stow shell git` (if using Stow) or `chezmoi apply` (if using chezmoi)
4. Restart your shell and verify aliases work
5. Verify git config: `git config user.name`

**Success criteria:** Your aliases work, your git user is configured, your editor opens with your custom settings.

---

## Troubleshooting

### Issue: "File exists" when running stow

**Cause:** A file already exists where stow wants to create a symlink.

**Solution:**
```bash
# Backup your original file
cp ~/.zshrc ~/.zshrc.backup

# Remove the original
rm ~/.zshrc

# Try stow again
stow shell

# Compare with backup
diff ~/.zshrc ~/.zshrc.backup
```

### Issue: Symlink points to the wrong location

**Cause:** You ran stow from the wrong directory, or the relative path is broken.

**Solution:**
```bash
# Check what the symlink points to
ls -la ~/.zshrc

# If it's wrong, delete and recreate
rm ~/.zshrc
cd ~/dotfiles
stow shell
```

### Issue: chezmoi apply fails with merge conflicts

**Cause:** Your local file differs significantly from the chezmoi version.

**Solution:**
```bash
# See the diff
chezmoi diff

# Review what changed
chezmoi apply --dry-run

# Manually merge if needed
chezmoi merge ~/.zshrc

# Then apply
chezmoi apply
```

### Issue: `stow: ERROR: not in home directory`

**Cause:** You're running stow from the wrong location.

**Solution:**
```bash
# Always run stow FROM the dotfiles directory
cd ~/dotfiles
stow shell

# Or specify the target home directory
stow --target=$HOME shell
```

---

## References

- **GNU Stow Documentation:** https://www.gnu.org/software/stow/manual/
- **chezmoi Documentation:** https://www.chezmoi.io/
- **Git Documentation:** https://git-scm.com/doc
- **Pro Git Book (free):** https://git-scm.com/book/en/v2
- **Awesome Dotfiles:** https://github.com/search?q=dotfiles

---

## Related Tutorials

- [[television-beginner-guide]] and [[television-deep-dive]] — Fuzzy finder for managing your dotfiles repo
- [[multiarch-hpc-alias-management]] — Managing aliases across different architectures and shells
- [[ghostty-keyboard-shortcuts]] — Configuring your terminal emulator (a dotfile!)
- [[worktrunk-beginner-guide]] and [[worktrunk-deep-dive]] — Using git worktrees with your dotfiles repo
- [[git-worktrees-worktrunk-beginner-guide]] and [[git-worktrees-worktrunk-deep-dive]] — Deep dive into git worktrees
- [[sesh-beginner-guide]] and [[sesh-deep-dive]] — Session manager config as a dotfile
- [[dotfiles-deep-dive]] — Advanced dotfile management, templating, and multi-machine strategies
- [[chezmoi-beginner-guide|Chezmoi Beginner Guide]] — Dedicated guide for getting started with chezmoi
- [[chezmoi-deep-dive|Chezmoi Deep Dive]] — Advanced chezmoi: templates, encryption, run scripts, and multi-machine strategies
- [[macos-app-layout-beginner-guide]] — Where to store `.bunch` files and Moom exports alongside your dotfiles
- [[macos-app-layout-deep-dive]] — Advanced macOS window-layout automation
- [[bunch-beginner-guide|Bunch Beginner Guide]] — Versioning your Bunches folder
- [[bunch-deep-dive|Bunch Deep Dive]] — Snippets, variables, and chezmoi templating of `.bunch` files
- [[moom-beginner-guide|Moom Beginner Guide]] — Exporting and committing Moom's plist
- [[moom-deep-dive|Moom Deep Dive]] — Per-host Moom configs via chezmoi


- [[mosh-beginner-guide|Mosh Beginner Guide]] — Persistent remote terminal sessions using Mosh + tmux on HPC clusters
- [[mosh-deep-dive|Mosh Deep Dive]] — Advanced Mosh configuration, network internals, and HPC workflow patterns


- [[just-beginner-guide|Just Command Runner — Beginner Guide]] — Automate dotfile tasks with a justfile (e.g., `just install`, `just sync`)
- [[karabiner-elements-beginner-guide|Karabiner-Elements Beginner Guide]] — Version your `~/.config/karabiner` directory as a dotfile
- [[karabiner-elements-deep-dive|Karabiner-Elements Deep Dive]] — Managing complex Karabiner JSON configs across machines
- [[just-vs-make|Just vs GNU Make]] — Compare just with Make for automation workflows


- [[micropython-ttgo-t-display-beginner-guide|MicroPython TTGO T-Display Beginner Guide]] — uses virtual environments for esptool and mpremote installation
- [[micropython-ttgo-t-display-deep-dive|MicroPython TTGO T-Display Deep Dive]] — embedded development workflow using shell tools and justfiles


- [[docker-test-container-beginner-guide|Docker Test Container Beginner Guide]] and [[docker-test-container-deep-dive|Docker Test Container Deep Dive]] — test dotfile changes safely in Docker containers
- [[honeymux-beginner-guide|Honeymux Beginner Guide]] — manage tmux configs with a modern TUI


- [[gh-cli-beginner-guide|GitHub CLI Beginner Guide]] — manage GitHub repos from terminal, store aliases in dotfiles
- [[gh-cli-deep-dive|GitHub CLI Deep Dive]] — `gh` alias and config management across machines

- [[ssh-tutorial|SSH Tutorial]]
- [[ssh-config-deep-dive|SSH Config Deep Dive]]


- [[dtach-beginner-guide|Dtach Beginner Guide]] — store dtach aliases and helper scripts in your dotfiles
- [[dtach-deep-dive|Dtach Deep Dive]] — build a session manager script to include in your dotfiles


- [[tmux-claude-code-beginner-guide|Tmux + Claude Code Beginner Guide]] — tmux.conf setup for Claude Code workflows
- [[tmux-claude-code-deep-dive|Tmux + Claude Code Deep Dive]] — Advanced tmux configuration for AI coding


- [[pet-beginner-guide|Pet Beginner Guide]] — CLI snippet manager whose config and snippet files should be included in your dotfiles
- [[pet-deep-dive|Pet Deep Dive]] — multi-machine Pet setup via dotfiles and Gist sync

## Summary

Dotfiles are your personal configuration files. Managing them in Git and using tools like GNU Stow or chezmoi keeps them consistent across all your machines.

**Key takeaways:**

1. **Start small:** Begin with `.zshrc`, `.bashrc`, and `.gitconfig`
2. **Use version control:** Store dotfiles in a Git repository
3. **Choose your tool:** GNU Stow for simplicity, chezmoi for power
4. **Test on another machine:** Verify your setup actually works when cloned
5. **Iterate:** Your dotfiles repo will grow as you customize more tools

**Next steps:**

- Pick either GNU Stow or chezmoi based on your needs
- Create your first dotfiles repository this week
- Add your shell and git configs
- Read [[dotfiles-deep-dive]] to learn about templating, encrypted secrets, and multi-machine setups
- Explore related tutorials for specific tools like [[sesh-beginner-guide]] and [[television-beginner-guide]]

Your terminal will thank you, and setup on new machines will become a pleasure instead of a chore.
