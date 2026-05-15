---
title: "GitHub CLI (gh) — Deep Dive Reference"
date: 2026-05-03
difficulty: advanced
tags: [github, cli, git, terminal, macos, linux, automation, scripting, api, extensions]
---

# GitHub CLI (gh) — Deep Dive Reference

## Overview

GitHub CLI (`gh`) is far more than a convenience wrapper around the GitHub website. At its core, it's a fully scriptable interface to the GitHub REST and GraphQL APIs, an extensible platform with a plugin ecosystem, and a powerful automation tool for CI/CD pipelines, release management, and cross-repository workflows.

**What this reference covers:**
- Internal architecture and configuration system
- Advanced authentication (multiple accounts, tokens, SSH)
- Scripting and automation patterns
- The `gh api` command for direct REST/GraphQL access
- Extensions ecosystem and building custom extensions
- Integration with CI/CD, [[just-deep-dive|Just]], and shell scripting
- Performance tuning and advanced configuration
- Cross-platform considerations (macOS Apple Silicon vs Rocky Linux 8)

## Prerequisites

- Completion of [[gh-cli-beginner-guide|GitHub CLI Beginner Guide]] or equivalent familiarity
- Comfortable with shell scripting (bash/zsh)
- Understanding of Git branching and remotes (see [[git-worktrees-worktrunk-deep-dive|Git Worktrees & Worktrunk Deep Dive]])
- Familiarity with REST APIs and JSON
- `jq` installed for JSON processing (`brew install jq` / `sudo dnf install jq`)

## Key Concepts

### Architecture

`gh` is written in Go and operates as a thin client over GitHub's APIs. Key architectural points:

- **Config storage:** `~/.config/gh/` contains `config.yml` (preferences) and `hosts.yml` (auth tokens)
- **Auth tokens:** Stored in the system keyring (macOS Keychain / Linux `secret-tool`) or plaintext in `hosts.yml` if no keyring is available
- **Protocol negotiation:** `gh` can use HTTPS (OAuth token) or SSH for Git operations — configurable per-host
- **Extension runtime:** Extensions are standalone executables that `gh` discovers by naming convention (`gh-<name>`)

### Token Scopes

Understanding scopes is critical for automation:

| Scope | Grants Access To |
|-------|-----------------|
| `repo` | Full control of private repositories |
| `read:org` | Read org membership |
| `workflow` | Update GitHub Actions workflows |
| `gist` | Create and manage gists |
| `admin:public_key` | Manage SSH keys |
| `project` | Manage GitHub Projects (v2) |

Refresh scopes without full re-auth:
```bash
gh auth refresh -s workflow,project,admin:public_key
```

### Configuration Hierarchy

`gh` resolves configuration in this order:
1. Command-line flags (highest priority)
2. Environment variables (`GH_TOKEN`, `GH_HOST`, `GH_REPO`, etc.)
3. Per-repo `.gh-resolved-repository` file
4. User config `~/.config/gh/config.yml`
5. Defaults (lowest priority)

## Step-by-Step Instructions

### Advanced Authentication Patterns

#### Multiple GitHub Accounts

If you work with both personal and enterprise GitHub:

```bash
# Login to GitHub.com
gh auth login --hostname github.com

# Login to GitHub Enterprise Server
gh auth login --hostname github.mycompany.com
```

Switch active account:
```bash
gh auth switch --hostname github.com --user personal-account
```

List all authenticated accounts:
```bash
gh auth status
```

#### Non-Interactive Token Authentication (for CI/scripts)

```bash
# Using environment variable (preferred for CI)
export GH_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
gh repo list

# Or pipe a token in
echo "ghp_xxxxxxxxxxxxxxxxxxxx" | gh auth login --with-token
```

#### SSH Protocol Setup

```bash
gh config set git_protocol ssh --host github.com
gh ssh-key add ~/.ssh/id_ed25519.pub --title "My MacBook"
```

### The `gh api` Command — Direct API Access

