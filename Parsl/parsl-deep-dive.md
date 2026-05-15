---
title: "Parsl Deep Dive: Production HPC Workflows on Slurm"
date: 2026-05-07
difficulty: advanced
tags: [parsl, python, hpc, slurm, parallel-computing, workflows, mpi, monitoring, advanced]
---

# Parsl Deep Dive: Production HPC Workflows on Slurm

> **Related tutorials:** [[parsl-beginner-guide|Parsl Beginner Guide]] · [[hyperqueue-deep-dive|HyperQueue Deep Dive]] · [[isaaclab-metagrasp-apptainer-hpc-deep-dive|IsaacLab MetaGrasp Deep Dive]]

This reference covers Parsl's architecture, advanced Slurm configurations, MPI integration, data management, monitoring, and production patterns. It assumes you've completed the [[parsl-beginner-guide|Parsl Beginner Guide]] or have equivalent experience running basic Parsl workflows.

---

## 1. Overview

Parsl is a Python-native parallel scripting library designed for scalable scientific workflows. At production scale on HPC clusters, you need to go well beyond the basics: choosing the right executor for your workload, tuning Slurm provider settings for your cluster's scheduler policies, managing data across filesystems, and building fault-tolerant workflows that can survive node failures and walltime limits.

**What this guide covers:**

- Parsl's internal architecture and how the DataFlowKernel resolves task graphs
- Executor selection: HighThroughputExecutor, WorkQueueExecutor, MPIExecutor
- Advanced SlurmProvider tuning: elastic scaling, heterogeneous resources, GPU partitions
- MPI and multi-node applications
- Data staging with `File` objects and Globus integration
- Workflow patterns: map-reduce, checkpointing, dynamic DAGs
- Monitoring, debugging, and profiling at scale
- Production hardening: containers, fault tolerance, CI integration

---

## 2. Prerequisites

- Working Parsl installation with Slurm (see [[parsl-beginner-guide|Parsl Beginner Guide]])
- Experience writing `@python_app` and `@bash_app` functions
- Comfort with Slurm concepts: partitions, accounts, QOS, job arrays, `scontrol`
- Basic understanding of DAGs (directed acyclic graphs)
- For MPI sections: familiarity with MPI concepts (ranks, communicators)
- For container sections: basic knowledge of [[isaaclab-metagrasp-apptainer-hpc-beginner-guide|Apptainer/Singularity]]

---

## 3. Key Concepts

### The DataFlowKernel (DFK)

The DFK is Parsl's central runtime engine. When you call `parsl.load(config)`, the DFK starts up and manages the lifecycle of every task:

1. **Task submission**: When you call a decorated function, the DFK records the task and its dependencies (any futures passed as arguments).
2. **Dependency resolution**: The DFK maintains a task graph. A task only becomes *runnable* when all its input futures have resolved.
3. **Executor dispatch**: Runnable tasks are sent to the appropriate executor based on the `executors` parameter of the app decorator.
4. **Result handling**: When a worker completes a task, the result flows back through the DFK, which resolves the corresponding future and triggers any downstream tasks.

The DFK is single-threaded for graph management but delegates all heavy computation to executors.

### Provider → Launcher → Executor Separation

Parsl separates three concerns cleanly:

| Layer | Responsibility | HPC Example |
|-------|---------------|-------------|
| **Provider** | Acquire compute resources from the scheduler | `SlurmProvider` submits `sbatch` jobs |
| **Launcher** | Start workers within an allocation | `SrunLauncher` uses `srun` to place workers on nodes |
| **Executor** | Manage task execution on workers | `HighThroughputExecutor` pools workers, dispatches tasks |

This separation means you can swap components independently. Same executor, different provider (Slurm vs. PBS). Same provider, different launcher (srun vs. mpiexec).

### Blocks, Nodes, and Workers

- A **block** is one Slurm job (one `sbatch` submission). It may span one or more nodes.
- Each **node** in a block runs one or more **workers** (Python processes).
- `max_workers_per_node` controls how many workers run per node. Set this to the number of cores you want to utilize per node.

```
Block (Slurm job)
├── Node 0
│   ├── Worker 0
│   ├── Worker 1
│   └── Worker 2
└── Node 1
    ├── Worker 0
    ├── Worker 1
    └── Worker 2
```

---

## 4. Step-by-Step Instructions

### 4.1 Choosing the Right Executor

#### HighThroughputExecutor (HTEX)

