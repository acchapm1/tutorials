---
title: "Git Worktrees and Worktrunk: Deep Dive Reference"
date: 2026-04-10
difficulty: advanced
tags: [git, worktrees, worktrunk, version-control, branching, automation, hooks, ci-cd, parallel-development, ai-agents]
---

# Git Worktrees and Worktrunk: Deep Dive Reference

## 1. Overview

This reference guide explores the advanced capabilities of Git worktrees and Worktrunk for developers, DevOps engineers, and teams running sophisticated parallel workflows. It covers the internals of how worktrees work at the Git level, advanced Worktrunk configuration, automation via hooks, build cache sharing, conflict resolution strategies, CI/CD integration, and best practices for scaling parallel AI agent workflows.

This is a comprehensive reference designed for developers who already understand git worktrees basics (see [[git-worktrees-worktrunk-beginner-guide|the Beginner Guide]] for fundamentals) and want to master advanced patterns, architecture decisions, and production deployment.

---

## 2. Prerequisites

Before diving into this material, you should have:

- **Solid Git fundamentals** — branching, merging, rebasing, understanding refs, and working with remotes.
- **Experience with Worktrunk basics** — creating, switching, and removing worktrees (covered in the Beginner Guide).
- **Comfort with shell scripting** — you will work with bash hooks and command automation.
- **Understanding of CI/CD concepts** — GitHub Actions, GitLab CI, or similar pipeline tools.
- **A test repository** — ideally with multiple branches, so you can experiment safely.
- **Optional: familiarity with AI agent systems** — helpful for understanding parallel agent orchestration patterns.

---

## 3. Key Concepts

### 3.1 Git Worktree Internals

#### How Worktrees Share the Repository

All worktrees in a repository share a single `.git` directory. Instead of duplicating the entire object database, index, and refs, each worktree has:

- **Shared:** `.git/objects/` (all commits, trees, blobs), `.git/refs/remotes/` (remote-tracking branches)
- **Per-worktree:** `.git/worktrees/<name>/` (per-worktree refs, index, and HEAD)

When you create a worktree, Git creates a file called `.git` in the worktree root that points back to the main repository:

```bash
cat my-app.feature-auth/.git
```

Expected output:

```
gitdir: /path/to/my-app/.git/worktrees/feature-auth
```

This **gitdir** pointer tells Git to use the shared object database while maintaining separate worktree state.

#### Worktree Refs and the Index

Each worktree has its own:

- **HEAD** — which branch is checked out
- **Index** (staging area) — separate from other worktrees
- **Worktree-specific refs** — stored in `.git/worktrees/<name>/refs/`

This isolation is crucial: you can stage different changes in different worktrees without interference.

#### The .git/worktrees Directory

Inspect the internal structure:

```bash
ls -la .git/worktrees/
```

Expected output:

```
total 32
drwxr-xr-x  4 user  staff  128 Apr 10 10:00 .
drwxr-xr-x 15 user  staff  480 Apr 10 10:00 ..
drwxr-xr-x  8 user  staff  256 Apr 10 09:00 feature-auth
drwxr-xr-x  8 user  staff  256 Apr 10 09:30 bugfix
```

Each subdirectory contains:

```bash
ls -la .git/worktrees/feature-auth/
```

Expected output:

```
HEAD
index
description
commondir
```

- **HEAD** — current branch reference for this worktree
- **index** — the staging area (separate from main repo)
- **commondir** — pointer to the shared `.git` directory
- **description** — optional human-readable worktree label

### 3.2 Worktrunk Configuration and Path Templates

Worktrunk uses a **path template** to compute where new worktrees live. The default is typically `../repo-name.branch-name`, but you can customize it.

View your configuration:

```bash
wt config
```

Expected output:

```
worktreePathTemplate: ../repo-name.{branch}
shell: zsh
autoFetch: true
autoSync: true
```

#### Custom Path Templates

Common templates:

```bash
# Flat structure: worktrees in a siblings directory
wt config worktreePathTemplate: ../worktrees/{branch}

# Nested by category
wt config worktreePathTemplate: ../worktrees/features/{branch}

# Absolute path
wt config worktreePathTemplate: /tmp/worktrees/{branch}

# Using parent directory name
wt config worktreePathTemplate: ../../{parent}/{branch}
```

