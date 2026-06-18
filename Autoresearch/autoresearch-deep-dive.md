---
title: "Karpathy autoresearch — Deep-Dive Reference"
date: 2026-06-16
difficulty: advanced
tags: [hpc, ml, llm-training, agent-research, nanochat, karpathy, muon, slurm, apptainer]
sources:
  - https://github.com/karpathy/autoresearch
  - https://github.com/miolini/autoresearch-macos
  - https://github.com/trevin-creator/autoresearch-mlx
  - https://github.com/jsegov/autoresearch-win-rtx
  - https://github.com/andyluo7/autoresearch
  - https://github.com/wjgoarxiv/autoresearch-skill
---

Karpathy's **autoresearch** (March 7, 2026) is a ~630-line single-file LLM training repo that hands a Claude Code agent the job of iterating on its own training code. The human edits `program.md` to describe research goals; the agent edits `train.py` to test hypotheses; every experiment runs for exactly five wall-clock minutes and reports `val_bpb`; the agent keeps improvements and reverts regressions. This document covers the three-file architecture, the val_bpb metric, the Muon optimizer, agent permission model, HPC/Slurm integration, Apple Silicon adaptation, and how autoresearch differs from conventional HPO frameworks.

---

## Table of Contents

1. [The Conceptual Inversion](#1-the-conceptual-inversion)
2. [Three-File Architecture](#2-three-file-architecture)
3. [The val_bpb Metric](#3-the-val_bpb-metric)
4. [The 5-Minute Wall-Clock Budget](#4-the-5-minute-wall-clock-budget)
5. [The Muon Optimizer](#5-the-muon-optimizer)
6. [Key train.py Knobs](#6-key-trainpy-knobs)
7. [The Agent Edit→Train→Evaluate Loop](#7-the-agent-edittrain-evaluate-loop)
8. [Agent Permission Model](#8-the-agent-permission-model)
9. [autoresearch vs. AutoML / HPO Frameworks](#9-autoresearch-vs-automl--hpo-frameworks)
10. [Karpathy Lineage](#10-karpathy-lineage)
11. [Notable Forks](#11-notable-forks)
12. [Phase 1 — Orientation](#12-phase-1--orientation)
13. [Phase 2 — Hands-On](#13-phase-2--hands-on)
14. [Phase 3 — Deep Dive](#14-phase-3--deep-dive)
15. [Phase 4 — HPC / Slurm](#15-phase-4--hpc--slurm)
16. [Related Tutorials](#16-related-tutorials)
17. [Summary](#17-summary)

---

## 1. The Conceptual Inversion

The canonical framing of AI-assisted coding has the human writing code and the agent suggesting edits. autoresearch inverts this.

**The inversion:** you edit `program.md`. The agent edits `train.py`.

This is not a cosmetic change. It means the researcher is now programming the *research process*, not the model. `program.md` is the spec: what is allowed to change, what metric counts, how to decide whether to keep a change. `train.py` is the implementation: the agent iterates on it freely within those constraints. The researcher stays at the level of scientific intent; the agent handles the implementation search.

This framing scales naturally. If you have a clearer hypothesis, add it to `program.md`. If you want the agent to focus on optimizer tuning this session, say so in `program.md`. If the overnight run found something unexpected, you read the git log, update your priors, and modify `program.md` for the next run. The interface between human and agent is a plain-text file, not a GUI or a YAML config.

---

## 2. Three-File Architecture

The entire project is three files. This is deliberate — a 630-line codebase is within an agent's context window, and the agent needs to read the full file to reason about changes.

### `prepare.py` — FROZEN

Downloads the **TinyStories** dataset and trains a **BPE tokenizer** with `vocab_size=8192` by default. Produces tokenized data files on disk. Run once before anything else. Never modify during an experiment run.

Why frozen: the tokenizer and dataset are the fixed ground truth. If the agent modified `prepare.py`, it could change the vocabulary and invalidate all previous `val_bpb` comparisons.

```bash
uv run prepare.py
```

### `train.py` — MUTABLE (agent edits this)

The complete GPT model definition, the Muon+AdamW optimizer configuration, the data loader, the evaluation loop, and the wall-clock budget enforcement. Approximately 630 lines. This is the file the agent reads, modifies, and reverts.

### `program.md` — HUMAN-EDITABLE

Agent instructions encoded as plain text. The "bare bones baseline" version gives the agent maximum latitude. A typical `program.md` specifies:

- Which files may be edited (answer: `train.py` only)
- What metric to optimize (minimize `val_bpb`)
- Keep/revert rule (keep if `val_bpb` decreases, revert otherwise)
- Experiment log format (what changed, val_bpb before/after, keep/discard)
- Hard constraints (no dependency changes, no multi-GPU, no internet)

**`program.md` as a lightweight skill.** You can extend it with hypotheses, architecture constraints, domain knowledge ("FlashAttention-3 is available on this GPU"), or an explicit experimental strategy (explore vs. exploit phases). The more specific your `program.md`, the more directed the agent's search.

---

## 3. The val_bpb Metric

**`val_bpb`** = validation cross-entropy loss / log(2). Lower is better.

Why not just report validation loss? Cross-entropy loss is in nats and depends on vocabulary size. If the agent changes `vocab_size` — a legitimate architectural choice — the resulting loss values are on different scales and cannot be compared. Dividing by log(2) converts nats to bits and factors out vocabulary size, producing a **vocab-invariant** metric. This is the critical insight: without a vocab-invariant metric, the agent could not fairly evaluate architectural changes that touch tokenization.

BPB is measured in bits per byte of text, making it comparable across models with different vocabularies and tokenizers. A val_bpb of roughly 1.0 is human-level for English; TinyStories models start meaningfully above that and descend as training improves.

The practical effect: the agent is free to experiment with `vocab_size` without the researcher worrying that an apparent improvement is an artifact of the metric changing definition.

---

## 4. The 5-Minute Wall-Clock Budget

Each experiment gets exactly **5 minutes of wall-clock training time**. Python startup and `torch.compile` compilation time are excluded from the budget — the timer starts when training begins.

**What this buys:**

- Approximately 12 experiments per hour
- Approximately 100 experiments overnight on an H100
- All experiments are comparable across architectural changes of different depths, attention patterns, batch sizes, etc. — you are always measuring "what can I learn in 5 minutes of GPU time"

**What this costs:**

Results are hardware-specific. An experiment on an H100 runs more steps in 5 minutes than the same experiment on an A100 or M2 MacBook. Cross-hardware comparisons of val_bpb are invalid. If you port to a different GPU, your baseline val_bpb will differ, and you cannot compare absolute numbers with Karpathy's overnight run.

This tradeoff is deliberate. The goal is not a universal benchmark; it is a *consistent signal* within a single research session on a single GPU.

---

## 5. The Muon Optimizer

**Muon** is not a standard PyTorch optimizer. It is based on Nesterov momentum with Newton-Schulz orthogonalization applied to the gradient matrix.

The key intuition: rather than updating weights directly in the direction of the (possibly ill-conditioned) gradient, Muon orthogonalizes the gradient update so that parameters in different "directions" don't interfere with each other. This is analogous to steepest-descent vs. conjugate-gradient — orthogonalization removes redundancy from the update signal.

In practice, autoresearch uses a **Muon + AdamW combo**:

- **Muon** handles the weight matrices of the transformer (the "square" parameters where orthogonalization is geometrically meaningful)
- **AdamW** handles embeddings and layer norms (these are not square matrices, or have geometric properties that don't benefit from orthogonalization in the same way)

**Key Muon hyperparameter:**

`muon_beta2` (default 0.95) controls smoothing in the Newton-Schulz normalization. A notable finding from Karpathy's first overnight run was that increasing this to `0.98` reduced val_bpb — the higher value smooths the normalization more aggressively, allowing larger effective steps.

```python
# Example: what the agent might change
muon_beta2 = 0.98  # was 0.95; late-stage finding from overnight run
```

Muon is available as a standalone Python package. The autoresearch setup includes it as a dependency; no manual installation is needed within the repo's virtual environment.

---

## 6. Key `train.py` Knobs

The agent can change any of these. Understanding what each knob trades off helps you write better hypotheses in `program.md`.

### Model Capacity

| Knob | Default | What it does |
|------|---------|--------------|
| `DEPTH` | 8 | Number of transformer layers. More layers = more capacity, slower per-step training |
| `vocab_size` | 8192 | Must match BPE tokenizer from `prepare.py`. Changing requires rerunning `prepare.py` |

### Throughput vs. Capacity

| Knob | Notes |
|------|-------|
| `DEVICE_BATCH_SIZE` | Tokens per forward pass. Limited by VRAM |
| `TOTAL_BATCH_SIZE` | Effective batch size. `gradient_accumulation_steps = TOTAL_BATCH_SIZE / DEVICE_BATCH_SIZE` |
| `MAX_SEQ_LEN` | Context window. Larger = more context, more memory, slower steps |

Increasing `TOTAL_BATCH_SIZE` gives smoother gradients but reduces the number of weight updates within the 5-minute budget. Decreasing it does the opposite. This is a classic throughput/quality tradeoff and a productive area for agent experimentation.

### Architecture Experiments

**`WINDOW_PATTERN`** is arguably the highest-value knob for the agent to explore. It sets the attention pattern per layer:

- `"SSSL"` = three Sliding-window attention layers + one Local attention layer (default baseline)
- `"SSL"` = two Sliding + one Local
- `"L"` = all Local attention

Sliding-window attention has a larger effective receptive field than purely local attention. Different patterns trade off receptive field against compute cost.

### Evaluation Quality

**`EVAL_TOKENS`** controls how many tokens are used for each val_bpb estimate. More tokens = lower variance = more reliable signal, but slower evaluation intervals.

---

## 7. The Agent Edit→Train→Evaluate Loop

The agent runs this loop continuously within a session:

```
1.  Read train.py (full file)
2.  Read program.md (constraints and strategy)
3.  Propose a change (typically one small hypothesis)
4.  Write modified train.py
5.  Execute: uv run train.py
6.  Training runs for exactly 5 wall-clock minutes
7.  Final val_bpb printed to stdout
8.  Agent reads stdout
9.  Compare val_bpb to previous best
10a. KEEP: git commit, log "KEPT: [description] val_bpb: X → Y"
10b. REVERT: git checkout train.py, log "DISCARDED: [description] val_bpb: X → Y"
11. Repeat from step 1
```

The git history is the experiment log. Each kept change is a commit; discarded changes leave no trace in the commit history but are recorded in the agent's text log. After an overnight run, `git log --oneline` shows the kept experiments in sequence. `git diff HEAD~5` shows the delta from 5 kept experiments ago.

The agent is expected to make small, interpretable changes — one hypothesis per experiment. Large refactors are harder to attribute and harder to revert cleanly.

---

## 8. The Agent Permission Model

The README is explicit: **disable all permissions on the agent**. This means:

- No bash commands except `uv run train.py`
- No internet access
- No package installs
- No file edits except `train.py`
- No reads outside the project directory

**Why this matters beyond "good hygiene":**

An agent with unrestricted bash access could cheat. It could write a script that fakes `val_bpb` output, cache a previous result and re-report it without running training, or install packages that silently change behavior. The permission model ensures the agent is playing by the rules — every reported val_bpb reflects a real 5-minute training run.

On a shared cluster, the same reasoning aligns with **HPC security requirements**: agents must not install packages to shared filesystems, access other users' data, or reach external networks during compute jobs. The autoresearch permission model maps directly to what HPC sysadmins enforce for good reasons. See [[slurm-vs-flux-reference]] for cluster-level permission contexts.

**Claude Code permission configuration:**

In Claude Code, you can restrict permissions by configuring the `allowedTools` and disabling file system access beyond the project root. The specific flags depend on your Claude Code version, but the principle is: the agent should be able to read the project directory, write `train.py`, and execute one command.

---

## 9. autoresearch vs. AutoML / HPO Frameworks

| Feature | autoresearch | Optuna | Ray Tune | NNI |
|---------|-------------|--------|----------|-----|
| What it optimizes | Any code change (architecture, optimizer, training loop) | Hyperparameter values in predefined space | Hyperparameter values in predefined space | Hyperparameters + some architecture via NAS |
| Search space | Unbounded (agent imagination) | You define it | You define it | Partially defined |
| Human role | Edit `program.md` | Define search space + objective | Define search space + objective | Define search space |
| Parallelism | Sequential by default | Parallel (multi-process/GPU) | Parallel (distributed) | Parallel |
| Reproducibility | Git history | Study database | Ray object store | Experiment log |
| Code changes | Yes | No | No | NAS only |

The critical axis: autoresearch lets the agent change the *code*, not just values within a predefined hyperparameter space. The agent can invent a new attention pattern, change the optimizer, restructure the training loop, or combine two previously separate ideas. This is fundamentally different from HPO, where the search space is fixed at the start and the optimizer only picks values within it.

The cost: autoresearch is sequential by default. Optuna, Ray Tune, and NNI can all run parallel trials across multiple GPUs or machines. A single autoresearch run is one experiment at a time on one GPU.

---

## 10. Karpathy Lineage

Understanding where autoresearch sits in Karpathy's project history explains design choices.

**nanoGPT (2022):** Minimal GPT-2 training in PyTorch. ~300 lines. "Hello world" of LLM training. Train on Shakespeare or OpenWebText. The template that everything downstream borrows from.

**nanochat (2023–2024):** Extension of nanoGPT with chat format. Adds SFT, RLHF scaffolding. More realistic training loop. autoresearch uses nanochat's training core as its base.

**llm.c (2024):** GPT-2/GPT-4 training in pure C/CUDA. Extreme performance focus. Demonstrates the gap between Python convenience and hardware efficiency. Not agent-friendly — too low-level for an LLM to meaningfully modify.

**autoresearch (2026):** Takes nanochat's training core, wraps it in an agent loop. The insight: the 630-line single-GPU Python version is the right level of abstraction for an agent to meaningfully modify. Low enough to have real impact; high enough to be readable.

The lineage is a ladder of abstraction. autoresearch sits at the point where an agent can understand the whole system in a single context window and propose semantically meaningful changes.

---

## 11. Notable Forks

Every fork listed here had to address the same upstream assumption: FlashAttention-3, which is an NVIDIA H100-specific fast attention kernel. This is the number-one portability assumption in the original code.

**miolini/autoresearch-macos (Apple Silicon / MPS):** Uses SDPA fallback instead of FlashAttention-3 (MPS does not support the CUDA kernel). Implements sliding-window causal mask manually since MPS does not support the CUDA kernel for it. Disables `torch.compile` on MPS paths. Adjusts optimizer state casting for MPS compatibility.

**trevin-creator/autoresearch-mlx (Apple Silicon / MLX):** Ditches PyTorch entirely and uses Apple's MLX framework. Avoids MPS compatibility issues at the cost of leaving the PyTorch ecosystem. Different API surface for the agent to work with.

**jsegov/autoresearch-win-rtx (Windows / RTX):** Handles Windows path conventions, CUDA driver compatibility on Windows, and provides a Flash Attention wheel precompiled for Windows.

**andyluo7/autoresearch (AMD / ROCm):** Replaces the CUDA backend with AMD's ROCm. Requires a ROCm-compatible PyTorch build. The training loop logic is unchanged; the backend swap is the entire diff.

---

## 12. Phase 1 — Orientation

**Goal:** understand the repo well enough to run a single experiment manually before handing control to the agent.

### Step 1: Clone and inspect

```bash
git clone https://github.com/karpathy/autoresearch
cd autoresearch
ls -la
```

You should see: `prepare.py`, `train.py`, `program.md`, `pyproject.toml`, and a `.git` directory.

### Step 2: Install dependencies

autoresearch uses `uv` for environment management.

```bash
# Install uv if not present
curl -LsSf https://astral.sh/uv/install.sh | sh

# Sync the project environment
uv sync
```

The `pyproject.toml` pins all dependencies including Muon.

```toml
# pyproject.toml (representative — check actual repo for exact pins)
[project]
name = "autoresearch"
requires-python = ">=3.11"
dependencies = [
    "torch>=2.3",
    "muon",
    "tiktoken",
    "datasets",
    "transformers",
]
```

### Step 3: Run prepare.py once

```bash
uv run prepare.py
```

This downloads TinyStories from HuggingFace, trains the BPE tokenizer with `vocab_size=8192`, and writes tokenized data files to disk. Expect this to take a few minutes on first run. Do not run again unless you want to change `vocab_size`.

### Step 4: Read program.md

Before running anything, read `program.md` to understand what the agent is supposed to do. The bare-bones baseline looks approximately like:

```markdown
# Research Program

You may edit train.py only.
Optimize val_bpb (lower is better).
After each experiment:
- If val_bpb decreased: git commit the change. Log: KEPT: [description] val_bpb: X → Y
- If val_bpb did not decrease: git checkout train.py. Log: DISCARDED: [description] val_bpb: X → Y
Do not install new packages. Do not use multiple GPUs. Do not access the internet.
```

### Step 5: Run train.py manually once

```bash
uv run train.py
```

Watch the output. You will see compilation (excluded from budget), then training steps, then a final `val_bpb: X.XXXX` line after 5 minutes. This is your baseline. Record it.

---

## 13. Phase 2 — Hands-On

### NVIDIA Path (Linux + CUDA)

This is the canonical path. Assumes a single NVIDIA GPU with CUDA 12.x and sufficient VRAM (16 GB minimum recommended; H100 for parity with upstream results).

#### Verify GPU access

```bash
nvidia-smi
python -c "import torch; print(torch.cuda.get_device_name(0))"
```

#### Run a manual experiment

Before launching the agent, run one manual experiment to confirm val_bpb improves or changes as expected. Edit `train.py` directly — for example, change `WINDOW_PATTERN`:

```python
# Original
WINDOW_PATTERN = "SSSL"

# Your experiment
WINDOW_PATTERN = "SSL"
```

Run, record val_bpb, revert:

```bash
uv run train.py
# note val_bpb
git checkout train.py
```

#### Launch the agent loop

In Claude Code, open the autoresearch directory, disable all agent permissions except `uv run train.py` and `train.py` writes, then start the agent with a prompt like:

```
Follow program.md. Run experiments on train.py. Report val_bpb for each experiment.
```

The agent will read `program.md`, read `train.py`, propose a change, run training, evaluate the result, commit or revert, and repeat.

#### Monitor progress

```bash
# Watch git log in another terminal
watch -n 60 git log --oneline

# Follow the agent's experiment log
tail -f agent_log.txt  # or wherever the agent writes its log
```

### Apple Silicon Path (macOS + MPS)

Apple Silicon does not support FlashAttention-3. Use the `miolini/autoresearch-macos` fork, which patches the MPS-incompatible components.

```bash
git clone https://github.com/miolini/autoresearch-macos
cd autoresearch-macos
uv sync
```

**Key differences from upstream:**

- `torch.compile` is disabled on MPS paths (MPS compiler support is incomplete)
- Sliding-window causal mask is implemented manually in Python rather than via the CUDA kernel
- SDPA (Scaled Dot-Product Attention) fallback replaces FlashAttention-3
- Optimizer state casting is adjusted for MPS dtype behavior

**Performance caveat:** The 5-minute budget on an M2/M3/M4 MacBook yields significantly fewer training steps than an H100. Your val_bpb values will differ. Compare only within your own hardware session.

```bash
# Verify MPS is available
python -c "import torch; print(torch.backends.mps.is_available())"

# Run prepare once
uv run prepare.py

# Run training
uv run train.py
```

The experiment loop is otherwise identical. The `program.md` approach, the keep/revert logic, and the agent instructions are unchanged.

---

## 14. Phase 3 — Deep Dive

### Recommended First Experiment

If this is your first run and you want a concrete, interpretable starting experiment:

**Hypothesis:** The 4th sliding-window layer in `WINDOW_PATTERN = "SSSL"` has diminishing returns. Removing it (`"SSL"`) should improve throughput enough to run more training steps in the 5-minute budget, reducing val_bpb.

```python
# Change in train.py
WINDOW_PATTERN = "SSL"  # was "SSSL"
```

This has one variable (the pattern), a clear throughput hypothesis, and a straightforward val_bpb comparison. It is easy to interpret whether the result confirms or refutes the hypothesis.

### Reading the Experiment History

After an overnight run, the git history tells the story:

```bash
# Condensed log of kept experiments
git log --oneline

# Show what each kept experiment actually changed
git log -p --follow train.py | less

# Compare current best to original
git diff HEAD~20 train.py  # if 20 experiments were kept
```

### Extending program.md

Add hypotheses as a list. The agent will work through them in order or use them as priors:

```markdown
# Hypotheses to explore (in rough priority order)
1. muon_beta2=0.98 may outperform default 0.95 (smooths Newton-Schulz normalization)
2. WINDOW_PATTERN="SSL" may improve throughput vs "SSSL"
3. Larger TOTAL_BATCH_SIZE may give smoother gradients without hurting step count much
4. DEPTH=10 may improve capacity without prohibitive slowdown at this seq len

# Constraints
- Do not reduce DEPTH below 6
- Do not change vocab_size (would require rerunning prepare.py)
- Do not use multi-GPU
```

### Interpreting Results

A val_bpb decrease is necessary but not sufficient to declare an experiment successful. Also consider:

- **Is the improvement within noise?** Run the same config twice to estimate variance. Two runs with identical `train.py` will not give identical val_bpb due to random initialization and data ordering.
- **Did the change interact with a previous change?** If the agent already changed `WINDOW_PATTERN` and now changes `muon_beta2`, the combination effect is entangled. The git history lets you unpack this, but it takes manual analysis.
- **Is the improvement hardware-specific?** An attention pattern that wins on H100 may not win on A100 due to different memory bandwidth profiles.

### The autoresearch-skill Packaging Pattern

The `wjgoarxiv/autoresearch-skill` repo packages the `program.md` → agent loop pattern as a Claude Code skill. Instead of running the agent from the autoresearch repo root with a full `train.py` present, you invoke the skill from any project and it brings the autoresearch loop to that project. More portable; loses tight integration with a specific `train.py`. Useful as a template for adapting the pattern to other single-file training codebases.

---

## 15. Phase 4 — HPC / Slurm

### Where autoresearch Clashes with HPC Patterns

| HPC assumption | autoresearch reality |
|----------------|---------------------|
| Jobs use MPI/NCCL across multiple nodes | Single-GPU, no MPI |
| Jobs checkpoint to scratch on SIGTERM | No native checkpoint across experiments |
| Shared-FS conventions (scratch vs. home) | Agent doesn't know about FS layout |
| Short interactive queues for testing | Works well here; long batch queues are overkill |

See [[slurm-vs-flux-deep-dive]] for Slurm/Flux mechanics and [[hpc-ai-tech-stack]] for the broader ML infrastructure context.

### Where autoresearch Fits HPC

- **Per-user single-GPU partitions** (dev/interactive QoS): autoresearch is a natural fit. One GPU, exploratory, bounded runtime.
- **Cost**: a single-GPU allocation is the cheapest allocation. An overnight autoresearch run costs roughly the same as a short MPI job.
- **Reproducibility**: Apptainer packages the entire Python environment, matching the cluster OS without root. See [[syft-apptainer-sbom]] for SBOM-level reproducibility and [[apptainer-module14-120min-expansion-spec]] for Apptainer depth.

### Apptainer Container

Package the autoresearch environment in an Apptainer (formerly Singularity) container so the pinned Python environment is portable across cluster OS versions.

```bash
# autoresearch.def
Bootstrap: docker
From: nvidia/cuda:12.4.0-devel-ubuntu22.04

%post
    apt-get update && apt-get install -y python3-pip curl git
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="/root/.cargo/bin:$PATH"
    cd /autoresearch
    uv sync

%environment
    export PATH="/root/.cargo/bin:$PATH"

%runscript
    exec uv run "$@"
```

```bash
# Build the container (on a login node with write access)
apptainer build autoresearch.sif autoresearch.def

# Test it
apptainer run --nv autoresearch.sif train.py --help
```

### Slurm Job Template

```bash
#!/bin/bash
#SBATCH --job-name=autoresearch
#SBATCH --gres=gpu:1
#SBATCH --mem=32G
#SBATCH --time=10:00:00
#SBATCH --output=logs/%j.out
#SBATCH --error=logs/%j.err

module load apptainer

# Work in scratch to avoid home quota pressure
WORKDIR=$SCRATCH/autoresearch-$SLURM_JOB_ID
mkdir -p $WORKDIR
cp -r /path/to/autoresearch $WORKDIR/
cd $WORKDIR/autoresearch

# Data should already be prepared; if not:
# apptainer run --nv autoresearch.sif prepare.py

# Start agent loop (Claude Code or similar, permissions disabled)
# The agent edits train.py and runs: uv run train.py
# Replace the line below with your agent invocation
apptainer run --nv autoresearch.sif uv run train.py
```

**Time budget math:** 10-hour Slurm job / 5 minutes per experiment = approximately 120 experiments. Add overhead for Python startup and `torch.compile` (typically 2-3 minutes per experiment first compile, then cached): effective ceiling closer to 90-100 experiments for a 10-hour job.

### Security on Shared Clusters

The "all permissions disabled" requirement from the README is not just good practice — it maps directly to cluster security requirements:

- No `pip install` or `uv add` during the run — the venv must be complete before the job starts. Package installs to shared filesystems are a security and reproducibility hazard.
- No outbound network during the job — data staging happens before submission from a login node.
- Write access scoped to `$SCRATCH/autoresearch-$SLURM_JOB_ID/` only.
- The agent must not have access to `$HOME` or other users' directories.

See [[WW4_ANSIBLE_INTEGRATION]] for Ansible-based enforcement of these constraints in cluster provisioning.

### Slurm Job Arrays for Parallel program.md Variants

A single autoresearch run is sequential. To explore multiple research directions in parallel, use a Slurm job array where each job runs a different `program.md`.

```bash
#!/bin/bash
#SBATCH --job-name=autoresearch-array
#SBATCH --array=0-2
#SBATCH --gres=gpu:1
#SBATCH --mem=32G
#SBATCH --time=10:00:00
#SBATCH --output=logs/%A_%a.out

module load apptainer

# Select program.md by array task ID
PROGRAMS=(
    "program_arch_search.md"      # Job 0: aggressive architecture search
    "program_optimizer_tuning.md" # Job 1: Muon beta2, learning rate schedules
    "program_conservative.md"     # Job 2: only eval-stable knobs
)
PROGRAM=${PROGRAMS[$SLURM_ARRAY_TASK_ID]}

WORKDIR=$SCRATCH/autoresearch-$SLURM_ARRAY_JOB_ID-$SLURM_ARRAY_TASK_ID
mkdir -p $WORKDIR
cp -r /path/to/autoresearch $WORKDIR/
cd $WORKDIR/autoresearch
cp /path/to/programs/$PROGRAM program.md

# Launch agent with this program.md
apptainer run --nv autoresearch.sif uv run train.py
```

Example `program_arch_search.md`:

```markdown
# Architectural Search Program

Focus exclusively on architectural changes this session:
- DEPTH (range: 6-12)
- WINDOW_PATTERN variants (combinations of S and L)
- MAX_SEQ_LEN adjustments

Do not touch optimizer hyperparameters this session.
Optimize val_bpb. Keep if improved, revert if not.
Log all experiments.
```

Example `program_optimizer_tuning.md`:

```markdown
# Optimizer Tuning Program

Focus exclusively on optimizer hyperparameters this session:
- muon_beta2 (try: 0.90, 0.95, 0.98, 0.99)
- learning rate schedule shape
- TOTAL_BATCH_SIZE variants

Do not touch model architecture this session.
Optimize val_bpb. Keep if improved, revert if not.
Log all experiments.
```

**Caveats on job arrays:**

- Cross-array results are *not* directly comparable. Different jobs start from the same `train.py` but diverge immediately. A val_bpb of X in job 0 and Y in job 1 does not tell you which direction was better, because both trains ran different sequences of experiments with different random orderings.
- You are doing **meta-research**: exploring which *research strategy* (architecture search vs. optimizer tuning) produces better final val_bpb. This is valid but different from a single coherent research thread.
- After the array completes, manually inspect each job's git log, pick the best-performing `train.py` from each, and run a comparison if you want to synthesize findings.

### HPC-Friendly Fork: What It Would Change

An HPC-adapted autoresearch fork would add:

- **Slurm-aware checkpointing:** save `train.py` state + val_bpb history to `$SCRATCH` on `SIGTERM` so a preempted job can resume
- **Per-experiment scratch dirs** with lineage tracking: `best_run -> experiment_042/` symlink chain
- **Agent-generated sbatch templates** with `--time` computed from the 5-min x N experiments math
- **MUNGE-aware multi-user log aggregation** if you want a shared "research org" across cluster users

See [[CONFIG_MANAGERS]] for configuration management patterns that could apply to autoresearch experiment tracking.

---

## 16. Related Tutorials

- [[slurm-vs-flux-reference]] — Slurm vs. Flux command comparison; relevant for job submission patterns in Phase 4
- [[slurm-vs-flux-deep-dive]] — Deeper treatment of Slurm scheduler mechanics; useful for understanding job array behavior
- [[hpc-ai-tech-stack]] — Overview of the ML infrastructure stack autoresearch runs on
- [[syft-apptainer-sbom]] — SBOM generation for Apptainer containers; reproducibility in the cluster path
- [[apptainer-module14-120min-expansion-spec]] — Extended Apptainer reference; container build and deployment details
- [[WW4_ANSIBLE_INTEGRATION]] — Ansible-based cluster provisioning; enforcing the permission constraints autoresearch requires
- [[ideas-research-analysis]] — Broader research strategy; connects to the program.md-as-research-program framing
- [[CONFIG_MANAGERS]] — Configuration management patterns applicable to experiment tracking
- [[autoresearch-beginner-guide|Autoresearch Beginner Guide]] — Start here if this document is too dense; covers setup and first run step by step

---

## 17. Summary

autoresearch is a tight system: 630 lines of training code, one human-editable research spec, one agent loop, and one vocab-invariant metric. The design choices are mutually reinforcing. The 5-minute budget makes all experiments comparable. The val_bpb metric makes architectural changes comparable. The three-file split keeps the agent's scope narrow and auditable. The permission restrictions keep the results honest.

The conceptual contribution is the inversion: the researcher programs the *research process* in `program.md`, and the agent programs the *implementation* in `train.py`. This shifts the human's role from writing training code to writing research intent.

On HPC infrastructure, autoresearch maps cleanly to per-user single-GPU allocations with Apptainer containerization. Slurm job arrays provide a path to parallel exploration of different research strategies, though cross-array result comparison requires care. The permission model the repo recommends aligns directly with cluster security requirements, making autoresearch a reasonable fit for multi-tenant GPU clusters when set up correctly.

First overnight run results (Karpathy, H100): approximately 100 experiments, roughly 20 improvements that stacked, 11% reduction in time-to-GPT-2 on the nanochat leaderboard. Notable late-stage finding: `muon_beta2=0.98` outperformed the default `0.95`.
