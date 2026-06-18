---
title: "Linux Cgroups Deep Dive: Advanced Resource Management for HPC"
date: 2026-05-21
difficulty: advanced
tags:
  - linux
  - cgroups
  - cgroups-v2
  - hpc
  - slurm
  - resource-management
  - containers
  - namespaces
  - systemd
  - kernel
---

# Linux Cgroups Deep Dive: Advanced Resource Management for HPC

## Overview

This tutorial goes beyond the basics covered in [[cgroups-beginner-guide|Cgroups Beginner Guide]] and explores the internals of Linux control groups, their integration with systemd and Slurm, and advanced resource management patterns used in production HPC environments.

You will learn how cgroups v2's unified hierarchy works at the kernel level, how to configure Slurm's cgroup plugins for optimal job isolation, how container runtimes like [[docker-test-container-deep-dive|Docker]] and Apptainer interact with cgroups on HPC clusters, and how to implement fine-grained CPU pinning, memory enforcement, and GPU isolation for demanding workloads.

### What You Will Learn

- Cgroups v1 vs v2 architecture at the kernel level
- All cgroup v2 controllers and their configuration interfaces
- Slurm's cgroup plugin stack: `cgroup/v2`, `task/cgroup`, `jobacct_gather/cgroup`
- Production `slurm.conf` and `cgroup.conf` configuration
- CPU pinning, NUMA-aware scheduling, and memory enforcement
- GPU resource isolation with cgroups
- Container runtime cgroup integration (Docker, Apptainer/Singularity)
- Cgroup delegation and namespace interaction
- Performance monitoring and accounting
- Security hardening for multi-tenant HPC clusters

## Prerequisites

- Completion of the [[cgroups-beginner-guide|Cgroups Beginner Guide]]
- Strong Linux command-line skills (see [[linux-permissions-deep-dive|Linux Permissions Deep Dive]])
- Understanding of Slurm job scheduling (familiarity with `sbatch`, `srun`, `scontrol`)
- Experience with HPC workloads (MPI, GPU computing, large-memory jobs)
- Root access to a test system (for configuration exercises) or willingness to read along
- Familiarity with systemd concepts (units, slices, scopes)

## Key Concepts

### Cgroups v1 vs v2: Architectural Differences

#### Cgroups v1: Multiple Hierarchies

In cgroups v1, each controller maintains its own independent hierarchy. The kernel mounts each controller as a separate filesystem:

```
/sys/fs/cgroup/
├── cpu/              # CPU controller hierarchy
│   ├── user.slice/
│   └── system.slice/
├── memory/           # Memory controller hierarchy
│   ├── user.slice/
│   └── system.slice/
├── cpuset/           # CPUset controller hierarchy
│   └── slurm/
├── devices/          # Devices controller hierarchy
├── blkio/            # Block I/O controller hierarchy
├── pids/             # PIDs controller hierarchy
└── freezer/          # Freezer controller hierarchy
```

A process can belong to different cgroups in different hierarchies. For example, process 1234 might be in `/cpu/user.slice/job_100` but in `/memory/system.slice`. This flexibility was the original design intent, but in practice it created management complexity, race conditions, and inconsistent behavior.

**Key v1 problems for HPC:**
- A process could be CPU-limited in one hierarchy but memory-unlimited in another
- No atomic way to move a process across all controllers simultaneously
- The `devices` controller was a flat allowlist with no inheritance model
- Thread-level granularity was inconsistent across controllers

#### Cgroups v2: Unified Hierarchy

Cgroups v2 enforces a single hierarchy where all controllers operate on the same tree:

```
/sys/fs/cgroup/                          # Root cgroup (cgroup2 mount)
├── cgroup.controllers                   # Available controllers
├── cgroup.subtree_control               # Enabled controllers for children
├── system.slice/                        # System services
│   ├── slurmstepd.scope/               # Slurm step daemon scope
│   │   ├── job_100/                     # Job 100's cgroup
│   │   │   ├── step_0/                  # Step 0
│   │   │   │   ├── task_0/             # Task 0
│   │   │   │   │   ├── cgroup.procs    # PIDs in this cgroup
│   │   │   │   │   ├── cpu.max         # CPU limit
│   │   │   │   │   ├── cpuset.cpus     # Pinned cores
│   │   │   │   │   ├── memory.max      # Memory hard limit
│   │   │   │   │   └── memory.current  # Current memory usage
│   │   │   │   └── task_1/
│   │   │   └── step_1/
│   │   └── job_101/
│   └── sshd.service/
└── user.slice/                          # User sessions
    └── user-1000.slice/
```

**The "no internal process" constraint:** In v2, a cgroup that has children cannot contain processes directly. Processes must live at leaf nodes. This eliminates ambiguity about which cgroup's limits apply and simplifies the resource distribution model.

**Top-down constraint:** A child cgroup can never have more resources than its parent. Controllers enforce this strictly — if the parent has `memory.max=8G`, no child can set a limit higher than 8G, and the total usage of all children cannot exceed 8G.

#### Migration Considerations for HPC Clusters

Many HPC clusters still run cgroups v1 on older operating systems (RHEL 7, CentOS 7). Migration requires:

```bash
# Check current cgroup version
stat -fc %T /sys/fs/cgroup/
# cgroup2fs = v2, tmpfs = v1

# On RHEL/Rocky 8+, enable v2 via kernel parameter
# Edit /etc/default/grub:
GRUB_CMDLINE_LINUX="... systemd.unified_cgroup_hierarchy=1"

# Regenerate GRUB config
grub2-mkconfig -o /boot/grub2/grub.cfg

# Reboot required
```

After migrating, verify Slurm detects v2:

```bash
scontrol show config | grep CgroupPlugin
```

**Expected output:**
```
CgroupPlugin            = autodetect
```

### Controller Deep Dive

#### CPU Controller

The CPU controller in v2 uses a weight-based proportional distribution model combined with hard bandwidth limits:

