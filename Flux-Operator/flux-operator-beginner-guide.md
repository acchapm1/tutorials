---
title: "Flux Operator on Apple Silicon — Beginner's Guide"
date: 2026-08-10
difficulty: beginner
tags: [flux-operator, kubernetes, flux, hpc, converged-computing, apple-silicon, minikube, slurm, containers]
---

# Flux Operator on Apple Silicon — Beginner's Guide

> **Related tutorials:** [[flux-basics|Flux Basics for Slurm Users]] · [[kubernetes-beginner-guide|Kubernetes Beginner's Guide]] · [[flux-operator-deep-dive|Flux Operator Deep Dive]] · [[apple-container-beginner-guide|Apple Container]]

This guide takes an HPC systems administrator from zero to a working Flux Operator install on a local MiniKube cluster on an Apple Silicon MacBook. It is written for someone fluent in Slurm, Apptainer, Warewulf, and the Linux userspace, but new to Kubernetes operators. Kubernetes concepts are taught by analogy to the HPC stack you already run, not from scratch.

This is tutorial 1 of 2. It covers orientation and hands-on operation. The [[flux-operator-deep-dive|Flux Operator Deep Dive]] covers the CRD field reference, the flux-view sidecar internals, reconciliation, RBAC, the Python SDK, and where this fits Sol/Phoenix.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Prerequisites](#2-prerequisites)
3. [Key Concepts](#3-key-concepts)
4. [Step-by-Step Instructions](#4-step-by-step-instructions)
5. [Practical Examples](#5-practical-examples)
6. [Hands-On Exercises](#6-hands-on-exercises)
7. [Troubleshooting](#7-troubleshooting)
8. [References](#8-references)
9. [Related Tutorials](#9-related-tutorials)
10. [Summary](#10-summary)

---

## Command Conventions

Three kinds of command blocks appear in this guide. The prompt tells you where the command runs:

- `mac$` — run on your MacBook host shell.
- `pod#` — run inside a MiniCluster pod after `kubectl exec`.
- YAML blocks labelled `# minicluster.yaml` or similar are **manifests you apply**, not commands.

Callouts use a consistent prefix:

> **Gotcha:** a thing that will bite you.

> **arm64:** something specific to Apple Silicon.

> **kind:** the translation if you use kind instead of MiniKube.

> **Docs drift:** where upstream docs and the repo disagree. When they do, trust the repo.

Where a command could not be verified against a source at the time of writing, it is marked `<!-- UNVERIFIED -->`.

---

## 1. Overview

The **Flux Operator** is a Kubernetes operator that creates and controls **Flux Framework MiniClusters** — ephemeral or persistent HPC clusters that run as a set of pods inside Kubernetes. You describe the cluster you want in a YAML custom resource, apply it with `kubectl`, and the operator builds the ConfigMaps, Secrets, headless Service, and Indexed Job that stand up a working Flux instance. You then submit jobs to that Flux instance exactly as you would on bare metal.

If you run Slurm on Sol and Phoenix, the mental model is: the Flux Operator is a provisioning controller (like Warewulf plus a scheduler-config-management layer) that turns a declarative request into a running, Flux-scheduled cluster — except the "nodes" are pods and the "provisioning" is container image pulls.

By the end of this guide you will have:

- Installed the arm64 build of the operator on MiniKube on your Mac.
- Checked container architecture *before* pulling, so you don't waste an afternoon on an x86-only image.
- Run an ephemeral MiniCluster (run-one-job-and-exit) and inspected every object the operator created on your behalf.
- Run a persistent, interactive MiniCluster, shelled in, connected to the Flux broker, and submitted jobs with a Slurm-to-Flux cheatsheet at your side.
- Staged data from the Mac into a MiniCluster with `minikube mount`, scaled the cluster until a laptop stalls, broken it deliberately three ways, and torn it all down cleanly.

The operator is real but early-stage software (latest release **v0.2.1**, August 2024; four releases total). It works, and the design is genuinely interesting, but you will hit rough edges and stale documentation. This guide flags them rather than smoothing them over.

For the motivation and design rationale, see the published paper: Sochat, Culquicondor, Ojea, and Milroy, *The Flux Operator*, F1000Research 2024, 13:203 ([doi:10.12688/f1000research.147989.1](https://doi.org/10.12688/f1000research.147989.1)).

---

## 2. Prerequisites

You need the following on your Apple Silicon MacBook:

- **A container runtime**: Docker Desktop, colima, or Podman. Any of these works as the MiniKube driver. The driver choice matters for storage and networking behaviour (noted where relevant) but not for the basic install.
- **MiniKube** installed (`brew install minikube`). This guide uses MiniKube for every hands-on command.
- **kind** — optional, but if you have it installed, the `> **kind:**` callouts give you the translation for MiniKube-specific commands.
- **kubectl** (`brew install kubectl`).
- **jq** (`brew install jq`) — used for inspecting image manifests and pod JSON.
- Familiarity with pods, namespaces, and `kubectl` at a basic level. You do **not** need to already understand operators, CRDs, reconciliation, RBAC, Indexed Jobs, or PV/PVC semantics — those are taught here and in the [[flux-operator-deep-dive|deep dive]]. If you want a broader Kubernetes grounding first, see [[kubernetes-beginner-guide|Kubernetes Beginner's Guide]].
- Some familiarity with Flux itself helps. If Slurm is your daily driver but you've never run Flux, read [[flux-basics|Flux Basics for Slurm Users]] first — this guide assumes you know what `flux run` and `flux submit` do.

> **arm64:** Verify you are actually on arm64 before anything else. `mac$ uname -m` should print `arm64`. Everything below assumes it does.

---

## 3. Key Concepts

### 3.1 The one-paragraph model

An **operator** is a controller program that runs inside Kubernetes, watches for a **custom resource** (a new object type it taught the cluster about via a **CRD**, Custom Resource Definition), and reconciles reality to match what the resource asks for. The Flux Operator's custom resource is the **MiniCluster**. When you apply a MiniCluster, the operator creates the supporting Kubernetes objects and launches an **Indexed Job** whose pods each run a Flux broker. Pod 0 is the lead broker; the rest are workers. You submit work to the lead broker.

```
          apply minicluster.yaml
mac$ kubectl ───────────────────────────►  Kubernetes API
                                                  │
                                                  ▼
                                     ┌───────────────────────────┐
                                     │      Flux Operator        │  (controller in operator-system)
                                     │  watches MiniCluster CRs   │
                                     └───────────┬───────────────┘
                                                 │ reconciles → creates
                    ┌──────────────┬─────────────┼──────────────┬─────────────┐
                    ▼              ▼             ▼              ▼             ▼
                ConfigMap        Secret       Service      Indexed Job    (RBAC)
              (broker.toml)   (curve cert)  (headless)         │
                                                               ▼
                                        ┌───────────┬───────────┬───────────┐
                                        │  pod 0    │  pod 1    │  pod N    │
                                        │ lead      │ worker    │ worker    │
                                        │ broker    │ broker    │ broker    │
                                        └───────────┴───────────┴───────────┘
                                        each pod: init container stages Flux
                                        at /mnt/flux (the "flux view")
```

### 3.2 Flux, for a Slurm admin

Slurm is a flat system: a central controller (`slurmctld`) owns partitions and queues, and jobs are scheduled against them. Flux is **hierarchical and fully graph-based**. Every Flux allocation is itself a Flux instance — a broker that can schedule and further subdivide its own resources. "A Flux instance is itself a job." You can nest instances: a batch allocation starts a child Flux that schedules the steps inside it, which can start their own children. There is no single central controller; there is a tree of brokers, rank 0 at the root.

For this guide, the practical consequences are: (1) the lead broker (pod 0) is the root of the tree and the thing you connect to; (2) `flux submit` / `flux batch` behave like `sbatch`/`srun` but nest naturally; and (3) the scheduler is graph-aware (Fluxion), though the operator loads a simpler scheduler by default. More on Flux's model is in [[flux-basics|Flux Basics]] and [[flux-advanced-features|Advanced Flux Features]].

### 3.3 Kubernetes concepts, by HPC analogy

This table is the fastest way in. The third column — where the analogy breaks — is the useful part.

| Kubernetes | Rough HPC analogue | Where the analogy breaks |
|---|---|---|
| Operator + CRD | A provisioning controller (Warewulf + config mgmt) reconciling declared state | The operator runs *continuously* and re-reconciles on every change/failure; Warewulf provisions once at boot. It's a control loop, not a one-shot. |
| Indexed Job | A Slurm job array with stable ranks | Indexed Job pods get stable indices (0..N-1) and stable DNS hostnames, but there is no scheduler backfilling them across a shared partition — Kubernetes schedules them onto nodes by resource fit, not queue policy. |
| Namespace | A Slurm account/partition scope | A namespace is an isolation and RBAC boundary, not a resource-allocation pool. Quotas are optional add-ons, not the default. |
| PV / PVC | A mounted parallel filesystem (BeeGFS) | A PVC is a *claim* bound to one backing volume with an access mode; it is not inherently a shared parallel FS. `ReadWriteMany` is required for many-pod sharing and not all backends support it. On a laptop you fake it with hostPath. |
| Service + CoreDNS | Cluster hostname resolution / `/etc/hosts` | A *headless* Service gives each pod a stable DNS name, but resolution depends on the DNS addon actually being enabled. On MiniKube it is **not** free — you enable it manually. On GKE it is. |
| RBAC | Slurm coordinator permissions + sudoers | RBAC is per-API-verb, per-resource, per-namespace, and the operator's service account needs broad create/delete rights over Jobs, Pods, Services, ConfigMaps, and its own CRs. It's finer-grained and easier to get subtly wrong than sudoers. |

### 3.4 Ephemeral vs. persistent MiniCluster

This distinction governs everything downstream, so pin it now:

- **Ephemeral** — you put a `command:` in the container spec. The MiniCluster starts, runs that command under Flux, and (optionally) cleans itself up. This is `sbatch a-script.sh` and walk away.
- **Persistent / interactive** — you provide **no** command (or set `interactive: true`). The broker starts and stays up. You `kubectl exec` into pod 0, connect to the Flux instance, and submit jobs interactively, like a `salloc` session that stays open. This is where a Slurm admin gets the most transfer.

The rule: **command present → ephemeral; command absent (or `interactive: true`) → persistent.**

### 3.5 Why converged computing? The honest version

Running HPC workloads on Kubernetes buys you: declarative cluster state (the whole cluster is a YAML file you can version), elasticity (scale pods up and down, burst to cloud), a uniform API across on-prem and cloud, and access to the enormous Kubernetes ecosystem for storage, networking, and observability.

It costs you: a networking and scheduling stack that was never designed for tightly-coupled MPI; performance overheads at the interconnect layer; an extra abstraction (the operator, CRDs, reconciliation) between you and the metal; and, right now, immaturity — you will debug the tooling as much as your workload. For a bare-metal Slurm shop, the value is real but narrow. The [[flux-operator-deep-dive|deep dive]] argues concretely about where (and whether) it fits Sol and Phoenix.

---

## 4. Step-by-Step Instructions

### Step 0 — the architecture problem, before anything else

This is the single most likely thing to break your afternoon, so it comes first, not as a footnote.

The **operator itself** ships both x86 and ARM release assets under `ghcr.io/flux-framework/flux-operator`. That part is fine — you install the ARM YAML and move on.

The **example workload containers are the real risk.** The upstream examples lean on `ghcr.io/rse-ops/*` images (LAMMPS and friends) that are frequently **x86_64-only**. If you `kubectl apply` a MiniCluster referencing an x86-only image on your arm64 laptop, the pod will fail to pull or fail to run, and the failure mode is not always obvious.

So the discipline is: **check the manifest before you pull.**

```bash
# mac$  Inspect the platforms an image actually publishes
docker manifest inspect ghcr.io/flux-framework/flux-operator:latest | jq '.manifests[].platform'
```

Expected output for a healthy multi-arch image (both amd64 and arm64 present):

```json
{
  "architecture": "amd64",
  "os": "linux"
}
{
  "architecture": "arm64",
  "os": "linux"
}
```

<!-- UNVERIFIED: exact manifest contents vary by tag and publish date; the shape above is what a multi-arch manifest list returns. Run the command against your target tag. -->

Now a known-problematic one. Many `rse-ops` HPC app images publish only x86_64:

```bash
# mac$
docker manifest inspect ghcr.io/rse-ops/lammps:flux-sched-focal-v0.24.0 | jq '.manifests[].platform'
```

Expected output for an x86-only image — a single amd64 entry, or a plain manifest (not a list) with `amd64`:

```json
{
  "architecture": "amd64",
  "os": "linux"
}
```

<!-- UNVERIFIED: rse-ops tags change; some return "no such manifest" for arm64 rather than a list. The point stands: if arm64 is absent, do not run it natively. -->

> **Gotcha:** If `docker manifest inspect` errors with something about the manifest list not containing your platform, or returns only `amd64`, the image will not run natively on your Mac. Stop and pick an escape hatch below.

**The three escape hatches, with a recommendation:**

1. **Substitute an arm64-native image** and adjust the example. This is the first thing to reach for. `rockylinux:9`, `ubuntu:jammy`, and the operator's own flux-view bases (`ghcr.io/converged-computing/flux-view-rocky:tag-9`, `flux-view-ubuntu:tag-jammy`) all have arm64 builds. For learning the operator, you rarely need LAMMPS specifically — a Rocky or Ubuntu base running `hostname` or a small script teaches the same mechanics.

2. **Run the x86 image under emulation.** Docker Desktop / colima can run amd64 images on arm64 via QEMU. It works for correctness but is slow — often several times slower for compute-heavy code — and QEMU will sometimes hang or crash on certain instructions or on tightly-threaded MPI. Acceptable for a quick "does it start" check; not acceptable for anything you care about timing.

3. **Build your own arm64 workload container.** This sounds heavy but is much lighter than it used to be: **since operator v0.2.0, Flux does not need to be installed in your workload container.** The operator stages Flux from a separate flux-view image into `/mnt/flux` at runtime. So your container only needs your application, a root-capable user (or sudo), `curl`/`wget`, and a Debian/Ubuntu or Rocky base. That is a trivial Dockerfile you can `docker build --platform linux/arm64`. See [[docker-bake-beginner-guide|Docker Bake]] if you want to build multi-arch images cleanly, and [[isaaclab-metagrasp-apptainer-hpc-beginner-guide|the Apptainer HPC tutorial]] for how the same "stage tooling separately" idea shows up with bind mounts.

**Decision rule:** *Is there an arm64 build of the image I want?* If yes → use it (hatch 1). *No, but I only need to confirm behaviour, not performance?* → emulate (hatch 2). *No, and I need it to actually run well?* → build my own arm64 container (hatch 3), which is easy precisely because Flux is no longer baked in.

### Step 1 — Prepare MiniKube on Apple Silicon

Default MiniKube sizing will disappoint you: it allocates roughly 2 CPUs and 2–4 GB RAM, which is not enough for a multi-pod MiniCluster where each pod wants a core and the flux-view init container also needs headroom. Size it explicitly.

```bash
# mac$  Give MiniKube real resources for a multi-pod MiniCluster
minikube start --cpus=6 --memory=12288 --disk-size=40g
```

Real numbers, not "enough": for a 4-pod MiniCluster with one core per pod plus the operator and system pods, 6 CPUs and 12 GB is comfortable on a MacBook with 16 GB total. If your Mac has 32 GB+, `--cpus=8 --memory=24576` lets you push `size` higher. Below 4 CPUs you will not get a 4-pod cluster to schedule.

Driver choice: on Apple Silicon the `docker` driver (Docker Desktop or colima) is the default and works. It matters for storage — `minikube mount` and hostPath behave slightly differently across drivers — and for how much of your Mac's RAM MiniKube can actually claim. It does **not** matter for the operator install itself.

> **kind:** `kind create cluster` has no CPU/memory flags — kind inherits the Docker VM's resources, so size Docker Desktop's VM instead (Settings → Resources). To pre-mount host data (the equivalent of `minikube mount`), you must declare `extraMounts` in the kind config **at cluster-create time** — you cannot add them to a running cluster:
> ```yaml
> # kind-config.yaml
> kind: Cluster
> apiVersion: kind.x-k8s.io/v1alpha4
> nodes:
>   - role: control-plane
>     extraMounts:
>       - hostPath: /tmp/workflow
>         containerPath: /tmp/data
> ```
> `kind create cluster --config kind-config.yaml`

Enable DNS addons now. Flux's pod-to-pod networking depends on the headless Service resolving pod hostnames, and on MiniKube that is **not** on by default:

```bash
# mac$
minikube addons enable ingress
minikube addons enable ingress-dns
```

> **Gotcha:** Skip this and your workers will fail to find the lead broker by hostname. On GKE these are effectively free; on MiniKube you enable them by hand. This is the single most common "why won't my cluster form" failure on a laptop.

### Step 2 — Architecture check (do it before installing anything)

Run the manifest inspection from Step 0 against the operator image and against whatever workload image your first MiniCluster will use. Confirm arm64 is present before proceeding. This 30-second habit saves the afternoon.

### Step 3 — Install the operator

Apply the **ARM** distribution YAML:

```bash
# mac$  Install the arm64 build of the Flux Operator
kubectl apply -f https://raw.githubusercontent.com/flux-framework/flux-operator/main/examples/dist/flux-operator-arm.yaml
```

> **arm64:** Use `flux-operator-arm.yaml`. The plain `flux-operator.yaml` is the x86 build and its controller image will not run on your Mac. For a pinned release instead of bleeding-edge main:
> ```bash
> # mac$
> VERSION=0.2.1
> kubectl apply -f https://github.com/flux-framework/flux-operator/releases/download/${VERSION}/flux-operator-arm.yaml
> ```

The operator installs into the `operator-system` namespace. Verify the controller is running:

```bash
# mac$
kubectl get pods -n operator-system
```

Expected output (the pod is `2/2` because it runs the manager plus a kube-rbac-proxy sidecar):

```
NAME                                             READY   STATUS    RESTARTS   AGE
operator-controller-manager-6c699b7b94-bbp5q     2/2     Running   0          80s
```

If it is `0/2` or `CrashLoopBackOff`, jump to [Troubleshooting](#7-troubleshooting).

Now create the namespace your MiniClusters will live in:

```bash
# mac$
kubectl create namespace flux-operator
```

> **Gotcha:** The MiniCluster CRD's `metadata.namespace` **must match** the namespace you created. The default examples use `flux-operator`. If your CRD says `namespace: flux-operator` but you never created that namespace, the apply fails; if it says a different namespace, the operator still reconciles it but you'll be looking in the wrong place with `kubectl get pods -n flux-operator`. Keep them aligned.

**(Optional) Validate a workload container.** The operator provides a small validator that sanity-checks a container against the requirements (root user, curl/wget present, compatible base). It's optional — you can also just check the list yourself — but it's a quick confidence step:

```bash
# mac$  See https://github.com/converged-computing/flux-operator-validator
# Follow that repo's README to run the validator against your target image.
```

<!-- UNVERIFIED: the validator is maintained separately (converged-computing/flux-operator-validator); consult its README for the current invocation. -->

### Step 4 — Your first MiniCluster (the "aha" moment)

Apply the smallest useful MiniCluster. Write this manifest to a file:

```yaml
# hello-minicluster.yaml   — apply this, don't run it
apiVersion: flux-framework.org/v1alpha2
kind: MiniCluster
metadata:
  name: flux-sample
  namespace: flux-operator
spec:
  size: 2
  containers:
    - image: rockylinux:9
      command: "echo hello world from $(hostname)"
```

> **Docs drift:** The upstream user guide still points at a `config/samples/flux-framework.org_v1alpha1_minicluster.yaml` path and `apiVersion: ...v1alpha1`. The repository has moved to **`v1alpha2`** (`api/v1alpha2`, `sdk/python/v1alpha2`). Use `v1alpha2`, as above. When docs and repo disagree, trust the repo.

Apply it and watch the machinery:

```bash
# mac$
kubectl apply -f hello-minicluster.yaml
kubectl get pods -n flux-operator -w
```

Expected (pods come up, run, and complete):

```
NAME                  READY   STATUS      RESTARTS   AGE
flux-sample-0-ng8c5   1/1     Running     0          6s
flux-sample-1-nxqj9   1/1     Running     0          6s
...
flux-sample-0-ng8c5   0/1     Completed   0          25s
```

Now the important part — **inspect everything the operator created on your behalf.** This is the whole point of the operator, made visible:

```bash
# mac$  The Indexed Job (the primitive that gives stable pod indices)
kubectl get job -n flux-operator
kubectl describe job -n flux-operator flux-sample

# mac$  The ConfigMap(s): the broker.toml and entrypoint scripts the operator generated
kubectl get configmap -n flux-operator
kubectl get configmap -n flux-operator flux-sample-flux-config -o yaml   # name may vary by version

# mac$  The Secret: the ZeroMQ curve certificate brokers use to authenticate to each other
kubectl get secret -n flux-operator

# mac$  The headless Service: gives each pod a stable DNS name
kubectl get service -n flux-operator
kubectl describe service -n flux-operator flux-service
```

Read the lead broker log to see Flux itself start:

```bash
# mac$
pod=$(kubectl get pods -n flux-operator -l job-index=0 -o jsonpath='{.items[0].metadata.name}')
kubectl logs -n flux-operator $pod
```

You applied ~8 lines of YAML. The operator turned it into a Job, ConfigMaps, a Secret, and a Service, then started a 2-broker Flux instance across two pods. That expansion — declared intent to running Flux cluster — is the operator's entire job. Spend a few minutes here; it's what makes the rest make sense.

Clean up this example before the next:

```bash
# mac$
kubectl delete -f hello-minicluster.yaml
```

### Step 5 — Ephemeral job run

Step 4 was already ephemeral (it had a `command:`). To make the pattern explicit, here is an ephemeral run that does real Flux work and exits. The `command` is what makes it ephemeral:

```yaml
# ephemeral-minicluster.yaml   — apply this
apiVersion: flux-framework.org/v1alpha2
kind: MiniCluster
metadata:
  name: flux-sample
  namespace: flux-operator
spec:
  size: 2
  # command present  => ephemeral: run and finish
  containers:
    - image: rockylinux:9
      command: "flux run -N2 hostname"
```

```bash
# mac$
kubectl apply -f ephemeral-minicluster.yaml
pod=$(kubectl get pods -n flux-operator -l job-index=0 -o jsonpath='{.items[0].metadata.name}')
kubectl wait --for=condition=Ready pod/$pod -n flux-operator --timeout=300s
kubectl logs -n flux-operator $pod -f
kubectl delete -f ephemeral-minicluster.yaml
```

You should see two hostnames printed (one per broker), then the job completes.

### Step 6 — Interactive / persistent MiniCluster (maximum Slurm transfer)

Now the session that feels like `salloc`. Omit the command and set `interactive: true`:

```yaml
# interactive-minicluster.yaml   — apply this
apiVersion: flux-framework.org/v1alpha2
kind: MiniCluster
metadata:
  name: flux-sample
  namespace: flux-operator
spec:
  size: 4
  interactive: true      # no command => broker stays up
  containers:
    - image: rockylinux:9
```

```bash
# mac$
kubectl apply -f interactive-minicluster.yaml
pod=$(kubectl get pods -n flux-operator -l job-index=0 -o jsonpath='{.items[0].metadata.name}')
kubectl wait --for=condition=Ready pod/$pod -n flux-operator --timeout=300s
kubectl exec -it -n flux-operator $pod -- bash
```

Inside pod 0, connect to the Flux instance. Flux lives in the staged view at `/mnt/flux` — you did not install it in the Rocky container:

```bash
# pod#  Source the view (sets PATH, PYTHONPATH, and $fluxsocket) and connect
. /mnt/flux/flux-view.sh
flux proxy $fluxsocket bash
# Alternatively, the one-shot helper does both:
#   . /mnt/flux/flux-connect.sh
```

Now you have a live Flux instance. List resources and run work:

```bash
# pod#
flux resource list
```

Expected:

```
     STATE NNODES   NCORES    NGPUS NODELIST
      free      4       32        0 flux-sample-[0-3]
 allocated      0        0        0
      down      0        0        0
```

```bash
# pod#
flux run -N4 hostname
flux submit -n2 sleep 30
flux jobs -a
```

**Slurm to Flux cheatsheet** — keep this next to you during the session:

| Task | Slurm | Flux |
|---|---|---|
| Show partitions / nodes | `sinfo` | `flux resource list` |
| Submit a batch script | `sbatch job.sh` | `flux batch job.sh` |
| Submit / run now | `srun ...` | `flux run ...` |
| Fire-and-forget submit | `sbatch --wrap=...` | `flux submit ...` |
| Show queue | `squeue` | `flux jobs -a` |
| Cancel a job | `scancel <id>` | `flux cancel <id>` (or `flux cancel $(flux job last)`) |
| Job accounting/detail | `sacct -j <id>` | `flux job info <id>` |
| Interactive allocation | `salloc` | (you're already in one — this interactive MiniCluster *is* the allocation) |

When you're done, exit the shells and delete the cluster:

```bash
# pod#
exit          # leaves flux proxy
exit          # leaves the pod
# mac$
kubectl delete -f interactive-minicluster.yaml
```

### Step 7 — Storage: stage data from the Mac into the MiniCluster

The default storage type is **hostPath**: the operator expects the data to exist on the node where the pod runs. On MiniKube, "the node" is the MiniKube VM, not your Mac — so you bridge the two with `minikube mount`.

```bash
# mac$  1. Put some data on the Mac
mkdir -p /tmp/workflow && echo "input data" > /tmp/workflow/input.txt

# mac$  2. Make the target dir inside the MiniKube VM, then mount your Mac dir into it.
#         Leave this running in its own terminal.
minikube ssh -- mkdir -p /tmp/data
minikube mount /tmp/workflow:/tmp/data
```

In a second terminal, apply a MiniCluster that mounts `/tmp/data` (the path inside the VM) into the pod as a hostPath volume:

```yaml
# storage-minicluster.yaml   — apply this
apiVersion: flux-framework.org/v1alpha2
kind: MiniCluster
metadata:
  name: flux-sample
  namespace: flux-operator
spec:
  size: 2
  containers:
    - image: rockylinux:9
      command: "cat /data/input.txt"
      volumes:
        data:
          path: /data          # where it appears inside the pod
          hostPath: /tmp/data   # the path inside the MiniKube VM (fed by minikube mount)
```

```bash
# mac$
kubectl apply -f storage-minicluster.yaml
pod=$(kubectl get pods -n flux-operator -l job-index=0 -o jsonpath='{.items[0].metadata.name}')
kubectl logs -n flux-operator $pod -f    # should print "input data"
kubectl delete -f storage-minicluster.yaml
```

The path chain is: **Mac `/tmp/workflow` → (minikube mount) → VM `/tmp/data` → (hostPath) → pod `/data`.** Results written to `/data` in the pod appear back in `/tmp/workflow` on your Mac, which is how you get output out without scraping logs.

> **kind:** kind has no `minikube mount`. You must declare the mount as `extraMounts` in the kind config at create time (see the kind callout in Step 1), then reference the `containerPath` (`/tmp/data`) as your `hostPath` in the MiniCluster. You cannot mount into a running kind cluster.

> **Docs drift:** As of v0.2.0 the operator no longer manages its own volumes — you create the PV/PVC (or use hostPath/emptyDir) and simply *tell* the MiniCluster about them. Older docs describing an "existingVolume" concept are stale; it's now just `volumes`.

### Step 8 — Scale it until the laptop stalls

Bump `size` and watch what happens when you exceed the resources you gave MiniKube:

```yaml
# scale-minicluster.yaml   — apply this
apiVersion: flux-framework.org/v1alpha2
kind: MiniCluster
metadata:
  name: flux-sample
  namespace: flux-operator
spec:
  size: 8                 # more pods than a 6-CPU MiniKube can place one-per-core
  interactive: true
  containers:
    - image: rockylinux:9
      resources:
        limits:
          cpu: 1
          memory: 512M
```

```bash
# mac$
kubectl apply -f scale-minicluster.yaml
kubectl get pods -n flux-operator
```

Some pods will sit in `Pending`. Find out why:

```bash
# mac$
kubectl describe pod -n flux-operator <a-pending-pod> | sed -n '/Events/,$p'
```

Expected — the scheduler cannot place the pod:

```
Events:
  Type     Reason            Message
  ----     ------            -------
  Warning  FailedScheduling  0/1 nodes are available: 1 Insufficient cpu.
```

That is the resource ceiling of a single-node MiniKube. By default the operator uses anti-affinity to place **one pod per node** (via `topology.kubernetes.io/zone` and `kubernetes.io/hostname`), and a laptop MiniKube is one node — so a MiniCluster of `size > 1` with strict affinity may not even place a second pod unless affinity is relaxed. For laptop experimentation you can set `network.disableAffinity: true` to let multiple pods share the single node (understanding this defeats the one-pod-per-node model that matters on a real cluster). Clean up:

```bash
# mac$
kubectl delete -f scale-minicluster.yaml
```

### Step 9 — Break it deliberately (three failure injections)

You learn the diagnostic reflexes by causing the failures on purpose. For each, the reflex is the same three commands: `kubectl get events`, `kubectl describe pod`, `kubectl logs`.

**Failure A — wrong image architecture.** Apply a MiniCluster referencing an x86-only image without emulation:

```yaml
# apply this — expect it to fail on arm64
spec:
  size: 2
  containers:
    - image: ghcr.io/rse-ops/lammps:flux-sched-focal-v0.24.0   # x86_64-only
      command: "lmp -h"
```

Diagnostic path:

```bash
# mac$
kubectl get events -n flux-operator --sort-by=.lastTimestamp
kubectl describe pod -n flux-operator <pod>
kubectl logs -n flux-operator <pod>
```

You'll see `exec format error` in the logs or an `ImagePullBackOff`/manifest error in the events, depending on how Docker handles the missing arch. Fix: substitute an arm64 image (Step 0, hatch 1).

**Failure B — pod stuck `Pending` on resources.** This is Step 8. The tell is `FailedScheduling ... Insufficient cpu/memory` in `kubectl describe pod` events. Fix: lower `size`, lower per-container `resources`, or give MiniKube more CPUs at `minikube start`.

**Failure C — DNS / service discovery failure.** If you forgot `minikube addons enable ingress-dns`, workers cannot resolve the lead broker's hostname and the cluster never forms. The tell:

```bash
# mac$
kubectl logs -n flux-operator <worker-pod> | grep -i 'flux-service\|resolve\|connect'
```

You'll see the broker retrying to connect to `flux-sample-0.flux-service.flux-operator.svc.cluster.local` and failing. Fix: enable the DNS addons (Step 1) and re-apply.

> **Gotcha:** MiniKube needs DNS addons configured manually; GKE gives them free. A cluster that "hangs at startup" on a laptop is DNS more often than anything else.

### Step 10 — Teardown

`kubectl delete -f your.yaml` handles the happy path. But a crashed or force-quit run can leave orphaned pods, PVCs, PVs, and Jobs in the namespace, and a half-cleaned namespace will confuse your next run (stale pods, name collisions, a Service still pointing at dead pods). The full incantation:

```bash
# mac$  Force-clean everything in the namespace
kubectl delete -n flux-operator pods       --all --grace-period=0 --force
kubectl delete -n flux-operator pvc        --all --grace-period=0 --force
kubectl delete -n flux-operator pv         --all --grace-period=0 --force
kubectl delete -n flux-operator jobs       --all --grace-period=0 --force
kubectl delete -n flux-operator minicluster --all --grace-period=0 --force
```

If you set `cleanup: true` in the MiniCluster spec, the operator does most of this for you when the job finishes — but that also destroys the pods and their storage, so you lose the logs. For learning, prefer manual cleanup so you can inspect after the fact. Stop the cluster when you're done for the day:

```bash
# mac$
minikube stop
```

---

## 5. Practical Examples

### Example 1 — Ephemeral batch of many small tasks

Instead of many `kubectl apply`s, hand Flux a batch of work in one MiniCluster. This mirrors submitting a job array under Slurm, but Flux schedules the tasks inside the instance:

```yaml
# batch-minicluster.yaml   — apply this
apiVersion: flux-framework.org/v1alpha2
kind: MiniCluster
metadata:
  name: flux-sample
  namespace: flux-operator
spec:
  size: 4
  containers:
    - image: rockylinux:9
      batch: true
      command: |
        flux submit -n1 echo task 1
        flux submit -n1 echo task 2
        flux submit -n1 echo task 3
        flux queue idle
```

The `batch: true` content is written to a script and handed to `flux batch`, so you submit many jobs without stressing the Kubernetes API with many resources. Compare to how [[hyperqueue-basics|HyperQueue]] and [[parsl-beginner-guide|Parsl]] pack many small tasks into one allocation — same problem, different layer.

### Example 2 — Interactive session with Fluxion (graph scheduler)

By default the operator loads a simple scheduler. To get Flux's graph-aware Fluxion scheduler in an interactive cluster:

```bash
# pod#  after connecting via flux proxy
bash /mnt/flux/load-fluxion.sh
flux module list        # expect sched-fluxion-qmanager and sched-fluxion-resource loaded
```

This is where Flux's hierarchical, fully-graph-based scheduling (contrast Slurm's flat partitions) actually comes into play. See [[flux-advanced-features|Advanced Flux Features]].

### Example 3 — Getting results out via a bound directory

Using the Step 7 storage pattern, anything your job writes to `/data` in the pod lands in `/tmp/workflow` on your Mac. That's the clean way to retrieve output — far better than `kubectl logs` scraping, and it survives `cleanup: true`.

---

## 6. Hands-On Exercises

1. **Prove the arch check works.** Run `docker manifest inspect` against three images: `rockylinux:9`, `ubuntu:jammy`, and an `rse-ops` HPC image. Record which publish arm64. Write a one-line shell function `archcheck() { docker manifest inspect "$1" | jq -r '.manifests[].platform.architecture' 2>/dev/null || echo "single-arch"; }` and use it.

2. **Trace the object graph.** Apply the Step 4 hello MiniCluster and, before it completes, capture every object the operator created: `kubectl get all,configmap,secret -n flux-operator -o name`. Diff that against an empty namespace. Explain in one sentence what each object is for.

3. **Ephemeral vs. persistent by experiment.** Apply the same MiniCluster twice — once with a `command:` and once with `interactive: true` and no command. Observe that the first completes and the second stays `Running`. Confirm the rule from §3.4.

4. **Break DNS on purpose.** Start a fresh MiniKube *without* enabling `ingress-dns`, apply a `size: 3` MiniCluster, and watch it fail to form. Read a worker log, identify the unresolved hostname, then enable the addon and confirm it forms. This failure will happen to you for real; cause it once on purpose.

5. **Round-trip data.** Use the Step 7 pattern to feed a file in and get a transformed file out (e.g., `command: "tr a-z A-Z < /data/input.txt > /data/output.txt"`). Confirm `output.txt` appears on your Mac in `/tmp/workflow`.

6. **Slurm-brain translation.** Take a simple `sbatch` script you actually use on Sol or Phoenix and rewrite it as a Flux `batch:` block in a MiniCluster. Note every place the translation is awkward — those are the real differences between the two schedulers.

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `operator-controller-manager` not `2/2 Running` | Installed the x86 YAML on arm64, or image still pulling | Confirm you applied `flux-operator-arm.yaml`; `kubectl describe pod -n operator-system <pod>` for pull/arch errors |
| Pod `ImagePullBackOff` or `exec format error` | x86-only workload image on arm64 | `docker manifest inspect` the image; substitute an arm64 image or build your own (Step 0) |
| Pods stuck `Pending` | Not enough CPU/memory in MiniKube, or strict one-pod-per-node affinity on a single node | `kubectl describe pod` → Events; lower `size`/`resources`, `minikube start` with more `--cpus`, or `network.disableAffinity: true` |
| Cluster never forms; workers retry forever | DNS addons not enabled | `minikube addons enable ingress-dns` (and `ingress`), re-apply |
| `kubectl get pods -n flux-operator` empty after apply | CRD `namespace` doesn't match created namespace | Align `metadata.namespace` with the namespace you created |
| `apiVersion` rejected / CRD not found | Used `v1alpha1` from stale docs | Use `flux-framework.org/v1alpha2` |
| Can't connect to Flux inside pod | Didn't source the view | `. /mnt/flux/flux-view.sh` then `flux proxy $fluxsocket bash`, or `. /mnt/flux/flux-connect.sh` |
| Next run behaves strangely | Half-cleaned namespace from a prior crash | Run the full teardown incantation (Step 10) |
| Slow cluster startup | ZeroMQ connect backoff before headless service is up | Expected on early versions; `flux.connectTimeout` defaults to `5s` and helps — see the [[flux-operator-deep-dive|deep dive]] |

The universal reflex for any pod problem: `kubectl get events -n flux-operator --sort-by=.lastTimestamp`, then `kubectl describe pod -n flux-operator <pod>`, then `kubectl logs -n flux-operator <pod>`. In that order.

---

## 8. References

Official docs and repo (prefer these over blog posts; where docs and repo disagree, trust the repo):

- Flux Operator docs root — https://flux-framework.org/flux-operator/
- User Guide (install, container requirements, validator) — https://flux-framework.org/flux-operator/getting_started/user-guide.html
- MiniCluster CRD spec — https://flux-framework.org/flux-operator/getting_started/custom-resource-definition.html
- MiniKube deployment (hostPath + `minikube mount`) — https://flux-framework.org/flux-operator/deployment/minikube.html
- Developer Guide (flux-view sidecar model) — https://flux-framework.org/flux-operator/development/developer-guide.html
- GitHub repo, examples, `config/samples` — https://github.com/flux-framework/flux-operator
- Flux Operator Validator — https://github.com/converged-computing/flux-operator-validator
- Flux cheat sheet — https://flux-framework.org/cheat-sheet/
- Flux Framework (upstream) — https://flux-framework.org/
- The Flux Operator paper — Sochat et al., F1000Research 2024, 13:203 — https://doi.org/10.12688/f1000research.147989.1

---

## 9. Related Tutorials

- [[flux-basics|Flux Basics for Slurm Users]] — the Flux command model this guide assumes you know
- [[flux-advanced-features|Advanced Flux Features]] — hierarchical scheduling and Fluxion
- [[flux-system-setup|Flux System Setup]] — deploying Flux at the system level on bare metal
- [[flux-snakemake-workflows|Flux + Snakemake Workflows]] — the workflow pattern the operator's storage example uses
- [[kubernetes-beginner-guide|Kubernetes Beginner's Guide]] — pods, services, and namespaces from the ground up
- [[flux-operator-deep-dive|Flux Operator Deep Dive]] — CRD field reference, flux-view internals, RBAC, SDK, and Sol/Phoenix fit
- [[apple-container-beginner-guide|Apple Container]] — building OCI images on Apple Silicon
- [[docker-bake-beginner-guide|Docker Bake]] — building multi-arch (arm64) images cleanly
- [[isaaclab-metagrasp-apptainer-hpc-beginner-guide|IsaacLab MetaGrasp on Apptainer/HPC]] — "stage tooling separately" via bind mounts, the Apptainer analogue of the flux view
- [[hyperqueue-basics|HyperQueue Basics]] — packing many small tasks into one allocation
- [[parsl-beginner-guide|Parsl]] — Python-native task orchestration on HPC

---

## 10. Summary

The Flux Operator turns a short YAML MiniCluster into a running, Flux-scheduled cluster of pods, and lets you submit HPC jobs to it exactly as you would on bare metal. On an Apple Silicon MacBook the workflow is: size MiniKube properly and enable DNS addons, install the **arm64** operator build, and — critically — **check image architecture before you pull**, because the workload images are the real arm64 risk, not the operator. Ephemeral MiniClusters (with a `command:`) run and exit; persistent ones (`interactive: true`) stay up for `kubectl exec` and interactive `flux` submission, which is where a Slurm admin gets the most transfer. Data reaches pods via `minikube mount` + hostPath, and results come back out through the same bound directory. When things break, the reflex is always `get events` → `describe pod` → `logs`.

The project is early (v0.2.1) and the docs drift from the repo in places — most notably `v1alpha1` vs `v1alpha2` — but the core is solid and the design is worth understanding.

**Next steps:** read the [[flux-operator-deep-dive|Flux Operator Deep Dive]] for the full CRD field reference, the flux-view sidecar architecture (the most interesting design decision in the project), reconciliation, RBAC, the Python SDK, and an honest assessment of whether any of this belongs on Sol or Phoenix.
