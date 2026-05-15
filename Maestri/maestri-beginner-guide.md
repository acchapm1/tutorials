---
title: "Maestri Beginner Guide — Orchestrate AI Agents on an Infinite Canvas"
date: 2026-05-07
difficulty: beginner
tags: [maestri, macos, ai-agents, terminal, orchestration, hpc, canvas, productivity]
---

# Maestri Beginner Guide

## Overview

Maestri is a native macOS application that gives you an infinite canvas where AI coding agents, terminals, sketches, and notes coexist as visual nodes. Instead of juggling multiple terminal windows and chat interfaces, you arrange everything spatially — drag terminals around, connect agents with lines, and let them communicate through PTY (pseudo-terminal) connections without any API glue or middleware.

For HPC administrators, Maestri offers a fundamentally different way to manage your daily workflow. You can lay out terminal sessions to multiple clusters on a single canvas, attach AI agents that help diagnose job failures or draft Slurm scripts, pin sticky notes with cluster documentation, and switch between isolated workspaces ("Floors") backed by git branches — all from one window.

This guide will walk you through installing Maestri, understanding its core interface, and setting up your first workspace tailored to HPC administration tasks.

### What You Will Learn

- How to install and configure Maestri on macOS
- Navigating the infinite canvas and creating terminal nodes
- Connecting AI agents to terminals for assisted administration
- Using sticky notes for shared context and documentation
- Setting up a basic HPC admin workspace layout
- Understanding Floors, Routines, and workspace navigation

## Prerequisites

Before starting, make sure you have the following:

- **macOS** — Maestri is a macOS-exclusive application built in Swift and SwiftUI. There is no Windows or Linux version.
- **At least one AI coding agent installed** — Maestri orchestrates agents like Claude Code, Codex, Gemini CLI, or OpenCode. You need at least one installed and accessible from your terminal. If you use Claude Code, ensure it is configured and authenticated.
- **Basic terminal familiarity** — You should be comfortable running commands in a terminal. If you manage HPC systems, you almost certainly have this covered. For SSH specifics, see [[ssh-tutorial]] and [[ssh-config-deep-dive]].
- **Apple Silicon or Intel Mac** — Maestri runs on both, though the Ombro AI companion (powered by Apple Foundation Models) requires Apple Silicon with Apple Intelligence enabled.

### Optional but Recommended

- A configured `~/.ssh/config` for your HPC clusters — this makes creating SSH terminal nodes much faster. See [[ssh-config-deep-dive]] for setup guidance.
- [[mosh-beginner-guide|Mosh]] installed on your clusters for persistent connections that survive network interruptions.
- A terminal multiplexer like tmux on your remote systems. Maestri's terminals are local, so for persistent remote sessions you will still want [[honeymux-beginner-guide|Honeymux]], [[sesh-beginner-guide|Sesh]], or [[openmux-beginner-guide|OpenMux]] running on the remote end.

## Key Concepts

### The Infinite Canvas

The canvas is Maestri's core interface. Think of it as a whiteboard where every element — terminals, notes, sketches, agent connections — is a node you can freely position, resize, and connect. You zoom and pan like a design tool (pinch to zoom, two-finger scroll to pan). There are no tabs or splits; spatial arrangement *is* the organizational model.

### Terminal Nodes

Each terminal you create appears as a rectangular node on the canvas. These are fully functional terminal emulators rendered natively in Swift with GPU acceleration. You can run any shell command, SSH into remote systems, or launch AI coding agents inside them. Each terminal node can have its own working directory.

### Agent Connections (PTY Orchestration)

Maestri's signature feature is PTY-based agent orchestration. When you draw a line between two terminal nodes, the agents running inside them can communicate directly — one agent can type into another agent's terminal. This means Claude Code can delegate a task to Codex, or a "reviewer" agent can read the output of a "coder" agent, all without API integrations or copy-pasting.

### Sticky Notes (Shared Context)