The template variables available:

| Variable | Meaning |
|----------|---------|
| `{repo}` | Repository name (e.g., `my-app`) |
| `{branch}` | Branch name (e.g., `feature-auth`) |
| `{parent}` | Parent directory name (e.g., `projects`) |
| `{user}` | Current user name |
| `{timestamp}` | Unix timestamp for uniqueness |

**Set a custom template:**

```bash
wt config worktreePathTemplate: "/opt/worktrees/{repo}/{branch}"
```

Now all new worktrees will be created under `/opt/worktrees/`.

### 3.3 Worktree Locking and Safety

Git locks worktrees to prevent concurrent modifications. A locked worktree cannot be modified until the lock is released.

#### Why Locks Exist

If two processes try to modify a worktree's index or HEAD simultaneously, data corruption can occur. Git uses file-based locks (`.git/worktrees/<name>/index.lock`) to serialize access.

#### Lock Commands

See which worktrees are locked:

```bash
git worktree list --porcelain
```

Example output:

```
worktree /path/to/main
branch refs/heads/main
detached

worktree /path/to/feature-auth
branch refs/heads/feature-auth
locked Locked by user
```

Unlock a worktree (if the process holding it crashed):

```bash
git worktree unlock feature-auth
```

**Or use Worktrunk:**

```bash
wt unlock feature-auth
```

#### Why Locks Fail

- An editor (VS Code, Vim, etc.) still has files from the worktree open
- Another terminal session is active in the worktree
- A background process (git merge, IDE indexing) is still running
- The `.git/worktrees/<name>/index.lock` file is stale

**Solution:** Close the editor/terminal, wait for background processes to finish, then unlock.

### 3.4 Detached HEAD Worktrees

Sometimes you want to check out a specific commit, tag, or PR without creating a named branch. Worktrunk can create detached-HEAD worktrees:

```bash
# Check out a specific commit
wt switch -c temp-feature origin/feature-abc@abc1234

# Check out a tag
wt switch -c v1-2-3 v1.2.3

# Check out a PR (GitHub/GitLab)
wt switch pr:42
```

These worktrees are useful for:
- Code review of specific commits
- Testing a specific tag or release
- Temporary experiments you don't want to keep

Merge or remove them like any other worktree.

### 3.5 Conflict Resolution in Worktrees

Conflicts can arise in two contexts:

1. **Merge conflicts** — when merging branches with divergent changes
2. **Worktree conflicts** — when multiple worktrees modify the same files

#### Merge Conflicts Within a Worktree

Standard Git conflict resolution applies:

```bash
# Attempt to merge main into feature-auth
wt switch feature-auth
wt merge main
```

If conflicts occur, Git marks them in the files:

```bash
cat src/file.js
```

Expected output:

```javascript
function getData() {
<<<<<<< HEAD
  return apiV2.get();
||||||| merged common ancestors
  return api.get();
=======
  return apiV3.get();
>>>>>>> main
}
```

Resolve by choosing a version:

```bash
# Keep feature-auth's version
git checkout --ours src/file.js

# Or merge manually
# Edit src/file.js to resolve
git add src/file.js
git commit
```

#### Between-Worktree Conflicts

Multiple worktrees can modify the same Git index without conflict because **each worktree has its own index**. However, at the **filesystem level**, if you are not careful, you can have issues:

**Safe scenario:**
```bash
# Worktree 1: edit src/auth.js
wt switch feature-auth
echo "auth code" >> src/auth.js

# Worktree 2: edit src/api.js (different file)
wt switch bugfix
echo "api fix" >> src/api.js
```

No conflict — different files.

**Dangerous scenario:**
```bash
# Worktree 1: edit src/core.js
wt switch feature-auth
echo "new logic" > src/core.js

# Worktree 2: also edit src/core.js
wt switch bugfix
echo "old logic" > src/core.js  # This overwrites Worktree 1's changes!
```

**Best practice:** Coordinate which files each worktree modifies. Use a shared document or branch naming convention (e.g., `feature-<scope>-<feature-name>`) to avoid stepping on each other's toes.

