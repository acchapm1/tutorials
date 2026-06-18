---
title: "Linux Cgroups Beginner Guide: Resource Management for HPC"
date: 2026-05-21
difficulty: beginner
tags:
  - linux
  - cgroups
  - hpc
  - slurm
  - resource-management
  - containers
---

# Linux Cgroups Beginner Guide: Resource Management for HPC

## Overview

Control Groups (cgroups) are a Linux kernel feature that allows you to allocate, limit, and monitor system resources — CPU, memory, I/O, and more — for groups of processes. If you work on an HPC cluster, cgroups are almost certainly running behind the scenes every time you submit a job through [[hyperqueue-basics|HyperQueue]] or Slurm.

**Why should you care?** On a shared HPC cluster, one runaway job can consume all memory on a node and crash every other job running there. Cgroups prevent this by enforcing hard resource boundaries. When your Slurm job requests 4 CPUs and 16GB of RAM, it is cgroups that ensure your job cannot exceed those limits — and that other jobs on the same node cannot steal your allocation.

This guide focuses on **cgroups v2** (the modern unified hierarchy), with references to v1 where it helps you understand older systems. By the end, you will be able to inspect cgroups on a live system, understand how Slurm uses them, and diagnose common resource-related job failures.

### What You Will Learn

- What cgroups are and why HPC clusters depend on them
- The cgroup hierarchy and how controllers work
- How Slurm creates cgroups for every job and step
- How to inspect cgroup settings and diagnose OOM kills
- The difference between cgroups v1 and v2

## Prerequisites

Before starting this tutorial, you should have:

- **Basic Linux command-line skills** — navigating directories, reading files, running commands (see [[linux-permissions-beginner-guide|Linux Permissions Beginner Guide]] for fundamentals)
- **SSH access to an HPC cluster** running a modern Linux distribution (RHEL/Rocky 8+, Ubuntu 22.04+)
- **A Slurm account** with permission to submit jobs
- **Understanding of basic HPC concepts** — nodes, jobs, partitions (see [[hyperqueue-basics|HyperQueue Basics]] for job scheduling concepts)

No root access is needed for most inspection tasks. Some exercises that create cgroups require root or delegation permissions.

## Key Concepts

### What Is a Cgroup?

A cgroup (control group) is a kernel mechanism that organizes processes into hierarchical groups and applies resource constraints to those groups. Think of it as a folder that contains processes, where the folder itself has rules about how much CPU, memory, or I/O those processes can use.

### The Cgroup Hierarchy

Cgroups are organized in a tree structure, similar to a filesystem. Every process on the system belongs to exactly one cgroup. Here is what the hierarchy looks like on a typical HPC compute node running Slurm:

```
                        root (/)
                           |
              +------------+------------+
              |            |            |
          system.slice  user.slice  system.slice
              |                        |
         slurmstepd              other services
              |
     +--------+--------+
     |                  |
  job_123/           job_456/
     |                  |
  +--+--+           +--+--+
  |     |           |     |
step0  step1      step0  step1
  |                 |
tasks             tasks
(your             (other
 processes)        user's
                   processes)
```

Each level in the tree can have resource limits. A child cgroup cannot exceed the limits of its parent.

### Controllers

Controllers are the kernel subsystems that actually enforce resource limits. Each controller manages one type of resource:

| Controller | What It Controls | HPC Use Case |
|-----------|-----------------|--------------|
| `cpu` | CPU time allocation | Preventing jobs from stealing CPU cycles |
| `cpuset` | CPU core and NUMA node pinning | Binding MPI ranks to specific cores |
| `memory` | RAM and swap limits | Enforcing `--mem` requests in Slurm |
| `io` | Disk I/O bandwidth | Preventing I/O-heavy jobs from starving others |
| `pids` | Number of processes/threads | Preventing fork bombs |
| `hugetlb` | Huge page allocation | Managing large-page memory for scientific apps |
| `rdma` | RDMA/InfiniBand resources | HPC network resource isolation |

### Cgroups v1 vs v2: A Brief Comparison

Most modern HPC clusters are migrating to cgroups v2. Here is why:

