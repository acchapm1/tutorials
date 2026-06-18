---
title: "HyperQueue + DETECT/Snakemake: Integration Guide"
date: 2026-04-27
difficulty: advanced
tags: [hyperqueue, snakemake, detect, hpc, slurm, bioinformatics, pipeline, integration, advanced]
---

# HyperQueue + DETECT/Snakemake: Integration Guide

> **Related tutorials:** [[hyperqueue-basics|HyperQueue Basics]] · [[hyperqueue-deep-dive|HyperQueue Deep Dive]]

---

## 1. Overview

This tutorial shows how to run the DETECT bioinformatics pipeline through HyperQueue instead of (or alongside) the existing Slurm executor. DETECT is a Snakemake-based workflow with per-sample rules that fan out into hundreds or thousands of tasks — exactly the pattern where HQ's sub-millisecond dispatch and automatic allocation pay off.

You will evaluate three architecture options, set up HQ as Snakemake middleware, map DETECT's resource model to HQ, and run an A/B comparison against the current Slurm-direct path. The goal is an informed go/no-go decision, not a one-way migration.

**What you'll need from the other tutorials:**
- [[hyperqueue-basics|HyperQueue Basics]] — server/worker/job mental model, installation
- [[hyperqueue-deep-dive|HyperQueue Deep Dive]] — automatic allocation, resource model, output streaming

---

## 2. Prerequisites

- HyperQueue installed and functional (see [[hyperqueue-basics|basics tutorial]])
- The DETECT pipeline checked out and runnable via Snakemake 9 + Slurm
- Your Slurm profile working: `profiles/slurm/config.yaml`
- `mamba` environment activated: `module load mamba/latest && source activate DETECT`
- Familiarity with `Snakefile.claude` (lambda-based resource allocation) and `profiles/slurm/config.yaml`

---

## 3. Key Concepts

### The Architecture Decision

There are three ways to combine Snakemake, HQ, and Slurm. Understanding all three before committing to one is the key decision:

```
Option A: Snakemake ──→ Slurm          (current state)
Option B: Snakemake ──→ HQ ──→ Slurm   (HQ as middleware)
Option C: HQ standalone                 (no Snakemake)
```

**Option A: Snakemake → Slurm direct** (what you have now)

Snakemake submits one Slurm job per rule instance via the `--executor slurm` plugin. Each rule gets its own `sbatch`, waits in the Slurm queue independently, runs, and reports back.

- **Pros:** Battle-tested. You already have this working. No new moving parts.
- **Cons:** Per-rule Slurm submission overhead (seconds per job). With 500+ rules in a run, that's significant queue pressure and wasted wall-clock time waiting for each job to clear the scheduler. Your cluster admins see hundreds of jobs from one user.

**Option B: Snakemake → HQ → Slurm** (HQ as middleware) ← **Recommended for DETECT**

Snakemake still manages the DAG (file dependencies, rule ordering, reruns on failure). But instead of submitting each rule to Slurm, it submits to HQ. HQ holds open a small number of large Slurm allocations and packs rules into them as fast as workers can pull tasks.

- **Pros:** Sub-millisecond dispatch. Fewer Slurm jobs (2–5 allocations instead of 500 jobs). Better cluster citizenship. Snakemake still handles the workflow logic.
- **Cons:** One more component to run (HQ server). Slightly more complex debugging when things go wrong.

**Option C: HQ standalone** (no Snakemake)

Rebuild the DETECT DAG in HQ's TOML job format or Python API, bypassing Snakemake entirely.

- **Not recommended.** Snakemake's file-dependency tracking, reruns-on-failure, and config system are exactly what DETECT needs. Replicating that in HQ would be a massive effort with no clear benefit.

**Verdict: Go with Option B.** Keep Snakemake for workflow management, add HQ for scheduling efficiency.

---

## 4. Step-by-Step Instructions

### Step 1: Start the HQ Server

Create a helper script alongside your existing `reports.sh`:

```bash
#!/usr/bin/env bash
# scripts/start-hq.sh — Start HyperQueue server for DETECT runs
set -euo pipefail

# Use a project-specific server directory to avoid conflicts with other HQ instances
export HQ_SERVER_DIR="${HOME}/.hq-server-detect"

# Check if server is already running
if hq server info &>/dev/null; then
    echo "HQ server already running at ${HQ_SERVER_DIR}"
    hq server info
    exit 0
fi

echo "Starting HQ server..."
echo "Server directory: ${HQ_SERVER_DIR}"

# Start in background (this script is meant to be run inside tmux/screen)
hq server start &
SERVER_PID=$!

sleep 2

# Verify
if hq server info &>/dev/null; then
    echo "HQ server started successfully (PID: ${SERVER_PID})"
    hq server info
else
    echo "ERROR: HQ server failed to start"
    exit 1
fi

echo ""
echo "Next steps:"
echo "  1. Set up automatic allocation:"
echo "     hq alloc add slurm --time-limit 4h --workers-per-alloc 1 --backlog 2 --max-worker-count 10 -- --partition=general --account=pfeiferlab --mem=32G"
echo "  2. Run Snakemake with the HQ profile:"
echo "     snakemake --profile profiles/hq"

# Wait for server process (keeps this script alive in tmux)
wait $SERVER_PID
```

