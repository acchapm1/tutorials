---
title: "Oh My Pi (omp) — Deep-Dive Reference"
date: 2026-06-16
difficulty: advanced
source_urls:
  - https://github.com/can1357/oh-my-pi
  - https://omp.sh
tags:
  - coding-agent
  - terminal
  - claude
  - anthropic
  - ollama
  - vllm
  - openai-compatible
  - hpc
  - slurm
  - lsp
  - hashline
  - subagents
---

oh-my-pi (**omp**) is a terminal AI coding agent built on a native Rust engine (~55k lines) with a Bun/TypeScript frontend, forked from pi-mono by Mario Zechner and extended by can1357 (Can Bölük) into a full-featured, provider-agnostic development environment. It supports 40+ LLM providers, 32 built-in tools, LSP/DAP integration, worktree-isolated subagents, and an autonomous memory system — capabilities that distinguish it sharply from single-provider agents like Claude Code or Codex CLI. This document is a peer-level reference covering installation, the full configuration model (including Anthropic, Ollama, and vLLM via SSH tunnel), the core feature set, extensibility primitives, and a practical pattern for running vLLM on a Slurm/HPC cluster. It assumes you are comfortable with the terminal, YAML/TypeScript config, and basic HPC concepts; it does not hand-hold on prerequisites. See [[omp-beginner-guide|Oh My Pi Beginner Guide]] for an introductory treatment.

---

## Table of Contents

