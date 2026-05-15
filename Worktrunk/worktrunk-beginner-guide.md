---
title: "Worktrunk: A Beginner's Guide to Git Worktrees"
date: 2026-04-10
difficulty: beginner
tags: [worktrunk, git, worktrees, cli, version-control]
---

# Worktrunk: A Beginner's Guide to Git Worktrees

## 1. Overview

Git **worktrees** are one of the most powerful but underutilized features in modern version control. Instead of switching branches in a single directory — which loses your in-progress work and forces constant context switching — worktrees let you check out multiple branches in separate directories simultaneously. All worktrees share the same repository's object store, so there's no disk duplication.

Worktrunk (`wt`) is a command-line tool that makes working with git worktrees practical. It eliminates the friction of raw git worktree commands by handling branch creation, path management, status tracking, and the merge-and-cleanup workflow in simple, unified commands.

In this guide, you will learn:

- What git worktrees are and why they matter
- How to install and set up Worktrunk
- How to create a new worktree, make changes, and merge back to main
- How to track multiple worktrees and their status
- Common workflows and practical examples
- Troubleshooting and next steps

No prior experience with git worktrees is assumed. Familiarity with basic git (branches, commits, pushing) is helpful but not required.

---

## 2. Prerequisites

Before starting, make sure you have:

- **A Linux or macOS system** — or WSL on Windows. (Windows native support available via winget.)
- **Git installed** — version 2.17 or later (check with `git --version`).
- **A git repository** with a default branch like `main` or `master`.
- **Cargo or Homebrew installed** — to install Worktrunk. Or pre-built binaries from GitHub.
- **A code editor** — VS Code, vim, Sublime Text, or your preferred editor.
- **Basic command-line familiarity** — you know how to `cd`, `ls`, and run git commands.

---

## 3. Key Concepts

### What Is a Git Worktree?

Every git repository has a primary worktree — the directory you cloned into. A git **worktree** is an additional working directory linked to the same repository, allowing you to check out different branches in parallel.

Each worktree has its own:

- **Working directory** — the files on disk
- **Index** — the staging area
- **HEAD** — the checked-out branch

But all worktrees share:

- **Object database** — commits, blobs, trees (no duplication)
- **Refs** — branches and tags
- **Configuration**

### Why Worktrees Matter

| Scenario | Without Worktrees | With Worktrees |
|----------|------------------|----------------|
| Work on feature A while tests run on feature B | Stash or commit incomplete work, switch branch, lose context | Two separate directories, both active simultaneously |
| Code review during development | Switch branch, lose your current work | Review the PR in a separate worktree, return to yours |
| AI agent isolation | Agents overwrite each other's files | Each agent gets its own directory, independent state |
| Comparing implementations | View one, switch, view another, switch back | Two versions side-by-side in separate directories |

### Worktrees vs. Branches vs. Clones

| Approach | Disk Cost | Independent Files | Shared History |
|----------|-----------|-------------------|----------------|
| **Branches** (single directory) | Minimal | No — switching loses your files | Yes |
| **Worktrees** | Low — only working copies | Yes — each is separate | Yes |
| **Full clones** | High — duplicate .git | Yes | No — independent repos |

Worktrees hit the sweet spot: independent working directories with zero duplication of the git object store.

### What Worktrunk Does

Worktrunk wraps git worktree commands into a simple, user-friendly interface. Compare:

| Task | With Worktrunk | With Plain Git |
|------|----------------|----------------|
| Create + switch to a worktree | `wt switch -c my-feature` | `git worktree add -b my-feature ../repo.my-feature && cd ../repo.my-feature` |
| List worktrees with status | `wt list` | `git worktree list` (paths only, no status) |
| Merge + clean up | `wt merge` | `cd ../repo && git merge my-feature && git worktree remove ../repo.my-feature && git branch -d my-feature` |
| Interactive branch picker | `wt switch` | Manual work, or third-party tools |

Key improvements Worktrunk brings:

- **Branch-based addressing** — Think in terms of branch names, not paths
- **Rich status dashboard** — See commits ahead/behind, uncommitted changes, CI status at a glance
- **One-command merge workflow** — Squash, rebase, merge, and cleanup in one command
- **Hook system** — Automate dependency installs, dev servers, test suites at lifecycle events
- **Interactive picker** — Preview diffs and commit logs before switching
- **LLM commit messages** — Generate commit messages automatically from diffs