---

## 4. Step-by-Step Instructions

### 4.1 Setting Up an Advanced Multi-Agent Workflow

This section shows how to configure Worktrunk for a sophisticated parallel development setup with multiple agents, hooks, and CI/CD integration.

#### Step 1 — Configure Worktrunk for Team Deployment

```bash
# Set a shared path template for the team
wt config worktreePathTemplate: /opt/projects/{repo}/worktrees/{branch}

# Enable automatic fetch and sync
wt config autoFetch: true
wt config autoSync: true

# Set up logging (useful for debugging)
wt config logLevel: info
```

#### Step 2 — Create a Hook Script for Dependency Installation

When you create a new worktree, you usually need to install dependencies. Create a reusable script:

```bash
cat > ~/.worktrunk/hooks/onCreateInstall.sh << 'EOF'
#!/bin/bash
set -e

echo "🔧 Installing dependencies for $WM_BRANCH..."

# Detect package manager and install dependencies
if [ -f "package.json" ]; then
    npm install --prefer-offline
elif [ -f "Gemfile" ]; then
    bundle install
elif [ -f "requirements.txt" ]; then
    pip install -r requirements.txt
else
    echo "⚠️  No package manager detected"
fi

echo "✓ Dependencies installed"
EOF

chmod +x ~/.worktrunk/hooks/onCreateInstall.sh
```

Now register the hook:

```bash
wt hook onCreate ~/.worktrunk/hooks/onCreateInstall.sh
```

**What this does:** Every time you create a new worktree, the script automatically runs `npm install`, `bundle install`, or `pip install` depending on your project type.

#### Step 3 — Add a Pre-Merge Hook for Linting and Tests

Before merging, you want to ensure the code passes linting and tests:

```bash
cat > ~/.worktrunk/hooks/preMerge.sh << 'EOF'
#!/bin/bash
set -e

echo "🔍 Running linter..."
npm run lint

echo "🧪 Running tests..."
npm run test

echo "✓ All checks passed"
EOF

chmod +x ~/.worktrunk/hooks/preMerge.sh
wt hook preMerge ~/.worktrunk/hooks/preMerge.sh
```

Now when you run `wt merge main`, Worktrunk automatically runs linting and tests first.

#### Step 4 — Configure Build Cache Sharing

For projects with long build times, copy the build cache from main into new worktrees:

```bash
cat > ~/.worktrunk/hooks/onCreateCache.sh << 'EOF'
#!/bin/bash

if [ -d ".next" ] || [ -d "build/" ] || [ -d "dist/" ]; then
    echo "📦 Syncing build cache from main..."
    wt step main
fi
EOF

chmod +x ~/.worktrunk/hooks/onCreateCache.sh
wt hook onCreate ~/.worktrunk/hooks/onCreateCache.sh
```

The `wt step` command copies build artifacts from the specified worktree, giving you a warm cache.

### 4.2 Advanced Merge Strategies

#### Squashing Commits Before Merge

Squash all commits from your branch into a single commit:

```bash
wt switch feature-auth

# Show commits to merge
git log main..

# Squash and merge into main
wt merge main --squash
```

Expected output:

```
Squashing 3 commits...
Merge complete. Worktree removed.
```

#### Rebasing Instead of Merging

Some teams prefer rebased history instead of merge commits:

```bash
wt switch feature-auth

# Rebase onto main (flattens commit history)
git rebase main

# Fix any conflicts
# ... edit, add, commit ...

# Push and merge via PR
git push -u origin feature-auth
```

#### Interactive Rebase for Commit Cleanup

Clean up your branch history before merging:

```bash
# Rebase last 5 commits interactively
git rebase -i HEAD~5
```

This opens an editor where you can:
- `pick` — keep the commit
- `reword` — change the commit message
- `squash` — combine with the previous commit
- `fixup` — combine without keeping the message
- `drop` — discard the commit

### 4.3 Coordinating Multiple Parallel Agents

This is the advanced use case for Worktrunk: running multiple Claude Code (or other AI) agents in parallel, each on its own branch.

#### Setup: Create a Central Task File

Create a YAML file to define parallel tasks:

```bash
cat > tasks.yaml << 'EOF'
parallel_tasks:
  - name: "authentication"
    branch: "feature-auth"
    command: "Add user authentication with JWT tokens and refresh tokens"
    
  - name: "api-pagination"
    branch: "fix-pagination"
    command: "Fix the pagination bug on the users list page and add tests"
    
  - name: "database-queries"
    branch: "optimize-queries"
    command: "Optimize N+1 queries in the API and add query indexes"
    
  - name: "error-handling"
    branch: "improve-errors"
    command: "Implement comprehensive error handling and logging"
EOF
```

#### Launch Agents (Multiple Terminal Tabs)

In separate terminal tabs, launch each agent:

```bash
# Tab 1 — Authentication
wt switch -x claude -c feature-auth -- 'Add user authentication with JWT tokens and refresh tokens'

# Tab 2 — API Pagination
wt switch -x claude -c fix-pagination -- 'Fix the pagination bug on the users list page and add tests'

# Tab 3 — Database Queries
wt switch -x claude -c optimize-queries -- 'Optimize N+1 queries in the API and add query indexes'

# Tab 4 — Error Handling
wt switch -x claude -c improve-errors -- 'Implement comprehensive error handling and logging'
```

**What happens:**
1. Each agent gets its own worktree (branch + directory)
2. Each agent receives its task description
3. All agents run in **complete isolation** — no git conflicts, no file collisions
4. Each agent can commit independently

#### Monitor Agent Progress

In a separate terminal:

```bash
# Continuous monitoring
watch -n 5 'wt list --full'
```

Expected output:

```
  main                 ●  up to date
* feature-auth         ●  12 commits ahead | CI: PENDING | PR: #123
  fix-pagination       ●  8 commits ahead  | CI: PASSING | PR: #124
  optimize-queries     ●  15 commits ahead | CI: RUNNING | PR: #125
  improve-errors       ●  6 commits ahead  | CI: PASSING | PR: #126
```

#### Post-Merge Orchestration

After agents complete their work:

```bash
# Check that all branches are ready
wt list --full

# Merge each branch (in a safe order)
wt switch feature-auth && wt merge main
wt switch fix-pagination && wt merge main
wt switch optimize-queries && wt merge main
wt switch improve-errors && wt merge main

# Verify everything is clean
wt list  # Should only show main
git status  # Should be clean
```

### 4.4 Git Worktree Internals: Working at the Lower Level

For advanced scenarios, you sometimes need to interact with Git worktrees directly (without Worktrunk).

#### Creating a Worktree Manually

```bash
# Create a worktree for an existing branch
git worktree add ../my-app.feature-existing existing-branch

# Create a worktree for a new branch
git worktree add -b new-branch ../my-app.new-branch origin/main

# Create a detached-HEAD worktree at a specific commit
git worktree add --detach ../my-app.temp abc1234567890
```

#### Listing and Inspecting Worktrees

```bash
# List all worktrees (simple)
git worktree list

# List with porcelain output (machine-readable)
git worktree list --porcelain

# Show worktree status in detail
git worktree list --verbose
```

Expected output (porcelain):

```
worktree /path/to/main
branch refs/heads/main
detached

worktree /path/to/feature-auth
branch refs/heads/feature-auth
```

#### Removing a Worktree Manually

If Worktrunk fails to clean up:

```bash
# Remove the worktree (branch stays)
git worktree remove feature-auth

# Force removal if locked
git worktree remove -f feature-auth

# Remove and delete the branch
git worktree remove feature-auth
git branch -d feature-auth
```

#### Pruning Stale Worktrees

If worktrees are manually deleted or orphaned:

```bash
git worktree prune
```

This cleans up `.git/worktrees/` entries for deleted worktrees.

### 4.5 CI/CD Integration with Worktrunk

#### GitHub Actions Workflow with Worktrees

Create a workflow that automatically creates worktrees for new PRs:

```bash
cat > .github/workflows/worktree-pr.yaml << 'EOF'
name: Worktree for PR
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  setup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0
      
      - name: Install Worktrunk
        run: |
          wget https://releases.worktrunk.dev/worktrunk-linux-x86_64
          chmod +x worktrunk-linux-x86_64
          mv worktrunk-linux-x86_64 /usr/local/bin/wt
      
      - name: Create worktree for PR
        run: |
          wt switch -c pr-${{ github.event.pull_request.number }} origin/${{ github.head_ref }}
          wt list
      
      - name: Run tests
        run: |
          npm install
          npm run test
      
      - name: Report results
        if: always()
        run: |
          echo "✓ Tests passed for PR #${{ github.event.pull_request.number }}"
EOF
```

#### Running Hooks in CI/CD

Modify your hooks to be CI-aware:

```bash
cat > ~/.worktrunk/hooks/ciAware.sh << 'EOF'
#!/bin/bash

if [ -n "$CI" ]; then
    echo "Running in CI environment"
    npm ci  # Use exact versions from package-lock.json
else
    echo "Running locally"
    npm install
fi
EOF
```

---

## 5. Practical Examples

### Example 1 — Sophisticated Parallel Feature Development

**Scenario:** Your team needs to build four independent features for a release. Each can be developed in parallel without blocking others.

```bash
# Configure central path for team
wt config worktreePathTemplate: /opt/team-project/worktrees/{branch}

# Create feature branches
wt switch -c feature-user-profiles
wt switch -c feature-analytics-dashboard
wt switch -c feature-notifications
wt switch -c feature-api-v2

# In the main worktree, track progress
watch 'wt list --full'

# As each agent completes their work, merge
wt switch feature-user-profiles && wt merge main  # Runs linter + tests due to hook
wt switch feature-analytics-dashboard && wt merge main
# etc.
```

**Result:** Four major features developed and integrated in parallel without conflicts or delays.

### Example 2 — Hotfix While Maintaining Development

**Scenario:** Critical production bug discovered while development branch is unstable.

```bash
# You are in development work
wt switch develop  # (unstable branch)

# Bug in production
wt switch -c hotfix-critical

# Fix the bug
sed -i 's/bug/fix/g' src/critical.js
git add . && git commit -m "Hotfix critical bug"

# Merge to main (production)
wt merge main --squash

# The hotfix is live, no impact on develop
wt switch develop  # Back to development, untouched
```

### Example 3 — Code Review and Testing Workflow

```bash
# Review PR from colleague
wt switch pr:99  # Checks out the PR in a new worktree

# Test it locally
npm install
npm run test
npm run build

# Comment on the PR with results
# If approved:
wt merge main  # Merges and cleans up
```

### Example 4 — Stress Testing: 10 Parallel Agents

Run 10 Claude Code agents simultaneously, each solving a different module:

```bash
tasks=(
  "user-auth:Add JWT authentication with refresh tokens"
  "user-profile:Implement user profile API endpoints"
  "posts-crud:Build create/read/update/delete for posts"
  "comments:Add nested comments with replies"
  "likes:Implement like/unlike functionality"
  "search:Build full-text search for posts"
  "notifications:Real-time notifications with WebSocket"
  "analytics:Track user behavior and engagement"
  "permissions:Role-based access control system"
  "performance:Optimize N+1 queries and caching"
)

# Launch all 10 agents in GNU Screen or tmux
for task in "${tasks[@]}"; do
    branch=$(echo $task | cut -d: -f1)
    description=$(echo $task | cut -d: -f2-)
    
    screen -S agent-$branch -d -m bash -c "wt switch -x claude -c $branch -- '$description'"
done

# Monitor
watch 'wt list --full'

# After all complete, merge in dependency order
```

### Example 5 — Building a Release Branch with Worktrees

```bash
# Create release branch
git checkout -b release/1.5.0

# Create worktrees for final polish tasks
wt switch -c release-docs
wt switch -c release-changelog
wt switch -c release-version-bump

# In each worktree:
# - Update documentation
# - Update CHANGELOG
# - Bump version numbers in package.json, etc.

# Merge all back to release/1.5.0
wt merge release/1.5.0

# Tag and deploy
git tag -a v1.5.0 -m "Release 1.5.0"
git push origin release/1.5.0 --tags
```

---

## 6. Hands-On Exercises

### Exercise 1 — Custom Path Templates

