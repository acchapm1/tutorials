# Claude Agents Library — Quick Reference Guide

> A concise reference for [claude-agents-library](https://github.com/vibecoding/claude-agents-library) — a curated collection of 34 role-based personas you can drop into any Claude Code project to make Claude consistently behave as a domain specialist.
>
> For the hands-on walkthrough, see [claude-agents-library-tutorial.md](./claude-agents-library-tutorial.md).
> For how this compares to agent-skills and Agent OS, see [comparing-claude-agents-library-agent-skills-agent-os.md](../agent-skills/comparing-claude-agents-library-agent-skills-agent-os.md).

---

## What It Is (in one paragraph)

Claude Agents Library is a **persona library** — 34 markdown files, each a complete job description that Claude can step into. Copy one into your project's `.claude/agents/` directory, reference it in `CLAUDE.md`, and Claude will consistently answer as a *Backend Architect*, a *Growth Hacker*, or a *Performance Benchmarker* without you having to prompt-engineer the role every time. It's not a workflow framework (there are no verification gates), not stateful (nothing persists between sessions), and not a plugin (no manifest, no slash commands). It's a lightweight costume rack for Claude, MIT-licensed, zero install.

---

## The 34 Agents at a Glance

```
design/              (5)   ui-designer, ux-researcher, brand-guardian,
                            visual-storyteller, whimsy-injector

engineering/         (6)   frontend-developer, backend-architect,
                            mobile-app-builder, ai-engineer,
                            devops-automator, rapid-prototyper

marketing/           (7)   tiktok-strategist, instagram-curator,
                            x-twitter-strategist, reddit-community-builder,
                            app-store-optimizer, content-creator, growth-hacker

product/             (3)   trend-researcher, feedback-synthesizer,
                            sprint-prioritizer

project-management/  (3)   experiment-tracker, project-shipper,
                            studio-producer

studio-operations/   (5)   support-responder, analytics-reporter,
                            infrastructure-maintainer, legal-compliance-checker,
                            finance-tracker

testing/             (5)   tool-evaluator, api-tester, workflow-optimizer,
                            performance-benchmarker, test-results-analyzer
```

**Total: 34 agents across 7 categories.** All files follow the same anatomy, all are independent, all are MIT licensed.

---

## Anatomy of an Agent File

Every agent is a markdown file with YAML frontmatter and six required sections:

```yaml
---
name: Content Creator
category: marketing
version: 1.0
---
```

1. **🎯 Purpose** — 2-3 sentences in second person (*"You are..."*) that establish the persona and its core value
2. **📋 Core Responsibilities** — 3-5 subsections, each a bullet list of specific tasks
3. **🛠️ Key Skills** — tools, technologies, methodologies the agent uses
4. **💬 Communication Style** — tone, approach, what to emphasize
5. **💡 Example Prompts** — 4-6 ready-to-use prompts that invoke the agent
6. **🔗 Related Agents** — 3-5 cross-references forming a collaboration graph

That's it. No frontmatter beyond `name`, `category`, `version`. No process steps, no verification gates, no rationalization rebuttals. The power comes from **specificity** — each agent lists real tools (*"Figma, Sketch, Adobe XD"*), granular responsibilities (not *"manage projects"* but *"identify at-risk items early, facilitate status updates, escalate effectively"*), and realistic example prompts you can copy verbatim.

---

## Installation

There is no install. It's copy-paste.

### Pattern 1: Project integration (most common)

```bash
# Clone once
git clone https://github.com/vibecoding/claude-agents-library.git ~/src/claude-agents-library

# In your project
mkdir -p .claude/agents
cp -r ~/src/claude-agents-library/engineering .claude/agents/
cp -r ~/src/claude-agents-library/testing .claude/agents/
```

Then reference the ones you want in `CLAUDE.md`:

```markdown
## Active Agents

- [Backend Architect](.claude/agents/engineering/backend-architect.md)
- [API Tester](.claude/agents/testing/api-tester.md)
- [DevOps Automator](.claude/agents/engineering/devops-automator.md)
```

Claude Code picks up `CLAUDE.md` automatically. The linked files become part of its context whenever it reads the `CLAUDE.md`.

### Pattern 2: Direct prompt reference

Skip the file copying entirely. Paste or reference the agent in the prompt:

```
"Acting as the Backend Architect agent, design a database schema
 for a multi-tenant SaaS app with per-tenant encryption keys."
```

Works in Claude Chat, Claude Code, or any other Claude surface.

### Pattern 3: Multi-agent composition

Stack personas for work that spans specialties:

```
"Using both the Growth Hacker and Analytics Reporter agents,
 analyze the funnel data in reports/funnel-q1.csv and propose
 three experiments ranked by expected impact."
```

Claude blends the two perspectives — Growth Hacker contributes experiment design, Analytics Reporter contributes measurement rigor.

---

## When Each Agent Earns Its Keep

| You're about to… | Use |
|---|---|
| Sketch a database schema or service boundary | `engineering/backend-architect` |
| Implement a React/Vue component | `engineering/frontend-developer` |
| Design a CI/CD pipeline or Dockerize something | `engineering/devops-automator` |
| Spike a concept in a day or two | `engineering/rapid-prototyper` |
| Wire up an LLM or embedding pipeline | `engineering/ai-engineer` |
| Draft a landing-page headline or email sequence | `marketing/content-creator` |
| Plan a growth experiment | `marketing/growth-hacker` |
| Review an API contract | `testing/api-tester` |
| Benchmark performance and set SLOs | `testing/performance-benchmarker` |
| Write user research interview questions | `design/ux-researcher` |
| Audit a UI for brand consistency | `design/brand-guardian` |
| Triage a pile of user feedback | `product/feedback-synthesizer` |
| Decide what ships this sprint | `product/sprint-prioritizer` |
| Draft a launch checklist | `project-management/project-shipper` |

---

## Strengths

- **Zero install, zero config.** A file is all it takes.
- **Clarity of voice.** Each agent is a complete job description — no ambiguity about who Claude is in this context.
- **Composition graph.** The "Related Agents" sections connect the library into a workable team chart.
- **Platform-agnostic.** Works in Claude Code, Claude Chat, Cursor, anywhere Claude runs.
- **Easy to fork.** They're just markdown; change the voice, add responsibilities, tune to your project.

## Limits (and when to reach for something else)

- **Not a workflow.** An agent tells Claude *who to be*, not *what steps to take*. A "Frontend Developer" persona won't stop Claude from skipping tests or shipping unreviewed code. For that, use [agent-skills](https://github.com/addyosmani/agent-skills).
- **Not stateful.** Nothing persists between sessions. For roadmap tracking, decision logs, and multi-session memory, use [Agent OS](https://buildermethods.com/agent-os).
- **Not domain-tuned.** The library targets consumer/SaaS work: marketing, product, growth, web/mobile engineering. There is nothing for scientific computing, HPC, MPI, GPUs, reproducibility, or research workflows. See the [HPC RSE guide](#) for how to fix that.
- **No verification.** Agents don't enforce quality gates. They can still produce shallow, unverified output — the persona only shapes voice, not discipline.

## How it compares to its siblings

| | claude-agents-library | agent-skills | Agent OS |
|---|---|---|---|
| Unit | Persona | Workflow (SKILL.md) | Product plan + spec + tasks |
| Answers | "Who should Claude act as?" | "How should Claude do this?" | "What are we building, in what order?" |
| State | Stateless | Stateless | **Stateful** (writes `.agent-os/`) |
| Discipline | None | Anti-rationalization tables, verification gates | Human-review gates between phases |
| Best for | Voice / role | Task discipline | Long-running projects |

Full comparison: [comparing-claude-agents-library-agent-skills-agent-os.md](../agent-skills/comparing-claude-agents-library-agent-skills-agent-os.md).

---

## Filename conventions

- **File**: `kebab-case.md` (`frontend-developer.md`, `growth-hacker.md`)
- **Title**: `[Emoji] [Title Case] Agent` (`🎨 Frontend Developer Agent`)
- **Name**: descriptive and role-based — "Frontend Developer", not "WebUI Specialist"

If you write your own, match these conventions so the file sits cleanly alongside the upstream library.

---

## Related

- [Claude Agents Library — Hands-On Tutorial](./claude-agents-library-tutorial.md)
- [Claude Agents Library for HPC Research Software Engineers](./claude-agents-library-for-hpc-rse.md)
- [Three-way comparison: agents-library vs. agent-skills vs. Agent OS](../agent-skills/comparing-claude-agents-library-agent-skills-agent-os.md)
