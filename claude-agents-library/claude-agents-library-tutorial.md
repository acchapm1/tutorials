# Claude Agents Library — Hands-On Tutorial

> A walkthrough for getting [claude-agents-library](https://github.com/vibecoding/claude-agents-library) into your Claude Code workflow, from first clone to multi-agent composition. Assumes you have Claude Code installed and a project you're willing to experiment in.
>
> For the concise reference, see [claude-agents-library-guide.md](./claude-agents-library-guide.md).

---

## Before you start

- **Claude Code installed** and working in at least one project
- **Git** available on `$PATH`
- **One real project** to drop agents into — a toy repo is fine, but it's more instructive if you have actual code

Everything in this tutorial is reversible: agents are just markdown files in `.claude/agents/`. If you don't like the result, `rm -rf .claude/agents/` and you're back where you started.

---

## Step 1 — Clone the library once, centrally

Pick a stable location outside any single project so you can reuse it everywhere.

```bash
mkdir -p ~/src
git clone https://github.com/vibecoding/claude-agents-library.git ~/src/claude-agents-library
```

Verify the structure:

```bash
ls ~/src/claude-agents-library
# design/  engineering/  marketing/  product/  project-management/
# studio-operations/  testing/  README.md  CONTRIBUTING.md  LICENSE
```

You now have the full catalog of 34 agents on disk. The clone is your upstream — pull occasionally to pick up new agents and revisions.

---

## Step 2 — Browse the catalog

Two things to read before you adopt anything:

```bash
# The README — installation patterns and philosophy
less ~/src/claude-agents-library/README.md

# A representative agent, so you know what you're getting
less ~/src/claude-agents-library/engineering/backend-architect.md
```

Every agent has the same six-section shape (Purpose, Core Responsibilities, Key Skills, Communication Style, Example Prompts, Related Agents). Once you've read one, you can skim the rest in seconds.

**A useful trick**: grep across the library when you're looking for a specific capability:

```bash
grep -ri "rate limit" ~/src/claude-agents-library
grep -ri "postgres" ~/src/claude-agents-library
```

This surfaces which personas mention the thing you're looking for — faster than reading every file.

---

## Step 3 — Adopt a small starter set in one project

Pick three agents. Resist the urge to copy all 34. Each one you add takes up context, and most projects only need a handful.

For a typical web-app project, a good starter set is:
- `engineering/backend-architect`
- `engineering/frontend-developer`
- `testing/api-tester`

From your project root:

```bash
cd ~/path/to/your-project
mkdir -p .claude/agents/engineering .claude/agents/testing

cp ~/src/claude-agents-library/engineering/backend-architect.md   .claude/agents/engineering/
cp ~/src/claude-agents-library/engineering/frontend-developer.md  .claude/agents/engineering/
cp ~/src/claude-agents-library/testing/api-tester.md              .claude/agents/testing/
```

Why copy instead of symlink? Because you'll want to tune the agents to this project (we'll do that in Step 6), and you don't want those edits leaking back into the shared clone.

---

## Step 4 — Wire the agents into `CLAUDE.md`

Claude Code reads `CLAUDE.md` from the project root automatically. Add an Active Agents section so Claude knows they exist:

```markdown
## Active Agents

- [Backend Architect](.claude/agents/engineering/backend-architect.md) — API design, data modeling, service boundaries
- [Frontend Developer](.claude/agents/engineering/frontend-developer.md) — React/TypeScript components, state management
- [API Tester](.claude/agents/testing/api-tester.md) — contract tests, fuzzing, API verification

When a task falls into one of these domains, adopt the matching agent's
voice and responsibilities before answering.
```

The last line is doing real work: without it, Claude will happily ignore the files. Be explicit that you want them picked up.

---

## Step 5 — Try a single-persona prompt

Open Claude Code in the project and run a prompt that clearly lands in one agent's territory:

```
Acting as the Backend Architect agent in .claude/agents/engineering/backend-architect.md,
design the data model for a feature that lets users schedule recurring exports
to S3. Cover: tables, indexes, retention, and the failure modes we should plan for.
```

What you should see:
- Claude references the **Core Responsibilities** of the agent (data modeling, system design, failure handling)
- The answer is more structured than a generic one — it probably includes an options list with pros/cons, an explicit rationale, and a call-out of risks
- It finishes with concrete next steps or hands-off points to "related agents"

If the answer feels generic, re-read the agent file — Claude may not have actually loaded it. Check that the path in `CLAUDE.md` is relative-to-project-root and that the file exists.

---

## Step 6 — Customize an agent for your project

This is where the library goes from interesting to useful. Open the copy you made in Step 3:

```bash
$EDITOR .claude/agents/engineering/backend-architect.md
```

Three edits worth making:

**1. Pin the tech stack in Key Skills.** Upstream says *"databases (SQL and NoSQL)"*. Your project probably uses one. Be specific:

```markdown
## 🛠️ Key Skills

- **Databases:** PostgreSQL 17 (primary), Redis (cache/queues)
- **ORMs:** Active Record (Rails 8)
- **Message queues:** Sidekiq
- **Cloud:** Digital Ocean Managed PostgreSQL, S3 for artifacts
```

**2. Add a Project Context block at the top of Purpose.** Give the agent the one-paragraph version of your project:

```markdown
## 🎯 Purpose

You are an expert backend architect...

**Project context:** This is a multi-tenant SaaS for research labs. Per-tenant
data isolation is mandatory. We run on Digital Ocean, Postgres is managed,
and we prefer trunk-based development with feature flags for risky changes.
```