The default choice for most HPC workloads. Uses an interchange process on the login/submit node to route tasks to workers on compute nodes.

**Best for:** Embarrassingly parallel workloads, task-per-core parallelism, workflows with many independent tasks.

```python
from parsl.executors import HighThroughputExecutor

HighThroughputExecutor(
    label="htex_slurm",
    max_workers_per_node=32,       # One worker per core
    cores_per_worker=1,
    provider=SlurmProvider(...),
)
```

#### WorkQueueExecutor

Uses the Work Queue system from the CCTools suite. Workers pull tasks from a queue, which naturally handles heterogeneous task durations.

**Best for:** Workloads with highly variable task runtimes, multi-site execution, when you want workers to self-schedule.

```python
from parsl.executors import WorkQueueExecutor

WorkQueueExecutor(
    label="wq",
    port=9123,
    provider=SlurmProvider(...),
)
```

#### MPIExecutor

Designed specifically for MPI applications that need multiple ranks within a single task.

**Best for:** Wrapping existing MPI codes, tightly coupled simulations, any task that calls `mpirun`/`mpiexec`/`srun` internally.

```python
from parsl.executors import MPIExecutor

MPIExecutor(
    label="mpi",
    max_workers_per_block=2,    # Concurrent MPI apps per block
    mpi_launcher="srun",
    provider=SlurmProvider(
        nodes_per_block=4,
        launcher=SimpleLauncher(),  # MPIExecutor handles its own launching
    ),
)
```

### 4.2 Advanced SlurmProvider Configuration

#### Elastic Scaling

Parsl can dynamically scale your Slurm allocations based on task queue depth:

```python
from parsl.providers import SlurmProvider
from parsl.launchers import SrunLauncher

SlurmProvider(
    partition="normal",
    account="myproject",
    nodes_per_block=1,
    
    # Scaling knobs
    init_blocks=1,        # Submit 1 job immediately on parsl.load()
    min_blocks=0,         # Scale to zero when idle (saves allocation)
    max_blocks=10,        # Never have more than 10 Slurm jobs active
    parallelism=0.5,      # Scale aggressiveness: 0 = never scale, 1 = 1 block per task
    
    walltime="01:00:00",
    launcher=SrunLauncher(),
    worker_init="module load python/3.11 && source ~/parsl-env/bin/activate",
)
```

The `parallelism` parameter controls how aggressively Parsl requests new blocks. A value of 0.5 means "request a new block when the pending task count exceeds 50% of current capacity."

#### GPU Partitions

For GPU workloads, request GPU resources through Slurm and map workers to GPUs:

```python
SlurmProvider(
    partition="gpu",
    account="myproject",
    nodes_per_block=1,
    walltime="02:00:00",
    
    # Request GPUs via scheduler_options
    scheduler_options="#SBATCH --gres=gpu:4\n#SBATCH --constraint=a100",
    
    launcher=SrunLauncher(),
    worker_init="""
module load python/3.11 cuda/12.0
source ~/parsl-env/bin/activate
""",
)
```

To assign one GPU per worker, set `max_workers_per_node` to match the GPU count and use the `PARSL_WORKER_RANK` environment variable inside your app:

```python
@python_app
def gpu_task(data):
    import os
    gpu_id = os.environ.get("PARSL_WORKER_RANK", "0")
    os.environ["CUDA_VISIBLE_DEVICES"] = gpu_id
    # ... your GPU code here
```

#### Heterogeneous Resources (Multiple Executors)

A single Parsl config can define multiple executors for different resource types:

```python
config = Config(
    executors=[
        HighThroughputExecutor(
            label="cpu",
            max_workers_per_node=64,
            provider=SlurmProvider(
                partition="normal",
                account="myproject",
                nodes_per_block=1,
                walltime="04:00:00",
                launcher=SrunLauncher(),
                worker_init="module load python/3.11 && source ~/parsl-env/bin/activate",
            ),
        ),
        HighThroughputExecutor(
            label="gpu",
            max_workers_per_node=4,
            provider=SlurmProvider(
                partition="gpu",
                account="myproject",
                nodes_per_block=1,
                walltime="02:00:00",
                scheduler_options="#SBATCH --gres=gpu:4",
                launcher=SrunLauncher(),
                worker_init="module load python/3.11 cuda/12.0 && source ~/parsl-env/bin/activate",
            ),
        ),
    ],
)
```

