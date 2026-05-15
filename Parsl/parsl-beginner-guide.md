---
title: "Parsl Beginner Guide: Your First Parallel Workflows on HPC with Slurm"
date: 2026-05-07
difficulty: beginner
tags: [parsl, python, hpc, slurm, parallel-computing, workflows, beginner]
---

# Parsl Beginner Guide: Your First Parallel Workflows on HPC with Slurm

> **Related tutorials:** [[parsl-deep-dive|Parsl Deep Dive]] · [[hyperqueue-basics|HyperQueue Basics]] · [[hyperqueue-deep-dive|HyperQueue Deep Dive]]

This guide takes you from zero to running your first Parsl workflow on a Slurm-managed HPC cluster. No prior experience with Parsl is needed — just basic Python and some familiarity with submitting jobs on a cluster.

---

## 1. Overview

Parsl (Parallel Scripting Library) is a Python library that lets you turn ordinary Python functions into parallel tasks that run across cores, nodes, or even entire clusters. Instead of writing Slurm batch scripts by hand for every job, you write Python — and Parsl handles the scheduling, data movement, and parallelism for you.

**Why Parsl matters for HPC researchers:**

- You already think in Python. Parsl lets you stay in Python rather than juggling shell scripts, `sbatch` wrappers, and ad-hoc parallelism.
- It provides a clean separation between *what* you want to compute (your science) and *where* it runs (local laptop, one node, a thousand nodes).
- It handles dependency tracking automatically — if task B needs the output of task A, Parsl ensures A finishes first.

**What you will learn:**

- How to install Parsl on an HPC cluster
- How to write your first `@python_app` and `@bash_app`
- How to configure Parsl to submit jobs through Slurm
- How to run a parallel workflow and monitor it

**Parsl vs. alternatives:**

| Tool | Strengths | When to Choose |
|------|-----------|----------------|
| Parsl | Pure Python, flexible executors, strong HPC support | Python-centric research workflows on Slurm/PBS |
| Dask | Great for data-parallel and array workloads | NumPy/Pandas-heavy workloads, interactive analysis |
| Ray | Actor model, ML ecosystem integration | ML training, reinforcement learning, serving |
| Raw Slurm scripts | Direct control, no abstraction layer | Simple, one-off batch jobs |
| [[hyperqueue-basics|HyperQueue]] | Ultra-fast meta-scheduling, automatic allocation | High task-count job arrays, sub-node scheduling |

Parsl and [[hyperqueue-deep-dive|HyperQueue]] solve related but different problems. HyperQueue is a meta-scheduler that sits between your workflow engine and Slurm — it's great for packing thousands of short tasks into allocations. Parsl is a workflow engine itself — it defines task graphs in Python and can target Slurm directly. You can even use them together (HyperQueue as the executor layer under a Parsl workflow).

---

## 2. Prerequisites

Before starting, make sure you have:

- **SSH access to an HPC cluster** running Slurm. If you're new to SSH, see [[ssh-tutorial|SSH Tutorial]] and [[ssh-config-deep-dive|SSH Config Deep Dive]].
- **Python 3.8+** available on the cluster (typically via `module load`).
- **Basic Python knowledge** — functions, imports, pip.
- **Familiarity with Slurm basics** — you should know what `sbatch`, `squeue`, and `scancel` do, even if you've only used them a few times.
- **A persistent terminal session** is highly recommended. Tools like [[mosh-beginner-guide|Mosh]] or tmux keep your connection alive if your network drops.

**Understanding file permissions** on shared HPC filesystems is also helpful — see [[linux-permissions-beginner-guide|Linux Permissions Beginner Guide]] if you need a refresher.

---

## 3. Key Concepts

Before writing any code, let's build a mental model of how Parsl works.

### Apps

An "app" in Parsl is a regular Python function decorated with `@python_app` or `@bash_app`. The decorator tells Parsl "this function can run in parallel on remote workers."

- **`@python_app`**: The function body is pure Python. Parsl serializes it and ships it to a worker.
- **`@bash_app`**: The function returns a shell command string. Parsl runs that command on a worker node.

### Futures

When you call a Parsl app, you don't get the result immediately. Instead, you get a *future* — a placeholder that will eventually contain the result. You call `.result()` on a future to block and wait for the actual value.