---

## 4. Step-by-Step Instructions

### Step 1 — Install Worktrunk

**macOS with Homebrew:**

```bash
brew install worktrunk
```

**Linux with Homebrew:**

```bash
brew install worktrunk
```

**Any platform with Cargo (Rust):**

```bash
cargo install worktrunk
```

**Arch Linux:**

```bash
sudo pacman -S worktrunk
```

**Windows with winget:**

```bash
winget install max-sixty.worktrunk
```

**Note for Windows:** Worktrunk is installed as `git-wt` because `wt` conflicts with Windows Terminal.

### Step 2 — Install Shell Integration

This is **required** for `wt switch` to change your working directory in the shell:

```bash
wt config shell install
```

Expected output:

```
✓ Shell integration installed for bash/zsh
Restart your shell or source your rc file to activate.
```

**Then restart your shell:**

```bash
exec bash
# or
exec zsh
```

Or source your rc file:

```bash
source ~/.bashrc
# or
source ~/.zshrc
```

### Step 3 — Verify Installation

```bash
wt --version
wt config show
```

Expected output:

```
worktrunk 0.12.0

User config:   ~/.config/worktrunk/config.toml
Project config: (none configured)
```

### Step 4 — Navigate to Your Repository

Go to any git repository with a `main` or `master` branch:

```bash
cd /path/to/your/repo
git status
```

### Step 5 — Create Your First Worktree

```bash
wt switch --create my-feature
```

Or use the shorthand:

```bash
wt switch -c my-feature
```

Expected output:

```
✓ Created branch my-feature from main and worktree @ ../repo.my-feature
```

This does three things at once:

1. Creates a new branch `my-feature` based on `main`
2. Creates a worktree directory (default path: `../repo.my-feature`)
3. Changes your shell to the new worktree

Verify you're in the right place:

```bash
pwd              # should show the worktree path
git branch       # should show * my-feature
```

### Step 6 — Make Your Changes

Edit files normally:

```bash
vim src/auth.rs
# or
code .
```

Stage and commit as you go (standard git):

```bash
git add -A
git commit -m "Add authentication module"
```

### Step 7 — Review Your Work

Check the status of all worktrees:

```bash
wt list
```

Expected output:

```
  Branch      Status   HEAD±   main↕  Remote⇅  Commit    Age   Message
@ my-feature                    +5    -2      a1b2c3d   5m    Add authentication module
^ main          ^⇡                    ⇡1      0e631add  1d    Previous work
```

Key symbols:

- `@` — Your current worktree
- `^` — Default branch
- `+5` — 5 commits ahead of main
- `↑1` — 1 unpushed commit to remote

### Step 8 — Merge Back into Main

From inside your `my-feature` worktree, run:

```bash
wt merge
```

Or explicitly specify the target:

```bash
wt merge main
```

Expected output:

```
◎ Committing changes...
✓ Committed @ a1b2c3d
◎ Squashing commits...
✓ Squashed to 1 commit
◎ Rebasing onto main...
✓ Rebased successfully
◎ Merging into main...
✓ Merged (1 commit, +53 lines)
◎ Removing worktree & branch...
✓ Cleaned up
○ Switched to worktree for main @ ../repo
```

The merge pipeline automatically:

1. Commits any uncommitted changes
2. Squashes all commits into one
3. Rebases onto `main` if needed
4. Merges into `main` (fast-forward)
5. Removes the worktree and branch
6. Switches you back to `main`

### Step 9 — Confirm Cleanup

```bash
wt list
git log --oneline -n 5
```

Your `my-feature` worktree and branch are now gone, and your change is integrated into `main`.

---

## 5. Practical Examples

### Example 1 — Fix a Bug in a Separate Worktree

You're working on a feature in the `main` worktree when a critical bug is reported:

```bash
# You're currently in main worktree
wt list

# Create a new worktree for the hotfix
wt switch -c fix-critical-bug --base main

# Edit and test the fix
vim src/bug.rs
npm test

# Merge the fix back to main
wt merge main

# Switch back to your feature
wt switch feature-name
```