```bash
# cpu.max — hard bandwidth limit
# Format: $MAX $PERIOD (both in microseconds)
cat /sys/fs/cgroup/system.slice/slurmstepd.scope/job_100/cpu.max
```

**Expected output:**
```
200000 100000
```

This means the job gets 200ms of CPU time per 100ms period = 2 full cores equivalent.

```bash
# cpu.weight — proportional share (1-10000, default 100)
cat /sys/fs/cgroup/system.slice/slurmstepd.scope/job_100/cpu.weight
```

**Expected output:**
```
100
```

**How Slurm uses it:** When you request `--cpus-per-task=4`, Slurm sets `cpu.max` to allow 4 cores worth of CPU time. The `cpu.weight` provides fair sharing when multiple jobs compete for the same cores (rare with proper cpuset pinning, but relevant for oversubscription).

#### CPUset Controller

The cpuset controller pins processes to specific CPU cores and NUMA memory nodes. This is critical for HPC performance:

```bash
# cpuset.cpus — which CPU cores this cgroup can use
cat /sys/fs/cgroup/.../job_100/cpuset.cpus
```

**Expected output:**
```
0-3
```

```bash
# cpuset.mems — which NUMA nodes for memory allocation
cat /sys/fs/cgroup/.../job_100/cpuset.mems
```

**Expected output:**
```
0
```

```bash
# cpuset.cpus.partition — partition type
# "root" = exclusive access, "member" = shared
cat /sys/fs/cgroup/.../job_100/cpuset.cpus.partition
```

**NUMA topology matters for HPC.** On a dual-socket server with AMD EPYC processors, memory access is non-uniform — accessing memory on the remote NUMA node takes significantly longer. The cpuset controller ensures that a job's processes and memory stay on the same NUMA domain:

```
+------------------------------------------+
|              Compute Node                 |
|                                           |
|  Socket 0 (NUMA 0)    Socket 1 (NUMA 1)  |
|  +----------------+   +----------------+ |
|  | Cores 0-31     |   | Cores 32-63    | |
|  | 256GB DDR5     |   | 256GB DDR5     | |
|  +-------+--------+   +--------+-------+ |
|          |   Interconnect (UPI) |         |
|          +----------------------+         |
|                                           |
|  Job A: cpuset.cpus=0-15                  |
|         cpuset.mems=0                     |
|  Job B: cpuset.cpus=32-47                 |
|         cpuset.mems=1                     |
+------------------------------------------+
```

#### Memory Controller

The memory controller is the most impactful for HPC job isolation:

```bash
# memory.max — hard limit (OOM kill if exceeded)
cat /sys/fs/cgroup/.../job_100/memory.max

# memory.high — throttling threshold (processes slowed, not killed)
cat /sys/fs/cgroup/.../job_100/memory.high

# memory.low — best-effort memory protection
cat /sys/fs/cgroup/.../job_100/memory.low

# memory.current — current RSS + cache usage
cat /sys/fs/cgroup/.../job_100/memory.current

# memory.swap.max — swap limit
cat /sys/fs/cgroup/.../job_100/memory.swap.max

# memory.peak — high-water mark (max ever reached)
cat /sys/fs/cgroup/.../job_100/memory.peak

# memory.stat — detailed memory breakdown
cat /sys/fs/cgroup/.../job_100/memory.stat
```

**Expected output for memory.stat:**
```
anon 2147483648
file 536870912
kernel 16777216
shmem 268435456
pgfault 1234567
pgmajfault 42
oom_kill 0
```

**How Slurm maps memory requests to cgroup limits:**

Slurm's behavior is controlled by `AllowedRAMSpace` in `cgroup.conf`. The formula is:

```
memory.high = allocated_memory  (soft limit)
memory.max  = allocated_memory * (AllowedRAMSpace / 100)
```

With `AllowedRAMSpace=100` (the default), the soft and hard limits are the same. Some sites set `AllowedRAMSpace=105` to allow a 5% buffer.

#### I/O Controller

The I/O controller regulates disk bandwidth, which matters for data-intensive HPC workloads:

```bash
# io.max — per-device bandwidth limits
# Format: MAJOR:MINOR rbps=BYTES wbps=BYTES riops=N wiops=N
cat /sys/fs/cgroup/.../job_100/io.max
```

**Expected output:**
```
8:0 rbps=1073741824 wbps=536870912 riops=max wiops=max
```

This limits reads to 1GB/s and writes to 512MB/s on device 8:0 (typically `/dev/sda`).

```bash
# io.stat — I/O statistics
cat /sys/fs/cgroup/.../job_100/io.stat
```

**Expected output:**
```
8:0 rbytes=4294967296 wbytes=1073741824 rios=10240 wios=2560 dbytes=0 dios=0
```

#### PIDs Controller

Prevents fork bombs and runaway process creation:

```bash
# pids.max — maximum number of processes
cat /sys/fs/cgroup/.../job_100/pids.max

# pids.current — current process count
cat /sys/fs/cgroup/.../job_100/pids.current
```

#### HugeTLB Controller

Manages huge page allocations, commonly used in HPC for large scientific datasets and MPI shared memory:

```bash
# hugetlb.2MB.max — limit on 2MB huge pages
cat /sys/fs/cgroup/.../job_100/hugetlb.2MB.max

# hugetlb.1GB.max — limit on 1GB huge pages (if supported)
cat /sys/fs/cgroup/.../job_100/hugetlb.1GB.max
```

#### RDMA Controller

Controls InfiniBand and RDMA resource allocation — essential for HPC networking:

```bash
# rdma.max — per-device RDMA resource limits
cat /sys/fs/cgroup/.../job_100/rdma.max
```

**Expected output:**
```
mlx5_0 hca_handle=2 hca_object=4096
```

### Cgroup Delegation

Delegation allows a non-root process to manage its own subtree of cgroups. This is critical for:

- Container runtimes running inside Slurm jobs
- User-level task managers within a job allocation
- Tools like [[hyperqueue-deep-dive|HyperQueue]] running as sub-schedulers

To delegate a cgroup, the parent must grant ownership:

