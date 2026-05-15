---
title: "Maestri Deep Dive — Advanced Agent Orchestration and HPC Workflow Patterns"
date: 2026-05-07
difficulty: advanced
tags: [maestri, macos, ai-agents, terminal, orchestration, hpc, pty, canvas, automation, workflows]
---

# Maestri Deep Dive

## Overview

Maestri is a native macOS application that provides an infinite canvas for orchestrating AI coding agents, terminals, notes, and sketches. Built entirely in Swift and SwiftUI with a custom canvas engine and GPU-accelerated terminal rendering, it replaces the traditional multi-window terminal workflow with a spatial, node-graph approach where agents communicate via PTY (pseudo-terminal) connections.

This deep-dive reference covers Maestri's internal architecture, advanced orchestration patterns, Floor-based workspace isolation, Routine automation, and strategies for integrating Maestri into an HPC administrator's daily operations. It assumes you have read the [[maestri-beginner-guide]] and are comfortable with the core interface.

### What This Guide Covers

- Maestri's architecture: Swift/SwiftUI, PTY orchestration, and the canvas engine
- Advanced agent connection topologies and multi-agent workflows
- Floor management with git branch isolation and copy-on-write clones
- Routine automation patterns for HPC monitoring and maintenance
- Ombro internals and Apple Foundation Models integration
- Git integration: commit sheets, selective stash, branch publishing
- Performance tuning: GPU rendering, memory management, and large canvas strategies
- Advanced HPC administration patterns using Maestri

## Prerequisites

- Maestri installed and a working familiarity with its interface (see [[maestri-beginner-guide]])
- Experience with AI coding agents (Claude Code, Codex, Gemini CLI, or similar)
- Solid understanding of SSH and remote system administration — see [[ssh-config-deep-dive]] for advanced SSH configuration patterns
- Familiarity with git branching workflows — [[git-worktrees-worktrunk-deep-dive]] covers related concepts
- For HPC-specific sections: working knowledge of job schedulers (Slurm, PBS), cluster architectures, and system administration

## Key Concepts

### PTY Orchestration Architecture

Maestri's agent communication is built on Unix pseudo-terminals (PTY). Each terminal node on the canvas owns a PTY master/slave pair. When you draw a connection line between two terminals, Maestri bridges their PTY streams — the stdout of one terminal becomes the stdin of another.

This design has several important implications:

**No protocol overhead.** Communication between agents is raw text over PTY, the same mechanism your shell uses. There is no JSON serialization, no HTTP, no WebSocket framing. One agent literally types into another agent's terminal.

**Agent-agnostic.** Because communication is at the PTY level, Maestri does not need to know anything about the agent's API or protocol. Any program that reads stdin and writes stdout can participate — Claude Code, Codex, Gemini CLI, OpenCode, a shell script, or even `cat`. This means you can mix and match agents from different providers.

**Bidirectional vs. unidirectional connections.** A connection line has a direction. The source terminal's output feeds into the target terminal's input. For bidirectional communication, you draw two lines (one in each direction). Understanding this directionality is critical for designing multi-agent workflows.

**Buffering and timing.** PTY communication is buffered by the kernel's PTY subsystem. Large outputs may arrive in chunks. Agents that rely on seeing a complete response before acting need to handle this — most AI agents do this naturally since they wait for a prompt before responding.

### Canvas Engine Internals

Maestri's canvas is a custom-built 2D rendering engine, not a web view or Electron wrapper. Key characteristics:

- **Viewport culling**: Only nodes visible in the current viewport are fully rendered. Off-screen terminals still run (their PTY processes are alive) but their visual rendering is suspended. This keeps performance stable even with dozens of terminal nodes.
- **Semantic zoom**: At different zoom levels, Maestri adjusts rendering fidelity. Zoomed out, terminals show simplified representations; zoomed in, you get pixel-perfect TUI rendering.
- **GPU-accelerated terminal rendering**: When enabled in Settings, terminal text rendering is offloaded to the GPU via Metal. This significantly reduces CPU usage, especially when multiple terminals have active output.

### Floor Isolation Model

Floors are Maestri's workspace isolation primitive. Each Floor is a complete, independent canvas with its own arrangement of terminals, notes, and connections.

