---
title: "Getting Started with Flux: Core Concepts and Commands for Slurm Users"
date: 2026-06-01
difficulty: beginner
tags: [flux, hpc, slurm, job-scheduling, cluster-computing, resource-management]
---

# Getting Started with Flux: Core Concepts and Commands for Slurm Users

> **Related tutorials:** [[flux-system-setup|Flux System Setup]] · [[slurm-vs-flux-reference|Slurm vs Flux Reference]] · [[slurm-vs-flux-deep-dive|Slurm vs Flux Deep Dive]] · [[flux-advanced-features|Advanced Flux Features]]

---

## 1. Overview

Flux Framework is a next-generation resource manager and job scheduler for HPC clusters. Developed at Lawrence Livermore National Laboratory (LLNL) — the same lab that created Slurm — Flux rethinks how clusters allocate resources and schedule work. Instead of Slurm's flat, centralized model, Flux uses a fully hierarchical architecture where every allocation is itself a Flux instance that can further subdivide and schedule resources independently.

In this tutorial you will install Flux in user space via conda/mamba, start a Flux instance inside an existing Slurm allocation, learn the core Flux commands alongside their Slurm equivalents, submit your first jobs, and understand Flux's resource model. By the end (~45 minutes), you'll be running parallel workloads under Flux without touching your cluster's Slurm configuration.

**This is Tutorial 1 of 4 in the Flux Framework series.** It covers user-space basics. The remaining tutorials cover [[flux-system-setup|system-level deployment]], [[flux-snakemake-workflows|Snakemake integration]], and [[flux-advanced-features|advanced scheduling features]].

---

## 2. Prerequisites

- An active account on a Slurm-managed HPC cluster with SSH access
- Working familiarity with `sbatch`, `srun`, `squeue`, `scancel`, and `salloc`
- `mamba` or `conda` installed in your home directory (see [[pixi-beginner-guide|Pixi Beginner Guide]] for an alternative package manager)
- Basic comfort with shell scripting and environment modules
- At least one allocation you can request (even a single-node interactive job works)

> 📝 **Note:** No root access is required. Everything in this tutorial runs in user space inside your existing Slurm allocation. Your cluster admins will not notice a thing.

---

## 3. Key Concepts

### Centralized vs. Hierarchical Scheduling

Slurm uses a centralized architecture: one `slurmctld` daemon manages the entire cluster. Every job submission, every status query, and every cancellation goes through that single coordinator. This works, but it creates a bottleneck at scale — Slurm clusters with 10,000+ nodes need careful tuning to keep the controller responsive.

Flux takes a fundamentally different approach. Every Flux allocation is a fully functional scheduler instance. A top-level Flux instance manages the entire cluster, but when it grants resources to a job, that job gets its own nested Flux instance. That nested instance can further subdivide its resources. The result is a tree of schedulers, each responsible for its own slice of the cluster.

```
Slurm Architecture              Flux Architecture
==================               ==================

   ┌──────────┐                   ┌──────────┐
   │ slurmctld│                   │ Flux Root│
   │ (single) │                   │ Instance │
   └────┬─────┘                   └──┬───┬───┘
        │                            │   │
  ┌─────┼─────┐               ┌──────┘   └──────┐
  │     │     │               │                 │
┌─┴─┐ ┌─┴─┐ ┌─┴─┐         ┌───┴───┐         ┌───┴───┐
│N1 │ │N2 │ │N3 │         │ Sub   │         │ Sub   │
└───┘ └───┘ └───┘         │ Flux  │         │ Flux  │
                          │ Inst. │         │ Inst. │
                          └─┬──┬──┘         └───────┘
                            │  │
                         ┌──┘  └──┐
                         │        │
                       ┌─┴─┐   ┌──┴─┐
                       │N1 │   │N2  │
                       └───┘   └────┘
```

### Graph-Based Resource Model (JGF)

