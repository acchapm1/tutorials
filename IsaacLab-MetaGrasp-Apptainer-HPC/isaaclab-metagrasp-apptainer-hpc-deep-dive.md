---
title: "IsaacLab MetaGrasp with Apptainer on HPC: Deep Dive Reference"
date: 2026-04-10
difficulty: advanced
tags: [isaaclab, metagrasp, apptainer, hpc, slurm, nvidia, robotics, simulation, containers, urdf, gpu, optimization]
---

# IsaacLab MetaGrasp with Apptainer on HPC: Deep Dive Reference

## 1. Overview

This advanced guide provides a comprehensive reference for building, optimizing, and troubleshooting containerized robotics simulation workflows on HPC clusters. It covers the complete technical stack: container image design, URDF model conversion, GPU utilization, cluster optimization, and production deployment patterns.

This reference is designed for practitioners who already understand the basics (covered in the [beginner guide](./isaaclab-metagrasp-apptainer-hpc-beginner-guide.md)) and need to scale workflows, customize environments, or troubleshoot advanced scenarios. Topics include:

- Container build strategies (Apptainer `.def` vs. multi-stage Docker)
- URDF to USD conversion and the API compatibility workaround
- NGC authentication and image registry management
- Multi-GPU training and distributed simulation
- Performance profiling and cluster resource optimization
- Asset management and caching strategies
- Production deployment and CI/CD integration

---

## 2. Prerequisites

To follow this guide, you should have:

- **Hands-on experience** with the beginner guide — you have built and run the basic container, and submitted jobs
- **Linux system administration** skills — comfortable with SSH, shell scripting, `systemctl`, user/group management
- **Container familiarity** — understanding of how Apptainer works, Docker concepts, image layers
- **HPC cluster experience** — SLURM job scripts, resource requests, scratch storage, module systems
- **Robotics modeling basics** — familiarity with URDF/USD formats, mesh files, physics properties
- **Access to an HPC cluster** running Rocky Linux 8 or Ubuntu 22.04 with A100/H100 GPUs
- **Cluster admin contact** — you can reach your admin for quota increases, package installations, or debugging

---

## 3. Key Concepts

### 3.1 Container Image Architecture

The IsaacLab MetaGrasp container is a layered image with these logical components:

```
┌────────────────────────────────────────────────────┐
│ Layer: MetaIsaacGrasp application                  │
│   - Tasks (AIR-v0-Data, AIR-v0-SB3, etc.)         │
│   - Custom RL/imitation learning code             │
└────────────────────────────────────────────────────┘
↑
├────────────────────────────────────────────────────┐
│ Layer: Asset Data (models_ifl.zip, converted USD) │
│   - 8.2 GB of object models                       │
│   - Pre-converted USD collision meshes            │
└────────────────────────────────────────────────────┘
↑
├────────────────────────────────────────────────────┐
│ Layer: IsaacLab 2.0 Framework                     │
│   - Robot loaders, environment API                │
│   - RL task templates                             │
│   - Physics query API                             │
└────────────────────────────────────────────────────┘
↑
├────────────────────────────────────────────────────┐
│ Layer: Python + System Libraries                  │
│   - Python 3.10 runtime                           │
│   - scipy, numpy, pytorch, stable-baselines3      │
│   - Build tools, git, development headers         │
└────────────────────────────────────────────────────┘
↑
└────────────────────────────────────────────────────┐
│ Base: NVIDIA Isaac Sim 4.5.0 (~20 GB)             │
│   - Omniverse Kit runtime                         │
│   - Physics (PhysX), rendering (RTX)              │
│   - Nucleus asset client                          │
└────────────────────────────────────────────────────┘
```

Total image size: approximately 30–35 GB.

### 3.2 URDF Conversion: The API Mismatch Workaround

MetaGrasp ships with URDF object models but IsaacLab requires USD format. The conversion is non-trivial because the `isaaclab.sim.converters.UrdfConverter` API changed between IsaacLab 1.4 and 2.0.

**The problem:**