When your workspace is backed by a git repository, each Floor can optionally be associated with a git branch. Creating a Floor triggers a copy-on-write clone of the working directory (similar to `git worktree` — see [[git-worktrees-worktrunk-deep-dive]] for the underlying git concept). This means:

- Changes on one Floor do not affect others.
- Each Floor's terminals operate in their own branch context.
- You can "land" changes from a Floor back to main when ready, similar to merging a feature branch.
- The 3D overview lets you see all Floors simultaneously and jump between them.

For HPC admins, this maps naturally to incident isolation: create a Floor for an investigation, make configuration changes freely, and discard or merge when done.

### Sticky Note File Semantics

Sticky notes are not ephemeral — they are markdown files stored on disk in your workspace directory. The file path corresponds to the note's identity. When an agent is connected to a sticky note, Maestri provides the file path to the agent's context, and the agent reads/writes the file directly.

This means:

- Notes survive app restarts and workspace switches.
- Notes can be version-controlled (they are regular files in your git repo).
- Multiple agents connected to the same note share a file-based communication channel.
- You can edit notes outside Maestri (in any text editor or [[hammerspoon-deep-dive|via automation]]) and agents will see the changes.

Sticky notes support markdown tables, and you can edit table cells directly by clicking into them to reveal the raw markdown source.

### Ombro and Apple Foundation Models

Ombro is Maestri's ambient AI companion. It runs as a floating window outside the main app and monitors agent activity across all terminals. Key technical details:

- **On-device inference**: Ombro uses Apple Foundation Models through Apple Intelligence. All processing happens locally on the Mac — no API calls, no data leaving the device.
- **Requires Apple Silicon**: The Apple Foundation Models runtime requires an Apple Silicon Mac with Apple Intelligence enabled in System Settings. Intel Macs cannot run Ombro.
- **Monitoring scope**: Ombro watches terminal output streams and triggers summarization when an agent appears to have completed a task (heuristically detected by output patterns).
- **Suggestions**: Based on the summarized context, Ombro suggests next steps. These are displayed in the floating window and can be acted on with a click.

For HPC admins who manage long-running agent tasks (e.g., an agent analyzing job logs or generating batch scripts across multiple clusters), Ombro provides a "heads-up display" so you can context-switch to other work without losing track of agent progress.

## Step-by-Step Instructions

### Step 1: Design a Multi-Agent Orchestration Topology

The most powerful Maestri workflows involve multiple agents with defined roles. Plan your topology before creating terminal nodes.

**Common topologies for HPC administration:**

**Hub-and-spoke**: One primary agent (the "conductor") connects to several specialist agents. The conductor receives your requests and delegates to specialists:

```
                    ┌──────────────┐
                    │  Conductor   │
                    │ (Claude Code)│
                    └──┬───┬───┬──┘
                       │   │   │
              ┌────────┘   │   └────────┐
              ▼            ▼            ▼
     ┌────────────┐ ┌───────────┐ ┌──────────┐
     │  Scripter  │ │  Reviewer │ │ Monitor  │
     │  (Codex)   │ │ (Claude)  │ │ (Agent)  │
     └────────────┘ └───────────┘ └──────────┘
```

**Pipeline**: Agents are chained sequentially. Output from one feeds into the next:

```
  [Log Collector] → [Analyzer Agent] → [Report Writer] → [Report Note]
```

**Shared-context star**: Multiple agents all connect to a central sticky note rather than to each other. Each agent reads and writes to the note, using it as a shared bulletin board:

```
     [Agent A] ──── [Shared Note] ──── [Agent B]
                        │
                    [Agent C]
```

### Step 2: Implement Agent Roles with Custom Instructions

Maestri supports assigning custom roles to agent terminals. Create reusable roles that define each agent's behavior:

**HPC Script Writer role:**
```
You are an HPC batch script specialist. You write Slurm/PBS job scripts 
based on requirements. Always include resource requests, module loads, 
error handling, and output logging. Reference the connected cluster 
specification note for partition names and limits.
```

**Code Reviewer role:**
```
You review shell scripts and configuration files for HPC environments. 
Check for: incorrect resource requests, missing error handling, 
hardcoded paths, security issues (world-readable credentials), 
and non-portable bashisms.
```

**Incident Analyst role:**
```
You analyze system logs, job scheduler output, and node status reports. 
Identify patterns, correlate events across nodes, and produce a 
timeline of what happened. Write findings to the connected incident 
timeline note.
```