Then target specific executors from your apps:

```python
@python_app(executors=["cpu"])
def preprocess(data):
    ...

@python_app(executors=["gpu"])
def train_model(processed_data):
    ...
```

#### Per-Task Resource Specification

For fine-grained control, use `parsl_resource_specification` to set per-task resources:

```python
@python_app
def heavy_task(data, parsl_resource_specification={}):
    ...

future = heavy_task(
    data,
    parsl_resource_specification={
        "num_nodes": 2,
        "ranks_per_node": 4,
        "num_ranks": 8,
    }
)
```

This is primarily used with the `MPIExecutor`.

#### Launcher Options

| Launcher | Use When |
|----------|----------|
| `SrunLauncher()` | Standard Slurm — launches workers via `srun` across all allocated nodes |
| `SingleNodeLauncher()` | Single-node jobs — simpler, less overhead |
| `MpiExecLauncher()` | When `srun` isn't available or behaves oddly (some Cray systems) |
| `SimpleLauncher()` | With `MPIExecutor` — the executor manages its own `srun` calls |

### 4.3 MPI and Multi-Node Apps

#### Using MPIExecutor

The `MPIExecutor` is purpose-built for running MPI applications as Parsl tasks:

```python
from parsl.config import Config
from parsl.executors import MPIExecutor
from parsl.providers import SlurmProvider
from parsl.launchers import SimpleLauncher

config = Config(
    executors=[
        MPIExecutor(
            label="mpi_executor",
            max_workers_per_block=2,     # 2 concurrent MPI apps per block
            mpi_launcher="srun",
            provider=SlurmProvider(
                partition="normal",
                account="myproject",
                nodes_per_block=8,       # 8 nodes total per block
                walltime="02:00:00",
                launcher=SimpleLauncher(),
                worker_init="module load python/3.11 openmpi && source ~/parsl-env/bin/activate",
            ),
        ),
    ],
)
```

#### Wrapping an Existing MPI Binary

```python
@bash_app(executors=["mpi_executor"])
def run_simulation(input_file, output_dir,
                   parsl_resource_specification={
                       "num_nodes": 4,
                       "ranks_per_node": 32,
                       "num_ranks": 128,
                   }):
    return f"""
    cd {output_dir}
    $PARSL_MPI_PREFIX my_simulation --input {input_file} --output results.h5
    """
```

The `$PARSL_MPI_PREFIX` variable is set by the `MPIExecutor` and expands to the appropriate `srun` (or `mpiexec`) command with the correct rank and node counts.

#### Mixing MPI and Embarrassingly Parallel Tasks

Use multiple executors — one `MPIExecutor` for MPI tasks and one `HighThroughputExecutor` for single-core tasks:

```python
@python_app(executors=["cpu"])
def preprocess(raw_file):
    """Runs on a single core via HTEX."""
    ...

@bash_app(executors=["mpi_executor"])
def mpi_simulation(preprocessed_file, parsl_resource_specification={}):
    """Runs across multiple nodes via MPIExecutor."""
    return f"$PARSL_MPI_PREFIX ./simulate {preprocessed_file}"

@python_app(executors=["cpu"])
def analyze(result_file):
    """Post-processing on a single core."""
    ...

# Build the DAG
raw_files = glob.glob("/scratch/data/raw_*.dat")
for raw in raw_files:
    preprocessed = preprocess(raw)
    sim_result = mpi_simulation(
        preprocessed,
        parsl_resource_specification={"num_nodes": 4, "ranks_per_node": 16, "num_ranks": 64},
    )
    analysis = analyze(sim_result)
```

### 4.4 Data Management

#### File Objects

Parsl `File` objects represent data that may need to be staged between locations:

```python
from parsl.data_provider.files import File

@python_app
def analyze(input_file):
    with open(input_file) as f:
        data = f.read()
    return len(data)

# Local file — no staging needed on shared filesystems
f = File("file:///scratch/myproject/data/input.csv")
future = analyze(f)
```

On HPC clusters with shared filesystems (Lustre, GPFS), files are typically accessible from all nodes and no staging is needed. `File` objects become more important for multi-site workflows.

#### Globus Integration

For moving data between sites (e.g., between two HPC centers):

```python
from parsl.data_provider.globus import GlobusStaging

config = Config(
    executors=[...],
    data_management=[
        GlobusStaging(
            endpoint_name="my_cluster",
            endpoint_uuid="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
            local_path="/scratch/myproject/",
        ),
    ],
)
```