- IsaacLab 2.0 (latest) ships with Isaac Sim 4.5.0
- MetaGrasp's `urdf_converter.py` was designed for IsaacLab 1.4 + Isaac Sim 4.2.0
- Running the converter on 2.0 produces warnings and potentially incorrect collision meshes

**The solution — two approaches:**

**Approach 1: Apptainer `.def` single-stage build (used in the repository)**

- Clone IsaacLab 1.4 into a temporary venv inside the container
- Run conversion with 1.4's API (guaranteed correct, but some API compatibility risk)
- Delete the 1.4 venv after conversion to save ~2 GB
- Fall back to IsaacLab 2.0's converter if 1.4 fails

Pros: Single command, no Docker required on cluster.
Cons: Relies on Python-level API compatibility between 1.4 and 4.5.0 Isaac Sim.

**Approach 2: Multi-stage Docker build with proper stages**

```dockerfile
# Stage 1: URDF conversion with correct base
FROM nvcr.io/nvidia/isaac-sim:4.2.0 AS converter
RUN git clone https://github.com/NVIDIA-Omniverse/IsaacLab.git /IsaacLab-1.4 && \
    cd /IsaacLab-1.4 && \
    git checkout release/1.4 && \
    /isaac-sim/python.sh -m pip install -e . && \
    cd /MetaIsaacGrasp && \
    /isaac-sim/python.sh urdf_converter.py

# Stage 2: Final image with converted assets only
FROM nvcr.io/nvidia/isaac-sim:4.5.0
COPY --from=converter /MetaIsaacGrasp/models/models_ifl /MetaIsaacGrasp/models/models_ifl
# ... rest of setup ...
```

Pros: Guaranteed correct conversion, 4.2.0 base is immutable.
Cons: Requires Docker on a Linux machine (Mac M3 buildx can be used).

**Verification:**

After the build, verify USD conversion succeeded:

```bash
apptainer exec ${SIF_PATH} \
    find /MetaIsaacGrasp/models/models_ifl -name "orbit_obj.usd" | wc -l
```

Should output a count equal to the number of object directories. If 0, the conversion failed silently.

### 3.3 NGC Registry and Container Image Management

NVIDIA GPU Cloud (NGC) is a registry for GPU-accelerated containers and models. IsaacLab and Isaac Sim containers require NGC authentication but provide the most optimized, production-ready images.

**Image discovery:**

```bash
# Search for available Isaac Sim versions
apptainer search nvcr.io/nvidia/isaac-sim
```

**Credential files:**

Apptainer reads authentication from `~/.config/apptainer/docker-config.json`:

```json
{
  "auths": {
    "nvcr.io": {
      "auth": "base64(username:password)",
      "identitytoken": "optional-token"
    }
  }
}
```

For NGC, the username is `$oauthtoken` (literal) and the password is your API key.

**Caching and disk usage:**

```bash
# Check Apptainer cache directory
du -sh ~/.cache/apptainer/

# Clear old cached images
apptainer cache clean
```

### 3.4 GPU Optimization and Binding

The `--nv` flag in `apptainer exec/run/shell` passes the host's GPU drivers and NVIDIA libraries into the container.

**GPU access chain:**

```
Host GPU device → NVIDIA driver → Container --nv mount → libnvidia-ml.so
                                                       → libcuda.so
                                                       → libcudart.so
                                                       (in /usr/local/cuda/lib64)
```

**Performance considerations:**

- **GPU selection:** CUDA devices are numbered 0, 1, 2, etc. on the host. Inside the container with `--nv`, they appear with the same numbering.
- **Memory pressure:** Large simulations fill GPU VRAM. Monitor with `nvidia-smi` inside the container.
- **P2P (peer-to-peer) access:** On modern clusters with NVLink, you can enable GPU–GPU direct communication for better multi-GPU scaling.
- **CUDA version mismatch:** Ensure the container's CUDA version is compatible with the host driver. Typically, drivers support 2–3 versions of CUDA forward and backward.