This is the most powerful feature of `gh`. It gives you authenticated access to any GitHub API endpoint.

#### REST API

```bash
# Get your user profile
gh api user

# Get repo details as JSON
gh api repos/owner/repo

# List releases with pagination
gh api repos/owner/repo/releases --paginate

# Create a label (POST)
gh api repos/owner/repo/labels -f name="priority:high" -f color="FF0000"

# Delete a branch (DELETE)
gh api repos/owner/repo/git/refs/heads/old-branch -X DELETE
```

#### GraphQL API

```bash
# Query with inline GraphQL
gh api graphql -f query='
  query {
    viewer {
      login
      repositories(first: 10, orderBy: {field: UPDATED_AT, direction: DESC}) {
        nodes {
          nameWithOwner
          updatedAt
        }
      }
    }
  }
'
```

#### JSON Filtering with `--jq`

`gh` has built-in `jq` support — no need to pipe:

```bash
# Get just PR titles
gh pr list --json title --jq '.[].title'

# Get PR numbers and authors
gh pr list --json number,author --jq '.[] | "\(.number) by \(.author.login)"'

# Complex filtering: PRs with failing checks
gh pr list --json number,statusCheckRollup --jq '
  .[] | select(.statusCheckRollup[]?.conclusion == "FAILURE") | .number
'
```

#### Template Output with `--template`

Go templates for custom formatting:

```bash
gh pr list --json number,title,author --template \
  '{{range .}}PR #{{.number}}: {{.title}} ({{.author.login}}){{"\n"}}{{end}}'
```

### Scripting and Automation

#### Non-Interactive Mode

For scripts, always prevent interactive prompts:

```bash
# Use --yes to auto-confirm
gh pr merge 42 --squash --delete-branch --yes

# Provide all required data via flags
gh pr create --title "Auto PR" --body "Generated" --base main --head feature
```

#### Batch Operations

```bash
# Close all PRs by a bot user
gh pr list --author "dependabot[bot]" --json number --jq '.[].number' | \
  xargs -I {} gh pr close {}

# Label all open issues matching a search
gh issue list --search "bug" --json number --jq '.[].number' | \
  xargs -I {} gh issue edit {} --add-label "type:bug"

# Bulk-merge all approved PRs
gh pr list --json number,reviewDecision \
  --jq '.[] | select(.reviewDecision == "APPROVED") | .number' | \
  xargs -I {} gh pr merge {} --squash --yes
```

#### Shell Script Integration

```bash
#!/usr/bin/env bash
# deploy.sh — Create a release from the current branch

set -euo pipefail

VERSION=$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.1.0")
NEXT_VERSION=$(echo "$VERSION" | awk -F. '{$NF = $NF + 1;}1' OFS=.)

echo "Creating release $NEXT_VERSION..."

# Create a tag
git tag "$NEXT_VERSION"
git push origin "$NEXT_VERSION"

# Create GitHub release with auto-generated notes
gh release create "$NEXT_VERSION" \
  --generate-notes \
  --title "Release $NEXT_VERSION" \
  --latest

echo "✓ Released $NEXT_VERSION"
echo "  $(gh release view "$NEXT_VERSION" --json url --jq .url)"
```

#### Integration with Just

Create a [[just-deep-dive|Justfile]] that wraps `gh` commands for your project:

```just
# Justfile for project workflow

# Create a PR for the current branch
pr title *ARGS:
    gh pr create --title "{{title}}" {{ARGS}}

# Merge current branch's PR
merge:
    gh pr merge --squash --delete-branch --yes

# Show CI status for current PR
ci:
    gh pr checks

# Create a new release
release version:
    git tag v{{version}}
    git push origin v{{version}}
    gh release create v{{version}} --generate-notes --latest

# List my open PRs across all repos
my-prs:
    gh search prs --author=@me --state=open --json repository,title,url \
      --jq '.[] | "[\(.repository.nameWithOwner)] \(.title)\n  \(.url)"'
```

