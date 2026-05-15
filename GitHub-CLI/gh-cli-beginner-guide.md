---
title: "GitHub CLI (gh) — Beginner Guide"
date: 2026-05-03
difficulty: beginner
tags: [github, cli, git, terminal, macos, linux, version-control]
---

# GitHub CLI (gh) — Beginner Guide

## Overview

GitHub CLI (`gh`) is GitHub's official command-line tool that brings pull requests, issues, repositories, Actions, and more directly into your terminal. Instead of switching between your code editor and the GitHub website, you can manage your entire GitHub workflow without leaving the command line.

**Why it matters:** If you work with Git repositories on GitHub, `gh` eliminates context-switching. You can create repos, open PRs, review code, manage issues, and trigger CI/CD pipelines — all from the same terminal where you write code.

**What you will learn:**
- How to install and authenticate `gh` on macOS (Apple Silicon) and Linux (Rocky Linux 8)
- Core commands for repository, PR, and issue management
- How to create and clone repos without touching the browser
- A practical workflow for everyday development tasks

## Prerequisites

Before starting, you should have:

- **Git installed and configured** — you should be comfortable with `git add`, `git commit`, `git push`, and `git pull`. If you need a refresher on permissions and file management, see [[linux-permissions-beginner-guide|Linux Permissions Beginner Guide]].
- **A GitHub account** — free tier is fine
- **Terminal access** — on macOS, use Terminal.app or any terminal emulator (see [[honeymux-beginner-guide|Honeymux Beginner Guide]] for terminal multiplexing)
- **Homebrew (macOS)** or **dnf/yum (Rocky Linux 8)** for package installation

## Key Concepts

**GitHub CLI vs Git:** Git is the version control system that tracks changes to your code. GitHub CLI is a separate tool that interacts with *GitHub's platform features* — things like pull requests, issues, Actions, and Gists that exist on GitHub's servers, not in Git itself.

**Authentication:** `gh` needs a token to talk to GitHub on your behalf. It handles this via `gh auth login`, which walks you through creating and storing an OAuth token.

**Command Structure:** All `gh` commands follow this pattern:

```
gh <noun> <verb> [flags]
```

For example: `gh repo create`, `gh pr list`, `gh issue close`. The noun is what you're working with, the verb is what you're doing to it.

**Aliases:** You can create shortcuts for frequently-used commands with `gh alias set`, similar to how you might configure shell aliases in your [[dotfiles-beginner-guide|dotfiles]].

## Step-by-Step Instructions

### Step 1: Install GitHub CLI

**On macOS (Apple Silicon):**

```bash
brew install gh
```

Expected output:
```
==> Downloading https://ghcr.io/v2/homebrew/core/gh/manifests/2.65.0
==> Installing gh
==> Pouring gh--2.65.0.arm64_sonoma.bottle.tar.gz
🍺  /opt/homebrew/Cellar/gh/2.65.0: 195 files, 52.3MB
```

**On Rocky Linux 8:**

```bash
sudo dnf install 'dnf-command(config-manager)'
sudo dnf config-manager --add-repo https://cli.github.com/packages/rpm/gh-cli.repo
sudo dnf install gh
```

Expected output:
```
Installed:
  gh-2.65.0-1.x86_64
Complete!
```

Verify the installation:

```bash
gh --version
```

Expected output:
```
gh version 2.65.0 (2025-12-10)
https://github.com/cli/cli/releases/tag/v2.65.0
```

### Step 2: Authenticate with GitHub

```bash
gh auth login
```

You'll be guided through an interactive prompt:

```
? What account do you want to log into? GitHub.com
? What is your preferred protocol for Git operations on this host? HTTPS
? Authenticate Git with your GitHub credentials? Yes
? How would you like to authenticate GitHub CLI? Login with a web browser

! First copy your one-time code: ABCD-1234
Press Enter to open github.com in your browser...
```

Follow the prompts — it will open a browser where you paste the one-time code and authorize the app. Once complete:

```
✓ Authentication complete.
- gh config set -h github.com git_protocol https
✓ Configured git protocol
✓ Logged in as your-username
```

**Why this matters:** Authentication only needs to happen once. The token is stored securely and all subsequent `gh` commands will work without re-authenticating.

### Step 3: Verify Your Setup

```bash
gh auth status
```

Expected output:
```
github.com
  ✓ Logged in to github.com account your-username (keyring)
  - Active account: true
  - Git operations protocol: https
  - Token: gho_************************************
  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'
```

### Step 4: Create Your First Repository

Let's say you have a local project directory you want to push to GitHub:

```bash
cd ~/owl/vid/rocks
gh repo create rocks --public --source=. --remote=origin --push
```

Breaking down the flags:
- `--public` — makes the repo visible to everyone (use `--private` for private repos)
- `--source=.` — uses the current directory as the source
- `--remote=origin` — names the remote "origin"
- `--push` — pushes existing commits immediately

Expected output:
```
✓ Created repository your-username/rocks on GitHub
  https://github.com/your-username/rocks
✓ Added remote https://github.com/your-username/rocks.git
✓ Pushed commits to https://github.com/your-username/rocks.git
```

### Step 5: Clone an Existing Repository

```bash
gh repo clone owner/repo-name
```

This is simpler than manually copying the URL from GitHub. It also automatically configures the remote.

### Step 6: Create a Branch and Open a Pull Request