Now your bug fix is integrated without disrupting your feature work.

### Example 2 — Code Review Without Disruption

A colleague opens a pull request you need to review:

```bash
# While working on your feature
wt switch pr:42          # GitHub PR #42
# or
wt switch mr:101        # GitLab MR !101

# Review the code, run tests, etc.
npm test

# Switch back to your work
wt switch -
```

The PR is checked out in a completely separate directory. Your work is untouched.

### Example 3 — Parallel Development with Multiple Worktrees

You want to work on three features in parallel:

```bash
# Feature 1
wt switch -c feature-auth -- "Implement OAuth2"
# ... work, commit, then switch

# Feature 2
wt switch -c feature-api -- "Build REST API"
# ... work, commit, then switch

# Feature 3
wt switch -c feature-ui -- "Redesign dashboard"
# ... work, commit, then switch

# Check progress across all
wt list --full

# Review and merge each
wt switch feature-auth
wt merge
wt switch feature-api
wt merge
wt switch feature-ui
wt merge
```

Each feature is independent; no context switching or stashing required.

### Example 4 — Create from a Different Base Branch

You need to base a feature on `develop` instead of `main`:

```bash
wt switch -c feature-name --base develop
```

Or create from the current branch:

```bash
wt switch -c experiment --base=@
```

The `@` shortcut refers to your current branch.

### Example 5 — Interactive Worktree Picker

Skip typing branch names and use the interactive TUI:

```bash
wt switch
```

Expected output (interactive terminal UI):

```
┌─────────────────────────────────────────────────────────────┐
│  Navigate: ↑/↓  |  Filter: type  |  Create: Alt-c  |  Select: Enter
│
│  @ feature-auth       |5 ahead of main
│    fix-nav            |2 ahead of main
│    main               |default branch
│
│  Diff │ Log │ Main Diff │ Remote │ Summary
└─────────────────────────────────────────────────────────────┘
```

Use the arrow keys to navigate, press `Enter` to switch, or type to filter by name. Press `1`–`5` to preview diffs, logs, and commit summaries.

---

## 6. Hands-On Exercises

### Exercise 1 — Create and Switch Worktrees

1. Make sure shell integration is installed: `wt config shell install`
2. Navigate to a git repo: `cd /path/to/repo`
3. Create a worktree: `wt switch -c exercise-1`
4. Verify you're in the right place: `pwd` and `git branch`
5. Edit a file: `echo "test" >> test.txt`
6. Commit the change: `git add -A && git commit -m "Test commit"`
7. View all worktrees: `wt list`
8. Switch to main: `wt switch main` (or `wt switch ^`)
9. Confirm you're on main: `git branch`

### Exercise 2 — Merge a Worktree

1. Create a worktree: `wt switch -c exercise-2`
2. Create a new file: `echo "hello" > hello.txt`
3. Commit: `git add -A && git commit -m "Add hello"`
4. Merge: `wt merge`
5. Verify cleanup: `wt list` (exercise-2 should be gone)
6. Check main has the change: `git log -1` (should show "Add hello")

### Exercise 3 — Use the Interactive Picker

1. Create two worktrees: `wt switch -c exercise-3a` and `wt switch -c exercise-3b`
2. Switch to one, make a commit: `echo "a" > file.txt && git add -A && git commit -m "Change A"`
3. Open the picker: `wt switch` (no arguments)
4. Use arrow keys to navigate, press `Enter` to switch
5. Try pressing `1` to view diffs, `2` to view logs
6. Close the picker: `Esc`

### Exercise 4 — Review Before Merging

1. Create a worktree: `wt switch -c exercise-4`
2. Make several commits: `echo "change1" > f1.txt && git add -A && git commit -m "Change 1"`
3. Make another: `echo "change2" > f2.txt && git add -A && git commit -m "Change 2"`
4. Review the diff: `wt step diff`
5. Check status: `wt list` (should show 2 commits ahead)
6. Merge: `wt merge`
7. Check main's log: `git log --oneline -n 3` (should show one squashed commit)

---

## 7. Troubleshooting

### "wt switch" doesn't change directory

**Cause:** Shell integration is not installed or not sourced.

**Fix:**

```bash
wt config shell install
exec bash  # or exec zsh
```