### Extensions

Extensions expand `gh`'s capabilities. They're standalone executables that follow the `gh-<name>` convention.

#### Discovering and Installing Extensions

```bash
# Search for extensions
gh extension search dashboard
gh extension search "code review"

# Install an extension
gh extension install dlvhdr/gh-dash
gh extension install mislav/gh-branch-stale

# List installed extensions
gh extension list

# Upgrade all extensions
gh extension upgrade --all
```

#### Recommended Extensions

| Extension | Purpose |
|-----------|---------|
| `dlvhdr/gh-dash` | Terminal dashboard for PRs and issues |
| `mislav/gh-branch-stale` | Find and delete stale branches |
| `vilmibm/gh-user-status` | Set your GitHub status |
| `seachicken/gh-poi` | Clean up local branches after PR merge |
| `yusukebe/gh-markdown-preview` | Preview markdown locally |

#### Building a Custom Extension

```bash
# Scaffold a new extension (Go-based)
gh extension create my-tool
cd gh-my-tool

# Or create a simple shell-based extension
gh extension create --precompiled=false my-script
```

A minimal shell extension (`gh-my-script`):

```bash
#!/usr/bin/env bash
# gh-my-script: List repos with open dependabot PRs

set -euo pipefail

echo "Repos with pending Dependabot PRs:"
gh search prs --author="dependabot[bot]" --state=open --owner=@me \
  --json repository --jq '[.[].repository.nameWithOwner] | unique | .[]'
```

### Advanced PR Workflows

#### PR Templates and Defaults

```bash
# Create PR using a template
gh pr create --template .github/PULL_REQUEST_TEMPLATE/feature.md

# Create draft PR
gh pr create --draft --title "WIP: new feature"

# Create PR and request reviewers
gh pr create --title "Feature X" --reviewer user1,user2 --label "enhancement"
```

#### Working with Stacked PRs (Worktree Integration)

When using [[git-worktrees-worktrunk-deep-dive|git worktrees]] for parallel development:

```bash
# In worktree 1: base feature
gh pr create --title "Base: add user model" --base main

# In worktree 2: dependent feature (stacked PR)
gh pr create --title "Feature: user auth" --base feature/add-user-model
```

#### Code Review from the Terminal

```bash
# View a PR's diff
gh pr diff 42

# Review with comments
gh pr review 42 --comment --body "LGTM overall, one nit on line 34"

# Approve
gh pr review 42 --approve

# Request changes
gh pr review 42 --request-changes --body "Need error handling in the retry loop"
```

### Release Management

```bash
# Create release with binary assets
gh release create v1.0.0 ./dist/*.tar.gz ./dist/*.zip \
  --title "v1.0.0 — First Stable Release" \
  --notes-file CHANGELOG.md

# Create pre-release
gh release create v2.0.0-rc1 --prerelease --generate-notes

# Edit an existing release
gh release edit v1.0.0 --draft=false

# Download release assets
gh release download v1.0.0 --pattern "*.tar.gz" --dir ./downloads
```

### GitHub Actions Integration

```bash
# List workflows
gh workflow list

# Trigger a workflow manually
gh workflow run deploy.yml --ref main -f environment=staging

# View workflow run logs
gh run view 12345 --log

# Re-run failed jobs only
gh run rerun 12345 --failed

# Download run artifacts
gh run download 12345 --name build-output
```

### Working with GitHub Codespaces

```bash
# Create a codespace for the current repo
gh codespace create

# List your codespaces
gh codespace list

# SSH into a codespace
gh codespace ssh

# Forward ports from codespace
gh codespace ports forward 3000:3000
```

## Practical Examples

### Example 1: Automated Release Script with Changelog

