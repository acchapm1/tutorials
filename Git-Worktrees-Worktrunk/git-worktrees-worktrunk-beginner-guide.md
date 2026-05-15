---
title: "Git Worktrees and Worktrunk: A Beginner's Guide"
date: 2026-04-10
difficulty: beginner
tags: [git, worktrees, worktrunk, version-control, branching, parallel-development]
---

# Git Worktrees and Worktrunk: A Beginner's Guide

## 1. Overview

Working on multiple branches in the same repository can be frustrating. Normally, you have one working directory per clone, which means switching between branches requires stashing changes, running `git checkout`, and losing your mental context. **Git worktrees** solve this by letting you check out **multiple branches simultaneously** in separate directories — all sharing the same `.git` folder.

**Worktrunk** is a command-line tool that makes worktrees much easier to use. Instead of remembering filesystem paths and typing long `git worktree` commands, Worktrunk uses branch names as identifiers and handles the rest automatically. It is especially popular for running **multiple AI coding agents in parallel** (e.g., 5–10 Claude Code sessions, each on its own branch).

In this beginner's guide you will learn:

- What git worktrees are and why they matter
- How Worktrunk simplifies worktree management
- How to install and configure Worktrunk
- Basic workflows for single and multiple parallel tasks
- Practical tips and troubleshooting

By the end, you will be able to create isolated worktrees, switch between them instantly, and clean them up without losing data — all with simple commands.

---

## 2. Prerequisites

Before starting, make sure you have:

- **Git installed** — any recent version (2.10+). Check with `git --version`.
- **A terminal** — you should be comfortable running basic shell commands (`cd`, `ls`, `mkdir`).
- **A Git repository** — a local clone of a project (GitHub, GitLab, or any Git repo).
- **Homebrew (macOS/Linux) or Cargo (for Rust)** — required to install Worktrunk.
- **Basic Git knowledge** — familiarity with branches, commits, and `git status` is helpful but not required.

No advanced Git experience is needed. If you know how to create a branch and commit changes, you are ready.

---

## 3. Key Concepts

### What Are Git Worktrees?

A **git worktree** is an independent working directory that is attached to your repository. Think of it as a separate "copy" of your repo, but without duplicating the `.git` folder.

**Normal workflow (without worktrees):**
```
my-app/
├── .git/
├── src/
└── README.md
```

**With multiple worktrees:**
```
my-app/              (main branch)
├── .git/
├── src/
└── README.md

my-app.feature-auth/ (feature-auth branch)
├── src/             (linked to .git)
└── README.md

my-app.bugfix/       (bugfix branch)
├── src/             (linked to .git)
└── README.md
```

Each worktree directory is a separate checkout of a different branch, but they all share the same `.git` folder and repository history.

### The Problem Worktrees Solve

Imagine you are coding a feature when a critical bug is reported. Without worktrees, your workflow is:

1. Stash your changes (`git stash`)
2. Switch branches (`git checkout main`)
3. Create a bugfix branch (`git checkout -b fix-bug`)
4. Do the work
5. Switch back to your feature (`git checkout feature`)
6. Unstash your changes (`git stash pop`)

This is tedious and loses context. **With worktrees**, you just create another directory and start working — your main directory is untouched.

### Worktrunk: Worktrees Made Simple

Native git worktrees require you to:
- Compute the filesystem path yourself
- Remember where each worktree lives
- Manually manage directory creation

**Worktrunk** automates all of this. Instead of this:

```bash
git worktree add ../my-app.feature-auth feature-auth
cd ../my-app.feature-auth
```

You just type:

```bash
wt switch -c feature-auth
```

Worktrunk automatically creates the directory, checks out the branch, and takes you there. **The mental model shift: instead of thinking about paths, you think about branch names.**

### Key Worktrunk Concepts