**3. Rewrite the Example Prompts for your domain.** The upstream prompts are generic; yours should name real tables, real services, real files:

```markdown
## 💡 Example Prompts

- "Design the schema for a new `export_jobs` table that supports recurring
   schedules with per-tenant encryption."
- "Review db/schema.rb for indexes we'll need before the mobile launch."
- "Propose a migration strategy to move `audit_log` off the main DB."
```

Now the agent isn't a generic "Backend Architect" — it's *your* Backend Architect, grounded in the actual system.

Commit this. The agent files belong in version control alongside the rest of the project.

```bash
git add .claude/agents CLAUDE.md
git commit -m "Add customized agent personas for backend/frontend/API work"
```

---

## Step 7 — Multi-agent composition

Single-agent prompts are the easy win. The more interesting pattern is **composition** — stacking two or three personas for work that crosses specialties.

Example prompt:

```
Using the Backend Architect and API Tester agents together:

1. As the Backend Architect, design the API contract for POST /v1/exports
   (idempotent, supports dry-run).
2. As the API Tester, write the contract test cases that should ship with
   this endpoint — happy path, idempotency check, dry-run verification,
   auth failures, and input validation edges.

Produce both outputs in one response, clearly labeled.
```

Claude will switch voice between the two sections. The architect half emphasizes data flow and failure modes; the tester half emphasizes coverage and edge cases. Neither half dominates — and because the agents' "Related Agents" sections explicitly list each other, the handoff feels natural.

**When composition shines**:
- API design with paired tests
- Feature design with paired marketing copy
- Database changes with paired migration tests

**When it doesn't**:
- When one voice would do. Three personas on a small task is just noise.

---

## Step 8 — Keep the upstream fresh

The library is active (version 1.2 as of early 2026). Periodically pull:

```bash
cd ~/src/claude-agents-library
git pull
```

When upstream changes an agent you've customized, you have three options:
1. **Ignore it.** Your customized version is what your project needs.
2. **Cherry-pick.** Diff upstream against your copy and merge the interesting bits:
   ```bash
   diff -u .claude/agents/engineering/backend-architect.md \
           ~/src/claude-agents-library/engineering/backend-architect.md
   ```
3. **Re-copy and re-customize.** Start from the new upstream and re-apply your Project Context block.

There is no tooling for this — it's just files. Which is the point; the library is deliberately simple.

---

## Step 9 — Write your own agent

At some point you'll want a persona the library doesn't ship. Making one is easy — copy an existing file as a template and rewrite.

```bash
cp .claude/agents/engineering/backend-architect.md \
   .claude/agents/custom/migration-specialist.md
$EDITOR .claude/agents/custom/migration-specialist.md
```

Keep the six-section shape. A good custom agent has:
- A **Purpose** that names the problem it solves, not just the role
- **Core Responsibilities** with 3-5 subsections, each bulleted
- **Key Skills** that are *specific* — name real tools and versions
- **Example Prompts** copied verbatim from prompts you've actually wanted to send
- **Related Agents** pointing at the upstream library so it plugs into the graph

Then add it to `CLAUDE.md` alongside the others.

The best custom agents come from a simple observation: *"I keep writing the same preamble in my prompts."* That preamble is already a persona waiting to be extracted.

---

## Step 10 — Prune

After a month in a project, some agents will earn their keep and others will sit unused. Prune them. An agent file you never reference is context tax on every Claude Code session that loads `CLAUDE.md`.

Signs an agent should go:
- You can't remember the last time Claude's output actually reflected it
- Its Example Prompts don't match anything you've prompted in six weeks
- Its Core Responsibilities drift from what you actually do

Deleting is cheap — the upstream clone in `~/src/claude-agents-library` still has them, and `git log` remembers what you removed.

---

## Troubleshooting

**"Claude ignores the agents."**
Check that `CLAUDE.md` actually references them with relative paths from project root, and that you added an instruction telling Claude to adopt the persona. Claude Code doesn't auto-invoke agents from filesystem presence alone.

**"The output is still generic."**
You probably skipped Step 6. Generic agents produce generic output; customize the Key Skills and Example Prompts to name your real stack and real files.

**"Two agents contradict each other."**
That's composition working — they're designed with different priorities. Resolve it by giving one agent primacy in your prompt ("As the Backend Architect (primary), and drawing input from the API Tester…").

**"I want slash commands like `/spec`."**
Different tool. Use [agent-skills](https://github.com/addyosmani/agent-skills) — it's a proper Claude Code plugin with slash commands, hooks, and verification gates. The agents-library is personas, not workflows.

---

## What to do next

- **If you want workflow discipline** (TDD, verification gates, anti-rationalization), stack [agent-skills](https://github.com/addyosmani/agent-skills) on top of the library. Agents shape *voice*; skills shape *process*.
- **If you want persistent roadmaps and decision logs**, add [Agent OS](https://buildermethods.com/agent-os). The three tools compose naturally — see the [comparison guide](../agent-skills/comparing-claude-agents-library-agent-skills-agent-os.md).
- **If you work in HPC / research computing**, the upstream library has no agents for your domain. Read [claude-agents-library-for-hpc-rse.md](./claude-agents-library-for-hpc-rse.md) for a concrete set of custom personas to build.

---

## Related

- [Claude Agents Library Quick Reference](./claude-agents-library-guide.md)
- [Claude Agents Library for HPC Research Software Engineers](./claude-agents-library-for-hpc-rse.md)
- [Three-way comparison: agents-library vs. agent-skills vs. Agent OS](../agent-skills/comparing-claude-agents-library-agent-skills-agent-os.md)