### 3.5 Multi-GPU Training and Distributed Simulation

IsaacLab natively supports multiple GPU environments. When you request multiple GPUs, the physics engine automatically distributes environments across them.

**Multi-GPU allocation in SLURM:**

```bash
sbatch --gres=gpu:a100:4 --cpus-per-task=16 --mem=128G script.sh
```

**Inside the container, use all GPUs:**

```python
# pseudocode in IsaacLab task
env = IsaacLabEnv(
    num_envs=512,  # Total environments
    device="cuda",  # IsaacLab will auto-distribute across available GPUs
)
```

**Performance profiling:**

```bash
apptainer exec --nv ${SIF_PATH} python -c "
import torch
print(f'CUDA available: {torch.cuda.is_available()}')
print(f'GPU count: {torch.cuda.device_count()}')
for i in range(torch.cuda.device_count()):
    print(f'GPU {i}: {torch.cuda.get_device_name(i)}')
"
```

---

## 4. Step-by-Step Instructions

### 4.1 Advanced Container Build with Custom Base Image

If you need to customize the Isaac Sim base image or use a different version:

```bash
# Create a custom Dockerfile
cat > Dockerfile.custom <<'EOF'
ARG BASE_IMAGE=nvcr.io/nvidia/isaac-sim:4.5.0
FROM ${BASE_IMAGE}

# Custom system packages
RUN apt-get update && apt-get install -y \
    graphviz \
    htop \
    && rm -rf /var/lib/apt/lists/*

# Custom Python packages
RUN /isaac-sim/python.sh -m pip install --upgrade \
    tensorboard \
    wandb

EOF

# Build with Docker and convert to Apptainer
docker buildx build \
    --platform linux/amd64 \
    -t myregistry/isaaclab-metagrasp:custom \
    -f Dockerfile.custom .

# On the cluster, pull and convert
apptainer pull docker://myregistry/isaaclab-metagrasp:custom
mv isaaclab-metagrasp_custom.sif ~/containers/isaaclab-metagrasp-custom.sif
```

### 4.2 Manual URDF Conversion for Debugging

If the container build fails to convert URDFs, run the converter manually:

```bash
# Request an interactive GPU node
srun --gres=gpu:a100:1 --cpus-per-task=8 --mem=32G --pty bash

# Enter the container
apptainer exec --nv ${SIF_PATH} bash

# Inside the container, run the converter with verbose logging
cd /MetaIsaacGrasp
/isaac-sim/python.sh urdf_converter.py 2>&1 | tee /tmp/conversion.log

# Check for errors
grep -i "error\|warning" /tmp/conversion.log

# Exit container and check output
exit
apptainer exec ${SIF_PATH} ls -la /MetaIsaacGrasp/models/models_ifl/ | head -20
```

### 4.3 Bind-Mount Assets to Reduce Image Size

If 30+ GB is too large, separate assets from the image:

```bash
# Download assets locally (one-time, on a machine with 100+ GB free)
wget https://nextcloud.example.com/models_ifl.zip
unzip -q models_ifl.zip
mv models_ifl /scratch/${USER}/models_ifl

# Modify isaaclab-metagrasp.def: remove the %post section that downloads assets

# Build a slimmer image (~23 GB instead of 35 GB)
apptainer build --fakeroot ~/containers/isaaclab-metagrasp-slim.sif isaaclab-metagrasp.def

# Run jobs with bind mount
apptainer exec --nv \
    --bind /scratch/${USER}/models_ifl:/MetaIsaacGrasp/models/models_ifl \
    ~/containers/isaaclab-metagrasp-slim.sif \
    python /MetaIsaacGrasp/tasks/AIR-v0-Data.py
```

### 4.4 Configure Asset Caching for Faster Job Startup

Isaac Sim downloads nucleus assets on first run, which can take 5–10 minutes. Cache them to speed up subsequent jobs:

```bash
# Pre-populate cache with a test job
srun --gres=gpu:a100:1 --cpus-per-task=4 --mem=16G --pty bash

apptainer exec --nv \
    --bind ~/.cache/docker-isaac-sim:/root/.cache/docker-isaac-sim \
    --env OMNI_KIT_ALLOW_ROOT=1 \
    --env ACCEPT_EULA=Y \
    ${SIF_PATH} \
    python -c "
import omni
# This triggers asset download
from omni.kit.scripting import get_app
"

# Exit and verify cache was populated
ls -lh ~/.cache/docker-isaac-sim/
```

Now future jobs will reuse this cache via the bind mount in your SLURM script.

### 4.5 Set Up Multi-GPU Training with Data Parallelism

IsaacLab's environments automatically distribute across GPUs, but for reinforcement learning with frameworks like Stable Baselines3:

```python
# Inside your MetaGrasp task script
import torch
from stable_baselines3 import PPO
from isaaclab.envs import IsaacLabEnv

def train_multi_gpu():
    # Detect GPUs
    num_gpus = torch.cuda.device_count()
    print(f"Training with {num_gpus} GPUs")
    
    # Create environment with all GPUs
    env = IsaacLabEnv(
        task="AIR-v0-SB3",
        num_envs=256 * num_gpus,  # Scale envs by GPU count
        device="cuda",
    )
    
    # PPO will use all available GPUs
    model = PPO(
        "MlpPolicy",
        env,
        verbose=1,
        device="cuda",
        n_steps=2048,
    )
    
    model.learn(total_timesteps=1_000_000)
    model.save("ppo_metagrasp_multi_gpu")

if __name__ == "__main__":
    train_multi_gpu()
```

Submit with 4 GPUs:

```bash
sbatch --gres=gpu:a100:4 --cpus-per-task=16 --mem=128G submit_job_slurm.sh \
    --task AIR-v0-SB3 --headless --num_envs 256
```

### 4.6 Profile Performance and Identify Bottlenecks

Use profiling tools to understand where time is spent:

```bash
# Python profiling with cProfile
apptainer exec --nv ${SIF_PATH} python -m cProfile -s cumtime \
    /MetaIsaacGrasp/tasks/AIR-v0-Data.py 2>&1 | head -30

# Expected output
#          ncalls  tottime  cumtime
# 100000    0.234   45.234    45.234 simulation_step()
#  50000    0.456   23.456    35.678 compute_observations()
#  50000    0.123    5.678     9.012 physics_update()
```

GPU profiling with NVIDIA Nsight:

```bash
apptainer exec --nv \
    --bind /usr/local/cuda:/usr/local/cuda \
    ${SIF_PATH} \
    /usr/local/cuda/bin/ncu \
    --set full \
    python /MetaIsaacGrasp/tasks/AIR-v0-Data.py
```

### 4.7 Production Deployment: Registry, Versioning, and CI/CD

For production use, tag and registry-manage your images:

```bash
# Build with version tag
apptainer build --fakeroot \
    ~/containers/isaaclab-metagrasp-v2.0.sif \
    isaaclab-metagrasp.def

# Push to a private registry (if available on your cluster)
apptainer push isaaclab-metagrasp-v2.0.sif \
    oras://myregistry.example.com/isaaclab-metagrasp:v2.0

# Later, pull and run
apptainer pull \
    oras://myregistry.example.com/isaaclab-metagrasp:v2.0

# Verify image integrity
apptainer verify isaaclab-metagrasp-v2.0.sif
```

**GitHub Actions CI/CD example:**

```yaml
name: Build and Push IsaacLab Container
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Build Dockerfile (Docker)
        run: |
          docker buildx build \
            --platform linux/amd64 \
            -t ghcr.io/yourorg/isaaclab-metagrasp:${{ github.sha }} \
            -f Dockerfile.urdf-converter .
      
      - name: Push to GitHub Container Registry
        run: |
          echo ${{ secrets.GITHUB_TOKEN }} | docker login ghcr.io -u $ --password-stdin
          docker push ghcr.io/yourorg/isaaclab-metagrasp:${{ github.sha }}
```

On the cluster, pull and convert once:

```bash
apptainer pull docker://ghcr.io/yourorg/isaaclab-metagrasp:sha123
```

---

## 5. Practical Examples

### Example 1 — Debugging a Failed URDF Conversion

**Scenario:** You updated MetaGrasp's URDF files, rebuilt the container, and now `orbit_obj.usd` counts as 0.

**Investigation:**

```bash
# Check conversion logs
apptainer exec ${SIF_PATH} cat /tmp/conversion.log | head -50

# Run conversion manually in verbose mode
srun --gres=gpu:a100:1 --cpus-per-task=4 --mem=16G --pty bash
apptainer exec --nv ${SIF_PATH} bash -c "
    cd /MetaIsaacGrasp && \
    /isaac-sim/python.sh -u urdf_converter.py 2>&1 | tee /tmp/conv_debug.log
"
grep -A 5 "Error\|Traceback" /tmp/conv_debug.log

# If API mismatch error appears, use the multi-stage Docker approach
```

### Example 2 — Optimizing Multi-GPU Training with Mixed Precision

IsaacLab supports mixed precision training (float16) for faster GPU computation:

```python
# Inside your task script
import torch
from torch.cuda.amp import autocast
from isaaclab.envs import IsaacLabEnv

def train_with_mixed_precision():
    env = IsaacLabEnv(task="AIR-v0-SB3", device="cuda")
    
    # Enable mixed precision
    torch.set_float32_matmul_precision('high')
    
    model = PPO(
        "MlpPolicy",
        env,
        verbose=1,
        device="cuda",
        learning_rate=3e-4,
        # Mixed precision reduces memory by ~40%
    )
    
    model.learn(total_timesteps=1_000_000)
```

Measure the speedup:

```bash
# Baseline (float32)
sbatch --gres=gpu:a100:1 job1.sh > job1.log
# Mixed precision (float16)
sbatch --gres=gpu:a100:1 job2.sh > job2.log

# Compare timing
grep "Training time:" job1.log job2.log
```

### Example 3 — Batch Processing Multiple Tasks

Run multiple simulation tasks in parallel using a job array:

```bash
#!/bin/bash
#SBATCH --job-name=metagrasp-array
#SBATCH --array=0-9%4        # 10 jobs, 4 running at once
#SBATCH --gres=gpu:a100:1
#SBATCH --time=2:00:00

TASK_SEED=$((SLURM_ARRAY_TASK_ID + 1000))
OUTPUT_DIR="${HOME}/isaaclab/logs/task_${SLURM_ARRAY_TASK_ID}"
mkdir -p ${OUTPUT_DIR}

apptainer exec --nv \
    --bind ${HOME}/isaaclab/logs:/IsaacLab/logs \
    --bind ${HOME}/.cache/docker-isaac-sim:/root/.cache/docker-isaac-sim \
    --env OMNI_KIT_ALLOW_ROOT=1 \
    --env ACCEPT_EULA=Y \
    ${SIF_PATH} \
    python /MetaIsaacGrasp/tasks/AIR-v0-Data.py \
    --seed ${TASK_SEED} \
    --output ${OUTPUT_DIR}

echo "Task ${SLURM_ARRAY_TASK_ID} complete"
```

Submit:

```bash
sbatch array_jobs.sh
```

Monitor:

```bash
squeue -u $USER -l  # Shows array job breakdown
```

### Example 4 — Checkpoint and Resume Long-Running Training

For multi-day training jobs, save checkpoints and resume gracefully:

```python
# Inside your training task
import os
from stable_baselines3 import PPO
from isaaclab.envs import IsaacLabEnv

def train_with_checkpoints():
    env = IsaacLabEnv(task="AIR-v0-SB3", device="cuda")
    
    checkpoint_dir = "/IsaacLab/logs/checkpoints"
    os.makedirs(checkpoint_dir, exist_ok=True)
    
    # Load or create model
    checkpoint_path = f"{checkpoint_dir}/ppo_latest.zip"
    if os.path.exists(checkpoint_path):
        model = PPO.load(checkpoint_path, env=env)
        print(f"Resumed from {checkpoint_path}")
    else:
        model = PPO("MlpPolicy", env, verbose=1, device="cuda")
    
    # Train in chunks with save
    for i in range(10):
        model.learn(total_timesteps=100_000, progress_bar=True)
        model.save(f"{checkpoint_dir}/ppo_step_{i*100000}")
        print(f"Saved checkpoint {i}")
    
    model.save(f"{checkpoint_dir}/ppo_final")

if __name__ == "__main__":
    train_with_checkpoints()
```

---

## 6. Hands-On Exercises

### Exercise 1 — Custom Base Image Build

1. Create a custom `Dockerfile` that adds your own system package.
2. Build it with Docker or Docker buildx.
3. Push to a registry.
4. On the cluster, pull and convert to Apptainer.
5. Run a job with the custom image.

### Exercise 2 — Multi-GPU Scaling Benchmark