| Concept | Meaning |
|---------|---------|
| **Branch name** | The identifier for a worktree (e.g., `feature-auth`, `bugfix-dropdown`) |
| **Worktree directory** | The actual folder on disk where the branch is checked out |
| **Auto-path** | Worktrunk auto-computes the path based on a configurable template |
| **Worktree list** | A view of all active worktrees and their status |
| **Switch** | Move your terminal session to a different worktree |
| **Merge** | Merge a branch back into its target (usually `main`) and clean up |

---

## 4. Step-by-Step Instructions

### Step 1 — Install Worktrunk

**On macOS or Linux (Homebrew):**

```bash
brew install worktrunk
```

**On Linux (via Cargo/Rust):**

```bash
cargo install worktrunk
```

**On Windows (via Winget):**

```bash
winget install max-sixty.worktrunk
```

Verify the installation:

```bash
wt --version
```

Expected output:

```
worktrunk 0.5.0
```

### Step 2 — Install Shell Integration

This is important. By default, `wt switch` runs in a subprocess, so your terminal stays in the old directory. Shell integration fixes this.

```bash
wt config shell install
```

Expected output (may vary by shell):

```
Shell integration installed for zsh in ~/.zshrc
Restart your shell to activate.
```

Restart your shell or reload your configuration:

```bash
# For Zsh:
source ~/.zshrc

# For Bash:
source ~/.bashrc
```

### Step 3 — Clone or Navigate to a Repository

You need an existing Git repository to work with. If you don't have one, clone a test repo:

```bash
cd ~/projects
git clone https://github.com/your-username/my-app.git
cd my-app
git status
```

Expected output:

```
On branch main
Your branch is up to date with 'origin/main'.

nothing to commit, working tree clean
```

Make sure your working directory is clean (no uncommitted changes).

### Step 4 — Create Your First Worktree

Now create a new worktree for a feature:

```bash
wt switch -c feature-auth
```

**What this command does:**
1. Creates a new branch called `feature-auth` off your current branch (usually `main`)
2. Creates a new directory (path auto-computed by Worktrunk)
3. Checks out the branch into that directory
4. Changes your terminal session into that directory

Expected output:

```
Created worktree at ~/projects/my-app.feature-auth
Switched to branch 'feature-auth'
```

Your prompt should now show you are in `~/projects/my-app.feature-auth`.

### Step 5 — Do Some Work

You are now in an isolated worktree. Make changes, stage, and commit:

```bash
echo "// New auth module" > src/auth.ts
git add .
git commit -m "Add auth module"
```

Expected output:

```
[feature-auth 1234567] Add auth module
 1 file changed, 1 insertion(+)
```

### Step 6 — List All Worktrees

Check what you have running:

```bash
wt list
```

Expected output:

```
  main                 ●  up to date
* feature-auth         ●  1 ahead
```

The `*` shows your current worktree. The status shows how many commits ahead/behind `main` each worktree is.

### Step 7 — Switch Between Worktrees

Switch back to `main`:

```bash
wt switch main
```

Expected output:

```
Switched to branch 'main'
```

Check you are there:

```bash
pwd
ls src/auth.ts  # This file doesn't exist in main
```

Expected output:

```
ls: cannot access 'src/auth.ts': No such file or directory
```

Switch back to your feature:

```bash
wt switch feature-auth
ls src/auth.ts  # Exists here
```

Expected output:

```
src/auth.ts
```

### Step 8 — Merge and Clean Up

When your feature is ready, merge it back into `main`:

```bash
wt switch feature-auth
wt merge main
```

Expected output:

```
Merging feature-auth into main...
✓ Merge successful
✓ Worktree removed
```

Worktrunk merges your branch, updates `main`, removes the feature branch, and deletes the worktree directory — all in one step.

Check that it is gone:

```bash
wt list
```

Expected output:

```
  main  ●  up to date
```

---

## 5. Practical Examples

### Example 1 — Fixing a Bug While Coding a Feature

**Scenario:** You are working on a feature when a critical bug is reported.