```bash
chmod +x scripts/start-hq.sh
```

Run it inside a tmux session (or use [[sesh-beginner-guide|sesh]]):

```bash
tmux new -s hq-detect
./scripts/start-hq.sh
# Ctrl-b d to detach
```

### Step 2: Configure Automatic Allocation

```bash
export HQ_SERVER_DIR="${HOME}/.hq-server-detect"

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

> **Tuning for DETECT:** If your DETECT runs typically have 200–500 rules, `--max-worker-count 5` and `--backlog 2` is a good starting point. If you have GPU rules (rare in DETECT, but possible), add a second allocation queue with `--partition=gpu` and `--resource "gpus=1"`.

### Step 3: Create the Snakemake HQ Profile

The [Snakemake HyperQueue executor plugin](https://github.com/snakemake/snakemake-executor-plugin-hyperqueue) lets Snakemake submit rules to HQ instead of Slurm. Install it:

```bash
pip install snakemake-executor-plugin-hyperqueue
```

Create a parallel profile so you can switch between Slurm and HQ without breaking anything:

```yaml
# profiles/hq/config.yaml
executor: hyperqueue
jobs: 500            # max concurrent tasks HQ can manage (HQ handles the actual limiting)
latency-wait: 30     # seconds to wait for output files after a rule completes

# Resource defaults (override per-rule in Snakefile)
default-resources:
  - mem_mb=4000
  - runtime=60        # minutes

# HQ server connection
# Set HQ_SERVER_DIR in your environment to match start-hq.sh
```

> **If the HQ executor plugin is unavailable or unmaintained:** Fall back to the generic cluster executor with HQ submit commands:
>
> ```yaml
> # profiles/hq/config.yaml
> executor: cluster-generic
> cluster-generic-submit-cmd: >
>   hq submit --cpus={threads} --stdout={log}.stdout --stderr={log}.stderr
>   -- {exec_job}
> cluster-generic-status-cmd: >
>   hq job info {job_id} --output-mode json
> cluster-generic-cancel-cmd: >
>   hq job cancel {job_id}
> jobs: 500
> latency-wait: 30
> ```

### Step 4: Resource Mapping

DETECT's `Snakefile.claude` uses lambda-based resource allocation. Here's how those translate to HQ:

**Example Snakemake rule resources:**

```python
rule align_reads:
    threads: 8
    resources:
        mem_mb=lambda wildcards, attempt: 16000 * attempt,
        runtime=lambda wildcards, attempt: 120 * attempt,
        slurm_partition="general"
```

**How HQ sees this:**

With the HQ executor plugin, Snakemake passes `threads` as the CPU count and `mem_mb` / `runtime` as resource requests. HQ maps:

| Snakemake resource | HQ resource | Notes |
|-------------------|-------------|-------|
| `threads: 8` | `--cpus=8` | Direct mapping |
| `mem_mb` | Not tracked by default | HQ doesn't manage memory; the Slurm allocation's `--mem` covers it |
| `runtime` | Used for time limit | Plugin may pass this as task time limit |
| `slurm_partition` | Ignored by HQ | Partition is set at allocation level, not task level |

**The key insight:** In Option A (Slurm direct), each rule gets its own partition/memory/time allocation. In Option B (HQ middleware), the allocation queue sets the envelope (partition, memory, time), and individual tasks just request CPUs. This is simpler — but it means your allocations need to be large enough for the biggest rule.

**Concrete example — mapping `align_reads`:**

```bash
# The allocation queue provides the environment:
hq alloc add slurm \
  --time-limit 4h \
  --workers-per-alloc 1 \
  --backlog 2 \
  -- \
  --partition=general \
  --account=pfeiferlab \
  --mem=64G                  # Big enough for the 16GB-per-attempt rule
  --cpus-per-task=32         # Full node

# The task requests what it needs within that environment:
# (handled by Snakemake via the HQ executor — threads=8 maps to --cpus=8)
```

### Step 5: Test with a Single Rule

Before running the full pipeline, test with a single rule to verify the plumbing:

```bash
export HQ_SERVER_DIR="${HOME}/.hq-server-detect"