```bash
# Create and switch to a new branch
git checkout -b feature/add-readme

# Make your changes
echo "# Rocks" > README.md
git add README.md
git commit -m "Add README"

# Push and create a PR in one step
gh pr create --title "Add README" --body "Initial project documentation"
```

Expected output:
```
Creating pull request for feature/add-readme into main in your-username/rocks

https://github.com/your-username/rocks/pull/1
```

### Step 7: List and Check Pull Requests

```bash
# List open PRs
gh pr list

# View details of a specific PR
gh pr view 1

# Check PR status (CI, reviews, etc.)
gh pr checks 1
```

## Practical Examples

### Creating a repo from scratch (no local code yet)

```bash
gh repo create my-new-project --public --clone --add-readme
cd my-new-project
```

This creates the repo on GitHub *and* clones it locally — ready to work.

### Working with issues

```bash
# Create an issue
gh issue create --title "Bug: video playback fails" --body "Steps to reproduce..."

# List open issues assigned to you
gh issue list --assignee @me

# Close an issue
gh issue close 5
```

### Viewing repo info in the terminal

```bash
gh repo view
```

This prints the README and repo metadata right in your terminal — handy when you want a quick overview without opening a browser.

### Forking and contributing to open source

```bash
# Fork a repo and clone your fork
gh repo fork original-owner/cool-project --clone

# After making changes, create a PR back to the original
gh pr create --repo original-owner/cool-project
```

### Running GitHub Actions workflows

```bash
# List recent workflow runs
gh run list

# View details of a specific run
gh run view 12345

# Watch a run in real-time
gh run watch 12345
```

## Hands-On Exercises

**Exercise 1: First Repo**
Create a new public repository called `gh-practice` with a README, clone it locally, add a file, commit, and push — all using `gh` and `git` commands only (no browser).

**Exercise 2: Issue Workflow**
In your `gh-practice` repo, create three issues with different labels. List them, filter by label, then close one.

**Exercise 3: PR Workflow**
Create a feature branch, make a change, push it, and open a pull request using `gh pr create`. Then merge it with `gh pr merge`.

**Exercise 4: Explore an Open Source Project**
Use `gh repo view cli/cli` to view the GitHub CLI's own repository. List its recent issues with `gh issue list --repo cli/cli --limit 5`.

## Troubleshooting

**"gh: command not found"**
- macOS: Make sure Homebrew's bin is in your PATH. Run `eval "$(/opt/homebrew/bin/brew shellenv)"` or add it to your shell profile.
- Rocky Linux: Verify the repo was added correctly and run `sudo dnf install gh` again.

**"HTTP 401: Bad credentials"**
- Your token may have expired. Run `gh auth login` again to re-authenticate.

**"refusing to allow a Personal Access Token to create or update workflow"**
- Your token needs the `workflow` scope. Run `gh auth refresh -s workflow` to add it.

**"git@github.com: Permission denied (publickey)"**
- You're using SSH protocol but don't have keys set up. Either switch to HTTPS with `gh config set git_protocol https` or set up SSH keys.

**"repository not found" when running `gh repo view`**
- Make sure you're inside a Git repository directory that has a GitHub remote configured.

## Related Tutorials

- [[git-worktrees-worktrunk-beginner-guide|Git Worktrees & Worktrunk Beginner Guide]] — advanced branching workflows that pair well with `gh pr`
- [[git-worktrees-worktrunk-deep-dive|Git Worktrees & Worktrunk Deep Dive]] — understanding worktrees for parallel PR development
- [[worktrunk-beginner-guide|Worktrunk Beginner Guide]] — streamlined trunk-based workflow using worktrees
- [[dotfiles-beginner-guide|Dotfiles Beginner Guide]] — managing your shell configuration including `gh` aliases
- [[claude-code-vscode-go-beginner-guide|Claude Code VSCode Go Beginner Guide]] — AI-assisted development workflow that uses `gh`
- [[honeymux-beginner-guide|Honeymux Beginner Guide]] — terminal multiplexing for managing multiple repos
- [[linux-permissions-beginner-guide|Linux Permissions Beginner Guide]] — file permissions context for Linux installs
- [[docker-test-container-beginner-guide|Docker Test Container Beginner Guide]] — testing `gh` in containerized environments
- [[just-beginner-guide|Just Beginner Guide]] — task runner that can wrap `gh` commands into project workflows

## Summary

**Key takeaways:**
- `gh` brings GitHub's platform features (PRs, issues, repos, Actions) to your terminal
- Install via Homebrew (macOS) or dnf (Rocky Linux 8), then authenticate once with `gh auth login`
- The command pattern is always `gh <noun> <verb> [flags]`
- You can create repos, open PRs, manage issues, and monitor CI without a browser
- `gh` works alongside Git — it doesn't replace it, it extends your workflow

**Next steps:**
- Explore `gh alias` to create shortcuts for your most-used commands
- Check out [[gh-cli-deep-dive|GitHub CLI Deep Dive]] for advanced usage including extensions, API access, and scripting
- Try integrating `gh` into a [[just-beginner-guide|Justfile]] for project-specific automation
# Related Tutorials

- [[pet-beginner-guide|Pet Beginner Guide]] — CLI snippet manager that syncs via GitHub Gist
- [[pet-deep-dive|Pet Deep Dive]] — advanced Gist and GitLab sync for snippet management