```bash
# The parent cgroup (owned by root/Slurm) delegates to the job
chown -R slurm:slurm /sys/fs/cgroup/.../job_100/

# Enable delegation for specific controllers
echo "+cpu +memory +pids" > /sys/fs/cgroup/.../job_100/cgroup.subtree_control
```

In systemd, delegation is configured via unit properties:

```ini
# In a systemd scope/service
[Service]
Delegate=yes
DelegateControllers=cpu memory pids
```

Slurm handles delegation automatically when it creates job cgroups. When you run a container inside a Slurm job (e.g., using [[isaaclab-metagrasp-apptainer-hpc-beginner-guide|Apptainer]]), the container runtime creates sub-cgroups within the job's delegated tree.

### Cgroups and Linux Namespaces

Cgroups and namespaces are complementary isolation mechanisms. Cgroups limit **how much** of a resource a process can use; namespaces limit **what** a process can see.

```
+-------------------------------------------------------+
|                    Linux Kernel                        |
|                                                        |
|  Namespaces (visibility)    Cgroups (limits)           |
|  +-------------------+     +--------------------+     |
|  | PID namespace     |     | pids.max = 100     |     |
|  | (sees PIDs 1-N)   |     +--------------------+     |
|  +-------------------+     +--------------------+     |
|  | Mount namespace   |     | memory.max = 16G   |     |
|  | (own /proc, /sys) |     +--------------------+     |
|  +-------------------+     +--------------------+     |
|  | Net namespace     |     | cpu.max = 400000   |     |
|  | (own interfaces)  |     +--------------------+     |
|  +-------------------+     +--------------------+     |
|  | User namespace    |     | cpuset.cpus = 0-3  |     |
|  | (own uid mapping) |     +--------------------+     |
|  +-------------------+                                |
+-------------------------------------------------------+
```

**The cgroup namespace** (introduced in kernel 4.6) virtualizes the cgroup filesystem view. A process in a cgroup namespace sees its own cgroup as the root:

```bash
# Without cgroup namespace — process sees full hierarchy
cat /proc/self/cgroup
# 0::/system.slice/slurmstepd.scope/job_100/step_0/task_0

# With cgroup namespace — process sees itself as root
# (inside a container within the job)
cat /proc/self/cgroup
# 0::/
```

This is how [[docker-test-container-beginner-guide|Docker]] containers and Apptainer present a clean cgroup view to containerized processes.

## Step-by-Step Instructions

### Step 1: Configure Slurm's Cgroup Plugins

Slurm uses three cgroup-related plugins that work together:

| Plugin | Purpose | Configuration |
|--------|---------|---------------|
| `cgroup/v2` | Core cgroup management — creates/destroys cgroup hierarchy | `CgroupPlugin` in `slurm.conf` |
| `task/cgroup` | Task-level resource binding — CPU pinning, memory limits per task | `TaskPlugin` in `slurm.conf` |
| `jobacct_gather/cgroup` | Job accounting — reads resource usage from cgroup counters | `JobAcctGatherType` in `slurm.conf` |

**slurm.conf configuration:**

```ini
# /etc/slurm/slurm.conf

# Use autodetect to automatically pick v1 or v2
CgroupPlugin=autodetect

# Enable cgroup-based task management
TaskPlugin=task/cgroup,task/affinity

# Use cgroups for job accounting (more accurate than polling /proc)
JobAcctGatherType=jobacct_gather/cgroup

# Accounting frequency in seconds
JobAcctGatherFrequency=task=30

# Enable job resource containment
ProctrackType=proctrack/cgroup
```

### Step 2: Configure cgroup.conf

The `cgroup.conf` file controls how Slurm interacts with the cgroup filesystem:

```ini
# /etc/slurm/cgroup.conf

# Auto-detect cgroup version (recommended)
CgroupPlugin=autodetect

# --- Core Resource Constraints ---

# Constrain CPU cores to allocated set (CRITICAL for HPC)
ConstrainCores=yes

# Constrain memory to allocated amount
ConstrainRAMSpace=yes

# Prevent swap usage (recommended for HPC — swap kills performance)
ConstrainSwapSpace=yes

# Allow 100% of allocated RAM (no buffer)
AllowedRAMSpace=100

# No swap allowed
AllowedSwapSpace=0

# Constrain devices (GPUs, etc.) to allocated set
ConstrainDevices=yes

# --- Systemd Integration ---

# Use systemd for cgroup management (recommended for v2)
# Set to "yes" only if systemd is causing problems
IgnoreSystemd=no

# Fall back to manual cgroup creation if systemd fails
IgnoreSystemdOnFailure=yes

# --- Additional Controllers ---

# Enable extra controllers in the job cgroup subtree
# Useful for I/O throttling and process limiting
EnableControllers=io,pids

# Signal to send on OOM (default SIGKILL=9)
# Some sites use SIGTERM (15) to allow graceful cleanup
CgroupMountpoint=/sys/fs/cgroup
```

### Step 3: Advanced CPU Pinning Configuration

For optimal HPC performance, you need precise control over how tasks are bound to CPU cores. This involves both Slurm and cgroup cpuset configuration:

```bash
# View the node's topology
lscpu | grep -E "Socket|Core|Thread|NUMA"
```

**Expected output (dual-socket AMD EPYC 9374F):**
```
Thread(s) per core:    2
Core(s) per socket:    32
Socket(s):             2
NUMA node(s):          2
NUMA node0 CPU(s):     0-31,64-95
NUMA node1 CPU(s):     32-63,96-127
```

Configure Slurm for NUMA-aware scheduling:

```ini
# /etc/slurm/slurm.conf (node definition)
NodeName=gpu-node01 CPUs=128 Boards=1 SocketsPerBoard=2 \
  CoresPerSocket=32 ThreadsPerCore=2 RealMemory=512000 \
  Gres=gpu:a100:4
```

Submit a NUMA-aware job:

```bash
# Request 16 cores on a single NUMA domain
srun --ntasks=1 --cpus-per-task=16 \
     --hint=nomultithread \
     --cpu-bind=cores \
     --mem-bind=local \
     ./my_simulation
```

Verify the cpuset assignment on the compute node:

```bash
# Find the job's cgroup
JOB_CG=$(find /sys/fs/cgroup -path "*/job_${SLURM_JOBID}*/cpuset.cpus" | head -1)
cat $JOB_CG
```

**Expected output:**
```
0-15
```

All 16 cores are on NUMA node 0, and memory allocation is local to that node.

### Step 4: GPU Resource Isolation

Modern HPC clusters use cgroups to isolate GPU access. Slurm's `ConstrainDevices=yes` uses the devices controller (v1) or BPF-based device filtering (v2) to restrict which GPUs a job can see:

```ini
# /etc/slurm/gres.conf
AutoDetect=nvml
Name=gpu Type=a100 File=/dev/nvidia[0-3]
```

```bash
# Submit a 2-GPU job
sbatch --gres=gpu:a100:2 --wrap="nvidia-smi -L"
```

**Expected output (job only sees 2 of 4 GPUs):**
```
GPU 0: NVIDIA A100-SXM4-80GB (UUID: GPU-abc123...)
GPU 1: NVIDIA A100-SXM4-80GB (UUID: GPU-def456...)
```

Inspect the device cgroup:

```bash
# On the compute node, check which devices the job can access
JOB_DIR="/sys/fs/cgroup/system.slice/slurmstepd.scope/job_${SLURM_JOBID}"

# In v2, device access is controlled via eBPF programs
# Check the BPF program attached to the cgroup
ls $JOB_DIR/bpf/

# Check CUDA_VISIBLE_DEVICES set by Slurm
srun --jobid=$SLURM_JOBID env | grep CUDA
```

**Expected output:**
```
CUDA_VISIBLE_DEVICES=0,1
GPU_DEVICE_ORDINAL=0,1
```

**GPU memory isolation with MIG (Multi-Instance GPU):**

On A100 and newer GPUs, MIG partitioning combined with cgroups allows multiple jobs to share a single physical GPU:

```bash
# Admin: Configure MIG on A100
nvidia-smi mig -cgi 19,19,19 -C

# Slurm GRES configuration for MIG instances
# /etc/slurm/gres.conf
Name=gpu Type=a100_3g.40gb File=/dev/nvidia[0-2] Flags=MIG
```

### Step 5: Memory Enforcement and OOM Handling

Configure aggressive memory enforcement for production HPC:

```ini
# /etc/slurm/cgroup.conf

# Hard limit at exactly the requested amount
AllowedRAMSpace=100

# No swap — scientific codes should not swap
AllowedSwapSpace=0
ConstrainSwapSpace=yes
```

**Understanding the memory enforcement chain:**

```
User requests:  sbatch --mem=16G

Slurm sets:     memory.high = 16G     (soft limit — throttle)
                memory.max  = 16G     (hard limit — OOM kill)
                memory.swap.max = 0   (no swap)

Kernel behavior:
  Usage < 16G         -> normal operation
  Usage approaching   -> memory.high triggers reclaim pressure
  Usage = 16G         -> memory.max triggers OOM killer
  OOM kill            -> kernel sends SIGKILL to a process
  Slurm detects       -> job state = OUT_OF_MEMORY
```

**Monitoring memory pressure:**

```bash
# memory.pressure — PSI (Pressure Stall Information)
cat /sys/fs/cgroup/.../job_100/memory.pressure
```

**Expected output:**
```
some avg10=2.50 avg60=1.20 avg300=0.45 total=234567
full avg10=0.10 avg60=0.05 avg300=0.02 total=12345
```

PSI values above zero indicate memory contention. `some` means at least one task is stalled waiting for memory; `full` means all tasks are stalled. This is extremely useful for detecting jobs that are near their limit without actually OOM-killing them.

### Step 6: Performance Monitoring and Accounting

Use cgroups for accurate job accounting instead of polling `/proc`:

```bash
# CPU accounting
cat /sys/fs/cgroup/.../job_100/cpu.stat
```

**Expected output:**
```
usage_usec 3600000000
user_usec 3400000000
system_usec 200000000
nr_periods 36000
nr_throttled 0
throttled_usec 0
```

Key metrics:
- `usage_usec` — total CPU time consumed (3600 seconds = 1 hour on 1 core)
- `nr_throttled` — number of times the job was throttled (should be 0 with proper cpuset pinning)
- `throttled_usec` — time spent throttled

```bash
# I/O accounting
cat /sys/fs/cgroup/.../job_100/io.stat
```

**Expected output:**
```
259:0 rbytes=107374182400 wbytes=53687091200 rios=1024000 wios=512000
```

This shows 100GB read, 50GB written to device 259:0.

**Build a monitoring script for job accounting:**