# Dry-run first to see what Snakemake would do
snakemake --profile profiles/hq -n align_reads

# Run just one rule on one sample
snakemake --profile profiles/hq \
  --until align_reads \
  --config samples=["sample_001"] \
  --jobs 1
```

Watch HQ's side:

```bash
# In another terminal
export HQ_SERVER_DIR="${HOME}/.hq-server-detect"
hq job list
hq alloc list
```

If the task completes and output files appear where Snakemake expects them, the integration works.

### Step 6: Output Streaming and Log Hygiene

DETECT's `loganalysis.py` and `reports.sh` expect log files in specific locations. Output streaming changes the file layout, so you have two options:

**Option A: Don't use HQ output streaming** (simpler)

Let Snakemake and HQ write individual log files as usual. Your existing `loganalysis.py` and `reports.sh` work unchanged. The filesystem overhead is only an issue above ~10,000 tasks per run; most DETECT runs are below that.

```yaml
# profiles/hq/config.yaml — no streaming, standard log paths
```

**Option B: Use HQ output streaming for HQ-level diagnostics only**

Keep Snakemake's per-rule logs for `loganalysis.py`, but also enable HQ streaming for a separate HQ-level diagnostic log:

```bash
# When submitting via the generic cluster executor, add --stream:
# (The HQ executor plugin may not support this directly — check the docs)
```

**Recommendation:** Start with Option A. Add streaming only if you hit filesystem pressure at scale.

---

## 5. Practical Examples

### A/B Evaluation Plan

Run the same DETECT input through both paths and compare:

```bash
# --- Path A: Snakemake → Slurm (baseline) ---
cd /path/to/DETECT
snakemake --profile profiles/slurm \
  --config input_dir="test_data/" \
  2>&1 | tee logs/run_slurm_$(date +%Y%m%d).log

# Record: total wall time, per-rule wait times, number of Slurm jobs

# --- Path B: Snakemake → HQ → Slurm ---
# (Make sure HQ server and allocation queue are running)
snakemake --profile profiles/hq \
  --config input_dir="test_data/" \
  2>&1 | tee logs/run_hq_$(date +%Y%m%d).log

# Record: total wall time, per-rule dispatch time, number of Slurm allocations
```

**Metrics to compare:**

| Metric | How to measure | What to expect |
|--------|---------------|----------------|
| **Total wall time** | `time snakemake ...` or timestamps in log | HQ should win by reducing queue wait |
| **Slurm queue pressure** | `sacct -u $USER --starttime=<start> --endtime=<end> \| wc -l` | Path A: hundreds of jobs. Path B: 2–10 allocations. |
| **Per-rule dispatch latency** | Snakemake log timestamps (time between "rule submitted" and "rule started") | Path A: seconds to minutes (Slurm queue). Path B: milliseconds (HQ dispatch). |
| **Failure recovery** | Deliberately kill a task mid-run and check if Snakemake retries | Both should retry; HQ is faster. |

Use the framing from `OPTIMIZATIONS-MARCH.md` if you want to present results to the lab.

### Rollback Plan

The HQ profile coexists with the Slurm profile. No files are modified, no configs are overwritten.

```bash
# Use Slurm (existing, always works)
snakemake --profile profiles/slurm

# Use HQ (opt-in)
snakemake --profile profiles/hq