```
future = my_app(42)        # Returns immediately — task is queued
result = future.result()   # Blocks until the task finishes
```

This is how Parsl achieves parallelism: you can launch many tasks, collect futures, and only wait when you need results.

### Executors

An executor is the engine that actually runs your tasks. The most common one for HPC is `HighThroughputExecutor` (HTEX), which manages a pool of worker processes across one or more nodes.

### Providers

A provider tells Parsl how to get compute resources. On an HPC cluster with Slurm, you use `SlurmProvider`, which submits batch jobs to allocate nodes for Parsl workers.

### The Config

A Parsl `Config` object ties everything together: which executor to use, which provider, how many nodes, what partition, etc.

```
Config → Executor(s) → Provider → Slurm
```

---

## 4. Step-by-Step Instructions

### Step 1: Set Up Your Python Environment

Log into your cluster and create a dedicated environment for Parsl:

```bash
# Load Python (adjust for your cluster's module system)
module load python/3.11

# Create a virtual environment
python -m venv ~/parsl-env
source ~/parsl-env/bin/activate

# Install Parsl
pip install parsl
```

If your cluster uses Conda:

```bash
module load anaconda3
conda create -n parsl-env python=3.11 -y
conda activate parsl-env
pip install parsl
```

**Verify the installation:**

```bash
python -c "import parsl; print(parsl.__version__)"
```

Expected output (version may vary):

```
2024.12.02
```

### Step 2: Write Your First Python App

Create a file called `hello_parsl.py`:

```python
import parsl
from parsl.app.app import python_app
from parsl.configs.local.threads import config

# Load the config — this starts the Parsl runtime
parsl.load(config)

@python_app
def hello(name):
    return f"Hello, {name}! I ran on a Parsl worker."

# Launch the task — returns a future immediately
future = hello("World")

# Wait for the result and print it
print(future.result())
```

Run it on the login node (this uses local threads, not Slurm — just to verify everything works):

```bash
python hello_parsl.py
```

Expected output:

```
Hello, World! I ran on a Parsl worker.
```

### Step 3: Write a Bash App

Bash apps are useful for wrapping existing command-line tools. Create `bash_app_demo.py`:

```python
import parsl
from parsl.app.app import bash_app
from parsl.configs.local.threads import config

parsl.load(config)

@bash_app
def get_hostname(stdout="hostname.out"):
    return "hostname -f"

future = get_hostname()
future.result()  # Wait for completion

# Read the captured stdout
with open("hostname.out") as f:
    print(f"Ran on: {f.read().strip()}")
```

Expected output:

```
Ran on: login01.cluster.edu
```

Notice the `stdout` parameter — Parsl redirects the command's standard output to that file.

### Step 4: Configure Parsl for Slurm

Now the real payoff — running tasks on compute nodes via Slurm. Create `slurm_config.py`:

```python
from parsl.config import Config
from parsl.executors import HighThroughputExecutor
from parsl.providers import SlurmProvider
from parsl.launchers import SrunLauncher

config = Config(
    executors=[
        HighThroughputExecutor(
            label="slurm_htex",
            # Maximum workers per node — typically set to number of cores
            max_workers_per_node=4,
            provider=SlurmProvider(
                # --- Adjust these for YOUR cluster ---
                partition="normal",          # Your Slurm partition name
                account="myproject",         # Your allocation/account
                
                # Resources per Slurm job (block)
                nodes_per_block=1,           # Nodes per Slurm job
                walltime="00:30:00",         # Max runtime per job
                
                # Scaling behavior
                init_blocks=1,               # Jobs to submit immediately
                min_blocks=0,                # Minimum active jobs
                max_blocks=2,                # Maximum active jobs
                
                # How to launch workers within the allocation
                launcher=SrunLauncher(),
                
                # Commands run before starting workers
                worker_init="""
module load python/3.11
source ~/parsl-env/bin/activate
""",
            ),
        ),
    ],
)
```

**Critical settings to customize:**

- `partition`: Run `sinfo` to see your cluster's partitions.
- `account`: Your project or allocation code. Try `sacctmgr show assoc user=$USER` to find it.
- `walltime`: Format is `HH:MM:SS`.
- `worker_init`: This runs on each compute node before Parsl starts workers. You must load the same Python environment here that has Parsl installed.

### Step 5: Run Your First Slurm-Backed Workflow