Slurm sees resources as flat lists: N nodes, each with M cores and G GPUs. Flux models resources as a directed graph using the **Job-spec Graph Format (JGF)**. Nodes, cores, memory, GPUs, NICs — everything is a vertex in a graph connected by edges that represent physical topology. This lets Flux make placement decisions that respect NUMA boundaries, network topology, and heterogeneous hardware without special-case logic.

### User-Space Mode: Your Low-Risk Entry Point

Flux can run as a full system scheduler (replacing Slurm) or as a user-space scheduler inside an existing allocation. User-space mode is the key concept for this tutorial: you request resources from Slurm via `salloc` or `sbatch`, then start a Flux instance inside that allocation. Flux manages only the resources Slurm gave you. Your cluster admins don't need to install or configure anything.

This makes Flux a zero-risk experiment. If you don't like it, close your Slurm allocation and Flux disappears.

---

## 4. Step-by-Step Instructions

### Why Flux?

Flux is the architectural successor to Slurm, developed at LLNL — the same institution where Slurm was born in 2002. While Slurm has served the HPC community well for two decades, its centralized design and monolithic codebase struggle with the demands of exascale systems, heterogeneous hardware, and complex workflow scheduling. Flux was built from the ground up to address these limitations with a hierarchical, fully recursive architecture.

The timing matters. Nvidia's acquisition of SchedMD (the company that develops Slurm) has introduced uncertainty about Slurm's future direction, licensing, and vendor neutrality — giving many HPC sites additional motivation to evaluate alternatives. Flux is the most mature open-source option and already runs at production scale on LLNL's El Capitan exascale system.

This tutorial uses user-space Flux inside Slurm. You get hands-on experience with Flux's CLI and scheduling model without any cluster-level changes. Think of it as test-driving the car before buying: your Slurm cluster is the road, and Flux is running inside the vehicle.

> 🔗 **See also:** [[slurm-vs-flux-deep-dive|Slurm vs Flux Deep Dive]] for a detailed architectural comparison, and [[hyperqueue-basics|HyperQueue Basics]] for an alternative user-space task runner that takes a different approach to the same problem.

### Installation

The fastest path to a working Flux is through `mamba` (or `conda`). This installs Flux entirely in your home directory with no root access needed.

```bash
# Create a dedicated environment for Flux
mamba create -n flux -c conda-forge flux-core python=3.11 -y

# Activate the environment
mamba activate flux

# Verify the installation
flux version
```

Expected output:

```
commands:    0.72.0
libflux-core:0.72.0
libflux-idset:0.72.0
libflux-optparse:0.72.0
build-options: +systemd+hwloc==2.11.2+zmq==4.3.5
```

> 💡 **Tip:** The version numbers will vary. What matters is that `flux version` runs without error. If you see `flux: command not found`, your conda environment is not activated.

For sites that use Spack as their package manager:

```bash
# Spack alternative
spack install flux-core
spack load flux-core

# Verify
flux version
```

> 📝 **Note:** The conda-forge package bundles everything you need for user-space operation. System-level deployment requires additional packages (`flux-sched`, `flux-security`) — see [[flux-system-setup|Flux System Setup]].

### Starting a Flux Instance Inside Slurm

There are two patterns: interactive (for development and debugging) and batch (for production workflows).

**Interactive: `salloc` + `flux start`**

Request an interactive Slurm allocation, then launch Flux inside it:

```bash
# Request 4 nodes for 2 hours
salloc --nodes=4 --ntasks-per-node=1 --time=02:00:00 --partition=compute

# Once the allocation is granted, start Flux
flux start

# Verify you have a running instance
flux resource list
```

Expected output from `flux resource list`:

```
     STATE NNODES   NCORES    NGPUS NODELIST
      free      4      128        0 node[001-004]
   allocated      0        0        0
      down      0        0        0
```

Flux now controls the 4 nodes Slurm gave you. Check that `FLUX_URI` is set — this environment variable points to the socket of your running Flux instance:

```bash
echo $FLUX_URI
```

```
local:///tmp/flux-XXXXXX/local-0
```

