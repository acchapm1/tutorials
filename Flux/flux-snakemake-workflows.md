---
title: "Running Snakemake Workflows on Flux: The Executor Plugin and DETECT Pipeline Patterns"
date: 2026-06-01
difficulty: intermediate
tags: [flux, snakemake, bioinformatics, hpc, workflow-management, apptainer, DETECT]
---

# Running Snakemake Workflows on Flux: The Executor Plugin and DETECT Pipeline Patterns

> **Related tutorials:** [[flux-basics|Flux Basics]] · [[flux-system-setup|Flux System Setup]] · [[flux-advanced-features|Advanced Flux Features]]

---

## 1. Overview

This tutorial covers migrating Snakemake workflows from the Slurm executor plugin to the Flux executor plugin. If you already run bioinformatics or scientific pipelines on Slurm via `snakemake --executor slurm`, you can switch to `snakemake --executor flux` with surprisingly few changes. The workflow logic, container directives, and input/output declarations stay the same. What changes is the submission backend and resource syntax.

You will learn to:

- Install and configure the `snakemake-executor-plugin-flux` package
- Launch a Flux sub-instance inside a Slurm allocation (the recommended hybrid pattern)
- Map Slurm resource directives to Flux equivalents for every rule
- Build a reusable Flux profile alongside your existing Slurm profile
- Migrate the DETECT pipeline from Slurm to Flux with a rollback path
- Monitor and debug Flux-managed Snakemake jobs

By the end (~45 minutes), you will have a working Flux profile that can run your Snakemake pipeline on the same cluster where Slurm currently manages your jobs.

---

## 2. Prerequisites

- **Snakemake 9.x** installed via mamba or conda (Snakemake 8.x works with older plugin versions, but this tutorial targets the 9.x executor plugin API)
- **Flux available in user space** — either via `module load flux` or a user-space build (see [[flux-basics|Flux Basics]] and [[flux-system-setup|Flux System Setup]])
- **An existing Snakemake workflow** that currently runs with `--executor slurm` or an older `--cluster` invocation
- **Familiarity with `snakemake-executor-plugin-slurm`** — you know what a Slurm profile looks like and how `slurm_partition`, `slurm_extra`, and `runtime` resources work
- **Python 3.10+** in your Snakemake conda environment (the Flux Python bindings require it)
- **A terminal multiplexer** — `tmux`, `screen`, or [[sesh-beginner-guide|sesh]] for long-running sessions

> 📝 **Note:** You do not need root access. You do not need your cluster admins to install Flux system-wide. Flux can run entirely inside a Slurm allocation as a user-space sub-instance. See [[flux-basics|Flux Basics]] for the full setup path.

---

## 3. Key Concepts

### Executor Plugin Architecture in Snakemake 9

Snakemake 9 uses a pluggable executor system. Each executor is a Python package that implements a standard interface: submit a job, check its status, cancel it, and retrieve output. The Slurm executor shells out to `sbatch` and polls `sacct`. The Flux executor uses the Flux Python SDK to submit jobs directly to a running Flux broker — no subprocess shelling, no parsing CLI output.

```
Snakemake DAG Engine
       │
       ├── snakemake-executor-plugin-slurm    (shells out to sbatch/sacct)
       ├── snakemake-executor-plugin-flux      (Flux Python SDK, event-driven)
       ├── snakemake-executor-plugin-hyperqueue (HQ Python API)
       └── snakemake-executor-plugin-cluster-generic (any CLI scheduler)
```

All executors receive the same information from Snakemake: the command to run, the resource requirements (threads, mem_mb, runtime), and any executor-specific resource keys. The executor translates those into the scheduler's native format.

### Flux Sub-Instances for Workflow Isolation

Flux can run as a sub-instance inside any existing resource allocation — including a Slurm job. When you run `flux start snakemake ...` inside an `sbatch` script, Flux launches a broker that manages only the nodes Slurm gave you. Your workflow is completely isolated from other Flux users. When the Snakemake run finishes, the Flux instance exits and the Slurm job ends.

This is the recommended pattern for clusters where Slurm is the site scheduler and you want Flux's features for internal job management.

### Event-Driven Status vs. Polling

The Slurm executor polls `sacct` periodically to check whether jobs have finished. This introduces latency (typically 10-30 seconds between status checks) and puts load on the Slurm accounting database. The Flux executor subscribes to Flux's event API — it gets notified the instant a job changes state. No polling, no delay, no database load. For pipelines with hundreds of short-lived rules, this difference is measurable.

> 💡 **Tip:** Event-driven status tracking is especially valuable in the DETECT pipeline, where some rules (like `index_genome` or `fastqc`) complete in seconds. With Slurm polling, Snakemake might wait 30 seconds to notice that a 5-second rule finished. With Flux events, the next rule starts immediately.

---

## 4. Step-by-Step Instructions

### Slurm Executor vs. Flux Executor

Before changing anything, understand what is actually different between the two executors:

| Feature | Slurm Executor | Flux Executor |
|---------|---------------|---------------|
| **Submission mechanism** | Shells out to `sbatch`, parses job ID from stdout | Flux Python SDK `flux.job.submit()` — no subprocess |
| **Job ID format** | Integer (e.g., `12345678`) | Flux ID (`f` prefix, e.g., `f6ByEH32Zo`) |
| **Status checking** | Polls `sacct` every 10-30s | Event-driven via Flux event API — instant notification |
| **Resource syntax** | `slurm_partition`, `slurm_extra`, `mem_mb` | `flux_option_flags`, `queue`, `mem_mb` |
| **Profile support** | `profiles/slurm/config.yaml` | `profiles/flux/config.yaml` (identical structure) |
| **Container support** | `--use-singularity` / `--use-apptainer` | Same flags — container handling is Snakemake-level, not executor-level |
| **GPU resources** | `slurm_extra="--gres=gpu:1"` | `flux_option_flags="-g 1"` |
| **Maturity** | Stable, widely deployed | Functional, actively developed, fewer production deployments |
| **Failure recovery** | `--rerun-incomplete` checks output files | Identical — Snakemake drives rerun logic, not the executor |

The key takeaway: the executor only controls how jobs are submitted and monitored. Everything else — the DAG, file dependencies, container images, conda environments, reruns — is handled by Snakemake core and does not change when you switch executors.

### Installation

Install the Flux executor plugin into your existing Snakemake conda environment:

```bash
# Activate your Snakemake environment
mamba activate snakemake-env

# Install the Flux executor plugin
pip install snakemake-executor-plugin-flux
```

Verify the installation:

```bash
# Check that Snakemake sees the plugin
snakemake --list-executor-plugins | grep flux
```

Expected output:

```
flux
```

Verify that the Flux Python bindings are available:

```bash
python -c "import flux; print(flux.__version__)"
```

Expected output (version will vary):

```
0.67.0
```

> ⚠️ **Warning:** If `import flux` fails with `ModuleNotFoundError`, the Flux Python bindings are not in your conda environment. This happens when Flux was installed system-wide but the Python bindings were not exported to your env. Fix it with `pip install flux-python` or by adding the system Flux Python path to `PYTHONPATH`. See [[flux-system-setup|Flux System Setup]] for details.

If both commands succeed, you have everything needed. The executor plugin depends on the Flux Python bindings, which in turn need a running Flux broker to actually submit jobs — but installation is complete.

### Starting a Flux Instance for Snakemake (Inside Slurm)

The recommended pattern on Slurm-managed clusters is to request a multi-node allocation from Slurm, then start a Flux instance inside it. Flux becomes the "inner scheduler" that manages your Snakemake rules across the allocated nodes.

Create a wrapper script:

```bash
#!/usr/bin/env bash
#SBATCH --job-name=snakemake-flux
#SBATCH --nodes=4
#SBATCH --ntasks-per-node=32
#SBATCH --time=08:00:00
#SBATCH --partition=general
#SBATCH --account=mylab
#SBATCH --output=logs/snakemake-flux-%j.out
#SBATCH --error=logs/snakemake-flux-%j.err

set -euo pipefail

# Activate the environment with Snakemake + Flux
module load flux/0.67.0        # or however Flux is available on your cluster
source activate snakemake-env

echo "=== Flux-Snakemake wrapper ==="
echo "SLURM_JOB_ID:    ${SLURM_JOB_ID}"
echo "SLURM_NNODES:    ${SLURM_NNODES}"
echo "SLURM_NODELIST:  ${SLURM_NODELIST}"
echo "Start time:      $(date)"

# Start Flux and run Snakemake inside it
# flux start launches a broker across all allocated nodes,
# sets FLUX_URI automatically, then runs the given command.
flux start snakemake \
    --executor flux \
    --jobs 128 \
    --default-resources cores=4 mem_mb=8000 \
    --snakefile Snakefile \
    --configfile config/config.yaml \
    --latency-wait 30 \
    --rerun-incomplete \
    2>&1

echo "=== Completed at $(date) ==="
```

Save this as `scripts/run-snakemake-flux.sh` and submit it:

```bash
mkdir -p logs
sbatch scripts/run-snakemake-flux.sh
```

> 📝 **Note:** Inside `flux start`, the `FLUX_URI` environment variable is automatically set to point to the running Flux broker. The Snakemake Flux executor reads this variable to connect. You do not need to set it manually. If you run `snakemake --executor flux` outside of `flux start`, it will fail with a connection error because no broker is running.

**How this works step by step:**

1. Slurm allocates 4 nodes with 32 cores each (128 total cores)
2. `flux start` launches a Flux broker spanning all 4 nodes
3. Snakemake starts inside the Flux instance with `--executor flux`
4. Each Snakemake rule becomes a Flux job submitted to the broker
5. Flux schedules rules across the 128 cores, packing multiple rules per node
6. When Snakemake finishes (all rules done or a failure), `flux start` exits
7. The Slurm job ends, releasing the allocation

