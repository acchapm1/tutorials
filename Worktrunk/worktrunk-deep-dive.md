---
title: "Worktrunk: Deep Dive and Advanced Workflows"
date: 2026-04-10
difficulty: advanced
tags: [worktrunk, git, worktrees, cli, version-control, automation, hooks, ci-cd, parallel-agents]
---

# Worktrunk: Deep Dive and Advanced Workflows

## 1. Overview

Beyond the basic create-edit-merge workflow, Worktrunk is a sophisticated tool designed for complex development scenarios: parallel AI agent orchestration, CI/CD integration, advanced hook automation, team-based workflows, and fine-grained repository configuration.

This reference covers the complete Worktrunk ecosystem: the deep mechanics of each command, configuration patterns, hook design for automation, parallel agent coordination, LLM integration for commit messages and branch summaries, advanced merge strategies, and production-grade team patterns.

For a gentler introduction, see the [[git-worktrees-worktrunk-beginner-guide|Worktrunk Beginner's Guide]].

---

## 2. Prerequisites

- Comfort with the Linux/macOS command line (shells, piping, environment variables)
- Familiarity with git fundamentals (branches, commits, rebasing, merging) — covered in the beginner guide
- A working Worktrunk installation with shell integration enabled
- Understanding of your project's dependencies and CI/CD setup
- Optionally, experience with template languages (Jinja2 syntax) and TOML configuration
- For LLM features: access to an LLM CLI tool (Claude Code, llm, aichat, etc.)
- For CI integration: familiarity with GitHub Actions, GitLab CI, or your CI provider

---

## 3. Key Concepts

### 3.1 The Worktrunk Architecture

Worktrunk operates as a layer above git, providing:

1. **Branch and path management** — Automatically compute worktree paths from branch names using configurable templates.
2. **Lifecycle hooks** — Run arbitrary commands at 11 distinct points: pre-switch, post-switch, pre-start, post-start, pre-commit, post-commit, pre-merge, post-merge, pre-remove, post-remove.
3. **State persistence** — Track branch markers, per-branch variables, and user approvals across sessions.
4. **Rich output** — Display worktree status with commit counts, file changes, CI results, and LLM-generated summaries.
5. **LLM integration** — Pipe diffs through your choice of LLM for commit messages and branch analysis.

### 3.2 The Merge Pipeline

`wt merge` executes a well-defined 8-step pipeline:

1. **Commit** — Stage and commit any uncommitted changes (skipped with `--no-commit`)
2. **Squash** — Combine all commits since the target branch into one (skipped with `--no-squash`)
3. **Rebase** — Rebase onto the target branch if behind (skipped with `--no-rebase`)
4. **Pre-merge hooks** — Run validation tests, linters, builds (skipped with `--no-hooks`)
5. **Fast-forward merge** — Update the target branch to your squashed commit (replaced with merge commit if `--no-ff`)
6. **Pre-remove hooks** — Run cleanup commands before deleting the worktree
7. **Cleanup** — Remove worktree directory and delete the branch (skipped with `--no-remove`)
8. **Post-remove + post-merge hooks** — Run in background after cleanup

Backup refs are created at `refs/wt-backup/<branch>` before the merge, allowing recovery if needed.

### 3.3 Configuration Hierarchy

Worktrunk reads configuration in this order (later entries override earlier):

1. **Defaults** — Hardcoded in Worktrunk
2. **User config** — `~/.config/worktrunk/config.toml` (personal, never committed)
3. **Project config** — `.config/wt.toml` (repository-specific, committed to git)
4. **Environment variables** — `WORKTRUNK_*` prefixed (highest priority)

This allows per-repository customization while maintaining user-level defaults.

### 3.4 Hook Execution Model

**Blocking hooks** (`pre-*`):

- Execute sequentially by default
- If any hook fails, the operation aborts immediately
- Used for validation (tests, lint checks)
- Named commands run in parallel unless explicitly ordered

**Background hooks** (`post-*`):

- Spawn in the background after the operation completes
- Failures are logged but don't affect the operation
- Used for cleanup, dev server startup, logging
- Named commands run concurrently by default

### 3.5 Template Variables and Filters

All hook commands, path templates, and configuration values support Jinja2-style variable interpolation:

**Variables:**

```
{{ branch }}           # Current branch name
{{ worktree_path }}    # Full path to the worktree
{{ target }}           # Target branch for merge
{{ repo }}             # Repository directory name
{{ repo_path }}        # Full path to repo root
{{ default_branch }}   # Default branch (main or master)
```

**Filters:**

```
{{ branch | sanitize }}        # feature/auth → feature-auth (shell-safe)
{{ branch | hash_port }}       # Deterministic port 10000–19999
{{ branch | sanitize_db }}     # Database-safe identifier
```

---

## 4. Step-by-Step Instructions

### 4.1 Advanced Worktree Path Configuration

By default, Worktrunk creates worktrees as sibling directories (e.g., `../repo.my-feature`). Customize this in `~/.config/worktrunk/config.toml`:

**Default (sibling directories):**

```toml
worktree-path = "{{ repo_path }}/../{{ repo }}.{{ branch | sanitize }}"
```

**Inside the repo (.worktrees/ subdirectory):**

```toml
worktree-path = "{{ repo_path }}/.worktrees/{{ branch | sanitize }}"
```

**Centralized worktree folder:**

```toml
worktree-path = "~/worktrees/{{ repo }}/{{ branch | sanitize }}"
```

**Per-project override:**

```toml
[projects."github.com/your-org/your-repo"]
worktree-path = ".worktrees/{{ branch | sanitize }}"
```

After changing the path template, new worktrees are created at the new location. Existing worktrees remain at their original paths.

### 4.2 Configuring Merge Defaults

Control the default behavior of `wt merge` in user config:

```toml
[merge]
squash = true      # Default: squash commits
commit = true      # Default: auto-commit uncommitted changes
rebase = true      # Default: rebase onto target
remove = true      # Default: remove worktree after merge
ff = true          # Default: fast-forward merge
```

With these defaults:

```bash
wt merge          # Behavior: squash, rebase, merge, remove
wt merge --no-ff  # Override: create merge commit instead
```

### 4.3 Defining Hooks in Project Config

Create `.config/wt.toml` in your repository root (commit this file to share with your team):

**Simple hook (single command):**

```toml
pre-start = "npm ci"
post-merge = "npm run build"
```

**Named hooks (multiple commands):**

```toml
[pre-merge]
test = "npm test"
lint = "npm run lint"
build = "npm run build"
```

By default, named pre-hooks run sequentially (test, then lint, then build). Named post-hooks run concurrently.

**Control ordering of post-hooks:**

```toml
post-start = [
    { install = "npm ci" },
    { build = "npm run build", server = "npm run dev" }
]
```

This installs first, then runs build and server in parallel.

**Use template variables:**

```toml
[post-start]
server = "npm run dev -- --port {{ branch | hash_port }}"

[post-remove]
kill = "lsof -ti :{{ branch | hash_port }} -sTCP:LISTEN | xargs kill 2>/dev/null || true"
```

This assigns each worktree a unique port based on branch name, preventing conflicts.

### 4.4 Progressive Validation Strategy

Run fast checks on commit, thorough checks on merge:

```toml
# Fast checks on every commit
[pre-commit]
lint = "npm run lint"
typecheck = "npm run typecheck"

# Comprehensive checks only before merge
[pre-merge]
test = "npm test"
build = "npm run build"
e2e = "npm run test:e2e"
```

This accelerates development (quick feedback) while still gating merges with comprehensive validation.

### 4.5 Setting Up Per-Worktree Dev Servers

Give each worktree a unique development server:

```toml
[post-start]
server = "npm run dev -- --port {{ branch | hash_port }}"

[post-remove]
kill = "lsof -ti :{{ branch | hash_port }} -sTCP:LISTEN | xargs kill 2>/dev/null || true"

[list]
# Show each worktree's dev server URL in wt list output
url = "http://localhost:{{ branch | hash_port }}"
```

Now multiple dev servers run simultaneously without port conflicts. `wt list` shows each URL.

### 4.6 Per-Worktree Databases with Docker

Spin up isolated database containers per worktree:

```toml
post-start = [
    """wt config state vars set container='{{ repo }}-{{ branch | sanitize }}-postgres' port='{{ ('db-' ~ branch) | hash_port }}'""",
    { db = "docker run -d --rm --name {{ vars.container }} -p {{ vars.port }}:5432 -e POSTGRES_DB={{ branch | sanitize_db }} -e POSTGRES_PASSWORD=dev postgres:16" }
]

[post-remove]
db-stop = "docker stop {{ vars.container }} 2>/dev/null || true"
```

Each worktree gets its own Postgres container on a unique port, with a database name derived from the branch. On removal, the container stops.

### 4.7 Copying Build Caches (Warm Starts)

Avoid cold rebuilds by copying build caches from the main worktree:

```toml
[post-start]
copy = "wt step copy-ignored"
```

`wt step copy-ignored` copies all gitignored files (node_modules/, target/, .venv/, etc.) from the main worktree to the new one, allowing builds to start warm.

### 4.8 LLM Commit Message Generation

Automatically generate commit messages from diffs during merge:

**For Claude Code:**

```toml
[commit.generation]
command = "CLAUDECODE= MAX_THINKING_TOKENS=0 claude -p --no-session-persistence --model=haiku --tools='' --disable-slash-commands --setting-sources='' --system-prompt=''"
```

**For the `llm` CLI tool:**

```toml
[commit.generation]
command = "llm -m claude-haiku-4.5"
```

**For aichat:**

```toml
[commit.generation]
command = "aichat -m claude:claude-haiku-4.5"
```

When configured, `wt merge` and `wt step commit` pipe diffs to your LLM command to generate meaningful commit messages automatically.

### 4.9 LLM Summaries in wt list

Enable AI-generated branch summaries:

```toml
[list]
summary = true
```

Then run:

```bash
wt list --full
```

The output includes a "Summary" column with AI-generated descriptions of what each branch has changed, helping you understand progress at a glance.

### 4.10 Integration with CI/CD Systems

**GitHub Actions pre-merge validation:**

Add a `.github/workflows/wt-merge-check.yml`:

```yaml
name: Worktree Merge Check
on:
  workflow_dispatch:
    inputs:
      branch:
        required: true
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          ref: ${{ github.event.inputs.branch }}
      - uses: actions/setup-node@v3
      - run: npm ci && npm test && npm run build
```

Then in `.config/wt.toml`:

```toml
[pre-merge]
ci = "gh workflow run wt-merge-check.yml -f branch={{ branch }} --ref={{ branch }}"
```

This ensures pre-merge hooks can integrate with remote CI for comprehensive validation.

---

## 5. Practical Examples

### Example 1 — Coordinating Parallel AI Agents

Launch 5 AI agents working on different features in parallel:

```bash
# Terminal 1: Feature A (Auth)
wt switch -c feature-auth -x claude -- 'Implement OAuth2 login flow'

# Terminal 2: Feature B (API)
wt switch -c feature-api -x claude -- 'Build REST API endpoints'

# Terminal 3: Feature C (UI)
wt switch -c feature-ui -x claude -- 'Redesign dashboard UI'

# Terminal 4: Feature D (Tests)
wt switch -c feature-tests -x claude -- 'Write comprehensive test suite'

# Terminal 5: Feature E (Docs)
wt switch -c feature-docs -x claude -- 'Update API documentation'
```

Each agent gets an isolated worktree with its own branch. Monitor progress:

```bash
wt list --full
```

Shows all agents' status: commits, uncommitted changes, CI results, and LLM-generated summaries of what each did.

Merge when ready:

```bash
wt switch feature-auth
# Review the agent's work...
wt merge

wt switch feature-api
# Review...
wt merge

# ... repeat for each agent
```

### Example 2 — Multi-Step Feature Development with Manual Control

Use `wt step` commands when you want granular control:

```bash
# Create and work
wt switch -c feature-complex

# Make changes incrementally
vim src/part1.rs
git add -A
wt step commit

# More changes
vim src/part2.rs
git add -A
wt step commit

# Review before squashing
wt step diff

# Squash everything into one commit
wt step squash main

# Review the squashed state
wt step diff

# Rebase to ensure clean merge
wt step rebase main

# Run tests manually
npm test

# If tests pass, push to main
wt step push main

# Cleanup
wt remove
```

This gives you checkpoint commits during development, but a clean single-commit history on main.

### Example 3 — Advanced Merge Strategy with Pre-Merge Hooks

```toml
# .config/wt.toml
[pre-merge]
# Run tests
test = "npm test"
# Run lint with auto-fix
lint = "npm run lint -- --fix"
# Build
build = "npm run build"
# Security audit
audit = "npm audit"

[post-merge]
# Update dependencies post-merge
update = "npm outdated"
# Push to origin
push = "git push origin main"
```

Now `wt merge` is a comprehensive pipeline: tests, linting, building, auditing, and finally pushing to remote — all gated by the merge command.

### Example 4 — Merging with Preserved Commit History

For teams that prefer clear commit history over squashed commits:

```toml
# .config/wt.toml
[merge]
squash = false   # Preserve individual commits
ff = false       # Create merge commits (semi-linear history)
```

Now `wt merge` preserves each commit and creates a merge commit, giving you a clear record of when features landed.

Alternatively, use a one-off flag:

```bash
wt merge --no-squash --no-ff main
```

### Example 5 — Team-Based Workflow with Approval Gating

```bash
# Project lead reviews and approves hooks once
wt hook approvals add

# Team members can then run the hooks without re-approval
# (hooks are checked against the approved SHA)

# Remove approvals if hooks change
wt hook approvals clear
```

This allows shared `.config/wt.toml` hooks to be run safely across a team without re-prompting every developer.

### Example 6 — Branch Markers for Agent Tracking

Mark branches by agent or status:

```bash
# Mark as AI-managed
wt config state marker set 🤖

# Mark as ready for review
wt config state marker set ✅

# Mark as blocked
wt config state marker set 🚧
```

Markers show in `wt list`, giving you a visual status board at a glance.

---

## 6. Hands-On Exercises

### Exercise 1 — Custom Worktree Path Templates

1. Edit `~/.config/worktrunk/config.toml` and set:
   ```toml
   worktree-path = ".worktrees/{{ branch | sanitize }}"
   ```
2. Create a new worktree: `wt switch -c exercise-path-test`
3. Verify the path is inside `.worktrees/`: `pwd`
4. Restore the default path template and verify new worktrees go back to sibling directories

### Exercise 2 — Multi-Command Hooks

1. Create `.config/wt.toml` in your repo:
   ```toml
   [pre-start]
   npm = "npm ci"
   
   [post-start]
   lint = "npm run lint"
   test = "npm test"
   ```
2. Create a worktree: `wt switch -c exercise-hooks`
3. Confirm hooks ran (check output and verify dependencies are installed)
4. Remove the hook config and verify no hooks run on the next worktree

### Exercise 3 — Per-Worktree Dev Servers

1. Add to `.config/wt.toml`:
   ```toml
   [post-start]
   server = "echo 'Starting server on port {{ branch | hash_port }}' && sleep 10"
   
   [post-remove]
   cleanup = "echo 'Cleaning up port {{ branch | hash_port }}'"
   ```
2. Create two worktrees and observe the unique port assignments in logs
3. Verify different branches get different ports (deterministic based on branch name)

### Exercise 4 — Progressive Validation

1. Create `.config/wt.toml` with fast pre-commit checks and comprehensive pre-merge checks
2. Create a worktree with some failing tests in pre-commit
3. Notice the commit aborts due to test failure
4. Fix the tests and retry
5. Now merge with `wt merge` and observe all pre-merge hooks run

### Exercise 5 — Manual Step Commands

1. Create a worktree: `wt switch -c exercise-steps`
2. Make and commit a change: `echo "test" > f1.txt && git add -A && wt step commit`
3. Make another: `echo "test2" > f2.txt && git add -A && wt step commit`
4. Review the diff: `wt step diff`
5. Squash: `wt step squash main`
6. Rebase: `wt step rebase main`
7. Push: `wt step push main`
8. Cleanup: `wt remove`
9. Verify on main the change is squashed: `git log --oneline -n 2`

### Exercise 6 — LLM Commit Message Generation

1. Configure LLM in `~/.config/worktrunk/config.toml` with a valid command
2. Create a worktree and make changes
3. Run `wt merge` and observe the LLM-generated commit message in the merge output
4. Verify the message on main: `git log -1`

---

## 7. Troubleshooting

### Hook fails and blocks merge

**Cause:** A pre-merge hook (test, lint, build) failed.

**Diagnosis:**

```bash
wt merge -v              # Verbose mode shows which hook failed
wt hook pre-merge --yes  # Run the hook directly to see the error
```

**Fix:** Resolve the underlying issue and retry:

```bash
# Fix the code
vim src/broken.rs
npm test
wt merge
```

Or skip the hook if it's non-critical:

```bash
wt merge --no-hooks
```

### Hook approval required repeatedly

**Cause:** `.config/wt.toml` has changed; Worktrunk requires re-approval.

**Fix:** Re-approve the hooks:

```bash
wt hook approvals add
```

Or clear all approvals if they become too restrictive:

```bash
wt hook approvals clear
```

### Port conflict on dev server hook

**Cause:** Multiple worktrees trying to use the same port.

**Fix:** Use the `hash_port` filter to assign unique ports:

```toml
[post-start]
server = "npm run dev -- --port {{ branch | hash_port }}"
```

### Merge conflicts after rebase

**Cause:** Your branch conflicts with changes in the target.

**Fix:**

1. Resolve conflicts manually:

```bash
# See conflicts
git status

# Edit conflicted files
vim src/conflicted.rs

# Mark as resolved
git add -A
git commit
```

2. Re-run merge:

```bash
wt merge
```

If the merge still fails, complete it manually:

```bash
wt step rebase main
# Resolve any remaining conflicts
wt step push main
wt remove
```

### Worktree gets stuck in "merging" state

**Cause:** `wt merge` was interrupted (killed, network failure, etc.).

**Fix:**

```bash
# Check status
wt list

# If merge is incomplete, manually abort and clean up
git merge --abort
wt remove --no-delete-branch  # Keep branch, remove worktree
```

### LLM command fails silently

**Cause:** The LLM command path is wrong or the tool isn't installed.

**Diagnosis:**

```bash
wt merge -vv              # Debug mode shows command execution
which claude              # Verify the tool is in PATH
```

**Fix:** Update the command in `~/.config/worktrunk/config.toml`:

```toml
[commit.generation]
command = "/usr/local/bin/claude -p ..."  # Use absolute path
```

### Environment variables not expanding in hooks

**Cause:** Template variables are Jinja2, not shell variables.

**Fix:** Use Worktrunk template syntax:

```toml
# Wrong:
command = "echo $BRANCH"

# Correct:
command = "echo {{ branch }}"
```

### Backup refs pile up

**Cause:** Many merges create many backup refs at `refs/wt-backup/*`.

**Fix:** Prune unreferenced backups periodically:

```bash
git gc --aggressive
git reflog expire --all --expire=now
git reflog prune
```

---

## 8. References

- [Worktrunk official documentation](https://worktrunk.dev/)
- [Worktrunk CLI reference](https://worktrunk.dev/reference/)
- [Worktrunk hooks documentation](https://worktrunk.dev/hook/)
- [Worktrunk configuration guide](https://worktrunk.dev/config/)
- [Worktrunk tips and patterns](https://worktrunk.dev/tips-patterns/)
- [Worktrunk LLM integration](https://worktrunk.dev/llm-commits/)
- [Worktrunk Claude Code plugin](https://worktrunk.dev/claude-code/)
- [Git worktrees documentation](https://git-scm.com/docs/git-worktree)
- [Git merge strategies](https://git-scm.com/docs/git-merge)
- [Jinja2 template syntax](https://jinja.palletsprojects.com/en/latest/templates/)
- [TOML configuration format](https://toml.io/)

---

## 9. Summary

**Key takeaways:**

- **Advanced configuration** enables per-project and per-user customization of paths, merge strategies, and hook behavior through `.config/wt.toml` and `~/.config/worktrunk/config.toml`.
- **Hooks** are the backbone of Worktrunk automation. Use pre-hooks for validation, post-hooks for cleanup and setup. Template variables and filters allow dynamic commands based on branch and environment.
- **The merge pipeline** is a well-defined 8-step process: commit → squash → rebase → pre-merge hooks → merge → cleanup → post-remove hooks. Each step can be skipped with command-line flags.
- **Parallel agents** can work independently on different features, each in its own worktree with its own dev server, database, and build cache. Coordinate with `wt list --full` and LLM-generated summaries.
- **LLM integration** generates commit messages automatically from diffs and enables branch summaries in `wt list`, accelerating code review and merging.
- **Progressive validation** runs fast checks on commit, thorough checks on merge, balancing developer experience with code quality.
- **Team patterns** like approval gating, branch markers, and shared configuration files enable Worktrunk to scale across teams.

**Advanced workflows to explore:**

- Running parallel AI agents on different features, coordinating merges through status reviews
- Integrating with remote CI/CD systems to gate merges on distributed test results
- Per-worktree development environments (servers, databases, caches) for zero-interference parallel development
- Advanced merge strategies (merge commits, preserved history, squash-and-merge) tailored to team preferences
- Custom hooks for deployment, documentation generation, dependency updates, and post-merge automation

**Next steps:**

- Configure hooks for your project's specific validation needs
- Experiment with LLM commit message generation for faster merging
- Set up per-worktree dev servers and databases for isolation
- Integrate with your CI/CD system to gate merges on remote test results
- Launch multiple AI agents on different features and coordinate their merges

---

## Related Tutorials

- [[git-worktrees-worktrunk-beginner-guide|Git Worktrees with Worktrunk (Beginner)]]
- [[claude-code-vscode-go-beginner-guide|Claude Code]]
- [[git-advanced-workflows|Advanced Git Workflows]]
- [[ci-cd-automation|CI/CD Automation]]
# Related Tutorials
- [[sesh-beginner-guide|Sesh Beginner Guide]] — Combine sesh tmux sessions with Worktrunk worktrees
- [[sesh-deep-dive|Sesh Deep Dive]] — Advanced sesh patterns for worktree-based workflows
- [[dotfiles-beginner-guide|Dotfiles Beginner Guide]] — Version control your Worktrunk and terminal configurations
- [[dotfiles-deep-dive|Dotfiles Deep Dive]] — Cross-platform dotfile management with encryption and templates

- [[gh-cli-beginner-guide|GitHub CLI Beginner Guide]] — manage PRs from your terminal alongside worktrunk
- [[gh-cli-deep-dive|GitHub CLI Deep Dive]] — advanced GitHub API scripting with worktrunk workflows
