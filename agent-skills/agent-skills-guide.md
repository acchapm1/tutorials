# Agent Skills — Quick Reference Guide

> A concise reference for [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) — a Claude Code plugin that packages 20 opinionated engineering workflows as "skills" the agent follows step-by-step.
>
> For the hands-on walkthrough, see [agent-skills-tutorial.md](./agent-skills-tutorial.md).

---

## What It Is (in one paragraph)

Agent Skills is a Claude Code **plugin** — not a framework, not a library. It's a directory of Markdown files that Claude loads into its context, each encoding a senior-engineer workflow (write the spec first, TDD, five-axis review, rollback plan before ship). Every skill has an anti-rationalization table ("I'll add tests later" → rebuttal), verification gates, and exit criteria. It turns Claude from a code-generating yes-machine into something closer to a disciplined pair programmer.

---

## The Lifecycle At A Glance

```
 DEFINE          PLAN           BUILD          VERIFY         REVIEW          SHIP
┌──────┐      ┌──────┐      ┌──────┐      ┌──────┐      ┌──────┐      ┌──────┐
│ Idea │ ───▶ │ Spec │ ───▶ │ Code │ ───▶ │ Test │ ───▶ │  QA  │ ───▶ │  Go  │
│Refine│      │  PRD │      │ Impl │      │Debug │      │ Gate │      │ Live │
└──────┘      └──────┘      └──────┘      └──────┘      └──────┘      └──────┘
  /spec          /plan          /build        /test         /review       /ship
```

---

## Installation

**Install from marketplace (simplest):**

```
/plugin marketplace add addyosmani/agent-skills
/plugin install agent-skills@addy-agent-skills
```

**Install from a local clone (dev/offline):**

```bash
git clone https://github.com/addyosmani/agent-skills.git
claude --plugin-dir /path/to/agent-skills
```

The plugin ships with a `SessionStart` hook that loads the `using-agent-skills` meta-skill — a discovery flowchart — into every new session.

---

## The 7 Slash Commands

| Command | What it does | Primary skill it invokes |
|---|---|---|
| `/spec` | Writes a structured PRD before any code (`SPEC.md`) | spec-driven-development |
| `/plan` | Breaks the spec into small atomic tasks (`tasks/plan.md`, `tasks/todo.md`) | planning-and-task-breakdown |
| `/build` | Implements next task via RED→GREEN→refactor→commit loop | incremental-implementation + test-driven-development |
| `/test` | Pure TDD; for bugs uses the Prove-It pattern (failing repro first) | test-driven-development |
| `/review` | Five-axis review (correctness, readability, architecture, security, performance) | code-review-and-quality |
| `/code-simplify` | Reduces complexity while preserving exact behavior | code-simplification |
| `/ship` | Pre-launch checklist + rollback plan | shipping-and-launch |

---

## All 20 Skills By Phase

**Define** — `idea-refine`, `spec-driven-development`
**Plan** — `planning-and-task-breakdown`
**Build** — `incremental-implementation`, `test-driven-development`, `context-engineering`, `source-driven-development`, `frontend-ui-engineering`, `api-and-interface-design`
**Verify** — `browser-testing-with-devtools`, `debugging-and-error-recovery`
**Review** — `code-review-and-quality`, `code-simplification`, `security-and-hardening`, `performance-optimization`
**Ship** — `git-workflow-and-versioning`, `ci-cd-and-automation`, `deprecation-and-migration`, `documentation-and-adrs`, `shipping-and-launch`

Plus one meta-skill: `using-agent-skills` (the discovery flowchart).

---

## Agent Personas

Three pre-built specialist personas live in `agents/`:

| Persona | Use when |
|---|---|
| `code-reviewer.md` | You want a staff-engineer-grade review of a diff |
| `test-engineer.md` | You want coverage analysis and a test strategy |
| `security-auditor.md` | You're about to merge something sensitive (auth, data, inputs) |

Invoke them by asking Claude to "review this change using the security-auditor persona" and pointing at the file.

---

## Reference Checklists

Under `references/` — pull these in on demand instead of loading the full skill:

- `testing-patterns.md` — test structure, naming, React/API/E2E examples
- `security-checklist.md` — OWASP Top 10, headers, CORS, input validation
- `performance-checklist.md` — Core Web Vitals, profiling commands
- `accessibility-checklist.md` — keyboard nav, ARIA, screen readers

---

## Skill Anatomy

Every skill follows the same shape:

```
YAML frontmatter (name, description)
├── Overview            — What this skill does
├── When to Use         — Triggering conditions
├── Process             — Step-by-step workflow
├── Common Rationalizations — Excuses + rebuttals
├── Red Flags           — Signs something's wrong
└── Verification        — Evidence requirements
```

The anti-rationalization tables are the secret weapon — they're pre-written rebuttals to the excuses agents use to skip steps.

---

## Core Operating Behaviors (from the meta-skill)

These apply across every skill, non-negotiable:

1. **Surface assumptions** before implementing anything non-trivial
2. **Manage confusion actively** — stop and ask rather than guess
3. **Push back when warranted** — no sycophancy
4. **Enforce simplicity** — boring over clever
5. **Maintain scope discipline** — don't touch adjacent code
6. **Verify, don't assume** — evidence or it didn't happen

---

## When To Use Which Command

| Situation | Start with |
|---|---|
| New feature, nothing written yet | `/spec` → `/plan` → `/build` |
| Bug fix | `/test` (Prove-It pattern) → `/review` |
| Code works but is ugly | `/code-simplify` → `/review` |
| About to merge a PR | `/review` |
| About to deploy to prod | `/ship` |
| Vague idea, not even sure what to build | Load `idea-refine` skill manually |
| Security-sensitive change | `/review` + load `security-auditor` persona |

---

## Key Design Principles

- **Process, not prose.** Skills are workflows, not reference docs.
- **Anti-rationalization.** Every skill has documented counter-arguments to shortcut excuses.
- **Verification is non-negotiable.** "Seems right" is never sufficient.
- **Progressive disclosure.** The SKILL.md is the entry point; references load only when needed.

---

## Related

- Repo: https://github.com/addyosmani/agent-skills
- Full tutorial with example session: [agent-skills-tutorial.md](./agent-skills-tutorial.md)
- Compare with Agent OS (`~/.agent-os/`) — similar philosophy, different flavor