> 💡 **Tip:** The `--jobs 128` flag tells Snakemake how many rules can run concurrently. Set this to the total number of cores in your allocation divided by the typical per-rule core count. If most rules use 4 cores and you have 128 cores, `--jobs 32` is a reasonable starting point. If your rules vary widely, Flux handles the bin-packing — you can set `--jobs` higher and let Flux figure out what fits.

### Rule-Level Resource Specification

Each Snakemake rule can declare resources that the executor translates into scheduler-specific flags. Here is a concrete before/after for a bioinformatics alignment rule.

**Before (Slurm executor):**

```python
rule align_reads:
    input:
        reads="data/trimmed/{sample}.fastq.gz",
        index="data/reference/genome.idx"
    output:
        bam="results/aligned/{sample}.bam"
    log:
        "logs/align/{sample}.log"
    threads: 8
    resources:
        mem_mb=16000,
        runtime=120,                           # minutes
        slurm_partition="compute",
        slurm_extra="--ntasks=1 --cpus-per-task=8"
    container:
        "docker://biocontainers/bwa:0.7.17"
    shell:
        "bwa mem -t {threads} {input.index} {input.reads} "
        "| samtools sort -@ {threads} -o {output.bam} 2> {log}"
```

**After (Flux executor):**

```python
rule align_reads:
    input:
        reads="data/trimmed/{sample}.fastq.gz",
        index="data/reference/genome.idx"
    output:
        bam="results/aligned/{sample}.bam"
    log:
        "logs/align/{sample}.log"
    threads: 8
    resources:
        mem_mb=16000,
        runtime=120,                           # minutes
        flux_option_flags="-n1 -c8",
        queue="compute"
    container:
        "docker://biocontainers/bwa:0.7.17"
    shell:
        "bwa mem -t {threads} {input.index} {input.reads} "
        "| samtools sort -@ {threads} -o {output.bam} 2> {log}"
```

What changed: `slurm_partition` became `queue`, and `slurm_extra` became `flux_option_flags`. The `input`, `output`, `shell`, `container`, `threads`, `mem_mb`, and `runtime` are all identical.

**flux_option_flags Reference Table**

The `flux_option_flags` resource accepts any flag you would pass to `flux submit` on the command line. Here is the mapping for common resource types:

| Resource | flux submit flag | Example | Slurm equivalent |
|----------|-----------------|---------|-------------------|
| Cores per task | `-c N` | `-c 8` | `--cpus-per-task=8` |
| Slots (tasks) | `-n N` | `-n 4` | `--ntasks=4` |
| Cores per slot | `--cores-per-slot=N` | `--cores-per-slot=8` | `--cpus-per-task=8` (with `--ntasks`) |
| GPUs | `-g N` | `-g 1` | `--gres=gpu:1` |
| Memory | `--mem=NMiB` | `--mem=16384MiB` | `--mem=16G` |
| Wall time | `-t Nm` | `-t 60m` | `--time=01:00:00` |
| Queue | `--queue=NAME` | `--queue=gpu` | `--partition=gpu` |
| Exclusive node | `--exclusive` | `--exclusive` | `--exclusive` |
| Node count | `-N N` | `-N 2` | `--nodes=2` |

> 📝 **Note:** The `threads` resource in Snakemake is automatically passed to the Flux executor as the core count. If you set `threads: 8` and `flux_option_flags="-c8"`, you are specifying cores twice. In practice, the executor uses whichever is more specific. The safest pattern is to set `threads` and use `flux_option_flags` only for resources that `threads` does not cover (GPUs, node count, exclusive, etc.).

**Complete Slurm-to-Flux Resource Mapping**

| Slurm resource key | Flux equivalent | Notes |
|--------------------|-----------------|-------|
| `slurm_partition="compute"` | `queue="compute"` | Direct rename |
| `slurm_extra="--cpus-per-task=8"` | `flux_option_flags="-c8"` | Or just use `threads: 8` |
| `slurm_extra="--gres=gpu:1"` | `flux_option_flags="-g1"` | GPU resource |
| `slurm_extra="--mem=32G"` | `flux_option_flags="--mem=32768MiB"` | Flux uses MiB by default |
| `slurm_extra="--exclusive"` | `flux_option_flags="--exclusive"` | Same flag name |
| `slurm_extra="--ntasks=4 --cpus-per-task=2"` | `flux_option_flags="-n4 -c2"` | MPI-style multi-slot |
| `mem_mb=16000` | `mem_mb=16000` | Snakemake-level, works with both executors |
| `runtime=120` | `runtime=120` | Snakemake-level, works with both executors |

### Building a Flux Profile

Snakemake profiles let you store executor configuration in a YAML file instead of passing dozens of CLI flags. Create a Flux profile alongside your existing Slurm profile:

```
your-pipeline/
├── profiles/
│   ├── slurm/
│   │   └── config.yaml     # existing Slurm profile
│   └── flux/
│       └── config.yaml     # new Flux profile
├── Snakefile
└── config/
    └── config.yaml
```

Create the Flux profile:

```yaml
# profiles/flux/config.yaml
executor: flux
jobs: 128                    # max concurrent rules (tune to your allocation size)
latency-wait: 30             # seconds to wait for NFS-delayed output files
rerun-incomplete: true       # pick up from where you left off

# Default resources for rules that don't specify their own
default-resources:
  - cores=4
  - mem_mb=8000
  - runtime=60               # minutes
```

Use the profile:

```bash
# Inside a flux start session (see the sbatch wrapper above)
snakemake --profile profiles/flux --snakefile Snakefile --configfile config/config.yaml
```

Or, for the sbatch wrapper approach, update the `flux start` line:

```bash
flux start snakemake --profile profiles/flux \
    --snakefile Snakefile \
    --configfile config/config.yaml
```

> 📝 **Note:** The `--cluster-config` flag is deprecated in Snakemake 9. All executor-specific resource configuration should go in the profile's `default-resources` or in per-rule `resources:` blocks. If you are migrating from Snakemake 7.x with a `cluster.json`, move those values into rule-level resources.

**Comparing the two profiles side by side:**

```yaml
# profiles/slurm/config.yaml
executor: slurm
jobs: 50
latency-wait: 30
default-resources:
  - slurm_partition=general
  - mem_mb=8000
  - runtime=60
```

```yaml
# profiles/flux/config.yaml
executor: flux
jobs: 128
latency-wait: 30
default-resources:
  - cores=4
  - mem_mb=8000
  - runtime=60
```

The Flux profile can use a higher `jobs` count because Flux's scheduling overhead is negligible compared to Slurm's per-job submission cost. You are not submitting 128 `sbatch` calls — you are submitting 128 Flux jobs to an in-process broker.

### Apptainer Containers with the Flux Executor

Container support in Snakemake is handled at the framework level, not the executor level. The `--use-singularity` or `--use-apptainer` flags work identically regardless of which executor you use. The executor submits the job; Snakemake wraps the shell command in the container runtime before handing it to the executor.

A rule with a container directive:

```python
rule variant_call:
    input:
        bam="results/aligned/{sample}.bam",
        ref="data/reference/genome.fa"
    output:
        vcf="results/variants/{sample}.vcf.gz"
    log:
        "logs/variant_call/{sample}.log"
    threads: 4
    resources:
        mem_mb=32000,
        runtime=240,
        flux_option_flags="-c4"
    container:
        "docker://broadinstitute/gatk:4.4.0.0"
    shell:
        "gatk HaplotypeCaller "
        "-R {input.ref} -I {input.bam} -O {output.vcf} "
        "--native-pair-hmm-threads {threads} 2> {log}"
```

Run it with containers:

```bash
flux start snakemake --profile profiles/flux \
    --use-apptainer \
    --apptainer-prefix /scratch/$USER/.apptainer_cache \
    --snakefile Snakefile
```

> 💡 **Tip:** Set `--apptainer-prefix` (or `--singularity-prefix` for older versions) to a shared filesystem location. Snakemake will pull container images once and cache the `.sif` files there. On clusters with node-local scratch, point this to a shared path so all nodes can access the cached images without re-pulling. See [[isaaclab-metagrasp-apptainer-hpc-beginner-guide|Apptainer HPC Guide]] for caching strategies.

> 📝 **Note:** Flux itself does not manage containers. The `flux submit` command runs the shell command exactly as Snakemake constructs it, which includes the `apptainer exec ...` wrapper. From Flux's perspective, it is running a normal shell command that happens to start with `apptainer exec`.

### DETECT Pipeline Migration Pattern

The DETECT pipeline is a Snakemake-based bioinformatics workflow with per-sample rules that fan out into hundreds of tasks. Migrating it from Slurm to Flux follows a predictable pattern. Here is the before and after.

**Current state (Slurm):**

```
DETECT/
├── Snakefile
├── config/
│   └── config.yaml
├── profiles/
│   └── slurm/
│       └── config.yaml          # executor: slurm
├── scripts/
│   └── run-detect-slurm.sh      # sbatch wrapper
└── ...
```

```bash
# Current invocation
sbatch scripts/run-detect-slurm.sh
# Inside the script:
#   snakemake --executor slurm --profile profiles/slurm ...
```

**After migration (Flux added alongside Slurm):**

```
DETECT/
├── Snakefile                     # UNCHANGED
├── config/
│   └── config.yaml               # UNCHANGED
├── profiles/
│   ├── slurm/
│   │   └── config.yaml           # UNCHANGED (keep as fallback)
│   └── flux/
│       └── config.yaml           # NEW: executor: flux
├── scripts/
│   ├── run-detect-slurm.sh       # UNCHANGED (keep as fallback)
│   └── run-detect-flux.sh        # NEW: sbatch + flux start wrapper
└── ...
```