### 4.5 Workflow Patterns

#### Map-Reduce

```python
@python_app
def map_task(chunk):
    """Process one chunk of data."""
    return sum(x ** 2 for x in chunk)

@python_app
def reduce_task(partial_results):
    """Combine partial results."""
    return sum(partial_results)

# Map phase: process chunks in parallel
data = [list(range(i * 100, (i + 1) * 100)) for i in range(50)]
map_futures = [map_task(chunk) for chunk in data]

# Reduce phase: combine all results
total = reduce_task(map_futures)
print(f"Total: {total.result()}")
```

#### Parameter Sweeps

```python
import itertools

@python_app
def simulate(alpha, beta, gamma):
    # ... expensive computation ...
    return {"alpha": alpha, "beta": beta, "gamma": gamma, "score": alpha * beta - gamma}

# Generate all parameter combinations
alphas = [0.1, 0.5, 1.0, 2.0]
betas = [10, 50, 100]
gammas = [0.01, 0.1, 1.0]

futures = [
    simulate(a, b, g)
    for a, b, g in itertools.product(alphas, betas, gammas)
]

# Find the best result
results = [f.result() for f in futures]
best = max(results, key=lambda r: r["score"])
print(f"Best parameters: {best}")
```

#### Checkpointing and Memoization

Avoid re-running completed tasks across workflow restarts:

```python
from parsl.config import Config

config = Config(
    executors=[...],
    checkpoint_mode="task_exit",   # Checkpoint after each task completes
    checkpoint_files=["runinfo/000/checkpoint"],  # Load checkpoints from previous run
)
```

When `checkpoint_mode` is enabled, Parsl stores the result of each completed task. On a subsequent run with the same checkpoint file, tasks with matching inputs are skipped — their cached results are returned immediately.

Available checkpoint modes:

- `"task_exit"` — checkpoint immediately when each task finishes (safest, slight overhead)
- `"periodic"` — checkpoint at regular intervals
- `"dfk_exit"` — checkpoint only when the workflow finishes (fastest, but you lose progress on crashes)

#### Dynamic DAGs and Conditional Branching

Parsl supports dynamic task graph construction using `@join_app`:

```python
from parsl.app.app import python_app, join_app

@python_app
def check_convergence(result):
    return result["error"] < 0.001

@python_app
def refine(params, iteration):
    # ... run refinement step ...
    return {"params": params, "error": 1.0 / (iteration + 1), "iteration": iteration}

@join_app
def iterative_refinement(params, iteration=0, max_iter=100):
    """Recursively refine until convergence or max iterations."""
    result = refine(params, iteration)
    converged = check_convergence(result)
    
    # This returns a future — Parsl resolves it before returning
    if not converged.result() and iteration < max_iter:
        return iterative_refinement(params, iteration + 1, max_iter)
    return result
```

`@join_app` functions can return futures, allowing Parsl to extend the task graph dynamically at runtime.

### 4.6 Monitoring and Debugging at Scale

#### Enabling the Monitoring Hub

Parsl includes a built-in monitoring system that logs task states, resource usage, and performance metrics to a SQLite database:

```python
from parsl.monitoring.monitoring import MonitoringHub

config = Config(
    executors=[...],
    monitoring=MonitoringHub(
        hub_address="localhost",
        hub_port=55055,
        monitoring_debug=False,
        resource_monitoring_interval=10,    # Sample every 10 seconds
    ),
)
```

After a run, the database is at `runinfo/000/monitoring.db`. Query it directly:

```bash
sqlite3 runinfo/000/monitoring.db "SELECT task_id, task_func_name, task_status_name, task_time_submitted, task_time_returned FROM task"
```

#### Parsl Visualization

Install the visualization tool:

```bash
pip install parsl[monitoring]
```

Launch the web dashboard:

```bash
parsl-visualize --listen 0.0.0.0 --port 8080
```

This provides interactive plots of task timelines, worker utilization, and resource consumption.

#### Interpreting Logs

Key log files and what to look for:

| File | Contents | Common Issues |
|------|----------|---------------|
| `runinfo/NNN/parsl.log` | DFK and executor events | Task failures, scaling decisions, interchange errors |
| `runinfo/NNN/submit_scripts/` | Generated Slurm scripts | Verify `#SBATCH` directives, `worker_init` commands |
| `runinfo/NNN/*.submit.stderr` | Slurm job stderr | Module load failures, environment errors |

