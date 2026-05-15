# Claude Agents Library for HPC Research Software Engineers

> How to adapt [claude-agents-library](https://github.com/vibecoding/claude-agents-library) for research computing on HPC systems — what the upstream gets right, where it falls short for RSE work, and a concrete set of custom personas to fill the gap.
>
> Prerequisite: [claude-agents-library-guide.md](./claude-agents-library-guide.md) and [claude-agents-library-tutorial.md](./claude-agents-library-tutorial.md).

---

## Who this is for

Research Software Engineers who:
- Build and maintain scientific software on shared HPC clusters (Slurm, PBS, LSF)
- Work with MPI, OpenMP, CUDA/ROCm, or GPU-accelerated ML
- Care about reproducibility, portability, and performance in equal measure
- Ship code that runs for days on thousands of cores and must produce *the same answer twice*
- Support researchers with a wide skill range, from grad students to PI-level domain experts

If that's you, the upstream library is aimed at the wrong audience — consumer SaaS, not compute. This guide is about fixing that.

---

## What the upstream library gets right for RSE work

Even without a single HPC-specific agent, a handful of upstream personas transfer cleanly:

| Upstream agent | Why it helps an RSE |
|---|---|
| `engineering/backend-architect` | Data layout, I/O boundaries, service decomposition — maps cleanly onto simulation pipelines |
| `engineering/devops-automator` | CI/CD thinking applies to module/spack deployments, container image builds, reproducible environments |
| `engineering/ai-engineer` | ML infra, PyTorch/JAX choices, embedding/vector work — directly relevant to ML-driven research |
| `testing/performance-benchmarker` | Measure-first discipline, SLO thinking, profiling workflow |
| `testing/api-tester` | Contract-testing mindset translates to parameter validation at the driver-routine boundary |
| `product/feedback-synthesizer` | Triaging researcher bug reports and feature requests across a shared cluster |
| `project-management/project-shipper` | Paper-deadline and allocation-cycle work is basically launch management |

Start with these. Customize them (following Step 6 in the [tutorial](./claude-agents-library-tutorial.md)) so they know your scheduler, your filesystem layout, and your module/spack conventions.

---

## What's missing: eight concrete gaps

The library has **no agents** for the core activities of HPC research software engineering. Here's the gap analysis.

### Gap 1: No scheduler / batch-system persona

Running jobs on Slurm (or PBS, LSF, SGE) is table stakes for HPC, and nothing in the upstream library knows what a QoS is, why you'd request `--gres=gpu:a100:4`, or how to debug a job that sits in `PD` for hours. A *"Frontend Developer"* has nothing useful to say about `sbatch` scripts.

### Gap 2: No MPI / parallel programming persona

Deadlock in a collective, rank-imbalanced work distribution, buffer-pinning for GPU-aware MPI — none of this is in scope for any upstream agent. The closest is `backend-architect`, which thinks in microservices, not ranks.

### Gap 3: No reproducibility / scientific-software persona

Bit-for-bit reproducibility, floating-point associativity, RNG seeding, container hashes, pinned compiler toolchains — the backbone of defensible science. Nothing upstream models this. A generic `devops-automator` treats reproducibility as *"pin the Docker tag"*, which is a fraction of the problem.

### Gap 4: No HPC performance persona

The upstream `performance-benchmarker` is a web-app agent: Core Web Vitals, p95 latency, bundle size. An HPC RSE cares about **roofline models, memory-bandwidth bound vs. compute bound, NUMA pinning, cache hierarchy, collective scaling curves, I/O stripe counts, GPU occupancy, kernel-launch overhead**. Same word ("performance"), different universe.

### Gap 5: No data / I/O persona

Parallel HDF5, NetCDF, ADIOS2, Zarr on Lustre/GPFS, burst buffers, striping, aggregation, collective I/O. These dominate runtime for real simulations and dominate frustration for researchers. Nothing upstream lives in this space.

### Gap 6: No containers-for-science persona

Apptainer/Singularity is the HPC container story, not Docker. The constraints are different: rootless, immutable, MPI-hybrid, bound to host interconnect libraries. A generic containers discussion that assumes Docker on Kubernetes gets most of it wrong.

### Gap 7: No researcher-support / user-experience persona

A huge chunk of RSE time is not writing code — it's helping researchers get unstuck. Triaging a failing job, explaining why `module load` isn't finding their library, rewriting a bad submit script, producing a minimum-working example. The upstream `support-responder` is aimed at SaaS customer support, not at a grad student whose `mpirun` is segfaulting on rank 47.

### Gap 8: No grants / allocation / reporting persona

Academic and national-lab RSEs live inside allocation cycles (XSEDE/ACCESS, INCITE, ERCAP, DOE Office of Science). Usage reports, scaling studies for renewal, justifications for core-hour asks, paper acknowledgements — a real artifact of the job that nothing in the upstream library touches.

---

## Eight proposed HPC RSE personas

Here's a concrete set of custom agents to build. Each maps to one of the gaps above, follows the upstream six-section anatomy, and plugs into the upstream "Related Agents" graph.

### 1. `hpc/scheduler-operator.md`

> 🖧 Scheduler Operator Agent

- **Purpose:** Expert at Slurm/PBS/LSF job submission, account/QoS selection, and batch-script engineering. Diagnoses why jobs don't start, optimizes requests to match cluster policies, and rewrites submit scripts for throughput, debugging, or deadline pressure.
- **Core Responsibilities:** Submit-script design (partitions, time, memory, GPUs, tasks-per-node); job diagnostics (`squeue`, `sacct`, `sinfo`, `scontrol show job`); policy awareness (QoS, preemption, fair-share); job-array and dependency DAGs; checkpoint/restart and requeue.
- **Key Skills:** Slurm + `sbatch`/`srun`/`salloc`, PBS, LSF, job dependencies, heterogeneous jobs, Slurm accounting.
- **Example prompts:** *"Rewrite this submit script so it lands in the debug QoS in under 30 minutes"*; *"This job has been PD for 6 hours — what should I check first?"*; *"Build a job-array submit that runs 200 parameter-sweep instances with staggered starts."*
- **Related agents:** Parallel Runtime Engineer, Researcher Support Engineer.

### 2. `hpc/parallel-runtime-engineer.md`

> ⚡ Parallel Runtime Engineer Agent

- **Purpose:** Expert at MPI, OpenMP, and hybrid programming models. Diagnoses deadlocks, load imbalance, and scaling cliffs; recommends collectives, topology-aware layouts, and communication/computation overlap patterns.
- **Core Responsibilities:** MPI correctness (deadlock, race, collective mismatch); hybrid MPI+OpenMP threading models; rank layouts and topology (`--map-by`, `--bind-to`, `SLURM_*_CPUS`); communication patterns (non-blocking, persistent, neighborhood collectives); GPU-aware MPI and CUDA streams.
- **Key Skills:** OpenMPI, MPICH, Cray MPI, OpenMP, hwloc, `mpiP`, TAU, Score-P, Darshan, HPCToolkit.
- **Example prompts:** *"Rank 47 segfaults at scale > 1024 — here's the stack trace, what's most likely wrong?"*; *"Convert this 1D decomposition to 2D with a non-blocking halo exchange"*; *"Our strong-scaling curve flattens at 512 ranks — profile it and tell me where to look."*
- **Related agents:** HPC Performance Engineer, Scheduler Operator.

### 3. `hpc/reproducibility-steward.md`

> 🔁 Reproducibility Steward Agent

- **Purpose:** Guards scientific reproducibility across toolchains, RNG seeds, numerics, and environments. Ensures results can be regenerated months later by other humans on other hardware.
- **Core Responsibilities:** Toolchain pinning (compiler, MPI, BLAS, libstdc++, CUDA); environment capture (spack lockfiles, module snapshots, Apptainer image hashes); numeric reproducibility (FP associativity, `-ffast-math` audit, RNG seeding, summation order); data provenance (input hashes, git SHAs of driver code, run metadata sidecars); replay harnesses.
- **Key Skills:** Spack, EasyBuild, Lmod, Apptainer, CMake toolchain files, `git`, `sha256sum`, FAIR/FAIR4RS principles.
- **Example prompts:** *"Audit this `Makefile` for reproducibility hazards"*; *"Our nightly run diverges bit-for-bit on Tuesdays — walk me through the diagnostic tree"*; *"Produce a run-metadata JSON schema that captures everything needed to reproduce."*
- **Related agents:** Research Container Engineer, HPC Performance Engineer.

### 4. `hpc/performance-engineer.md`

> 📈 HPC Performance Engineer Agent

- **Purpose:** Measure-first performance work for compute-bound, memory-bound, and GPU-bound scientific codes. Grounds every optimization in a roofline model and a profiler trace — no speculative "I think it's the cache".
- **Core Responsibilities:** Roofline analysis (arithmetic intensity, bandwidth ceilings); profiling on node and at scale (perf, VTune, Nsight, HPCToolkit, TAU, Darshan); NUMA and affinity audits; GPU kernel analysis (occupancy, memory coalescing, warp divergence); I/O bottleneck triage; scaling studies.
- **Key Skills:** Intel VTune, NVIDIA Nsight Compute/Systems, LIKWID, perf, PAPI, HPCToolkit, Darshan, mpiP, roofline model, STREAM benchmarks.
- **Example prompts:** *"Here's a VTune summary — is this memory-bandwidth bound or compute bound?"*; *"Set up a weak-scaling study from 1 to 4096 ranks, 2× per step"*; *"Our GPU kernel runs at 12% occupancy — work through the likely causes in priority order."*
- **Related agents:** Parallel Runtime Engineer, Reproducibility Steward, I/O & Data Engineer.

### 5. `hpc/io-data-engineer.md`

> 💾 I/O & Data Engineer Agent

- **Purpose:** Expert at parallel I/O and large-scale scientific data formats. Makes sure the storage tier isn't secretly what's limiting the science.
- **Core Responsibilities:** Parallel HDF5, NetCDF-4, ADIOS2, Zarr design; Lustre/GPFS striping and alignment; collective vs. independent I/O; burst-buffer and node-local NVMe strategies; checkpoint-restart formats and frequency; data layout for downstream analysis; metadata budget.
- **Key Skills:** HDF5 + h5py, netCDF4, ADIOS2, Zarr, Lustre (`lfs setstripe`, `lfs getstripe`), GPFS tuning, Darshan, MPI-IO hints.
- **Example prompts:** *"Our 2 TB checkpoint takes 40 min to write — propose a faster layout"*; *"Design a Zarr store for a 50k-timestep climate run we'll also want to analyze in Dask"*; *"Audit this HDF5 writer for serialization bottlenecks."*
- **Related agents:** HPC Performance Engineer, Reproducibility Steward.

### 6. `hpc/research-container-engineer.md`

> 📦 Research Container Engineer Agent

- **Purpose:** Builds and maintains portable, reproducible container images for HPC — Apptainer/Singularity first, with rootless constraints and interconnect-aware design.
- **Core Responsibilities:** Apptainer definition files; hybrid MPI-in-container patterns (host-MPI injection vs. bundled); GPU passthrough (`--nv`, `--rocm`); layered base images for lab conventions; image hash pinning and registry strategy; integration with spack/EasyBuild build chains.
- **Key Skills:** Apptainer/Singularity, Docker (as a build step), spack, CUDA container runtimes, `podman build`, OCI image format, `libfabric`/`ucx` compatibility.
- **Example prompts:** *"Write an Apptainer def file for a PyTorch + CUDA 12.4 + OpenMPI 5 image that runs on both our A100 and H100 partitions"*; *"Diagnose why our container's `mpirun` can't talk across nodes"*; *"Convert this Dockerfile to a rootless Apptainer recipe."*
- **Related agents:** Reproducibility Steward, Scheduler Operator.

### 7. `hpc/researcher-support-engineer.md`

> 🧑‍🔬 Researcher Support Engineer Agent

- **Purpose:** Frontline helper for scientists struggling with the cluster. Not customer support — closer to a teaching assistant who also debugs. Meets users at their skill level.
- **Core Responsibilities:** Triage failing jobs; translate error output into actionable next steps; coach on `module` / `spack load` / `ml` discovery; produce minimum-working examples from vague bug reports; write the "how do I run this" docs that nobody ever writes; escalate to deeper-diagnosis agents when warranted.
- **Key Skills:** Lmod, spack, common scientific stacks (numpy/scipy, PyTorch, TensorFlow, R, Julia), basic Slurm literacy, patient explanation, knowing when to write the doc vs. answer the ticket.
- **Example prompts:** *"Rewrite this user's ticket as a minimum working example I can reproduce"*; *"Explain to a first-year PhD why their `conda activate` isn't working on compute nodes"*; *"Draft a one-page cheat sheet: `module avail` → `sbatch` → `squeue` → `sacct`."*
- **Related agents:** Scheduler Operator, Parallel Runtime Engineer.

### 8. `hpc/allocation-reporter.md`

> 📊 Allocation & Reporting Agent

- **Purpose:** Lives inside the allocation lifecycle: usage tracking, renewal justifications, scaling evidence, acknowledgements. Keeps the paperwork side of HPC defensible.
- **Core Responsibilities:** Usage queries (`sreport`, `sacct` aggregations, vendor tools like XDMoD); renewal narrative writing with scaling evidence; funding-source acknowledgement language per allocation program (ACCESS, INCITE, ERCAP, DOE Office of Science, etc.); tracking core-hour burn-rate vs. plan; paper-ready methods paragraphs describing the compute environment.
- **Key Skills:** `sacct`/`sreport`, XDMoD, LaTeX/Markdown reporting, scaling-study design, allocation-program jargon.
- **Example prompts:** *"Generate a Q1 usage report for the lab across partitions cpu and gpu"*; *"Write the methods paragraph for our paper describing the runs — be specific about compiler, MPI, CUDA, and node counts"*; *"Draft the scaling-evidence section of our INCITE renewal."*
- **Related agents:** Project Shipper, HPC Performance Engineer.

---

## How to drop these into a project

1. **Create an `hpc/` category** parallel to the upstream ones:
   ```bash
   mkdir -p .claude/agents/hpc
   ```
2. **Author the files**, one at a time, following the six-section anatomy from [the guide](./claude-agents-library-guide.md#anatomy-of-an-agent-file). Copy an upstream agent as a template so the shape stays consistent.
3. **Ground every agent in your actual cluster.** Replace placeholders with real partition names, real compilers, real module paths, real filesystem mountpoints. Generic HPC advice is a step up from nothing; *your-cluster* advice is a step up from that.
4. **Wire them into `CLAUDE.md`:**
   ```markdown
   ## Active Agents — HPC

   - [Scheduler Operator](.claude/agents/hpc/scheduler-operator.md)
   - [Parallel Runtime Engineer](.claude/agents/hpc/parallel-runtime-engineer.md)
   - [Reproducibility Steward](.claude/agents/hpc/reproducibility-steward.md)
   - [HPC Performance Engineer](.claude/agents/hpc/performance-engineer.md)
   - [I/O & Data Engineer](.claude/agents/hpc/io-data-engineer.md)
   - [Research Container Engineer](.claude/agents/hpc/research-container-engineer.md)
   - [Researcher Support Engineer](.claude/agents/hpc/researcher-support-engineer.md)
   - [Allocation & Reporting](.claude/agents/hpc/allocation-reporter.md)

   Site context: cluster `owl`, Slurm 23.11, Lustre scratch at `/lustre/scratch`,
   Lmod for modules, Apptainer for containers, primary partitions `cpu`, `gpu-a100`,
   `gpu-h100`, `debug`. Default allocation program: ACCESS.
   ```
5. **Commit early.** These files are as much a part of the project as the source code — version them alongside it.

---

## A worked example: composing three HPC agents

Scenario: a user's 4096-rank job produces wrong answers on H100 nodes but correct answers on A100 nodes.

Single-persona prompts are weak here — the problem spans runtime, reproducibility, and performance. Compose:

```
Using the Parallel Runtime Engineer, Reproducibility Steward, and HPC
Performance Engineer agents together, diagnose this bug:

- 4096-rank hybrid MPI+OpenMP job
- Correct results on gpu-a100 partition
- Wrong results on gpu-h100 partition (see attached diff)
- Same container image hash, same Spack env, same input dataset
- `--bind-to core --map-by socket:PE=16`

Produce:
1. As the Reproducibility Steward — the diagnostic tree for
   "same image, different answer on different hardware". Rank hypotheses.
2. As the Parallel Runtime Engineer — the runtime/layout-specific
   hypotheses (fabric, NCCL version mismatch, atomic ordering, etc.).
3. As the HPC Performance Engineer — what profiling data I should
   collect next to distinguish between the hypotheses.

End with a consolidated 30-minute diagnostic plan I can run now.
```

The three personas have overlapping but distinct priors. Composing them surfaces hypotheses none of them would have listed alone, and the final "consolidated plan" forces Claude to reconcile the overlap.

---

## Broader improvements to the upstream library

Beyond filling the HPC gap, there are things the upstream library could do better for *any* serious engineering use — RSE or not.

### Add a `requires:` / `works-with:` frontmatter field

Currently all agents are assumed equal. In reality, some pair badly (Growth Hacker + Reproducibility Steward is nonsense) and some have hard prerequisites (Parallel Runtime Engineer needs a real cluster to talk about). A frontmatter field:

```yaml
requires: [mpi, slurm]
works-with: [performance-engineer, scheduler-operator]
conflicts-with: []
```

Would let a future tool auto-install a coherent set instead of forcing users to curate by hand.

### Add a `verification:` section

The biggest weakness of persona-only agents is that they shape voice but not discipline. A lightweight `Verification` section — even three bullet points of "evidence this agent should produce before calling it done" — would close part of the gap without turning the library into a workflow framework. Example for the Performance Engineer:

> **Verification:**
> - Before any optimization claim: a profiler trace (VTune, Nsight, or HPCToolkit) is attached
> - Before any speedup claim: wall-clock numbers from ≥3 runs with stddev
> - Before any scaling claim: a table from ≥4 node counts

This steals the best idea from [agent-skills](https://github.com/addyosmani/agent-skills) without copying its whole framework.

### Add a `context-budget:` hint

Some agents need to see a lot of code; others need to see a little. A frontmatter hint:

```yaml
context-budget: small    # small | medium | large
```

…would let humans or tooling decide which agents are cheap to load into every session and which should be demand-loaded. Particularly useful when stacking 8-10 custom HPC personas alongside the upstream ones.

### Provide a `site-template.md`

A template file that says *"fill in your cluster's Slurm partition names, module conventions, filesystem layout, and allocation program here"* and that every other agent can `@include` or reference. Right now every RSE adopter will end up putting site details in every agent file. One template, one source of truth, is better.

### Add an `hpc/` category upstream

The library has `marketing` and `studio-operations` but nothing for scientific computing, despite the RSE community being one of the largest pools of serious Claude Code users outside consumer SaaS. This is a gap worth filling upstream, not just in forks. The eight personas above are a starting point; a PR-ready version would get reviewed by real RSEs at a DOE lab or NSF center.

### Lean harder into "Related Agents" as a graph

The cross-references exist but are loosely enforced. A linter that verifies every agent's Related Agents links resolve, plus a rendered graph view, would make the library discoverable in a way a flat directory tree can't match. It would also catch dangling links after renames.

### Better license/attribution guidance for customization

The license is MIT, which is permissive, but there's no explicit guidance on how to attribute your customizations back to upstream, or how to share improvements. For an RSE audience — which cares deeply about provenance and credit — a `CUSTOMIZING.md` with a recommended pattern would matter.

---

## Where to go from here

- Fork the library, add an `hpc/` directory, and start writing. Even one or two personas is a meaningful improvement over adopting nothing.
- Pair the library with [agent-skills](https://github.com/addyosmani/agent-skills) for workflow discipline — the RSE personas in this guide set the *voice*, the skills enforce the *process*.
- If your site has a shared cluster, consider committing the `.claude/agents/hpc/` directory to a site-wide repo and having researchers pull it into their project `CLAUDE.md`. Centralizes the site knowledge that currently lives in tribal memory.
- Contribute back. If a persona works well for you, a PR to the upstream library starts the conversation about bringing scientific computing into scope.

---

## Related

- [Claude Agents Library Quick Reference](./claude-agents-library-guide.md)
- [Claude Agents Library Hands-On Tutorial](./claude-agents-library-tutorial.md)
- [Three-way comparison: agents-library vs. agent-skills vs. Agent OS](../agent-skills/comparing-claude-agents-library-agent-skills-agent-os.md)
- [IsaacLab + MetaGrasp on Apptainer HPC tutorial](../IsaacLab-MetaGrasp-Apptainer-HPC/) — a worked HPC + containers example in your own second brain