**What changes:**

1. **Profile config** — new `profiles/flux/config.yaml` (see above)
2. **Resource directives** — rules that use `slurm_partition` need `queue` added; rules that use `slurm_extra` need `flux_option_flags` added
3. **Submission wrapper** — new `scripts/run-detect-flux.sh` with `flux start`

**What stays the same:**

- `Snakefile` logic — rules, wildcards, input/output functions, lambda-based resource scaling
- `config/config.yaml` — sample sheets, reference paths, parameters
- Container directives — `container:` blocks are executor-agnostic
- Conda environment directives — `conda:` blocks are executor-agnostic
- Log paths — `log:` directives are executor-agnostic

**Making rules work with both executors:**

If you want the same Snakefile to work with `--executor slurm` and `--executor flux` without modification, keep executor-specific resources out of the Snakefile and put them in the profile's `default-resources` instead. Where that is not possible (rules that need different partitions or GPU resources), use a conditional pattern:

```python
# At the top of your Snakefile
import os
EXECUTOR = os.environ.get("SNAKEMAKE_EXECUTOR", "slurm")

rule gpu_step:
    threads: 4
    resources:
        mem_mb=32000,
        runtime=120,
        # Executor-specific resources
        slurm_partition="gpu" if EXECUTOR == "slurm" else None,
        slurm_extra="--gres=gpu:1" if EXECUTOR == "slurm" else None,
        flux_option_flags="-g1 -c4" if EXECUTOR == "flux" else None,
        queue="gpu" if EXECUTOR == "flux" else None,
    shell:
        "..."
```

> 💡 **Tip:** A cleaner approach is to use Snakemake 9's profile-level resource overrides. Define resources in the profile rather than the Snakefile, and the Snakefile remains executor-agnostic. This is the direction the Snakemake project recommends.

**Rollback:**

Switching back to Slurm is a one-word change:

```bash
# Flux
snakemake --profile profiles/flux

# Slurm (rollback)
snakemake --profile profiles/slurm
```

No files are modified, no configs are overwritten. Both profiles coexist indefinitely. This also means you can run A/B comparisons between executors on the same dataset — see [[hyperqueue-with-detect-snakemake|HyperQueue with DETECT Snakemake]] for the A/B evaluation methodology, which applies identically to Slurm-vs-Flux comparisons.

### Monitoring and Debugging

When your Snakemake pipeline is running inside a Flux instance, you have access to Flux's job monitoring tools. These are analogous to `squeue` and `sacct` but scoped to your Flux sub-instance.

**List all jobs:**

```bash
flux jobs -a
```

Expected output:

```
       JOBID USER     NAME       ST NTASKS NNODES     TIME INFO
   f6ByEH32Zo user1   align_re…  CD      1      1   2m30s node01
   f5xKdN19Rp user1   fastqc_…   CD      1      1     45s node02
   f7mLpQ44Wt user1   variant_…   R      1      1   1m10s node01
   f8nRsT55Xu user1   trim_rea…  CD      1      1   1m05s node03
```

States: `R` = running, `CD` = completed, `F` = failed, `CA` = cancelled, `PD` = pending.

**Custom output format:**

```bash
flux jobs -a --format="{id.f58} {name:20.20s} {status_abbrev} {runtime!F:>8h} {ranks}"
```

**Attach to a running job's output (live tail):**

```bash
flux job attach f7mLpQ44Wt
```

This streams stdout/stderr from the job in real time — similar to `tail -f` on a Slurm job's output file, but without needing to know the file path.

**Get the most recently submitted job:**

```bash
flux job last
```

**Aggregate job statistics:**

```bash
flux job stats
```

Expected output:

```
 pending:    3
 running:    8
 successful: 45
 failed:     1
 canceled:   0
 total:      57
```

**Comparison with Slurm monitoring commands:**

| Task | Slurm command | Flux command |
|------|--------------|--------------|
| List running jobs | `squeue -u $USER` | `flux jobs` |
| List all jobs (inc. completed) | `sacct -u $USER` | `flux jobs -a` |
| Job details | `scontrol show job 12345` | `flux job info f6ByEH32Zo` |
| Cancel a job | `scancel 12345` | `flux cancel f6ByEH32Zo` |
| Attach to output | `tail -f slurm-12345.out` | `flux job attach f6ByEH32Zo` |
| Job efficiency | `seff 12345` | `flux job stats` (aggregate only) |
| Queue overview | `squeue` | `flux queue status` |

> ⚠️ **Warning:** Flux job IDs and history only persist while the Flux broker is running. Once your `flux start` session exits (i.e., when the Snakemake run finishes and the Slurm job ends), the Flux job records are gone. If you need post-run analysis, capture `flux jobs -a` output before the run completes, or direct Snakemake's logs to persistent files.