Assign these roles when creating terminal nodes. The role text is injected as system context for the agent.

### Step 3: Set Up Floor-Based Cluster Management

Create one Floor per cluster or environment you manage:

1. **Main Floor**: Your day-to-day workspace with terminals to your primary cluster, a general-purpose AI agent, and reference notes.
2. **Cluster-B Floor**: Dedicated layout for a secondary cluster, with its own SSH sessions and cluster-specific notes.
3. **Incident Floor template**: Keep a "clean" Floor with a pre-built incident investigation layout — SSH terminals for node access, a timeline note, and an analyst agent. Clone it when an incident occurs.

When Floors are git-backed, each Floor's configuration changes (scripts, notes, config files) are isolated to that branch. This is conceptually similar to [[git-worktrees-worktrunk-deep-dive|git worktrees]] — separate working directories on separate branches.

Navigate between Floors using keyboard shortcuts (Pro feature) or the 3D overview. Spotlight floor navigation lets you jump to a specific Floor by name.

### Step 4: Build Routine-Based Monitoring

Create Routines for recurring HPC administration tasks:

**Cluster health check (every 30 minutes):**
```bash
#!/bin/bash
echo "=== Cluster Health Check $(date) ==="
ssh hpc-login01 'sinfo --format="%P %a %D %T" --noheader'
echo "---"
ssh hpc-login01 'squeue -u $USER --format="%i %j %T %M %l" --noheader'
echo "---"
ssh hpc-login01 'df -h /scratch | tail -1'
```

**Stale job cleanup reminder (daily):**
```bash
#!/bin/bash
echo "=== Stale Jobs Check $(date) ==="
ssh hpc-login01 'squeue -u $USER -t PENDING --format="%i %j %V" | 
  awk -v cutoff=$(date -d "7 days ago" +%Y-%m-%dT%H:%M:%S) "\$3 < cutoff"'
```

**Configuration drift detection (daily):**
```bash
#!/bin/bash
echo "=== Config Drift Check $(date) ==="
ssh hpc-login01 'md5sum /etc/slurm/slurm.conf' 
# Compare against known-good hash stored in your workspace
```

Routines run in the background, and their output is accessible through the Maestri interface. The routines list shows run counts for recurring routines, so you can verify they are firing reliably.

### Step 5: Leverage Git Integration for Infrastructure-as-Code

Maestri's git integration goes beyond Floor branching:

- **Commit sheet**: Stage and commit changes to scripts, configuration files, and notes directly from Maestri's interface without switching to a separate git client.
- **Selective stash**: Pick exactly which changes to stash using multi-select in the commit sheet. Useful when you have experimental changes on a Floor that you want to save but not commit.
- **Publish branch**: When a Floor creates a new local branch, the git file tree shows "Publish Branch" instead of "Push" until the branch has a remote — mirroring VS Code's behavior.

For HPC admins who maintain infrastructure-as-code repositories (Ansible playbooks, Slurm configurations, module files), this means you can edit, test, and commit without leaving Maestri. Combined with a [[just-deep-dive|Justfile]] for deployment commands, your entire workflow stays on the canvas.

### Step 6: Optimize for Large Canvases

When your canvas grows (dozens of terminals, many notes), performance management becomes important:

- **Enable GPU rendering**: Settings → Enable GPU-accelerated terminal rendering. This is the single biggest performance improvement for large canvases.
- **Group related nodes**: Keep spatially related nodes close together. Maestri's viewport culling means off-screen nodes have minimal rendering cost, so spreading things out is actually fine for performance — but grouping aids navigation.
- **Use Floors instead of one giant canvas**: If your canvas is getting unwieldy, split it into Floors. Each Floor renders independently.
- **Close idle terminals**: Terminals that are no longer needed still consume PTY resources and may hold SSH connections open. Close them or disconnect.
- **Monitor memory**: Maestri fixed memory leaks in terminal handling in recent updates, but long-running sessions with heavy output (e.g., continuous log tailing) will accumulate buffer memory. Periodically clear terminal scrollback if needed.

## Practical Examples

### Example 1: Automated Job Failure Triage

When a batch job fails, an HPC admin typically needs to check the job's stderr, review resource usage, check node health, and potentially resubmit. Orchestrate this with Maestri:

1. Create a "Triage Agent" terminal running Claude Code with the Incident Analyst role.
2. Connect it to a sticky note containing your cluster's partition table and common failure modes.
3. Paste the failed job ID into the agent's terminal.
4. The agent SSHes into the cluster (through your [[ssh-config-deep-dive|SSH config]]), retrieves `sacct` data, reads the job's output file, and analyzes the failure.
5. Findings are written to the connected note, building an investigation record.

```bash
# The agent might execute commands like:
sacct -j 12345678 --format=JobID,State,ExitCode,MaxRSS,MaxVMSize,Elapsed
cat /scratch/user/jobs/12345678.err
scontrol show node compute-042
```

### Example 2: Multi-Cluster Configuration Deployment

Use Maestri's pipeline topology to deploy configuration changes across clusters:

```
[Editor Agent] → [Validator Agent] → [Deployer Terminal]
      │                                      │
  [Config Note]                     [Deploy Log Note]
```

1. **Editor Agent**: You describe the configuration change. The agent modifies the config file (stored as a sticky note or workspace file).
2. **Validator Agent**: Receives the updated config through PTY, runs syntax checks and validates against known constraints.
3. **Deployer Terminal**: A plain SSH session (not an agent) where you manually execute the deployment after reviewing the validated config. This keeps a human in the loop for production changes.
4. **Deploy Log Note**: Connected to the deployer terminal, capturing a record of the deployment commands and output.

### Example 3: Research Environment Setup with HyperQueue

For HPC admins supporting researchers who use [[hyperqueue-deep-dive|HyperQueue]] for task-based job submission:

1. Create a Floor for the researcher's project.
2. Add terminal nodes: one for HyperQueue server management, one for job submission, one with an AI agent.
3. The AI agent helps translate the researcher's requirements into HyperQueue task definitions.
4. Connect the agent to a sticky note containing the [[hyperqueue-basics|HyperQueue configuration]] and cluster resource limits.
5. The researcher can clone this Floor template for each new project.

### Example 4: Monitoring Dashboard with Routines

Build a persistent monitoring setup:

1. Create a dedicated "Monitoring" Floor.
2. Add terminal nodes running long-lived monitoring commands:

```bash
# Terminal 1: Node status (refreshes automatically)
watch -n 60 'sinfo --format="%20P %5a %10l %6D %6t %N"'

# Terminal 2: Job queue activity
watch -n 30 'squeue --format="%8i %12j %8u %8T %10M %9l %6D %R"'

# Terminal 3: Filesystem usage
watch -n 300 'df -h /scratch /home /software'
```

3. Add Routines for alerts that check thresholds:

```bash
#!/bin/bash
SCRATCH_USAGE=$(ssh hpc-login01 'df /scratch --output=pcent | tail -1 | tr -d " %"')
if [ "$SCRATCH_USAGE" -gt 90 ]; then
    echo "WARNING: /scratch at ${SCRATCH_USAGE}% usage"
fi
```

4. Ombro monitors the routine output and surfaces warnings in its floating window.

### Example 5: Collaborative Documentation with Agents

Maintain living documentation for your HPC environment:

1. Create sticky notes for each major topic: "Cluster Architecture", "Module System", "Storage Policies", "Common Job Scripts".
2. Connect an AI agent with a "Documentation Writer" role to all notes.
3. As you perform admin tasks, ask the agent to update the relevant documentation notes based on what you are doing.
4. Because notes are markdown files on disk, they can be committed to git and published to your team's wiki or rendered through a static site generator.

This approach integrates naturally with [[chezmoi-deep-dive|Chezmoi]] if you manage documentation across multiple systems, or with [[gh-cli-deep-dive|GitHub CLI]] for pushing updates to a documentation repository.

## Hands-On Exercises

### Exercise 1: Build a Hub-and-Spoke Topology

Create a conductor agent and two specialist agents. Define roles for each: the conductor handles user requests, one specialist writes Slurm scripts, and the other reviews them. Submit a request to the conductor and observe the delegation flow through PTY connections.

**Success criteria**: The conductor delegates the script writing, the writer produces a script, the reviewer provides feedback, and the conductor synthesizes the final version — all without your intervention beyond the initial request.

### Exercise 2: Incident Response Floor