1. Set a custom path template: `wt config worktreePathTemplate: /tmp/worktrees/{repo}/{branch}`
2. Create three worktrees (`feature-1`, `feature-2`, `feature-3`)
3. Verify they are created in `/tmp/worktrees/my-app/`
4. Restore the default template

### Exercise 2 — Hook-Driven Automation

1. Create a simple hook script that logs `"Worktree created at $(date)"` when onCreate fires
2. Register it: `wt hook onCreate /path/to/hook.sh`
3. Create a new worktree and verify the hook runs
4. Create a preMerge hook that runs `echo "About to merge"` and verify it executes before merge

### Exercise 3 — Conflict Resolution

1. Create a worktree `feature-edit`
2. Modify `README.md` and commit
3. In `main`, also modify `README.md` differently
4. Try to merge: `wt merge main`
5. Resolve the conflict manually
6. Complete the merge

### Exercise 4 — Parallel Task Simulation

1. Define 4 tasks in a YAML file
2. Create 4 worktrees (one per task)
3. In each worktree, create a different file with task-specific content
4. Commit to each
5. Merge all back to main in a specific order
6. Verify all changes are in main

### Exercise 5 — Advanced Merge with Rebasing

1. Create a feature branch and commit 3 changes
2. Rebase the feature on main: `git rebase main`
3. Use interactive rebase to squash commits 2 and 3
4. Merge the cleaned-up branch into main

---

## 7. Troubleshooting

### Merge Conflicts Blocking Multiple Worktrees

**Problem:** A conflict in one worktree prevents merging others.

**Solution:** Merge in dependency order. If modules A, B, C have dependencies, merge in that order.

```bash
wt switch module-a && wt merge main  # Base module
wt switch module-b && wt merge main  # Depends on A
wt switch module-c && wt merge main  # Depends on B
```

### Build Cache Not Syncing

**Problem:** `wt step main` does nothing or fails.

**Diagnosis:**

```bash
wt step main --verbose
```

**Fix:** Ensure the source directory has build artifacts:

```bash
wt switch main
npm run build  # Ensure main has a built cache
wt switch feature-auth
wt step main  # Now it can copy
```

### Git Object Corruption After Forced Cleanup

**Problem:** You forcefully deleted worktrees or `git` operations fail with object corruption.

**Solution:** Verify and repair the repository:

```bash
git fsck --full
git gc --aggressive
```

### Hooks Not Running

**Problem:** Registered hooks don't execute.

**Diagnosis:** Check hook configuration:

```bash
wt config | grep hook
```

**Fix:** Ensure the hook script is executable:

```bash
chmod +x /path/to/hook.sh
wt hook onCreate /path/to/hook.sh
```

### Deadlock Between Worktrees (Rare)

**Problem:** Two worktrees cannot both acquire locks (usually due to shared resources).

**Solution:** Serialize access or use a lock file:

```bash
cat > ~/.worktrunk/hooks/sharedResourceLock.sh << 'EOF'
#!/bin/bash
LOCK_FILE="/tmp/build-lock"
(
    flock 9 || exit 1
    # Do work here
    npm run build
) 9>"$LOCK_FILE"
EOF
```

### Performance Degradation with Many Worktrees

**Problem:** Git operations slow down as you create more worktrees.

**Solution:** Regularly prune and run garbage collection:

```bash
git worktree prune
git gc --aggressive
```

For very large repositories, consider using `git sparse-checkout` to reduce the working tree size:

```bash
git sparse-checkout init --cone
git sparse-checkout set src/  # Only check out src/
```

### Worktrunk Configuration Lost After Upgrade

**Problem:** After installing a new Worktrunk version, your config is gone.

**Solution:** Backup your config:

```bash
cp ~/.worktrunk/config ~/.worktrunk/config.backup
```

Worktrunk should preserve configuration across upgrades. If not, restore from backup and report the issue.

---

## 8. References