| Feature | v1 | v2 |
|---------|----|----|
| Hierarchy | Multiple separate trees (one per controller) | Single unified tree |
| Controller mounting | Each controller mounted separately | All controllers in one hierarchy |
| Process placement | Processes anywhere in the tree | Processes only at leaf nodes |
| Resource distribution | Inconsistent across controllers | Uniform pressure-based model |
| Slurm support | `cgroup/v1` plugin (deprecated) | `cgroup/v2` plugin (recommended) |

**Key takeaway:** cgroups v2 simplifies everything by putting all controllers in a single hierarchy. If you see paths like `/sys/fs/cgroup/memory/` and `/sys/fs/cgroup/cpu/` as separate mount points, that is v1. If you see a single `/sys/fs/cgroup/` with everything combined, that is v2.

## Step-by-Step Instructions

### Step 1: Check Which Cgroup Version Your Cluster Uses

```bash
# Check the cgroup version
stat -fc %T /sys/fs/cgroup/
```

**Expected output for cgroups v2:**
```
cgroup2fs
```

**Expected output for cgroups v1:**
```
tmpfs
```

You can also check the mount points:

```bash
mount | grep cgroup
```

**Cgroups v2 output:**
```
cgroup2 on /sys/fs/cgroup type cgroup2 (rw,nosuid,nodev,noexec,relatime)
```

**Cgroups v1 output (multiple lines):**
```
cgroup on /sys/fs/cgroup/memory type cgroup (rw,nosuid,nodev,noexec,relatime,memory)
cgroup on /sys/fs/cgroup/cpu,cpuacct type cgroup (rw,nosuid,nodev,noexec,relatime,cpu,cpuacct)
cgroup on /sys/fs/cgroup/cpuset type cgroup (rw,nosuid,nodev,noexec,relatime,cpuset)
```

### Step 2: Explore the Cgroup Filesystem

On a cgroups v2 system, browse the hierarchy:

```bash
# List the top-level cgroup directory
ls /sys/fs/cgroup/
```

**Expected output:**
```
cgroup.controllers      cgroup.stat             io.stat
cgroup.max.depth        cgroup.subtree_control  memory.current
cgroup.max.descendants  cgroup.threads          memory.stat
cgroup.procs            cpu.stat                system.slice/
cgroup.pressure         init.scope/             user.slice/
```

### Step 3: Find Your Process in the Cgroup Tree

Every process belongs to a cgroup. Find yours:

```bash
# See which cgroup your current shell belongs to
cat /proc/self/cgroup
```

**Expected output (v2):**
```
0::/user.slice/user-1000.slice/session-42.scope
```

**Expected output (v1 — multiple lines, one per controller):**
```
12:memory:/user.slice/user-1000.slice
11:cpuset:/
10:cpu,cpuacct:/user.slice/user-1000.slice
...
```

### Step 4: Inspect a Running Slurm Job's Cgroups

When Slurm runs your job, it creates a cgroup for it. Submit a test job and inspect its cgroup:

```bash
# Submit a simple job that sleeps so you can inspect it
sbatch --job-name=cgroup-test --ntasks=1 --cpus-per-task=2 --mem=4G --time=00:10:00 --wrap="sleep 600"
```

**Expected output:**
```
Submitted batch job 123456
```

Now SSH to the compute node where the job is running and inspect:

```bash
# Find which node the job is on
squeue -u $USER -o "%.8i %.8j %.4T %.10M %.6D %R"
```

**Expected output:**
```
  JOBID     NAME   ST       TIME  NODES NODELIST
 123456 cgroup-t    R       0:05      1 node001
```

```bash
# SSH to the node and find the job's cgroup (requires node access)
ssh node001
find /sys/fs/cgroup -name "job_123456" -type d 2>/dev/null
```

**Expected output (v2, systemd-based):**
```
/sys/fs/cgroup/system.slice/slurmstepd.scope/job_123456
```

### Step 5: Read Cgroup Resource Limits

Once you find the job's cgroup directory, inspect its limits:

```bash
JOB_CGROUP="/sys/fs/cgroup/system.slice/slurmstepd.scope/job_123456"

# Memory limit (in bytes)
cat $JOB_CGROUP/memory.max
```

