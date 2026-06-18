---
title: "Setting Up Flux as a Production System Scheduler: Replacing Slurm"
date: 2026-06-01
difficulty: advanced
tags: [flux, hpc, slurm, system-administration, cluster-management, flux-security, job-scheduling]
---

# Setting Up Flux as a Production System Scheduler: Replacing Slurm

> **Tutorial 2 of 4** in the Flux Framework series
> **Previous:** [[flux-basics|Flux Basics]] | **Next:** [[flux-snakemake-workflows|Flux Snakemake Workflows]]
> **See also:** [[slurm-vs-flux-reference|Slurm vs Flux Reference]] · [[slurm-vs-flux-deep-dive|Slurm vs Flux Deep Dive]]

---

## Overview

This tutorial walks you through deploying Flux as a **system-level resource manager** — the full Slurm replacement path. By the end, you will have a working multi-user Flux system instance on a test cluster, with security configured, resources inventoried, queues defined, accounting enabled, and a non-root user submitting jobs.

Everything in [[flux-basics|Flux Basics]] ran Flux in user space inside a Slurm allocation — no admin privileges required, no daemons, no system configuration. That approach is the right starting point for evaluation. This tutorial is the next step: replacing `slurmctld`, `slurmd`, MUNGE, and `slurm.conf` with their Flux equivalents.

You will learn to:

1. Install Flux system-wide from OS packages or Spack.
2. Configure `flux-security` (IMP) for multi-user privilege separation.
3. Generate and distribute CURVE keys for broker authentication.
4. Write the resource inventory (JGF R file) for your cluster hardware.
5. Define queues, accounting banks, and system configuration in TOML.
6. Start the system instance via `systemd` and validate end-to-end.
7. Plan a phased migration from Slurm to Flux.

---

## Prerequisites

- **Root or sudo access** on head node and compute nodes (this is a system-level deployment).
- **Familiarity with Slurm administration** — you should know your way around `slurm.conf`, MUNGE key management, `slurmctld`/`slurmd` daemon lifecycle, and `sacctmgr`.
- **Completed or skimmed** [[flux-basics|Flux Basics]] — you understand `flux run`, `flux submit`, `flux jobs`, and the concept of a Flux instance.
- **Test cluster or VM environment** — two nodes minimum, four recommended. Do not run this on production without a rollback plan.
- A shared filesystem mounted on all nodes (e.g., NFS, Lustre, GPFS) for home directories and job I/O.

---

## Key Concepts

Before touching configuration files, make sure these four concepts are clear:

**System instance vs. user-space instance.** A user-space instance (`flux start` inside a Slurm allocation) is ephemeral — it exists for the duration of your job and manages only the resources Slurm gave you. A system instance is a persistent daemon (managed by `systemd`) that owns the entire cluster's resources and serves multiple users simultaneously. It is the direct replacement for `slurmctld` + `slurmd`.

**flux-security and the IMP model.** Slurm uses MUNGE for authentication — a shared-secret daemon on every node. Flux uses two mechanisms: ZeroMQ CURVE25519 keys for broker-to-broker encrypted communication, and `flux-imp` (the Instance Management Program), a small SETUID binary that lets the unprivileged broker launch jobs as other users. The broker itself never runs as root.

**TOML configuration.** Slurm's monolithic `slurm.conf` becomes a directory of focused TOML files under `/etc/flux/system/conf.d/`. Each file handles one concern — access control, resources, scheduling, execution, queues. Changes take effect on broker reload, not restart.

**JGF resource inventory.** Slurm discovers nodes via `slurmd` reporting back to `slurmctld`. Flux uses a static resource file (the "R" file) in JSON Graph Format that describes every node, core, GPU, and their topology. This is more explicit and more powerful — you define exactly what exists, including custom resource types.

---

## Step-by-Step Instructions

### System Instance vs. User-Space Instance

These are the two deployment modes for Flux. Tutorial 1 ([[flux-basics|Flux Basics]]) covers user-space exclusively. This tutorial is exclusively about the system instance.

| Aspect | User-Space Instance | System Instance |
|---|---|---|
| **Started by** | Any user (`flux start`) | Root via `systemd` |
| **Lifetime** | Duration of job/allocation | Persistent (survives reboots) |
| **Multi-user** | No — single user only | Yes — any user on the cluster |
| **Resources managed** | Only what the parent scheduler allocated | Entire cluster |
| **Privilege model** | None — runs as you | `flux-imp` SETUID for user switching |
| **Authentication** | Inherited from parent | CURVE keys + IMP |
| **Requires admin** | No | Yes — root/sudo on all nodes |
| **Slurm equivalent** | N/A (Slurm has no user-space mode) | `slurmctld` + `slurmd` |

The system instance runs a `flux-broker` on every node in the cluster. The broker on the head node is **rank 0** (the leader, analogous to `slurmctld`). Brokers on compute nodes are leaf ranks (analogous to `slurmd`). They form a tree-structured overlay network using ZeroMQ.

> ⚠️ **Warning:** Run this tutorial on a test cluster or dedicated VMs. Do not configure a system Flux instance on a production cluster without a tested rollback plan. If you are currently running Slurm, keep it intact and deploy Flux on separate nodes or a VLAN until you have validated the full stack.

### Component Overview

If you know Slurm administration, this table maps every component you manage today to its Flux equivalent:

| Slurm Component | Flux Equivalent | Notes |
|---|---|---|
| `slurmctld` | `flux-broker` (rank 0) | Root broker on head node; leader of the overlay tree |
| `slurmd` | `flux-broker` (leaf ranks) | One per compute node; joins the overlay network |
| MUNGE | `flux-security` + ZMQ CURVE keys | Different model — see IMP section below |
| `slurmdbd` + MySQL | `flux-accounting` + SQLite | Lighter weight; fewer moving parts |
| `slurm.conf` | `/etc/flux/system/conf.d/*.toml` | TOML, modular — one file per concern |
| `gres.conf` | JGF resource inventory (`R` file) | Graph-based; describes full topology |
| Partitions | Queues | Similar concept, configured in TOML |
| `sinfo` | `flux resource list` | Shows available resources and state |
| `squeue` | `flux jobs` | Lists active and pending jobs |
| `sacctmgr` | `flux account` | Bank and user management CLI |
| `scontrol` | `flux config`, `flux resource` | System administration commands |