Then restart your shell completely or source your `.bashrc` / `.zshrc`.

### "Branch already exists"

**Cause:** You tried to create a branch that already exists.

**Fix:** Either switch to the existing branch:

```bash
wt switch existing-branch
```

Or use a different name:

```bash
wt switch -c new-name
```

### "Path already occupied"

**Cause:** The worktree path (e.g., `../repo.my-feature`) already exists.

**Fix:** Remove the stale directory:

```bash
rm -rf ../repo.my-feature
```

Or use a different path by configuring the path template. See the deep dive guide.

### "Merge conflicts during wt merge"

**Cause:** Your branch conflicts with changes in `main`.

**Fix:**

1. The merge aborts immediately when conflicts are detected
2. Resolve conflicts manually in the worktree:

```bash
git status           # see conflicts
vim src/conflicted.rs    # fix them
git add -A
git commit
```

3. Re-run the merge:

```bash
wt merge
```

### "Unmerged branch won't delete"

**Cause:** The branch has unmerged work (commits not on `main`).

**Fix:** Either merge it first, or force-delete:

```bash
wt remove -D branch-name
```

**Warning:** Force-delete will discard unmerged work. Use only if you're sure.

### "wt list shows wrong status"

**Cause:** The listing may be cached.

**Fix:** Refresh with:

```bash
wt list --full
```

Or manually fetch and rebase:

```bash
git fetch origin
git rebase origin/main
```

### Worktree directory deleted externally

**Cause:** You deleted the worktree directory manually without using `wt remove`.

**Fix:** Clean up git's worktree references:

```bash
git worktree prune
```

Then verify:

```bash
wt list
```

---

## 8. References

- [Worktrunk official documentation](https://worktrunk.dev/)
- [Worktrunk GitHub repository](https://github.com/max-sixty/worktrunk)
- [Git worktrees documentation](https://git-scm.com/docs/git-worktree)
- [Git branch documentation](https://git-scm.com/docs/git-branch)
- [Worktrunk tips and patterns](https://worktrunk.dev/tips-patterns/)
- [Worktrunk CLI reference](https://worktrunk.dev/reference/)

---

## 9. Summary

**Key takeaways:**

- **Git worktrees** let you check out multiple branches in separate directories simultaneously, sharing the same object store.
- **Worktrunk** makes worktrees practical by wrapping git's clunky commands into simple, unified workflows.
- **`wt switch -c my-feature`** creates a branch and worktree in one command, automatically switching you into it.
- **`wt list`** shows all worktrees with status — commits ahead/behind, uncommitted changes, and more.
- **`wt merge`** squashes, rebases, merges, and cleans up the worktree automatically in one command.
- Worktrees are ideal for **parallel development**, **code review**, **bug fixes**, and **AI agent isolation**.

**Next steps:**

- Try creating and merging your first worktree with the exercises above.
- Learn about **hooks and automation** in the [[git-worktrees-worktrunk-deep-dive|Worktrunk Deep Dive]].
- Explore **parallel AI agent workflows** where multiple agents work on different features simultaneously.
- Set up per-worktree configuration (dev servers on unique ports, databases, build caches) for advanced workflows.

---

## Related Tutorials

- [[git-worktrees-worktrunk-beginner-guide|Git Worktrees with Worktrunk]]
- [[claude-code-vscode-go-beginner-guide|Claude Code]]
- [[git-basics-beginner-guide|Git Basics]]
- [[version-control-fundamentals|Version Control Fundamentals]]
# Related Tutorials
- [[sesh-beginner-guide|Sesh Beginner Guide]] — Pair sesh tmux sessions with Worktrunk worktrees
- [[sesh-deep-dive|Sesh Deep Dive]] — Advanced sesh configuration for worktree workflows
- [[dotfiles-beginner-guide|Dotfiles Beginner Guide]] — Manage your Worktrunk and shell configurations across machines
- [[dotfiles-deep-dive|Dotfiles Deep Dive]] — Advanced cross-platform dotfile management

- [[gh-cli-beginner-guide|GitHub CLI Beginner Guide]] — create PRs from worktrunk branches
- [[gh-cli-deep-dive|GitHub CLI Deep Dive]] — automated PR workflows complementing worktrunk
