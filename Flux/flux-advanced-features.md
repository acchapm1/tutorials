---
title: "Advanced Flux: Hierarchical Scheduling, Ensemble Workflows, and the Python SDK"
date: 2026-06-01
difficulty: advanced
tags: [flux, hpc, python-sdk, ensemble-workflows, hierarchical-scheduling, fluxion, job-automation]
---

# Advanced Flux: Hierarchical Scheduling, Ensemble Workflows, and the Python SDK

> **Related tutorials:** [[flux-basics|Flux Basics]] · [[flux-system-setup|Flux System Setup]] · [[flux-snakemake-workflows|Flux Snakemake Workflows]] · [[slurm-vs-flux-reference|Slurm vs Flux Reference]]

---

## 1. Overview

This is Tutorial 4 of 4 in the Flux Framework series. You have installed Flux, submitted basic jobs, and wired it into Snakemake. Now you will learn what makes Flux architecturally different from every other HPC scheduler: its hierarchical instance model, event-driven job lifecycle, graph-based resource scheduling, and a first-class Python SDK that treats the scheduler as a programmable service.

**What this tutorial covers:**

- Nested Flux instances — launching schedulers inside schedulers with zero overhead
- Bulk submission patterns — pushing 500-1000 jobs/sec through a single instance
- The `flux.job` Python SDK — submitting, monitoring, and reacting to jobs programmatically
- Event subscriptions — watching job lifecycle events in real time instead of polling
- Fluxion graph scheduler — custom resource constraints, GPU affinity, topology-aware placement
- Production patterns — running Flux sub-instances inside Slurm allocations

**Why this matters:** Most HPC schedulers treat the scheduler as a monolithic service that every user shares. Flux treats it as a composable building block. Once you internalize this, you can build ensemble workflows that would be impossible (or at least deeply painful) with Slurm alone.

---

## 2. Prerequisites

Before starting this tutorial, you should have:

- Completed [[flux-basics|Flux Basics]] (Tutorial 1) — comfortable with `flux run`, `flux submit`, `flux jobs`, `flux start`
- Completed [[flux-snakemake-workflows|Flux Snakemake Workflows]] (Tutorial 3) — have a working Snakemake + Flux executor setup
- **Python 3.8+** with `flux-python` bindings installed (these come with a standard Flux build, or via `pip install flux-python` if available on your system)
- Understanding of Flux instances — you know that `flux start` creates a self-contained scheduler
- Basic comfort with Python async patterns (futures, callbacks)
- Familiarity with Slurm — you will run Flux inside Slurm allocations in several examples

> 📝 **Note:** If your site has Flux deployed as the system scheduler (no Slurm), skip the "Flux Inside Slurm" sections. The hierarchical and Python SDK patterns work identically regardless of what sits above the root instance.

---

## 3. Key Concepts

### The Hierarchical Scheduling Model

Traditional schedulers like Slurm are flat. One instance of `slurmctld` manages all resources, all queues, all users. Every `sbatch` and `srun` call goes through that single point. At scale (>50,000 nodes), this becomes the bottleneck.

Flux is hierarchical by design. Any Flux instance can spawn child instances that manage a subset of resources with a fully independent scheduler. The child instance knows nothing about the parent's other jobs. The parent instance knows nothing about the child's internal task placement. This isolation is not just an implementation detail — it is the core design principle.

### Event-Driven Job Lifecycle

In Slurm, you check on a job's status by polling `sacct` or `squeue`. In Flux, every job emits a stream of lifecycle events that you can subscribe to in real time:

| Event      | Meaning |
|------------|---------|
| `submit`   | Job accepted by the scheduler |
| `depend`   | Dependencies being evaluated |
| `priority` | Priority assigned |
| `alloc`    | Resources allocated |
| `start`    | First task started executing |
| `finish`   | Last task exited |
| `release`  | Resources released back to the scheduler |
| `clean`    | All job data cleaned up |
| `exception`| An error occurred at any stage |

This is not a log you parse after the fact — it is a live event stream you can programmatically subscribe to. The Python SDK makes this trivial.

### Fluxion: The Graph-Based Scheduler

Slurm's scheduler sees resources as a flat list: nodes with cores, memory, and (maybe) GPUs. Fluxion, the default Flux scheduler module, models resources as a hierarchical graph:

```
Cluster
├── Rack 0
│   ├── Node 0
│   │   ├── Socket 0
│   │   │   ├── Core 0..15
│   │   │   └── GPU 0 (A100, NVLink group 0)
│   │   └── Socket 1
│   │       ├── Core 16..31
│   │       └── GPU 1 (A100, NVLink group 0)
│   └── Node 1
│       └── ...
└── Rack 1
    └── ...
```

When you request resources, you are querying this graph. You can ask for "2 GPUs on the same NVLink domain" or "4 nodes in the same rack" — constraints that Slurm handles poorly or not at all.

### Resource Query Language

Fluxion uses a resource query language to express placement constraints. Some examples:

| Constraint | Meaning |
|------------|---------|
| `node[2]:core[4]` | 2 nodes, 4 cores each |
| `node:gpu[2]:core[8]` | 1 node with 2 GPUs and 8 cores |
| `rack:node[4]` | 4 nodes co-located in one rack |

You rarely need to write these by hand — the CLI flags (`-N`, `-n`, `-c`, `-g`) generate them for you. But understanding the graph model helps when you hit edge cases in placement.

---

## 4. Step-by-Step Instructions

### Revisiting the Hierarchical Architecture

Before writing code, internalize this picture. Every example in this tutorial builds on it.