> 📝 **Note:** Flux does not have a direct equivalent to `slurmctld` HA (backup controller). Flux broker rank 0 is a single point of failure in the current architecture. HA support is on the roadmap but not production-ready as of 2026. Plan your maintenance windows accordingly.

### Installation (System-Wide)

System packages are the recommended path for production. Flux provides official packages for major distributions.

**RHEL / Rocky Linux 8-9:**

```bash
# Enable the Flux COPR repository (Rocky/RHEL)
dnf copr enable flux-framework/flux
dnf install flux-core flux-sched flux-security flux-accounting

# Verify installation
flux --version
```

Expected output:

```
flux-core 0.68.0
```

**Ubuntu 22.04+ / Debian:**

```bash
# Add the Flux PPA
add-apt-repository ppa:flux-framework/flux
apt update
apt install flux-core flux-sched flux-security

# Verify installation
flux --version
```

**Spack (any distribution — for custom builds or bleeding edge):**

```bash
spack install flux-core +security flux-sched flux-accounting
spack load flux-core flux-sched flux-accounting

# Verify
flux --version
```

> 💡 **Tip:** Spack is useful when you need a specific version or build options (e.g., PMIx support, custom ZeroMQ). For production system instances, OS packages are easier to manage with configuration management tools (Ansible, Puppet, Salt).

**Verify `flux-imp` is SETUID:**

The IMP binary must be installed SETUID root. This is the most common missed step in system deployments.

```bash
ls -la $(which flux-imp)
```

Expected output:

```
-rwsr-xr-x 1 root root 245632 Jun  1 12:00 /usr/libexec/flux/flux-imp
```

The `s` in `-rwsr-xr-x` confirms the SETUID bit is set. If you see `-rwxr-xr-x` instead (no `s`), set it manually:

```bash
chmod u+s $(which flux-imp)
```

> ⚠️ **Warning:** Without the SETUID bit on `flux-imp`, multi-user job execution will fail with permission errors. The broker cannot switch to the submitting user's UID without it.

### flux-security: The IMP Model

This is the section most Slurm admins find unfamiliar. Slurm's security model is straightforward — MUNGE provides a shared symmetric key, every daemon validates credentials through it, and `slurmd` runs as root to launch jobs as users. Flux's model is architecturally different and worth understanding before you configure it.

**What IMP does.** The Instance Management Program (`flux-imp`) is a small SETUID helper binary. The `flux-broker` itself runs as an unprivileged user (typically the `flux` service account). When the broker needs to perform a privileged operation — primarily launching a job as a different user — it invokes `flux-imp`, which validates the request, switches to the target UID, and executes the job. The broker never runs as root.

**Contrast with MUNGE.** MUNGE is a cluster-wide shared secret — every node has the same key, and any process that can read the key can forge credentials. Flux replaces this with two mechanisms:

| Mechanism | Purpose | Slurm Equivalent |
|---|---|---|
| ZMQ CURVE25519 keys | Encrypt and authenticate broker-to-broker communication | MUNGE (host-to-host auth) |
| `flux-imp` (SETUID) | Privilege escalation for job launch as target user | `slurmd` running as root |
| Signed job requests | User-to-broker job submission authentication | MUNGE credential in `sbatch` |

**Step 1: Generate CURVE keys.**

Generate a ZMQ CURVE key pair on the head node. This is analogous to generating a MUNGE key, but uses public-key cryptography instead of a shared secret.

```bash
# Generate the key pair (creates a single file with public + secret key)
sudo flux keygen /etc/flux/system/curve.cert
sudo chmod 400 /etc/flux/system/curve.cert
sudo chown flux:flux /etc/flux/system/curve.cert
```

**Step 2: Distribute keys to all nodes.**

Every node in the cluster needs the same `curve.cert` file. Use your existing configuration management tool:

```bash
# Ansible example
ansible all -m copy -a "src=/etc/flux/system/curve.cert dest=/etc/flux/system/curve.cert owner=flux group=flux mode=0400"

# Or pdsh for a quick push
pdsh -w node[00-127] 'mkdir -p /etc/flux/system'
pdcp -w node[00-127] /etc/flux/system/curve.cert /etc/flux/system/curve.cert
pdsh -w node[00-127] 'chmod 400 /etc/flux/system/curve.cert && chown flux:flux /etc/flux/system/curve.cert'
```

> 📝 **Note:** Unlike MUNGE, which requires a running `munged` daemon on every node, Flux's CURVE keys are passive files read at broker startup. There is no key daemon to manage or monitor.

**Step 3: Configure IMP.**

Create the IMP configuration file:

```bash
sudo mkdir -p /etc/flux/security/conf.d
sudo vim /etc/flux/security/conf.d/imp.toml
```

Minimal `/etc/flux/security/conf.d/imp.toml`:

```toml
# /etc/flux/security/conf.d/imp.toml
# Minimal IMP configuration for multi-user system instance

[exec]
# Allow the flux-imp binary to execute jobs as other users.
# The "allowed-users" list specifies which UIDs can invoke flux-imp.
# Typically this is the flux service account that runs the broker.
allowed-users = [ "flux" ]

# Path to the shell that wraps user job execution.
# flux-imp exec invokes this to set up the job environment.
allowed-shells = [ "/usr/libexec/flux/flux-shell" ]
```

**Step 4: Verify the IMP configuration.**

