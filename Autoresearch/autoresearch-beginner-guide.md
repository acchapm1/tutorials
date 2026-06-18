---
title: "Autoresearch: Beginner's Guide to Autonomous ML Experiments"
date: 2026-06-16
difficulty: beginner
tags:
  - autoresearch
  - karpathy
  - machine-learning
  - pytorch
  - autonomous-agents
  - gpt
  - tinystories
  - nanoGPT
---

# Autoresearch: Beginner's Guide to Autonomous ML Experiments

## Overview

**Autoresearch** is a ~630-line Python project released by Andrej Karpathy on March 7, 2026. The core idea: instead of manually tweaking a training script and running experiments yourself, you write instructions in plain English and let an AI agent run the experiments overnight on a single GPU. You wake up to a log of what was tried, what worked, and what didn't.

It is not a framework. It is not a hyperparameter search library. It is a minimal loop that inverts the normal ML research workflow: you stop editing `train.py` and start editing `program.md`.

This tutorial gets you from zero to a running overnight experiment. It covers both the NVIDIA GPU path and the Apple Silicon path. No prior experience with autoresearch is required, but you should be comfortable with Linux, Python, and git.

Companion reference: [[autoresearch-deep-dive|Autoresearch Deep Dive]]

---

## Prerequisites

**Hardware:**
- NVIDIA GPU with at least 8 GB VRAM (for the main path), or
- Apple Silicon Mac (M1/M2/M3/M4) with at least 16 GB unified memory (for the MPS path)

**Software:**
- Python 3.11 or newer
- `uv` — the package manager autoresearch uses. Install it if you don't have it:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

- `git`
- An AI agent that can edit files and run shell commands (Claude, GPT-4o, etc.) — you will need to configure this separately per your agent setup. Autoresearch does not bundle the agent; it provides the loop the agent runs inside.