1. Submit training jobs requesting 1, 2, and 4 GPUs respectively.
2. Record the wall-clock training time and samples/second throughput for each.
3. Calculate the GPU efficiency: (single-GPU throughput) × (# GPUs) / (multi-GPU throughput).
4. Plot or report the results.

### Exercise 3 — Asset Cache Impact

1. Delete `~/.cache/docker-isaac-sim`.
2. Submit a job and time how long it takes to start (will include asset download).
3. Repopulate the cache using the instructions in Section 4.4.
4. Submit an identical job and time the startup.
5. Report the difference.

### Exercise 4 — URDF Conversion Workaround Testing

1. Clone IsaacLab 1.4 locally.
2. Create a small test URDF.
3. Convert it with both IsaacLab 1.4 and 2.0.
4. Inspect the resulting USD files and compare collision mesh fidelity.
5. Document any differences.

### Exercise 5 — Performance Profiling

1. Run `nvidia-smi` in a loop inside the container during a simulation.
2. Record GPU utilization, memory usage, and temperature.
3. Identify periods of underutilization and hypothesize why.
4. Try adjusting `num_envs` and re-profile.

---

## 7. Troubleshooting

### URDF conversion produces 0 USD files

**Cause:** Both the IsaacLab 1.4 venv fallback and 2.0 converter failed silently.

**Debug steps:**

1. Run conversion manually with verbose logging (Section 4.2).
2. Check `/tmp/conversion.log` inside the container for `AttributeError` or `ImportError`.
3. If 1.4 venv fails, use the multi-stage Docker approach (Section 3.2).

```bash
# Verify conversion inside container
apptainer exec --nv ${SIF_PATH} bash -c "
    cd /MetaIsaacGrasp && \
    find models/models_ifl -name 'orbit_obj.usd' | wc -l
"
```

### Multi-GPU training shows poor scaling

**Cause:** Communication bottleneck, unbalanced load, or suboptimal task size.

**Diagnose:**

```bash
# Check P2P access
apptainer exec --nv ${SIF_PATH} python -c "
import torch
for i in range(torch.cuda.device_count()):
    for j in range(torch.cuda.device_count()):
        if i != j:
            print(f'GPU {i}->{j} P2P:', torch.cuda.can_device_access_peer(i, j))
"

# Profile individual GPU utilization
watch -n 1 'nvidia-smi --query-gpu=index,utilization.gpu,utilization.memory --format=csv,noheader'
```

If P2P is disabled, contact your cluster admin.

### Job fails with "CUDA out of memory"

**Cause:** `num_envs` is too large for available GPU memory.

**Fix:**

```bash
# Check GPU VRAM
apptainer exec --nv ${SIF_PATH} nvidia-smi --query-gpu=memory.total --format=csv,noheader

# Reduce num_envs
sbatch submit_job_slurm.sh --task AIR-v0-Data --headless --num_envs 32  # Reduce from 64

# Monitor memory during job
apptainer exec --nv ${SIF_PATH} watch -n 5 nvidia-smi
```

### Container image is larger than quota

**Cause:** 30–35 GB exceeds your home directory quota.

**Solutions:**

1. Request quota increase from cluster admin.
2. Use bind-mount assets (Section 4.3) to reduce image to ~23 GB.
3. Store image on `/scratch/` instead of home:

```bash
# Move image
mv ~/containers/isaaclab-metagrasp.sif /scratch/${USER}/
export SIF_PATH="/scratch/${USER}/isaaclab-metagrasp.sif"
```

### Apptainer exec hangs on first use

**Cause:** Initial bind-mount setup or filesystem check takes time on some clusters.

**Workaround:**

```bash
# Increase timeout on interactive runs
timeout 120 apptainer exec --nv ${SIF_PATH} python --version

# For batch jobs, add a sleep buffer in the SLURM script
sleep 10
apptainer exec --nv ${SIF_PATH} python /path/to/task.py
```

### NGC authentication expires mid-build

**Cause:** NGC API key is invalidated or token expires during a 2-hour build.

**Prevention:**

```bash
# Use a personal access token instead of API key (longer TTL)
# Update ~/.config/apptainer/docker-config.json with the new token
# Verify before building
apptainer pull docker://nvcr.io/nvidia/isaac-sim:4.5.0
```

---

## 8. References

- [Apptainer Documentation](https://apptainer.org/docs/)
- [NVIDIA Isaac Sim 4.5.0 Release Notes](https://docs.omniverse.nvidia.com/app_isaacsim/app_isaacsim/release_notes.html)
- [IsaacLab 2.0 API Documentation](https://isaaclab.readthedocs.io/)
- [URDF Specification (ROS)](http://wiki.ros.org/urdf/XML)
- [SLURM Advanced Topics](https://slurm.schedmd.com/sbatch.html)
- [NVIDIA CUDA Toolkit Documentation](https://docs.nvidia.com/cuda/)
- [Docker Multi-Stage Builds](https://docs.docker.com/build/building/multi-stage/)

---

## 9. Related Tutorials

- [[linux-permissions-beginner-guide|Linux Permissions]] — User/group management on HPC clusters
- [[kubernetes-beginner-guide|Kubernetes]] — Alternative orchestration for distributed containerized workloads

---

## 10. Summary

**Key takeaways:**

- **Container architecture** is layered: Isaac Sim base (20 GB) → frameworks (2 GB) → assets (8.2 GB) → application.
- **URDF conversion** requires careful API management; prefer multi-stage Docker for production (Approach 2 in Section 3.2).
- **NGC registry** requires API key authentication; credentials expire during long builds — use personal access tokens.
- **Multi-GPU training** leverages IsaacLab's native environment distribution; scale `num_envs` with GPU count.
- **Asset caching** (bind-mounted `~/.cache/docker-isaac-sim/`) speeds up job startup 5–10×.
- **Mixed precision training** (float16) reduces memory and improves throughput by ~40%.
- **Profiling and monitoring** with `nvidia-smi`, cProfile, and NVIDIA Nsight reveal bottlenecks.
- **Production deployment** uses versioned container images, registries, and CI/CD pipelines.

**Next steps:**

- Optimize your container build pipeline with multi-stage Docker and registry management.
- Scale to multi-GPU training with data parallelism (Section 4.5).
- Profile your specific workload and apply mixed-precision or other performance optimizations (Examples 2, 3, 4).
- Integrate container builds into CI/CD to automate versioning and testing (Section 4.7).
- Document your cluster's specific configuration (NGC mirror, module system, quotas) for your team.
# Related Tutorials

- [[hyperqueue-basics|HyperQueue Basics]] — meta-scheduler for packing many small tasks into Slurm allocations
- [[hyperqueue-deep-dive|HyperQueue Deep Dive]] — automatic allocation, fractional GPUs, and production HPC scheduling

- [[parsl-beginner-guide|Parsl Beginner Guide]] — Python-native parallel workflows on Slurm
- [[parsl-deep-dive|Parsl Deep Dive]] — advanced Parsl with MPI, containers, and production patterns
