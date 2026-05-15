# Three Ways to Extend Claude: Agents Library vs. Agent Skills vs. Agent OS

> A comparison of three different approaches to giving Claude structure, expertise, and discipline:
> - [claude-agents-library](https://github.com/vibecoding/claude-agents-library) — personas
> - [agent-skills](https://github.com/addyosmani/agent-skills) — workflows
> - [Agent OS](https://buildermethods.com/agent-os) — product lifecycle

---

## TL;DR

| | **claude-agents-library** | **agent-skills** | **Agent OS** |
|---|---|---|---|
| **Unit** | Persona (`ui-designer.md`) | Skill (`SKILL.md` workflow) | Product plan + spec + task list |
| **Answers** | *"Who should Claude act as?"* | *"How should Claude do this task?"* | *"What are we building, and in what order?"* |
| **Scope** | A role | A process | A product lifecycle |
| **Format** | Markdown persona docs | Markdown workflows with anti-rationalization tables | Markdown instructions + generated `.agent-os/product/` files |
| **Invocation** | Reference agent in prompt ("acting as…") | Slash commands (`/spec`, `/build`, `/review`) + auto-loading | Slash commands (`/plan-product`, `/create-spec`, `/execute-tasks`) |
| **State** | Stateless | Stateless (loads on demand) | **Stateful** — writes `.agent-os/product/{mission,roadmap,decisions,tech-stack}.md` |
| **Inventory** | 34 personas, 7 categories | 20 skills + 7 slash commands + 3 agent personas + 4 reference checklists | 4 instruction flows (`plan-product`, `create-spec`, `execute-tasks`, `analyze-product`) + standards files |
| **Mental model** | Costume rack | Playbook binder | Operating system |
| **Best for** | "Make Claude sound like a growth hacker for this one prompt" | "Make Claude follow senior-engineer discipline on this task" | "Track a product across months and many sessions" |

They're **complementary**, not competing. You can (and probably should) use all three.

---

## 1. claude-agents-library — Personas

**Repo**: https://github.com/vibecoding/claude-agents-library
**Local**: `/Users/acchapm1/owl/ai/claude/claude-agents-library`

### What it is

A curated collection of **34 role-based personas** as Markdown files, organized into seven professional categories:

```
design/              (5)   ui-designer, ux-researcher, brand-guardian, ...
engineering/         (6)   frontend-developer, backend-architect, devops-automator, ...
marketing/           (7)   tiktok-strategist, growth-hacker, content-creator, ...
product/             (3)   trend-researcher, feedback-synthesizer, sprint-prioritizer
project-management/  (3)   experiment-tracker, project-shipper, studio-producer
studio-operations/   (5)   support-responder, analytics-reporter, finance-tracker, ...
testing/             (5)   api-tester, performance-benchmarker, tool-evaluator, ...
```

### Anatomy of an agent file

YAML frontmatter + six required sections:

```yaml
---
name: Content Creator
category: marketing
version: 1.0
---

# ✍️ Content Creator Agent

## 🎯 Purpose
You are an expert content creator who produces compelling written content...

## 📋 Core Responsibilities
### Blog & Long-Form Content
- Research and outline comprehensive articles
- ...

## 🛠️ Key Skills
- **Writing:** Copywriting, editing, storytelling
- ...

## 💬 Communication Style
- Write for the reader, not for yourself
- ...

## 💡 Example Prompts
- "Write a blog post about [topic] targeting [audience] for SEO"
- ...

## 🔗 Related Agents
- **Trend Researcher** — For content ideation
- ...
```

### How you use it with Claude

Three patterns, all file-based — no plugin manifest, no hooks:

**1. Project integration.** Copy into your project's `.claude/agents/` directory and reference in `CLAUDE.md`:
```bash
mkdir -p .claude/agents
cp -r claude-agents-library/engineering .claude/agents/
```
Then in `CLAUDE.md`:
```markdown
## Active Agents
- [Frontend Developer](.claude/agents/engineering/frontend-developer.md)
- [UI Designer](.claude/agents/design/ui-designer.md)
```

**2. Direct reference in prompts.**
```
"Acting as the Backend Architect agent, design a database schema for a multi-tenant SaaS."
```

**3. Multi-agent composition.**
```
"Using both the Growth Hacker and Analytics Reporter agents, analyze the funnel and propose experiments."
```

### What it's good at

- Fast onboarding: zero install, just copy-paste
- Role clarity: each file is a complete job description Claude can step into
- Cross-references: "Related Agents" sections form a collaboration graph

### What it's *not*

- **Not a workflow.** It tells Claude *who to be*, not *what steps to take*. A "Frontend Developer" agent won't stop you from skipping tests.
- **Not stateful.** No scratch pad, no memory across sessions.
- **Not opinionated about process.** No verification gates, no anti-rationalization guardrails.

---

## 2. agent-skills — Workflows

**Repo**: https://github.com/addyosmani/agent-skills
**Local**: `/Users/acchapm1/owl/ai/claude/agent-skills`

### What it is

A Claude Code **plugin** packaging **20 production-grade engineering workflows** that encode the full software lifecycle from spec to ship. Each skill is a step-by-step process Claude *executes*, not a reference doc it reads. The design inspiration: Google's engineering culture — Hyrum's Law, the Beyonce Rule, Chesterton's Fence, trunk-based development, shift-left testing.

### The lifecycle

```
 DEFINE          PLAN           BUILD          VERIFY         REVIEW          SHIP
┌──────┐      ┌──────┐      ┌──────┐      ┌──────┐      ┌──────┐      ┌──────┐
│ Idea │ ───▶ │ Spec │ ───▶ │ Code │ ───▶ │ Test │ ───▶ │  QA  │ ───▶ │  Go  │
│Refine│      │  PRD │      │ Impl │      │Debug │      │ Gate │      │ Live │
└──────┘      └──────┘      └──────┘      └──────┘      └──────┘      └──────┘
  /spec          /plan          /build        /test         /review       /ship
```

### Inventory

- **21 skill directories, 24 SKILL.md files** (including `using-agent-skills/` meta-skill for discovery)
- **7 slash commands** (`/spec`, `/plan`, `/build`, `/test`, `/review`, `/code-simplify`, `/ship`)
- **3 agent personas** (`code-reviewer`, `test-engineer`, `security-auditor`) — these focus on *review*, not role-play
- **4 reference checklists** (testing-patterns, security, performance, accessibility) loaded on demand
- **7 integration guides** for Claude Code, Cursor, Gemini CLI, Copilot, Windsurf, OpenCode, Kiro
- **Session hooks** (`hooks/session-start.sh`) auto-run on every session start
- **Plugin manifest** (`.claude-plugin/plugin.json`) — installable from the marketplace

### Anatomy of a SKILL.md

Every skill follows the same canonical structure:

```yaml
---
name: spec-driven-development
description: Creates specs before coding. Use when starting a new project...
---
```

1. **Overview** — one or two sentences on purpose
2. **When to Use** — triggers and explicit exclusions
3. **Core Process** — numbered steps or phases, with concrete commands
4. **Specific Techniques / Patterns** — templates and code examples
5. **Common Rationalizations** — **the secret sauce**. Table of excuses with rebuttals:

   | Rationalization | Reality |
   |---|---|
   | *"This is simple, I don't need a spec"* | Simple tasks don't need *long* specs, but they still need acceptance criteria. |
   | *"I'll write the spec after I code it"* | That's documentation, not specification. The spec's value is in forcing clarity *before* code. |

6. **Red Flags** — observable signs the skill is being violated
7. **Verification** — evidence-based exit criteria (test output, build result, screenshot — not "seems right")

### How you use it with Claude Code

```bash
# Marketplace
/plugin marketplace add addyosmani/agent-skills
/plugin install agent-skills@addy-agent-skills

# Or reference a local clone
claude --plugin-dir /Users/acchapm1/owl/ai/claude/agent-skills
```

Then:
```
/spec Build a CLI tool that monitors Slurm jobs and emails on failure.
/plan
/build
/test
/review
/ship
```

Or let Claude auto-load the right skill based on context — every skill's frontmatter `description` starts with *"Use when…"* triggers.

### What it's good at

- **Enforces discipline.** Verification gates, anti-rationalization tables, and evidence requirements make it hard for Claude to cut corners.
- **Full lifecycle coverage.** One package handles define → ship.
- **Composable.** Skills reference each other; slash commands activate bundles.
- **Token-efficient.** Progressive disclosure — only the frontmatter descriptions stay loaded; full SKILL.md loads on demand.

### What it's *not*

- **Not a project planner.** It runs disciplined workflows on the task in front of it, but it doesn't track roadmaps, decisions, or a product across months.
- **Not a persona library.** Its three "agents" are review perspectives, not role-play characters.
- **Not domain-specific.** All skills assume mainstream web/app development — nothing about scientific computing, HPC, MPI, GPUs, or reproducibility.

---

## 3. Agent OS — Product Lifecycle

**Home**: https://buildermethods.com/agent-os
**Local**: `~/.agent-os/` (standards + instructions) and `.agent-os/product/` (generated per project)

### What it is

An **opinionated product-management framework** for AI coding that persists structured state to disk. Unlike the other two, it isn't just markdown that Claude reads — it's a small toolkit of instruction files that generate and maintain a durable `.agent-os/` directory inside each project.

### Inventory

**Global (`~/.agent-os/`):**
- `standards/tech-stack.md` — your default stack (Rails, PostgreSQL, React, Tailwind, DO, etc.)
- `standards/code-style.md` — indentation, naming, HTML/template formatting, Tailwind multi-line rules
- `standards/best-practices.md` — KISS, DRY, readability, dependency selection
- `instructions/plan-product.md` — 7-step product initialization workflow
- `instructions/create-spec.md` — 15-step spec creation workflow
- `instructions/execute-tasks.md` — 12-step TDD execution workflow
- `instructions/analyze-product.md` — retrofit Agent OS onto existing code

**Per-project (`.agent-os/product/`):**
- `mission.md` — pitch, personas, problem, differentiators, key features
- `tech-stack.md` — detected or declared stack
- `roadmap.md` — five phases, features per phase, effort estimates (XS → XL)
- `decisions.md` — append-only decision log with override authority

**Per-spec (`.agent-os/specs/YYYY-MM-DD-name/`):**
- `spec.md` — overview, user stories, scope, deliverables
- `sub-specs/technical-spec.md`, `database-schema.md`, `api-spec.md`, `tests.md`
- `tasks.md` — TDD-ordered checklist, first subtask is always "write tests"

### How you use it

Four slash commands map to the four instruction files:
```
/plan-product     # bootstrap new product (creates .agent-os/product/)
/create-spec      # plan a new feature (creates .agent-os/specs/…)
/execute-tasks    # run the TDD task list (updates tasks.md, creates branch, PRs)
/analyze-product  # retrofit onto existing code
```

Because the instructions write files to disk, **state persists between sessions**. When you open a new Claude Code session in the project, it re-reads `.agent-os/product/roadmap.md`, knows what phase you're in, and knows which decisions are load-bearing.

### What it's good at

- **Persistence.** The other two tools evaporate between sessions; Agent OS remembers.
- **Product framing.** Forces you to articulate mission, users, differentiators before writing code.
- **Decision log with override authority.** `.agent-os/product/decisions.md` explicitly wins conflicts with global rules — a form of project-local law.
- **TDD baked in.** Every task list starts with "Write tests for X" and ends with "Verify all tests pass".
- **Multi-project standards.** Your global `~/.agent-os/standards/` apply across every product.

### What it's *not*

- **Not role-based.** It has no personas. Claude is always Claude, following the instructions.
- **Not fine-grained.** Its workflows are coarse (plan → spec → execute). It doesn't tell Claude *how* to write tests or *how* to do a code review — you'd still want agent-skills for that.
- **Opinionated about stack.** The global defaults are Rails + PostgreSQL + React + DO. You can override, but the templates assume web-app shapes.

---

## Head-to-head: how they'd each handle one task

**Task:** *"Add a Slurm job monitor to our internal dashboard."*

### claude-agents-library approach
```
"Acting as the Backend Architect and DevOps Automator agents, design
 and implement a Slurm job monitor for our dashboard."
```
Claude adopts both personas and writes code. No spec, no tests required, no verification gate. Fast, shallow, one-shot.

### agent-skills approach
```
/spec Add a Slurm job monitor to the dashboard
/plan
/build      # incremental slices, TDD, anti-rationalization rules enforced
/test
/review     # five-axis review: correctness, readability, architecture, security, perf
/ship       # pre-launch checklist
```
Slow, disciplined, high-confidence. Every phase has verification. Claude can't skip tests because the skill has a rebuttal ready.

### Agent OS approach
```
/create-spec
  → creates .agent-os/specs/2026-04-11-slurm-job-monitor/
  → spec.md, technical-spec.md, tests.md, tasks.md
  → human review gate
/execute-tasks
  → creates branch, runs TDD task list, opens PR
  → updates roadmap.md, appends to decisions.md if architectural
```
Persistent artifacts land in the repo. Next week, a new session reads `roadmap.md` and knows this feature exists, what phase it's in, and what decisions shaped it.

---

## When to reach for which

| If you want… | Use |
|---|---|
| A quick persona shift for one prompt | **claude-agents-library** |
| Claude to follow senior-engineer discipline on a task | **agent-skills** |
| To track a product across weeks/months with persistent state | **Agent OS** |
| Domain expertise (e.g., "a security auditor reviews this") | claude-agents-library *or* agent-skills' `security-auditor` persona |
| Anti-rationalization enforcement ("I'll add tests later" → no) | **agent-skills** |
| A decisions log that outranks global rules | **Agent OS** |
| Lifecycle coverage (spec → ship) with strict gates | **agent-skills** |
| Lifecycle coverage with persistent roadmap & phases | **Agent OS** |
| Fast onboarding / zero install | **claude-agents-library** |

## Stacking them

They compose naturally — each layer sits at a different altitude:

```
┌─────────────────────────────────────────────────────┐
│  Agent OS         — roadmap, decisions, phases      │  ← product altitude
├─────────────────────────────────────────────────────┤
│  agent-skills     — spec → build → test → ship      │  ← task altitude
├─────────────────────────────────────────────────────┤
│  agents-library   — persona for the current prompt  │  ← voice altitude
└─────────────────────────────────────────────────────┘
```

A realistic stack for a solo engineer building a product:
1. **Agent OS** at the top — `/plan-product` once, then `/create-spec` per feature
2. **agent-skills** in the middle — inside `/execute-tasks`, Claude reaches for `spec-driven-development`, `test-driven-development`, `code-review-and-quality`
3. **claude-agents-library** at the bottom — for one-off prompts like *"Acting as the UX Researcher agent, review this settings page"*

The only place they clash is **process discipline**: agent-skills' strict TDD and Agent OS' `execute-tasks` both enforce TDD, so you don't need both opinions — let agent-skills handle the *how* and Agent OS handle the *what next*.

---

## Related

- [Agent Skills Quick Reference](./agent-skills-guide.md)
- [Agent Skills Hands-On Tutorial](./agent-skills-tutorial.md)
- [Agent Skills for HPC Research Software Engineers](./agent-skills-for-hpc-rse.md)
