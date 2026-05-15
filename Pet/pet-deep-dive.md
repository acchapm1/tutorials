---
title: "Pet Deep Dive: Advanced CLI Snippet Management"
date: 2026-05-15
difficulty: advanced
tags: [pet, snippet-manager, cli, shell, productivity, go, toml, gist, gitlab]
---

# Pet Deep Dive: Advanced CLI Snippet Management

## 1. Overview

Pet is a command-line snippet manager written in Go that stores commands in a TOML file and surfaces them through a fuzzy-finder interface (fzf or peco). While the basics — `pet new`, `pet search`, `pet exec` — are covered in [[pet-beginner-guide|Pet Beginner Guide]], this reference goes deeper into the architecture, advanced parameter patterns, multi-directory configurations, sync backends, shell integration techniques, and workflow automation.

This guide covers:

- The internal structure of snippet files and how Pet parses them
- Advanced parameter syntax including multi-value defaults
- Multi-directory and multi-file snippet organization
- All three sync backends: GitHub Gist, GitHub Enterprise Gist, and GitLab Snippets
- Auto-sync behavior and conflict resolution
- Advanced shell integration: inline parameter expansion, history registration, and fzf customization
- The full command reference with every flag and option
- Selector customization, output formatting, and sort ordering
- Patterns for team-shared snippet libraries
- Building automation around Pet's TOML files

---

## 2. Prerequisites

- **Pet installed and working** — see [[pet-beginner-guide|Pet Beginner Guide]] for installation
- **Familiarity with TOML syntax** — Pet's config and snippet files are TOML; understanding tables, arrays of tables, and string escaping is important
- **fzf or peco installed** — fzf is recommended; advanced fzf flags (covered here) unlock powerful search customization
- **Shell scripting basics** — Bash or Zsh function definitions, keybindings, and readline/zle concepts
- **Git and GitHub familiarity** — for Gist sync; see [[gh-cli-deep-dive|GitHub CLI Deep Dive]] for related workflows
- **A text editor you're comfortable with** — you'll be editing TOML files and shell configs directly

---

## 3. Key Concepts

### 3.1 Snippet File Format

Pet stores snippets as an array of TOML tables. Each `[[snippets]]` entry is one snippet:

```toml
[[snippets]]
  description = "Show SSL certificate expiration"
  command = "echo | openssl s_client -connect <host>:443 2>/dev/null | openssl x509 -dates -noout"
  tag = ["ssl", "network", "security"]
  output = """
notBefore=Nov  3 00:00:00 2015 GMT
notAfter=Nov 28 12:00:00 2018 GMT"""
```

**Fields:**

| Field | Type | Required | Purpose |
|---|---|---|---|
| `description` | string | yes | Human-readable label shown during search |
| `command` | string | yes | The command template, may include `<parameters>` |
| `tag` | array of strings | no | Labels for filtering with `-t` / `--tag` |
| `output` | string | no | Recorded output of the command; displayed by `pet list` but not searchable |

The `output` field is informational — Pet shows it in `pet list` output but does not use it during search or execution. It is useful for documenting what a command produces so you can confirm you have the right snippet before running it.

### 3.2 Parameter System

Parameters are the most powerful feature in Pet. They transform static snippets into reusable templates.

**Simple parameter — no default:**

```
docker exec -it <container_name> /bin/bash
```

Pet prompts for `container_name` with an empty input field.

**Parameter with a single default:**

```
ssh <user=admin>@<host> -p <port=22>
```

Pet pre-fills `admin`, blank, and `22` respectively. You can accept the defaults or type over them.

**Parameter with multiple default values:**

```
kubectl get pods -n <namespace=|_default_||_kube-system_||_monitoring_|>
```

Pet presents a selection dialog with three choices: `default`, `kube-system`, and `monitoring`. The syntax uses `|_value_|` delimiters — the underscores and pipes are the boundary markers.

**Rules and edge cases:**