```bash
# Check that flux-imp can parse its configuration
sudo -u flux flux-imp version
```

Expected output:

```
flux-imp 0.12.0
```

If you get a permission error, double-check the SETUID bit on the `flux-imp` binary and the file permissions on `imp.toml`.

> 🔗 **See also:** The flux-security project has its own documentation at [https://github.com/flux-framework/flux-security](https://github.com/flux-framework/flux-security). The IMP design document explains the trust model in detail.

### Resource Inventory (JGF R File)

The R file tells Flux what hardware exists in your cluster. Slurm discovers resources dynamically via `slurmd` — each daemon reports its node's CPUs, memory, and GRES at startup. Flux uses a static resource description file instead. This is more explicit and allows you to define resource topology (which GPUs are on which NUMA node, NVLink connectivity, etc.) in ways that `gres.conf` cannot.

**Auto-generate the R file.**

For most clusters, the `flux R encode` command generates a correct R file from simple parameters:

```bash
# 128-node cluster, 64 cores per node, 4 GPUs per node
flux R encode \
  --ranks=0-127 \
  --hosts=node[00-127] \
  --cores=0-63 \
  --gpus=0-3 \
  > /etc/flux/system/R
```

For a small 4-node test cluster (the setup we build in this tutorial):

```bash
# 4 nodes, 16 cores each, no GPUs
flux R encode \
  --ranks=0-3 \
  --hosts=flux-node[01-04] \
  --cores=0-15 \
  > /etc/flux/system/R
```

**Understanding the JGF format.**

The R file is JSON. Here is a minimal manually-written snippet for a 4-node cluster so you understand the structure — you rarely need to write this by hand, but knowing the format helps when debugging:

```json
{
  "version": 1,
  "execution": {
    "R_lite": [
      {
        "rank": "0-3",
        "children": {
          "core": "0-15"
        }
      }
    ],
    "starttime": 0,
    "expiration": 0,
    "nodelist": [
      "flux-node[01-04]"
    ]
  }
}
```

For a cluster with GPUs, the `children` block extends:

```json
{
  "rank": "0-3",
  "children": {
    "core": "0-63",
    "gpu": "0-3"
  }
}
```

> 💡 **Tip:** The `R_lite` format is the compact representation. Flux also supports full JGF (JSON Graph Format) for complex topologies where you need to express relationships between resources — for example, GPUs connected via NVLink within specific NUMA domains. For most deployments, `R_lite` via `flux R encode` is sufficient.

**Verify the resource inventory.**

After the broker starts (covered below), verify that Flux sees all resources:

```bash
flux resource list
```

Expected output for our 4-node test cluster:

```
     STATE NNODES   NCORES    NGPUS NODELIST
      free      4       64        0 flux-node[01-04]
 allocated      0        0        0
      down      0        0        0
```

For more detail:

```bash
flux resource status
```

Expected output:

```
     STATUS NNODES RANKS          NODELIST
     online      4 0-3            flux-node[01-04]
    offline      0
   drained      0
```

If any nodes show as `offline`, they have not joined the overlay network — check broker logs on those nodes (`journalctl -u flux`).

### System Configuration Files

Flux's system configuration lives in `/etc/flux/system/conf.d/`. Each `.toml` file handles one concern. This is analogous to splitting `slurm.conf` into purpose-specific includes — except Flux enforces this modularity by design.

Here is the complete set of configuration files for our 4-node test cluster.

**`/etc/flux/system/conf.d/access.toml` — Access Control**

Controls who can connect to the system instance:

```toml
# /etc/flux/system/conf.d/access.toml
# Access control for the system instance

[access]
# Allow any valid local user to submit jobs.
allow-guest-user = true

# Allow root to own and manage the instance.
allow-root-owner = true
```

| Setting | Purpose | Slurm Equivalent |
|---|---|---|
| `allow-guest-user` | Permits non-flux users to connect and submit jobs | `AccountingStorageEnforce` (inverse logic) |
| `allow-root-owner` | Allows root to manage the instance | Implicit in Slurm (root always has access) |

**`/etc/flux/system/conf.d/resource.toml` — Resource Configuration**

Tells the broker where to find the R file and sets resource-related options:

```toml
# /etc/flux/system/conf.d/resource.toml
# Resource inventory path

[resource]
# Path to the R file generated by flux R encode
path = "/etc/flux/system/R"

# Exclude specific ranks from scheduling (e.g., the head node)
# Uncomment if rank 0 is a management-only node:
# exclude = "0"
```

> 📝 **Note:** If your head node should not run jobs (like a Slurm controller that is not also a compute node), set `exclude = "0"` to remove rank 0 from the schedulable resource pool.

**`/etc/flux/system/conf.d/exec.toml` — Job Execution**

Defines how jobs are launched on compute nodes:

```toml
# /etc/flux/system/conf.d/exec.toml
# Job execution configuration

[exec]
# Use flux-imp for multi-user job launch (the standard for system instances).
imp = "/usr/libexec/flux/flux-imp"

# Service account that runs the broker (jobs will be launched as
# the submitting user via flux-imp).
# Uncomment and set if the broker runs as a user other than "flux":
# service-user = "flux"
```

**`/etc/flux/system/conf.d/scheduler.toml` — Scheduler Configuration**

Configures the Fluxion scheduler behavior:

```toml
# /etc/flux/system/conf.d/scheduler.toml
# Fluxion scheduler options

[sched-fluxion-qmanager]
# Queue policy: "fcfs" (first-come first-served) or "easy" (backfill).
# "easy" is analogous to Slurm's backfill scheduler.
queue-policy = "easy"
```

| Flux Setting | Slurm Equivalent |
|---|---|
| `queue-policy = "fcfs"` | `SchedulerType=sched/builtin` |
| `queue-policy = "easy"` | `SchedulerType=sched/backfill` |

**`/etc/flux/system/conf.d/queues.toml` — Queue Definitions**

Queues are Flux's equivalent of Slurm partitions. Define as many as you need:

```toml
# /etc/flux/system/conf.d/queues.toml
# Queue definitions (analogous to Slurm partitions)

[queues.compute]
# General-purpose compute queue.
# All nodes with the "compute" property are eligible.
requires = ["compute"]

[queues.gpu]
# GPU workloads only.
requires = ["gpu"]

[queues.debug]
# Short interactive jobs for testing.
requires = ["debug"]

# Maximum wall time for debug queue jobs: 30 minutes.
# Analogous to: PartitionName=debug MaxTime=00:30:00 in slurm.conf
[queues.debug.policy.limits.duration]
max = "30m"

# Set the default queue (analogous to Slurm's DefPartition)
[policy]
jobspec.defaults.system.queue = "compute"
```

Here is a side-by-side comparison of queue configuration:

| Slurm (`slurm.conf`) | Flux (`queues.toml`) |
|---|---|
| `PartitionName=compute Nodes=node[01-04] Default=YES` | `[queues.compute]` with `requires = ["compute"]` |
| `PartitionName=gpu Nodes=gpu[01-02]` | `[queues.gpu]` with `requires = ["gpu"]` |
| `PartitionName=debug MaxTime=00:30:00` | `[queues.debug.policy.limits.duration]` with `max = "30m"` |
| `DefPartition=compute` | `[policy]` with `jobspec.defaults.system.queue = "compute"` |

> 📝 **Note:** Flux queue assignment is property-based, not node-list-based. You tag resources with properties (in the R file or via `flux resource` commands) and queues match on those properties. This is more flexible than Slurm's explicit node lists per partition but requires you to assign properties to your nodes.

To assign properties to nodes for queue routing:

```bash
# Tag nodes with properties after the instance starts
flux resource set-property compute ranks:0-3
flux resource set-property debug ranks:0-1
```

**Full configuration file summary for 4-node test cluster:**

```
/etc/flux/system/
├── conf.d/
│   ├── access.toml       # Guest user access, root ownership
│   ├── resource.toml     # Path to R file
│   ├── exec.toml         # IMP path for multi-user exec
│   ├── scheduler.toml    # Fluxion queue policy (backfill)
│   └── queues.toml       # Queue definitions + default queue
├── curve.cert            # ZMQ CURVE key pair (mode 0400, owner flux)
└── R                     # JGF resource inventory
```

> 💡 **Tip:** Flux reads all `*.toml` files in `conf.d/` alphabetically at startup. You can split or merge files however you like — the directory structure above is a convention, not a requirement. Some admins prefer a single `system.toml` file for small clusters.

### Starting the System Instance

With all configuration in place, start the Flux broker via `systemd`.

**Step 1: Create the Flux service account (if it does not exist).**

```bash
sudo useradd -r -s /sbin/nologin -d /var/lib/flux flux
```

**Step 2: Set ownership on configuration files.**

```bash
sudo chown -R flux:flux /etc/flux/system/
sudo chmod 400 /etc/flux/system/curve.cert
sudo chmod 644 /etc/flux/system/R
sudo chmod 644 /etc/flux/system/conf.d/*.toml
```

**Step 3: Enable and start the broker on all nodes.**

On the head node (rank 0):

```bash
sudo systemctl enable flux
sudo systemctl start flux
```

On each compute node (ranks 1-N), the same service connects to the rank 0 broker. The broker URI is configured in the systemd unit file or via `/etc/flux/system/conf.d/broker.toml`:

```bash
# On every compute node
sudo systemctl enable flux
sudo systemctl start flux
```

> 📝 **Note:** The Flux systemd unit file is installed by the `flux-core` package. It reads the configuration from `/etc/flux/system/conf.d/` automatically. If you need to customize startup options, override the unit with `systemctl edit flux`.

**Step 4: Verify the system instance.**

```bash
# Check systemd status
sudo systemctl status flux
```

Expected output (trimmed):

```
● flux.service - Flux resource manager
     Loaded: loaded (/usr/lib/systemd/system/flux.service; enabled)
     Active: active (running) since Sun 2026-06-01 10:00:00 UTC
   Main PID: 12345 (flux-broker)
```

Now verify from the Flux CLI:

```bash
# Connect to the system instance as any user
flux resource list
```

Expected output:

```
     STATE NNODES   NCORES    NGPUS NODELIST
      free      4       64        0 flux-node[01-04]
 allocated      0        0        0
      down      0        0        0
```

```bash
# Check the job queue (should be empty)
flux jobs -a
```

Expected output:

```
  JOBID USER     NAME       ST NTASKS NNODES     TIME INFO
```

```bash
# Check system uptime and instance info
flux uptime
```

Expected output:

```
 10:05:23 run 5m,  owner flux,  depth 0,  size 4
```

The `depth 0` confirms this is a root system instance (not a nested user-space instance). The `size 4` confirms all four brokers have joined the overlay.

**Step 5: Verify broker connectivity.**

Confirm all nodes are reachable through the overlay network:

```bash
# Ping all brokers
flux exec -r all flux getattr rank
```

Expected output:

```
0
1
2
3
```

If a rank is missing, check `journalctl -u flux` on that node for connection errors.

```bash
# Run a command on every node to verify execution
flux exec -r all hostname
```

Expected output:

```
flux-node01
flux-node02
flux-node03
flux-node04
```

> 💡 **Tip:** `flux exec` is Flux's equivalent of `pdsh` or `srun --nodes=all`. It runs a command on specified broker ranks. Use `-r all` for every node or `-r 1-3` for a subset.

### flux-accounting Setup

Flux-accounting provides bank-based fair-share scheduling and usage tracking — the equivalent of Slurm's `sacctmgr` + `slurmdbd`. The key difference: flux-accounting uses SQLite instead of MySQL/MariaDB, which means no database server to install, configure, or back up separately.

**Initialize the accounting database:**

```bash
# Create the accounting database
flux account create-db
```

**Create the bank hierarchy.**

Banks in flux-accounting are analogous to Slurm Accounts. They form a tree:

```bash
# Create the root bank with a total allocation of shares
flux account add-bank root 10000

# Create sub-banks (departments, projects, etc.)
flux account add-bank --parent-bank=root hpc 5000
flux account add-bank --parent-bank=root bio 3000
flux account add-bank --parent-bank=root debug 2000
```

Slurm equivalent for comparison:

```bash
# Slurm: sacctmgr add account
sacctmgr add account hpc Description="HPC group" Organization="Computing"
sacctmgr add account bio Description="Bio group" Organization="Research"
```

**Add users to banks:**

```bash
# Add users with bank association and limits
flux account add-user jdoe --bank=hpc --max-active-jobs=100 --max-running-jobs=50
flux account add-user asmith --bank=bio --max-active-jobs=200 --max-running-jobs=100
flux account add-user testuser --bank=debug --max-active-jobs=10
```

Slurm equivalent:

```bash
# Slurm: sacctmgr add user
sacctmgr add user jdoe Account=hpc MaxSubmitJobs=100
sacctmgr add user asmith Account=bio MaxSubmitJobs=200
```

**View bank and user configuration:**

```bash
# View bank details
flux account view-bank hpc
```

Expected output:

```
bank_name    parent_bank    shares    usage
hpc          root           5000      0
```

```bash
# View user details
flux account view-user jdoe
```

Expected output:

```
username    bank    max_active_jobs    max_running_jobs    shares    usage
jdoe        hpc     100                50                  1         0
```

**Full command comparison:**

| Action | Slurm (`sacctmgr`) | Flux (`flux account`) |
|---|---|---|
| Create account/bank | `sacctmgr add account hpc` | `flux account add-bank hpc 5000` |
| Add user | `sacctmgr add user jdoe Account=hpc` | `flux account add-user jdoe --bank=hpc` |
| View accounts | `sacctmgr show account` | `flux account view-bank` |
| View users | `sacctmgr show user` | `flux account view-user` |
| Set limits | `sacctmgr modify user where name=jdoe set MaxSubmitJobs=50` | `flux account edit-user jdoe --max-active-jobs=50` |
| View usage | `sacct -u jdoe` | `flux account view-user jdoe` |

> 📝 **Note:** flux-accounting uses SQLite, not MySQL. This means zero database administration overhead — no `slurmdbd` daemon, no MySQL tuning, no replication configuration. The trade-off: SQLite is less suited to very large sites (10,000+ users) where concurrent write throughput matters. For most clusters, SQLite is a significant operational simplification.

### Submitting the First System Job

Time to validate the entire stack — security, resources, queues, and accounting — by submitting a job as a non-root user.

**Step 1: Switch to a regular user account.**

```bash
# If you've been working as root, switch to a normal user
su - jdoe
```

**Step 2: Verify the user can see the system instance.**

```bash
flux resource list
```

The user should see the same resource output as root. If you get a connection error, check that `allow-guest-user = true` is set in `access.toml`.

**Step 3: Submit a test job.**

```bash
# Submit to the compute queue, requesting 4 cores
flux submit --queue=compute --cores=4 hostname
```

Expected output:

```
f7Tqo5KZ
```

That base58 string is the job ID (analogous to Slurm's integer job ID).

**Step 4: Check job status.**

```bash
flux jobs -a
```

Expected output:

```
    JOBID USER     NAME       ST NTASKS NNODES     TIME INFO
 f7Tqo5KZ jdoe     hostname    CD      1      1   0.1s flux-node02
```

`CD` means completed. If you see `PD` (pending) or `R` (running), wait a moment and check again.

**Step 5: View job output.**

```bash
flux job attach f7Tqo5KZ
```

Expected output:

```
flux-node02
```

The job ran on `flux-node02`, executed `hostname`, and returned the result. Your system instance is working end-to-end.

**Step 6: Submit a multi-node job to confirm cross-node execution.**

```bash
flux submit --nodes=2 --cores=8 --queue=compute flux getattr rank
flux job attach $(flux job last)
```

> 💡 **Tip:** `flux job last` returns the ID of the most recently submitted job — saves you from copying base58 strings.

### Migration Strategy

#### Migrating from Slurm — A Phased Approach

Replacing a production scheduler is not a weekend project. The approach below has been validated at multiple DOE sites and balances risk against forward progress. Each phase builds confidence before the next one begins.

**Phase 1: User-Space Flux Inside Slurm (Months 1-6)**

No admin changes required. Users install Flux in conda environments and run `flux start` inside Slurm allocations (exactly as described in [[flux-basics|Flux Basics]]). This phase builds user familiarity and surfaces workflow compatibility issues with zero risk to the production scheduler.

What to do:
- Identify 3-5 willing pilot users (ideally running Snakemake or other ensemble workflows).
- Have them install `flux-core` via mamba and run their workflows inside Flux sub-instances.
- Collect feedback on command differences, missing features, and performance observations.
- Build a Flux profile for Snakemake alongside the existing Slurm profile (see [[flux-snakemake-workflows|Flux Snakemake Workflows]]).

Success criteria: Pilot users can complete their standard workflows entirely within Flux sub-instances without falling back to raw Slurm commands.

**Phase 2: Parallel Deployment on Test Partition (Months 3-9)**

Stand up a system Flux instance on a dedicated set of nodes — either a physical partition or a separate VLAN. This is the deployment described in this tutorial. Flux and Slurm run side by side on different hardware.

What to do:
- Allocate 4-16 nodes for the Flux test partition (not production-critical nodes).
- Deploy the full system instance using this tutorial.
- Migrate pilot users to submit directly to the Flux system instance for their test workloads.
- Validate accounting, queue policies, and multi-user isolation.
- Run failure scenarios: kill a broker, drain a node, simulate a head node restart.

Success criteria: Multi-user jobs run reliably on the Flux partition for 4+ weeks. Accounting is accurate. Failure recovery is understood and documented.

**Phase 3: Full Cutover (Months 6-12+)**

Migrate all queues to Flux. Keep Slurm in drain mode (accepting no new jobs) for historical job data access via `sacct`.

What to do:
- Communicate the migration timeline to all users with at least 30 days notice.
- Provide a command cheat sheet and hold a training session (the [[slurm-vs-flux-reference|Slurm vs Flux Reference]] is designed for this).
- Cut over queue by queue, starting with the least critical (debug, then general compute, then GPU last).
- Keep `slurmdbd` running read-only for 6 months so users can query historical job data with `sacct`.
- Decommission Slurm daemons once the Flux instance has been stable for 90+ days.

> ⚠️ **Warning:** Do not attempt Phase 3 without completing Phase 2. The parallel deployment phase surfaces operational issues (monitoring gaps, backup procedures, user training needs) that you need to solve before a full cutover.

#### Things Slurm Does That Flux Does Not Yet

An honest assessment of current gaps. This table will evolve — check the Flux GitHub issues and roadmap for current status.

| Feature | Slurm Status | Flux Status (2026) |
|---|---|---|
| Open OnDemand integration | Mature, widely deployed | Community development in progress; not production-ready |
| Configless node auto-join | `slurmd --conf-server` since 20.11 | Not supported — nodes need `/etc/flux/system/` config |
| Controller HA (failover) | `SlurmctldHost` backup since 15.08 | Experimental; not recommended for production |
| Federation (multi-cluster) | `FederationParameters` in `slurm.conf` | Flux natively hierarchical but cross-site federation is limited |
| Burst scheduling to cloud | Slurm + cloud plugins (AWS, GCP, Azure) | `flux-operator` on Kubernetes; no native cloud burst |
| Preemption policies | `PreemptType`, `PreemptMode` (mature) | Basic preemption via queue priority; fewer policy knobs |
| Job arrays | `sbatch --array=1-1000` (native) | Use `flux submit --cc=1-1000` (similar but not identical) |
| cgroup enforcement | Mature [[cgroups-beginner-guide|cgroup integration]] | Supported via `flux-shell` plugins; see [[cgroups-deep-dive|Cgroups Deep Dive]] |
| Power management | `SuspendProgram`, `ResumeProgram` | Experimental; not feature-complete |
| MPI launch (PMIx) | Well-tested `srun` PMI/PMIx | Flux uses its own PMI; PMIx support available but less tested at scale |
| Third-party tooling | Decades of ecosystem (XDMOD, COLDFRONT, etc.) | Sparse; most HPC management tools assume Slurm |

> 📝 **Note:** This table is not a reason to avoid Flux — it is a planning tool. Every gap listed above has an active GitHub issue or development effort. The question is whether your site hits these gaps today.

---

## Practical Examples

### Complete 4-Node Test Cluster Setup from Scratch

This section consolidates everything above into a linear, copy-paste walkthrough. Assumes four VMs or bare-metal nodes named `flux-node01` through `flux-node04`, with `flux-node01` as the head node.

**On all nodes — install packages and create the service account:**

```bash
# RHEL/Rocky
sudo dnf copr enable flux-framework/flux
sudo dnf install -y flux-core flux-sched flux-security flux-accounting

# Create flux user
sudo useradd -r -s /sbin/nologin -d /var/lib/flux flux

# Create configuration directories
sudo mkdir -p /etc/flux/system/conf.d
sudo mkdir -p /etc/flux/security/conf.d

# Verify SETUID on flux-imp
ls -la $(which flux-imp)
# Should show -rwsr-xr-x. If not:
sudo chmod u+s $(which flux-imp)
```

**On flux-node01 (head node) — generate keys and R file:**

```bash
# Generate CURVE keys
sudo flux keygen /etc/flux/system/curve.cert
sudo chown flux:flux /etc/flux/system/curve.cert
sudo chmod 400 /etc/flux/system/curve.cert

# Generate resource inventory (4 nodes, 16 cores each)
flux R encode \
  --ranks=0-3 \
  --hosts=flux-node[01-04] \
  --cores=0-15 \
  | sudo tee /etc/flux/system/R > /dev/null
```

**Distribute keys and R file to all compute nodes:**

```bash
# From flux-node01
for node in flux-node02 flux-node03 flux-node04; do
  scp /etc/flux/system/curve.cert root@${node}:/etc/flux/system/curve.cert
  scp /etc/flux/system/R root@${node}:/etc/flux/system/R
  ssh root@${node} 'chown flux:flux /etc/flux/system/curve.cert && chmod 400 /etc/flux/system/curve.cert'
done
```

**On all nodes — write configuration files:**

Create these files on every node (identical content on all):

```bash
# access.toml
cat <<'EOF' | sudo tee /etc/flux/system/conf.d/access.toml
[access]
allow-guest-user = true
allow-root-owner = true
EOF

# resource.toml
cat <<'EOF' | sudo tee /etc/flux/system/conf.d/resource.toml
[resource]
path = "/etc/flux/system/R"
EOF

# exec.toml
cat <<'EOF' | sudo tee /etc/flux/system/conf.d/exec.toml
[exec]
imp = "/usr/libexec/flux/flux-imp"
EOF

# scheduler.toml
cat <<'EOF' | sudo tee /etc/flux/system/conf.d/scheduler.toml
[sched-fluxion-qmanager]
queue-policy = "easy"
EOF

# queues.toml
cat <<'EOF' | sudo tee /etc/flux/system/conf.d/queues.toml
[queues.compute]
requires = ["compute"]

[queues.debug]
requires = ["debug"]
[queues.debug.policy.limits.duration]
max = "30m"

[policy]
jobspec.defaults.system.queue = "compute"
EOF
```

**IMP configuration on all nodes:**

```bash
cat <<'EOF' | sudo tee /etc/flux/security/conf.d/imp.toml
[exec]
allowed-users = [ "flux" ]
allowed-shells = [ "/usr/libexec/flux/flux-shell" ]
EOF
```

**Start the system instance:**

```bash
# On ALL nodes (start head node first, then compute nodes)
sudo systemctl enable flux
sudo systemctl start flux
```

**Validate from flux-node01:**

```bash
# Check all nodes joined
flux resource list
flux exec -r all hostname
flux uptime

# Set up queue properties
flux resource set-property compute ranks:0-3
flux resource set-property debug ranks:0-1

# Set up accounting
flux account create-db
flux account add-bank root 10000
flux account add-bank --parent-bank=root hpc 5000
flux account add-user testuser --bank=hpc --max-active-jobs=50

# Submit a test job as a regular user
su - testuser -c 'flux submit --queue=compute --cores=4 hostname'
su - testuser -c 'flux job attach $(flux job last)'
```

If the last command prints a hostname, your system instance is fully operational.

---

## Hands-On Exercises

### Exercise 1: Add a GPU Queue

You have two nodes (`flux-node03` and `flux-node04`) that each have 2 GPUs. Extend your test cluster configuration to support a `gpu` queue.

Tasks:
1. Regenerate the R file to include GPUs on ranks 2-3 (flux-node03 and flux-node04).
2. Add a `[queues.gpu]` section to `queues.toml` with a property requirement of `"gpu"`.
3. Assign the `gpu` property to ranks 2-3.
4. Submit a job to the `gpu` queue requesting 1 GPU: `flux submit --queue=gpu --gpus=1 nvidia-smi`.
5. Verify the job ran on either flux-node03 or flux-node04.

<details>
<summary>Hints</summary>

Regenerate R with GPUs on specific ranks:

```bash
# Create two R fragments and merge them
flux R encode --ranks=0-1 --hosts=flux-node[01-02] --cores=0-15 > /tmp/R_cpu.json
flux R encode --ranks=2-3 --hosts=flux-node[03-04] --cores=0-15 --gpus=0-1 > /tmp/R_gpu.json
# Merge (flux R append is available in recent versions)
flux R append /tmp/R_cpu.json /tmp/R_gpu.json > /etc/flux/system/R
```

Set GPU property:

```bash
flux resource set-property gpu ranks:2-3
```

</details>

### Exercise 2: Configure Job Size Limits per Queue

Configure the `debug` queue to limit jobs to a maximum of 2 nodes and 32 cores, and the `compute` queue to allow up to 4 nodes.

Tasks:
1. Edit `queues.toml` to add node and core limits under `[queues.debug.policy.limits]`.
2. Reload the Flux configuration: `flux config reload`.
3. Test by submitting a 3-node job to the `debug` queue — it should be rejected.
4. Submit the same job to `compute` — it should be accepted.

<details>
<summary>Hints</summary>

Add to `queues.toml`:

```toml
[queues.debug.policy.limits.range]
nnodes = [1, 2]
ncores = [1, 32]
```

Test rejection:

```bash
flux submit --queue=debug --nodes=3 hostname
# Should fail with a resource limit error
```

</details>

### Exercise 3: Simulate a Node Failure and Recovery

Practice the admin workflow for draining and undraining nodes — the Flux equivalent of `scontrol update NodeName=node03 State=DRAIN Reason="maintenance"`.

Tasks:
1. Drain `flux-node03` with a reason: `flux resource drain 2 "scheduled maintenance"`.
2. Verify the node shows as drained: `flux resource status`.
3. Submit a 4-node job — it should pend because only 3 schedulable nodes remain.
4. Undrain the node: `flux resource undrain 2`.
5. Verify the pending job starts.

| Action | Slurm | Flux |
|---|---|---|
| Drain node | `scontrol update NodeName=node03 State=DRAIN Reason="maint"` | `flux resource drain 2 "maint"` |
| View drained | `sinfo -R` | `flux resource status` |
| Undrain node | `scontrol update NodeName=node03 State=RESUME` | `flux resource undrain 2` |

---

## Troubleshooting

### IMP Permission Errors

**Symptom:** Jobs fail immediately with `imp: operation not permitted` or similar.

**Causes and fixes:**

| Check | Command | Expected |
|---|---|---|
| SETUID bit on `flux-imp` | `ls -la $(which flux-imp)` | `-rwsr-xr-x` (note the `s`) |
| IMP config syntax | `flux-imp version` (run as flux user) | Prints version without error |
| `allowed-users` in `imp.toml` | `cat /etc/flux/security/conf.d/imp.toml` | Contains the flux service account username |
| `allowed-shells` path exists | `ls -la /usr/libexec/flux/flux-shell` | File exists and is executable |

```bash
# Fix SETUID bit
sudo chmod u+s $(which flux-imp)

# Test IMP directly
sudo -u flux flux-imp version
```

### Broker Connectivity Failures

**Symptom:** `flux resource list` shows fewer nodes than expected, or nodes appear as `offline`.

**Diagnostic steps:**

```bash
# Check broker status on the head node
sudo systemctl status flux

# Check broker logs on a problem compute node (SSH to it)
ssh flux-node03 'journalctl -u flux --since "10 minutes ago" --no-pager'

# Common log messages and their meaning:
# "connect: Connection refused"  → broker not started on remote node
# "certificate verification failed" → curve.cert mismatch or missing
# "unauthorized peer"            → curve.cert file differs between nodes
```

**Common fixes:**

```bash
# Verify curve.cert matches on all nodes
md5sum /etc/flux/system/curve.cert
ssh flux-node02 'md5sum /etc/flux/system/curve.cert'
# Must be identical

# Restart broker on a problem node
ssh flux-node03 'sudo systemctl restart flux'

# Check firewall — Flux brokers communicate over TCP (default port range)
# Ensure port 8050 (or your configured port) is open between all nodes
```

### Resource Discovery Issues

**Symptom:** `flux resource list` shows 0 nodes, wrong core counts, or missing GPUs.

**Diagnostic steps:**

```bash
# Verify the R file is valid JSON
python3 -m json.tool /etc/flux/system/R

# Verify resource.toml points to the correct path
cat /etc/flux/system/conf.d/resource.toml

# Check what the broker loaded
flux resource list -v

# If resources look wrong, regenerate and reload
flux R encode --ranks=0-3 --hosts=flux-node[01-04] --cores=0-15 > /tmp/R_new.json
python3 -m json.tool /tmp/R_new.json  # validate
sudo cp /tmp/R_new.json /etc/flux/system/R
flux config reload
```

### Accounting Database Problems

**Symptom:** `flux account view-bank` returns errors, or jobs are not tracked.

```bash
# Check if the database file exists
ls -la /var/lib/flux/accounting.db

# If missing, initialize it
flux account create-db

# If corrupted, back up and recreate
cp /var/lib/flux/accounting.db /var/lib/flux/accounting.db.bak
flux account create-db

# Verify accounting is loaded as a module
flux module list | grep accounting

# Reload the accounting module if needed
flux module reload accounting
```

### Queue Routing Failures

**Symptom:** Jobs submitted to a queue pend indefinitely even when resources are available.

```bash
# Check queue configuration
flux config get queues

# Check that nodes have the required property
flux resource list -o "{state} {properties} {nnodes} {nodelist}"

# Common fix: assign the missing property
flux resource set-property compute ranks:0-3

# Verify queue is accepting jobs
flux queue status
```

---

## References

| Resource | URL |
|---|---|
| Flux Framework Documentation | [https://flux-framework.readthedocs.io/](https://flux-framework.readthedocs.io/) |
| Flux Admin Guide | [https://flux-framework.readthedocs.io/en/latest/guides/admin-guide.html](https://flux-framework.readthedocs.io/en/latest/guides/admin-guide.html) |
| flux-security GitHub | [https://github.com/flux-framework/flux-security](https://github.com/flux-framework/flux-security) |
| flux-accounting GitHub | [https://github.com/flux-framework/flux-accounting](https://github.com/flux-framework/flux-accounting) |
| Flux Core GitHub | [https://github.com/flux-framework/flux-core](https://github.com/flux-framework/flux-core) |
| Flux Sched (Fluxion) GitHub | [https://github.com/flux-framework/flux-sched](https://github.com/flux-framework/flux-sched) |
| LLNL Flux Project Page | [https://computing.llnl.gov/projects/flux](https://computing.llnl.gov/projects/flux) |
| Flux Learning Guide | [https://flux-framework.readthedocs.io/en/latest/guides/learning_guide.html](https://flux-framework.readthedocs.io/en/latest/guides/learning_guide.html) |
| HPSF (High Performance Software Foundation) | [https://hpsf.io/](https://hpsf.io/) |

---

## Summary

You now have a working Flux system instance — the full Slurm replacement stack. Here is what you built:

1. **Security**: CURVE25519 keys for broker authentication + IMP SETUID binary for multi-user job execution — replacing MUNGE and root-owned `slurmd`.
2. **Resources**: A JGF R file describing your cluster topology — replacing `slurm.conf` node definitions and `gres.conf`.
3. **Configuration**: Modular TOML files for access control, scheduling policy, queue definitions, and execution — replacing the monolithic `slurm.conf`.
4. **Accounting**: SQLite-backed flux-accounting with bank hierarchy and user limits — replacing `slurmdbd` + MySQL and `sacctmgr`.
5. **Validation**: A non-root user submitted and completed a job through the entire stack.

The migration strategy gives you a path from zero-risk user-space evaluation (Phase 1) through parallel deployment (Phase 2) to full cutover (Phase 3). The gaps table tells you exactly where Flux does not yet match Slurm's feature set so there are no surprises.

---

## Related Tutorials

- [[flux-basics|Flux Basics]] — User-space Flux installation, core commands, and Slurm command mapping
- [[flux-snakemake-workflows|Flux Snakemake Workflows]] — Running Snakemake pipelines on Flux with the executor plugin
- [[flux-advanced-features|Advanced Flux Features]] — Hierarchical scheduling, Python SDK, and ensemble workflows
- [[slurm-vs-flux-reference|Slurm vs Flux Reference]] — Quick-reference comparison table
- [[slurm-vs-flux-deep-dive|Slurm vs Flux Deep Dive]] — Architecture and feature deep dive
- [[cgroups-beginner-guide|Cgroups Beginner Guide]] — Resource isolation fundamentals
- [[cgroups-deep-dive|Cgroups Deep Dive]] — Advanced cgroup configuration for job schedulers

---

## Next Steps

You have a working Flux system instance on a test cluster. Before moving on, complete this validation exercise:

1. As a non-root user, submit a 10-job batch that each runs `sleep 5 && hostname`:

```bash
for i in $(seq 1 10); do
  flux submit --queue=compute --cores=2 bash -c "sleep 5 && hostname"
done
```

2. Watch all 10 jobs complete:

```bash
flux jobs -a
```

3. Verify they ran across multiple nodes:

```bash
for id in $(flux jobs -a --no-header -o "{id}"); do
  flux job attach "$id"
done
```

Once all 10 jobs show completed hostnames from different nodes, your system instance is production-ready for pilot workloads. The next tutorial, [[flux-snakemake-workflows|Flux Snakemake Workflows]], shows you how to run Snakemake pipelines on this system instance — or inside a Flux sub-instance within Slurm during Phase 1 of your migration.