**Expected output:**
```
4294967296
```

That is 4GB (4 * 1024^3), matching the `--mem=4G` we requested.

```bash
# Current memory usage
cat $JOB_CGROUP/memory.current
```

**Expected output:**
```
8192000
```

```bash
# CPU set — which cores the job can use
cat $JOB_CGROUP/cpuset.cpus
```

**Expected output:**
```
0-1
```

This shows the job is pinned to cores 0 and 1, matching `--cpus-per-task=2`.

```bash
# Number of processes in this cgroup
cat $JOB_CGROUP/pids.current
```

**Expected output:**
```
3
```

### Step 6: Check Available Controllers

See which controllers are available and active:

```bash
# Available controllers at the root
cat /sys/fs/cgroup/cgroup.controllers
```

**Expected output:**
```
cpuset cpu io memory hugetlb pids rdma misc
```

```bash
# Controllers enabled for child cgroups
cat /sys/fs/cgroup/cgroup.subtree_control
```

**Expected output:**
```
cpuset cpu io memory pids
```

## Practical Examples

### Example 1: Understanding an OOM-Killed Job

One of the most common HPC issues is a job being killed for exceeding its memory limit. Here is what happens behind the scenes:

```bash
# Submit a job that requests 2GB but tries to use more
sbatch --mem=2G --wrap="python3 -c \"
import numpy as np
# Allocate a 3GB array — more than our 2GB limit
arr = np.zeros((3 * 1024**3 // 8,), dtype=np.float64)
print('This will never print')
\""
```

Check the job's exit status:

```bash
sacct -j <JOBID> --format=JobID,State,ExitCode,MaxRSS
```

**Expected output:**
```
JobID           State  ExitCode     MaxRSS
------------ ---------- -------- ----------
123457       OUT_OF_ME+    0:137
123457.batch OUT_OF_ME+    0:137   2048576K
```

The exit code 137 means the process was killed by signal 9 (SIGKILL) — the kernel's OOM killer, enforced by the memory cgroup.

To confirm, check the kernel log on the compute node:

```bash
dmesg | grep -i "oom\|killed process" | tail -5
```

**Expected output:**
```
[12345.678] memory: usage 2097152kB, limit 2097152kB, failcnt 42
[12345.679] oom-kill: constraint=CONSTRAINT_MEMCG ...
[12345.680] Killed process 54321 (python3) total-vm:3145728kB ...
```

### Example 2: Checking CPU Pinning for MPI Jobs

When running parallel jobs, CPU pinning via the cpuset controller prevents processes from migrating between cores, which is critical for performance:

```bash
# Submit a 4-task MPI job
sbatch --ntasks=4 --cpus-per-task=1 --wrap="srun hostname"
```

On the compute node, inspect each step's cpuset:

```bash
JOB_DIR="/sys/fs/cgroup/system.slice/slurmstepd.scope/job_123458"
for step in $JOB_DIR/step_*/; do
    echo "$(basename $step): cpus=$(cat $step/cpuset.cpus)"
done
```

**Expected output:**
```
step_0: cpus=0
step_1: cpus=1
step_2: cpus=2
step_3: cpus=3
```

Each MPI rank is pinned to a separate core, preventing contention.

### Example 3: Monitoring Real-Time Resource Usage

You can monitor a job's resource consumption in real time through cgroups:

```bash
# Watch memory usage of a running job (run on the compute node)
JOB_CGROUP="/sys/fs/cgroup/system.slice/slurmstepd.scope/job_123456"
watch -n 1 "echo 'Memory: '$(cat $JOB_CGROUP/memory.current) '/'\
 $(cat $JOB_CGROUP/memory.max) 'bytes'; \
 echo 'CPU usage:'; cat $JOB_CGROUP/cpu.stat | head -3"
```

**Expected output (updates every second):**
```
Memory: 1073741824 / 4294967296 bytes
CPU usage:
usage_usec 5432100
user_usec 5000000
system_usec 432100
```

## Hands-On Exercises

### Exercise 1: Cgroup Version Discovery

**Goal:** Determine the cgroup version on your cluster's compute nodes.

