---
title: "HyperQueue Deep Dive: Production HPC Task Scheduling"
date: 2026-04-27
difficulty: advanced
tags: [hyperqueue, hpc, slurm, task-scheduling, meta-scheduler, automatic-allocation, gpu, python-api, advanced]
---

# HyperQueue Deep Dive: Production HPC Task Scheduling

> **Related tutorials:** [[hyperqueue-basics|HyperQueue Basics]] · [[hyperqueue-with-detect-snakemake|HyperQueue + DETECT/Snakemake]]

---

## 1. Overview

This reference covers everything you need to run HyperQueue in production on a Slurm cluster: automatic allocation (the killer feature), the rich resource model, output streaming for filesystem hygiene, failure handling, the Python API, and operational concerns.

**Assumed baseline:** You've worked through [[hyperqueue-basics|the basics tutorial]] — you can start a server, start a worker, submit a job, and read output. If not, start there.

**Authoritative docs:** [https://it4innovations.github.io/hyperqueue/stable/](https://it4innovations.github.io/hyperqueue/stable/) — this tutorial summarizes and contextualizes; the official docs are the source of truth.

---

## 2. Prerequisites

- Everything from [[hyperqueue-basics|the basics tutorial]]
- An active Slurm account with at least one accessible partition (know your `--partition` and `--account` values)
- Familiarity with Slurm concepts: partitions, accounts, `sbatch`, `squeue`, `sacct`
- Python 3.8+ if you want to use the Python API
- `tmux` or `screen` for persistent server sessions (see [[sesh-beginner-guide|Sesh]] or [[sesh-deep-dive|Sesh Deep Dive]])

---

## 3. Key Concepts

### The Allocation Lifecycle

In the basics tutorial, you started workers manually. In production, HQ manages Slurm allocations for you:

```
You submit tasks to HQ
        │
        ▼
HQ sees pending tasks, submits Slurm jobs ("allocations")
        │
        ▼
Slurm schedules the jobs onto compute nodes
        │
        ▼
Each allocation starts an HQ worker automatically
        │
        ▼
Workers pull tasks from the server and execute them
        │
        ▼
When the task queue empties, allocations expire naturally
```

This is the core value proposition: you think in tasks, HQ thinks in allocations, and Slurm thinks in jobs. Nobody submits 10,000 Slurm jobs.

### Resource Dimensions

HQ tracks multiple resource dimensions per worker and per task:

- **CPUs** — integer or fractional
- **GPUs** — integer or fractional (e.g., `0.5` means two tasks share one GPU)
- **Memory** — not tracked by default; use generic resources if needed
- **Generic resources** — anything you define (e.g., `licenses=2`)

Tasks are only scheduled on workers with enough of every requested resource.

---

## 4. Step-by-Step Instructions

### 4.1 Automatic Allocation

This is the feature that justifies HQ's existence on a Slurm cluster. Reference: [Automatic Allocation docs](https://it4innovations.github.io/hyperqueue/stable/deployment/allocation/).

**Set up an allocation queue:**

```bash
hq alloc add slurm \
  --time-limit 4h \
  --workers-per-alloc 1 \
  --backlog 2 \
  --max-worker-count 10 \
  -- \
  --partition=general \
  --account=pfeiferlab \
  --mem=32G
```

Let's unpack every flag:

| Flag | What it does |
|------|-------------|
| `--time-limit 4h` | Each Slurm allocation runs for up to 4 hours. HQ won't submit new work to an allocation with <5 min left. |
| `--workers-per-alloc 1` | One HQ worker per Slurm job. Increase for multi-node allocations. |
| `--backlog 2` | HQ keeps 2 allocations queued in Slurm beyond what's currently running. As one finishes, another is already waiting. This smooths out Slurm queue delays. |
| `--max-worker-count 10` | Never have more than 10 active workers at once. Safety valve for your fairshare. |
| Everything after `--` | Passed verbatim to `sbatch`. Use your cluster's partition, account, QOS, constraints, etc. |

**What happens next:**

1. You submit tasks with `hq submit ...`
2. HQ notices pending tasks and submits Slurm jobs via `sbatch`
3. As those Slurm jobs start, they automatically launch HQ workers
4. Workers pull tasks, execute them, report results
5. When the task queue empties and the backlog drains, allocations expire naturally

**Monitor your allocations:**

```bash
# See allocation queue status
hq alloc list

# See individual allocations (Slurm jobs)
hq alloc info 1
```

**Remove an allocation queue** (running tasks finish, but no new allocations are submitted):

```bash
hq alloc remove 1
```

> **Tuning `--backlog`:** On clusters with long queue wait times, increase the backlog (e.g., `--backlog 4`) so there's always an allocation warming up. On clusters with instant scheduling, `--backlog 1` is fine.

> **Tuning `--time-limit`:** Shorter time limits get through the Slurm queue faster (backfill scheduling). 1–4 hours is the sweet spot for most clusters. Don't use 24h unless your tasks genuinely need it — you'll wait longer in the queue and waste allocation time at the tail end.

### 4.2 Resources

Reference: [Resource docs](https://it4innovations.github.io/hyperqueue/stable/jobs/resources/) and [Consumable resources](https://it4innovations.github.io/hyperqueue/stable/jobs/cresources/).

**CPUs:**

```bash
# Request 4 CPUs per task
hq submit --cpus=4 -- my_program

# Request a range — HQ assigns between 2 and 8 based on availability
hq submit --cpus="2-8" -- my_program
```

**GPUs:**

```bash
# One full GPU per task
hq submit --resource "gpus=1" -- python train.py

# Half a GPU per task (two tasks share one GPU)
hq submit --resource "gpus=0.5" -- python inference.py
```

Fractional GPUs are a game-changer for inference workloads and small models that don't saturate a full GPU. HQ sets `CUDA_VISIBLE_DEVICES` for each task so they don't step on each other.

**Resource variants** — "give me this OR that":

```bash
# Run on 1 GPU + 4 CPUs, OR fall back to 16 CPUs if no GPU is free
hq submit \
  --resource "gpus=1" --cpus=4 \
  --resource "cpus=16" \
  -- my_program
```

HQ tries the first variant; if no worker can satisfy it, it falls back to the second. Your program checks `HQ_RESOURCE_VARIANT` to know which it got.

**Generic (custom) resources:**

When starting a worker, declare what it has:

```bash
hq worker start --resource "licenses=4"
```

Then request it:

```bash
hq submit --resource "licenses=1" -- licensed_tool --input data.txt
```

This is perfect for floating license pools.

**NUMA-aware scheduling:**

For latency-sensitive work, use related resources so CPUs and GPUs are on the same NUMA domain:

```bash
hq worker start --cpus="[[0-3], [4-7]]" --resource "gpus=related[[0], [1]]"
```

This tells HQ that CPUs 0–3 and GPU 0 are on the same NUMA node, and CPUs 4–7 with GPU 1 are on the other. Tasks requesting both CPUs and a GPU get co-located resources.

### 4.3 Job Arrays and Task Graphs

Reference: [Job file docs](https://it4innovations.github.io/hyperqueue/stable/jobs/jobfile/).

**Basic array** (you saw this in [[hyperqueue-basics|the basics]]):

```bash
hq submit --array=1-1000 -- bash -c 'process_sample $HQ_TASK_ID'
```

**TOML job definition** — for complex jobs, define everything in a file:

```toml
# job.toml
[[task]]
id = 1
command = ["bash", "-c", "echo 'step 1: preprocess' && sleep 2"]

[[task]]
id = 2
command = ["bash", "-c", "echo 'step 2: analyze'"]
deps = [1]   # waits for task 1 to finish

[[task]]
id = 3
command = ["bash", "-c", "echo 'step 3: report'"]
deps = [2]
```

Submit it:

```bash
hq job submit-file job.toml
```

This gives you a simple DAG within a single HQ job. For complex DAGs with file dependencies, you'll want a real workflow manager like Snakemake sitting on top of HQ — see [[hyperqueue-with-detect-snakemake|the DETECT integration tutorial]].

**Open jobs** — submit tasks to a job incrementally:

```bash
# Create an open job
JOB_ID=$(hq job open)

# Add tasks as you discover them
hq job submit-task $JOB_ID -- process file1.txt
hq job submit-task $JOB_ID -- process file2.txt

# Close when done
hq job close $JOB_ID
```

### 4.4 Output Streaming

Reference: [Streaming docs](https://it4innovations.github.io/hyperqueue/stable/jobs/streaming/).

By default, HQ writes one stdout and one stderr file per task. With 100,000 tasks, that's 200,000 small files — a metadata nightmare on Lustre or GPFS.

**Output streaming** consolidates all task output into a single log file:

```bash
hq submit --stream=logs/ --array=1-100000 -- bash -c 'echo "result for $HQ_TASK_ID"'
```

This creates a single binary log file in `logs/` instead of 100,000 individual files. Your parallel filesystem will thank you.

**Read streamed output back:**

```bash
# Read all output
hq output-log logs/job-3.log stdout

# Read output for a specific task
hq output-log logs/job-3.log stdout --task=42
```

> **When to use it:** Always, for task counts above ~1,000. The filesystem overhead of many small files is a real production issue — metadata operations on Lustre scale poorly, and you can hit inode quotas. This is especially relevant for bioinformatics workflows where per-sample tasks number in the tens of thousands.

### 4.5 Failure Handling

**Automatic retries:**

```bash
# Retry failed tasks up to 3 times
hq submit --max-retries=3 --array=1-1000 -- my_flaky_script.sh
```

**Crash limit** — stop the whole job if too many tasks fail:

```bash
# Abort if more than 50 tasks fail
hq submit --crash-limit=50 --array=1-10000 -- process.sh
```

**Max fails** — let the job continue but cap failures:

```bash
hq submit --max-retries=2 --array=1-1000 -- my_script.sh
```

Check which tasks failed:

```bash
hq job info <id> --tasks
```

### 4.6 Dashboard and Monitoring

**Interactive dashboard:**

```bash
hq dashboard
```

This opens a TUI showing workers, jobs, task progress, and resource utilization in real time. Hit `q` to quit.

**Programmatic monitoring:**

```bash
# Job progress (good for scripts)
hq job progress <id>

# JSON output for scripting
hq --output-mode json job list
hq --output-mode json worker list
```

The JSON output mode is useful for building monitoring scripts or feeding metrics to your team's dashboards.

### 4.7 Python API

Reference: [Python API docs](https://it4innovations.github.io/hyperqueue/stable/python/).

Install the Python package:

```bash
pip install hyperqueue
```

A 15-line example submitting a small DAG:

```python
from hyperqueue import Client, Job
from hyperqueue.task.function import PythonEnv

client = Client()
env = PythonEnv()

job = Job()

# Define tasks
t1 = job.function(lambda: {"preprocessed": True}, name="preprocess", env=env)
t2 = job.function(lambda: {"analyzed": True}, name="analyze", env=env, deps=[t1])
t3 = job.function(lambda: print("Pipeline complete!"), name="report", env=env, deps=[t2])

# Submit and wait
submitted = client.submit(job)
client.wait_for_jobs([submitted])
print(f"Job {submitted} finished.")
```

The Python API is particularly useful when your task parameters come from a Python script (e.g., parameter sweeps, ML hyperparameter searches).

### 4.8 Operational Concerns

**Server persistence:**

The HQ server must stay running for the entire lifetime of your workload. Options, from simplest to most robust:

| Method | Pros | Cons |
|--------|------|------|
| `tmux` / `screen` session | Dead simple, no config | Dies if the login node reboots |
| `nohup hq server start &` | No tmux dependency | Harder to reattach for debugging |
| `systemd --user` unit | Survives login node reboots, auto-restarts | Requires a bit of setup |

For a `systemd --user` unit:

```ini
# ~/.config/systemd/user/hq-server.service
[Unit]
Description=HyperQueue Server
After=network.target

[Service]
ExecStart=%h/.local/bin/hq server start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now hq-server
loginctl enable-linger acchapm1  # keeps user services running after logout
```

**Server state location:**

Everything lives in `~/.hq-server/` by default. Override with `HQ_SERVER_DIR`:

```bash
export HQ_SERVER_DIR="/scratch/acchapm1/.hq-server"
```

If the login node reboots, just restart the server pointing at the same directory. Completed job history is preserved; in-flight tasks will need resubmission.

**Backup and recovery:**

The server state directory is the single source of truth. For critical workloads, periodically snapshot it:

```bash
cp -r ~/.hq-server/ ~/.hq-server-backup-$(date +%Y%m%d)
```

### 4.9 When NOT to Use HQ

HQ shines for the "many small tasks" pattern. It's the wrong tool when:

- **Your jobs are already chunky** — if each step runs for hours on multiple nodes, plain `sbatch` is fine. The per-job overhead of Slurm doesn't matter when the job runs for 6 hours.
- **You have fewer than ~50 tasks** — the setup overhead (server, allocation queue) isn't justified. Just use `sbatch` or a Slurm job array.
- **You need MPI across nodes within a single task** — HQ tasks are node-local. For multi-node MPI, submit through Slurm directly.
- **Your cluster already has a pilot job system** — if your site runs Balsam or RADICAL-Pilot, check whether it meets your needs before adding another tool.

---

## 5. Practical Examples

### Bioinformatics: Per-Sample Variant Calling

```bash
# Assume 500 BAM files named sample_001.bam through sample_500.bam
hq submit \
  --array=1-500 \
  --cpus=4 \
  --stream=logs/ \
  -- bash -c '
    SAMPLE=$(printf "sample_%03d" $HQ_TASK_ID)
    gatk HaplotypeCaller \
      -R reference.fa \
      -I ${SAMPLE}.bam \
      -O ${SAMPLE}.g.vcf.gz \
      --native-pair-hmm-threads 4
  '
```

### ML: Hyperparameter Sweep with Fractional GPUs

```bash
# 100 training runs, each using half a GPU
hq submit \
  --array=1-100 \
  --resource "gpus=0.5" \
  --cpus=2 \
  --stream=logs/ \
  -- bash -c '
    python train.py \
      --lr $(python -c "import random; random.seed($HQ_TASK_ID); print(round(random.uniform(1e-5, 1e-2), 6))") \
      --run-id $HQ_TASK_ID
  '
```

### Embarrassingly Parallel File Processing with Output Streaming

```bash
# Process 50,000 JSON files, stream all output to a single log
hq submit \
  --array=1-50000 \
  --cpus=1 \
  --stream=output_logs/ \
  -- bash -c '
    INPUT="data/chunk_${HQ_TASK_ID}.json"
    OUTPUT="results/result_${HQ_TASK_ID}.json"
    python process.py "$INPUT" > "$OUTPUT"
  '

# Later, check for failures
hq --output-mode json job info <id> | python -c "
import json, sys
info = json.load(sys.stdin)
print(f'Completed: {info[\"finished\"]}, Failed: {info[\"failed\"]}')
"
```

---

## 6. Comparison Table

| Feature | HyperQueue | Parsl | Dask-Jobqueue | Slurm Job Arrays |
|---------|-----------|-------|---------------|------------------|
| **Task overhead** | ~0.1 ms | ~10 ms | ~100 ms | ~1–5 s |
| **DAG support** | TOML job files, Python API | Native (Python decorators) | Dask graph | None |
| **Fractional GPUs** | Yes | No | No | No |
| **Resource variants** | Yes | No | No | No |
| **Language coupling** | None (CLI, TOML, Python) | Python only | Python only | Shell |
| **Install complexity** | Single binary, no deps | `pip install parsl` + config | `pip install dask-jobqueue` | Built in |
| **Automatic scaling** | Built-in allocation manager | Via providers | Via `adapt()` | Manual (`--array`) |
| **Output streaming** | Yes (single file) | No | No | No |
| **Admin required** | No | No | No | No |

---

## 7. Hands-On Exercises

1. **Automatic allocation dry run:** Set up an allocation queue with `--max-worker-count 2` and `--backlog 1`. Submit 20 tasks requesting 1 CPU each. Watch `hq alloc list` and `squeue -u $USER` to see HQ managing Slurm jobs. Note how allocations appear and disappear.

2. **Fractional GPU experiment:** If you have GPU access, start a worker on a GPU node and submit 4 tasks each requesting `--resource "gpus=0.25"`. Verify all 4 run concurrently on one GPU by checking `HQ_TASK_ID` and `CUDA_VISIBLE_DEVICES` in the output.

3. **Output streaming at scale:** Submit a 1,000-task array with `--stream`. Compare the number of files created vs. a 1,000-task array without streaming. Time the `ls` command in both output directories on a Lustre filesystem to feel the metadata difference.

4. **Failure handling:** Submit a 100-task array where tasks with `HQ_TASK_ID` divisible by 7 exit with code 1. Set `--max-retries=2` and `--crash-limit=20`. Observe which tasks get retried and when the job stops.

5. **Python API DAG:** Using the Python API, create a 3-stage pipeline: stage 1 generates data (5 parallel tasks), stage 2 processes data (5 parallel tasks, each depending on one stage-1 task), stage 3 aggregates (1 task depending on all stage-2 tasks).

---

## 8. Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| Allocations stuck in `QUEUED` state | Slurm queue is full, or partition/account is wrong | Check `squeue -u $USER`, verify partition and account names |
| Tasks run but produce no output files | Working directory mismatch — tasks run from the worker's directory, not yours | Use absolute paths in your commands, or set `--cwd` |
| `hq alloc add` fails with "server not found" | Server isn't running or `HQ_SERVER_DIR` isn't set | Start server, or export `HQ_SERVER_DIR` |
| Worker starts but gets no tasks | Resource mismatch — tasks request more resources than the worker has | Check `hq worker info <id>` for available resources vs. task requirements |
| "Too many open files" on the worker | Thousands of tasks writing individual output files | Use `--stream` for output streaming |
| Allocation expires mid-task | `--time-limit` is shorter than the longest task runtime | Increase `--time-limit`, or break long tasks into smaller units |
| Server state corrupted after crash | Rare — usually a hard login-node kill | Delete `~/.hq-server/` and restart. In-flight job history is lost. |

---

## 9. References

- [HyperQueue Official Documentation](https://it4innovations.github.io/hyperqueue/stable/)
- [HyperQueue GitHub Repository](https://github.com/It4innovations/hyperqueue)
- [Automatic Allocation Guide](https://it4innovations.github.io/hyperqueue/stable/deployment/allocation/)
- [Resource Management](https://it4innovations.github.io/hyperqueue/stable/jobs/resources/)
- [Consumable Resources](https://it4innovations.github.io/hyperqueue/stable/jobs/cresources/)
- [Job File Format (TOML)](https://it4innovations.github.io/hyperqueue/stable/jobs/jobfile/)
- [Output Streaming](https://it4innovations.github.io/hyperqueue/stable/jobs/streaming/)
- [Python API](https://it4innovations.github.io/hyperqueue/stable/python/)
- [Snakemake HyperQueue Executor Plugin](https://github.com/snakemake/snakemake-executor-plugin-hyperqueue)

---

## 10. Related Tutorials

- [[hyperqueue-basics|HyperQueue Basics]] — installation, mental model, first tasks
- [[hyperqueue-with-detect-snakemake|HyperQueue + DETECT/Snakemake]] — integrating HQ as middleware for the DETECT bioinformatics pipeline
- [[sesh-beginner-guide|Sesh Beginner Guide]] — terminal session management for keeping HQ server alive
- [[sesh-deep-dive|Sesh Deep Dive]] — advanced tmux session workflows
- [[mosh-beginner-guide|Mosh Beginner Guide]] — persistent remote connections to HPC login nodes
- [[mosh-deep-dive|Mosh Deep Dive]] — advanced Mosh usage
- [[isaaclab-metagrasp-apptainer-hpc-beginner-guide|IsaacLab MetaGrasp on HPC]] — another HPC workflow pattern with Slurm and containers
- [[isaaclab-metagrasp-apptainer-hpc-deep-dive|IsaacLab MetaGrasp Deep Dive]] — advanced Apptainer/Slurm patterns
- [[kubernetes-beginner-guide|Kubernetes Beginner Guide]] — container orchestration (different paradigm than HQ, but useful mental model comparison)
- [[linux-permissions-beginner-guide|Linux Permissions]] — foundational for understanding shared filesystem access on clusters

---

## 11. Next Step

If you run a Snakemake-based pipeline on Slurm (especially one with many short per-sample rules), the natural next move is to slot HQ between Snakemake and Slurm as middleware. The [[hyperqueue-with-detect-snakemake|DETECT/Snakemake integration tutorial]] walks through exactly that — including the executor plugin, resource mapping, and an A/B evaluation plan.
# Related Tutorials
- [[ssh-tutorial|SSH Tutorial]]

- [[cgroups-beginner-guide|Cgroups Beginner Guide]] — Linux control groups for resource management on HPC
- [[cgroups-deep-dive|Cgroups Deep Dive]] — How Slurm uses cgroups for job isolation and accounting
- [[animation-toolkit-for-hpc-talks-beginner-guide|Animation Toolkit for HPC Talks]] — Animate HPC concepts for conference presentations
# 10. Related Tutorials

- [[maestri-beginner-guide|Maestri Beginner Guide]] — Orchestrate AI agents on an infinite canvas for HPC administration tasks
- [[maestri-deep-dive|Maestri Deep Dive]] — Advanced Maestri patterns including HyperQueue management through AI-assisted terminal workflows

- [[parsl-beginner-guide|Parsl Beginner Guide]] — Python-native parallel workflows on Slurm (complementary approach — Parsl builds task DAGs in Python, HQ dispatches tasks to allocations)
- [[parsl-deep-dive|Parsl Deep Dive]] — advanced Parsl patterns including MPI executors, monitoring, and production workflows

- [[flux-basics|Flux Basics]] — Flux Framework as an alternative HPC scheduler with hierarchical architecture
- [[flux-advanced-features|Advanced Flux Features]] — nested instances and Python SDK (compare with HyperQueue's automatic allocation model)