- **Worktrunk Official Docs:** [worktrunk.dev](https://worktrunk.dev/worktrunk/)
- **Worktrunk GitHub Repository:** [github.com/max-sixty/worktrunk](https://github.com/max-sixty/worktrunk)
- **Git Worktree Official Documentation:** [git-scm.com/docs/git-worktree](https://git-scm.com/docs/git-worktree)
- **Git Internals — Plumbing and Porcelain:** [git-scm.com/book/en/v2/Git-Internals](https://git-scm.com/book/en/v2/Git-Internals)
- **Parallel Development Patterns:** [git-scm.com/book/en/v2/Git-Branching-Branching-Workflows](https://git-scm.com/book/en/v2/Git-Branching-Branching-Workflows)
- **CI/CD Best Practices:** [github.blog/2019-12-16-community-driven-development-with-github-actions/](https://github.blog/2019-12-16-community-driven-development-with-github-actions/)
- **Claude Code and AI Agents:** [anthropic.com/claude-code](https://www.anthropic.com/claude-code)

---

## Related Tutorials

- [[git-worktrees-worktrunk-beginner-guide|Git Worktrees and Worktrunk: Beginner's Guide]] — Start here if you are new to worktrees
- [[claude-code-vscode-go-beginner-guide|Claude Code]] — AI coding agent popular for parallel Worktrunk workflows
- [[git-fundamentals|Git Fundamentals]] — Core concepts for understanding branching and merging
- [[advanced-git-workflows|Advanced Git Workflows]] — Rebase, cherry-pick, and complex merge strategies

---

## 9. Summary

**Key takeaways:**

- **Worktrees share `.git`** but maintain separate index, HEAD, and per-worktree refs. This isolation is crucial for parallel development.
- **Worktrunk configuration** allows you to customize paths, enable auto-fetch/sync, and register hooks for automation.
- **Hooks** (`onCreate`, `preMerge`, `postMerge`) let you automate dependency installation, linting, testing, and build cache sharing.
- **Parallel AI agents** are a killer use case — create one worktree per agent, launch each with a task description, and merge independently after completion.
- **Merge strategies** — squashing, rebasing, interactive rebase — help maintain clean commit history.
- **CI/CD integration** allows you to automatically test and merge worktrees in automated workflows.
- **Git internals** — understanding `.git/worktrees/`, detached HEAD, and locking mechanisms — helps you debug complex scenarios.
- **At scale** (10+ worktrees), coordinate task assignment, use dependency-order merging, and monitor progress with `wt list --full`.

**Production readiness:**

- Always keep `main` (or production branch) in a stable, releasable state.
- Use pre-merge hooks to enforce linting and test passage.
- Coordinate which files each agent modifies to avoid conflicts.
- Prune and garbage-collect regularly to maintain Git performance.
- Back up your Worktrunk configuration.

**Next steps:**

- Implement hooks for your specific project (dependency install, linting, testing).
- Set up custom path templates for your team.
- Run a small pilot (2–3 parallel agents) to validate the workflow.
- Scale to full team parallelization once the workflow is stable.
- Integrate with your CI/CD pipeline for automated testing and merging.
# Related Tutorials
- [[sesh-beginner-guide|Sesh Beginner Guide]] — Manage tmux sessions per worktree with sesh
- [[sesh-deep-dive|Sesh Deep Dive]] — Advanced sesh + worktree integration patterns
- [[dotfiles-beginner-guide|Dotfiles Beginner Guide]] — Version control your git and terminal configs
- [[dotfiles-deep-dive|Dotfiles Deep Dive]] — Cross-platform dotfile management with templates

- [[gh-cli-beginner-guide|GitHub CLI Beginner Guide]] — create and manage PRs directly from the terminal
- [[gh-cli-deep-dive|GitHub CLI Deep Dive]] — stacked PRs and advanced GitHub workflows with worktrees

- [[maestri-beginner-guide|Maestri Beginner Guide]] — Maestri's Floors are conceptually similar to git worktrees, providing isolated workspace copies backed by branches
- [[maestri-deep-dive|Maestri Deep Dive]] — Advanced Floor management with git branch isolation and copy-on-write clones

- [[tmux-claude-code-beginner-guide|Tmux + Claude Code Beginner Guide]] — tmux + Claude Code fundamentals
- [[tmux-claude-code-deep-dive|Tmux + Claude Code Deep Dive]] — Parallel Claude Code agents with git worktrees + tmux