- Parameter names can contain letters, numbers, underscores, and hyphens
- Default values can contain spaces and special characters: `<message=Hello World!>` works
- Default values **cannot end with a trailing space**: `<name=value >` will not parse correctly
- The same parameter name used multiple times in a command prompts only once — Pet reuses the value
- With `--raw` flag, parameters are output literally (not expanded), which is useful for inline shell expansion

### 3.3 Execution Model

When you run `pet exec`, Pet:

1. Opens the selector (fzf/peco) with all snippets
2. You pick one; Pet extracts the command string
3. Pet scans for `<parameter>` patterns
4. For each unique parameter, Pet prompts for a value (using the default if one exists)
5. Pet substitutes the values into the command
6. Pet executes the result with the configured shell command (`["sh", "-c"]` by default)

The execution shell is configurable:

```toml
[General]
  cmd = ["bash", "-c"]    # Use bash instead of sh
  # cmd = ["zsh", "-c"]   # Or zsh
```

This matters when your snippets use shell-specific syntax like Bash arrays, Zsh glob qualifiers, or process substitution.

### 3.4 Configuration Architecture

Pet uses two files:

1. **Config file** — `~/.config/pet/config.toml` (or `$XDG_CONFIG_HOME/pet/config.toml`) — controls Pet's behavior
2. **Snippet file** — path specified by `snippetfile` in the config — stores your commands

The config file has four sections:

```toml
[General]
  snippetfile = "/Users/you/.config/pet/snippet.toml"
  snippetdirs = []          # additional snippet directories
  editor = "vim"
  column = 40               # column width for list output
  selectcmd = "fzf"
  backend = "gist"           # gist, ghe, or gitlab
  sortby = "description"     # recency, -recency, description, -description, command, -command, output, -output
  cmd = ["sh", "-c"]
  color = false
  format = "[$description]: $command $tags"

[Gist]
  file_name = "pet-snippet.toml"
  access_token = ""
  gist_id = ""
  public = false
  auto_sync = false

[GHEGist]
  base_url = ""
  upload_url = ""
  file_name = "pet-snippet.toml"
  access_token = ""
  gist_id = ""
  public = false
  auto_sync = false

[GitLab]
  url = ""
  file_name = "pet-snippet.toml"
  access_token = ""
  id = ""
  visibility = "private"
  auto_sync = false
```

Both files should be included in your [[dotfiles-deep-dive|dotfiles management]] — the config for consistent behavior, and the snippet file for portability (unless you rely exclusively on Gist sync).

---

## 4. Step-by-Step Instructions

### 4.1 Setting Up Multi-Directory Snippet Organization

As your snippet collection grows, a single file becomes unwieldy. Pet supports multiple snippet directories, each scanned for all `.toml` files:

```toml
[General]
  snippetdirs = [
    "/Users/you/.config/pet/snippets/personal/",
    "/Users/you/.config/pet/snippets/work/",
    "/Users/you/team-snippets/"
  ]
```

**How it works:**

- Pet recursively finds all `.toml` files in each directory
- All snippets from all files are merged into a single searchable pool
- New snippets (from `pet new`) go into a time-stamped file in the **first** directory listed
- If `snippetfile` is also set, that file is included too
- Snippets in `snippetdirs` are **not** synced to Gist/GitLab — you manage version control manually

**Recommended directory structure:**

```
~/.config/pet/
├── config.toml
├── snippet.toml          # primary synced file
└── snippets/
    ├── personal/
    │   ├── networking.toml
    │   ├── docker.toml
    │   └── git.toml
    ├── work/
    │   ├── deploy.toml
    │   └── databases.toml
    └── shared/            # git-tracked team snippets
        └── team-standards.toml
```

This lets you keep your primary `snippet.toml` synced via Gist while organizing additional snippets by domain. The `shared/` directory could be a Git submodule or a cloned repo that the whole team contributes to.

### 4.2 Configuring GitHub Gist Sync

**Step 1 — Create an access token:**