Create `first_slurm_workflow.py`:

```python
import parsl
from parsl.app.app import python_app
from slurm_config import config

parsl.load(config)

@python_app
def compute_square(x):
    import socket
    return {
        "input": x,
        "result": x ** 2,
        "hostname": socket.gethostname(),
    }

# Launch 10 tasks in parallel
futures = [compute_square(i) for i in range(10)]

# Collect results as they complete
for future in futures:
    result = future.result()
    print(f"  {result['input']}² = {result['result']}  (ran on {result['hostname']})")

print("All tasks complete!")
```

Run it:

```bash
python first_slurm_workflow.py
```

While it runs, open another terminal and watch Slurm:

```bash
watch squeue -u $USER
```

You should see Parsl-submitted jobs appear and eventually run. Output will look something like:

```
  0² = 0  (ran on compute-001)
  1² = 1  (ran on compute-001)
  2² = 4  (ran on compute-001)
  3² = 9  (ran on compute-001)
  ...
  9² = 81  (ran on compute-001)
All tasks complete!
```

### Step 6: Understand the runinfo Directory

After each run, Parsl creates a `runinfo/` directory containing logs and metadata:

```bash
ls runinfo/
```

```
000/  001/  002/
```

Each numbered directory is one `parsl.load()` invocation. Inside:

```bash
ls runinfo/000/
```

```
parsl.log          # Main Parsl log — start here for debugging
submit_scripts/    # The actual Slurm scripts Parsl generated
```

The `parsl.log` file is your best friend when things go wrong.

---

## 5. Practical Examples

### Example 1: Parallel File Processing

A common HPC pattern — process a directory of input files in parallel:

```python
import parsl
from parsl.app.app import bash_app
from slurm_config import config
import glob

parsl.load(config)

@bash_app
def process_file(input_path, output_path, stdout=parsl.AUTO_LOGNAME):
    return f"wc -l {input_path} > {output_path}"

# Find all input files
input_files = glob.glob("/scratch/myproject/data/*.csv")

# Launch a task for each file
futures = []
for f in input_files:
    out = f.replace("/data/", "/results/").replace(".csv", ".count")
    futures.append(process_file(f, out))

# Wait for all to finish
for future in futures:
    future.result()

print(f"Processed {len(futures)} files")
```

### Example 2: Tasks with Dependencies

Parsl automatically resolves dependencies when you pass a future as input to another app:

```python
import parsl
from parsl.app.app import python_app
from slurm_config import config

parsl.load(config)

@python_app
def simulate(params):
    import random
    random.seed(params["seed"])
    return {"params": params, "value": random.gauss(params["mu"], params["sigma"])}

@python_app
def aggregate(results):
    values = [r["value"] for r in results]
    return sum(values) / len(values)

# Stage 1: Run 20 simulations in parallel
sim_futures = [
    simulate({"seed": i, "mu": 10.0, "sigma": 2.0})
    for i in range(20)
]

# Stage 2: Aggregate results — Parsl waits for all simulations first
mean_future = aggregate(sim_futures)

print(f"Mean result: {mean_future.result():.4f}")
```

Parsl builds a DAG (directed acyclic graph) from these dependencies and schedules tasks in the right order.

---

## 6. Hands-On Exercises

### Exercise 1: Hello from Every Node

Modify the Slurm config to request 2 nodes (`nodes_per_block=2`) and submit 20 `get_hostname()` bash apps. Verify that tasks run on multiple nodes by checking the hostnames in the output.

### Exercise 2: Parameter Sweep

Write a Parsl workflow that:
1. Defines a `@python_app` that computes `math.sin(a) * math.cos(b)` for given `a` and `b`.
2. Sweeps `a` over `[0, 0.5, 1.0, 1.5, 2.0]` and `b` over the same range (25 total combinations).
3. Collects all results and prints the (a, b) pair that produced the maximum value.

### Exercise 3: Chain Three Stages

Build a three-stage pipeline:
1. **Generate**: A `@python_app` that produces a list of 100 random numbers.
2. **Filter**: A `@python_app` that takes the list and keeps only values above 0.5.
3. **Summarize**: A `@python_app` that computes the mean of the filtered list.

Pass futures between stages so Parsl handles the ordering.

---

## 7. Troubleshooting

### Workers Never Start / Jobs Stuck in Queue