1. [Orientation and Lineage](#1-orientation-and-lineage)
2. [Installation and First Run](#2-installation-and-first-run)
3. [Configuration](#3-configuration)
4. [Core Features Tour](#4-core-features-tour)
5. [Customization](#5-customization)
6. [HPC and Slurm Integration](#6-hpc-and-slurm-integration)

---

## 1. Orientation and Lineage

### 1.1 Where omp comes from

**pi-mono** (by Mario Zechner / badlogic) was a lightweight terminal coding agent, primarily chat-based. omp forked it and added the following capabilities that are not in pi-mono:

- **Hashline edits** — content-hash-anchored line-level diffs (see §4.1)
- **TTSR** (Time Traveling Streamed Rules) — zero-cost rules injected mid-stream
- **Subagent isolation** — worktree, fuse-overlay, fuse-projfs backends
- **LSP/DAP integration** — 14 LSP operations, 28 DAP operations
- **Autonomous memory** — per-project background memory extraction
- **Sessions tree** — JSONL branching session history
- **40+ providers** — any OpenAI-compatible endpoint plus native Anthropic/Google
- **Skills/hooks/tools extensibility** — TypeScript extension points
- **MCP support** — stdio and HTTP transports
- **Rust engine** — N-API native module for performance (~7,500 lines of N-API glue, ~55k lines Rust core)

### 1.2 Comparison with peer agents

| Feature | omp | Claude Code | Codex CLI | Aider |
|---|---|---|---|---|
| Provider coverage | 40+ (any OpenAI-compat) | Anthropic only | OpenAI only | 10+ |
| Edit mechanism | Hashline (hash-anchored) | str_replace | str_replace | Unified diff |
| Subagent model | Worktree/fuse-overlay isolation | Subagents (basic) | None | None |
| LSP integration | 14 operations | None | None | None |
| DAP (debugger) | 28 operations | None | None | None |
| Extensibility | skills, hooks, tools, MCP, custom agents | skills, MCP, hooks | minimal | plugins |
| Runtime | Bun + Rust | Node.js | Node.js | Python |
| Autonomous memory | Yes (per-project) | No | No | No |
| TTSR | Yes | No | No | No |

### 1.3 When to reach for omp specifically

- You need to mix providers in one session (local Ollama + cloud Anthropic + cluster vLLM)
- You want LSP-grade accuracy in refactoring (definition, rename, code actions from the editor LSP)
- You are working with non-Anthropic LLMs
- You want worktree-isolated subagents that do not touch your working tree until you merge
- You have existing Claude Code skills you want to reuse without rewriting them
- You want a debugger-attached coding agent (DAP)

See also: [[autoresearch-deep-dive|Autoresearch Deep Dive]] and [[autoresearch-beginner-guide|Autoresearch Beginner Guide]] for a related agent with different design goals.

---

## 2. Installation and First Run

### 2.1 Prerequisites

- **Bun >= 1.3.7** (for the Bun install path)
- A terminal that supports the **Kitty keyboard protocol** (see §2.3)
- An LLM provider credential (API key, OAuth token, or local server URL)

### 2.2 Install methods

Three supported paths:

**Path 1 — Bun (recommended if Bun is already installed):**

```bash
bun install -g @oh-my-pi/pi-coding-agent
```

This is the cleanest path on Apple Silicon Mac if you already have Bun.

**Path 2 — Installer script:**

```bash
# macOS / Linux
curl -fsSL https://omp.sh/install.sh | sh

# Windows (PowerShell)
irm https://omp.sh/install.ps1 | iex
```

Installer flags:

| Flag | Effect |
|---|---|
| `--source` | Build from source (requires Rust toolchain) |
| `--binary` | Download pre-built binary (default) |
| `--ref <tag>` | Pin to a specific release tag |
| `PI_INSTALL_DIR=/path` | Override install directory |

**Path 3 — mise:**

```bash
mise use -g github:can1357/oh-my-pi
```

**Path 4 — Manual binary download:**

Download from https://github.com/can1357/oh-my-pi/releases. Extract and place the binary on your `PATH`.

### 2.3 Terminal keyboard protocol requirement

omp requires the **Kitty keyboard protocol** for extended key events. Without it, key combos like `Alt+Shift+P` or `Ctrl+J` will not work correctly.

| Terminal | Status | Action required |
|---|---|---|
| iTerm2 | Works out of the box | None |
| Kitty | Works out of the box | None |
| Ghostty | Needs config | See below |
| WezTerm | Needs config | See below |
| Windows Terminal | Limited support | Some key combos won't work |

**Ghostty** — add to your Ghostty config:

```
keybind = ctrl+j=text:\x0a
keybind = ctrl+shift+j=text:\x0a
```

**WezTerm** — add to `wezterm.lua`:

```lua
config.enable_kitty_keyboard = true
config.send_composed_key_when_left_alt_is_pressed = true
```

### 2.4 First run

```bash
omp
# Opens TUI: welcome screen, recent sessions, quick-start tips
```

To verify against Anthropic in headless mode:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
omp -p "what is 2+2"
```

### 2.5 TUI anatomy

The TUI has three primary zones:

- **Editor area** — multi-line input with `@file` autocomplete and `!cmd` bash passthrough
- **Conversation/output pane** — streamed model output, tool call results, diffs
- **Powerline footer** — current model, cwd, git branch, token count, context %

Press `?` to display the full keyboard shortcut reference. The **Todo panel** appears on the right when omp is tracking tasks.

---

## 3. Configuration

### 3.1 Filesystem map

| Path | Contents |
|---|---|
| `~/.omp/agent/config.yml` | Global settings: theme, model roles, retry/fallback chains, compaction |
| `~/.omp/agent/models.yml` | Provider and model registry (ModelRegistry) |
| `~/.omp/agent/SYSTEM.md` | Global system prompt override |
| `~/.omp/agent/sessions/` | JSONL session files, grouped by cwd hash |
| `~/.omp/agent/memories/` | Autonomous memory artifacts, per-project |
| `~/.omp/agent/skills/` | Global user skills (SKILL.md format) |
| `~/.omp/agent/commands/` | Global slash commands |
| `~/.omp/agent/hooks/` | Global hooks (`pre/` and `post/` subdirs) |
| `~/.omp/agent/tools/` | Custom tools |
| `~/.omp/agent/agents/` | Custom agent definitions |
| `~/.omp/agent/themes/` | Custom themes |
| `~/.omp/agent/modules/` | IPython kernel modules |
| `~/.omp/agent/agent.db` | Credential storage (`/login` OAuth + API keys) |
| `~/.omp/logs/` | Daily-rotated debug logs |
| `.omp/` (project root) | `settings.json`, `SYSTEM.md`, `commands/`, `skills/`, `hooks/`, `tools/`, `agents/`, `modules/` |
| `AGENTS.md` or `CLAUDE.md` (project root) | Auto-discovered project instructions |

Project-local config in `.omp/` overrides global config for the scope of that project. The `AGENTS.md` / `CLAUDE.md` auto-discovery means omp picks up the same instructions that Claude Code uses — no duplication required.

### 3.2 Universal config discovery

omp reads config from the configuration directories of eight other tools automatically:

| Tool | Config path(s) read |
|---|---|
| Claude Code | `.claude/`, `~/.claude/` |
| Cursor | `.cursor/` MDC rules |
| Windsurf | Windsurf rules files |
| Cline | `.clinerules` |
| GitHub Copilot | `applyTo` glob rules |
| Gemini CLI | `system.md` |
| Codex CLI | `AGENTS.md` |
| Codex (legacy) | `.codex/` |

Run `/extensions` inside the TUI to see what was loaded and from which source. This means a `.claude/commands/` directory already populated for Claude Code will be available in omp without any duplication. **Claude Code skill cross-reuse:** skills stored in `~/.claude/skills/` or `.claude/skills/` are picked up by omp automatically (see §5.1).

### 3.3 Provider A: Anthropic

**API key (pay-per-token):**

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

**OAuth via Claude Pro/Max subscription:**

```
# In the omp TUI:
/login
# Select Anthropic → browser OAuth flow
```

When both API key and OAuth credentials exist for the same provider, the **API key takes precedence**. Anthropic is built-in — no `models.yml` entry is needed. To restrict which models surface:

```yaml
# ~/.omp/agent/config.yml
enabledModels:
  - "anthropic/*"
```

**Extended thinking:**

Use the `--thinking xhigh` flag or press `Shift+Tab` inside the TUI to cycle through thinking budgets: `low` / `medium` / `high` / `xhigh`. The `xhigh` level is Anthropic-specific extended reasoning and is ignored by other providers.

**Model role assignments (recommended starting point):**

```yaml
# ~/.omp/agent/config.yml
modelRoles:
  default: claude-sonnet-4-5
  plan: claude-opus-4
  slow: claude-opus-4
  commit: claude-haiku-4-5
  smol: claude-haiku-4-5
```

The five model roles and their purposes:

| Role | Purpose |
|---|---|
| `default` | Standard task execution |
| `plan` | Architecture and planning (routed via `/plan` or `Alt+Shift+P`) |
| `slow` | High-quality, latency-tolerant operations |
| `commit` | Commit message and changelog generation |
| `smol` | Cheap, fast subtasks (exploration, quick summaries) |

### 3.4 Provider B: Ollama (local Mac)

**Setup:**

```bash
# 1. Install from ollama.com, then:
ollama pull qwen2.5-coder:14b
# pulling manifest...
# pulling 8a9d56... ████████████████████████ 100%
# success
```

**Option 1 — /login TUI flow:**

```
/login
# Select Ollama → enter base URL: http://localhost:11434/v1
```

**Option 2 — Direct `models.yml` entry:**

```yaml
# ~/.omp/agent/models.yml
providers:
  ollama:
    baseUrl: http://localhost:11434/v1
    api: openai-completions    # NOTE: Ollama uses completions, NOT responses
    apiKey: OLLAMA_API_KEY     # env var name; omit entirely for no-auth
    models:
      - id: qwen2.5-coder:14b
        name: Qwen2.5 Coder 14B (Local)
        reasoning: false
        input: [text]
        cost:
          input: 0
          output: 0
          cacheRead: 0
          cacheWrite: 0
        contextWindow: 32000
        maxTokens: 8000
```

**Validate:**

```bash
omp --list-models | grep -i qwen
omp -p --model ollama/qwen2.5-coder:14b "what is 2+2"
```

**Role assignment** — route cheap work local:

```yaml
# ~/.omp/agent/config.yml
modelRoles:
  smol: ollama/qwen2.5-coder:14b
  commit: ollama/qwen2.5-coder:14b
  default: claude-sonnet-4-5
  plan: claude-opus-4
```

### 3.5 Provider C: vLLM (remote cluster via SSH tunnel)

**Architecture:**

```
MacBook (omp) ──SSH tunnel──> Sol login node ──> Sol compute node (vLLM :8000)
               localhost:8000                      10.x.x.x:8000
```

The SSH tunnel maps `localhost:8000` to the vLLM port on the compute node. omp talks to `http://127.0.0.1:8000` as if it were local.

**`models.yml` entry:**

```yaml
# ~/.omp/agent/models.yml
providers:
  vllm:
    baseUrl: http://127.0.0.1:8000    # local end of SSH tunnel
    api: openai-responses              # NOTE: vLLM uses responses, NOT completions
    apiKey: ${VLLM_API_KEY}           # env var so key never lives in this file
    models:
      - id: <model-id-as-served-by-vllm>    # CONFIRM: run `curl localhost:8000/v1/models`
        name: <human-name>
        reasoning: false
        input: [text]
        cost:
          input: 0
          output: 0
          cacheRead: 0
          cacheWrite: 0
        contextWindow: <match-vllm-config>   # CONFIRM: from `vllm serve --max-model-len`
        maxTokens: <match-vllm-config>
```

**SSH tunnel setup:**

```bash
# Find your compute node after the vLLM Slurm job starts
squeue -u $USER --format="%i %N %j"    # CONFIRM: Sol's squeue flags

# Basic tunnel (replace c001 with actual compute node name)
ssh -L 8000:c001:8000 -N sol.asu.edu &

# If you need a ProxyJump through a dev/login node:
ssh -L 8000:c001:8000 -N -J sol-dev.asu.edu sol.asu.edu &
# CONFIRM: Sol's ProxyCommand / dev node hostname convention
```

**Validate before opening omp:**

```bash
curl http://127.0.0.1:8000/v1/models   # confirms tunnel is live and vLLM is responding
omp --list-models | grep vllm
```

### 3.6 API protocol table

This is a common source of misconfiguration. The `api:` field in `models.yml` selects the wire protocol, not just the provider.

| `api:` value | Wire protocol | Use for |
|---|---|---|
| `anthropic-messages` | Anthropic Messages API | Anthropic, Anthropic-compatible |
| `openai-completions` | OpenAI Chat Completions (legacy) | Ollama, LM Studio, llama.cpp, most local servers |
| `openai-responses` | OpenAI Responses API (modern) | vLLM, modern OpenAI-compat with tool calling |
| `openai-codex-responses` | OpenAI Codex variant | ChatGPT Codex |
| `azure-openai-responses` | Azure OpenAI | Azure deployments |
| `google-generative-ai` | Google GenAI | Gemini |
| `google-vertex` | Google Vertex AI | Vertex Gemini |

**Why this matters:** `openai-completions` is the legacy Chat Completions shape — widely supported but with limited tool-calling guarantees. `openai-responses` is the newer Responses API shape that includes streaming tool calls and richer metadata. vLLM implements the newer shape; Ollama implements the older shape. Mixing them up produces connection errors or silently malformed tool calls — the most common first-time configuration mistake.

### 3.7 Retry and fallback chains

```yaml
# ~/.omp/agent/config.yml
retry:
  fallbackChains:
    "claude-sonnet-4-5":
      - vllm/<model-id>         # fall back to vLLM on rate-limit or error
    fallbackRevertPolicy: cooldown-expiry   # retry primary after cooldown expires
```

This is particularly useful when a Slurm job times out and the vLLM endpoint disappears — omp automatically routes back to Anthropic rather than failing.

---

## 4. Core Features Tour

### 4.1 Hashline edits

**Hashline edits** are omp's primary file-modification mechanism and its most distinctive technical contribution.

**Mechanism:** When omp reads a file, each line is tagged with a 2–3 character content hash derived from the line's actual text. The model references these anchors in its edit instructions (e.g., `Line 42:a7c replace: new content`) rather than reproducing surrounding context. The engine resolves the anchor to the current line, applies the replacement, and moves on.

**Why this matters over `str_replace` (Claude Code's approach):** `str_replace` requires the model to reproduce the exact target string including all whitespace and indentation. It fails when files have mixed indentation, when the model hallucinates a space, or when another tool (a formatter, a parallel edit) has changed nearby lines. Hashline anchors are content-derived — the hash identifies the line regardless of its position, so minor file mutations between read and write don't cause corruption.

**Why this matters over unified diff (Aider's approach):** Unified diff requires correct line numbers AND matching surrounding context. If the file shifts between read and edit, both anchors fail. Hashline anchors are position-independent.

**Published benchmark results:**

| Model | Metric | Without hashline | With hashline |
|---|---|---|---|
| Grok Code Fast 1 | Edit success rate | 6.7% | 68.3% |
| Grok 4 Fast | Output tokens | baseline | −61% |
| MiniMax | Edit success rate | baseline | 2.1× |

The gains are larger for models that are not as strong at exact string reproduction — which is most models that are not claude-sonnet or gpt-4o.

### 4.2 Plan mode

**Plan mode** routes requests through the `plan` model role before execution.

```
/plan                    # toggle plan mode on/off
Alt+Shift+P             # keyboard shortcut
```

Workflow: `/plan` → describe the task → omp generates a structured implementation plan → you review → approve → omp executes against the plan. Plan mode is per-session; it does not persist across sessions. Use it for any task where you want to verify the approach before code changes start accumulating — particularly useful for multi-file refactors.

### 4.3 Subagents

Six bundled agents:

| Agent | Role |
|---|---|
| `explore` | Read-only search and discovery |
| `plan` | Planning and architecture |
| `designer` | System design |
| `reviewer` | Code review |
| `task` | General task execution |
| `quick_task` | Fast, lightweight execution |

**Isolation backends:**

| Backend | Mechanism | Notes |
|---|---|---|
| `worktree` | Git worktree per subagent | Best for tasks that might conflict. Changes isolated until merged. |
| `fuse-overlay` | FUSE overlay filesystem | Linux only. Lightweight copy-on-write. |
| `fuse-projfs` | Windows ProjFS | Windows only. |
| `none` | No isolation | Subagents share the working tree directly. |

Up to 100 concurrent background jobs. Monitor with `/agents`. Block on a background job's result using the `await` tool.

### 4.4 LSP integration

omp integrates directly with language servers via the **Language Server Protocol**. 14 LSP operations are available to the model as first-class tools:

`diagnostics`, `definition`, `type_definition`, `implementation`, `references`, `hover`, `symbols`, `rename`, `code_actions`, `status`, `reload`, `format`, `completion`, `signature_help`

Practical implications:
- Rename is language-aware (all references updated correctly, not regex-replaced)
- Code actions surface refactoring options the language server knows about (extract method, implement interface, etc.)
- Diagnostics are checked after every edit — the model sees type errors immediately
- Format-on-write happens via the language server's formatter, not a separate tool call

40+ language server configurations are built in. Local binary resolution checks `node_modules/.bin/` and `.venv/bin/` before PATH — no PATH manipulation needed for project-local language servers.

### 4.5 DAP (debugger integration)

omp supports the **Debug Adapter Protocol** with 28 operations. The model can set breakpoints, step through execution, inspect variables, and evaluate expressions in the debugger — all from within the coding session. This is uncommon among coding agents; it enables a workflow where the model can actually run into a failure under the debugger and read the stack rather than inferring it.

### 4.6 TTSR (Time Traveling Streamed Rules)

**TTSR** (Time Traveling Streamed Rules) are rules that trigger mid-stream based on regex patterns in the model's output.

**The problem they solve:** Conventional rules must be in the system prompt on every turn. If you have 50 project-specific constraints, all 50 pay context tokens on every message — even if only 3 are relevant to this particular task.

**How TTSR works:** Rules sit in a dormant list with zero context cost. As the model streams output, omp matches the stream against each rule's `ttsrTrigger` regex. When a pattern fires (e.g., the model starts writing code that references a deprecated API), the corresponding rule is injected into context at that point in the stream. Each rule triggers at most once per session.

**Worked example:**

Say you have a rule: "Do not use the `legacyAuth()` function — it was removed in v3.0, use `authV3()` instead."

Without TTSR: this rule lives in the system prompt. Every message pays for it. If you have 30 similar rules, you pay for all 30 every turn.

With TTSR: the rule has `ttsrTrigger: "legacyAuth"`. The rule costs nothing until the model generates output containing `legacyAuth`. At that point, the rule fires, omp injects the constraint, and the model corrects course — all within the same stream. No round trip needed.

The `ttsrTrigger` field in a rule file sets the regex pattern.

### 4.7 Autonomous memory

omp extracts durable facts from past sessions in a background process and stores them per-project under `~/.omp/agent/memories/`. At session start, a compact summary of relevant memories is injected automatically — the model arrives with knowledge of past decisions, recurring issues, and project conventions without you re-explaining them.

Memory commands:

```
/memory view       # show current memory contents
/memory clear      # discard all memory for this project
/memory enqueue    # manually queue a fact for extraction
```

Access programmatically: `memory://root/MEMORY.md`

### 4.8 Sessions and branching

Sessions are stored as JSONL trees under `~/.omp/agent/sessions/`, grouped by a hash of the working directory.

```bash
omp -c             # continue most recent session
omp -r             # recover from a previous session (useful after crash)
omp --no-session   # start fresh with no history
```

In-TUI session management:

```
/tree              # navigate session tree
/branch            # branch from current session state
/fork              # fork to new session, preserving full history
```

### 4.9 Compaction

When context approaches limits, omp compacts automatically. Manual compaction:

```
/compact [focus]
```

The optional `focus` argument describes what to preserve — useful mid-task when you want to drop earlier exploration but keep the current task's context. Config knobs: `reserveTokens`, `keepRecentTokens`, `autoContinue`.

### 4.10 Python tool

A **persistent IPython kernel** (not a subprocess per call). This means variables and imports persist across tool invocations within a session.

Built-in prelude helpers available in the kernel:

| Helper | Purpose |
|---|---|
| `lines()` | Read file as line list |
| `insert_at()` | Insert lines at a position |
| `delete_lines()` | Delete by line range |
| `delete_matching()` | Delete by regex match |

The kernel shares a gateway with omp's tool system — Python code can call omp's own tools over loopback. Custom modules from `.omp/modules/` are loaded at kernel start. Rich output: Markdown, Mermaid diagrams, JSON trees.

Setup: `omp setup python`

### 4.11 Browser tool

Puppeteer with 14 stealth scripts. Selector types: CSS, `aria/`, `text/`, `xpath/`, `pierce/`. Headless/visible toggle. Reader mode via `extract_readable`. NixOS is auto-detected. Useful for web scraping, integration testing, or any task that requires browser interaction.

### 4.12 SSH tool

Project discovery via `ssh.json`. Host management: `omp ssh` CLI or `/ssh` command. Persistent connections (avoids per-command handshake overhead). Optional SSHFS mounts. Compatibility mode for Windows hosts.

### 4.13 `omp commit`

Agentic **conventional commits** with the following capabilities:
- Split commits (atomic with dependency ordering)
- Hunk-level staging
- Changelog generation
- Commit validation

```bash
omp commit --push        # commit and push
omp commit --dry-run     # show what would be committed without committing
omp commit --no-changelog
omp commit --context     # add extra context to guide commit message
omp commit --legacy      # deterministic mode (no LLM, uses conventional rules)
```

### 4.14 `/review`

Spawns dedicated reviewer subagents. Mode selection: branch comparison / uncommitted changes / commit review. Findings are structured at P0–P3 priority levels with a verdict rendered at the end.

### 4.15 `omp stats`

Local observability dashboard. Shows: request counts, cost (using `cost` fields from `models.yml`), cache rate, tokens/s per provider. Setting `cost: { input: 0, output: 0 }` for Ollama and vLLM (as shown in §3.4 and §3.5) causes stats to correctly show $0 for local inference rather than misattributing cost figures.

### 4.16 Bash passthrough

```
!cmd           # run cmd; output included in context
!!cmd          # run cmd; output NOT included (side-effect only)
```

Real-time streaming. Press `Escape` to cancel. Set `pty: true` in a tool config for `sudo` or other interactive commands that require a pseudo-terminal.

### 4.17 `@file` references

`@filename` in any prompt triggers fuzzy file search with inline content injection. Supports drag-and-drop. Image attach for formats: `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`.

---

## 5. Customization

### 5.1 Skills

Skills use the **SKILL.md format** — identical to Claude Code's skill format. This is intentional: if you have Claude Code skills, omp picks them up without any migration work.

**Discovery paths (in order):**

1. `~/.omp/agent/skills/`
2. `.omp/skills/` (project-local)
3. `~/.claude/skills/` ← Claude Code skills, auto-discovered
4. `.claude/skills/` ← Claude Code project skills, auto-discovered

The `description` field in SKILL.md drives matching — omp uses it to decide when to invoke a skill. Disable per-session: `--no-skills`. Disable globally in `config.yml`: `skills.enabled: false`.

### 5.2 Custom slash commands

**Markdown form** (simple, no code):

```markdown
---
description: Summarize a PR for standup
---
Get the diff for PR #$1 and write a 3-sentence standup update.
```

Save to `~/.omp/agent/commands/standup-pr.md`. Invoke: `/standup-pr 42`

**TypeScript form** (full programmatic control):

```typescript
// ~/.omp/agent/commands/cluster-status/index.ts
export default () => ({
  name: "cluster-status",
  description: "Show my running Slurm jobs",
  async execute(args: string[], ctx: HookCommandContext) {
    const result = await ctx.runTool("bash", { cmd: "squeue -u $USER" });
    await ctx.sendMessage(result.output);
  }
});
```

### 5.3 Hooks

TypeScript modules that intercept tool execution. Place in:
- `~/.omp/agent/hooks/pre/*.ts` — run before tool execution
- `~/.omp/agent/hooks/post/*.ts` — run after tool execution

Example — block `sudo` unless confirmed:

```typescript
// ~/.omp/agent/hooks/pre/block-sudo.ts
export default async (ctx) => {
  if (ctx.tool === "bash" && ctx.input.cmd?.includes("sudo")) {
    const confirmed = await ctx.confirm("Allow sudo command?");
    if (!confirmed) return ctx.block("sudo not permitted");
  }
};
```

### 5.4 Custom tools

Auto-discovered from `~/.omp/agent/tools/*/index.ts`. Uses TypeBox for parameter schema definition.

```typescript
// ~/.omp/agent/tools/greet/index.ts
import { Type } from "@sinclair/typebox";
export default {
  name: "greet",
  description: "Greet a person by name",
  parameters: Type.Object({ name: Type.String() }),
  execute: async ({ name }) => `Hello, ${name}!`
};
```

### 5.5 MCP servers

Config locations: `~/.omp/agent/mcp.json` (global) or `.omp/mcp.json` (project-local).

Supported transports: stdio, HTTP. OAuth supported via `clientId` and `callbackPort` fields.

Plugin management:

```bash
omp plugin install <name>
omp plugin enable <name>
omp plugin disable <name>
```

Hot-loadable from `~/.omp/plugins/`. The `disabledServers` key works at both project and user level.

### 5.6 Themes

65+ bundled themes. Auto dark/light switching: uses the Kitty terminal's mode 2031, CoreFoundation FFI on macOS, and `COLORFGBG` as a fallback. Custom themes: `~/.omp/agent/themes/mytheme.json`.

---

## 6. HPC and Slurm Integration

This section covers running a vLLM inference server on a Slurm cluster (Sol, ASU's HPC) and connecting omp to it via SSH tunnel. See also: [[slurm-vs-flux-reference]], [[slurm-vs-flux-deep-dive]], [[hpc-ai-tech-stack]], [[syft-apptainer-sbom]], [[apptainer-module14-120min-expansion-spec]].

### 6.1 Why this combination

The three-provider setup (Anthropic + Ollama + vLLM) gives you:

| Provider | Use case | Notes |
|---|---|---|
| Anthropic (cloud) | Daily driver, coding accuracy | Best quality when latency is acceptable |
| Ollama (local Mac) | Zero-cost exploration, commit messages | qwen2.5-coder for quick edits |
| vLLM (Sol cluster) | Model sovereignty, large models | Run models unavailable via API; keep cluster data on the cluster |

**Latency context (honest numbers):** Cross-country Anthropic API call ≈ 200–500ms TTFT from US. SSH-tunneled vLLM on Sol ≈ 50–100ms TTFT (assuming campus fiber and low queue depth). vLLM wins on latency for cluster-resident sessions — but only when the tunnel is stable.

### 6.2 Apptainer container for vLLM on Sol

Running vLLM inside an Apptainer container avoids module version conflicts and gives you a reproducible environment.

**Container definition file (`vllm.def`):**

```
Bootstrap: docker
From: nvidia/cuda:12.4.1-cudnn-devel-ubuntu22.04

%post
    pip install vllm==0.4.3   # CONFIRM: pin to a tested version for your CUDA/driver combo

%runscript
    exec vllm serve "$@"
```

**Build on a node with NVIDIA drivers:**

```bash
apptainer build vllm.sif vllm.def
```

Build the `.sif` once and reuse it across jobs. Store under `/scratch/$USER/` (or wherever Sol's scratch filesystem is mounted). See [[syft-apptainer-sbom]] for SBOM generation from Apptainer images.

### 6.3 sbatch template for the vLLM server

```bash
#!/bin/bash
#SBATCH --job-name=vllm-server
#SBATCH --gres=gpu:a100:1        # CONFIRM: Sol's GRES string for A100
#SBATCH --mem=64G
#SBATCH --time=08:00:00
#SBATCH --output=/scratch/$USER/vllm-%j.out
#SBATCH --partition=gpu          # CONFIRM: Sol's GPU partition name

MODEL=/scratch/$USER/models/Qwen2.5-Coder-32B   # CONFIRM: weight path
PORT=8000
API_KEY=$VLLM_API_KEY

module load apptainer

apptainer run --nv \
  --bind /scratch/$USER:/scratch/$USER \
  /scratch/$USER/vllm.sif \
  --model $MODEL \
  --port $PORT \
  --api-key $API_KEY \
  --max-model-len 32768          # CONFIRM: match contextWindow in models.yml
```

Submit and find the compute node:

```bash
sbatch vllm-server.sh

# Find the compute node once the job starts running (not pending):
squeue -u $USER -o "%i %N %j"   # CONFIRM: Sol's squeue output flags

# Set up tunnel (replace c001 with actual node name from squeue output):
ssh -L 8000:c001:8000 -N sol.asu.edu &

# Validate:
curl http://127.0.0.1:8000/v1/models
```

### 6.4 Authentication for the vLLM endpoint

Always set `--api-key` even on a "private" cluster endpoint. Other users on Sol can reach compute nodes via the internal network if they know the port — the endpoint is not firewalled between users.

Pass the key via environment variable, never hardcode it in `models.yml`:

```bash
# In your shell profile (~/.zshrc or ~/.bashrc):
export VLLM_API_KEY=$(uuidgen)    # random key, generated once, stored in profile
```

Reference it in `models.yml` as `${VLLM_API_KEY}` (see §3.5).

### 6.5 Job lifecycle and reconnect strategy

When the Slurm allocation hits its time limit, the vLLM server dies. Active omp sessions will immediately see connection errors.

**Mitigations:**

1. **Fallback chain** (recommended): configure `retry.fallbackChains` (§3.7) so omp falls back to Anthropic automatically when vLLM drops. You lose the latency benefit but don't lose your session.

2. **Short, focused sessions**: use `--no-session` for vLLM-backed sessions. If the job dies, start a fresh session against the new allocation. No orphaned session state to clean up.

3. **Workflow script** — tunnel and session in one command:

```bash
#!/bin/bash
# start-cluster-session.sh
# Usage: VLLM_JOB_ID=<jobid> ./start-cluster-session.sh

COMPUTE_NODE=$(squeue -u $USER -j $VLLM_JOB_ID -o "%N" | tail -1)   # CONFIRM: sol squeue flags
echo "Tunneling to compute node: $COMPUTE_NODE"
ssh -L 8000:${COMPUTE_NODE}:8000 -N sol.asu.edu &
TUNNEL_PID=$!
echo "Tunnel PID: $TUNNEL_PID  (kill $TUNNEL_PID when done)"

omp

# Cleanup on exit:
kill $TUNNEL_PID 2>/dev/null
```

### 6.6 Skill sketch: `pi-vllm-launch`

A skill that automates the full vLLM-on-Sol workflow could be stored at `~/.omp/agent/skills/pi-vllm-launch/SKILL.md`. It would:

1. Accept a model path and resource spec as arguments
2. Generate a customized `sbatch` script from a template
3. Submit the job via omp's bash tool
4. Poll `squeue` until a compute node is assigned
5. Establish the SSH tunnel
6. Update `.omp/settings.json` with the correct `baseUrl`
7. Validate by hitting `/v1/models`
8. Print the endpoint URL, tunnel PID, and Slurm job ID

This is a useful exercise in combining custom skills, hooks, and the bash tool. Implementation left to the reader.

### 6.7 Honest caveats

**This is not a production HPC pattern.** Interactive Slurm allocations running inference servers are convenient but come with limitations:

- **Time limits:** jobs die at wall time. Long-running coding sessions are interrupted.
- **Queue wait:** GPU allocations wait in the scheduler queue. If Sol is busy, you wait.
- **Per-user vs. shared:** per-user vLLM is straightforward. Multi-user shared vLLM on one allocation is complicated — GPU ownership, fair-share billing, and rate limiting are all unsolved at the sbatch level.

Production inference workloads belong on a dedicated service deployment (Kubernetes, a dedicated GPU partition with an API gateway, or a managed service like Together AI or Fireworks).

**Security:** You are SSH-tunneling an LLM endpoint to a workstation. Prompts sent to vLLM may contain cluster data. If you are working with export-controlled data, FERPA-protected records, or HIPAA-covered information, consult ASU's research computing security team before piping that data through any external model. See also: [[WW4_ANSIBLE_INTEGRATION]] for cluster access patterns, [[CONFIG_MANAGERS]] for credential management patterns.

**Data residency:** If Sol has export control or data classification policies, routing cluster data through Anthropic's API (via the `default` model role or the fallback chain) may be a compliance issue. Check ASU's data classification policy before mixing providers on sensitive workloads. The separation of `default: claude-sonnet-4-5` and `vllm/<model>` in your role config is only meaningful if you consciously choose which model handles which data.

---

## Quick reference: key commands

| Command | What it does |
|---|---|
| `omp` | Open TUI |
| `omp -p "..."` | Headless one-shot prompt |
| `omp -c` | Continue most recent session |
| `omp -r` | Recover from previous session |
| `omp --no-session` | Start fresh, no history |
| `omp --model <id> -p "..."` | Force a specific model |
| `omp --list-models` | List all configured models |
| `omp commit` | Agentic conventional commit |
| `omp stats` | Usage and cost dashboard |
| `omp setup python` | Initialize Python/IPython tool |
| `omp ssh` | SSH host management |
| `omp plugin install <name>` | Install an MCP plugin |
| `/plan` | Toggle plan mode |
| `/compact [focus]` | Compact context |
| `/tree` | Navigate session tree |
| `/branch` | Branch current session |
| `/fork` | Fork session with history |
| `/memory view` | View autonomous memory |
| `/memory clear` | Clear project memory |
| `/agents` | Monitor background agents |
| `/review` | Code review workflow |
| `/extensions` | Show loaded config extensions |
| `/login` | OAuth or URL-based provider login |
| `?` | Show all keyboard shortcuts |

---

*Related: [[omp-beginner-guide|Oh My Pi Beginner Guide]] · [[autoresearch-deep-dive|Autoresearch Deep Dive]] · [[autoresearch-beginner-guide|Autoresearch Beginner Guide]] · [[hpc-ai-tech-stack]] · [[slurm-vs-flux-reference]] · [[slurm-vs-flux-deep-dive]] · [[syft-apptainer-sbom]] · [[apptainer-module14-120min-expansion-spec]] · [[WW4_ANSIBLE_INTEGRATION]] · [[CONFIG_MANAGERS]] · [[ideas-research-analysis]]*