Useful grep patterns:

```bash
# Find all task failures
grep "task.*failed" runinfo/000/parsl.log

# Find scaling events
grep "Scaling" runinfo/000/parsl.log

# Find worker startup issues
grep -i "worker\|manager" runinfo/000/parsl.log | grep -i "error\|fail\|timeout"
```

#### Diagnosing Stragglers

If most tasks complete quickly but a few hang, check:

1. **Uneven data**: One input file might be much larger than others.
2. **Node health**: A bad node can cause workers to run slowly. Check `scontrol show node <nodename>` for issues.
3. **Resource contention**: Workers sharing a node with other jobs. Use `--exclusive` in `scheduler_options`.

---

## 5. Practical Examples

### Example 1: Multi-Stage Bioinformatics Pipeline

A realistic pipeline that preprocesses FASTQ files, runs alignment, and aggregates results:

```python
import parsl
from parsl.app.app import bash_app, python_app
from parsl.config import Config
from parsl.executors import HighThroughputExecutor
from parsl.providers import SlurmProvider
from parsl.launchers import SrunLauncher
import glob

config = Config(
    executors=[
        HighThroughputExecutor(
            label="bio",
            max_workers_per_node=16,
            provider=SlurmProvider(
                partition="normal",
                account="bioproject",
                nodes_per_block=1,
                init_blocks=2,
                max_blocks=10,
                walltime="04:00:00",
                launcher=SrunLauncher(),
                worker_init="""
module load python/3.11 samtools bwa
source ~/parsl-env/bin/activate
""",
            ),
        ),
    ],
    checkpoint_mode="task_exit",
)

parsl.load(config)

@bash_app
def fastqc(fastq, outdir, stdout=parsl.AUTO_LOGNAME, stderr=parsl.AUTO_LOGNAME):
    return f"fastqc {fastq} --outdir {outdir}"

@bash_app
def align(fastq_r1, fastq_r2, reference, output_bam,
          stdout=parsl.AUTO_LOGNAME, stderr=parsl.AUTO_LOGNAME):
    return f"""
    bwa mem -t 16 {reference} {fastq_r1} {fastq_r2} | \
    samtools sort -@ 4 -o {output_bam}
    samtools index {output_bam}
    """

@bash_app
def call_variants(bam, reference, output_vcf,
                  stdout=parsl.AUTO_LOGNAME, stderr=parsl.AUTO_LOGNAME):
    return f"bcftools mpileup -f {reference} {bam} | bcftools call -mv -Oz -o {output_vcf}"

@python_app
def summarize(vcf_files):
    total_variants = 0
    for vcf in vcf_files:
        import subprocess
        result = subprocess.run(["bcftools", "stats", vcf], capture_output=True, text=True)
        for line in result.stdout.split("\n"):
            if line.startswith("SN") and "number of records" in line:
                total_variants += int(line.split("\t")[-1])
    return total_variants

# Build the pipeline
reference = "/data/references/hg38.fa"
samples = glob.glob("/scratch/fastq/*_R1.fastq.gz")

align_futures = []
for r1 in samples:
    r2 = r1.replace("_R1", "_R2")
    sample_name = r1.split("/")[-1].replace("_R1.fastq.gz", "")
    
    # QC (fire and forget — doesn't block alignment)
    fastqc(r1, "/scratch/qc/")
    fastqc(r2, "/scratch/qc/")
    
    # Align
    bam = f"/scratch/aligned/{sample_name}.sorted.bam"
    align_future = align(r1, r2, reference, bam)
    
    # Call variants (depends on alignment)
    vcf = f"/scratch/variants/{sample_name}.vcf.gz"
    variant_future = call_variants(bam, reference, vcf)
    align_futures.append(vcf)

# Summarize all variants
total = summarize(align_futures)
print(f"Total variants across all samples: {total.result()}")
```

### Example 2: GPU Parameter Sweep with Early Stopping

```python
@python_app(executors=["gpu"])
def train_model(hyperparams):
    import torch
    import os
    gpu_id = os.environ.get("PARSL_WORKER_RANK", "0")
    os.environ["CUDA_VISIBLE_DEVICES"] = gpu_id
    
    # ... training code ...
    return {
        "hyperparams": hyperparams,
        "val_loss": 0.42,    # placeholder
        "epochs_trained": 50,
    }

@python_app(executors=["cpu"])
def select_best(results):
    return min(results, key=lambda r: r["val_loss"])

# Sweep over learning rates and batch sizes
futures = []
for lr in [1e-4, 5e-4, 1e-3, 5e-3]:
    for batch_size in [32, 64, 128, 256]:
        futures.append(train_model({"lr": lr, "batch_size": batch_size}))

best = select_best(futures)
print(f"Best config: {best.result()}")
```