> 🔗 **See also:** [[slurm-vs-flux-reference|Slurm vs Flux Reference]] for a comprehensive command mapping beyond Snakemake-specific usage.

---

## 5. Practical Examples

### Complete End-to-End: A 3-Rule Bioinformatics Pipeline

Here is a self-contained example that you can adapt to your own data. It runs three rules — trim reads, align to a reference, and call variants — using the Flux executor with containers.

**Directory structure:**

```
mini-pipeline/
├── Snakefile
├── config/
│   └── config.yaml
├── profiles/
│   └── flux/
│       └── config.yaml
├── scripts/
│   └── run-flux.sh
├── data/
│   ├── samples/
│   │   ├── sample_A.fastq.gz
│   │   └── sample_B.fastq.gz
│   └── reference/
│       └── genome.fa
└── logs/
```

**config/config.yaml:**

```yaml
samples:
  - sample_A
  - sample_B

reference: "data/reference/genome.fa"
```

**Snakefile:**

```python
import os

configfile: "config/config.yaml"

SAMPLES = config["samples"]
REFERENCE = config["reference"]


rule all:
    input:
        expand("results/variants/{sample}.vcf.gz", sample=SAMPLES)


rule trim_reads:
    input:
        reads="data/samples/{sample}.fastq.gz"
    output:
        trimmed="results/trimmed/{sample}.trimmed.fastq.gz",
        report="results/trimmed/{sample}.trimming_report.txt"
    log:
        "logs/trim/{sample}.log"
    threads: 4
    resources:
        mem_mb=8000,
        runtime=30,
        flux_option_flags="-c4"
    container:
        "docker://quay.io/biocontainers/trim-galore:0.6.10--hdfd78af_0"
    shell:
        "trim_galore --cores {threads} "
        "--output_dir results/trimmed/ "
        "{input.reads} 2> {log} && "
        "mv results/trimmed/{wildcards.sample}_trimmed.fq.gz {output.trimmed} && "
        "mv results/trimmed/{wildcards.sample}.fastq.gz_trimming_report.txt {output.report}"


rule align_reads:
    input:
        trimmed="results/trimmed/{sample}.trimmed.fastq.gz",
        ref=REFERENCE
    output:
        bam="results/aligned/{sample}.sorted.bam",
        bai="results/aligned/{sample}.sorted.bam.bai"
    log:
        "logs/align/{sample}.log"
    threads: 8
    resources:
        mem_mb=16000,
        runtime=120,
        flux_option_flags="-c8"
    container:
        "docker://biocontainers/bwa:0.7.17"
    shell:
        "bwa mem -t {threads} {input.ref} {input.trimmed} "
        "| samtools sort -@ {threads} -o {output.bam} 2> {log} && "
        "samtools index {output.bam}"


rule call_variants:
    input:
        bam="results/aligned/{sample}.sorted.bam",
        bai="results/aligned/{sample}.sorted.bam.bai",
        ref=REFERENCE
    output:
        vcf="results/variants/{sample}.vcf.gz"
    log:
        "logs/variant_call/{sample}.log"
    threads: 4
    resources:
        mem_mb=32000,
        runtime=240,
        flux_option_flags="-c4"
    container:
        "docker://broadinstitute/gatk:4.4.0.0"
    shell:
        "gatk HaplotypeCaller "
        "-R {input.ref} -I {input.bam} -O {output.vcf} "
        "--native-pair-hmm-threads {threads} 2> {log}"
```

**profiles/flux/config.yaml:**

```yaml
executor: flux
jobs: 32
latency-wait: 30
rerun-incomplete: true
default-resources:
  - cores=4
  - mem_mb=8000
  - runtime=60
```

**scripts/run-flux.sh:**

```bash
#!/usr/bin/env bash
#SBATCH --job-name=mini-pipeline-flux
#SBATCH --nodes=2
#SBATCH --ntasks-per-node=16
#SBATCH --time=04:00:00
#SBATCH --partition=general
#SBATCH --account=mylab
#SBATCH --output=logs/flux-pipeline-%j.out
#SBATCH --error=logs/flux-pipeline-%j.err

set -euo pipefail

module load flux/0.67.0
source activate snakemake-env

echo "Starting Flux-Snakemake pipeline at $(date)"
echo "Nodes: ${SLURM_NNODES}, Cores: $((SLURM_NNODES * 16))"

flux start snakemake \
    --profile profiles/flux \
    --snakefile Snakefile \
    --configfile config/config.yaml \
    --use-apptainer \
    --apptainer-prefix /scratch/$USER/.apptainer_cache \
    2>&1

echo "Pipeline completed at $(date)"
```

**Run it:**

```bash
cd mini-pipeline
mkdir -p logs results
sbatch scripts/run-flux.sh
```

**Monitor it** (while the Slurm job is running):