# Switch back at any time — just change the --profile flag
```

If HQ causes issues, delete `profiles/hq/` and you're back to exactly where you started.

---

## 6. Hands-On Exercises

1. **Single-rule smoke test:** Pick the fastest DETECT rule. Run it through both `profiles/slurm` and `profiles/hq`. Confirm identical output files.

2. **Allocation monitoring:** During an HQ run, open a second terminal and watch `hq alloc list` and `squeue -u $USER` simultaneously. Note how many Slurm jobs HQ submits vs. how many Snakemake rules are running.

3. **Resource mapping audit:** For each rule in `Snakefile.claude`, list the resources it requests. Verify that the HQ allocation's `--mem` and `--cpus-per-task` are large enough for the most demanding rule.

4. **Failure injection:** Run DETECT with a deliberately broken input file for one sample. Verify that Snakemake detects the failure, marks the rule as failed, and correctly reruns it on the next invocation — just as it does with the Slurm profile.

5. **Full A/B comparison:** Run the complete DETECT pipeline on a small test dataset (5–10 samples) through both profiles. Record wall time, number of Slurm jobs, and any differences in output.

---

## 7. Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `snakemake-executor-plugin-hyperqueue` not found | Not installed in the DETECT conda environment | `pip install snakemake-executor-plugin-hyperqueue` inside the DETECT env |
| Snakemake submits but tasks stay `WAITING` | No allocation queue set up, or allocations pending in Slurm | Run `hq alloc list` — if empty, add an allocation queue. If allocations are `QUEUED`, wait for Slurm. |
| `HQ_SERVER_DIR` mismatch | `start-hq.sh` uses one path, your shell uses another | Export `HQ_SERVER_DIR` consistently; add it to your `.bashrc` or the Snakemake profile's wrapper |
| Rule fails with "out of memory" | HQ allocation's `--mem` is smaller than the rule's `mem_mb` request | Increase `--mem` in the `hq alloc add` command |
| Output files not found by Snakemake | Working directory mismatch between HQ worker and Snakemake | Ensure `--cwd` in the HQ profile points to the DETECT project root |
| Allocation expires mid-rule | Long-running rule exceeds `--time-limit` | Increase `--time-limit` or identify the slow rule and optimize it |
| `loganalysis.py` can't find logs | Output streaming changed the log file layout | Use Option A (no streaming) or adapt `loganalysis.py` to read from `hq output-log` |

### Checkpointing and Recovery

HQ server state lives in `$HQ_SERVER_DIR` (default `~/.hq-server/`). If the login node reboots:

1. Reconnect to the login node
2. Reattach to tmux: `tmux attach -t hq-detect` (or restart `scripts/start-hq.sh`)
3. Re-add the allocation queue (allocation queues don't survive a server restart):
   ```bash
   hq alloc add slurm --time-limit 4h --workers-per-alloc 1 --backlog 2 -- --partition=general --account=pfeiferlab --mem=32G
   ```
4. Rerun Snakemake — it will pick up where it left off (Snakemake checks output files, not HQ state):
   ```bash
   snakemake --profile profiles/hq --rerun-incomplete
   ```

---

## 8. References

- [HyperQueue Official Docs](https://it4innovations.github.io/hyperqueue/stable/)
- [Snakemake HyperQueue Executor Plugin](https://github.com/snakemake/snakemake-executor-plugin-hyperqueue)
- [Snakemake Cluster Generic Executor](https://github.com/snakemake/snakemake-executor-plugin-cluster-generic)
- [Snakemake 9 Executor Documentation](https://snakemake.readthedocs.io/en/stable/executing/cluster.html)
- [HyperQueue Automatic Allocation](https://it4innovations.github.io/hyperqueue/stable/deployment/allocation/)

---

## 9. Related Tutorials

- [[hyperqueue-basics|HyperQueue Basics]] — installation, server/worker model, first tasks
- [[hyperqueue-deep-dive|HyperQueue Deep Dive]] — automatic allocation, resource model, output streaming, Python API
- [[sesh-beginner-guide|Sesh Beginner Guide]] — terminal session management for HQ server persistence
- [[mosh-beginner-guide|Mosh Beginner Guide]] — persistent remote connections for HPC work
- [[isaaclab-metagrasp-apptainer-hpc-beginner-guide|IsaacLab MetaGrasp on HPC]] — another Slurm-based HPC workflow with containers
- [[isaaclab-metagrasp-apptainer-hpc-deep-dive|IsaacLab MetaGrasp Deep Dive]] — advanced HPC patterns with Apptainer
- [[linux-permissions-beginner-guide|Linux Permissions]] — shared filesystem permissions matter on HPC clusters

---

## 10. Your First Command

Don't migrate the whole pipeline. Start with a single rule, a single sample, and compare the output against what Slurm-direct produces:

```bash
# Terminal 1: Start HQ (in tmux)
tmux new -s hq-detect
export HQ_SERVER_DIR="${HOME}/.hq-server-detect"
hq server start

# Terminal 2: Add allocation queue and run one rule
export HQ_SERVER_DIR="${HOME}/.hq-server-detect"

hq alloc add slurm \
  --time-limit 1h \
  --workers-per-alloc 1 \
  --backlog 1 \
  -- \
  --partition=general \
  --account=pfeiferlab \
  --mem=32G

cd /path/to/DETECT
snakemake --profile profiles/hq \
  --until align_reads \
  --config samples=["sample_001"] \
  --jobs 1
```

If the output matches what `--profile profiles/slurm` produces, you're in business. Scale up from there.
# 9. Related Tutorials

- [[flux-basics|Flux Basics]] — Flux Framework for HPC job scheduling (alternative to HyperQueue's Slurm middleware approach)
- [[flux-snakemake-workflows|Flux + Snakemake Workflows]] — DETECT pipeline migration to the Flux executor plugin (compare with HyperQueue executor)
- [[flux-advanced-features|Advanced Flux Features]] — hierarchical scheduling for high-throughput ensemble workflows
