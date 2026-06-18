---
title: "IsaacLab MetaGrasp with Apptainer on HPC: A Beginner's Guide"
date: 2026-04-10
difficulty: beginner
tags: [isaaclab, metagrasp, apptainer, hpc, slurm, nvidia, robotics, simulation]
---

# IsaacLab MetaGrasp with Apptainer on HPC: A Beginner's Guide

## 1. Overview

This guide introduces you to running **IsaacLab** combined with **MetaGrasp** in containers on high-performance computing (HPC) clusters using **Apptainer**. If you are new to robotics simulation, container technology, or cluster computing, this guide will walk you through the fundamental concepts and steps needed to get started.

By following this guide, you will learn:

- What IsaacLab, MetaGrasp, Apptainer, and SLURM are and why they work together
- How to set up and configure your HPC cluster environment for simulation workflows
- How to build a containerized simulation environment on a cluster
- How to submit jobs that run robotics simulation tasks
- How to monitor and debug your first simulation runs

No prior experience with containers, HPC clusters, or robotics simulation is required. This is an entry point to a powerful combination of tools.

---

## 2. Prerequisites

Before you begin, make sure you have access to:

**HPC Cluster Resources**

- A login node on an HPC cluster running Rocky Linux 8, Ubuntu 22.04, or similar x86_64 Linux
- SLURM job scheduler with GPU support (at least one compute node with A100, H100, or similar NVIDIA GPU)
- Apptainer ≥ 1.2 installed on the cluster (ask your cluster admin if unsure)
- Internet access from the login node to pull container images and download assets
- At least 60 GB of free disk space in your home or scratch directory for the build and final container image

**Personal Accounts and Access**