Create a Floor named "incident-drill". Populate it with: two SSH terminal nodes (to a test system or localhost), an analyst agent, a timeline sticky note, and a findings sticky note. Simulate an incident (e.g., "disk is 95% full on compute-node-01") and use the analyst agent to investigate and document findings in the notes.

### Exercise 3: Git-Backed Floor Workflow

Initialize a git repository in your workspace directory. Create a Floor — observe that Maestri creates a branch. Make changes to a sticky note on the new Floor. Switch back to the main Floor and verify the note is unchanged. Merge the Floor's branch back to main using Maestri's git integration.

### Exercise 4: Routine Chain

Create two Routines that work together: the first collects data (e.g., `squeue` output), the second processes the data (e.g., counts jobs per user). Schedule them sequentially to build a simple automated reporting pipeline.

### Exercise 5: Cross-Tool Integration

Use Maestri alongside other tools in your vault:

1. Write a [[just-deep-dive|Justfile]] in a sticky note with common admin commands.
2. Have an AI agent execute `just` recipes in a connected terminal.
3. Use [[gh-cli-deep-dive|GitHub CLI]] in another terminal to create issues for problems found during monitoring.
4. Connect the agent to a note tracking your [[dotfiles-deep-dive|dotfiles]] changes.

## Troubleshooting

### Terminal Performance Issues

**Symptom**: Terminals become sluggish or the canvas stutters when many terminals are active.

**Resolution**: Enable GPU-accelerated rendering in Settings. If the problem persists, check how many terminals have active output streams (e.g., `tail -f` on large logs). Each active output stream consumes CPU for PTY processing and rendering. Consider redirecting verbose output to files and using `less` to review them.

### PTY Connection Failures

**Symptom**: Agent connections (lines between terminals) don't seem to pass data.

**Resolution**: Verify that both terminal processes are running and in an interactive state. If an agent has crashed or exited, the PTY stream is dead. Restart the agent. Also check that the connection direction is correct — output flows from source to target. For bidirectional communication, ensure you have lines drawn in both directions.

### Floor Navigation Confusion

**Symptom**: Jumping to a Floor from Spotlight or the 3D overview lands you at unexpected coordinates.

**Resolution**: Recent updates improved Spotlight floor navigation. Ensure Maestri is updated to the latest version. If you consistently land at the wrong position, try setting a "home" position on each Floor by arranging your primary nodes near the canvas origin (0,0).

### Git Operations Fail

**Symptom**: Commit, stash, or branch operations fail silently or produce errors.

**Resolution**: Ensure git is properly configured in the terminal environment Maestri uses. Check that `git-lfs` is discoverable if your repo uses LFS (recent updates fixed git-lfs discovery on more shell setups). Verify your SSH key or credential helper is accessible from Maestri's terminal environment, not just from your usual terminal app. Your [[ssh-config-deep-dive|SSH config]] should include the necessary keys.

### Ombro Not Summarizing

**Symptom**: Ombro's floating window stays empty or doesn't update.

**Resolution**: Ombro requires Apple Silicon and Apple Intelligence enabled in System Settings > Apple Intelligence & Siri. If enabled, check that Maestri has permission to use Apple Intelligence (System Settings > Privacy & Security). Ombro uses heuristic detection of task completion — very short tasks or continuous output streams may not trigger summarization.

### Routines Not Executing

**Symptom**: Scheduled Routines miss their schedule or stop running.

**Resolution**: Recent updates improved scheduler reliability during system idle, but macOS App Nap can still interfere. Ensure Maestri is not being suspended by the system — you can disable App Nap for Maestri specifically:

```bash
defaults write app.maestri.Maestri NSAppSleepDisabled -bool YES
```

Also check that the Routine's shell command exits cleanly. A command that hangs will block the Routine from completing and may prevent the next scheduled run.

### SSH Sessions Disconnecting on Non-Active Floors

**Symptom**: SSH connections on background Floors disconnect due to timeouts.

**Resolution**: Configure `ServerAliveInterval` in your SSH config to send keepalive packets:

```
Host *
    ServerAliveInterval 60
    ServerAliveCountMax 3
```

See [[ssh-config-deep-dive]] for comprehensive SSH connection management. Alternatively, use [[mosh-deep-dive|Mosh]] for connections that need to survive extended periods of inactivity or network changes.

## Related Tutorials