> ⚠️ **Warning:** If `FLUX_URI` is not set, you are not inside a Flux instance. All `flux` commands will fail with connection errors. Make sure you ran `flux start` after your `salloc` was granted.

**Batch: `sbatch` script with `flux start`**

For production use, wrap your Flux workflow in an `sbatch` script:

```bash
#!/bin/bash
#SBATCH --job-name=flux-batch
#SBATCH --nodes=4
#SBATCH --ntasks-per-node=1
#SBATCH --time=04:00:00
#SBATCH --partition=compute
#SBATCH --output=flux-batch-%j.out

# Start Flux and run your workflow inside it
flux start ./my-flux-workflow.sh
```

Save this as `run-flux.sh` and submit it:

```bash
sbatch run-flux.sh
```

The companion script `my-flux-workflow.sh` contains your actual Flux job submissions:

```bash
#!/bin/bash
# my-flux-workflow.sh — runs inside the Flux instance

echo "Flux instance started with $(flux resource list -s free -no {nnodes}) nodes"

# Submit jobs using Flux commands
flux submit --nodes=1 --cores=32 ./analysis-step1.sh
flux submit --nodes=2 --cores=64 ./analysis-step2.sh

# Wait for all jobs to complete
flux queue drain

echo "All jobs complete."
```

> 💡 **Tip:** `flux queue drain` blocks until all submitted jobs finish. This is the Flux equivalent of waiting on all your Slurm jobs to complete before the next pipeline step.

### Core Command Reference

If you know Slurm, you already know the concepts behind every Flux command. This table maps them one-to-one:

| Action | Slurm Command | Flux Command | Notes |
|--------|--------------|-------------|-------|
| Submit batch job | `sbatch script.sh` | `flux batch script.sh` | Flux batch scripts use `flux submit` internally |
| Run blocking job | `srun ./my_app` | `flux run ./my_app` | Blocks until job completes, streams output |
| Submit async job | *(no direct equiv)* | `flux submit ./my_app` | Returns immediately with a job ID |
| Interactive alloc | `salloc -N4` | `flux alloc -N4` | Opens a sub-instance shell |
| List jobs | `squeue` | `flux jobs` | Shows running/pending jobs |
| Cancel job | `scancel <jobid>` | `flux cancel <jobid>` | Accepts Flux base58 job IDs |
| Cluster resources | `sinfo` | `flux resource list` | Graph-based resource view |
| Job accounting | `sacct` | `flux job stats` | Aggregate stats for the instance |
| Interactive shell | `srun --pty bash` | `flux run --pty bash` | Launches interactive shell on allocated node |

> 🔗 **See also:** [[slurm-vs-flux-reference|Slurm vs Flux Reference]] for the complete command mapping including less common operations.

Key differences to internalize:

- **`flux submit` vs. `flux run`**: `submit` is asynchronous (fire and forget, returns a job ID), while `run` is synchronous (blocks until the job finishes, streams stdout/stderr). Slurm's `srun` is closest to `flux run`. Slurm has no direct equivalent to `flux submit` — `sbatch` is close but expects a script with `#SBATCH` directives.
- **`flux batch` vs. `flux submit`**: `flux batch` runs a *script* that itself becomes a new Flux sub-instance. `flux submit` runs a *command* as a job in the current instance. This is analogous to the `sbatch` vs. `srun` distinction in Slurm.
- **`flux alloc`**: Creates a nested Flux instance from the current instance's resources. This is Flux's hierarchical model in action — every allocation is a fully functional scheduler.

### Running Your First Flux Jobs

Work through these three examples in order. Each one adds a layer of complexity.

**Example 1: Hello World**

The simplest possible Flux job — run a single command on one core:

```bash
flux run echo "hello from flux"
```

Expected output:

```
hello from flux
```

That's it. `flux run` allocated one core, ran `echo`, printed the output, and released the core. Compare this to `srun echo "hello from flux"` in Slurm — functionally identical.

**Example 2: Multi-Core Job with Resource Requests**