1. Submit a job: `srun --pty bash`
2. Run `stat -fc %T /sys/fs/cgroup/`
3. Run `cat /proc/self/cgroup`
4. Note whether you see a single line (v2) or multiple lines (v1)
5. Check the Slurm configuration: `scontrol show config | grep -i cgroup`

**Expected findings:** You should see `CgroupPlugin = cgroup/v2` (or `autodetect`) and a unified hierarchy.

### Exercise 2: Memory Limit Exploration

**Goal:** Understand how Slurm translates `--mem` to cgroup limits.

1. Submit a job with a specific memory request:
   ```bash
   srun --mem=8G --pty bash
   ```
2. Find your job's cgroup:
   ```bash
   cat /proc/self/cgroup
   ```
3. Navigate to that cgroup directory and check:
   ```bash
   CGROUP_PATH=$(cat /proc/self/cgroup | cut -d: -f3)
   cat /sys/fs/cgroup${CGROUP_PATH}/memory.max
   ```
4. Convert the value from bytes to GB. Does it match your request?
5. Monitor your memory usage:
   ```bash
   cat /sys/fs/cgroup${CGROUP_PATH}/memory.current
   ```

### Exercise 3: Trigger and Diagnose an OOM Kill

**Goal:** Intentionally exceed a memory limit and observe the cgroup enforcement.

1. Submit a job with a small memory limit:
   ```bash
   sbatch --mem=512M --wrap="python3 -c \"
   data = []
   for i in range(1000):
       data.append(bytearray(1024*1024))  # 1MB per iteration
       if i % 100 == 0:
           print(f'Allocated {i} MB')
   \""
   ```
2. Wait for the job to finish, then check:
   ```bash
   sacct -j <JOBID> --format=JobID,State,ExitCode,MaxRSS,ReqMem
   ```
3. What exit code do you see? What state?

### Exercise 4: Compare Requested vs. Used Resources

**Goal:** Learn to use `sacct` and cgroup data to identify inefficient jobs.

```bash
# Check your recent jobs' efficiency
sacct --starttime=$(date -d '7 days ago' +%Y-%m-%d) \
  --format=JobID,JobName,ReqMem,MaxRSS,ReqCPUS,CPUTime,State \
  -u $USER
```

Look for jobs where `MaxRSS` is much less than `ReqMem` — these are wasting allocated resources that could be used by other users.

## Troubleshooting

### Job Killed with Exit Code 137 (OOM Kill)

**Symptom:** Job state shows `OUT_OF_MEMORY`, exit code is `0:137`.

**Cause:** Your job exceeded its memory cgroup limit.

**Solution:**
```bash
# Check how much memory the job actually needed
sacct -j <JOBID> --format=MaxRSS

# Resubmit with more memory (add 20% buffer)
sbatch --mem=12G your_script.sh
```

### Job Cannot See All GPUs

**Symptom:** Your job only sees 1 GPU even though the node has 4.

**Cause:** The devices controller in cgroups restricts GPU visibility to match your `--gres=gpu:N` request.

**Solution:** This is expected behavior. Request the number of GPUs you need:
```bash
sbatch --gres=gpu:2 your_gpu_script.sh
```

### "Cannot write to cgroup" Errors

**Symptom:** Slurm logs show errors about writing to cgroup files.

**Cause:** The cgroup filesystem is not properly configured or systemd is not delegating correctly.

**Solution (for admins):**
```bash
# Check if the cgroup filesystem is mounted
mount | grep cgroup2

# Verify Slurm's cgroup configuration
scontrol show config | grep -i cgroup
```

### Job Uses More CPUs Than Requested

**Symptom:** Your job's processes spread across more cores than you requested.

**Cause:** The `cpuset` controller may not be enabled, or `ConstrainCores` is not set in `cgroup.conf`.

**Solution (for admins):** Ensure `cgroup.conf` contains:
```ini
ConstrainCores=yes
```

### Checking Slurm's Cgroup Configuration

To see how your cluster's Slurm is configured for cgroups:

```bash
# View the cgroup-related configuration
scontrol show config | grep -i cgroup
```

**Expected output:**
```
CgroupPlugin            = autodetect
```