```bash
#!/bin/bash
# monitor_job_cgroup.sh — Real-time cgroup monitoring for a Slurm job
# Usage: ./monitor_job_cgroup.sh <JOBID>

JOBID=$1
if [ -z "$JOBID" ]; then
    echo "Usage: $0 <JOBID>"
    exit 1
fi

JOB_CG=$(find /sys/fs/cgroup -path "*job_${JOBID}" -type d 2>/dev/null | head -1)
if [ -z "$JOB_CG" ]; then
    echo "Cgroup for job $JOBID not found. Is the job running on this node?"
    exit 1
fi

echo "Monitoring cgroup: $JOB_CG"
echo "Press Ctrl+C to stop"
echo ""

while true; do
    MEM_CURRENT=$(cat $JOB_CG/memory.current 2>/dev/null)
    MEM_MAX=$(cat $JOB_CG/memory.max 2>/dev/null)
    MEM_PEAK=$(cat $JOB_CG/memory.peak 2>/dev/null)
    CPU_USAGE=$(grep usage_usec $JOB_CG/cpu.stat 2>/dev/null | awk '{print $2}')
    PIDS=$(cat $JOB_CG/pids.current 2>/dev/null)

    # Convert bytes to human-readable
    MEM_CURRENT_GB=$(echo "scale=2; $MEM_CURRENT / 1073741824" | bc)
    MEM_PEAK_GB=$(echo "scale=2; $MEM_PEAK / 1073741824" | bc)
    if [ "$MEM_MAX" = "max" ]; then
        MEM_MAX_GB="unlimited"
    else
        MEM_MAX_GB=$(echo "scale=2; $MEM_MAX / 1073741824" | bc)
    fi

    CPU_SEC=$(echo "scale=2; $CPU_USAGE / 1000000" | bc)

    clear
    echo "=== Job $JOBID Cgroup Monitor ==="
    echo "Time: $(date)"
    echo ""
    echo "Memory:  ${MEM_CURRENT_GB}GB / ${MEM_MAX_GB}GB (peak: ${MEM_PEAK_GB}GB)"
    echo "CPU:     ${CPU_SEC}s total"
    echo "PIDs:    $PIDS"
    echo ""
    echo "CPUs:    $(cat $JOB_CG/cpuset.cpus 2>/dev/null)"
    echo "NUMA:    $(cat $JOB_CG/cpuset.mems 2>/dev/null)"

    if [ -f "$JOB_CG/memory.pressure" ]; then
        echo ""
        echo "Memory pressure:"
        cat $JOB_CG/memory.pressure
    fi

    sleep 2
done
```

### Step 7: Container Runtime Integration

#### Docker and Cgroups

When running [[docker-test-container-deep-dive|Docker]] containers on an HPC cluster, Docker creates sub-cgroups within its own slice:

```bash
# Docker's default cgroup structure (v2)
/sys/fs/cgroup/
└── system.slice/
    └── docker-<container-id>.scope/
        ├── memory.max          # Set by --memory flag
        ├── cpu.max             # Set by --cpus flag
        └── pids.max            # Set by --pids-limit flag
```

```bash
# Run a container with explicit resource limits
docker run --rm \
  --cpus=4 \
  --memory=16g \
  --memory-swap=16g \
  --pids-limit=1000 \
  my-hpc-image:latest ./run_simulation.sh
```

Inspect the container's cgroup:

```bash
CONTAINER_ID=$(docker ps -q --filter name=my-container)
docker inspect $CONTAINER_ID --format='{{.HostConfig.CgroupParent}}'
```

#### Apptainer/Singularity and Cgroups

[[isaaclab-metagrasp-apptainer-hpc-deep-dive|Apptainer]] (formerly Singularity) is the standard container runtime for HPC. It integrates with Slurm's existing cgroup tree rather than creating its own:

```bash
# Apptainer inherits the job's cgroup limits
srun --mem=32G --cpus-per-task=8 \
  apptainer exec my_container.sif ./compute.py
```

The key difference from Docker: Apptainer runs as the user (not as root daemon), so it operates within Slurm's existing cgroup hierarchy. The container's processes live in the same cgroup as the job step.

You can also apply additional cgroup limits to Apptainer containers:

```bash
# Create a cgroup TOML config for Apptainer
cat > ~/cgroup-limits.toml << 'EOF'
[memory]
  limit = 8589934592  # 8GB hard limit

[cpu]
  shares = 512        # Proportional CPU weight

[pids]
  limit = 500         # Max 500 processes
EOF

# Apply the limits
apptainer exec --apply-cgroups ~/cgroup-limits.toml \
  my_container.sif ./compute.py
```

#### Kubernetes and Cgroups

[[kubernetes-deep-dive|Kubernetes]] uses cgroups extensively for pod resource management. On HPC clusters running Kubernetes (common in cloud-HPC hybrid setups), the cgroup hierarchy looks like:

```
/sys/fs/cgroup/
└── kubelet.slice/
    └── kubepods/
        ├── burstable/
        │   └── pod-<uid>/
        │       └── <container-id>/
        │           ├── memory.max    # From resources.limits.memory
        │           ├── cpu.max       # From resources.limits.cpu
        │           └── pids.max
        └── guaranteed/
            └── pod-<uid>/
                └── <container-id>/
```

The [[kubernetes-beginner-guide|Kubernetes resource model]] (requests and limits) maps directly to cgroup settings.

## Practical Examples

### Example 1: Diagnosing a Memory Leak with Cgroup Data

A researcher reports that their 24-hour simulation is being killed at the 18-hour mark. Use cgroup data to diagnose:

```bash
# Check the job's peak memory usage
sacct -j 789012 --format=JobID,MaxRSS,ReqMem,State,Elapsed
```

**Expected output:**
```
JobID            MaxRSS     ReqMem      State    Elapsed
------------ ---------- ---------- ---------- ----------
789012          63500MB      64Gn  OUT_OF_ME+   18:23:45
789012.0        63500MB      64Gn  OUT_OF_ME+   18:23:45
```

The job used almost exactly its 64GB allocation. Now look at memory growth over time using cgroup accounting data from Slurm:

```bash
# Query the accounting database for memory usage over time
sacct -j 789012 --format=JobID,MaxRSS,AvgRSS,Elapsed \
  --starttime=now-1day
```

**Remediation options:**

1. **Increase memory:** `--mem=96G` (if the node supports it)
2. **Fix the leak:** Profile with `valgrind` or Python's `tracemalloc`
3. **Checkpoint:** Add periodic checkpointing so the job can restart after OOM

### Example 2: Optimizing MPI Job Layout with Cpuset Analysis

For an MPI application running across multiple NUMA domains, improper CPU binding can cause a 30-50% performance degradation:

```bash
# Submit with explicit NUMA-aware binding
sbatch << 'EOF'
#!/bin/bash
#SBATCH --nodes=1
#SBATCH --ntasks=4
#SBATCH --cpus-per-task=8
#SBATCH --mem=128G
#SBATCH --hint=nomultithread
#SBATCH --distribution=block:block

# Verify CPU binding
srun bash -c '
  echo "Rank $SLURM_PROCID:"
  echo "  PID: $$"
  echo "  CPUs: $(cat /proc/self/status | grep Cpus_allowed_list)"
  echo "  NUMA: $(numactl --show | grep membind)"
'
EOF
```