Request specific resources for a more demanding task:

```bash
flux run --cores=4 --mem=8G hostname
```

Expected output:

```
node001
```

The job ran on a node that could provide 4 cores and 8 GB of memory. The Flux equivalents of common Slurm resource flags:

| Slurm Flag | Flux Flag | Example |
|-----------|----------|---------|
| `--ntasks=4` | `--ntasks=4` or `-n4` | Number of tasks (MPI ranks) |
| `--cpus-per-task=8` | `--cores=8` | Cores per task |
| `--mem=16G` | `--mem=16G` | Memory per task |
| `--nodes=2` | `--nodes=2` or `-N2` | Number of nodes |
| `--gpus=1` | `--gpus=1` or `-g1` | GPUs per task |
| `--time=01:00:00` | `--time=60m` or `-t 60m` | Wall-clock time limit |

For an MPI application across multiple nodes:

```bash
flux run --nodes=2 --ntasks=8 --cores=4 ./my_mpi_app
```

**Example 3: Bulk Submission with a Loop**

Submit 100 independent tasks asynchronously. This is where `flux submit` shines compared to Slurm job arrays:

```bash
# Submit 100 tasks, each sleeping for a random duration
for i in $(seq 1 100); do
    flux submit --cores=1 --time=5m sleep $((RANDOM % 10 + 1))
done

# Watch them execute in real time
flux jobs
```

Expected output from `flux jobs`:

```
       JOBID USER     NAME       ST NTASKS NNODES     TIME INFO
   ƒ2wRMbMXV user1    sleep       R      1      1   0.832s node001
   ƒ2wRKjZHf user1    sleep       R      1      1   1.245s node002
   ƒ2wRJqN3D user1    sleep       R      1      1   0.621s node001
   ƒ2wRHxBnw user1    sleep       R      1      1   2.103s node003
   ...
```

Wait for all 100 tasks to complete:

```bash
flux queue drain
echo "All 100 tasks finished."
```

> 💡 **Tip:** Flux can dispatch thousands of tasks per second in user-space mode. Unlike Slurm job arrays, there's no scheduler overhead per task — Flux schedules them all internally.

You can also use `flux submit`'s built-in bulk mode with `--cc` (carbon copy) to avoid the shell loop entirely:

```bash
# Submit 100 copies of the same command in one call
flux submit --cc=1-100 --cores=1 --time=5m sleep 5
```

This is cleaner and faster than a shell loop — Flux handles the expansion internally.

### Understanding Flux Resources

Flux models resources as a graph, not a flat list. This is one of the most important conceptual differences from Slurm.

**Viewing Resources**

```bash
flux resource list
```

```
     STATE NNODES   NCORES    NGPUS NODELIST
      free      4      128        0 node[001-004]
   allocated      0        0        0
      down      0        0        0
```

For more detail, use `flux resource info`:

```bash
flux resource info
```

```
4 Nodes, 128 Cores, 0 GPUs
```

**The JGF Graph Model**

Under the surface, Flux represents your resources as a JSON Graph Format (JGF) graph. Each node in the cluster has vertices for the node itself, each socket, each core, each GPU, and each memory domain. Edges represent physical containment and connectivity.

```
node001 (node)
├── socket0 (socket)
│   ├── core0 (core)
│   ├── core1 (core)
│   ├── ...
│   ├── core15 (core)
│   └── memory0 (memory: 64GB)
├── socket1 (socket)
│   ├── core16 (core)
│   ├── ...
│   ├── core31 (core)
│   └── memory1 (memory: 64GB)
└── gpu0 (gpu)
```

This matters because Flux can enforce NUMA-aware placement. When you request `--cores=8`, Flux can allocate 8 cores on the same socket to minimize memory latency. Slurm requires explicit `--hint=nomultithread` or `--distribution` flags to achieve similar behavior.

**Slots, Cores, and Nodes**