```bash
#!/usr/bin/env bash
set -euo pipefail

# Generate changelog from merged PRs since last release
LAST_TAG=$(gh release view --json tagName --jq .tagName 2>/dev/null || echo "")
if [[ -n "$LAST_TAG" ]]; then
  CHANGELOG=$(gh pr list --state merged --search "merged:>=$(gh release view "$LAST_TAG" --json createdAt --jq .createdAt)" \
    --json title,number,author \
    --jq '.[] | "- \(.title) (#\(.number)) @\(.author.login)"')
else
  CHANGELOG="Initial release"
fi

echo "$CHANGELOG"
```

### Example 2: Cross-Repo Issue Sync

```bash
#!/usr/bin/env bash
# Sync issues between repos (e.g., public tracker → private implementation)

SOURCE_REPO="org/public-tracker"
TARGET_REPO="org/private-impl"

gh issue list --repo "$SOURCE_REPO" --label "accepted" --json title,body,number --jq '.[]' | \
  while IFS= read -r issue; do
    TITLE=$(echo "$issue" | jq -r .title)
    BODY=$(echo "$issue" | jq -r .body)
    NUM=$(echo "$issue" | jq -r .number)
    gh issue create --repo "$TARGET_REPO" \
      --title "$TITLE" \
      --body "Synced from $SOURCE_REPO#$NUM\n\n$BODY"
  done
```

### Example 3: PR Dashboard in Terminal

```bash
# Save as a gh alias
gh alias set my-dashboard '!gh search prs --author=@me --state=open --json repository,title,url,updatedAt --template "{{range .}}{{timeago .updatedAt}} | {{.repository.nameWithOwner}} | {{.title}}{{\"\\n\"}}{{end}}"'

# Now use it
gh my-dashboard
```

### Example 4: Repository Health Check

```bash
#!/usr/bin/env bash
# Check multiple repos for stale PRs and issues

REPOS=("org/repo1" "org/repo2" "org/repo3")

for repo in "${REPOS[@]}"; do
  echo "=== $repo ==="
  STALE_PRS=$(gh pr list --repo "$repo" --json updatedAt --jq '[.[] | select(now - (.updatedAt | fromdateiso8601) > 604800)] | length')
  OPEN_ISSUES=$(gh issue list --repo "$repo" --json number --jq 'length')
  echo "  Stale PRs (>7 days): $STALE_PRS"
  echo "  Open issues: $OPEN_ISSUES"
done
```

## Hands-On Exercises

**Exercise 1: API Exploration**
Use `gh api` to fetch all repos in your account, filter to those updated in the last 30 days, and output their names and last-push dates using `--jq`.

**Exercise 2: Custom Alias**
Create a `gh` alias called `cleanup` that lists merged branches, shows them to you, and (after confirmation) deletes them both locally and on the remote.

**Exercise 3: Extension Development**
Build a simple shell-based extension called `gh-todo` that lists all issues assigned to you across all your repos, sorted by repository.

**Exercise 4: CI/CD Integration**
Write a script that watches the current PR's CI checks, and once all pass, auto-merges with squash. Handle the case where checks fail by printing the failed check names.

**Exercise 5: Release Automation**
Create a [[just-deep-dive|Justfile]] recipe that bumps the version in a `VERSION` file, creates a git tag, pushes it, and creates a GitHub release with auto-generated notes — all in one command.

## Troubleshooting

**"error connecting to xxx.xxx: tls: failed to verify certificate"**
- Common on corporate networks with SSL inspection. Set: `gh config set http_unix_socket ""` and ensure your corporate CA is in the system trust store.

**"gh: Not in a git repository"**
- Many commands require you to be inside a repo. Use `--repo owner/name` flag to specify one explicitly.

**"API rate limit exceeded"**
- Authenticated requests get 5,000/hour. Check remaining: `gh api rate_limit --jq '.rate.remaining'`
- For heavy scripts, add delays: `sleep 1` between API calls.
- Use GraphQL to batch queries instead of multiple REST calls.

**Extensions not found after install**
- Ensure `~/.local/share/gh/extensions` (or equivalent) is in PATH.
- Run `gh extension list` to verify installation.
- Try `gh extension upgrade <name>` to repair.