```
┌─────────────────────────────────────────────────────────────────┐
│  Root Flux Instance (full cluster, ~1000 nodes)                 │
│  scheduler: Fluxion (manages all cluster resources)             │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  User Batch Job (allocated 32 nodes via flux batch)       │  │
│  │                                                           │  │
│  │  └── flux start → Flux sub-instance (32 nodes)            │  │
│  │      scheduler: Fluxion (private, manages only 32 nodes)  │  │
│  │                                                           │  │
│  │      ├── Snakemake task 001                                │  │
│  │      ├── Snakemake task 002                                │  │
│  │      ├── Snakemake task 003                                │  │
│  │      │          ...                                        │  │
│  │      └── Snakemake task 500                                │  │
│  │                                                           │  │
│  │  All 500 submissions handled by sub-instance scheduler.   │  │
│  │  Zero load on root. Zero queue contention with others.    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  (other users' jobs run alongside, unaffected)                  │
└─────────────────────────────────────────────────────────────────┘
```

The critical insight: those 500 task submissions never touch the root scheduler. The sub-instance's Fluxion handles all placement decisions locally. Throughput is limited only by the sub-instance, not by the cluster's central scheduler. This is why Flux can sustain 500-1000 jobs/sec per instance — and you can have as many instances as you need.

Compare this to Slurm, where all 500 `sbatch` calls funnel through the single `slurmctld`. Even with Slurm's `--array` optimization, you are still contending with every other user on the cluster for scheduler attention.

> 💡 **Tip:** Think of each Flux instance as a "scheduler VM" — lightweight, isolated, disposable. You would not hesitate to start a new VM for a batch of work. Same mental model applies here.

---

### Nested Flux Instances

Let's create nested instances and observe the hierarchy in action.

**Interactive nesting with `flux alloc`:**

```bash
# From your login shell (inside the root instance, or inside a Slurm allocation):
flux alloc --nslots=4 --cores-per-slot=32
```

You are now inside a sub-instance that owns 4 slots with 32 cores each. Verify:

```bash
flux resource list
```

Expected output:

```
     STATE NNODES   NCORES    NGPUS NODELIST
      free      4      128        0 node[0-3]
 allocated      0        0        0
      down      0        0        0
```

Check your position in the hierarchy:

```bash
flux uptime
```

Expected output:

```
 12:34:56  run 0.5m,  owner uid=1000,  depth=1,  size=4
```

The `depth=1` tells you this is one level below the root instance. The root instance is `depth=0`.

You can also inspect the URI chain:

```bash
echo $FLUX_URI
```

This shows a nested URI like `local:///tmp/flux-XXXX/local-0` — each level gets its own Unix socket.

**Programmatic nesting with `flux batch`:**

For production workflows, use `flux batch` with a heredoc to launch a sub-instance that runs a script:

```bash
flux batch --nslots=128 --cores-per-slot=4 --nnodes=8 <<'BATCH'
#!/bin/bash
echo "Sub-instance started at depth=$(flux getattr instance-level)"
echo "Resources available:"
flux resource list

# Your work goes here — hundreds of flux submit calls,
# a Snakemake run, a Python SDK script, etc.

flux queue drain
echo "All work complete"
BATCH
```

Expected output (when the batch job runs):

```
Sub-instance started at depth=1
Resources available:
     STATE NNODES   NCORES    NGPUS NODELIST
      free      8      512        0 node[10-17]
 allocated      0        0        0
      down      0        0        0
All work complete
```

**Waiting for batch completion:**

```bash
# Submit and capture the job ID
JOBID=$(flux batch --nslots=128 --cores-per-slot=4 --nNodes=8 script.sh)

# Wait for the batch to finish
flux job wait $JOBID

# Or wait for everything in the current instance's queue
flux queue drain
```

> 📝 **Note:** `flux queue drain` blocks until all pending and running jobs in the current instance complete. It is the Flux equivalent of "wait for everything" and is essential in batch scripts to prevent premature exit.

---

### Bulk Submission Patterns

When you need to launch hundreds or thousands of tasks, the submission pattern you choose dramatically affects throughput.

**Pattern 1: Shell Loop (Simple)**

The most straightforward approach. Fine for <100 jobs:

```bash
#!/bin/bash
# submit-loop.sh — submit 100 parameter sweep jobs

for i in $(seq 1 100); do
    flux submit --cores=4 --env=PARAM_IDX=$i ./simulate --seed=$i --output=results/run_${i}.csv
done

echo "All jobs submitted, waiting for completion..."
flux queue drain
echo "Done. Check results/ directory."
```

This works, but each `flux submit` forks a process, connects to the instance, and returns. For large counts, the process overhead adds up.

**Pattern 2: Carbon Copy (--cc)**

Flux's `--cc` flag submits N copies of the same command in a single API call. This is dramatically faster:

```bash
# Submit 1000 copies — one API call, ~1 second
flux submit --cores=2 --cc=1-1000 ./simulate --seed={{cc}} --output=results/run_{{cc}}.csv
```

Inside each copy, `{{cc}}` expands to the copy index (1 through 1000). You can also access it programmatically via the `FLUX_JOB_CC` environment variable.

A more realistic example with environment variable access:

```bash
flux submit --cores=4 --cc=0-499 \
    --env=TASK_ID="{{cc}}" \
    bash -c 'echo "Task $TASK_ID on $(hostname), cores: $FLUX_JOB_NCORES"; ./run_analysis.sh $TASK_ID'
```

**Pattern 3: Throughput Comparison**

To illustrate the difference, here is a rough benchmark:

| Method | Jobs | Wall Time | Throughput |
|--------|------|-----------|------------|
| Slurm `sbatch` loop | 1000 | ~100 sec | ~10 jobs/sec |
| Slurm `--array=1-1000` | 1000 | ~5 sec (submit) | ~200 jobs/sec (submit only) |
| Flux shell loop | 1000 | ~5 sec | ~200 jobs/sec |
| Flux `--cc=1-1000` | 1000 | ~1 sec | ~1000 jobs/sec |
| Flux Python SDK bulk | 1000 | <1 sec | ~1500 jobs/sec |