Flux introduces the concept of a **slot** — a collection of resources that satisfies a single task's requirements. If your task needs 4 cores and 8 GB of memory, that's one slot. When you submit a job with `--ntasks=10 --cores=4 --mem=8G`, Flux finds 10 slots, each with 4 cores and 8 GB, and places your tasks there.

```bash
# This creates 10 slots of (4 cores + 8G memory) each
flux run --ntasks=10 --cores=4 --mem=8G ./my_task

# This creates 2 node-level slots, each filling an entire node
flux run --nodes=2 --exclusive ./my_task
```

Slurm has a similar idea with `--ntasks` and `--cpus-per-task`, but Flux's slot abstraction is more general and works cleanly with heterogeneous resources.

> 🔗 **See also:** [[cgroups-beginner-guide|Cgroups Beginner Guide]] for understanding how Flux enforces resource isolation at the operating system level.

### Job IDs and Status

Flux uses **base58-encoded job IDs** instead of Slurm's sequential integers. They look like `ƒ2wRMbMXV` — short, URL-safe, and globally unique. The `ƒ` prefix distinguishes them from other identifiers.

**Listing Jobs**

```bash
# Show running and pending jobs
flux jobs

# Show ALL jobs (including completed)
flux jobs -a

# Show only completed jobs
flux jobs -a --filter=inactive

# Show jobs in a specific state
flux jobs --filter=running
flux jobs --filter=pending
```

**Inspecting a Specific Job**

```bash
# Get detailed status of a job
flux job status ƒ2wRMbMXV
```

```
id:             ƒ2wRMbMXV
status:         COMPLETED
returncode:     0
runtime:        5.234s
nnodes:         1
ntasks:         1
cores:          4
```

**Attaching to a Running Job**

If you submitted a job with `flux submit` and want to see its output:

```bash
# Attach to a running job (streams stdout/stderr)
flux job attach ƒ2wRMbMXV
```

This is similar to `tail -f` on a Slurm output file, but it connects directly to the job's I/O streams.

**Getting the Last Job ID**

After submitting a job, you can retrieve its ID without parsing output:

```bash
flux submit ./long-running-task.sh
LAST_JOB=$(flux job last)
echo "Submitted job: $LAST_JOB"

# Later, check on it
flux job status $LAST_JOB
```

**Canceling Jobs**

```bash
# Cancel a specific job
flux cancel ƒ2wRMbMXV

# Cancel all your running jobs
flux cancel --all

# Cancel all pending jobs only
flux cancel --all --states=pending
```

> 📝 **Note:** Unlike Slurm's integer job IDs that reset when `slurmctld` restarts, Flux's base58 IDs are derived from a monotonic sequence within the instance. They are unique for the lifetime of the Flux instance but not across different instances.

---

## 5. Practical Examples

### Bioinformatics: FASTQ Processing Job Array

Here's a real-world example that translates a common Slurm bioinformatics pattern into Flux. Suppose you have 24 paired-end FASTQ files to process through `fastp` for quality trimming and filtering.

**The Slurm Way (for reference)**

```bash
#!/bin/bash
#SBATCH --job-name=fastp-qc
#SBATCH --array=1-12
#SBATCH --cpus-per-task=4
#SBATCH --mem=8G
#SBATCH --time=01:00:00

SAMPLE=$(sed -n "${SLURM_ARRAY_TASK_ID}p" samples.txt)
fastp \
  --in1 raw/${SAMPLE}_R1.fastq.gz \
  --in2 raw/${SAMPLE}_R2.fastq.gz \
  --out1 trimmed/${SAMPLE}_R1.fastq.gz \
  --out2 trimmed/${SAMPLE}_R2.fastq.gz \
  --json reports/${SAMPLE}.json \
  --thread 4
```

**The Flux Way**

