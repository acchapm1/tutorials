---
title: "HyperQueue Basics: Your First Tasks on an HPC Cluster"
date: 2026-04-27
difficulty: beginner
tags: [hyperqueue, hpc, slurm, task-scheduling, meta-scheduler, beginner]
---

# HyperQueue Basics: Your First Tasks on an HPC Cluster

> **Related tutorials:** [[hyperqueue-deep-dive|HyperQueue Deep Dive]] · [[hyperqueue-with-detect-snakemake|HyperQueue + DETECT/Snakemake]]

---

## 1. Overview

HyperQueue (HQ) is a **meta-scheduler** that sits on top of Slurm or PBS. Instead of submitting thousands of individual Slurm jobs — which strains the scheduler and annoys your cluster admins — you submit a few large allocations and let HQ pack your tasks inside them. The result: sub-millisecond task overhead, no admin privileges required, and a single static binary you can drop into `~/bin`.

In this tutorial you will install HQ, learn the server → worker → job → task mental model, submit your first tasks, and shut everything down cleanly. By the end (~30 minutes), you'll have a working HQ setup and a feel for whether it fits your workload.

**What HQ is NOT:** a workflow manager. It doesn't track file dependencies or build DAGs from rules the way [[hyperqueue-deep-dive|Snakemake or Nextflow]] do. It's the layer between your workflow manager and the cluster scheduler.

---

## 2. Prerequisites

- SSH access to an HPC login node (or any Linux box for local experimentation)
- Comfort with the command line — `cd`, `ls`, `chmod`, basic shell scripting
- A terminal multiplexer like `tmux` or `screen` (the HQ server needs to outlive your SSH session — see [[sesh-beginner-guide|Sesh]] if you want a friendlier tmux session manager, or [[mosh-beginner-guide|Mosh]] for persistent remote connections)
- **No root access required.** No modules to load. No dependencies to install.

---

## 3. Key Concepts

HyperQueue has four moving parts. Everything else is detail on top of these:

```
┌──────────────────────────────────────────────────┐
│                   HQ Server                       │
│  (coordinator — runs on login node in tmux)       │
│                                                   │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐         │
│   │ Worker 1│  │ Worker 2│  │ Worker 3│  ...     │
│   │ (node)  │  │ (node)  │  │ (node)  │         │
│   └────┬────┘  └────┬────┘  └────┬────┘         │
│        │            │            │                │
│   ┌────┴────────────┴────────────┴────┐          │
│   │          Job (id=1)               │          │
│   │  Task 1  Task 2  Task 3  Task 4  │          │
│   └───────────────────────────────────┘          │
└──────────────────────────────────────────────────┘
```

| Concept    | What it is | Analogy |
|------------|-----------|---------|
| **Server** | Central coordinator. Accepts job submissions, assigns tasks to workers. | Air traffic control tower |
| **Worker** | A process running on a compute node that executes tasks. One worker per node is typical. | A runway |
| **Job**    | A unit of work you submit. Can contain one task or millions. | A flight manifest |
| **Task**   | A single command execution within a job. The atomic unit of work. | One plane landing |

The server never runs your code — it only dispatches. Workers do the actual computing.

---

## 4. Step-by-Step Instructions

### Step 1: Install HyperQueue