```bash
# You are in your feature worktree
wt switch -c feature-auth
# ... make changes, commit ...

# Bug report comes in
# Create a separate worktree for the fix
wt switch -c bugfix-critical

# Fix the bug
echo "fix" >> src/bug.js
git add . && git commit -m "Fix critical bug"

# Merge and clean up
wt merge main

# Back to your feature
wt switch feature-auth
# Your changes are still here, untouched!
```

### Example 2 — Running Multiple Tasks in Parallel

Create multiple worktrees for different tasks:

```bash
# Task 1: Add authentication
wt switch -c task-auth
# ... do work ...

# Task 2: Fix pagination (in a new terminal tab)
wt switch -c task-pagination
# ... do work ...

# Task 3: Add tests (in another tab)
wt switch -c task-tests
# ... do work ...

# Check them all
wt list
```

Expected output:

```
  main              ●  up to date
* task-auth         ●  5 ahead
  task-pagination   ●  3 ahead
  task-tests        ●  7 ahead
```

All three tasks are isolated. No stashing, no conflicts between branches until you merge.

### Example 3 — Checking Out a Pull Request

You want to review someone's PR:

```bash
wt switch pr:42
```

Worktrunk fetches PR #42 and checks it out in a new worktree. Review the code, test it, then clean up:

```bash
wt remove
```

### Example 4 — Parallel Claude Code Sessions

This is Worktrunk's killer feature. Create three isolated branches and launch Claude Code agents in each:

```bash
# Tab 1 — Add authentication
wt switch -x claude -c feature-auth -- 'Add user authentication with JWT tokens'

# Tab 2 — Fix a bug
wt switch -x claude -c fix-pagination -- 'Fix the pagination bug on the users list page'

# Tab 3 — Write tests
wt switch -x claude -c tests-api -- 'Write comprehensive tests for all API endpoints'
```

All three agents run in isolation. Each has its own branch and directory. No file conflicts, no git merge conflicts during development.

---

## 6. Hands-On Exercises

### Exercise 1 — Create and Switch

1. Navigate to a Git repository.
2. Create a worktree called `ex-branch-1` with `wt switch -c ex-branch-1`.
3. Create a file called `exercise.txt` with some text.
4. Commit it: `git add . && git commit -m "Exercise file"`.
5. Switch to `main`: `wt switch main`.
6. Verify the file doesn't exist in `main`.
7. Switch back to `ex-branch-1` and verify it exists again.

### Exercise 2 — Parallel Work

1. Create three worktrees: `feature-1`, `feature-2`, `feature-3`.
2. In each, create a different file (e.g., `feature1.txt`, `feature2.txt`, `feature3.txt`).
3. Commit to each.
4. Run `wt list` and observe all three.
5. Switch between them and verify each has its own file.

### Exercise 3 — Merge and Clean

1. Create a worktree called `demo-merge`.
2. Add a file and commit it.
3. Merge it back with `wt merge main`.
4. Verify the worktree is removed with `wt list`.
5. Verify the file exists in `main`.

### Exercise 4 — PR Checkout

If you have access to a repository with open PRs:

1. List PRs: `git pr list` or check GitHub.
2. Check out a PR: `wt switch pr:<number>`.
3. Review the code.
4. Clean up: `wt remove`.

---

## 7. Troubleshooting

### "wt: command not found"

**Cause:** Worktrunk is not installed or not in your PATH.

**Fix:**
```bash
brew install worktrunk
```

Then restart your shell: `source ~/.zshrc` (or `~/.bashrc`).

### "Switch works but I stay in the old directory"

**Cause:** Shell integration is not installed.

**Fix:**
```bash
wt config shell install
source ~/.zshrc
```

### "Branch already exists"

**Cause:** You tried to create a worktree for a branch that already exists.

**Fix:** Either switch to the existing branch:
```bash
wt switch existing-branch
```

Or use a different name:
```bash
wt switch -c new-branch-name
```

### "Worktree is locked"

**Cause:** Another process is using the worktree (maybe another terminal or editor).