```bash
#!/bin/bash
# run-fastp-flux.sh — wrapper script for Slurm + Flux
#SBATCH --job-name=fastp-flux
#SBATCH --nodes=2
#SBATCH --ntasks-per-node=1
#SBATCH --time=02:00:00
#SBATCH --partition=compute

# Activate the Flux environment
source activate flux  # or: mamba activate flux

# Start Flux and execute our workflow
flux start bash <<'FLUX_WORKFLOW'

echo "Flux instance: $(flux resource info)"
mkdir -p trimmed reports

# Submit one job per sample, 12 samples total
while IFS= read -r SAMPLE; do
    flux submit --cores=4 --mem=8G --time=60m \
        fastp \
        --in1 "raw/${SAMPLE}_R1.fastq.gz" \
        --in2 "raw/${SAMPLE}_R2.fastq.gz" \
        --out1 "trimmed/${SAMPLE}_R1.fastq.gz" \
        --out2 "trimmed/${SAMPLE}_R2.fastq.gz" \
        --json "reports/${SAMPLE}.json" \
        --thread 4
done < samples.txt

echo "Submitted $(flux jobs -a --no-header | wc -l) jobs"

# Wait for everything to finish
flux queue drain

# Report results
echo "=== Job Summary ==="
flux jobs -a -o "{id} {name} {status} {runtime}"
echo "All FASTQ processing complete."

FLUX_WORKFLOW
```

Submit it to Slurm:

```bash
sbatch run-fastp-flux.sh
```

**Why this is better than a Slurm array:**

- All 12 tasks are scheduled internally by Flux — no Slurm scheduler overhead per task.
- If your 2 nodes have 32 cores each, Flux packs 8 concurrent `fastp` jobs (4 cores each) across the 64 total cores. Slurm arrays would submit 12 separate jobs to the scheduler queue.
- Adding more samples means editing `samples.txt`, not changing `#SBATCH --array`.
- Flux handles task failures independently — a failed `fastp` job doesn't kill the others.

> 🔗 **See also:** [[flux-snakemake-workflows|Flux Snakemake Workflows]] for integrating Flux with Snakemake pipelines, and [[hyperqueue-deep-dive|HyperQueue Deep Dive]] for an alternative approach to the same problem using HyperQueue's auto-allocation.

---

## 6. Hands-On Exercises

### Exercise 1: Interactive Exploration (Beginner)

**Goal:** Start a Flux instance and run basic commands.

1. Request an interactive Slurm allocation with at least 2 nodes.
2. Activate your `flux` conda environment.
3. Run `flux start`.
4. Execute `flux resource list` and record the number of cores available.
5. Run `flux run hostname` on each node: `flux run --nodes=1 hostname` (repeat or use `--cc=1-2`).
6. Submit 5 async sleep jobs: `flux submit --cc=1-5 sleep 10`.
7. Run `flux jobs` to observe them running.
8. Run `flux jobs -a` after they complete to see the final status.
9. Exit Flux with `exit` or Ctrl-D.

**Success criteria:** All 5 sleep jobs show `COMPLETED` status in `flux jobs -a`.

### Exercise 2: Resource-Aware Submission (Intermediate)

**Goal:** Submit jobs with specific resource requests and observe scheduling behavior.

1. Start a Flux instance on 2 nodes (assume 32 cores per node, 64 total).
2. Submit 8 jobs, each requesting `--cores=8 --mem=4G`:
   ```bash
   flux submit --cc=1-8 --cores=8 --mem=4G sleep 30
   ```
3. While they run, execute `flux resource list` — how many cores are allocated vs. free?
4. Submit a 9th job requesting `--cores=8`. Does it run immediately or pend?
5. Run `flux jobs --filter=pending` to see the pending job.
6. Cancel the pending job with `flux cancel`.
7. Wait for the remaining jobs: `flux queue drain`.

**Expected observation:** With 64 cores and 8 jobs at 8 cores each, all 64 cores should be allocated. The 9th job should pend until one of the first 8 finishes.

### Exercise 3: Batch Workflow Script (Advanced)

**Goal:** Write a complete Slurm + Flux batch script that processes data.

Write a script called `exercise3.sh` that:

1. Requests 2 nodes from Slurm for 30 minutes.
2. Starts a Flux instance.
3. Submits 20 jobs, each running `echo "Task $i completed on $(hostname)" > output_$i.txt`.
4. Waits for all jobs to complete with `flux queue drain`.
5. Concatenates all output files and prints a summary.

```bash
#!/bin/bash
#SBATCH --job-name=flux-exercise3
#SBATCH --nodes=2
#SBATCH --ntasks-per-node=1
#SBATCH --time=00:30:00

source activate flux

flux start bash <<'EOF'
mkdir -p results

for i in $(seq 1 20); do
    flux submit --cores=1 \
        bash -c "echo 'Task $i completed on $(hostname) at $(date)' > results/output_${i}.txt"
done

flux queue drain

echo "=== All tasks completed ==="
echo "Tasks ran on these nodes:"
cat results/output_*.txt | sort
echo "Total completed: $(ls results/output_*.txt | wc -l)"
EOF
```

Submit with `sbatch exercise3.sh` and verify that all 20 output files are created with valid content.

> 💡 **Tip:** If your cluster has short-queue or debug partitions with quick turnaround, use those for exercises: `--partition=debug --time=00:10:00`.

---

## 7. Troubleshooting

### `flux: command not found`

**Cause:** The Flux conda environment is not activated, or Flux is not installed.

```bash
# Check if the environment exists
mamba env list | grep flux

# Activate it
mamba activate flux

# If it doesn't exist, create it
mamba create -n flux -c conda-forge flux-core python=3.11 -y
```

If you're inside an `sbatch` script, make sure you activate the environment before calling `flux start`:

```bash
source activate flux    # or: mamba activate flux
flux start ./my-workflow.sh
```

### `FLUX_URI not set` or `ERROR: Unable to connect to Flux`

**Cause:** You're running `flux` commands outside a Flux instance. The `FLUX_URI` environment variable must be set by `flux start`.

```bash
# Check if you're inside a Flux instance
echo $FLUX_URI

# If empty, you need to start one first
flux start
```

Common mistake: running `flux jobs` on the login node without first starting a Flux instance inside a Slurm allocation.

### Resource Exhaustion: Jobs Stuck in `PENDING`

**Cause:** You've submitted more work than your Flux instance has resources for. Unlike Slurm, which draws from the entire cluster, user-space Flux only has the resources from your `salloc`/`sbatch` allocation.

```bash
# Check what resources are available vs. allocated
flux resource list

# Check pending jobs
flux jobs --filter=pending

# Cancel pending jobs if needed
flux cancel --all --states=pending
```

**Fix:** Request a larger Slurm allocation, reduce per-job resource requests, or wait for running jobs to complete.

### Job Fails Silently (Exit Code Non-Zero)

Flux does not always print errors for failed jobs submitted with `flux submit`. The job completes with a non-zero return code, but you might not notice unless you check.

```bash
# Check for failed jobs
flux jobs -a --filter=failed

# Get details on a failed job
flux job status ƒXXXXXX

# View the stderr output
flux job attach ƒXXXXXX 2>&1
```

> 💡 **Tip:** For debugging, use `flux run` instead of `flux submit`. Since `flux run` blocks and streams output, you'll see errors immediately, just like `srun` in Slurm.

### Flux Instance Crashes When Slurm Allocation Expires

If your Slurm allocation wall time expires, the entire Flux instance terminates along with all running jobs. There is no checkpoint/restart by default.

```bash
# Check remaining wall time in your Slurm allocation
squeue -j $SLURM_JOB_ID -o "%L"

# Request more time before starting long workflows
salloc --time=08:00:00 ...
```

> ⚠️ **Warning:** Always request more Slurm wall time than you think you need. Flux adds minimal overhead, but your jobs need time to complete before the allocation expires.

---

## 8. References