> ⚠️ **Warning:** Slurm `--array` submit time is fast, but the tasks still go through `slurmctld` for scheduling. With Flux, the sub-instance handles all scheduling locally, so actual task start time is also faster — not just submission time.

The difference becomes enormous at scale. If you have 50,000 short tasks (common in bioinformatics parameter sweeps, ML hyperparameter searches, or ensemble weather models), the Slurm overhead can exceed the actual compute time. Flux eliminates that overhead.

---

### The Flux Python SDK

The Python SDK is where Flux stops being "a better Slurm" and becomes a programmable scheduling service. You interact with the scheduler through a Python handle, submit jobs as objects, and subscribe to events as they happen.

**Basic Job Submission**

```python
#!/usr/bin/env python3
"""basic_submit.py — Submit a single job via the Flux Python SDK."""

import flux
import flux.job

# Connect to the enclosing Flux instance
handle = flux.Flux()

# Build a jobspec: 4 cores, run a command
jobspec = flux.job.JobspecV1.from_command(
    command=["./simulate", "--seed=42", "--output=result.csv"],
    num_tasks=1,
    cores_per_task=4,
)
jobspec.duration = "30m"  # Wall-clock limit

# Submit — returns a job ID immediately
jobid = flux.job.submit(handle, jobspec)
print(f"Submitted job: {flux.job.JobID(jobid)}")

# Wait for the job to complete
status = flux.job.wait(handle, jobid)
if status.success:
    print(f"Job {flux.job.JobID(jobid)} completed successfully")
else:
    print(f"Job failed with return code {status.returncode}")
```

Run it inside a Flux instance:

```bash
flux start python3 basic_submit.py
```

Expected output:

```
Submitted job: f1234ABCD
Job f1234ABCD completed successfully
```

**Bulk Submission with Futures**

For high-throughput submission, use `flux.job.submit_async()` to avoid blocking on each submission:

```python
#!/usr/bin/env python3
"""bulk_submit.py — Submit 500 jobs asynchronously."""

import flux
import flux.job

handle = flux.Flux()

# Submit 500 jobs without waiting for each one
futures = []
for seed in range(500):
    jobspec = flux.job.JobspecV1.from_command(
        command=["./simulate", f"--seed={seed}", f"--output=results/run_{seed}.csv"],
        num_tasks=1,
        cores_per_task=2,
    )
    jobspec.duration = "10m"

    future = flux.job.submit_async(handle, jobspec)
    futures.append(future)

# Now collect all job IDs
jobids = [f.get_id() for f in futures]
print(f"Submitted {len(jobids)} jobs")

# Wait for all to complete
for jobid in jobids:
    flux.job.wait(handle, jobid)

print("All jobs complete")
```

This pattern sustains 1000+ submissions per second because `submit_async` returns immediately — the future is resolved when the scheduler acknowledges the submission. The actual scheduling happens concurrently.

> 💡 **Tip:** For even higher throughput, batch your `submit_async` calls and call `handle.reactor_run()` periodically to process the event loop. This prevents the send buffer from backing up.

**Event Subscriptions**

This is the feature that fundamentally separates Flux from poll-based schedulers. Instead of running `sacct` in a loop, you subscribe to events on a job and react as they happen:

```python
#!/usr/bin/env python3
"""event_watcher.py — Watch lifecycle events for a job."""

import flux
import flux.job

handle = flux.Flux()

# Submit a job
jobspec = flux.job.JobspecV1.from_command(
    command=["sleep", "5"],
    num_tasks=1,
    cores_per_task=1,
)
jobid = flux.job.submit(handle, jobspec)
print(f"Watching events for job {flux.job.JobID(jobid)}:\n")

# Subscribe to all events on this job
for event in flux.job.event_watch(handle, jobid):
    print(f"  [{event.timestamp:.3f}] {event.name}: {event.context}")
    if event.name == "clean":
        break

print("\nJob lifecycle complete.")
```

Expected output:

```
Watching events for job f5678EFGH:

  [1717200000.001] submit: {"userid":1000,"urgency":16,"flags":0}
  [1717200000.005] depend: {}
  [1717200000.006] priority: {"priority":16}
  [1717200000.042] alloc: {}
  [1717200000.089] start: {}
  [1717200005.102] finish: {"status":0}
  [1717200005.110] release: {"ranks":"all","final":true}
  [1717200005.115] clean: {}

Job lifecycle complete.
```

Every event carries a timestamp and a context dictionary. You see exactly when the scheduler allocated resources, when the task started, and when it finished — all without polling. This is fundamentally more powerful than parsing `sacct` output.