Go to <https://github.com/settings/tokens/new>. Select only the `gist` scope. Copy the generated token.

You can manage tokens through the [[gh-cli-deep-dive|GitHub CLI]] as well.

**Step 2 — Add the token to Pet's config:**

```bash
pet configure
```

```toml
[Gist]
  file_name = "pet-snippet.toml"
  access_token = "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
  gist_id = ""
  public = false
  auto_sync = false
```

Alternatively, set the environment variable `$PET_GITHUB_ACCESS_TOKEN` instead of storing the token in the config file. This is safer if your config is version-controlled.

**Step 3 — Initial sync (upload):**

```bash
pet sync
# Expected output:
# Gist ID: 1cedddf4e06d1170bf0c5612fb31a758
# Upload success
```

**Step 4 — Save the Gist ID:**

Copy the Gist ID from the output and add it to your config:

```toml
[Gist]
  gist_id = "1cedddf4e06d1170bf0c5612fb31a758"
```

**Subsequent syncs** compare timestamps automatically:

- If local is newer → uploads to Gist
- If Gist is newer → downloads from Gist

### 4.3 Configuring GitHub Enterprise Gist Sync

For organizations using GitHub Enterprise:

```toml
[General]
  backend = "ghe"

[GHEGist]
  base_url = "https://github.example.com/api/v3/gists"
  upload_url = "https://github.example.com/api/v3/gists"
  file_name = "pet-snippet.toml"
  access_token = "your-ghe-token"
  gist_id = ""
  public = false
  auto_sync = false
```

Set the token via `$PET_GITHUB_ENTERPRISE_ACCESS_TOKEN` environment variable for security.

### 4.4 Configuring GitLab Snippets Sync

```toml
[General]
  backend = "gitlab"

[GitLab]
  url = "https://gitlab.com"       # or your self-hosted GitLab instance
  file_name = "pet-snippet.toml"
  access_token = "glpat-xxxxxxxxxxxxxxxxxxxx"
  id = ""                           # populated after first sync
  visibility = "private"            # public, internal, or private
  auto_sync = false
```

Token via environment: `$PET_GITLAB_ACCESS_TOKEN`.

Create a token at <https://gitlab.com/-/profile/personal_access_tokens> with the `api` scope.

### 4.5 Enabling Auto-Sync

Set `auto_sync = true` in the relevant backend section. With auto-sync enabled, Pet automatically syncs on every `pet new` and `pet edit`:

```bash
pet new
# Command> kubectl rollout restart deployment/<name>
# Description> Restart a Kubernetes deployment
# Getting Gist...
# Updating Gist...
# Upload success
```

This eliminates the need to remember to run `pet sync` manually. The trade-off is a slight delay on every snippet creation or edit while the network round-trip completes.

### 4.6 Advanced Shell Integration — Inline Parameter Expansion

The basic `pet-select` function pastes the resolved command at your prompt. The advanced version uses `--raw` to paste the command with literal `<parameter>` markers, then lets you tab through them using native shell editing:

**Zsh version:**

```zsh
function pet-select() {
  BUFFER=$(pet search --raw --query "$LBUFFER")
  CURSOR=$#BUFFER
  zle redisplay
}
zle -N pet-select
stty -ixon
bindkey '^s' pet-select

function _pet_move_cursor_to_next_parameter() {
    match="$(echo "$BUFFER" | perl -nle 'print $& if /<.*?>/')"
    if [ -n "$match" ]; then
      default="$(echo "$match" | perl -nle 'print $& if /(?<==).*(?=>)/')"
      match_len=${#match}
      default_len=${#default}
      parameter_offset=${#BUFFER%%$match*}

      CURSOR="$((${parameter_offset} + ${default_len}))"
      BUFFER="${BUFFER[1,$parameter_offset]}${default}${BUFFER[$parameter_offset+$match_len+1,-1]}"
    fi
}
zle -N _pet_move_cursor_to_next_parameter
bindkey '^n' _pet_move_cursor_to_next_parameter
```

