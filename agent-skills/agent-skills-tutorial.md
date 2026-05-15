# Agent Skills — Hands-On Tutorial

> A walkthrough of [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) from install to shipping a real feature, plus my take on where the system falls short and how I'd improve it.
>
> For the short reference, see [agent-skills-guide.md](./agent-skills-guide.md).

---

## Table of Contents

1. [What You're Installing And Why](#1-what-youre-installing-and-why)
2. [Installation](#2-installation)
3. [Verify It's Working](#3-verify-its-working)
4. [Tutorial: Ship A Feature End-To-End](#4-tutorial-ship-a-feature-end-to-end)
5. [Tutorial: Fix A Bug With The Prove-It Pattern](#5-tutorial-fix-a-bug-with-the-prove-it-pattern)
6. [Tutorial: Use A Specialist Persona For Review](#6-tutorial-use-a-specialist-persona-for-review)
7. [Daily Workflow Recipes](#7-daily-workflow-recipes)
8. [Integration With Your Existing Agent OS Setup](#8-integration-with-your-existing-agent-os-setup)
9. [How I'd Improve Agent Skills](#9-how-id-improve-agent-skills)
10. [Appendix: The Files That Actually Matter](#10-appendix-the-files-that-actually-matter)

---

## 1. What You're Installing And Why

Agent Skills is a **Claude Code plugin** — a directory of Markdown files Claude loads into its context. Each file (a "skill") encodes a step-by-step engineering workflow: write the spec first, do TDD properly, do a five-axis review, define a rollback plan before shipping.

The reason these exist: AI coding agents default to the shortest path. Left alone, Claude will happily skip specs, skip tests, skip review, and ship. Skills inject the discipline a senior engineer would bring — with one crucial twist: every skill includes an **anti-rationalization table** that pre-writes rebuttals to the excuses an agent uses to skip steps. "I'll add tests later" has a documented counter. That's the real innovation.

**What you get:**

- 20 skills covering the full software lifecycle
- 7 slash commands (`/spec`, `/plan`, `/build`, `/test`, `/review`, `/code-simplify`, `/ship`)
- 3 specialist agent personas (code-reviewer, test-engineer, security-auditor)
- 4 reference checklists (testing, security, performance, accessibility)
- A `SessionStart` hook that loads the discovery flowchart on every session

**What you don't get:**

- Any runtime or framework — it's pure Markdown
- Any language or stack lock-in
- Any magic — Claude still has to follow the instructions

---

## 2. Installation

### Option A — Marketplace (recommended)

```
/plugin marketplace add addyosmani/agent-skills
/plugin install agent-skills@addy-agent-skills
```

If you hit SSH errors (the marketplace clones via SSH), add an SSH key to GitHub or rewrite remotes:

```bash
git config --global url."https://github.com/".insteadOf "git@github.com:"
```

### Option B — Local clone (dev/offline)

```bash
git clone https://github.com/addyosmani/agent-skills.git ~/owl/ai/claude/agent-skills
claude --plugin-dir ~/owl/ai/claude/agent-skills
```

### Option C — Manual, no plugin

If you don't want to install the plugin at all, just `@`-reference a skill when you need it:

```
Follow @~/owl/ai/claude/agent-skills/skills/test-driven-development/SKILL.md
for this change.
```

This is useful when you only want the discipline on a specific task and not across every session.

---

## 3. Verify It's Working

Start a new Claude Code session in any project. If the plugin loaded correctly, the session-start hook will inject the `using-agent-skills` meta-skill into context. You can confirm with:

> "What skills are currently loaded?"

Claude should respond with the discovery flowchart from `skills/using-agent-skills/SKILL.md`. You can also test a slash command:

```
/spec
```

Claude should begin asking clarifying questions (objective, users, features, tech stack, boundaries) rather than diving into code. If it dives into code, the plugin isn't loaded.

---

## 4. Tutorial: Ship A Feature End-To-End

Let's walk through building a hypothetical feature — "add rate limiting to the public API" — using the full lifecycle. This is the canonical happy path and the one I'd recommend learning first.

### Step 1 — `/spec`

```
/spec add rate limiting to our public API endpoints
```

Claude enters the `spec-driven-development` skill. It will ask clarifying questions:

1. **Objective and users** — who hits this API, what's the threat model?
2. **Core features** — per-IP? per-key? global? sliding window or token bucket?
3. **Tech stack constraints** — Redis? in-memory? a library or roll-your-own?
4. **Boundaries** — what's always allowed, what needs confirmation, what's off-limits?

The output is a `SPEC.md` in the project root with six sections: objective, commands, project structure, code style, testing strategy, and boundaries. **Review it.** This is the single highest-leverage moment in the whole workflow — fixing a misunderstanding here costs minutes; fixing it at `/ship` costs a day.

### Step 2 — `/plan`

```
/plan
```

Claude enters `planning-and-task-breakdown` in **plan mode** (read-only, no code changes). It reads `SPEC.md` and the relevant codebase, then:

1. Builds a dependency graph of components
2. Slices work **vertically** (one complete feature path per task, not horizontal layers like "do all the models first")
3. Writes each task with acceptance criteria and verification steps
4. Adds checkpoints between phases
5. Saves to `tasks/plan.md` and a checklist to `tasks/todo.md`

Vertical slicing is the critical part. A horizontal plan ("write all the models, then all the controllers") means nothing is demoable until the end. A vertical plan ("rate-limit one endpoint end-to-end, then the next") means every task produces running code.

### Step 3 — `/build` (loop)

```
/build
```

Claude picks the next unchecked task from `tasks/todo.md` and enters the RED → GREEN → refactor → commit loop:

1. Read the task's acceptance criteria
2. Load relevant context (existing code, types, patterns)
3. Write a **failing test** for the expected behavior (RED)
4. Implement the minimum code to pass (GREEN)
5. Run the full test suite (regression check)
6. Run the build (compilation check)
7. Commit with a descriptive message
8. Mark the task complete

Run `/build` repeatedly until `tasks/todo.md` is empty. If a step fails, the skill triggers `debugging-and-error-recovery` (reproduce → localize → reduce → fix → guard).

### Step 4 — `/review`

Before merging, run:

```
/review
```

This invokes `code-review-and-quality` for a five-axis review of your staged changes:

1. **Correctness** — matches spec? edge cases? test coverage?
2. **Readability** — clear names? straightforward logic?
3. **Architecture** — follows existing patterns? right abstractions?
4. **Security** — delegates to `security-and-hardening` (input validation, secrets, auth)
5. **Performance** — delegates to `performance-optimization` (N+1, unbounded ops)

Findings are categorized as **Critical**, **Important**, or **Suggestion**, each with file:line references. Fix the Criticals at minimum before proceeding.

### Step 5 — `/ship`

```
/ship
```

This runs `shipping-and-launch`, a pre-launch checklist:

- **Code quality** — tests pass, build clean, lint clean, no TODOs or `console.log`s
- **Security** — `npm audit` clean, no hardcoded secrets, auth in place, headers set
- **Performance** — Core Web Vitals good, no N+1, bundles sized
- **Accessibility** — keyboard nav, screen reader, contrast
- **Infrastructure** — env vars, migrations, monitoring
- **Documentation** — README current, ADRs written, changelog updated

Critically, `/ship` also forces you to **define the rollback plan before proceeding**. Not after. Before. This is one of the most valuable habits the plugin enforces.

---

## 5. Tutorial: Fix A Bug With The Prove-It Pattern

Bugs don't need the full lifecycle. The minimum viable path is:

### Step 1 — Reproduce with a failing test

```
/test reproduce this bug: clicking "save" twice creates duplicate records
```

Claude invokes `test-driven-development` in Prove-It mode:

1. Write a test that reproduces the bug (it **must fail**)
2. Confirm the test fails (without this confirmation the test is worthless — it might pass for the wrong reason)
3. Implement the fix
4. Confirm the test now passes
5. Run the full suite to catch regressions

The "must fail first" step is the Prove-It pattern. A bug-fix test that never failed is proving nothing.

### Step 2 — Review

```
/review
```

### Step 3 — Ship (if urgent) or merge normally

For a hotfix, `/ship` with a tight scope. For a routine fix, a normal merge is fine.

**Why this is powerful:** before the Prove-It pattern, a typical AI bug fix would "fix" the symptom without a regression test. Six months later the bug comes back. The Prove-It pattern kills that failure mode.

---

## 6. Tutorial: Use A Specialist Persona For Review

Sometimes you want a narrower, deeper review than `/review` gives. Personas live in `agents/`:

```
Load the security-auditor persona from
@~/owl/ai/claude/agent-skills/agents/security-auditor.md
and review the diff for the new auth middleware.
```

Claude adopts the persona — narrower scope, stronger opinions, OWASP-aware. Use the specialist personas for:

- **code-reviewer** — diffs you feel uncertain about
- **test-engineer** — "is my coverage actually good or am I fooling myself?"
- **security-auditor** — auth, data handling, input parsing, third-party integrations

---

## 7. Daily Workflow Recipes

Copy-pasteable patterns for common situations.

### Recipe 1 — Greenfield feature

```
/spec
/plan
/build   (repeat until tasks/todo.md is empty)
/review
/ship
```

### Recipe 2 — Bug fix

```
/test    (Prove-It pattern — failing test first)
/review
```

### Recipe 3 — Legacy cleanup / simplification

```
/code-simplify
/review
```

Important: `/code-simplify` preserves exact behavior. It's not a rewrite — it's deep-nesting cleanup, guard clauses, better names, dead-code removal. Run the tests after every change.

### Recipe 4 — Security-sensitive PR

```
/review
# then, for a second opinion:
Load the security-auditor persona and re-review the diff.
```

### Recipe 5 — "I have a vague idea"

```
Load @~/owl/ai/claude/agent-skills/skills/idea-refine/SKILL.md
and help me think through this: [your idea]
```

Then once clarified, drop into Recipe 1.

### Recipe 6 — Performance regression

```
Load performance-optimization skill and the performance-checklist reference.
Measure first, then optimize.
```

The "measure first" rule is not negotiable in this skill. It will refuse to optimize on vibes.

---

## 8. Integration With Your Existing Agent OS Setup

You already have [Agent OS](https://buildermethods.com/agent-os) wired up globally via `~/.claude/CLAUDE.md` → `~/.agent-os/`. Agent Skills overlaps significantly. Here's the honest comparison:

| Agent OS (yours)   | Agent Skills                    | Overlap                       |
|---|---|---|
| `/plan-product`    | `/spec` (partially)             | Both define what to build     |
| `/create-spec`     | `/spec` + `/plan`               | Strong overlap                |
| `/execute-tasks`   | `/build`                        | Strong overlap                |
| `/analyze-product` | — (no equivalent)               | Agent OS unique               |
| —                  | `/review`                       | Agent Skills unique           |
| —                  | `/ship`                         | Agent Skills unique           |
| —                  | `/code-simplify`                | Agent Skills unique           |
| —                  | `security-and-hardening`        | Agent Skills unique           |
| —                  | `debugging-and-error-recovery`  | Agent Skills unique           |

**My recommendation:**

1. **Don't auto-activate both plugins globally.** They'll collide on `/spec`-style commands and confuse task breakdown.
2. **Keep Agent OS as your global default.** It's more tailored to you (project mission, roadmap, decision log, your tech stack defaults).
3. **Install Agent Skills per-project** only in repos where you want the heavier lifecycle discipline.
4. **Cherry-pick the skills Agent OS doesn't cover** for use via `@`-reference:
   - `code-review-and-quality` — the five-axis review
   - `security-and-hardening` — no Agent OS equivalent
   - `debugging-and-error-recovery` — the five-step triage
   - `shipping-and-launch` — pre-launch checklist and rollback
   - `code-simplification` — Chesterton's Fence and behavior preservation

Those five skills are the highest-leverage additions that don't fight Agent OS.

---

## 9. How I'd Improve Agent Skills

The plugin is genuinely good and the anti-rationalization tables are a real innovation. But it has rough edges. Here's what I'd change, ordered roughly by impact:

### 9.1 — Ship a telemetry/self-audit mode

**Problem:** There's no way to measure whether skills are actually being followed. Claude might "invoke" `test-driven-development` and still skip the failing-test step. The whole system depends on Claude's willingness to follow process, and you find out whether it did only by reading the diff.

**Fix:** Add a `/audit` command (or a post-task hook) that takes the last N commits and checks them against skill exit criteria. Did every feature commit have a test? Did bug-fix commits include a regression test that failed on the parent commit? This turns the skills from aspirational into verifiable.

### 9.2 — Decouple `/spec` from tool-invented file layouts

**Problem:** `/spec` writes `SPEC.md`, `/plan` writes `tasks/plan.md` and `tasks/todo.md`. These are opinionated paths that conflict with Agent OS's `.agent-os/product/` structure, with Linear-backed workflows, and with any team that stores specs elsewhere. The docs acknowledge this ("treat them as living documents... delete before merge") but that's a workaround, not a design.

**Fix:** Make the target configurable per-project via a `.agent-skills.json` or plugin settings — `spec_path`, `plan_path`, `tasks_path`. Default to the current behavior but let it resolve to `docs/`, `specs/`, or a Linear URL hook.

### 9.3 — Skills are too big to selectively load

**Problem:** Several skills are 500+ lines. Loading all 20 at session start would blow context. The plugin punts this to "progressive disclosure" but the actual mechanism — which skill gets loaded and when — depends entirely on Claude's judgment.

**Fix:** Split each skill into `SKILL.md` (the trigger/process/verification — ~50 lines) and `REFERENCE.md` (examples, anti-patterns, deep detail). Only load the REFERENCE when the skill is actively running. The repo already does this with the top-level `references/` directory, but it's inconsistently applied.

### 9.4 — No built-in way to add custom anti-rationalizations

**Problem:** Every team has local excuses that aren't in the stock tables. "We don't test this file because it's mocked out in CI" might be right or wrong depending on context. The stock skills don't know.

**Fix:** Support a project-level `.agent-skills/overrides/<skill>.md` that gets merged into the base skill at load time. Teams can encode their local anti-patterns without forking the plugin.

### 9.5 — The `SessionStart` hook is all-or-nothing

**Problem:** The hook injects the meta-skill into every session, even throwaway ones where you just want to ask Claude to rename a variable. It's noisy for non-engineering work.

**Fix:** Make the hook context-aware — check for a `.agent-skills` marker file in the project root, or skip injection in directories without a git repo / tracked source files. Alternatively, a `/skills on|off` toggle command for the current session.

### 9.6 — No feedback loop from failures

**Problem:** When a skill's process produces a bad outcome ("I followed `/ship` and we still rolled back"), there's no structured place to capture the lesson. The skills are static Markdown maintained by one person.

**Fix:** A `/postmortem` command that takes a failure description, identifies which skill's verification was insufficient, and proposes a concrete addition to that skill's Red Flags or Verification section. Even if the fix lives only in your fork, you're building a local corpus of lessons.

### 9.7 — Missing skill: "inherit and modify"

**Problem:** There's no skill for the most common real-world task: "this code was written by someone else (or three months ago by you), and now you need to understand it before changing it." `source-driven-development` covers framework docs, but not internal code archaeology.

**Fix:** Add a `code-archaeology` skill: read call sites before edits, trace lifecycle of data through the system, check git blame for "why did this change," look for tests as specifications. This is bread-and-butter senior engineering and it's missing.

### 9.8 — `/ship`'s rollback requirement is weak

**Problem:** The rollback plan requirement is in the skill but there's no verification that the plan is actually executable. "Rollback plan: revert the commit" is a sentence, not a plan.

**Fix:** Require the rollback plan to answer three specific questions: (1) What's the exact command? (2) What data will be lost? (3) How will you know it worked? Reject vague answers.

### 9.9 — No cross-session memory

**Problem:** If I ran `/spec` yesterday and `/plan` today, Claude has no persistent link between the two except what's in `SPEC.md` and `tasks/plan.md`. When I run `/build`, it re-derives context from scratch.

**Fix:** Use Claude Code's native memory system to persist skill state across sessions — "I'm currently on task 3 of plan.md, context loaded, last commit was X." This is an obvious win given Claude Code already has a file-based memory system.

### 9.10 — The anti-rationalization tables are hidden at the bottom

**Problem:** The tables are the most valuable part of each skill but they're at the bottom of the SKILL.md. By the time Claude (or a human reviewer) reads that far, the excuse has already been made.

**Fix:** Either surface them earlier in the file, or have the skill's opening section explicitly say "before you start, re-read the rationalization table." It's a prompt-engineering detail that would meaningfully change behavior.

---

## 10. Appendix: The Files That Actually Matter

If you're going to read only a few files in the repo, read these:

| File | Why |
|---|---|
| `README.md` | The pitch and the skill matrix |
| `skills/using-agent-skills/SKILL.md` | The discovery flowchart + the six core operating behaviors |
| `skills/spec-driven-development/SKILL.md` | The single most impactful skill |
| `skills/test-driven-development/SKILL.md` | The Prove-It pattern |
| `skills/code-review-and-quality/SKILL.md` | The five-axis review |
| `skills/shipping-and-launch/SKILL.md` | The pre-launch checklist and rollback requirement |
| `agents/code-reviewer.md` | The staff-engineer review persona |
| `references/security-checklist.md` | Pulls in value even if you ignore the rest |
| `.claude/commands/*.md` | One-file-per-command, 10-20 lines each — the fastest way to see exactly what each slash command does |
| `hooks/session-start.sh` | Shows how the meta-skill gets injected; useful if you're building your own plugin |

Read those ten and you'll have 80% of the system in your head.

---

## Related

- Quick reference: [agent-skills-guide.md](./agent-skills-guide.md)
- Source: https://github.com/addyosmani/agent-skills
- Related: Agent OS at `~/.agent-os/` (your existing setup)