Download the latest static binary from the [GitHub releases page](https://github.com/It4innovations/hyperqueue/releases). No package manager needed, no compilation, no admin privileges.

```bash
# Pick a recent version (check the releases page for the latest)
HQ_VERSION="0.21.0"

# Download and install
curl -L "https://github.com/It4innovations/hyperqueue/releases/download/v${HQ_VERSION}/hq-v${HQ_VERSION}-linux-x64.tar.gz" \
  | tar xz -C ~/.local/bin/

# Verify
hq --version
```

Expected output:

```
HyperQueue CLI v0.21.0
```

> **Tip:** If `~/.local/bin` isn't in your `$PATH`, add it: `export PATH="$HOME/.local/bin:$PATH"` (and put that line in your `.bashrc`).

### Step 2: Start the Server

The server is a long-running process. If it dies, your jobs stop being dispatched. **Always run it in a persistent session** — `tmux`, `screen`, or `nohup`.

```bash
# Start a tmux session (or use screen, or sesh)
tmux new -s hq

# Inside the tmux session, start the server
hq server start
```

Expected output:

```
+-------------------------+---------------------------------------------------+
| Server directory        | /home/acchapm1/.hq-server                         |
| Server UID              | some-uid-here                                     |
| Host                    | login-node-hostname                               |
| Pid                     | 12345                                             |
| HQ port                 | 17002                                             |
| Workers port            | 17003                                             |
| Start date              | 2026-04-27 10:00:00 UTC                           |
| Version                 | 0.21.0                                            |
+-------------------------+---------------------------------------------------+
```

Detach from tmux with `Ctrl-b d`. The server keeps running.

> **Gotcha:** If you start the server in a plain SSH session (no tmux/screen), it dies when you disconnect. This is the #1 beginner mistake. The [[hyperqueue-deep-dive|deep dive]] covers more robust approaches including `systemd --user` units.

### Step 3: Start a Worker (Manual, No Slurm)

For learning, start a worker on the same login node. In production you'd use automatic allocation to let HQ manage Slurm jobs that become workers — but that's [[hyperqueue-deep-dive|deep-dive territory]].

```bash
# In a separate terminal (or another tmux pane)
hq worker start
```

Expected output:

```
+---------------------+----------------------------------------------------+
| Worker ID           | 1                                                  |
| Worker hostname     | login-node-hostname                                |
| Worker directory    | /home/acchapm1/.hq-server/worker1                  |
| CPUs                | 4 (or however many cores the node has)             |
+---------------------+----------------------------------------------------+
```

The worker registers with the server and starts polling for tasks.

### Step 4: Submit Your First Job — Hello World

```bash
hq submit echo "hello from HQ"
```

Expected output:

```
Job submitted successfully, job ID: 1
```

Check on it:

```bash
hq job list
```

```
+----+-------+-------+----------+----------+
| ID | Name  | State | Tasks    | ...      |
+----+-------+-------+----------+----------+
| 1  |       | FINISHED | 1/1   | ...      |
+----+-------+-------+----------+----------+
```

Get the details:

```bash
hq job info 1
```

Read the output:

```bash
hq job cat 1 stdout
```

```
hello from HQ
```

That's it. You submitted a task, HQ dispatched it to the worker, the worker ran it, and you read the result.

### Step 5: Submit a Task Array

Task arrays let you fan out work. Each task gets an environment variable `HQ_TASK_ID` with its index.

```bash
hq submit --array=1-10 -- bash -c 'echo "I am task $HQ_TASK_ID on $(hostname)"'
```

Expected output:

```
Job submitted successfully, job ID: 2
```

Wait a moment, then check results:

```bash
hq job info 2
```

Read output for a specific task:

```bash
hq job cat 2 --tasks=3 stdout
```

```
I am task 3 on login-node-hostname
```

Or read all task outputs:

```bash
for i in $(seq 1 10); do
  echo "--- Task $i ---"
  hq job cat 2 --tasks=$i stdout
done
```

### Step 6: Stop Cleanly

```bash
# Stop all workers (finishes running tasks first)
hq worker stop all

# Stop the server
hq server stop
```

Both commands are graceful — running tasks complete before the process exits.

---

## 5. Practical Examples

### Run a Simple Script Across Multiple Inputs

Imagine you have 5 input files and a script that processes each one:

```bash
# Create some dummy input files
mkdir -p /tmp/hq-demo/inputs /tmp/hq-demo/outputs
for i in $(seq 1 5); do
  echo "data for sample $i" > /tmp/hq-demo/inputs/sample_${i}.txt
done

# Submit a job array that processes each file
hq submit --array=1-5 -- bash -c '
  INPUT="/tmp/hq-demo/inputs/sample_${HQ_TASK_ID}.txt"
  OUTPUT="/tmp/hq-demo/outputs/result_${HQ_TASK_ID}.txt"
  wc -w "$INPUT" > "$OUTPUT"
  echo "Processed sample ${HQ_TASK_ID}"
'
```

### Set Resource Requirements per Task

Even in this basics tutorial, you can request CPUs per task:

```bash
hq submit --cpus=2 --array=1-4 -- bash -c 'echo "Task $HQ_TASK_ID using 2 cores"'
```

HQ will only schedule a task on a worker that has 2 free cores, and it will not oversubscribe. This is far more granular than Slurm job arrays, which give every array element the same full allocation.

---

## 6. Hands-On Exercises

1. **Install and verify:** Download HQ, start a server, start a worker, submit `echo hello`, and read the output. Confirm the job shows `FINISHED` in `hq job list`.

2. **Task array with real work:** Create 20 small text files. Submit a task array that counts lines in each file (`wc -l`) and writes results to an output directory. Verify all 20 outputs exist.

3. **Observe scheduling:** Start a worker with `--cpus=2`. Submit a job array of 10 tasks, each requesting `--cpus=1`. Watch how HQ runs 2 tasks concurrently (since the worker has 2 cores). Then try `--cpus=2` per task and watch them run one at a time.

4. **Stderr and exit codes:** Submit a task that writes to stderr (`echo "oops" >&2`) and one that exits with a non-zero code (`exit 1`). Use `hq job cat <id> stderr` and `hq job info <id>` to see how HQ reports failures.

---

## 7. Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `Connection refused` when running `hq submit` | Server isn't running, or you're on a different node than the server | Start the server, or set `HQ_SERVER_DIR` to point to the server's directory |
| Job stays in `WAITING` state | No workers connected, or workers don't have enough free resources | Start a worker, or reduce the resource request |
| Server dies when you disconnect SSH | Server was started in a bare shell, not tmux/screen | Restart in a `tmux` or `screen` session |
| `hq: command not found` | Binary not in `$PATH` | `export PATH="$HOME/.local/bin:$PATH"` |
| Worker can't connect to server | Firewall between nodes, or server directory not shared | Ensure `~/.hq-server/` is on a shared filesystem (typical on HPC clusters) |

---

## 8. Related Tutorials

- [[hyperqueue-deep-dive|HyperQueue Deep Dive]] — automatic allocation, resource model, output streaming, Python API
- [[hyperqueue-with-detect-snakemake|HyperQueue + DETECT/Snakemake]] — integrating HQ with the DETECT bioinformatics pipeline
- [[sesh-beginner-guide|Sesh Beginner Guide]] — terminal session management (great companion for keeping HQ server alive)
- [[sesh-deep-dive|Sesh Deep Dive]] — advanced session workflows
- [[mosh-beginner-guide|Mosh Beginner Guide]] — persistent remote terminal connections
- [[isaaclab-metagrasp-apptainer-hpc-beginner-guide|IsaacLab MetaGrasp on HPC]] — another HPC workflow using Slurm and Apptainer
- [[isaaclab-metagrasp-apptainer-hpc-deep-dive|IsaacLab MetaGrasp Deep Dive]] — advanced HPC container patterns
- [[kubernetes-beginner-guide|Kubernetes Beginner Guide]] — container orchestration (different paradigm, useful comparison)
- [[linux-permissions-beginner-guide|Linux Permissions Beginner Guide]] — foundational Linux knowledge for HPC work
- [[autoresearch-beginner-guide|Autoresearch Beginner Guide]] — autonomous ML research loop on a single GPU; the deep dive discusses Slurm job arrays as a parallelization vector (comparable to HyperQueue task fans)
- [[autoresearch-deep-dive|Autoresearch Deep Dive]] — Slurm job array sketch for parallel autoresearch variants; contrasts HPC-native job dispatch with the single-GPU autoresearch model

---

## 9. Next Step

You now have HQ running locally with a manual worker. The real power unlock is **automatic allocation** — where HQ submits Slurm jobs on your behalf, scales workers up as tasks queue, and lets allocations expire when work dries up. That one feature eliminates the "submit 10,000 Slurm jobs" antipattern entirely.

Head to [[hyperqueue-deep-dive|HyperQueue Deep Dive]] to set that up.
# Related Tutorials
- [[ssh-tutorial|SSH Tutorial]]
- [[parsl-beginner-guide|Parsl Beginner Guide]] — Python-native parallel workflows on Slurm (alternative approach to HPC task parallelism)
- [[parsl-deep-dive|Parsl Deep Dive]] — advanced Parsl patterns including MPI, monitoring, and production workflows
# 8. Related Tutorials

- [[flux-basics|Flux Basics]] — Flux Framework as an alternative HPC scheduler (also runs inside Slurm allocations)
- [[flux-snakemake-workflows|Flux + Snakemake Workflows]] — running Snakemake on Flux (compare with HyperQueue's executor plugin approach)
- [[flux-advanced-features|Advanced Flux Features]] — hierarchical scheduling and Python SDK for ensemble workflows