```bash
# Check Slurm job status
squeue -u $USER

# If you need to look inside the Flux instance, SSH to the first node
# and connect to the Flux broker:
ssh $(squeue -u $USER -o "%N" -h | head -1)
export FLUX_URI=$(cat /tmp/flux-$USER/local-0/uri)
flux jobs -a
```

> 💡 **Tip:** For interactive debugging, consider starting the Flux instance via `salloc` instead of `sbatch`. This gives you a terminal inside the allocation where you can run `flux` commands directly:
>
> ```bash
> salloc --nodes=2 --ntasks-per-node=16 --time=04:00:00 --partition=general
> module load flux/0.67.0
> source activate snakemake-env
> flux start bash   # starts Flux and drops you into a shell
> # Now you're inside Flux — run Snakemake, check flux jobs, etc.
> snakemake --profile profiles/flux --snakefile Snakefile
> flux jobs -a       # monitor in the same terminal or another one
> ```

---

## 6. Hands-On Exercises

### Exercise 1: Single-Rule Smoke Test

Pick the simplest rule in your Snakemake pipeline (something that runs in under a minute, like `fastqc` or a file-copy step). Run it through both executors and compare the output:

```bash
# Slurm path
snakemake --profile profiles/slurm --until fastqc --config samples=["test_001"] --jobs 1

# Clean the output
rm -rf results/fastqc/test_001*

# Flux path (inside a flux start session)
flux start snakemake --profile profiles/flux --until fastqc --config samples=["test_001"] --jobs 1

# Compare outputs
diff results/fastqc/test_001_slurm/ results/fastqc/test_001_flux/
```

If the outputs are identical (they should be — the executor does not affect computation), the integration works.

### Exercise 2: Resource Mapping Audit

For each rule in your Snakefile that uses `slurm_partition` or `slurm_extra`, create the equivalent `flux_option_flags` and `queue` resources. Build a mapping table like this:

| Rule | Slurm resources | Flux resources | Verified? |
|------|----------------|----------------|-----------|
| `trim_reads` | `slurm_partition="general"`, `slurm_extra="--cpus-per-task=4"` | `queue="compute"`, `flux_option_flags="-c4"` | |
| `align_reads` | `slurm_partition="compute"`, `slurm_extra="--ntasks=1 --cpus-per-task=8"` | `queue="compute"`, `flux_option_flags="-n1 -c8"` | |
| `gpu_step` | `slurm_partition="gpu"`, `slurm_extra="--gres=gpu:1"` | `queue="gpu"`, `flux_option_flags="-g1"` | |

Run each rule individually through the Flux executor and mark the "Verified?" column when it completes successfully.

### Exercise 3: Profile Switching Under Load

Submit the full pipeline with 5-10 samples through both executors and compare:

1. Total wall-clock time (from Slurm job start to finish)
2. Number of Slurm jobs created (`sacct -u $USER --starttime=<start> | wc -l`)
3. Maximum queue wait time for any individual rule

The Flux path should create exactly 1 Slurm job (the outer allocation) compared to N jobs for the Slurm executor path. Queue wait should be near-zero for Flux (since all scheduling is internal) compared to seconds-to-minutes for Slurm per-rule submission.

---

## 7. Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `ModuleNotFoundError: No module named 'flux'` | Flux Python bindings not installed in the conda env | `pip install flux-python` or add the system Flux Python path to `PYTHONPATH`. See [[flux-system-setup\|Flux System Setup]]. |
| `FLUX_URI is not set` or `Unable to connect to Flux broker` | Snakemake was invoked outside of `flux start` | Wrap your Snakemake command inside `flux start snakemake ...`. The broker must be running. |
| `snakemake-executor-plugin-flux` not found by `--list-executor-plugins` | Plugin not installed in the active environment | `pip install snakemake-executor-plugin-flux` inside the environment where Snakemake runs |
| Snakemake hangs after submitting jobs | Flux broker died or ran out of resources | Check `flux dmesg` for broker errors. Ensure your allocation has enough memory for the broker itself (reserve ~2GB). |
| Container image not found inside Flux job | `.sif` path is node-local or inaccessible from compute nodes | Use `--apptainer-prefix` pointing to a shared filesystem (e.g., `/scratch`, `/projects`). See [[isaaclab-metagrasp-apptainer-hpc-beginner-guide\|Apptainer HPC Guide]]. |
| `flux_option_flags` not recognized | Snakemake version too old or plugin version mismatch | Verify `snakemake --version` is 9.x and `pip show snakemake-executor-plugin-flux` shows a compatible version |
| Job fails with `resource unavailable` | Requesting more resources than the Flux instance has | Your `flux_option_flags` request exceeds the allocation. Check with `flux resource list` to see available resources. |
| `queue "gpu" not found` | Queue not defined in this Flux instance | Queues must be configured in the Flux instance. In a sub-instance inside Slurm, queues may not exist — remove the `queue=` resource or configure queues in the `flux start` configuration. |
| Output files not visible to Snakemake after rule completes | NFS propagation delay | Increase `latency-wait` in your profile (try 60 seconds). This is the same issue that affects the Slurm executor on NFS-mounted filesystems. |
| `flux: command not found` after loading module | Module sets `PATH` but not `PYTHONPATH` | Check `module show flux` to see what it sets. You may need to manually add `PYTHONPATH` or use `pip install flux-python` in your env. |