---

## 6. Hands-On Exercises

### Exercise 1: Multi-Executor Workflow

Design a config with two executors — a `HighThroughputExecutor` on the `normal` partition and another on the `gpu` partition. Write a workflow where:
1. A CPU app generates synthetic data.
2. A GPU app trains a model on that data.
3. A CPU app evaluates the trained model.

Verify tasks route to the correct executor by logging `socket.gethostname()` and checking which partition each node belongs to.

### Exercise 2: Checkpointed Parameter Sweep

Run a 100-combination parameter sweep with `checkpoint_mode="task_exit"`. After 50 tasks complete, kill the workflow (`Ctrl+C`). Restart it using the checkpoint file from the previous run. Verify that only the remaining 50 tasks actually execute.

### Exercise 3: Build a Monitoring Dashboard

Enable `MonitoringHub` in your config, run a workflow with at least 50 tasks, then:
1. Query the `monitoring.db` to find the average task duration.
2. Identify the slowest task and check which node it ran on.
3. Launch `parsl-visualize` and take note of the task timeline.

### Exercise 4: MPI + Single-Core Pipeline

Configure an `MPIExecutor` alongside a `HighThroughputExecutor`. Write a workflow that:
1. Generates 10 input files using single-core `@python_app` tasks.
2. Runs an MPI application on each input file (4 ranks per task).
3. Collects and summarizes results using a single-core `@python_app`.

---

## 7. Troubleshooting

### Interchange Connection Timeout

**Symptom:** Workers start but tasks never execute. Log shows `interchange connection timeout`.

**Cause:** The interchange process (on the login node) and workers (on compute nodes) can't reach each other — usually a firewall or port issue.

**Fix:**
- Verify network connectivity between login and compute nodes.
- Set `interchange_port` explicitly and ensure that port is accessible.
- Some clusters block high ports; try ports in the 50000-55000 range.

### Workers Die Immediately

**Symptom:** Slurm jobs start and immediately finish. No useful output.

**Diagnosis:** Check the Slurm job stderr:

```bash
cat runinfo/000/submit_scripts/*.submit.stderr
```

**Common causes:**
- `worker_init` has a syntax error or loads a missing module.
- Python environment doesn't exist on compute nodes (e.g., home directory not mounted).
- Walltime too short for workers to start up.

### "Too many open files" at Scale

**Symptom:** `OSError: [Errno 24] Too many open files` when running thousands of tasks.

**Fix:** Increase the file descriptor limit in your `worker_init`:

```python
worker_init="""
ulimit -n 65536
module load python/3.11
source ~/parsl-env/bin/activate
"""
```

### Memory Exhaustion on Login Node

**Symptom:** The submit-side process (interchange) uses too much memory with thousands of tasks.

**Fix:** Reduce the number of simultaneously pending tasks using `max_blocks` and `parallelism`. Also consider using `garbage_collect=True` in your config (available in newer Parsl versions).

### Serialization Errors

**Symptom:** `TypeError: cannot pickle ...` or `AttributeError` during task serialization.

**Cause:** `@python_app` functions are serialized (pickled) and sent to workers. Objects that can't be serialized (file handles, database connections, C extension objects) will fail.

**Fix:** Create unpicklable objects inside the app function, not outside:

```python
# BAD — db_connection can't be pickled
db = connect_to_database()

@python_app
def query(db, sql):
    return db.execute(sql)

# GOOD — connection created inside the worker
@python_app
def query(connection_string, sql):
    db = connect_to_database(connection_string)
    return db.execute(sql)
```

### Scheduler Fairshare Issues

**Symptom:** Your Parsl jobs keep getting lower priority over time.

**Cause:** Parsl submits many short jobs, which can burn through your fairshare allocation quickly compared to a single long job.

**Fix:** Use fewer, larger blocks:

```python
SlurmProvider(
    nodes_per_block=4,        # More nodes per job
    max_blocks=3,             # Fewer total jobs
    walltime="04:00:00",      # Longer walltime
)
```