**How it works:**

1. `Ctrl+S` opens Pet search with `--raw`, which preserves `<parameter>` syntax in the output
2. The command appears at your prompt with literal `<user=admin>` markers
3. `Ctrl+N` finds the next `<parameter>`, replaces it with its default value, and positions your cursor there
4. You edit the value using normal shell features (tab completion, history, etc.)
5. Press `Ctrl+N` again to jump to the next parameter

This is more ergonomic than the built-in TUI dialog because you get shell completion and editing features while filling in parameters.

**Bash version:**

```bash
function pet-select() {
  BUFFER=$(pet search --raw --query "$READLINE_LINE")
  READLINE_LINE=$BUFFER
  READLINE_POINT=${#BUFFER}
}
bind -x '"\C-x\C-r": pet-select'

function _pet_move_cursor_to_next_parameter() {
  match="$(echo "$READLINE_LINE" | perl -nle 'print $& if /<.*?>/')"
  if [ -n "$match" ]; then
    default="$(echo "$match" | perl -nle 'print $& if /(?<==).*(?=>)/')"
    match_len=${#match}
    default_len=${#default}

    pre_match=${READLINE_LINE%%$match*}
    parameter_offset=${#pre_match}

    READLINE_POINT="$((${parameter_offset} + ${default_len}))"
    READLINE_LINE="${READLINE_LINE:0:$parameter_offset}${default}${READLINE_LINE:$parameter_offset+$match_len}"
  fi
}
bind -x '"\C-n": _pet_move_cursor_to_next_parameter'
```

### 4.7 fzf Integration with Shell History

Export this block in your `.bashrc` or `.zshrc` to integrate Pet directly into fzf's Ctrl+R history search. Pressing `Alt+S` while browsing history saves the selected command as a new snippet:

```bash
export FZF_CTRL_R_OPTS="
  --reverse
  --cycle
  --info=right
  --color header:italic
  --header 'alt+s (pet new)'
  --preview 'echo {}' --preview-window down:3:hidden:wrap
  --bind '?:toggle-preview'
  --bind 'alt-s:execute(pet new --tag {2..})+abort'"
```

This workflow is powerful: browse your history → see a command worth keeping → press `Alt+S` → it becomes a permanent snippet.

### 4.8 Selector Customization

The `selectcmd` setting accepts the full command string, including flags:

```toml
[General]
  # Bottom-up layout with border
  selectcmd = "fzf --reverse --border"

  # Enable ANSI colors (used with --color flag)
  selectcmd = "fzf --ansi"

  # Custom height and preview window
  selectcmd = "fzf --height 40% --preview 'echo {}' --preview-window=right:50%:wrap"
```

Run `pet search --color` to enable colorized output matching fzf's ANSI mode.

### 4.9 Output Format Customization

Control what `pet search` displays:

```toml
[General]
  format = "[$description]: $command $tags"
```

Available variables: `$description`, `$command`, `$tags`, `$output`.

Examples:

```toml
# Minimal — just description and command
format = "$description | $command"

# Tags first for quick visual scanning
format = "$tags [$description]: $command"

# Include output preview
format = "[$description]: $command\n  → $output"
```

### 4.10 Sort Order

```toml
[General]
  sortby = "description"   # alphabetical by description
  # sortby = "-description"  # reverse alphabetical
  # sortby = "recency"       # most recently added first (default)
  # sortby = "-recency"      # oldest first
  # sortby = "command"       # alphabetical by command
  # sortby = "-command"      # reverse
  # sortby = "output"        # alphabetical by output
  # sortby = "-output"       # reverse
```

---

## 5. Practical Examples

### Example 1 — A DevOps snippet collection with parameters