| Resource | URL |
|----------|-----|
| Flux Framework Official Docs | [https://flux-framework.readthedocs.io/](https://flux-framework.readthedocs.io/) |
| Flux Framework GitHub | [https://github.com/flux-framework](https://github.com/flux-framework) |
| LLNL Flux Project Page | [https://computing.llnl.gov/projects/flux-building-framework-resource-management](https://computing.llnl.gov/projects/flux-building-framework-resource-management) |
| LRZ Flux User Guide | [https://doku.lrz.de/flux-framework](https://doku.lrz.de/flux-framework) |
| Flux Cheat Sheet (LLNL) | [https://flux-framework.org/cheat-sheet/](https://flux-framework.org/cheat-sheet/) |
| conda-forge flux-core | [https://anaconda.org/conda-forge/flux-core](https://anaconda.org/conda-forge/flux-core) |
| JGF Resource Model Spec | [https://flux-framework.readthedocs.io/projects/flux-rfc/en/latest/spec_4.html](https://flux-framework.readthedocs.io/projects/flux-rfc/en/latest/spec_4.html) |

---

## 9. Summary

**Key takeaways from this tutorial:**

1. **Flux is Slurm's successor from the same lineage.** Built at LLNL, it replaces Slurm's centralized model with a hierarchical, recursive architecture.
2. **User-space mode is the safe starting point.** Run Flux inside a Slurm allocation to experiment without any cluster-level changes.
3. **The command mapping is straightforward.** `srun` becomes `flux run`, `sbatch` becomes `flux batch`, `squeue` becomes `flux jobs`. The concepts transfer directly.
4. **`flux submit` is your async workhorse.** Fire-and-forget task submission with automatic scheduling — no job arrays, no scheduler overhead per task.
5. **Resources are modeled as graphs, not flat lists.** This enables topology-aware placement that Slurm requires manual tuning to achieve.
6. **Base58 job IDs replace sequential integers.** Use `flux job last` to avoid parsing, and `flux jobs -a` to see everything.

---

## Related Tutorials

- [[slurm-vs-flux-reference|Slurm vs Flux Reference]]
- [[slurm-vs-flux-deep-dive|Slurm vs Flux Deep Dive]]
- [[flux-system-setup|Flux System Setup]]
- [[flux-snakemake-workflows|Flux Snakemake Workflows]]
- [[flux-advanced-features|Advanced Flux Features]]
- [[hyperqueue-basics|HyperQueue Basics]]
- [[hyperqueue-deep-dive|HyperQueue Deep Dive]]
- [[cgroups-beginner-guide|Cgroups Beginner Guide]]
- [[pixi-beginner-guide|Pixi Beginner Guide]]
- [[autoresearch-beginner-guide|Autoresearch Beginner Guide]] — autonomous ML research loop on a single GPU; the HPC/Slurm section discusses Slurm job arrays as a parallelization vector for autoresearch
- [[autoresearch-deep-dive|Autoresearch Deep Dive]] — deep dive including Slurm job array sketch and Apptainer container approach for running autoresearch on HPC
- [[omp-deep-dive|Oh My Pi (omp) Deep Dive]] — terminal coding agent with a full HPC/Slurm chapter covering vLLM-on-Slurm and SSH tunnel setup

---

## Next Steps

Put what you learned into practice with this concrete challenge: request a Slurm allocation with 32 cores (e.g., `salloc --ntasks=32 --time=00:30:00`), start a Flux instance, and submit 50 parallel `sleep 5` tasks using `flux submit --cc=1-50 --cores=1 sleep 5`. Then verify all 50 completed successfully:

```bash
# Request resources from Slurm
salloc --ntasks=32 --time=00:30:00 --partition=compute

# Activate Flux
mamba activate flux
flux start

# Submit 50 sleep tasks
flux submit --cc=1-50 --cores=1 sleep 5

# Wait for completion
flux queue drain

# Verify all 50 completed
flux jobs -a --filter=completed --no-header | wc -l
# Expected: 50

# Check for any failures
flux jobs -a --filter=failed --no-header | wc -l
# Expected: 0
```

If all 50 tasks complete without failures, you're ready for the next tutorial: [[flux-system-setup|Flux System Setup]], which covers deploying Flux as a system-level scheduler alongside or replacing Slurm.