**Knowledge:**
- Comfortable running commands in a terminal
- Basic understanding of what a transformer is (you don't need to implement one)
- Familiarity with `git` at the level of `clone`, `commit`, `log`

---

## Key Concepts

Before running anything, these four ideas will make the codebase make sense.

### The Inversion

In a normal ML workflow you edit `train.py`, run it, read the loss, edit again. In autoresearch, you write `program.md` (plain text instructions) and the agent edits `train.py`, runs it, reads the metric, keeps or reverts the change, and repeats. Your job moves from writing code to writing instructions about what kind of code changes are allowed.

### The Three Files

| File | Who edits it | Purpose |
|------|-------------|---------|
| `prepare.py` | Nobody (frozen) | One-time data prep: downloads TinyStories, trains a BPE tokenizer |
| `train.py` | The agent | GPT model, optimizer, data loader, eval loop |
| `program.md` | You | Instructions for the agent: what to change, what metric to optimize, keep/revert rules |

`prepare.py` runs once. After that, you never touch it. The agent never touches it either — that is the point of keeping it frozen.

### val_bpb — The Key Metric

**val_bpb** stands for validation bits per byte. Lower is better.

The reason autoresearch uses BPB instead of cross-entropy loss: loss depends on vocabulary size. If the agent tries a change that also adjusts `vocab_size`, comparing loss before and after is meaningless — you're comparing different scales. BPB normalizes for vocabulary size, so architectural experiments are on a fair footing regardless of what the agent changes.

### The 5-Minute Budget

Each experiment gets exactly **5 minutes of wall-clock training time**, excluding startup and torch.compile time. This is not configurable per-experiment — it is enforced by the loop. The fixed budget means:

- ~12 experiments per hour
- ~100 experiments overnight (8 hours)
- You cannot "win" by simply training longer; a change that improves val_bpb in 5 minutes is a genuine improvement

---

## Step-by-Step Instructions

### Path A: NVIDIA GPU

#### 1. Clone the repository

```bash
git clone https://github.com/karpathy/autoresearch.git
cd autoresearch
```

#### 2. Install dependencies

```bash
uv sync
```

`uv` reads `pyproject.toml` and installs everything into an isolated virtual environment. Expected output:

```
Resolved N packages in Xs
Installed N packages in Xs
```

#### 3. Run data preparation (once)

```bash
uv run prepare.py
```

This downloads the TinyStories dataset and trains a BPE tokenizer with `vocab_size=8192`. It writes tokenized data shards to disk. This step takes several minutes depending on your internet connection and CPU speed. You only ever run this once.

Expected output (abbreviated):

```
Downloading TinyStories...
Training BPE tokenizer (vocab_size=8192)...
Tokenizing and sharding data...
Done. Data written to data/
```

#### 4. Verify the baseline runs

Before you hand control to the agent, confirm the training script runs correctly:

```bash
uv run train.py
```

Let it run for 30–60 seconds, then Ctrl-C. You should see lines like:

```
step 100 | loss 4.2314 | val_bpb 2.1847 | dt 312ms
step 200 | loss 3.9871 | val_bpb 2.0934 | dt 308ms
```

If you see CUDA errors here, check your driver version and that PyTorch can see your GPU:

```bash
uv run python -c "import torch; print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0))"
```

#### 5. Edit program.md

Open `program.md`. The default content is a minimal baseline prompt telling the agent what it may change and what metric to optimize. Read it. Then decide what you want to focus on.

The default is intentionally bare-bones. Common edits at the beginner level:

- Restrict the agent to only hyperparameter changes (safer, less likely to break things)
- Allow the agent to try architectural changes like attention window patterns
- Set a target val_bpb to aim for

A minimal conservative `program.md` might look like:

```markdown
# Autoresearch Program

## Objective
Minimize val_bpb on the TinyStories validation set.

## What you may change
- Learning rate and schedule parameters
- DEPTH, MAX_SEQ_LEN, DEVICE_BATCH_SIZE, TOTAL_BATCH_SIZE
- WINDOW_PATTERN (valid values: "SSSL", "L")
- Any numerical hyperparameter in train.py

## What you may NOT change
- The tokenizer or vocab_size
- The data loading code
- The evaluation logic
- The 5-minute wall-clock budget

## Keep/revert rule
If val_bpb improves (decreases), keep the change and commit.
If val_bpb worsens (increases), revert train.py to the previous version.

## Baseline
The current train.py is the baseline. Do not assume any previous improvements.
```

#### 6. Configure your agent and disable all permissions

This step is agent-specific, but the principle is universal: **disable all permissions except file editing and running shell commands within the project directory.** The README is explicit about this. The agent must not have:

- Internet access
- Ability to install packages (`pip install`, `uv add`, etc.)
- Ability to run commands outside the project directory

Restricting permissions protects you from the agent doing something unexpected (installing a library, making network calls, writing files elsewhere on your system).

#### 7. Start the agent loop

Point your agent at the autoresearch directory with the instruction to run the experiment loop as described in `program.md`. The agent will:

1. Read `train.py` and `program.md`
2. Make a small change to `train.py`
3. Run `uv run train.py`
4. Read the val_bpb output
5. Keep or revert the change
6. Commit if kept
7. Log the experiment
8. Repeat

Leave it running overnight.

#### 8. Read the results in the morning

```bash
git log --oneline
```

Each commit is a kept experiment. To see what changed in a specific experiment:

```bash
git show <commit-hash>
```

To see the val_bpb trend across all kept experiments, look at the agent's log file (location depends on your agent setup).

---

### Path B: Apple Silicon (MPS)

The main repo requires FlashAttention-3, which is not available on Apple Silicon. Use the community MPS port instead.

#### 1. Clone the MPS fork

```bash
git clone https://github.com/miolini/autoresearch-macos.git
cd autoresearch-macos
```

**What this fork changes compared to the main repo:**
- Replaces FlashAttention-3 with PyTorch's built-in SDPA (Scaled Dot-Product Attention)
- Disables `torch.compile` on MPS code paths (MPS compiler support is limited)
- Implements the sliding-window causal mask manually (the main repo relies on FA3 for this)
- Substitutes TinyStories dataset (same dataset, different download path for reliability)

Steps 2–8 are identical to Path A. `uv sync`, `uv run prepare.py`, verify with `uv run train.py`, edit `program.md`, start the agent.

**Performance note:** MPS throughput is lower than a high-end NVIDIA GPU. The 5-minute budget is the same, but you will see fewer tokens per second. This is expected — the experiments still work, they just cover less training territory per run. On an M2 Pro you can expect roughly 1/3 to 1/2 the throughput of an RTX 4090.

---

## Practical Examples

### Example 1: What the agent log looks like

After a few hours, your git log might look like:

```
a3f1c2d Increase DEPTH from 8 to 10: val_bpb 2.1847 -> 2.1623 (kept)
7b8e4f1 Try WINDOW_PATTERN="SSSL": val_bpb 2.1623 -> 2.1589 (kept)
2d9a0e3 Reduce MAX_SEQ_LEN from 1024 to 512: val_bpb 2.1589 -> 2.1901 (reverted)
f4c2b7a Increase TOTAL_BATCH_SIZE from 524288 to 1048576: val_bpb 2.1589 -> 2.1441 (kept)
```

Notice the reverted experiment does not appear in the commit history — the agent only commits improvements. The log of what was tried including failures lives in the agent's own output.

### Example 2: Key knobs in train.py

These are the variables the agent most commonly adjusts:

```python
# Architecture
DEPTH = 8              # Number of transformer layers
MAX_SEQ_LEN = 1024     # Context window length
vocab_size = 8192      # Must match the BPE tokenizer from prepare.py

# Training
DEVICE_BATCH_SIZE = 32        # Samples per GPU per step
TOTAL_BATCH_SIZE = 524288     # Effective batch size (uses gradient accumulation)

# Attention pattern
WINDOW_PATTERN = "SSSL"  # S=Sliding window, L=Local full attention
                          # "L" = all layers use local full attention
                          # "SSSL" = three sliding + one local

# Evaluation
EVAL_TOKENS = 10_000_000  # Tokens evaluated per val_bpb computation
```

`vocab_size` is the one to lock in `program.md` — if the agent changes it, val_bpb comparisons across experiments become invalid.

### Example 3: Karpathy's first overnight result

The first overnight run produced approximately 20 kept improvements that stacked to an **11% reduction in time-to-GPT-2** on the nanochat leaderboard. This means the final model reached the performance of GPT-2 using 11% less compute than the baseline. That came from a single GPU running 8 hours with no human intervention between experiments.

---

## Hands-On Exercises

Work through these in order. Each one builds on the previous.

**Exercise 1: Run the baseline and record your val_bpb**

Run `uv run train.py` for exactly 5 minutes (use a timer). Note the final val_bpb. This is your personal baseline. Write it down — you'll compare against it after the overnight run.

**Exercise 2: Read train.py top to bottom**

Before letting the agent touch the file, read it yourself. Identify where `DEPTH`, `MAX_SEQ_LEN`, `WINDOW_PATTERN`, and `EVAL_TOKENS` are defined. Understand what `val_bpb` is computed from. This takes 15–20 minutes and will make the agent's changes much easier to interpret in the morning.

**Exercise 3: Write a restrictive program.md**

Write a `program.md` that restricts the agent to only changing `DEPTH`, `MAX_SEQ_LEN`, and `TOTAL_BATCH_SIZE`. Run a short agent session (1–2 hours). Review the git log and check whether the val_bpb trend is monotonically decreasing across kept commits (it should be — if not, something is wrong with the keep/revert logic).

**Exercise 4: Widen the search space**

Edit `program.md` to also allow `WINDOW_PATTERN` changes and optimizer hyperparameters (learning rate, weight decay). Run overnight. Compare the number of improvements to Exercise 3.

**Exercise 5: Inspect a reverted experiment**

Look at your agent's log for an experiment that was reverted. Find the `train.py` diff the agent attempted. Ask yourself: does the revert make sense given the val_bpb change? This builds intuition for what the agent is doing and whether it is exploring sensibly.

---

## Troubleshooting

**`uv sync` fails with a Python version error**

```
error: The Python version X.Y does not satisfy the constraint >=3.11
```

Install Python 3.11+ and ensure `uv` finds it. On Linux with `pyenv`:

```bash
pyenv install 3.11.9
pyenv local 3.11.9
uv sync
```

**`uv run train.py` fails with `CUDA error: no kernel image is available`**

Your PyTorch build does not match your CUDA driver version. Check which CUDA version your driver supports:

```bash
nvidia-smi | grep "CUDA Version"
```

Then reinstall PyTorch for that CUDA version by editing `pyproject.toml` to pin the correct PyTorch index URL. See [pytorch.org/get-started](https://pytorch.org/get-started) for the correct `--index-url`.

**On Apple Silicon: `uv run train.py` fails with MPS backend error**

Make sure you cloned the MPS fork (`miolini/autoresearch-macos`), not the main repo. The main repo requires FlashAttention-3 which is NVIDIA-only.

**val_bpb is not decreasing after many experiments**

This is not necessarily a bug — the agent may be stuck in a local optimum or exploring a bad region of the search space. Try editing `program.md` to be more specific about what directions to explore, or broaden the search space if you restricted it too much.

**The agent commits a change that makes val_bpb worse**

The keep/revert logic is in `program.md` — it is only enforced if the agent follows your instructions. Review your `program.md` keep/revert rule. Make the instruction explicit:

```markdown
## Keep/revert rule
Compare val_bpb AFTER the run to val_bpb BEFORE the run (stored in your log).
If val_bpb_after < val_bpb_before: run `git add train.py && git commit -m "..."`.
If val_bpb_after >= val_bpb_before: run `git checkout train.py` to revert.
Do not commit unless val_bpb strictly improved.
```

**The agent is making changes to files other than train.py**

Your agent permissions are too broad. Restrict the agent to only be able to edit `train.py` and only be able to run `uv run train.py`. Everything else should be read-only or blocked.

---

## References

- Autoresearch repo: [github.com/karpathy/autoresearch](https://github.com/karpathy/autoresearch)
- Apple Silicon MPS fork: [github.com/miolini/autoresearch-macos](https://github.com/miolini/autoresearch-macos)
- Apple Silicon MLX fork (no PyTorch): [github.com/trevin-creator/autoresearch-mlx](https://github.com/trevin-creator/autoresearch-mlx)
- Windows RTX fork: [github.com/jsegov/autoresearch-win-rtx](https://github.com/jsegov/autoresearch-win-rtx)
- AMD GPU fork: [github.com/andyluo7/autoresearch](https://github.com/andyluo7/autoresearch)
- nanoGPT (autoresearch's ancestor): [github.com/karpathy/nanoGPT](https://github.com/karpathy/nanoGPT)
- TinyStories dataset: [Eldan & Li (2023), arxiv.org/abs/2305.07759](https://arxiv.org/abs/2305.07759)
- `uv` documentation: [docs.astral.sh/uv](https://docs.astral.sh/uv)
- Muon optimizer (used in train.py): [github.com/KellerJordan/Muon](https://github.com/KellerJordan/Muon)

**Comparison with hyperparameter optimization tools (Optuna, Ray Tune, NNI):** These tools search over a hyperparameter space you define in advance. Autoresearch lets the agent change arbitrary code — it can invent new architectures, restructure the training loop, change the optimizer. The search space is not pre-defined; it is whatever the agent can conceive of within the constraints in `program.md`. This is a meaningfully different capability, not just a different interface to the same thing. See also [[ideas-research-analysis]] for notes on autonomous research tooling more broadly.

---

## Related Tutorials

- [[autoresearch-deep-dive|Autoresearch Deep Dive]]
- [[hpc-ai-tech-stack]]
- [[slurm-vs-flux-reference]]
- [[slurm-vs-flux-deep-dive]]
- [[apptainer-module14-120min-expansion-spec]]
- [[syft-apptainer-sbom]]
- [[WW4_ANSIBLE_INTEGRATION]]
- [[ideas-research-analysis]]
- [[CONFIG_MANAGERS]]

---

## Summary

Autoresearch inverts the standard ML experiment loop. Instead of you editing `train.py` and running experiments, you write `program.md` and the agent runs the experiments. The fixed 5-minute wall-clock budget per experiment makes results comparable across architectural changes. The key metric is val_bpb (validation bits per byte) — lower is better, and it is normalized for vocabulary size so different architectures can be fairly compared.

The three files to know: `prepare.py` (frozen, runs once), `train.py` (the agent edits this), `program.md` (you edit this). The agent's permissions should be locked down to editing `train.py` and running `uv run train.py` — nothing else.

For NVIDIA GPUs, use the main repo. For Apple Silicon, use `miolini/autoresearch-macos`. Both use `uv` for environment management and follow the same experiment loop.

The first step is always to run the baseline yourself, record your val_bpb, and read `train.py` before handing it to the agent. Understanding what the agent is modifying — even at a high level — makes it much easier to interpret results and debug problems when they arise.