**Expected output:**
```
Rank 0:
  PID: 12345
  CPUs: Cpus_allowed_list: 0-7
  NUMA: membind: 0
Rank 1:
  PID: 12346
  CPUs: Cpus_allowed_list: 8-15
  NUMA: membind: 0
Rank 2:
  PID: 12347
  CPUs: Cpus_allowed_list: 32-39
  NUMA: membind: 1
Rank 3:
  PID: 12348
  CPUs: Cpus_allowed_list: 40-47
  NUMA: membind: 1
```

Each MPI rank gets 8 cores, and ranks are distributed evenly across NUMA domains.

### Example 3: Implementing Login Node Protection

HPC login nodes are shared resources. Without cgroup limits, a single user compiling code can overwhelm the node. Here is how to protect login nodes:

```bash
# /etc/systemd/system/user-.slice.d/50-hpc-limits.conf
[Slice]
MemoryMax=8G
MemoryHigh=6G
CPUQuota=400%
TasksMax=512
IOWeight=50
```

This configuration (applied through systemd slice overrides) limits each user to:
- 8GB memory hard limit, throttling at 6GB
- 4 CPU cores equivalent
- 512 processes maximum
- Reduced I/O priority

Reload and apply:

```bash
systemctl daemon-reload
# Limits apply to new user sessions automatically
```

### Example 4: Complete Production cgroup.conf for HPC

Here is a battle-tested configuration used on a large HPC cluster:

```ini
# /etc/slurm/cgroup.conf
# Production HPC cgroup configuration

# Auto-detect cgroup version
CgroupPlugin=autodetect

# --- CPU ---
# Pin tasks to allocated cores (prevents migration)
ConstrainCores=yes

# --- Memory ---
# Enforce memory limits strictly
ConstrainRAMSpace=yes

# Allow exactly 100% of allocated RAM
AllowedRAMSpace=100

# No swap — swap destroys HPC performance
ConstrainSwapSpace=yes
AllowedSwapSpace=0

# --- Devices ---
# Restrict GPU/device access to allocated devices
ConstrainDevices=yes

# --- Systemd ---
# Use systemd but fall back gracefully
IgnoreSystemd=no
IgnoreSystemdOnFailure=yes

# --- Additional Controllers ---
# Enable I/O and PID controllers
EnableControllers=io,pids

# Signal on memory limit violation
# Using SIGTERM allows graceful shutdown for some applications
# Default is SIGKILL (9) — uncomment if your apps handle SIGTERM
# MemoryLimitEnforcement=SIGTERM
```

And the corresponding `slurm.conf` excerpt:

```ini
# /etc/slurm/slurm.conf (cgroup-related settings)

# Core cgroup plugin
CgroupPlugin=autodetect

# Task plugin stack — cgroup for resource binding, affinity for CPU binding
TaskPlugin=task/cgroup,task/affinity

# Process tracking via cgroups (catches all child processes)
ProctrackType=proctrack/cgroup

# Job accounting via cgroups (accurate, low overhead)
JobAcctGatherType=jobacct_gather/cgroup
JobAcctGatherFrequency=task=30

# Kill entire cgroup tree on job cancellation
KillOnBadExit=1

# Propagate resource limits to job steps
PropagateResourceLimitsExcept=MEMLOCK
```

### Example 5: Debugging Cgroup Configuration Issues

When jobs fail to start with cgroup errors, systematic debugging is required:

```bash
# 1. Check slurmstepd logs for cgroup errors
journalctl -u slurmstepd -n 50 | grep -i cgroup

# 2. Verify the cgroup filesystem
mount | grep cgroup
stat -fc %T /sys/fs/cgroup/

# 3. Check if Slurm can create cgroups
ls -la /sys/fs/cgroup/system.slice/slurmstepd.scope/

# 4. Check controller availability
cat /sys/fs/cgroup/cgroup.controllers
cat /sys/fs/cgroup/system.slice/cgroup.subtree_control

# 5. Verify systemd scope for Slurm
systemctl status slurmstepd.scope
systemd-cgls --no-pager | grep -A5 slurm

# 6. Check for conflicting cgroup managers
# Docker, Kubernetes, and Slurm can conflict
ps aux | grep -E "dockerd|containerd|kubelet|slurmstepd"

# 7. Test cgroup creation manually
mkdir /sys/fs/cgroup/system.slice/slurmstepd.scope/test_cgroup
echo "+cpu +memory +pids" > /sys/fs/cgroup/system.slice/slurmstepd.scope/cgroup.subtree_control
rmdir /sys/fs/cgroup/system.slice/slurmstepd.scope/test_cgroup
```

## Hands-On Exercises

### Exercise 1: Create a Custom Cgroup Hierarchy (Requires Root)

Build a cgroup hierarchy that mimics what Slurm creates:

```bash
# Create a test hierarchy
TEST_ROOT="/sys/fs/cgroup/test_hpc"
mkdir $TEST_ROOT

# Enable controllers
echo "+cpu +cpuset +memory +pids" > /sys/fs/cgroup/cgroup.subtree_control

# Create job and task cgroups
mkdir -p $TEST_ROOT/job_001/step_0/task_0
mkdir -p $TEST_ROOT/job_001/step_0/task_1

# Enable controllers at each level
echo "+cpu +cpuset +memory +pids" > $TEST_ROOT/cgroup.subtree_control
echo "+cpu +cpuset +memory +pids" > $TEST_ROOT/job_001/cgroup.subtree_control
echo "+cpu +cpuset +memory +pids" > $TEST_ROOT/job_001/step_0/cgroup.subtree_control

# Set memory limit for the job (2GB)
echo 2147483648 > $TEST_ROOT/job_001/memory.max

# Set cpuset for each task
echo "0" > $TEST_ROOT/job_001/step_0/task_0/cpuset.cpus
echo "0" > $TEST_ROOT/job_001/step_0/task_0/cpuset.mems
echo "1" > $TEST_ROOT/job_001/step_0/task_1/cpuset.cpus
echo "0" > $TEST_ROOT/job_001/step_0/task_1/cpuset.mems

# Move a process into the cgroup
echo $$ > $TEST_ROOT/job_001/step_0/task_0/cgroup.procs

# Verify
cat /proc/self/cgroup
cat $TEST_ROOT/job_001/memory.max
cat $TEST_ROOT/job_001/step_0/task_0/cpuset.cpus

# Cleanup — move process back to root first
echo $$ > /sys/fs/cgroup/cgroup.procs
rmdir $TEST_ROOT/job_001/step_0/task_0
rmdir $TEST_ROOT/job_001/step_0/task_1
rmdir $TEST_ROOT/job_001/step_0
rmdir $TEST_ROOT/job_001
rmdir $TEST_ROOT
```