**Symptoms:** Your script hangs after `parsl.load()`, and `squeue` shows jobs in `PD` (pending) state forever.

**Common causes:**

- Wrong `partition` name — run `sinfo` and double-check.
- Wrong or missing `account` — try submitting a simple `sbatch` job manually to verify your account works.
- Walltime too long for the partition's limits.
- Cluster is simply busy — check `squeue` for overall queue depth.

### ModuleNotFoundError on Compute Nodes

**Symptom:** Tasks fail with `ModuleNotFoundError: No module named 'parsl'`.

**Cause:** The `worker_init` in your config doesn't activate the right environment.

**Fix:** Make sure `worker_init` contains the exact same `module load` and `source activate` commands you use on the login node. Test by running those commands inside an `srun` session:

```bash
srun --partition=normal --account=myproject --time=00:05:00 --pty bash
module load python/3.11
source ~/parsl-env/bin/activate
python -c "import parsl; print('OK')"
```

### "Address already in use" Error

**Symptom:** `OSError: [Errno 98] Address already in use`

**Cause:** A previous Parsl run didn't shut down cleanly.

**Fix:** Find and kill orphaned processes:

```bash
ps aux | grep parsl
kill <PID>
```

Or specify a different port in your executor config:

```python
HighThroughputExecutor(
    interchange_port=54000,  # Pick an unused port
    ...
)
```

### Tasks Fail Silently

**Symptom:** `future.result()` raises an exception you don't recognize.

**Fix:** Check the Parsl log for details:

```bash
grep -i error runinfo/000/parsl.log | tail -20
```

Also check the worker logs in `runinfo/000/submit_scripts/`.

---

## 8. Related Tutorials

- [[parsl-deep-dive|Parsl Deep Dive]] — advanced Parsl patterns, MPI apps, monitoring, and production workflows
- [[hyperqueue-basics|HyperQueue Basics]] — alternative HPC task scheduler, great comparison point
- [[hyperqueue-deep-dive|HyperQueue Deep Dive]] — advanced HyperQueue patterns and automatic allocation
- [[ssh-tutorial|SSH Tutorial]] — connecting to your HPC cluster
- [[ssh-config-deep-dive|SSH Config Deep Dive]] — managing multiple cluster connections
- [[mosh-beginner-guide|Mosh Beginner Guide]] — persistent remote connections for long-running sessions
- [[mosh-deep-dive|Mosh Deep Dive]] — advanced Mosh configuration
- [[linux-permissions-beginner-guide|Linux Permissions Beginner Guide]] — understanding file permissions on shared filesystems
- [[linux-permissions-deep-dive|Linux Permissions Deep Dive]] — ACLs and advanced permission patterns
- [[docker-test-container-beginner-guide|Docker Test Container Guide]] — containerizing environments for reproducibility
- [[isaaclab-metagrasp-apptainer-hpc-beginner-guide|IsaacLab MetaGrasp on HPC]] — another Slurm + container workflow example
- [[kubernetes-beginner-guide|Kubernetes Beginner Guide]] — container orchestration (different paradigm from HPC)

---

## 9. Summary

**Key takeaways:**

- Parsl turns Python functions into parallel tasks with simple decorators (`@python_app`, `@bash_app`).
- Futures let you launch many tasks without waiting, then collect results when needed.
- The `Config` → `HighThroughputExecutor` → `SlurmProvider` chain connects your Python code to Slurm.
- The `worker_init` field is critical — it must set up the same environment on compute nodes that you have on the login node.
- The `runinfo/` directory and `parsl.log` are your go-to debugging resources.

**Next steps:**

- Read the [[parsl-deep-dive|Parsl Deep Dive]] for advanced executor configurations, MPI apps, data management, monitoring, and production patterns.
- Try scaling up: increase `max_blocks` and `nodes_per_block` to run across more nodes.
- Explore checkpointing to avoid re-running completed tasks when a workflow is interrupted.

---

## References

- [Parsl Project Homepage](https://parsl-project.org)
- [Parsl Documentation (stable)](https://parsl.readthedocs.io/en/stable/index.html)
- [Parsl Tutorial Repository](https://github.com/Parsl/parsl-tutorial)
- [Parsl GitHub](https://github.com/parsl/parsl/)
- [Slurm Documentation](https://slurm.schedmd.com/documentation.html)