**Token not working in CI (GitHub Actions)**
- Don't use `gh auth login` in CI. Instead: `export GH_TOKEN=${{ secrets.GITHUB_TOKEN }}`
- The built-in `GITHUB_TOKEN` has limited scope — for cross-repo operations, create a PAT or GitHub App token.

**"gh pr create" fails with "a]pull request already exists"**
- You already have an open PR from this branch. Use `gh pr view` to see it, or `gh pr edit` to update it.

**Rocky Linux 8 specific: "gh: error: no such command 'codespace'"**
- Older `gh` versions may not have all subcommands. Upgrade: `sudo dnf update gh`

**Performance on large repos**
- Use `--limit` flags to cap results: `gh issue list --limit 20`
- Use `--json` with specific fields instead of fetching everything
- Cache results in scripts: pipe to a temp file and reuse within the same run

## References

- [GitHub CLI Official Manual](https://cli.github.com/manual/) — comprehensive command reference
- [GitHub CLI Source Code](https://github.com/cli/cli) — Go source, extension examples
- [GitHub REST API Documentation](https://docs.github.com/en/rest) — all available endpoints
- [GitHub GraphQL API Explorer](https://docs.github.com/en/graphql/overview/explorer) — interactive query builder
- [gh Extensions Registry](https://github.com/topics/gh-extension) — community extensions
- [GitHub CLI in CI/CD](https://docs.github.com/en/actions/using-workflows/using-github-cli-in-workflows) — Actions integration guide

## Related Tutorials

- [[gh-cli-beginner-guide|GitHub CLI Beginner Guide]] — fundamentals and first-time setup
- [[git-worktrees-worktrunk-deep-dive|Git Worktrees & Worktrunk Deep Dive]] — parallel development with stacked PRs
- [[git-worktrees-worktrunk-beginner-guide|Git Worktrees & Worktrunk Beginner Guide]] — worktree fundamentals
- [[worktrunk-deep-dive|Worktrunk Deep Dive]] — trunk-based development tool
- [[dotfiles-deep-dive|Dotfiles Deep Dive]] — managing shell config and `gh` aliases across machines
- [[claude-code-vscode-go-deep-dive|Claude Code VSCode Go Deep Dive]] — AI development workflows with GitHub
- [[honeymux-deep-dive|Honeymux Deep Dive]] — terminal multiplexing for multi-repo work
- [[just-deep-dive|Just Deep Dive]] — advanced task automation wrapping `gh` commands
- [[docker-test-container-deep-dive|Docker Test Container Deep Dive]] — containerized testing with CLI tools
- [[linux-permissions-deep-dive|Linux Permissions Deep Dive]] — understanding file access on Linux servers
- [[mosh-deep-dive|Mosh Deep Dive]] — persistent remote sessions for server-side `gh` usage

## Summary

**Key takeaways:**
- `gh api` is the power feature — it gives you authenticated, scriptable access to every GitHub API endpoint with built-in `jq` and Go template support
- Extensions make `gh` infinitely customizable — install community tools or build your own
- For automation, always use `--json` + `--jq` output mode and provide all inputs via flags (no interactive prompts)
- Environment variables (`GH_TOKEN`, `GH_REPO`, `GH_HOST`) are the key to CI/CD integration
- Combine `gh` with [[just-deep-dive|Just]] for project-specific command automation
- Use GraphQL over REST for complex queries to stay within rate limits

**Next steps:**
- Build a `gh` alias set tailored to your workflow and store it in your [[dotfiles-deep-dive|dotfiles]]
- Explore `gh-dash` for a terminal dashboard experience
- Set up `gh` in your CI pipelines for automated releases and PR management
- Consider building a custom extension for any repetitive cross-repo task
# Related Tutorials

- [[pet-beginner-guide|Pet Beginner Guide]] — CLI snippet manager that syncs via GitHub Gist
- [[pet-deep-dive|Pet Deep Dive]] — advanced Gist sync, GitHub Enterprise Gist, and token management