**Fix:** Close the other process or use:
```bash
git worktree unlock <worktree-path>
```

### "Merge failed"

**Cause:** There are merge conflicts between your branch and the target branch.

**Fix:** Resolve conflicts manually:
```bash
# Stay in the worktree
git status  # Shows conflicts
# Edit conflicted files
git add .
git commit -m "Resolve conflicts"
wt merge main  # Try again
```

### "I deleted the worktree directory manually, now it's locked"

**Cause:** Worktrunk still thinks the worktree exists.

**Fix:** Prune the worktree list:
```bash
git worktree prune
```

---

## 8. References

- **Worktrunk Official Docs:** [worktrunk.dev](https://worktrunk.dev/worktrunk/)
- **Worktrunk GitHub:** [github.com/max-sixty/worktrunk](https://github.com/max-sixty/worktrunk)
- **Git Worktree Documentation:** [git-scm.com/docs/git-worktree](https://git-scm.com/docs/git-worktree)
- **Git Branching Guide:** [git-scm.com/book/en/v2/Git-Branching](https://git-scm.com/book/en/v2/Git-Branching)

---

## Related Tutorials

- [[claude-code-vscode-go-beginner-guide|Claude Code and VSCode]] — Learn to use Claude Code, which pairs well with Worktrunk for parallel AI agent workflows
- [[git-fundamentals|Git Fundamentals]] — Deep dive into branching and merging strategies
- [[git-worktrees-worktrunk-deep-dive|Git Worktrees and Worktrunk: Deep Dive]] — Advanced topics including automation hooks, build cache sharing, and CI/CD integration

---

## 9. Summary

**Key takeaways:**

- **Git worktrees** let you check out multiple branches simultaneously in separate directories, eliminating the need to stash and switch.
- **Worktrunk** is a CLI that wraps worktrees with a friendlier interface — you work with branch names instead of filesystem paths.
- Basic workflow: `wt switch -c <branch>` to create, `wt switch <branch>` to move between them, `wt merge main` to merge back, and `wt remove` to clean up.
- Worktrees are perfect for **parallel work**: multiple features, parallel bug fixes, or running several Claude Code agents at once.
- Always keep `main` (or your base branch) clean and up to date.
- Use `wt list` frequently to see the status of all your worktrees.

**Next steps:**

- Set up shell integration with `wt config shell install` so you can switch directories instantly.
- Create a few worktrees and practice switching between them.
- Try launching multiple Claude Code sessions in parallel using Worktrunk.
- Read the [[git-worktrees-worktrunk-deep-dive|Deep Dive guide]] to learn about hooks, build cache sharing, and advanced automation.
# Related Tutorials

- [[sesh-beginner-guide|Sesh Beginner Guide]] — Manage tmux sessions per worktree with sesh's smart naming
- [[sesh-deep-dive|Sesh Deep Dive]] — Advanced sesh configuration for git worktree workflows
- [[dotfiles-beginner-guide|Dotfiles Beginner Guide]] — Version control your git and shell configurations
- [[dotfiles-deep-dive|Dotfiles Deep Dive]] — Advanced cross-platform dotfile management
- [[chezmoi-beginner-guide|Chezmoi Beginner Guide]] — Manage your git and shell configs with chezmoi
- [[chezmoi-deep-dive|Chezmoi Deep Dive]] — Advanced chezmoi templates and automation

- [[gh-cli-beginner-guide|GitHub CLI Beginner Guide]] — create and manage PRs from worktree branches
- [[gh-cli-deep-dive|GitHub CLI Deep Dive]] — advanced PR workflows with stacked PRs across worktrees

- [[tmux-claude-code-beginner-guide|Tmux + Claude Code Beginner Guide]] — Run Claude Code on separate worktrees using tmux sessions
- [[tmux-claude-code-deep-dive|Tmux + Claude Code Deep Dive]] — Parallel Claude Code agents with git worktrees + tmux