> 🔗 **See also:** The `flux.job.event_watch()` iterator is backed by the Flux KVS (Key-Value Store) event log. For details on the KVS, see the [flux-core documentation](https://flux-framework.readthedocs.io/projects/flux-core/).

**Pipeline Manager Example**

Here is a practical example that combines submission, event watching, and dependency tracking into a simple pipeline manager. It submits "stage 1" jobs, watches for completions, then submits "stage 2" jobs that depend on stage 1 results:

```python
#!/usr/bin/env python3
"""pipeline_manager.py — Two-stage pipeline with event-driven progression."""

import flux
import flux.job

handle = flux.Flux()

# --- Stage 1: Preprocessing ---
stage1_ids = []
for sample in range(10):
    spec = flux.job.JobspecV1.from_command(
        command=["bash", "-c", f"echo 'Preprocessing sample {sample}'; sleep 2"],
        num_tasks=1,
        cores_per_task=2,
    )
    spec.duration = "5m"
    jobid = flux.job.submit(handle, spec)
    stage1_ids.append(jobid)

print(f"Stage 1: submitted {len(stage1_ids)} preprocessing jobs")

# --- Watch completions, launch stage 2 as dependencies resolve ---
stage2_ids = []
completed = 0

for jobid in stage1_ids:
    # Wait for this specific job to finish
    for event in flux.job.event_watch(handle, jobid):
        if event.name == "finish":
            completed += 1
            print(f"  Stage 1 job {completed}/10 finished — launching stage 2 downstream")

            # Submit the downstream analysis job
            spec2 = flux.job.JobspecV1.from_command(
                command=["bash", "-c", f"echo 'Analyzing results from sample {completed - 1}'; sleep 1"],
                num_tasks=1,
                cores_per_task=4,
            )
            spec2.duration = "5m"
            stage2_id = flux.job.submit(handle, spec2)
            stage2_ids.append(stage2_id)
            break  # Move to next stage 1 job

# --- Wait for all stage 2 ---
print(f"\nStage 2: submitted {len(stage2_ids)} analysis jobs, waiting...")
for jobid in stage2_ids:
    flux.job.wait(handle, jobid)

print(f"Pipeline complete: {len(stage1_ids)} preprocessing + {len(stage2_ids)} analysis jobs")
```

Run it:

```bash
flux start --test-size=4 python3 pipeline_manager.py
```

Expected output:

```
Stage 1: submitted 10 preprocessing jobs
  Stage 1 job 1/10 finished — launching stage 2 downstream
  Stage 1 job 2/10 finished — launching stage 2 downstream
  Stage 1 job 3/10 finished — launching stage 2 downstream
  ...
  Stage 1 job 10/10 finished — launching stage 2 downstream

Stage 2: submitted 10 analysis jobs, waiting...
Pipeline complete: 10 preprocessing + 10 analysis jobs
```

This 30-line script replaces what would require a combination of `sbatch --dependency`, polling loops, wrapper scripts, and careful PID management in Slurm. The event-driven approach is cleaner, faster, and easier to debug.

---

### Custom Resource Constraints with Fluxion

Fluxion's graph-based scheduler lets you express resource constraints that flat schedulers cannot.

**GPU Affinity**

Request GPUs with topology-aware placement:

```bash
# 2 GPUs, any node
flux run -g 2 ./gpu_task

# 2 GPUs that share an NVLink interconnect (same NUMA domain)
flux run -g 2 --requires="nvlink" ./gpu_task

# 4 GPUs across exactly 2 nodes (2 per node)
flux run -N 2 -g 2 ./distributed_train.py
```

**Inspecting Available Resources**

Use `flux resource list` with format options to see what Fluxion knows about your hardware:

```bash
flux resource list
```

Expected output:

```
     STATE NNODES   NCORES    NGPUS NODELIST
      free      8      256       16 node[0-7]
 allocated      0        0        0
      down      0        0        0
```

For more detail including properties:

```bash
flux resource info
```

This shows the full resource graph — sockets, cores, GPUs, memory, and any custom properties your site administrator has configured.

**GPU Affinity via the Python SDK**

```python
#!/usr/bin/env python3
"""gpu_submit.py — Submit a GPU job with affinity constraints."""

import flux
import flux.job

handle = flux.Flux()

jobspec = flux.job.JobspecV1.from_command(
    command=["python3", "train_model.py", "--epochs=100"],
    num_tasks=1,
    cores_per_task=8,
    num_gpus=2,
)
jobspec.duration = "2h"

# Set GPU affinity through shell options
jobspec.setattr_shell_option("gpu-affinity", "per-task")

jobid = flux.job.submit(handle, jobspec)
print(f"GPU job submitted: {flux.job.JobID(jobid)}")
```

> 📝 **Note:** GPU affinity options depend on your Flux build and site configuration. Run `flux run --help` and check for `--gpu-affinity` or `--requires` options. Not all Flux installations have Fluxion configured with GPU topology — the sysadmin must set up the resource graph with GPU properties. See [[flux-system-setup|Flux System Setup]] for configuration details.

**Constraining by Properties**

If your site has tagged nodes with properties (e.g., `highmem`, `nvlink`, `ssd`), you can require them:

```bash
# Only run on nodes with the "highmem" property
flux run --requires="highmem" --cores=16 ./memory_intensive_task

# Require both a property and GPUs
flux run --requires="nvlink" -g 4 --cores=32 ./multi_gpu_train.py
```

---

### Flux Inside Slurm: Production Pattern

Most HPC sites today still run Slurm as the system scheduler. The recommended production pattern is to request a large Slurm allocation, then start a Flux sub-instance inside it. This gives you all of Flux's benefits without requiring your site to adopt Flux system-wide.

Here is a complete, production-ready sbatch template:

```bash
#!/bin/bash
#SBATCH --job-name=flux-ensemble
#SBATCH --nodes=8
#SBATCH --ntasks-per-node=1
#SBATCH --cpus-per-task=32
#SBATCH --gpus-per-node=4
#SBATCH --time=12:00:00
#SBATCH --partition=gpu
#SBATCH --output=flux-ensemble-%j.out
#SBATCH --error=flux-ensemble-%j.err

# ============================================================
# Flux-inside-Slurm: Production Template
# ============================================================

echo "=== Slurm Allocation ==="
echo "Job ID:    $SLURM_JOB_ID"
echo "Nodes:     $SLURM_JOB_NODELIST"
echo "CPUs/node: $SLURM_CPUS_PER_TASK"
echo "GPUs/node: $SLURM_GPUS_PER_NODE"
echo "Start:     $(date)"
echo ""

# Load Flux (adjust module name for your site)
module load flux/0.64.0

# Start a Flux instance across all allocated nodes.
# srun ensures one Flux broker starts per node.
# Everything inside the heredoc runs within the Flux instance.

srun --mpi=none --ntasks=$SLURM_NNODES flux start bash -c '

    echo "=== Flux Sub-Instance ==="
    flux uptime
    flux resource list
    echo ""

    # ---- Your workflow goes here ----

    # Option A: Snakemake with Flux executor
    snakemake \
        --snakefile workflow/Snakefile \
        --executor flux \
        --profile profiles/flux \
        --jobs 256 \
        --use-singularity \
        --singularity-args "--bind /scratch:/scratch" \
        --rerun-incomplete \
        --keep-going

    # Option B: Python SDK script
    # python3 scripts/ensemble_manager.py

    # Option C: Bulk submission
    # flux submit --cc=1-1000 --cores=4 ./run_analysis.sh

    # ---- Wait for everything to finish ----
    flux queue drain

    echo ""
    echo "=== Flux Work Complete ==="
    flux jobs -a --format="{id.f58} {status_abbrev} {name} {runtime!F}"
    echo ""
'

EXIT_CODE=$?

echo "=== Slurm Job Finished ==="
echo "Exit code: $EXIT_CODE"
echo "End:       $(date)"

exit $EXIT_CODE
```

Submit it as a normal Slurm job:

```bash
sbatch flux-ensemble.sbatch
```

> ⚠️ **Warning:** The `srun --mpi=none` flag is critical. Without `--mpi=none`, Slurm may try to set up an MPI environment that conflicts with Flux's own communication layer. If your site uses PMIx, you may need `--mpi=pmix` instead — check with your admins.

**Key details in this template:**

1. **`--ntasks-per-node=1`**: We want one Flux broker per node, not one per core. Flux manages cores internally.
2. **`flux start` wraps all work**: Everything inside the heredoc runs within the Flux sub-instance. Job submissions, Snakemake calls, Python scripts — all of it goes through Flux's local scheduler.
3. **`flux queue drain`**: This is your "barrier" — it blocks until all submitted work completes. Without it, the script would exit immediately after submission, killing the Flux instance and all running tasks.
4. **`flux jobs -a`**: Print a final summary of all jobs for the log file. Useful for post-run auditing.

> 💡 **Tip:** For long-running workflows, add `flux dmesg --follow &` as a background process inside the heredoc. This streams scheduler debug messages to your Slurm output file, which is invaluable when diagnosing failures.

---

### Debugging and Observability

Flux provides rich introspection tools. Here is your debugging toolkit, organized by what you need to know.

**Scheduler Messages (system-level)**

```bash
# View recent scheduler messages
flux dmesg

# Follow messages in real time (like tail -f for the scheduler)
flux dmesg --follow

# Filter by severity
flux dmesg --severity=err
```

Example output from `flux dmesg`:

```
broker.info[0]: rc1.0: running /etc/flux/rc1.d/01-sched-fluxion
broker.info[0]: rc1.0: /etc/flux/rc1 Exited (rc=0)
broker.info[0]: online: node[0-7] (ranks 0-7)
sched-fluxion-resource.info[0]: populate 8 nodes with 256 cores and 32 gpus
sched-fluxion-resource.info[0]: loaded resources from hwloc
```

**Job-Level Debugging**

```bash
# Get detailed info about a specific job
flux job info <jobid> jobspec
flux job info <jobid> R            # Resource allocation details
flux job info <jobid> eventlog     # Full event history

# More convenient eventlog format
flux job eventlog <jobid>
```

Expected eventlog output:

```
1717200000.001 submit {"userid":1000,"urgency":16,"flags":0}
1717200000.005 depend {}
1717200000.006 priority {"priority":16}
1717200000.042 alloc {"annotations":{"sched":{"resource_summary":"rank[0-1]/core[0-3]"}}}
1717200000.089 start {}
1717200005.102 finish {"status":0}
1717200005.110 release {"ranks":"all","final":true}
1717200005.115 clean {}
```

**Wait for a Specific Event**

```bash
# Block until a job reaches the "start" state
flux job wait-event <jobid> start

# Block until a job is done (finish event)
flux job wait-event <jobid> finish
```

This is useful in scripts where you need to synchronize — for example, waiting until a database server job starts before launching client jobs.

**Resource Status**

```bash
# Show overall resource state
flux resource status

# List drained (offline) nodes
flux resource drain

# Drain a problematic node (admin only in system instances)
flux resource drain node5 "bad memory DIMM"

# Bring it back
flux resource undrain node5
```

**Scheduler Module Statistics**

```bash
# Show Fluxion scheduling statistics
flux module stats sched-fluxion-qmanager
```

Expected output:

```
{
  "queue_depth": 0,
  "submitted": 1500,
  "pending": 0,
  "running": 0,
  "complete": 1500,
  "failed": 3,
  "canceled": 0,
  "schedule_loop_count": 1503
}
```

This tells you how many jobs the scheduler has processed, how many are pending, and how many scheduling loops have run. If `pending` is high and `schedule_loop_count` is not increasing, your scheduler may be stuck.

> 💡 **Tip:** Combine `flux dmesg --follow` with `flux job eventlog` when debugging. The dmesg output shows what the scheduler is doing globally, while the eventlog shows what happened to your specific job. Together, they give you complete visibility.

---

## 5. Practical Examples

### Complete Python SDK Workflow: Submitting a DAG of Dependent Jobs

Here is a fully worked example that submits a directed acyclic graph (DAG) of dependent jobs. This simulates a real-world bioinformatics pipeline with three stages: quality control, alignment, and variant calling. Each stage depends on the previous one, and samples are processed in parallel within each stage.

```python
#!/usr/bin/env python3
"""
dag_workflow.py — Submit a DAG of dependent jobs using the Flux Python SDK.

Pipeline structure:
    QC (per sample, parallel)
    └── Alignment (per sample, parallel, depends on QC)
        └── Variant Calling (per sample, parallel, depends on Alignment)
            └── Merge (single job, depends on all Variant Calling)

Usage:
    flux start --test-size=4 python3 dag_workflow.py
    # or inside an existing Flux instance:
    python3 dag_workflow.py
"""

import flux
import flux.job
import sys
import time

SAMPLES = ["sample_A", "sample_B", "sample_C", "sample_D", "sample_E"]


def make_jobspec(command_str, cores=2, duration="10m"):
    """Helper: build a jobspec from a shell command string."""
    spec = flux.job.JobspecV1.from_command(
        command=["bash", "-c", command_str],
        num_tasks=1,
        cores_per_task=cores,
    )
    spec.duration = duration
    return spec


def wait_for_job(handle, jobid, label=""):
    """Wait for a job to finish and check success."""
    for event in flux.job.event_watch(handle, jobid):
        if event.name == "finish":
            status_code = event.context.get("status", -1)
            if status_code == 0:
                return True
            else:
                print(f"  FAILED: {label} (status={status_code})")
                return False
    return False


def main():
    handle = flux.Flux()
    start_time = time.time()

    print(f"DAG Workflow: {len(SAMPLES)} samples, 3 stages + merge\n")

    # ---- Stage 1: Quality Control ----
    print("Stage 1: Quality Control")
    qc_jobs = {}
    for sample in SAMPLES:
        spec = make_jobspec(
            f"echo '[QC] Processing {sample}...'; sleep 2; echo '[QC] {sample} done'",
            cores=2,
        )
        jobid = flux.job.submit(handle, spec)
        qc_jobs[sample] = jobid
        print(f"  Submitted QC for {sample}: {flux.job.JobID(jobid)}")

    # ---- Wait for Stage 1, launch Stage 2 as each completes ----
    print("\nStage 2: Alignment (launching as QC jobs finish)")
    align_jobs = {}
    for sample, qc_id in qc_jobs.items():
        success = wait_for_job(handle, qc_id, f"QC-{sample}")
        if not success:
            print(f"  Skipping alignment for {sample} due to QC failure")
            continue

        spec = make_jobspec(
            f"echo '[Align] Aligning {sample}...'; sleep 3; echo '[Align] {sample} done'",
            cores=4,
        )
        jobid = flux.job.submit(handle, spec)
        align_jobs[sample] = jobid
        print(f"  QC done for {sample} -> submitted Alignment: {flux.job.JobID(jobid)}")

    # ---- Wait for Stage 2, launch Stage 3 ----
    print("\nStage 3: Variant Calling (launching as alignments finish)")
    vc_jobs = {}
    for sample, align_id in align_jobs.items():
        success = wait_for_job(handle, align_id, f"Align-{sample}")
        if not success:
            print(f"  Skipping variant calling for {sample} due to alignment failure")
            continue

        spec = make_jobspec(
            f"echo '[VC] Calling variants for {sample}...'; sleep 2; echo '[VC] {sample} done'",
            cores=4,
        )
        jobid = flux.job.submit(handle, spec)
        vc_jobs[sample] = jobid
        print(f"  Alignment done for {sample} -> submitted VC: {flux.job.JobID(jobid)}")

    # ---- Wait for all Stage 3, then Merge ----
    print("\nWaiting for all variant calling to complete...")
    for sample, vc_id in vc_jobs.items():
        wait_for_job(handle, vc_id, f"VC-{sample}")

    print("\nStage 4: Merge (single job)")
    sample_list = " ".join(vc_jobs.keys())
    merge_spec = make_jobspec(
        f"echo '[Merge] Merging variants from: {sample_list}'; sleep 1; echo '[Merge] Done'",
        cores=2,
    )
    merge_id = flux.job.submit(handle, merge_spec)
    print(f"  Submitted Merge: {flux.job.JobID(merge_id)}")
    wait_for_job(handle, merge_id, "Merge")

    # ---- Summary ----
    elapsed = time.time() - start_time
    total_jobs = len(qc_jobs) + len(align_jobs) + len(vc_jobs) + 1
    print(f"\n{'='*50}")
    print(f"Pipeline complete!")
    print(f"  Samples processed: {len(vc_jobs)}/{len(SAMPLES)}")
    print(f"  Total jobs:        {total_jobs}")
    print(f"  Wall time:         {elapsed:.1f} seconds")
    print(f"{'='*50}")


if __name__ == "__main__":
    main()
```

Expected output:

```
DAG Workflow: 5 samples, 3 stages + merge

Stage 1: Quality Control
  Submitted QC for sample_A: fBx1K7oR
  Submitted QC for sample_B: fBx1K7oS
  Submitted QC for sample_C: fBx1K7oT
  Submitted QC for sample_D: fBx1K7oU
  Submitted QC for sample_E: fBx1K7oV

Stage 2: Alignment (launching as QC jobs finish)
  QC done for sample_A -> submitted Alignment: fBx1K7oW
  QC done for sample_B -> submitted Alignment: fBx1K7oX
  QC done for sample_C -> submitted Alignment: fBx1K7oY
  QC done for sample_D -> submitted Alignment: fBx1K7oZ
  QC done for sample_E -> submitted Alignment: fBx1K8o1

Stage 3: Variant Calling (launching as alignments finish)
  Alignment done for sample_A -> submitted VC: fBx1K8o2
  Alignment done for sample_B -> submitted VC: fBx1K8o3
  Alignment done for sample_C -> submitted VC: fBx1K8o4
  Alignment done for sample_D -> submitted VC: fBx1K8o5
  Alignment done for sample_E -> submitted VC: fBx1K8o6

Waiting for all variant calling to complete...

Stage 4: Merge (single job)
  Submitted Merge: fBx1K8o7

==================================================
Pipeline complete!
  Samples processed: 5/5
  Total jobs:        16
  Wall time:         22.3 seconds
==================================================
```

> 📝 **Note:** In a real pipeline, you would pass file paths between stages rather than relying on implicit ordering. The Flux KVS or a shared filesystem handles data flow — Flux handles execution flow.

---

## 6. Hands-On Exercises

### Exercise 1: Nested Instance Resource Isolation

**Goal:** Verify that a sub-instance cannot see or use resources outside its allocation.

1. Start a Flux instance with `--test-size=8` (simulates 8 nodes)
2. Use `flux alloc --nslots=2` to get a sub-instance with 2 nodes
3. Inside the sub-instance, run `flux resource list` and confirm you see exactly 2 nodes
4. Try to submit a job requesting 4 nodes — observe the failure
5. Exit the sub-instance, run `flux resource list` again at the parent level — confirm all 8 nodes are visible
6. Verify the parent can still use the 6 unallocated nodes

```bash
# Starter commands
flux start --test-size=8

# Inside the instance:
flux resource list                   # Should show 8 nodes
flux alloc --nslots=2                # Enter sub-instance
flux resource list                   # Should show 2 nodes
flux run -N 4 hostname               # Should FAIL — only 2 nodes available
exit                                 # Back to parent
flux resource list                   # Should show 8 nodes again
```

**What to observe:** Resource isolation is absolute. The sub-instance's scheduler has no concept of the parent's resources beyond what was explicitly allocated.

### Exercise 2: Carbon Copy vs. Loop Throughput

**Goal:** Measure the submission throughput difference between shell loops and `--cc`.

1. Start a Flux instance with `--test-size=4`
2. Submit 200 jobs using a shell `for` loop, time it
3. Submit 200 jobs using `--cc=1-200`, time it
4. Compare wall times

```bash
flux start --test-size=4

# Method 1: Shell loop
time (for i in $(seq 1 200); do flux submit /bin/true; done)
flux queue drain

# Method 2: Carbon copy
time flux submit --cc=1-200 /bin/true
flux queue drain
```

**Expected result:** The `--cc` method should be 5-10x faster for the submission phase.

### Exercise 3: Python SDK Event-Driven Monitor

**Goal:** Write a Python script that submits 50 jobs, watches completion events, and prints a final summary.

Write a script `monitor.py` that:

1. Connects to the Flux instance with `flux.Flux()`
2. Submits 50 jobs (each running `sleep 1`)
3. Uses `flux.job.event_watch()` to watch for `finish` events on each job
4. Tracks success/failure counts
5. Prints a summary: total jobs, successes, failures, and total wall time

Skeleton to get you started:

```python
#!/usr/bin/env python3
"""monitor.py — Exercise: event-driven job monitor."""

import flux
import flux.job
import time

handle = flux.Flux()
start = time.time()

# TODO: Submit 50 jobs with flux.job.submit()
# TODO: Watch each job's events with flux.job.event_watch()
# TODO: Count successes and failures
# TODO: Print summary with wall time

print(f"Wall time: {time.time() - start:.2f}s")
```

Run it with:

```bash
flux start --test-size=4 python3 monitor.py
```

**Bonus:** Modify your script to intentionally fail every 10th job (submit `bash -c "exit 1"` for those) and verify your event watcher correctly catches the non-zero exit status in the `finish` event context.

---

## 7. Troubleshooting

### Python Import Errors

**Symptom:** `ModuleNotFoundError: No module named 'flux'`

The `flux` Python module is built alongside flux-core. It is not available on PyPI as a standalone package for all platforms.

```bash
# Check if flux Python bindings are installed
python3 -c "import flux; print(flux.__file__)"

# If using modules, ensure you load flux before running Python
module load flux
python3 -c "import flux; print('OK')"

# Check PYTHONPATH — flux installs its Python module in a non-standard location
echo $PYTHONPATH
# You may need: export PYTHONPATH=/usr/lib/flux/python3.x:$PYTHONPATH
```

> 💡 **Tip:** If your site installs Flux in a non-standard prefix (e.g., `/opt/flux`), you may need to set `PYTHONPATH=/opt/flux/lib/python3.X/site-packages:$PYTHONPATH`. Ask your sysadmin where the Flux Python bindings are installed.

### Nested Instance Resource Exhaustion

**Symptom:** Jobs in a sub-instance stay in PENDING forever.

```bash
# Check what the sub-instance thinks it has
flux resource list

# Check if resources are drained
flux resource drain

# Check the scheduler's view
flux module stats sched-fluxion-qmanager
```

Common causes:

1. **You requested more resources than the sub-instance has.** The sub-instance only sees what the parent allocated. If you did `flux alloc --nslots=4` and then try to `flux run -N 8`, it will never schedule.
2. **Resources are drained.** A node in the sub-instance may have been marked `down` due to a communication timeout. Check with `flux resource drain`.
3. **Core count mismatch.** If the parent allocated "4 slots with 8 cores each" but your job requests 32 cores per node, it won't fit.

### Event Subscription Timeouts

**Symptom:** `flux.job.event_watch()` hangs indefinitely or raises a timeout error.

```python
# Set an explicit timeout (in seconds)
for event in flux.job.event_watch(handle, jobid, timeout=60.0):
    print(event.name)
```

If a job was canceled or hit an exception before reaching the event you are waiting for, the event stream may never emit that event. Always handle the `exception` event:

```python
for event in flux.job.event_watch(handle, jobid):
    if event.name == "exception":
        print(f"Job hit exception: {event.context}")
        break
    if event.name == "clean":
        break
```

### Fluxion Scheduling Failures

**Symptom:** `flux dmesg` shows messages like `sched-fluxion-resource: match failed` or jobs stay pending with no apparent resource shortage.

```bash
# Check for Fluxion-specific errors
flux dmesg | grep -i "sched\|fluxion\|match"

# Verify the scheduler module is loaded
flux module list | grep sched
```

Common causes:

1. **Unsatisfiable constraints.** Your `--requires` flag asks for a property (e.g., `nvlink`) that no node has. Remove the constraint and retry.
2. **Graph mismatch.** The resource graph was built at instance start and doesn't reflect reality (e.g., a GPU went offline). Restart the instance.
3. **Scheduler module crashed.** Check `flux dmesg` for crash messages. Reload with `flux module reload sched-fluxion-resource`.

### Flux Inside Slurm: Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| `flux start` hangs | Missing `--mpi=none` on srun | Add `srun --mpi=none` |
| Only 1 broker starts | `--ntasks` set to 1 | Set `--ntasks=$SLURM_NNODES` |
| Module load fails | Wrong Flux version or path | Check `module avail flux` |
| `flux resource list` shows 0 nodes | Broker communication timeout | Increase `FLUX_CONNECT_TIMEOUT` |
| Script exits before work finishes | Missing `flux queue drain` | Add it before the closing quote |

---

## 8. References

- **Flux Python SDK documentation:** [flux-framework.readthedocs.io/projects/flux-core/en/latest/python/](https://flux-framework.readthedocs.io/projects/flux-core/en/latest/python/)
- **Fluxion scheduler documentation:** [flux-framework.readthedocs.io/projects/flux-sched/](https://flux-framework.readthedocs.io/projects/flux-sched/)
- **flux-core GitHub repository:** [github.com/flux-framework/flux-core](https://github.com/flux-framework/flux-core)
- **flux-sched (Fluxion) GitHub repository:** [github.com/flux-framework/flux-sched](https://github.com/flux-framework/flux-sched)
- **Flux job submission API (man page):** `man flux-submit`, `man flux-run`, `man flux-batch`
- **Flux at LLNL (production deployment):** [hpc.llnl.gov/software/flux](https://hpc.llnl.gov/software/flux)
- **Flux Python examples:** [github.com/flux-framework/flux-core/tree/master/src/bindings/python/flux/job](https://github.com/flux-framework/flux-core/tree/master/src/bindings/python/flux/job)
- **"Flux: Overcoming Scheduling Challenges for Exascale Workflows"** — Ahn et al., Future Generation Computer Systems, 2020

> 🔗 **See also:** [[slurm-vs-flux-deep-dive|Slurm vs Flux Deep Dive]] for a detailed comparison of scheduling architectures and where Flux's hierarchical model provides concrete advantages.

---

## 9. Summary

This tutorial covered the features that make Flux architecturally distinct from traditional HPC schedulers:

**Key takeaways:**

1. **Hierarchical instances are the core innovation.** Every Flux instance is a fully independent scheduler. Nest them to isolate workloads, eliminate scheduler contention, and scale submission throughput linearly.

2. **Bulk submission is a first-class operation.** The `--cc` flag and Python SDK's `submit_async` let you sustain 1000+ jobs/sec — an order of magnitude faster than Slurm. This matters when you have tens of thousands of short tasks.

3. **Event subscriptions replace polling.** Instead of running `sacct` in a loop, subscribe to job lifecycle events and react in real time. This enables reactive pipelines that launch downstream work the instant upstream work completes.

4. **The Python SDK makes the scheduler programmable.** You are not limited to shell scripts and batch files. You can build sophisticated workflow managers, pipeline controllers, and ensemble drivers in clean Python.

5. **Fluxion's graph scheduler enables topology-aware placement.** GPU affinity, rack locality, NVLink constraints — these are native features, not hacks layered on top.

6. **Flux inside Slurm is a proven production pattern.** You do not need your site to adopt Flux system-wide. Request a Slurm allocation, start a Flux instance, and run your ensemble inside it.

---

## Related Tutorials

- [[flux-basics|Flux Basics]] — Installation, first jobs, core CLI commands
- [[flux-system-setup|Flux System Setup]] — System-level deployment and configuration
- [[flux-snakemake-workflows|Flux Snakemake Workflows]] — Integrating Snakemake with the Flux executor
- [[slurm-vs-flux-reference|Slurm vs Flux Reference]] — Command-by-command comparison
- [[slurm-vs-flux-deep-dive|Slurm vs Flux Deep Dive]] — Architectural comparison and decision framework
- [[hyperqueue-deep-dive|HyperQueue Deep Dive]] — An alternative meta-scheduler approach
- [[hyperqueue-with-detect-snakemake|HyperQueue with DETECT Snakemake]] — HyperQueue integration with Snakemake pipelines
- [[parsl-deep-dive|Parsl Deep Dive]] — Python-native parallel workflows
- [[cgroups-deep-dive|Cgroups Deep Dive]] — Linux resource isolation (used by Flux internally)

---

## Next Steps

Put your new knowledge into practice. Write a 20-line Python script using the Flux SDK that:

1. Connects to the enclosing Flux instance
2. Submits 50 jobs (each running `echo "Job $i complete" && sleep 1`)
3. Watches completion events using `flux.job.event_watch()`
4. Counts successes and failures
5. Prints a final summary: total jobs, pass/fail counts, total wall time

Test it with:

```bash
flux start --test-size=4 python3 my_monitor.py
```

Once you are comfortable with programmatic job management, explore [[flux-system-setup|Flux System Setup]] to understand how Flux is deployed at the system level — broker configuration, resource graph setup, multi-user security, and integration with site authentication. That knowledge will help you work effectively with your site admins to get Flux deployed as a first-class scheduler on your cluster.