- An NVIDIA NGC (NVIDIA GPU Cloud) account with an active API key — [register here](https://ngc.nvidia.com)
- SSH access to your HPC cluster
- Basic familiarity with the Linux command line (navigating with `cd`, listing files with `ls`, and editing files with a text editor)

**Software on Your Local Machine (Optional)**

- An SSH client to connect to your cluster
- A terminal application (Terminal on macOS/Linux, PowerShell or Windows Terminal on Windows)

---

## 3. Key Concepts

### What is IsaacLab?

IsaacLab is a robotics simulation framework built on top of Isaac Sim (NVIDIA's advanced physics and rendering engine). It provides:

- A high-fidelity physics engine for realistic robot and object interactions
- Pre-built robot models and environments
- Python API for writing simulation scenarios
- Integration with reinforcement learning frameworks like Stable Baselines3 and SKRL

IsaacLab handles the complex details of physics simulation, letting you focus on robot behavior and learning algorithms.

### What is MetaGrasp?

MetaGrasp (more precisely, MetaIsaacGrasp) is a research framework that combines robotics grasping with IsaacLab. It provides:

- A large dataset of 3D objects (MetaGraspNet) suitable for grasping tasks
- Pre-configured grasp policy evaluation tasks
- Data generation pipelines for training grasp prediction models
- Support for both reinforcement learning and imitation learning workflows

### What is Apptainer?

Apptainer (formerly Singularity) is a container platform optimized for HPC environments. Unlike Docker, Apptainer:

- Runs containers without requiring daemon processes or elevated privileges on shared clusters
- Gives full access to GPUs and high-speed networking on compute nodes
- Works seamlessly with SLURM and other job schedulers
- Stores images in a single `.sif` file, making them easy to move and manage

A **container** is a lightweight, self-contained package that bundles your application code, all dependencies (libraries, frameworks), and configuration into one unit. When you run a containerized application, it runs the same way everywhere — on your laptop, your cluster, a colleague's machine.

### What is SLURM?

SLURM (Simple Linux Utility for Resource Management) is the job scheduler on most HPC clusters. It lets you:

- Request compute resources (GPUs, CPU cores, memory)
- Submit jobs that run when resources become available
- Monitor job status and collect output logs

### NGC (NVIDIA GPU Cloud)

NGC is a registry of pre-built containerized applications and models from NVIDIA. The IsaacLab container image is stored on NGC and requires authentication with an API key.

---

## 4. Step-by-Step Instructions

### Step 1 — Set Up Your NGC Credentials

The base Isaac Sim container image on NGC requires authentication. Configure your Apptainer credentials once so all builds and pulls work seamlessly.

On your cluster's **login node**, run:

```bash
mkdir -p ~/.config/apptainer
cat > ~/.config/apptainer/docker-config.json <<EOF
{
  "auths": {
    "nvcr.io": {
      "auth": "$(echo -n '$oauthtoken:<YOUR_NGC_API_KEY>' | base64)"
    }
  }
}
EOF
```

Replace `<YOUR_NGC_API_KEY>` with your NGC API key from https://ngc.nvidia.com/setup/api-key.

**Verify the credentials work:**

```bash
apptainer pull docker://nvcr.io/nvidia/isaac-sim:4.5.0
```

Expected output:

```
INFO:    Downloading image
...
INFO:    Download complete
```

This pull is about 20 GB. You can delete the downloaded `.sif` file afterward because the full build includes everything you need.

### Step 2 — Clone the IsaacLab MetaGrasp Repository

The repository contains the Apptainer definition file and scripts to build your container.

```bash
git clone <your-repo-url> ~/isaaclab-metagrasp
cd ~/isaaclab-metagrasp
ls -la
```

Expected output:

```
drwxr-xr-x 10 you staff    4096 Apr 10 10:00 .
drwxr-xr-x  5 you staff    4096 Apr 10 09:55 ..
-rw-r--r--  1 you staff    2890 Apr  5 13:22 isaaclab-metagrasp.def
-rw-r--r--  1 you staff    3456 Apr  5 13:22 Dockerfile.urdf-converter
-rw-r--r--  1 you staff    1234 Apr  5 13:22 submit_job_slurm.sh
-rw-r--r--  1 you staff     856 Apr  5 13:22 README.md
```

The key file is `isaaclab-metagrasp.def` — the Apptainer definition file that describes how to build the container.

### Step 3 — Create Container Storage Directories

Set up the directory structure where your container image and simulation outputs will live:

```bash
mkdir -p ~/containers
mkdir -p ~/isaaclab/logs
mkdir -p ~/.cache/docker-isaac-sim
```

**Why three directories?**

- `~/containers/` — Stores the `.sif` container image (the complete IsaacLab + MetaGrasp environment)
- `~/isaaclab/logs/` — Stores output and checkpoints from your simulation jobs
- `~/.cache/docker-isaac-sim/` — Isaac Sim's runtime asset cache, reused across job runs to speed up startup

### Step 4 — Build the Container Image

Building the container pulls the base image, installs dependencies, and downloads simulation assets. This can take 60–130 minutes depending on cluster network speed.

From the repository directory:

```bash
apptainer build --fakeroot \
    ~/containers/isaaclab-metagrasp.sif \
    isaaclab-metagrasp.def
```

Expected output (first few lines):

```
INFO:    User not in sudoers file, using fakeroot
INFO:    Starting build...
INFO:    Downloading base image...
INFO:    Caching image...
...
[build progresses through phases]
...
INFO:    Creating SIF file...
```

**What happens during the build:**

| Phase | Description | Time |
|-------|-------------|------|
| Pull NGC base | Downloads Isaac Sim 4.5.0 | 20–40 min |
| System packages | apt-get installs libraries | 2–5 min |
| Install IsaacLab 2.0 | pip install framework + extensions | 10–20 min |
| Clone MetaIsaacGrasp | git clone + Python dependencies | 2–5 min |
| Download assets | models_ifl.zip (~8.2 GB) | 10–20 min |
| Extract assets | unzip and organize files | 5–10 min |
| URDF conversion | Convert robot models to USD format | 10–30 min |
| **Total** | | **~60–130 min** |

Monitor progress with:

```bash
ls -lh ~/containers/isaaclab-metagrasp.sif
```

When complete, you should see a file around 30–35 GB.

### Step 5 — Add Environment Variables to Your Shell

Add these to your `~/.bashrc` so they are always available. This makes running containers easier:

```bash
cat >> ~/.bashrc <<'EOF'

# IsaacLab on HPC
export SIF_PATH="${HOME}/containers/isaaclab-metagrasp.sif"
export ISAACSIM_CACHE_DIR="${HOME}/.cache/docker-isaac-sim"
alias isaaclab-shell="apptainer shell --nv \
    --bind ${ISAACSIM_CACHE_DIR}:/root/.cache/docker-isaac-sim \
    --env OMNI_KIT_ALLOW_ROOT=1 \
    --env ACCEPT_EULA=Y \
    ${SIF_PATH}"

EOF
```

Reload your shell:

```bash
source ~/.bashrc
```

### Step 6 — Verify the Container Works

Test the container with a quick interactive command:

```bash
apptainer exec --nv ${SIF_PATH} nvidia-smi
```

Expected output (showing GPU info):

```
+-----------------------------------------------------------------------------+
| NVIDIA-SMI 535.104.05             Driver Version: 535.104.05                |
+-----------------------------------------------------------------------------+
| GPU  Name        Persistence-M| Bus-Id        Disp.A | Volatile Uncorr. ECC |
|   0  A100-PCIE-40GB   Off  | 00:1E.0        Off  |                    0 |
|   0  A100-PCIE-40GB   Off  | 00:1F.0        Off  |                    0 |
+-----------------------------------------------------------------------------+
```

This confirms the container can see and access the GPUs.

---

## 5. Practical Examples

### Example 1 — Run the Container Interactively

Open a shell inside the container on a login node for testing and debugging:

```bash
isaaclab-shell
```

Expected output:

```
Singularity/Apptainer>
```

From inside the container, you can explore:

```bash
# Check the Python environment
python --version
python -c "import isaaclab; print(isaaclab.__version__)"

# Verify MetaGrasp is installed
ls /MetaIsaacGrasp/tasks/

# Exit the container
exit
```

### Example 2 — Submit a Data Generation Job

Data generation is the first step in many robotics learning pipelines. The job runs headless (no graphics).

Edit `submit_job_slurm.sh` at the top to set your email and preferred GPU type, then submit:

```bash
sbatch submit_job_slurm.sh --task AIR-v0-Data --headless --num_envs 64
```

Expected output:

```
Submitted batch job 12345
```

Check the job status:

```bash
squeue -u $USER
```

Expected output:

```
JOBID PARTITION     NAME     USER ST       TIME  NODES NODELIST(REASON)
12345      gpu1 AIR-v0-Da    you  R       5:32      1 compute-001
```

Monitor the output log:

```bash
tail -f AIR-v0-Data_12345.out
```

Expected output (first 10 lines):

```
[2026-04-10 10:15:00] Starting job 12345
[2026-04-10 10:15:05] Loading Isaac Sim...
[2026-04-10 10:15:25] Initializing environments...
[2026-04-10 10:15:35] Running data generation...
[2026-04-10 10:15:40] Episode 0/1000: reward=12.5
```

### Example 3 — Train a Grasp Policy with RL

Run reinforcement learning training using Stable Baselines3:

```bash
sbatch submit_job_slurm.sh --task AIR-v0-SB3 --headless --num_envs 32
```

This will submit a job that trains a grasp prediction model. Output is saved to `~/isaaclab/logs/`:

```bash
ls ~/isaaclab/logs/
```

Expected output:

```
AIR-v0-SB3_12346/
├── events.out.tfevents.1681125300
├── checkpoints/
│   ├── model_0.zip
│   ├── model_1000.zip
│   └── ...
└── logs.txt
```

### Example 4 — Evaluate a Grasp Policy

Once training is complete, evaluate the learned policy:

```bash
sbatch submit_job_slurm.sh --task AIR-v0-Grasp --headless
```

The evaluation will test the policy on unseen objects and report success rates.

---

## 6. Hands-On Exercises

### Exercise 1 — Explore the Container Interactively

1. Run `isaaclab-shell` to enter the container.
2. Navigate to `/MetaIsaacGrasp` and list the directory structure.
3. Check the Python version inside with `python --version`.
4. Verify Isaac Sim is available by running `python -c "import omni; print(omni.__version__)"`.
5. Exit the container with `exit`.

### Exercise 2 — Submit Your First Job

1. Edit `submit_job_slurm.sh` to set `EMAIL` and `GPU_TYPE` to match your cluster.
2. Submit a small data generation job: `sbatch submit_job_slurm.sh --task AIR-v0-Data --headless --num_envs 8`.
3. Check job status with `squeue -u $USER`.
4. Monitor the output log as it runs.
5. Once complete, check the output directory `~/isaaclab/logs/`.

### Exercise 3 — Understand the Bind Mounts

1. Run an interactive job: `srun --gres=gpu:a100:1 --cpus-per-task=4 --mem=16G --pty bash`.
2. Inside the container shell, inspect the mounted directories:
   - `ls -la /IsaacLab/logs/` (should match `~/isaaclab/logs/` on the host)
   - `ls -la /root/.cache/docker-isaac-sim/` (should match `~/.cache/docker-isaac-sim/`)
3. Exit the interactive session.

### Exercise 4 — Modify a Task

1. Open a MetaGrasp task file in an editor: `cat /MetaIsaacGrasp/tasks/AIR-v0-Data.py`.
2. Try a simple modification: change the number of environments or episode length.
3. Rebuild the container with `apptainer build --fakeroot ~/containers/isaaclab-metagrasp.sif isaaclab-metagrasp.def`.
4. Submit a job with the modified task and observe the differences.

---

## 7. Troubleshooting

### "Permission denied" or "Container build fails"

**Cause:** Your cluster may not have fakeroot enabled or you lack build permissions.

**Fix:** Contact your cluster administrator to enable fakeroot or request a pre-built container image.

### GPU not detected in the container

**Cause:** The `--nv` flag was not used when running the container.

**Fix:** Always include `--nv` with `apptainer exec`, `run`, or `shell` to enable GPU access:

```bash
apptainer exec --nv ${SIF_PATH} nvidia-smi
```

### "NGC pull fails" or "401 Unauthorized"

**Cause:** Your NGC credentials are invalid or expired.

**Fix:** Re-generate your NGC API key at https://ngc.nvidia.com/setup/api-key and update `~/.config/apptainer/docker-config.json`.

### Container build runs out of disk space

**Cause:** The container image (~35 GB) plus intermediate files exceed your available disk quota.

**Fix:** Check available space with `df -h`. If your home directory quota is full, ask your cluster admin about using `/scratch/` or a dedicated container storage partition.

### Job runs but produces no output

**Cause:** The Isaac Sim window/display is not configured correctly, or the simulation exited silently.

**Fix:** Always pass `--headless` for cluster jobs and check the log file for error messages:

```bash
tail -n 50 AIR-v0-Data_<jobid>.out
```

---

## 8. References

- [Apptainer Documentation](https://apptainer.org/docs/user/latest/)
- [NVIDIA Isaac Sim](https://developer.nvidia.com/isaac-sim)
- [IsaacLab Framework](https://isaaclab.readthedocs.io/)
- [SLURM Workload Manager](https://slurm.schedmd.com/)
- [NVIDIA NGC Documentation](https://docs.nvidia.com/ngc/)

---

## 9. Related Tutorials

- [[linux-permissions-beginner-guide|Linux Permissions]] — Understanding file permissions and ownership on HPC systems
- [[kubernetes-beginner-guide|Kubernetes]] — Alternative container orchestration for distributed simulation

---

## 10. Summary

**Key takeaways:**

- **IsaacLab** is a robotics simulation framework; **MetaGrasp** extends it with grasping and object datasets.
- **Apptainer** containers bundle your entire simulation environment, making it reproducible and portable across clusters.
- **SLURM** schedules your simulation jobs on shared HPC resources.
- Build once with `apptainer build`, then submit jobs with `sbatch` using the `.sif` image.
- Always use `--nv` to enable GPU access, `--headless` for cluster jobs, and `--bind` to mount data directories.
- Monitor jobs with `squeue` and `tail` on log files.

**Next steps:**

- Run your first data generation or training job using Example 2 or 3.
- Explore the MetaGrasp documentation to understand the available tasks and how to customize them.
- Learn about [[linux-permissions-beginner-guide|Linux Permissions]] to understand ownership and access control on your cluster.
- Investigate advanced container optimization and multi-GPU training in the [IsaacLab MetaGrasp Deep Dive](./isaaclab-metagrasp-apptainer-hpc-deep-dive.md).
# Related Tutorials

- [[hyperqueue-basics|HyperQueue Basics]] — meta-scheduler for efficient task dispatch on HPC clusters
- [[hyperqueue-deep-dive|HyperQueue Deep Dive]] — production HPC task scheduling with automatic Slurm allocation

- [[parsl-beginner-guide|Parsl Beginner Guide]] — Python-native parallel workflows on Slurm
- [[parsl-deep-dive|Parsl Deep Dive]] — advanced Parsl with MPI, containers, and production patterns

- [[cgroups-beginner-guide|Cgroups Beginner Guide]] — How Linux control groups manage container resources
- [[cgroups-deep-dive|Cgroups Deep Dive]] — Advanced cgroups and Slurm resource isolation

- [[docker-bake-beginner-guide|Docker Bake Beginner Guide]] — build amd64 Docker images on your Mac to pull via Singularity on the HPC cluster
- [[docker-bake-deep-dive|Docker Bake Deep Dive]] — production Docker build pipeline targeting Rocky Linux HPC environments