### Common Debugging Workflow

When a Snakemake rule fails inside Flux, follow this sequence:

```bash
# 1. Check which Snakemake rule failed (Snakemake reports this)
# Look at Snakemake's output or the log file

# 2. Find the Flux job ID for the failed rule
flux jobs -a --filter=failed

# 3. Get the job's stderr
flux job attach <jobid> 2>&1 | tail -50

# 4. Check Flux broker messages for system-level errors
flux dmesg | tail -20

# 5. Verify resource availability
flux resource list

# 6. If the issue is resource-related, check what the job requested
flux job info <jobid> jobspec | python -m json.tool
```

---

## 8. References

- [Snakemake Executor Plugin Catalog](https://snakemake.github.io/snakemake-plugin-catalog/plugins/executor/flux.html) — official plugin documentation and configuration reference
- [snakemake-executor-plugin-flux on GitHub](https://github.com/snakemake/snakemake-executor-plugin-flux) — source code, issue tracker, and release notes
- [Flux Framework Documentation](https://flux-framework.readthedocs.io/en/latest/) — comprehensive Flux user guide
- [Flux Python API Reference](https://flux-framework.readthedocs.io/en/latest/python/index.html) — Python bindings documentation
- [Snakemake 9 Executor Documentation](https://snakemake.readthedocs.io/en/stable/executing/cluster.html) — general executor plugin architecture
- [Snakemake Profile Documentation](https://snakemake.readthedocs.io/en/stable/executing/cli.html#profiles) — how profiles work in Snakemake 9
- [Flux job submission reference](https://flux-framework.readthedocs.io/en/latest/man1/flux-submit.html) — all flags accepted by `flux submit`
- [Apptainer on HPC clusters](https://apptainer.org/docs/user/latest/) — container runtime documentation

---

## 9. Summary

Key takeaways from this tutorial:

1. **The executor is a thin layer.** Switching from Slurm to Flux changes how jobs are submitted and monitored. It does not change your workflow logic, container setup, or file dependencies.

2. **Install two packages.** `snakemake-executor-plugin-flux` and the Flux Python bindings (`flux-python` or system module) are all you need.

3. **Use the `flux start` wrapper pattern.** Request a Slurm allocation, start a Flux instance inside it, and run Snakemake with `--executor flux`. This works on any Slurm cluster without admin changes.

4. **Map resources systematically.** `slurm_partition` becomes `queue`, `slurm_extra` becomes `flux_option_flags`. Use the reference tables above for every resource type.

5. **Event-driven beats polling.** Flux's event API eliminates the 10-30 second status-check latency that the Slurm executor introduces. For pipelines with many short rules, this translates to measurable wall-clock savings.

6. **Keep the Slurm profile as a fallback.** Both profiles coexist. Switching is a one-flag change. There is no reason to delete your working Slurm profile.

7. **Job history is ephemeral.** Flux job records exist only while the broker runs. Capture `flux jobs -a` before the run ends if you need post-hoc analysis.

---

## Related Tutorials

- [[flux-basics|Flux Basics]] — installation, resource model, first jobs
- [[flux-system-setup|Flux System Setup]] — building and configuring Flux in user space or system-wide
- [[flux-advanced-features|Advanced Flux Features]] — hierarchical scheduling, multi-user instances, custom resource types
- [[slurm-vs-flux-reference|Slurm vs Flux Reference]] — comprehensive command and concept mapping
- [[slurm-vs-flux-deep-dive|Slurm vs Flux Deep Dive]] — architectural comparison and migration strategies
- [[hyperqueue-with-detect-snakemake|HyperQueue with DETECT Snakemake]] — alternative meta-scheduler approach for the same pipeline
- [[hyperqueue-basics|HyperQueue Basics]] — HyperQueue installation and first tasks
- [[isaaclab-metagrasp-apptainer-hpc-beginner-guide|Apptainer HPC Guide]] — container management on HPC clusters
- [[pixi-beginner-guide|Pixi Beginner Guide]] — reproducible environment management for scientific workflows

---

## Next Steps

Start small: pick one rule from your Snakemake pipeline, create a `profiles/flux/config.yaml` with the configuration shown above, and run that single rule inside a `flux start` session against a test dataset. Compare the output against what your Slurm profile produces. If the outputs match, scale up to the full pipeline.

Once you are comfortable with the executor plugin, move on to [[flux-advanced-features|Advanced Flux Features]] to learn about hierarchical scheduling (nested sub-instances for multi-stage pipelines), custom resource types (labeling nodes by capability), and Flux's Python API for programmatic workflow construction.
