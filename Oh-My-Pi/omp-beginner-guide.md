---
title: "Oh My Pi (omp): Beginner's Guide to the Terminal AI Coding Agent"
date: 2026-06-16
difficulty: beginner
tags: [coding-agent, terminal, claude, anthropic, ollama, vllm, openai-compatible]
---

# Oh My Pi (omp): Beginner's Guide to the Terminal AI Coding Agent

## Overview

**oh-my-pi** (command: `omp`) is a terminal-based AI coding agent written by can1357 (Can Bölük), forked from pi-mono by Mario Zechner. It runs in your terminal, connects to one or more AI providers, and helps you read, edit, debug, and reason about code — without leaving the command line.

The project lives at [https://github.com/can1357/oh-my-pi](https://github.com/can1357/oh-my-pi) with a landing page at [https://omp.sh](https://omp.sh).

omp is provider-agnostic. The same binary can talk to Anthropic's Claude, a local Ollama model, a remote vLLM server, or any OpenAI-compatible endpoint. You configure which model handles which role (everyday work, fast cheap tasks, deep debugging, commit messages) in a YAML file.

**Distinguishing technical characteristics:**

- **Hashline edits** — lines in files are shown to the model with a short content-hash anchor; edits reference hashes rather than reproducing exact text, eliminating most "string not found" failures
- **Time-Traveling Stream Rules (TTSR)** — rules applied retroactively to already-streamed content
- **First-class subagents** — parallel, isolated agent processes with their own git worktrees
- **LSP/DAP integration** — 14 LSP operations and 28 DAP operations baked in (diagnostics, go-to-definition, rename, breakpoints, etc.)
- **Autonomous memory** — background extraction from past sessions, injected automatically at session start

The engine is a native Rust library (~7,500 lines, exposed via N-API). The frontend is Bun/TypeScript. The result is a fast binary that ships 40+ providers, 32 built-in tools, and 14 LSP operations out of the box.

This guide is aimed at developers who are comfortable with Linux, Python, git, and SSH but have not used a terminal AI coding agent before.

---

## Prerequisites

- A Unix-like system (macOS or Linux). Windows is partially supported via Windows Terminal.
- **Bun >= 1.3.7** installed (`bun --version`), OR curl available for the installer script, OR mise installed
- At least one AI provider credential:
  - An `ANTHROPIC_API_KEY` from [console.anthropic.com](https://console.anthropic.com) to use Claude models, OR
  - A locally running [Ollama](https://ollama.com) instance, OR
  - A vLLM server you can reach
- A compatible terminal emulator (see Terminal Requirements below)
- git (for subagent worktree features)

---

## Key Concepts

### Hashline Edits

When omp reads a file, each line is annotated with a short content-hash. When the model needs to edit line 42, it writes something like `Line 42:f1 replace` rather than reproducing the original text. This has two effects:

1. Whitespace reproduction errors and ambiguous matches disappear — the model is referencing a hash, not guessing at exact characters.
2. If the file was modified between the read and the edit, the hashes won't match and the edit is rejected before any corruption occurs.

In published benchmarks, Grok Code Fast 1 went from a 6.7% success rate to 68.3% with hashline edits enabled. Grok 4 Fast output token usage dropped 61%. These are meaningful improvements for cost and reliability.

### Model Roles

omp routes tasks to different models by **role**. You define five roles in `config.yml`:

| Role | Purpose | Typical mapping |
|------|---------|-----------------|
| `default` | Everyday coding work | Claude Sonnet (fast, capable) |
| `smol` | Cheap, fast subtasks | Small local model via Ollama |
| `slow` | Deep debugging, hard problems | Claude Opus with extended thinking |
| `plan` | Architecture and planning | Claude Opus |
| `commit` | Writing commit messages | Small local model or Haiku |

You configure these once and then forget about them. omp picks the right model automatically based on what it is doing.

### Providers vs. Models

A **provider** is an API endpoint with a specific protocol (Anthropic native, OpenAI Completions, OpenAI Responses). A **model** is a specific model served by that provider. You can define multiple providers in `models.yml` and reference their models in `config.yml` roles.

### Sessions and Memory

Each conversation is a **session**, stored as a JSONL file under `~/.omp/agent/sessions/`. You can navigate session history with `/tree`, branch a session with `/branch`, or fork it with `/fork`. **Autonomous memory** extracts facts from past sessions in the background and injects relevant context at the start of new ones — you do not manage this manually.

---

## Step-by-Step Instructions

### 1. Install omp

Pick one method:

**Option A — Bun (recommended if Bun is already installed):**

```bash
bun install -g @oh-my-pi/pi-coding-agent
```

Verify:

```bash
omp --version
```

**Option B — Installer script (no Bun required):**

```bash
curl -fsSL https://omp.sh/install.sh | sh
```

The installer defaults to a pre-built binary. Pass `--source` to compile from source. Set `PI_INSTALL_DIR` to change the install location.

**Option C — mise:**

```bash
mise use -g github:can1357/oh-my-pi
```

**Option D — Manual:** Download a release binary from [GitHub Releases](https://github.com/can1357/oh-my-pi/releases), place it on your PATH, and `chmod +x` it.

### 2. Configure Your Terminal

omp requires the **Kitty keyboard protocol** for full keyboard support. Check your terminal:

| Terminal | Status | What to do |
|----------|--------|------------|
| iTerm2 | Works | Nothing |
| Kitty | Works | Nothing |
| Ghostty | Needs config | Add two keybind lines (see Ghostty docs) |
| WezTerm | Needs config | Add a Lua config snippet |
| Windows Terminal | Limited | Keyboard shortcuts may not all work |

If you are on macOS Apple Silicon, iTerm2 with the Bun-installed binary is the simplest path.

### 3. First Launch

```bash
omp
```

The first run shows a welcome screen with recent sessions and tips. No API key is needed just to open the UI, but you will need one before omp can call a model.

Set the Anthropic key in your shell environment:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Then launch `omp` in any project directory and type a question. Alternatively, use `/login` inside omp to authenticate via Claude Pro/Max OAuth without exposing an API key to the environment.

### 4. Configure Providers (The Centerpiece)

Configuration lives in two files:

- `~/.omp/agent/models.yml` — provider registry
- `~/.omp/agent/config.yml` — global settings including model role assignments

#### Provider A: Anthropic (built-in, simplest)

No `models.yml` entry required. Set the env var and configure roles in `config.yml`:

```yaml
# ~/.omp/agent/config.yml
models:
  default: anthropic/claude-sonnet-4-5
  plan: anthropic/claude-opus-4-5
  slow: anthropic/claude-opus-4-5
  commit: anthropic/claude-haiku-3-5
  smol: anthropic/claude-haiku-3-5
```

#### Provider B: Ollama (local models)

Pull the model first:

```bash
ollama pull qwen2.5-coder:14b
```

Expected output:

```
pulling manifest
pulling 6f7e540a3b56... 100% ▕████████████████▏ 8.1 GB
verifying sha256 digest
writing manifest
success
```

Then add the provider to `models.yml`:

```yaml
# ~/.omp/agent/models.yml
providers:
  ollama:
    baseUrl: http://localhost:11434/v1
    api: openai-completions
    apiKey: OLLAMA_API_KEY
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

Key detail: Ollama uses `api: openai-completions`. The cost fields being zero is intentional — `omp stats` uses them for cost tracking, and local inference has no token cost.

Now assign the Ollama model to cheap roles in `config.yml`:

```yaml
# ~/.omp/agent/config.yml
models:
  default: anthropic/claude-sonnet-4-5
  plan: anthropic/claude-opus-4-5
  slow: anthropic/claude-opus-4-5
  smol: ollama/qwen2.5-coder:14b
  commit: ollama/qwen2.5-coder:14b
```

This setup routes everyday coding to Claude Sonnet, deep work to Claude Opus, and cheap tasks (commit messages, quick lookups) to the free local model.

#### Provider C: vLLM (remote GPU server)

A typical setup: vLLM runs on a remote GPU machine, and you forward the port over SSH:

```bash
ssh -L 8000:localhost:8000 user@gpu-server
```

Then add the provider to `models.yml`:

```yaml
# ~/.omp/agent/models.yml
providers:
  vllm:
    baseUrl: http://127.0.0.1:8000
    api: openai-responses
    apiKey: VLLM_API_KEY
    models:
      - id: meta-llama/Llama-3.1-70B-Instruct
        name: Llama 3.1 70B (vLLM)
        reasoning: false
        input: [text]
        cost:
          input: 0
          output: 0
          cacheRead: 0
          cacheWrite: 0
        contextWindow: 131072
        maxTokens: 8192
```

**Critical difference from Ollama:** vLLM uses `api: openai-responses`, not `openai-completions`. Mixing these up is a common footgun — the two API shapes are different and the wrong one will error or produce garbled output without an obvious error message.

Match `contextWindow` and `maxTokens` to what your vLLM deployment is configured with (the `--max-model-len` flag passed to `vllm serve`).

You can now assign the vLLM model to any role in `config.yml`:

```yaml
models:
  default: vllm/meta-llama/Llama-3.1-70B-Instruct
  smol: ollama/qwen2.5-coder:14b
  commit: ollama/qwen2.5-coder:14b
  plan: anthropic/claude-opus-4-5
  slow: anthropic/claude-opus-4-5
```

### 5. Project-Local Configuration

Drop a `.omp/` directory at the root of a project for per-project settings:

```
.omp/
├── settings.json       # override config.yml keys for this project
├── SYSTEM.md           # project-specific system prompt
├── commands/           # custom slash commands
├── skills/             # SKILL.md skill files (same format as Claude Code)
├── hooks/              # event hooks
├── tools/              # custom tool definitions
├── agents/             # custom subagent definitions
└── modules/            # JS/TS modules loaded at startup
```

omp skills use the same `SKILL.md` format as Claude Code, so existing Claude Code skills can be dropped in without modification.

---

## Practical Examples

### Example 1: Ask a question about your codebase

```bash
cd ~/projects/my-api
omp
```

Inside omp:

```
> What does the auth middleware do?
```

omp reads relevant files, uses LSP to resolve imports and types if a language server is running, and gives you a grounded answer with file references.

### Example 2: Fix a bug with plan mode

```
> /plan
> There's a race condition in the job queue. Fix it.
```

omp generates a plan and waits for your approval before making any edits. Review the plan, then press Enter to execute.

### Example 3: Agentic commit

```bash
omp commit
```

omp stages changes at the hunk level, writes a conventional commit message using the `commit` model role, and shows you the result before committing. You can split a large diff into multiple focused commits.

### Example 4: Run a subagent for parallel work

Inside omp:

```
> /agent explore -- find all places where we call the external billing API
```

The `explore` subagent runs in an isolated process with its own git worktree, does the investigation, and reports back without polluting your main session context. Six subagents are bundled: `explore`, `plan`, `designer`, `reviewer`, `task`, and `quick_task`.

---

## Hands-On Exercises

**Exercise 1: Verify your install and Anthropic connection**

```bash
export ANTHROPIC_API_KEY=sk-ant-...
omp
```

Type `Hello, what model are you?` and confirm you get a response. This proves the binary is installed, the key is valid, and the default provider is working.

**Exercise 2: Set up Ollama for free local commits**

1. Install Ollama from [ollama.com](https://ollama.com)
2. `ollama pull qwen2.5-coder:14b`
3. Add the Ollama provider block to `~/.omp/agent/models.yml` as shown above
4. Set `commit: ollama/qwen2.5-coder:14b` in `config.yml`
5. In a git repo with staged changes, run `omp commit` and watch it use the local model

**Exercise 3: Explore session history**

After a few conversations, inside omp:

```
> /tree
```

Navigate to a past session and continue it, or use `/branch` to create a new branch from a past state.

**Exercise 4: Add a project system prompt**

In a project directory:

```bash
mkdir -p .omp
cat > .omp/SYSTEM.md << 'EOF'
This is a Django REST Framework API. All new endpoints must include OpenAPI docstrings.
Always check for N+1 query issues when touching ORM code.
EOF
```

Start omp in that directory and ask it to add an endpoint. The project rules are injected automatically.

---

## Troubleshooting

**`omp: command not found` after Bun install**

Bun's global bin directory may not be on your PATH. Add it:

```bash
export PATH="$HOME/.bun/bin:$PATH"
```

Add this line to your `.zshrc` or `.bashrc` so it persists.

**Keyboard shortcuts not working**

Your terminal does not support the Kitty keyboard protocol. Switch to iTerm2 or Kitty, or apply the configuration snippet for Ghostty/WezTerm from the omp documentation at [https://omp.sh](https://omp.sh).

**Ollama edits are garbled or erroring**

Confirm you used `api: openai-completions` (not `openai-responses`) in your Ollama provider block. Also confirm the model is pulled and running: `ollama list`.

**vLLM connection refused**

The SSH tunnel may have dropped. Re-establish it:

```bash
ssh -L 8000:localhost:8000 user@gpu-server
```

Also confirm `contextWindow` in your `models.yml` entry matches the `--max-model-len` value your vLLM server was started with. A mismatch causes silent truncation or context overflow errors.

**Hashes not matching / edit rejected**

The file was modified between when omp read it and when it tried to write the edit. This is the hashline system working correctly — it prevented a potentially corrupt edit. Ask omp to re-read the file and retry the edit.

**`omp stats` shows zero cost for local models**

This is expected behavior. The cost fields in `models.yml` for Ollama and vLLM are set to zero, so cost tracking reflects actual spend (nothing) for local inference. Only Anthropic API calls show nonzero cost in `omp stats`.

---

## Related Tutorials

- [[omp-deep-dive|Oh My Pi Deep Dive]] — advanced configuration, custom tools, hook system, and subagent design
- [[autoresearch-beginner-guide|Autoresearch Beginner Guide]] — another AI-assisted research tool for the terminal
- [[hpc-ai-tech-stack]] — running AI workloads on HPC clusters, relevant if you are deploying vLLM on SLURM or Flux nodes
- [[slurm-vs-flux-reference]] — scheduler comparison for HPC environments where you might host vLLM backends
- [[CONFIG_MANAGERS]] — tooling for managing dotfiles and configs across machines, including omp config files
- [[ideas-research-analysis]] — broader notes on AI-assisted research workflows

---

## References

- GitHub repository: [https://github.com/can1357/oh-my-pi](https://github.com/can1357/oh-my-pi)
- Landing page and installer: [https://omp.sh](https://omp.sh)
- Ollama: [https://ollama.com](https://ollama.com)
- vLLM documentation: [https://docs.vllm.ai](https://docs.vllm.ai)
- Bun: [https://bun.sh](https://bun.sh)
- mise: [https://mise.jdx.dev](https://mise.jdx.dev)

---

## Summary

omp is a terminal AI coding agent that runs against any OpenAI-compatible provider. Its main technical differentiators are hashline edits (hash-anchored line references that eliminate most edit failures), LSP/DAP integration (IDE-grade diagnostics and debugger support in the terminal), first-class subagents with git worktree isolation, and autonomous memory.

Getting started requires three things: installing the binary (Bun or curl installer), configuring at least one provider in `~/.omp/agent/models.yml` and `config.yml`, and running `omp` in a project directory. The three provider patterns covered here — Anthropic for capable cloud models, Ollama for free local inference, and vLLM for self-hosted GPU inference — cover the most common setups.

The critical thing to remember when mixing Ollama and vLLM is the API protocol difference: `openai-completions` for Ollama, `openai-responses` for vLLM. Getting this wrong is the most common configuration mistake.

For HPC or research environments where you are already running GPU jobs on SLURM or Flux, vLLM over an SSH tunnel is a practical way to get omp talking to a model you control without sending data to a third party. See [[hpc-ai-tech-stack]] for context on that infrastructure.