### Exercise 2: Memory Pressure Monitoring

Write a script that monitors memory pressure for all running Slurm jobs and alerts when any job exceeds a threshold:

```bash
#!/bin/bash
# alert_memory_pressure.sh
# Monitors memory pressure for all Slurm jobs on this node

THRESHOLD=5.0  # Alert when avg10 > 5%

while true; do
    for job_dir in /sys/fs/cgroup/system.slice/slurmstepd.scope/job_*/; do
        if [ -f "$job_dir/memory.pressure" ]; then
            JOBID=$(basename $job_dir | sed 's/job_//')
            PRESSURE=$(grep "^some" $job_dir/memory.pressure | \
                       awk '{print $2}' | sed 's/avg10=//')

            if (( $(echo "$PRESSURE > $THRESHOLD" | bc -l) )); then
                MEM_CUR=$(cat $job_dir/memory.current)
                MEM_MAX=$(cat $job_dir/memory.max)
                PCT=$(echo "scale=1; $MEM_CUR * 100 / $MEM_MAX" | bc)
                echo "[$(date)] WARNING: Job $JOBID memory pressure=${PRESSURE}% \
usage=${PCT}% of limit"
            fi
        fi
    done
    sleep 10
done
```

### Exercise 3: Cgroup Accounting Comparison

Compare job accounting accuracy between `jobacct_gather/cgroup` and `jobacct_gather/linux`:

1. Submit the same job twice — once with each accounting method (requires admin to toggle)
2. Compare `MaxRSS`, `AveCPU`, and `MaxDiskRead` from `sacct`
3. The cgroup method should be more accurate because it tracks the entire cgroup tree, including all child processes, forks, and threads

### Exercise 4: Container Cgroup Analysis

Run a container inside a Slurm job and trace the cgroup hierarchy:

```bash
sbatch << 'EOF'
#!/bin/bash
#SBATCH --mem=8G
#SBATCH --cpus-per-task=4

# Show Slurm's cgroup
echo "=== Slurm job cgroup ==="
cat /proc/self/cgroup

# Run Apptainer container
apptainer exec docker://ubuntu:22.04 bash -c '
    echo "=== Inside container ==="
    cat /proc/self/cgroup
    echo ""
    echo "Available memory (from cgroup):"
    cat /sys/fs/cgroup/memory.max 2>/dev/null || echo "Not visible"
'
EOF
```

## Troubleshooting

### Slurm Cannot Create Cgroups

**Symptom:** Jobs fail with `error: Unable to create cgroup` in slurmstepd logs.

**Diagnosis:**
```bash
# Check if cgroup filesystem is mounted
mount | grep cgroup

# Check permissions on the cgroup directory
ls -la /sys/fs/cgroup/system.slice/

# Check if systemd scope exists
systemctl status slurmstepd.scope
```

**Solution:** Ensure systemd is creating the Slurm scope correctly:
```bash
# Check slurmd service file
systemctl cat slurmd.service | grep -i delegate

# If Delegate=yes is missing, create an override
systemctl edit slurmd.service
# Add:
# [Service]
# Delegate=yes
```

### Memory Limits Not Being Enforced

**Symptom:** Jobs exceed their `--mem` allocation without being killed.

**Diagnosis:**
```bash
# Verify ConstrainRAMSpace is set
grep ConstrainRAMSpace /etc/slurm/cgroup.conf

# Check the actual cgroup limit
find /sys/fs/cgroup -path "*job_${JOBID}*" -name memory.max -exec cat {} \;
```

**Solution:** Ensure `cgroup.conf` contains:
```ini
ConstrainRAMSpace=yes
AllowedRAMSpace=100
```

Then restart slurmd on all compute nodes:
```bash
scontrol reconfigure
```

### CPUs Not Being Pinned

**Symptom:** MPI processes migrate between cores, causing inconsistent performance.

**Diagnosis:**
```bash
# Check if cpuset controller is enabled
cat /sys/fs/cgroup/cgroup.subtree_control | grep cpuset

# Check job's cpuset
find /sys/fs/cgroup -path "*job_${JOBID}*" -name cpuset.cpus -exec cat {} \;
```

**Solution:** Ensure both cgroup and affinity task plugins are loaded:
```ini
# slurm.conf
TaskPlugin=task/cgroup,task/affinity

# cgroup.conf
ConstrainCores=yes
```

### Cgroup/v1 and v2 Hybrid Mode Problems

**Symptom:** Some controllers work but others do not. `mount` shows both `cgroup` and `cgroup2` filesystems.

**Diagnosis:**
```bash
# Check for hybrid mode
mount | grep cgroup
cat /proc/cgroups
```

**Solution:** Hybrid mode (some controllers on v1, others on v2) causes confusion. Pick one version:
```bash
# Force pure v2 via kernel parameter
# /etc/default/grub
GRUB_CMDLINE_LINUX="systemd.unified_cgroup_hierarchy=1"
grub2-mkconfig -o /boot/grub2/grub.cfg
# Reboot required
```

### Jobs Failing After OS Upgrade