Sticky notes on the canvas are saved as markdown files on disk. When you connect an agent to a sticky note, the agent can read from and write to that file. Connect multiple agents to the same note and it becomes shared memory. This is powerful for HPC work: you can maintain a note with cluster status, job queue summaries, or configuration snippets that any agent can reference.

### Floors

A Floor is an isolated copy of your entire workspace — its own canvas, its own terminal layout, optionally backed by a git branch using instant copy-on-write clones. You can toggle a 3D overview to see all Floors at once. For HPC admins, Floors let you maintain separate workspaces for different clusters, projects, or incident investigations without interfering with your primary layout.

### Ombro

Ombro is Maestri's on-device AI companion, powered by Apple Foundation Models (Apple Intelligence). It runs entirely on your Mac with no cloud calls. Ombro monitors your agents in a floating window, summarizes what happened when a task completes, and suggests next steps. It is especially useful when you have multiple agents working simultaneously and need a quick overview of their progress.

### Routines

Routines are scheduled or recurring tasks that Maestri can run automatically. You can set up routines to execute commands at intervals — useful for periodic health checks, log rotations, or monitoring scripts that an HPC admin might want running in the background.

## Step-by-Step Instructions

### Step 1: Install Maestri

Download Maestri from the [Mac App Store](https://apps.apple.com/app/maestri) or from [Setapp](https://setapp.com/apps/maestri) if you have a Setapp subscription. Launch the app after installation.

Maestri offers a free tier that includes one workspace, unlimited agents, the infinite canvas, sketching tools, sticky notes, agent connections, connected notes, and Ombro. The Pro version ($18 one-time) adds unlimited workspaces and workspace navigation shortcuts.

### Step 2: Create Your First Workspace

When you first open Maestri, you will see an empty canvas. Start by setting a working directory for your workspace — this is the folder on disk where Maestri stores sticky note files and workspace metadata.

For an HPC admin workspace, a good choice is a dedicated directory:

```bash
mkdir -p ~/workspaces/hpc-admin
```

Set this as your workspace directory in Maestri's settings or when prompted.

### Step 3: Add Terminal Nodes

Click the "+" button or use the keyboard shortcut to add a new terminal node to the canvas. A terminal appears as a resizable rectangle. You can:

- **Run local commands** — just type in the terminal as you normally would.
- **SSH to a cluster** — type `ssh cluster-name` (or use your SSH config aliases).
- **Launch an AI agent** — type `claude` to start Claude Code, or whatever agent command you prefer.

Create several terminal nodes and arrange them spatially. For example, place your login node sessions across the top, agent terminals in the middle, and monitoring terminals at the bottom.

```bash
# Example: SSH into your HPC cluster login node
ssh hpc-login01

# Example: Start Claude Code in a terminal node
claude

# Example: Check job queue in another terminal
ssh hpc-login01 -t "squeue -u $USER"
```

### Step 4: Create Sticky Notes for Context

Add a sticky note to the canvas (use the note creation button or shortcut). Type or paste useful context — cluster hostnames, common Slurm commands, environment module lists, or troubleshooting checklists.

Since sticky notes are saved as markdown files on disk, they persist across sessions. Example content for an HPC admin sticky note:

```markdown
## Cluster Quick Reference
- Login: hpc-login01, hpc-login02
- Scheduler: Slurm 23.11
- Scratch: /scratch/$USER
- Modules: `module avail` to list
- Job submit: `sbatch script.sh`
- Job status: `squeue -u $USER`
- Cancel job: `scancel <jobid>
```

### Step 5: Connect an Agent to Your Notes

Draw a line from an AI agent terminal to a sticky note. The agent can now read the note's contents as context. When you ask the agent a question about your cluster, it will have the reference information from the note available.

This is particularly useful for maintaining a "runbook" sticky note that any agent can consult when helping you troubleshoot.

### Step 6: Connect Agents to Each Other

If you have multiple agent terminals, draw lines between them to enable PTY communication. For example:

- **Terminal A**: Claude Code (your primary assistant)
- **Terminal B**: A second agent for code review

Connect A to B. Now Claude Code can delegate a review task to the second agent, and you can watch the collaboration happen in real time on the canvas.

### Step 7: Explore Floors

Create a new Floor for a separate context — perhaps a different cluster or an incident investigation. Each Floor gets its own canvas layout and can be backed by a git branch if your workspace is a git repository. Toggle the 3D overview to see all Floors at a glance, then click to switch.

### Step 8: Set Up a Routine

Create a Routine for a recurring task. For an HPC admin, this might be:

- Checking cluster node availability every 30 minutes
- Pulling the latest configuration from a git repository
- Running a quick diagnostic script

Routines execute in the background and their output is available in the Maestri interface.

## Practical Examples

### Example 1: Multi-Cluster Dashboard Layout

Arrange your canvas like a physical operations center:

```
┌─────────────────────────────────────────────────┐
│  [Cluster A Login]    [Cluster B Login]          │
│     ssh hpc-a            ssh hpc-b               │
│                                                   │
│  [Claude Code Agent] ──── [Runbook Note]         │
│     claude                 ## Procedures          │
│                            - Restart steps        │
│  [Monitoring]            [Job Queue Watch]        │
│     htop / ganglia         watch squeue           │
└─────────────────────────────────────────────────┘
```

This layout gives you a spatial overview of your infrastructure. You see cluster sessions, an AI assistant with access to your runbook, and monitoring terminals — all at a glance.

### Example 2: AI-Assisted Slurm Script Writing

1. Create a terminal node and launch Claude Code.
2. Create a sticky note with your cluster's specifications (partition names, GPU types, memory limits, module names).
3. Connect the agent to the sticky note.
4. Ask Claude Code to write a Slurm batch script for your job. The agent reads the cluster specs from the connected note and produces a script tailored to your environment.

```bash
# In the Claude Code terminal, ask:
# "Write a Slurm batch script for a 4-GPU PyTorch training job 
#  on the gpu partition using the specs in the connected note."
```

### Example 3: Incident Investigation Floor

When an issue arises on a cluster:

1. Create a new Floor named "incident-2026-05-07".
2. On that Floor, create terminals SSHed into the affected nodes.
3. Add a sticky note for an incident timeline.
4. Launch an AI agent connected to the timeline note — as you investigate, the agent helps document findings.
5. When resolved, the Floor preserves the entire investigation context for the postmortem.

## Hands-On Exercises

### Exercise 1: Build Your First HPC Canvas

Create a workspace with at least three terminal nodes: one SSHed into a remote system (or localhost if no cluster is available), one running an AI agent, and one for local commands. Arrange them in a layout that feels intuitive. Add a sticky note with system information and connect it to the agent.

### Exercise 2: Agent-to-Agent Delegation

Launch two AI agent terminals (they can be the same agent type). Connect them with a line. In the first agent, ask it to write a shell script for a task (e.g., checking disk usage on `/scratch`). Then ask it to have the second agent review the script. Observe how the PTY connection enables the handoff.

### Exercise 3: Create a Floor for a Side Project

Create a new Floor for a secondary task — perhaps managing [[dotfiles-beginner-guide|dotfiles]] or updating a [[just-beginner-guide|Justfile]]. Switch between Floors to practice the navigation. If your workspace is a git repo, notice how the Floor creates an isolated branch.

### Exercise 4: Schedule a Routine

Set up a Routine that runs `uptime` or `df -h` on a connected terminal every 10 minutes. Check that the routine fires correctly and review its output.

## Troubleshooting

**Maestri won't launch or crashes on startup.** Ensure you are running a supported macOS version. Maestri is built in Swift/SwiftUI and requires a recent macOS release. Check for updates in the App Store.

**Ombro is not available.** Ombro requires Apple Silicon and Apple Intelligence to be enabled in System Settings. If you are on an Intel Mac, Ombro will not be available, but all other Maestri features work normally.

**Terminal rendering is slow or laggy.** Enable GPU-accelerated terminal rendering in Maestri's Settings. This offloads rendering to the GPU and significantly reduces CPU usage.

**SSH connections drop when switching Floors.** Maestri terminals on non-active Floors continue running, but network timeouts can still close idle SSH sessions. Use `ServerAliveInterval` in your SSH config (see [[ssh-config-deep-dive]]) or use [[mosh-beginner-guide|Mosh]] for persistent connections.

**Agent connections don't seem to work.** Ensure both terminal nodes are running and that the agent in the source terminal is actively waiting for input. The PTY connection requires both ends to be in a state where they can send and receive text.

**Routines not firing on schedule.** Recent updates improved scheduler reliability when the system is idle, but macOS power management can still interfere. Ensure your Mac is not in aggressive sleep mode if you need routines to run unattended.

## Related Tutorials

- [[ssh-tutorial]] — Foundational SSH usage for connecting to remote systems
- [[ssh-config-deep-dive]] — Advanced SSH configuration for managing multiple cluster connections
- [[mosh-beginner-guide]] — Persistent remote terminal connections that survive network changes
- [[mosh-deep-dive]] — Advanced Mosh configuration and usage patterns
- [[honeymux-beginner-guide]] — Terminal multiplexing for managing remote sessions
- [[honeymux-deep-dive]] — Advanced Honeymux workflows
- [[sesh-beginner-guide]] — Session management for terminal workflows
- [[openmux-beginner-guide]] — Open-source terminal multiplexer
- [[hammerspoon-beginner-guide]] — macOS automation that can complement Maestri's workflows
- [[karabiner-elements-beginner-guide]] — Custom keyboard shortcuts for faster navigation
- [[bunch-beginner-guide]] — Automate launching app configurations on macOS
- [[dotfiles-beginner-guide]] — Manage your configuration files across machines
- [[chezmoi-beginner-guide]] — Dotfile management with templating for multi-machine setups
- [[just-beginner-guide]] — Command runner for common admin tasks
- [[hyperqueue-basics]] — HPC job scheduling and task management
- [[hyperqueue-deep-dive]] — Advanced HyperQueue patterns for HPC workloads
- [[apache-nifi-hpc-sysadmin-beginner-guide]] — Data workflow automation for HPC environments
- [[git-worktrees-worktrunk-beginner-guide]] — Git worktrees, conceptually similar to Maestri's Floors
- [[macos-app-layout-beginner-guide]] — macOS window and app layout management
- [[linux-permissions-beginner-guide]] — Linux file permissions essential for HPC administration

## References

- [Maestri Official Website](https://www.themaestri.app/en)
- [Maestri Documentation](https://www.themaestri.app/en/docs/intro)
- [Maestri Changelog](https://www.themaestri.app/en/changelog)
- [Maestri on Product Hunt](https://www.producthunt.com/products/maestri)
- [Maestri on Setapp](https://setapp.com/apps/maestri)

## Summary

Maestri provides a spatial, canvas-based approach to terminal and AI agent management on macOS. For HPC administrators, it offers a natural way to visualize multi-cluster workflows — lay out SSH sessions, attach AI assistants with contextual notes, isolate investigations into Floors, and schedule recurring checks with Routines. The PTY-based agent orchestration eliminates the need for API integrations between agents, and Ombro keeps you informed of agent progress without constant monitoring.

Your next steps should be to install Maestri, build a canvas layout that mirrors your cluster infrastructure, and experiment with connecting an AI agent to sticky notes containing your operational documentation. Once comfortable, explore the [[maestri-deep-dive]] for advanced patterns including multi-agent orchestration strategies, Floor-based git workflows, and Routine automation for HPC operations.