```toml
[[snippets]]
  description = "SSH tunnel to remote database"
  command = "ssh -L <local_port=5432>:localhost:<remote_port=5432> <user>@<host> -N"
  tag = ["ssh", "database", "tunnel"]
  output = ""

[[snippets]]
  description = "Tail logs on remote server"
  command = "ssh <user>@<host> 'tail -f /var/log/<logfile=syslog>'"
  tag = ["ssh", "logs", "remote"]
  output = ""

[[snippets]]
  description = "Docker build and push to registry"
  command = "docker build -t <registry>/<image>:<tag=latest> . && docker push <registry>/<image>:<tag=latest>"
  tag = ["docker", "build", "registry"]
  output = ""

[[snippets]]
  description = "Kubernetes pod logs with follow"
  command = "kubectl logs -f deployment/<deploy> -n <namespace=default> --tail=<lines=100>"
  tag = ["kubernetes", "logs"]
  output = ""
```

These snippets use the [[ssh-tutorial|SSH]] tunnel pattern and Kubernetes commands with sensible defaults.

### Example 2 — Team-shared snippet file

Create a Git repository for team snippets:

```bash
mkdir -p ~/team-snippets && cd ~/team-snippets
git init
```

Create `standards.toml`:

```toml
[[snippets]]
  description = "[team] Run database migration"
  command = "cd <project_root> && ./manage.py migrate --database <db=default>"
  tag = ["team", "database", "migration"]

[[snippets]]
  description = "[team] Deploy to staging"
  command = "cd <project_root> && git push origin HEAD:staging"
  tag = ["team", "deploy", "staging"]

[[snippets]]
  description = "[team] Check service health"
  command = "curl -s https://<service>.internal.example.com/health | jq ."
  tag = ["team", "health", "monitoring"]
```

Add the directory to Pet config:

```toml
[General]
  snippetdirs = ["/Users/you/team-snippets/"]
```

Team members clone the repo and add the same `snippetdirs` entry. Updates flow through normal Git workflows.

### Example 3 — Organizing snippets by domain

```
~/.config/pet/snippets/
├── aws.toml         # AWS CLI commands
├── docker.toml      # Docker and docker-compose
├── git-advanced.toml # Complex git operations
├── k8s.toml         # Kubernetes
├── networking.toml  # curl, dig, nmap, netcat
└── postgres.toml    # psql, pg_dump, pg_restore
```

Each file contains `[[snippets]]` entries for its domain. All files are automatically discovered and merged.

### Example 4 — Recording command output for reference

```toml
[[snippets]]
  description = "List all listening ports"
  command = "lsof -i -P -n | grep LISTEN"
  tag = ["network", "ports"]
  output = """
node       12345 user   22u  IPv6 0x...  TCP *:3000 (LISTEN)
postgres   67890 user    5u  IPv4 0x...  TCP 127.0.0.1:5432 (LISTEN)
nginx      11111 root    6u  IPv6 0x...  TCP *:80 (LISTEN)"""
```

The `output` field serves as documentation — when you run `pet list`, you see what the command typically produces, helping you confirm it is the right one before executing.

### Example 5 — Automating snippet creation from scripts

Since the snippet file is plain TOML, you can append snippets programmatically:

```bash
#!/bin/bash
# add-snippet.sh — add a snippet without interactive prompts

SNIPPET_FILE="$HOME/.config/pet/snippet.toml"

cat >> "$SNIPPET_FILE" << EOF

[[snippets]]
  description = "$1"
  command = "$2"
  tag = [$(echo "$3" | sed 's/[^ ]*/"\0"/g; s/ /, /g')]
  output = ""
EOF

echo "Snippet added: $1"
```

Usage:

```bash
./add-snippet.sh "Check disk usage" "df -h | grep /dev/" "disk system"
```

This is useful for CI/CD pipelines or onboarding scripts that seed a new team member's snippet collection.

---

## 6. Hands-On Exercises

### Exercise 1 — Multi-directory setup with domain separation

1. Create three subdirectories under `~/.config/pet/snippets/`: `networking/`, `devops/`, `databases/`.
2. Add `snippetdirs` to your Pet config pointing to all three.
3. Create at least two snippets in each directory (in separate `.toml` files).
4. Run `pet search` and verify all snippets appear in a unified list.
5. Run `pet exec -t networking` and verify only networking-tagged snippets appear.