```bash
# View the cgroup.conf file (if you have access)
cat /etc/slurm/cgroup.conf
```

**Expected output:**
```
CgroupPlugin=autodetect
ConstrainCores=yes
ConstrainRAMSpace=yes
ConstrainSwapSpace=yes
AllowedRAMSpace=100
AllowedSwapSpace=0
```

## References

- [Linux Kernel cgroups v2 Documentation](https://docs.kernel.org/admin-guide/cgroup-v2.html) — the definitive kernel reference
- [cgroups(7) man page](https://www.man7.org/linux/man-pages/man7/cgroups.7.html) — Linux manual page covering both v1 and v2
- [Slurm Control Group Documentation](https://slurm.schedmd.com/cgroups.html) — how Slurm integrates with cgroups
- [Slurm cgroup/v2 Plugin](https://slurm.schedmd.com/cgroup_v2.html) — v2-specific configuration
- [Slurm cgroup.conf Reference](https://slurm.schedmd.com/cgroup.conf.html) — configuration file documentation
- [Rocky Linux: Migrating cgroups v1 to v2](https://docs.rockylinux.org/10/guides/migrating_cgroup_v1_to_v2/) — practical migration guide
- [Red Hat: cgroups v2 in RHEL 8](https://www.redhat.com/en/blog/world-domination-cgroups-rhel-8-welcome-cgroups-v2) — enterprise perspective
- [HPC Sysadmin Basics: cgroups](https://hpc-syspros-basics.github.io/Advanced_Topics/Login_Node_Resource_Management/cgroups.html) — HPC-focused cgroup usage

## Related Tutorials

- [[cgroups-deep-dive|Cgroups Deep Dive]] — advanced cgroup internals, Slurm plugin configuration, and container integration
- [[docker-test-container-beginner-guide|Docker Test Container Beginner Guide]] — containers use cgroups for resource isolation
- [[docker-test-container-deep-dive|Docker Test Container Deep Dive]] — deeper look at container resource management
- [[linux-permissions-beginner-guide|Linux Permissions Beginner Guide]] — foundational Linux concepts
- [[linux-permissions-deep-dive|Linux Permissions Deep Dive]] — advanced Linux security mechanisms
- [[kubernetes-beginner-guide|Kubernetes Beginner Guide]] — Kubernetes uses cgroups for pod resource limits
- [[kubernetes-deep-dive|Kubernetes Deep Dive]] — Kubernetes resource management internals
- [[isaaclab-metagrasp-apptainer-hpc-beginner-guide|IsaacLab Apptainer HPC Guide]] — running containers on HPC with cgroup-managed resources
- [[hyperqueue-basics|HyperQueue Basics]] — alternative HPC job scheduling
- [[hyperqueue-deep-dive|HyperQueue Deep Dive]] — advanced HPC scheduling concepts
- [[parsl-beginner-guide|Parsl Beginner Guide]] — parallel computing on HPC clusters
- [[parsl-deep-dive|Parsl Deep Dive]] — advanced parallel execution patterns

## Summary

Cgroups are the invisible backbone of resource management on HPC clusters. Every time Slurm runs your job, it creates a cgroup that enforces the CPU, memory, and device limits you requested. Understanding cgroups helps you:

1. **Diagnose job failures** — OOM kills, CPU throttling, and device access issues all trace back to cgroup limits
2. **Right-size your resource requests** — inspect actual usage through cgroup accounting to avoid wasting cluster resources
3. **Understand isolation** — know why your job cannot see all GPUs or all memory on a node

Key points to remember:

- **Cgroups v2** uses a single unified hierarchy (check with `stat -fc %T /sys/fs/cgroup/`)
- **Slurm creates cgroups automatically** for every job, step, and task
- **Memory limits are hard** — exceeding `memory.max` triggers an OOM kill (exit code 137)
- **CPU pinning** via `cpuset` keeps your processes on their assigned cores
- **Inspect cgroups** through `/sys/fs/cgroup/` and `/proc/<PID>/cgroup`

For a deeper understanding of cgroup internals, Slurm plugin configuration, and container integration, continue to the [[cgroups-deep-dive|Cgroups Deep Dive]].