This submits fewer Slurm jobs (friendlier to the scheduler) while providing the same total capacity.

---

## 8. Related Tutorials

- [[parsl-beginner-guide|Parsl Beginner Guide]] — getting started with Parsl on Slurm
- [[hyperqueue-basics|HyperQueue Basics]] — alternative meta-scheduler for HPC task execution
- [[hyperqueue-deep-dive|HyperQueue Deep Dive]] — advanced HyperQueue with automatic allocation and GPU support
- [[hyperqueue-with-detect-snakemake|HyperQueue + DETECT/Snakemake]] — integrating HQ with bioinformatics pipelines
- [[isaaclab-metagrasp-apptainer-hpc-beginner-guide|IsaacLab MetaGrasp on HPC]] — Slurm + Apptainer workflow example
- [[isaaclab-metagrasp-apptainer-hpc-deep-dive|IsaacLab MetaGrasp Deep Dive]] — advanced HPC container patterns
- [[docker-test-container-beginner-guide|Docker Test Container Guide]] — containerization basics
- [[docker-test-container-deep-dive|Docker Test Container Deep Dive]] — advanced container patterns
- [[kubernetes-beginner-guide|Kubernetes Beginner Guide]] — container orchestration (cloud-native alternative to HPC)
- [[kubernetes-deep-dive|Kubernetes Deep Dive]] — advanced Kubernetes patterns
- [[ssh-tutorial|SSH Tutorial]] — cluster access fundamentals
- [[ssh-config-deep-dive|SSH Config Deep Dive]] — managing multiple cluster connections
- [[mosh-beginner-guide|Mosh Beginner Guide]] — persistent remote sessions
- [[linux-permissions-beginner-guide|Linux Permissions Beginner Guide]] — file permissions on shared filesystems
- [[linux-permissions-deep-dive|Linux Permissions Deep Dive]] — ACLs and group permissions for shared data
- [[apache-nifi-hpc-sysadmin-beginner-guide|Apache NiFi HPC Sysadmin Guide]] — data flow automation on HPC
- [[apache-nifi-hpc-sysadmin-deep-dive|Apache NiFi HPC Deep Dive]] — advanced NiFi patterns for HPC environments

---

## 9. Summary

**Key takeaways:**

- The DFK resolves task dependencies as a DAG — understanding this model is essential for designing efficient workflows.
- Choose executors deliberately: HTEX for task-per-core parallelism, MPIExecutor for tightly coupled MPI applications, WorkQueueExecutor for heterogeneous or multi-site workloads.
- Tune Slurm scaling with `init_blocks`, `min_blocks`, `max_blocks`, and `parallelism` — balance responsiveness against scheduler fairshare.
- Use `worker_init` carefully: it runs on every compute node and must reproduce your exact environment.
- Checkpointing (`checkpoint_mode="task_exit"`) is critical for long-running workflows — it lets you restart without re-running completed tasks.
- The monitoring database and `parsl-visualize` are invaluable for understanding performance and diagnosing issues at scale.
- For production: pin your environments in containers ([[isaaclab-metagrasp-apptainer-hpc-deep-dive|Apptainer]]), enable fault tolerance with retries, and be scheduler-friendly with fewer, larger blocks.

**Next steps:**

- Explore the [Parsl tutorial repository](https://github.com/Parsl/parsl-tutorial) for additional worked examples.
- Set up monitoring on your next real workflow to establish performance baselines.
- Consider integrating with Globus for cross-site data movement in multi-center collaborations.
- Compare with [[hyperqueue-deep-dive|HyperQueue]] if your workload is dominated by many short, independent tasks — HQ's sub-second task dispatch may be a better fit for that pattern.

---

## References

- [Parsl Project Homepage](https://parsl-project.org)
- [Parsl Documentation (stable)](https://parsl.readthedocs.io/en/stable/index.html)
- [Parsl Tutorial Repository](https://github.com/Parsl/parsl-tutorial)
- [Parsl GitHub](https://github.com/parsl/parsl/)
- [Parsl Configuration Documentation](https://parsl.readthedocs.io/en/stable/userguide/configuring.html)
- [Parsl Monitoring Guide](https://parsl.readthedocs.io/en/stable/userguide/monitoring.html)
- [Slurm Documentation](https://slurm.schedmd.com/documentation.html)
- Babuji, Y. et al. "Parsl: Pervasive Parallel Programming in Python." HPDC 2019.