**Success criteria:** `pet list` shows snippets from all directories. Tag filtering works across directories.

### Exercise 2 — Inline parameter expansion workflow

1. Add the advanced `pet-select` and `_pet_move_cursor_to_next_parameter` functions to your shell config (Section 4.6).
2. Create a snippet with three or more parameters: `curl -X <method=GET> -H "Authorization: Bearer <token>" https://<host>/api/<endpoint>`.
3. Use `Ctrl+S` (Zsh) or `Ctrl+X Ctrl+R` (Bash) to select the snippet.
4. Use `Ctrl+N` to jump through each parameter, editing values at the prompt.
5. Execute the completed command.

**Success criteria:** Parameters are expanded one by one at the prompt with full shell editing capabilities.

### Exercise 3 — Bidirectional Gist sync across two machines

1. Set up Gist sync on machine A (create token, initial upload).
2. On machine B, install Pet, add the same Gist ID and token to the config.
3. Run `pet sync` on machine B — snippets should download.
4. Add a new snippet on machine B, run `pet sync` — it should upload.
5. Run `pet sync` on machine A — the new snippet should download.

**Success criteria:** Snippets flow in both directions based on which side is newer.

### Exercise 4 — Build a team snippet repository

1. Create a Git repository for team snippets.
2. Add at least five standardized snippets (deployment, testing, monitoring).
3. Use `[team]` prefixes in descriptions for easy identification.
4. Add the repo path to `snippetdirs` in your Pet config.
5. Have a colleague (or simulate on another machine) clone the repo and add the same config.
6. Make changes on one side, `git pull` on the other, verify Pet picks up the new snippets.

**Success criteria:** Both team members see identical team snippets. Personal snippets (in the main `snippetfile`) remain separate.

---

## 7. Troubleshooting

**Problem: Sync conflict — both local and remote were modified**
Pet uses simple timestamp comparison. If both sides changed since the last sync, Pet uses the newer one, potentially overwriting changes on the other side. Workaround: manually merge using `pet edit` and Gist's revision history. For team use cases, prefer `snippetdirs` with Git-managed repos over Gist sync.

**Problem: `snippetdirs` files are not appearing in search**
Verify the directory paths are correct and end with `/`. Check that files have the `.toml` extension. Run `pet configure` to confirm the paths. Pet only reads `.toml` files — files with other extensions are ignored.

**Problem: Special characters in commands break TOML parsing**
TOML requires escaping backslashes and quotes inside basic strings. Use literal strings (single quotes in TOML) or triple-quoted strings for complex commands:

```toml
[[snippets]]
  description = "Regex grep"
  command = '''grep -P '\d{3}-\d{4}' <file>'''
```

**Problem: Auto-sync is slow and blocking**
Auto-sync makes a network request on every `pet new` and `pet edit`. On slow connections this adds noticeable delay. Options: disable auto-sync and run `pet sync` manually when needed, or use Git-managed `snippetdirs` instead (sync is just `git pull/push`).

**Problem: `pet exec` runs in `sh` but my snippet needs Bash features**
Change the execution shell in config:

```toml
[General]
  cmd = ["bash", "-c"]
```

For snippets that need Zsh-specific features (glob qualifiers, array syntax), set `cmd = ["zsh", "-c"]`.

**Problem: fzf shows snippets in a confusing format**
Customize the `format` setting to control what fzf displays:

```toml
[General]
  format = "[$description] #$tags: $command"
```

Experiment with different layouts to find what works best with your collection size.

**Problem: Multiline commands display as single lines**
Create multiline snippets with `pet new --multiline`. In the TOML file, use triple-quoted strings:

```toml
[[snippets]]
  description = "Multi-step deploy"
  command = """
git pull origin main && \
docker build -t app:latest . && \
docker-compose up -d"""
```