- [[maestri-beginner-guide]] — Getting started with Maestri's core features
- [[ssh-tutorial]] — SSH fundamentals for remote system access
- [[ssh-config-deep-dive]] — Advanced SSH configuration for multi-cluster management
- [[mosh-beginner-guide]] — Persistent remote connections resistant to network changes
- [[mosh-deep-dive]] — Advanced Mosh usage and configuration
- [[honeymux-beginner-guide]] — Terminal multiplexing for SSH sessions
- [[honeymux-deep-dive]] — Advanced Honeymux patterns and workflows
- [[sesh-beginner-guide]] — Session management for terminal environments
- [[sesh-deep-dive]] — Advanced Sesh configuration and usage
- [[openmux-beginner-guide]] — Open-source terminal multiplexing
- [[openmux-deep-dive]] — Advanced OpenMux patterns
- [[hammerspoon-beginner-guide]] — macOS automation scripting
- [[hammerspoon-deep-dive]] — Advanced Hammerspoon workflows and integration
- [[karabiner-elements-deep-dive]] — Custom keyboard shortcuts for workflow acceleration
- [[bunch-beginner-guide]] — Automate macOS app launches and configurations
- [[bunch-deep-dive]] — Advanced Bunch automation patterns
- [[dotfiles-beginner-guide]] — Configuration management fundamentals
- [[dotfiles-deep-dive]] — Advanced dotfile management strategies
- [[chezmoi-beginner-guide]] — Dotfile management with templating
- [[chezmoi-deep-dive]] — Advanced Chezmoi for multi-machine configuration
- [[just-beginner-guide]] — Command runner for common tasks
- [[just-deep-dive]] — Advanced Just patterns and integration
- [[hyperqueue-basics]] — HPC task scheduling with HyperQueue
- [[hyperqueue-deep-dive]] — Advanced HyperQueue workflows
- [[apache-nifi-hpc-sysadmin-beginner-guide]] — Data workflow automation for HPC
- [[apache-nifi-hpc-sysadmin-deep-dive]] — Advanced NiFi patterns for HPC administration
- [[git-worktrees-worktrunk-beginner-guide]] — Git worktrees, conceptually related to Floors
- [[git-worktrees-worktrunk-deep-dive]] — Advanced git worktree strategies
- [[gh-cli-deep-dive]] — GitHub CLI for repository management from the terminal
- [[kubernetes-deep-dive]] — Container orchestration (relevant if managing containerized HPC workloads)
- [[docker-test-container-deep-dive]] — Docker container patterns
- [[linux-permissions-deep-dive]] — Advanced Linux permissions for system administration
- [[macos-app-layout-deep-dive]] — macOS window management strategies
- [[television-deep-dive]] — Terminal-based fuzzy finder for navigating files and data

## References

- [Maestri Official Website](https://www.themaestri.app/en)
- [Maestri Documentation](https://www.themaestri.app/en/docs/intro)
- [Maestri Changelog](https://www.themaestri.app/en/changelog)
- [Maestri on Product Hunt](https://www.producthunt.com/products/maestri)
- [Maestri on Setapp](https://setapp.com/apps/maestri)
- [Maestri on AlternativeTo](https://alternativeto.net/software/maestri/about/)
- [Apple Foundation Models Documentation](https://developer.apple.com/apple-intelligence/)

## Summary

Maestri's value for HPC administrators lies in its spatial approach to multi-system management and its agent orchestration capabilities. The PTY-based communication model means any terminal-based tool — including AI coding agents from any provider — can participate in automated workflows without custom integration work. Floors provide git-backed workspace isolation that maps naturally to cluster separation and incident management. Routines enable lightweight automation for monitoring and maintenance tasks.

The key architectural decisions — native Swift rendering, PTY-level communication, file-backed sticky notes, and on-device AI through Apple Foundation Models — prioritize performance, privacy, and interoperability. For an HPC admin managing multiple clusters, supporting researchers, and maintaining infrastructure-as-code, Maestri offers a unified workspace that grows with your operational complexity.

Advanced usage patterns to explore next include building custom agent role libraries for your team, creating Floor templates for common scenarios (incident response, new project onboarding, cluster migration), and integrating Routines with external alerting systems. Consider combining Maestri with [[hammerspoon-deep-dive|Hammerspoon]] for keyboard-driven workflow automation and [[bunch-deep-dive|Bunch]] for launching your complete Maestri workspace with a single trigger.