**Symptom:** After upgrading from RHEL 8 to RHEL 9, Slurm jobs fail with cgroup errors.

**Cause:** RHEL 9 defaults to cgroups v2 while RHEL 8 defaulted to v1.

**Solution:**
```bash
# Update Slurm to detect the change
grep CgroupPlugin /etc/slurm/cgroup.conf
# Should be: CgroupPlugin=autodetect

# If using v1-specific paths in scripts, update them
# v1: /sys/fs/cgroup/memory/slurm/job_X/memory.limit_in_bytes
# v2: /sys/fs/cgroup/system.slice/slurmstepd.scope/job_X/memory.max
```

## References

- [Linux Kernel cgroups v2 Documentation](https://docs.kernel.org/admin-guide/cgroup-v2.html) — authoritative kernel reference for v2 architecture
- [cgroups(7) Linux Manual Page](https://www.man7.org/linux/man-pages/man7/cgroups.7.html) — comprehensive man page covering both v1 and v2
- [Slurm: Control Group in Slurm](https://slurm.schedmd.com/cgroups.html) — Slurm's cgroup integration overview
- [Slurm: cgroup/v2 Plugin](https://slurm.schedmd.com/cgroup_v2.html) — v2-specific setup and requirements
- [Slurm: cgroup.conf Reference](https://slurm.schedmd.com/cgroup.conf.html) — all cgroup.conf parameters
- [Red Hat: Migrating from Cgroups V1 to V2](https://access.redhat.com/articles/3735611) — enterprise migration guide
- [Rocky Linux: Migrating cgroups v1 to v2](https://docs.rockylinux.org/10/guides/migrating_cgroup_v1_to_v2/) — step-by-step migration on Rocky
- [cgroupv2 FOSDEM Talk by Chris Down](https://chrisdown.name/talks/cgroupv2/cgroupv2-fosdem.pdf) — excellent technical deep dive
- [HPC Sysadmin Basics: cgroups](https://hpc-syspros-basics.github.io/Advanced_Topics/Login_Node_Resource_Management/cgroups.html) — HPC-focused cgroup usage
- [SingularityCE: Limiting Container Resources](https://docs.sylabs.io/guides/4.2/user-guide/cgroups.html) — Apptainer/Singularity cgroup integration
- [Kubernetes: About cgroup v2](https://kubernetes.io/docs/concepts/architecture/cgroups/) — Kubernetes cgroup v2 support
- [Pitt CRC: cgroup-based Resource Management](https://crc.pitt.edu/news/crc-implements-cgroup-based-resource-management) — real-world HPC cluster implementation

## Related Tutorials

- [[cgroups-beginner-guide|Cgroups Beginner Guide]] — foundational cgroup concepts and basic inspection
- [[docker-test-container-beginner-guide|Docker Test Container Beginner Guide]] — Docker uses cgroups for container resource limits
- [[docker-test-container-deep-dive|Docker Test Container Deep Dive]] — advanced Docker resource management and cgroup interaction
- [[linux-permissions-beginner-guide|Linux Permissions Beginner Guide]] — Linux fundamentals including file permissions
- [[linux-permissions-deep-dive|Linux Permissions Deep Dive]] — advanced Linux security, DAC, MAC, and capabilities
- [[kubernetes-beginner-guide|Kubernetes Beginner Guide]] — Kubernetes pod resource model built on cgroups
- [[kubernetes-deep-dive|Kubernetes Deep Dive]] — Kubernetes QoS classes, resource quotas, and cgroup integration
- [[isaaclab-metagrasp-apptainer-hpc-beginner-guide|IsaacLab Apptainer HPC Guide]] — running Apptainer containers on HPC with Slurm cgroup isolation
- [[isaaclab-metagrasp-apptainer-hpc-deep-dive|IsaacLab Apptainer HPC Deep Dive]] — advanced Apptainer and Slurm integration
- [[hyperqueue-basics|HyperQueue Basics]] — HPC job scheduling alternative to Slurm
- [[hyperqueue-deep-dive|HyperQueue Deep Dive]] — advanced HyperQueue with cgroup-aware task management
- [[parsl-beginner-guide|Parsl Beginner Guide]] — parallel computing on HPC clusters
- [[parsl-deep-dive|Parsl Deep Dive]] — advanced parallel execution and resource management
- [[pixi-beginner-guide|Pixi Beginner Guide]] — Python environment management for HPC workflows

## Summary

Cgroups are a sophisticated kernel subsystem that forms the foundation of resource isolation in modern HPC environments. This deep dive covered:

**Architecture:**
- Cgroups v2's unified hierarchy eliminates the complexity of v1's multiple trees
- The no-internal-process constraint and top-down resource distribution model provide predictable behavior
- Controllers (cpu, cpuset, memory, io, pids, hugetlb, rdma) each manage a specific resource type

**Slurm Integration:**
- Three plugins work together: `cgroup/v2` for hierarchy management, `task/cgroup` for task binding, and `jobacct_gather/cgroup` for accurate accounting
- `cgroup.conf` controls memory enforcement (`ConstrainRAMSpace`), CPU pinning (`ConstrainCores`), and device isolation (`ConstrainDevices`)
- Memory enforcement uses a two-tier model: `memory.high` for throttling and `memory.max` for OOM kills

**Container Runtimes:**
- Docker creates its own cgroup subtree under `system.slice`
- Apptainer inherits the Slurm job's cgroup, making it the natural choice for HPC
- Kubernetes maps its resource model (requests/limits) directly to cgroup settings

**Operational Best Practices:**
- Always use `CgroupPlugin=autodetect` for forward compatibility
- Set `AllowedSwapSpace=0` on HPC nodes — swap destroys performance
- Monitor memory pressure (PSI) to catch jobs approaching their limits before OOM
- Use `proctrack/cgroup` for reliable process tracking that catches all child processes
- Enable `Delegate=yes` in Slurm's systemd unit for proper cgroup delegation

For foundational concepts, refer back to the [[cgroups-beginner-guide|Cgroups Beginner Guide]].