---

## 8. References

- [Pet GitHub Repository](https://github.com/knqyf263/pet) — source code, issues, and releases
- [Pet README (full)](https://github.com/knqyf263/pet/blob/main/README.md) — authoritative feature documentation
- [Pet Releases](https://github.com/knqyf263/pet/releases) — binary downloads for all platforms (latest: v1.0.1)
- [TOML v1.0 Specification](https://toml.io/en/v1.0.0) — the format Pet uses for config and snippets
- [fzf](https://github.com/junegunn/fzf) — recommended selector, extensive customization options
- [peco](https://github.com/peco/peco) — alternative selector supported by Pet
- [fish-pet](https://github.com/otms61/fish-pet) — Fish shell integration for Pet
- [Pet Discussions on GitHub](https://github.com/knqyf263/pet/discussions) — community tips and command chaining examples
- [Converting Keep to Pet](https://blog.saltedbrain.org/2018/12/converting-keep-to-pet-snippets.html) — migration guide from the Keep snippet manager
- [GitHub Personal Access Tokens](https://github.com/settings/tokens) — create tokens for Gist sync
- [GitLab Personal Access Tokens](https://gitlab.com/-/profile/personal_access_tokens) — create tokens for GitLab Snippets sync

---

## Related Tutorials

- [[pet-beginner-guide|Pet Beginner Guide]] — installation, first snippets, and basic usage
- [[television-beginner-guide|Television Beginner Guide]] — another fuzzy-finder terminal tool; Pet uses fzf/peco for the same interactive search pattern
- [[television-deep-dive|Television Deep Dive]] — advanced Television channels and custom data sources
- [[dotfiles-beginner-guide|Dotfiles Beginner Guide]] — version-controlling your Pet config and snippet files
- [[dotfiles-deep-dive|Dotfiles Deep Dive]] — advanced dotfile management strategies for multi-machine setups
- [[gh-cli-beginner-guide|GitHub CLI Beginner Guide]] — working with GitHub (Gists, tokens) from the terminal
- [[gh-cli-deep-dive|GitHub CLI Deep Dive]] — advanced GitHub CLI patterns for automation
- [[ssh-tutorial|SSH Tutorial]] — SSH configuration and tunneling, frequently captured as Pet snippets
- [[ssh-config-deep-dive|SSH Config Deep Dive]] — advanced SSH config patterns
- [[sesh-beginner-guide|Sesh Beginner Guide]] — terminal session management, complementary to Pet's workflow
- [[sesh-deep-dive|Sesh Deep Dive]] — advanced session patterns

---

## 9. Summary

**Key takeaways:**

- Pet's snippet file is plain TOML — this means you can edit, script, version-control, and share it with standard text tools. No proprietary format, no database, no lock-in.
- The **parameter system** (`<name>`, `<name=default>`, `<name=|_opt1_||_opt2_|>`) is what elevates Pet from a bookmark list to a command templating system. Master the multi-value syntax for frequently-used commands with known option sets.
- **Multi-directory setups** (`snippetdirs`) are the key to scaling. Keep personal snippets in your Gist-synced primary file, domain-specific collections in organized directories, and team-shared snippets in Git repos.
- **Inline parameter expansion** (the `--raw` + `Ctrl+N` workflow) is significantly more ergonomic than the default TUI dialog for commands with many parameters, because you get shell tab-completion and editing.
- **Gist sync** is convenient for personal use, but for teams, a Git-managed `snippetdirs` repository offers proper merge conflict resolution, pull request review, and history.
- The **format** and **sortby** settings let you customize the search experience to match your collection's size and your personal scanning habits.

**Next steps:** Organize your growing collection into domain-specific files under `snippetdirs`. Set up the inline parameter expansion keybindings. If you work on a team, create a shared snippet Git repo and standardize descriptions with a `[team]` prefix. Review your shell history weekly and promote useful commands to permanent snippets — the `prev` function and fzf `Alt+S` binding make this frictionless.
