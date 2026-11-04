---
title: "Flux Operator — Deep Dive Reference"
date: 2026-08-10
difficulty: advanced
tags: [flux-operator, kubernetes, flux, hpc, converged-computing, crd, reconciliation, rbac, python-sdk, slurm]
---

# Flux Operator — Deep Dive Reference

> **Related tutorials:** [[flux-operator-beginner-guide|Flux Operator Beginner's Guide]] · [[kubernetes-deep-dive|Kubernetes Deep Dive]] · [[flux-advanced-features|Advanced Flux Features]] · [[cgroups-deep-dive|Cgroups Deep Dive]]

This is the reference chapter to come back to. It assumes you have worked through the [[flux-operator-beginner-guide|beginner's guide]] — you have the operator installed on MiniKube on an Apple Silicon Mac, you've run ephemeral and interactive MiniClusters, and you understand the ephemeral-vs-persistent distinction. Here we cover the MiniCluster CRD field by field, the flux-view sidecar architecture (the most interesting design decision in the project), reconciliation, bootstrap and networking, RBAC, the Python SDK, and where the project is rough. It closes with an applied, honest comparison to Slurm-on-bare-metal for Sol and Phoenix.

Everything here is against **`apiVersion: flux-framework.org/v1alpha2`**, the current API version in the repository. Where upstream docs still show `v1alpha1`, that is docs drift; trust the repo.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Prerequisites](#2-prerequisites)
3. [Key Concepts](#3-key-concepts)
4. [Step-by-Step: Reading the System](#4-step-by-step-reading-the-system)
5. [Practical Examples](#5-practical-examples)
6. [Hands-On Exercises](#6-hands-on-exercises)
7. [Troubleshooting](#7-troubleshooting)
8. [References](#8-references)
9. [Related Tutorials](#9-related-tutorials)
10. [Summary](#10-summary)

Reference sections live inside §3 (concepts) and §4 (the CRD field reference and architecture):

- [3.1 The flux-view sidecar architecture](#31-the-flux-view-sidecar-architecture)
- [3.2 Reconciliation](#32-reconciliation)
- [3.3 Bootstrap and networking](#33-bootstrap-and-networking)
- [3.4 RBAC](#34-rbac)
- [4.1 MiniCluster CRD field reference](#41-minicluster-crd-field-reference)
- [4.2 The Python SDK](#42-the-python-sdk)
- [4.3 Where the project is rough](#43-where-the-project-is-rough)

---

## 1. Overview

The Flux Operator is a Go controller built on controller-runtime that reconciles a **MiniCluster** custom resource into a set of Kubernetes objects: ConfigMaps (the generated `broker.toml` and entrypoint scripts), a Secret (the ZeroMQ curve certificate), a headless Service (stable pod DNS), and a **batch/v1 Indexed Job** whose pods each run a Flux broker. Because it is a `batchv1.Job`, it has trackable states (Active, Succeeded, Failed).

The design decision that makes the whole thing tractable — and the one worth understanding even if you never deploy it — is that **Flux is not installed in your workload container.** Since v0.2.0, an init container stages a Flux "view" into `/mnt/flux` at pod startup. Your container brings only your application; Flux is layered in at runtime. This is the same architectural instinct as an Apptainer bind mount that injects an MPI or CUDA stack into an otherwise-clean container image — decouple the tooling from the payload.

This chapter is the map of how those pieces fit and how to read the source well enough to debug it.

---

## 2. Prerequisites

- You have completed the [[flux-operator-beginner-guide|beginner's guide]] and have a working MiniKube + operator setup on Apple Silicon.
- Comfort reading Go to *follow* control flow (not to write it). The controller lives in `controllers/flux/` and the API types in `api/v1alpha2/`.
- Working knowledge of Kubernetes objects: Jobs, Pods, Services, ConfigMaps, Secrets, PV/PVC, RBAC (Roles, ClusterRoles, bindings, ServiceAccounts). If any are shaky, [[kubernetes-deep-dive|Kubernetes Deep Dive]] fills the gaps.
- Flux fundamentals: brokers, instances, `flux submit`/`flux batch`, and the hierarchical model — see [[flux-basics|Flux Basics]] and [[flux-advanced-features|Advanced Flux Features]].
- For the RBAC and cgroups discussion, [[linux-permissions-deep-dive|Linux Permissions Deep Dive]] and [[cgroups-deep-dive|Cgroups Deep Dive]] give the underlying kernel context that Kubernetes resource limits and security contexts sit on top of.

---

## 3. Key Concepts

### 3.1 The flux-view sidecar architecture

This is the architecturally most interesting part of the project, so it gets the most space.

**The problem.** Traditionally (operator versions before 0.2.0, the `v1alpha1` design), your workload container had to have Flux *built into it* — the right version, in the right place, matching the operator's expectations. That is the classic HPC container-fat problem: every application image also has to carry the scheduler runtime, and version skew between them breaks things. The `rse-ops/flux-hpc` images exist precisely because someone had to pre-build Flux-plus-application containers.

**The solution.** Move Flux *out* of the workload container and stage it in at runtime as a **view**. Concretely:

1. The operator adds an **init container** to each pod, built from a `flux-view` image (`ghcr.io/converged-computing/flux-view-rocky:tag-9`, `flux-view-ubuntu:tag-jammy`, etc., with arm64 builds available). Flux is built into these images as a Spack view.
2. That init container copies (stages) the Flux view into a shared volume mounted at **`/mnt/flux`**, visible to the main application container.
3. The init container also generates all the configuration under that root: `broker.toml`, paths, the archive and socket locations. Everything except the Flux resource (`R`) file is prepared here.
4. Your application container starts. It has no Flux baked in, but `/mnt/flux` now contains a complete Flux install plus config.
5. To use it, you source **`/mnt/flux/flux-view.sh`**, which sets `PATH`, `PYTHONPATH`, and a **`$fluxsocket`** variable pointing at the broker's socket. Then `flux proxy $fluxsocket bash` connects you. The one-shot **`/mnt/flux/flux-connect.sh`** sources the view and connects in a single step.

```
Pod
├── init container: flux-view-rocky:tag-9   ──stages──►  /mnt/flux  (shared volume)
│      • copies the Spack-built Flux view                    ├── view/  (flux binaries, libs, python)
│      • generates broker.toml, paths, socket path           ├── flux-view.sh    (sets PATH/PYTHONPATH/$fluxsocket)
│                                                            ├── flux-connect.sh (source + flux proxy)
│                                                            └── load-fluxion.sh (load graph scheduler)
│
└── app container: rockylinux:9 (your payload, NO flux)
       • sees /mnt/flux
       • `. /mnt/flux/flux-view.sh; flux proxy $fluxsocket bash`  → live Flux instance
```

**Container requirements (v0.2.0+).** Because Flux is layered in, your container only needs: the active user to be **root** (or a non-root user with `sudo`), **curl/wget** installed, and a base compatible with **Debian/Ubuntu or Rocky Linux**. That's it. This is why "build my own arm64 workload container" (escape hatch 3 in the beginner guide) is easy — the Dockerfile is trivial.

**The Apptainer analogue.** If you run Apptainer on Sol/Phoenix, you already solve this problem with bind mounts: you keep the application image clean and `--bind` the host's MPI, libfabric, or CUDA stack into it at run time, so the container and the host interconnect stack stay in sync without rebuilding the image. The flux view is the same move, done by an init container into a shared `emptyDir` instead of a bind mount from the host. Same decoupling, different mechanism. See [[isaaclab-metagrasp-apptainer-hpc-deep-dive|the Apptainer HPC deep dive]] for the bind-mount version.

> **Docs drift:** You can opt out of the view entirely with `flux.container.disable: true`, which reverts to the `v1alpha1` "Flux baked into the container" model. The operator still runs an init container in that case (to generate config), but expects Flux to already be present in your image. The `examples/tests/disable-view` example shows this. Most users should stay with the view.

### 3.2 Reconciliation

A Kubernetes controller runs a **reconcile loop**: it watches objects, and whenever one changes (or on a periodic resync), it computes the difference between desired state (the MiniCluster spec) and actual state (what exists in the cluster) and takes actions to close the gap. This is the fundamental difference from Warewulf: provisioning is a *continuous control loop*, not a one-shot at boot. If a pod dies, the loop notices and acts.

For the Flux Operator, on **create**: the controller watches MiniCluster resources; when one appears it creates the ConfigMaps, Secret, headless Service, and Indexed Job, in dependency order, then watches the Job's pods come up. On **update** (e.g., you re-apply with a new `size`): it reconciles toward the new spec — scaling down re-applies the CRD and Flux sees nodes go offline; scaling up cannot exceed `maxSize` (which defaults to `size` if unset). On **delete**: the owner references it set cause Kubernetes garbage collection to tear down the child objects.

To read the source: `controllers/flux/` holds the `MiniCluster` reconciler. You are looking for the `Reconcile(ctx, req)` method and the `ensure*` / `create*` helpers it calls for each object type. You do not need to write controller-runtime to follow it — trace which objects each helper creates and in what order. The API types in `api/v1alpha2/` define every field in the CRD reference below, with `+kubebuilder` markers that generate the CRD YAML and OpenAPI spec.

### 3.3 Bootstrap and networking

**Why an Indexed Job, not a Deployment.** Flux brokers need **stable identities and stable hostnames**: rank 0 must be reachable at a predictable name, and workers must know where rank 0 is before they start. A Deployment gives you fungible, randomly-named pods — wrong for this. A **batch/v1 Indexed Job** gives each pod a stable completion index (0..N-1) and, paired with a headless Service, a stable DNS name. Pod 0 gets label `job-index=0` and is the lead broker; that label doubles as a Service selector.

**Headless Service and DNS.** The operator creates a headless Service (default name `flux-service`) so each pod is resolvable at:

```
flux-sample-0.flux-service.flux-operator.svc.cluster.local
flux-sample-1.flux-service.flux-operator.svc.cluster.local
...
```

Only the lead broker (index 0) strictly needs to be reachable by the others. Setting `network.minimalService: true` trims the networking to just that, at the cost of not being able to ping other nodes by hostname. This is the CoreDNS-as-`/etc/hosts` analogy from the beginner guide — but on MiniKube the DNS addon must be enabled by hand (`ingress-dns`), whereas GKE provides it. A MiniCluster that hangs at startup on a laptop is almost always this.

**The curve certificate.** Brokers authenticate to each other over ZeroMQ using a CURVE certificate. The operator generates it once and stores it in a Secret mounted into the pods — there is **no longer a separate certificate-generator pod** (that was removed in the 3.3 refactor). For bursting, you can share this certificate (`flux.curveCert`) so a bursted-to cluster can talk to the cluster it bursted from.

**Connect timeout and slow startup.** Because there's no cert-gen pod to serialize startup, workers' ZeroMQ sockets try to connect before the headless Service is reliably up, then enter exponential backoff — which can make startup slow. The mitigation is `flux.connectTimeout` (default `5s`; empirically 1–5s is optimal for LAMMPS-scale clusters). Set it to `""` to omit the parameter; `0s` is not honored. An additional trick documented upstream is adding a dummy service container that "warms up" the network. This is genuinely a rough edge — upstream notes a residual Kubernetes networking issue they intend to reproduce for the networking SIG.

### 3.4 RBAC

The operator's ServiceAccount needs broad permissions because it creates and deletes many object types on your behalf. Concretely it needs create/get/list/watch/update/delete over: **Jobs** (batch/v1), **Pods**, **Services**, **ConfigMaps**, **Secrets**, and its own **MiniCluster** custom resources (plus status subresource). Think of this as the Kubernetes analogue of the Slurm coordinator's privileges combined with sudoers — but expressed per-API-verb, per-resource.

Inspect what got installed:

```bash
# mac$
kubectl get clusterrole -o name | grep -i operator
kubectl describe clusterrole operator-manager-role      # name may vary by version
kubectl get clusterrolebinding -o name | grep -i operator
```

**What you'd tighten in a shared cluster.** The default install grants cluster-wide (ClusterRole) permissions. On a multi-tenant cluster you would want to (a) scope the operator to specific namespaces with Roles/RoleBindings instead of ClusterRoles where possible, (b) drop Secret access to only what's needed if you manage curve certs externally, and (c) constrain the `securityContext` the operator will honor — because MiniCluster pods run as root by default (a container requirement), which is exactly the kind of thing a shared-cluster admin scrutinizes. The [[linux-permissions-deep-dive|Linux Permissions Deep Dive]] and [[cgroups-deep-dive|Cgroups Deep Dive]] cover the uid/gid and resource-isolation mechanics that these security contexts and resource limits ultimately rest on.

---

## 4. Step-by-Step: Reading the System

### 4.1 MiniCluster CRD field reference

This is the table to return to. Fields are grouped as they appear under `spec`. The "When I'd set this" column is the practical filter — most fields you will never touch.

**Top-level spec fields**

| Field | Type | Default | What it does | When I'd set this |
|---|---|---|---|---|
| `size` | int | required | Number of pods (brokers) to create. Also the minimum the broker must see online to start. | Always — it's your node count. |
| `maxSize` | int | = `size` | Largest size you can scale to (registers that many workers in broker.toml). Must be > `size`. | Elastic/autoscaling experiments. |
| `tasks` | int | 1 | Tasks per pod. If `tasks > size` you get `-N <size> -n <tasks>`; set to `0` to get only `-N <size>`. | Controlling the `-n` Flux gets. |
| `backoffLimit` | int | 100 | Job retry count on failure. Must be > 0. | Fail-fast testing (set to 1). |
| `interactive` | bool | false | Start broker with no command (persistent). Equivalent to `sleep infinity` but exits cleanly on `flux shutdown`. | Interactive/persistent clusters. |
| `launcher` | bool | false | Don't wrap the command in `flux submit` — for executors that launch Flux jobs themselves (Snakemake, Nextflow). | Workflow managers. |
| `jobLabels` | map | — | Custom labels on the Job. Pods always also get `job-index`. | Selecting/organizing jobs. |
| `deadlineSeconds` | int | ∞ | Max running time; timer pauses if the Job is suspended. | Bounding runaway jobs. |
| `cleanup` | bool | false | Operator deletes pods and storage when the job finishes. | Unattended runs (but you lose logs). |

**`network`**

| Field | Default | What it does | When I'd set this |
|---|---|---|---|
| `network.disableAffinity` | false | Turns off the one-pod-per-node affinity (`topology.kubernetes.io/zone`, `kubernetes.io/hostname`). | Laptop MiniKube (single node) where you want multiple pods per node. |
| `network.headlessName` | `flux-service` | Rename the headless Service. | Naming collisions / conventions. |

**`flux`** (options for the Flux runtime and the view)

| Field | Default | What it does | When I'd set this |
|---|---|---|---|
| `flux.arch` | (x86) | Set to `"arm"` for arm containers — controls which helper binaries are installed, not the container itself. | **Always on Apple Silicon with arm images.** |
| `flux.container.image` | a flux-view base | The flux-view image staged into `/mnt/flux`. | Matching your app's OS (rocky vs ubuntu). |
| `flux.container.pythonPath` | derived | PYTHONPATH into the view's Python. | Custom Python integration. |
| `flux.container.disable` | false | Don't stage the view; expect Flux in your container (v1alpha1 style). | Legacy images with Flux baked in. |
| `flux.container.resources` | — | CPU/memory for the init/view container. | Multi-pod-per-node with static CPU policy. |
| `flux.completeWorkers` | false | When a lead broker is killed, Complete instead of restart. | Autoscale-down / node draining. |
| `flux.topology` | flat (kary) | Broker tree shape: `kary:2`, `kary:1`, `binomial`. Inspect with `flux overlay status`. | Large clusters / tree tuning. |
| `flux.submitCommand` | `flux submit` | Override the submit verb (e.g., `flux mini submit` for old Flux). | Version-skewed containers. |
| `flux.optionFlags` | — | Default `-o` flags (e.g., `-ompi=openmpi@5`). | MPI personality defaults. |
| `flux.logLevel` | — | Flux log verbosity (e.g., `7`). | Debugging. |
| `flux.wrap` | — | Adds `--wrap=...` to start commands (e.g., `strace,-e,network,-tt`). | Deep debugging. |
| `flux.scheduler.queuePolicy` | `fcfs` | `fcfs` or `easy` (backfill). Writes `queue-policy` into broker.toml. | Backfill scheduling. |
| `flux.minimalService` | false | Only expose the lead broker over the network. | Minimizing networking; can't ping other nodes. |
| `flux.brokerConfig` | generated | Provide the entire broker.toml as a string. | Experiments / full control. |
| `flux.curveCert` | generated | Provide/share the CURVE certificate. | Bursting between clusters. |
| `flux.connectTimeout` | `5s` | ZeroMQ connect timeout (`-Stbon.connect_timeout`). `""` to omit; `0s` not honored. | Tuning slow startup. |
| `flux.bursting` / `flux.leadBroker` | — | Declares external burst targets (root cluster) or the broker to burst from (bursted cluster), with sizes/hostlists. | Cloud bursting (advanced). |

> **Note:** By default the operator loads a *simple* scheduler. To use Fluxion (Flux's graph-aware scheduler), connect to the lead broker and run `bash /mnt/flux/load-fluxion.sh`, then confirm with `flux module list` (expect `sched-fluxion-qmanager` and `sched-fluxion-resource`).

**`logging`** (verbosity of the in-pod job script, not the operator logs)

| Field | Default | What it does |
|---|---|---|
| `logging.quiet` | false | Suppress all verbose output; only your job's stdout prints (used in CI). Was called `test` in early versions. |
| `logging.strict` | true | Bash strict mode; a worker entrypoint error exits non-zero. Set false to pass over errors while debugging. |
| `logging.timed` | false | Time the main Flux command (`FLUXTIME` prefix). Requires `/usr/bin/time` in the container. |
| `logging.debug` | false | Extra Flux submission verbosity. |
| `logging.zeromq` | false | Log ZeroMQ socket events (useful to watch workers connect/retry). |

**`archive`**

| Field | What it does | When I'd set this |
|---|---|---|
| `archive.path` | Load state via `flux system reload` at start and `flux dump` at stop (e.g., `/state/archive.tar.gz`). Needs a persistent volume shared across MiniClusters. | Saving Flux state between runs. |

**`pod`** (pod-spec passthrough for the Indexed Job)

`pod.labels`, `pod.annotations`, `pod.resources` (Overhead-style memory/cpu), `pod.schedulerName` (e.g., `fluence` — the Fluxion Kubernetes scheduler plugin from `flux-framework/flux-k8s`), `pod.serviceAccountName`, `pod.restartPolicy`, `pod.runtimeClassName` (e.g., `nvidia`), `pod.automountServiceAccountToken`, `pod.nodeSelector`, `pod.tolerations`, `pod.hostIPC`, `pod.hostPID`, `pod.securityContext` (e.g., `fsGroup`). Set these when you need standard Kubernetes pod controls — node placement, GPU runtime class, taint tolerations, security context — that the operator otherwise leaves at defaults.

**`containers`** (a list; one is the Flux runner)

| Field | Default | What it does | When I'd set this |
|---|---|---|---|
| `name` | — (required for non-runners) | Container name. | Multi-container pods. |
| `image` | required | Workload image. No Flux needed (staged via view). Root or sudo-capable. | Always. |
| `cores` | 1 | Exposes a cores variable to the entrypoint template (does not allocate). | Template logic. |
| `command` | — | The workload. **Present → ephemeral; absent → persistent.** One of `command`/`script`/`batch` only. | Ephemeral runs. |
| `script` | — | Inline script content written to a file and run as the command — no need to bake an executable into the image. | Quick scripts without a custom image. |
| `batch` | false / — | As a bool on the runner, mark a batch job; as a block, content written verbatim and run with `flux batch` (you supply `#flux:` directives). Mutually exclusive with `launcher`. | Many small jobs at once. |
| `resources` | — | `limits`/`requests` for cpu/memory, GPUs (`gpu-vendor.example/example-gpu`), fabrics (`vpc.amazonaws.com/efa`). | GPU/fabric/QoS control. |
| `securityContext` | — | Standard container securityContext (runAsUser, fsGroup, etc.). | Non-default uid/gid. |
| `imagePullSecret` | — | Name of an existing pull secret for private images. | Private registries. |
| `workingDir` | image WORKDIR | Override the working directory. | App expects a specific cwd. |
| `pullAlways` | false | Force re-pull between runs. | Iterating on an image tag. |
| `runFlux` | true | Which container runs Flux when there are several. Exactly one may be true. | Multi-container pods (sidecars). |
| `environment` | — | Env var key/value pairs. | Passing config/secrets to the app. |
| `ports` | — | Container ports to expose (list of numbers). | Services (RESTful API, RabbitMQ, etc.). |
| `preCommand` | — | Custom shell run before the entrypoint for brokers/workers (e.g., redefine the `asFlux` sudo prefix for MPI/EFA env). | MPI env, HOME tweaks. |
| `commands.init` | — | Runs first; set `PATH`/`PYTHONPATH`/`LD_LIBRARY_PATH` for asFlux. | Conda/Spack env. |
| `commands.pre` | — | Like preCommand but broker+worker only, after early env setup. | Debug prints, setup. |
| `commands.script` | — | Custom entrypoint script (chmod +x, given to flux submit). Not allowed with `command` on a runner. | Fully custom entrypoint. |
| `commands.preWorker` / `preBroker` | — | Pre logic for only workers or only the broker. | Role-specific setup. |
| `commands.post` | — | Runs after everything finishes. | Cleanup / result upload. |
| `commands.runFluxAsRoot` | false | Run Flux as root (e.g., for CSI storage that shouldn't be chown'd to flux). | Certain storage drivers. |
| `commands.prefix` | — | Wrapper around flux submit/broker/start (e.g., a storage driver executable). | Fusion/CSI storage. |
| `fluxUser.uid` / `.name` | 1000 / `flux` | uid/name for the created flux user (auto-detected if the user exists). | Custom uid mapping. |
| `diagnostics` | false | Run `flux` diagnostics + a final sleep so you can shell in and look around. | Debugging a cluster. |
| `lifeCycle.postStartExec` / `.preStopExec` | — | Pod lifecycle hooks. | Init/teardown hooks. |

**`volumes`** (as of v0.2.0 the operator no longer manages its own volumes — you create them and tell it)

Supported volume types, keyed by a lowercase name under a container's `volumes`:

- **hostPath** — `{ path: /in-pod, hostPath: /on-node }`. Good for local dev (this is the `minikube mount` path from the beginner guide). Often paired with a `PersistentVolume` (`storageClassName: manual`, `hostPath`) and matching `PersistentVolumeClaim`.
- **emptyDir** — `{ emptyDir: true }`, optionally `emptyDirMedium: "memory"` (binds `/dev/shm`, inherits host shared memory) and `emptyDirSizeLimit: "64Gi"`. The flux view itself uses a shared volume of this kind.
- **PVC** — `{ path: /workflow, claimName: data }` for an existing PVC/PV. Same claim name must use the same path across containers.
- **configMap** — `{ configMapName: nginx-conf, path: /etc/nginx/conf.d, items: {...} }`, typically for sidecar service containers.
- **secret** — `{ path: /etc/certs, secretName: certs }` to mount an existing Secret.

> **Gotcha:** `ReadWriteMany` is what makes a PV shareable across many pods; not every backend supports it, and on a laptop you fake shared storage with hostPath + `minikube mount`. On a real cluster this is where BeeGFS/NFS/CSI enter — see the Sol/Phoenix section.

### 4.2 The Python SDK

The operator ships a Python SDK (`sdk/python/v1alpha2`) for defining and deploying MiniClusters programmatically and for port-forwarding to a running one. Conceptually:

```python
# mac$  Illustrative — confirm class/argument names against the installed SDK version.
from fluxoperator.models import MiniCluster, MiniClusterSpec, MiniClusterContainer

container = MiniClusterContainer(
    image="rockylinux:9",
    command="flux run -N2 hostname",
)
spec = MiniClusterSpec(size=2, containers=[container])
minicluster = MiniCluster(
    api_version="flux-framework.org/v1alpha2",
    kind="MiniCluster",
    metadata={"name": "flux-sample", "namespace": "flux-operator"},
    spec=spec,
)
# Then apply via the kubernetes Python client (create_namespaced_custom_object).
```

<!-- UNVERIFIED: exact SDK class and field names are generated and vary by version; treat this as the shape, not the literal API. Generate/inspect the SDK with `make api` in the repo. -->

**How it's generated, and the caveat.** The SDK is generated from the Go API types via openapi-gen: the `+k8s:openapi-gen=true` markers on the Go types produce a Go OpenAPI spec (`zz_generated.openapi.go`), a small script (`hack/python-sdk/main.go`) turns that into swagger JSON, and the generator emits the Python package. You regenerate with `make api` (or `make pre-push` to also rebuild the deployment YAML).

The important caveat, which the drop-in prompt for this tutorial flagged and which the docs corroborate: **defaults do not all carry through the openapi-generator.** The generated Python models will not necessarily reflect every default the Go CRD applies server-side. In practice this means: don't assume a field you left unset in the Python object has the same default as the CRD — set fields explicitly when they matter, and validate the object you actually submitted (`kubectl get minicluster -o yaml`) rather than trusting the SDK's client-side view. Some template files (`setup.py`, docs) are overwritten on regeneration and must be edited in `hack/python-sdk/template`, not in the generated tree.

### 4.3 Where the project is rough

An honest inventory, because you asked for the version that doesn't oversell:

- **Maturity.** Latest release is **v0.2.1 (August 2024)**, four releases total, single-digit stars/forks, and the codebase is majority Python (SDK) with the Go controller a minority. This is a research-grade project from LLNL's converged-computing effort, not a CNCF-graduated operator with a broad maintainer base.
- **Docs drift.** The user guide still references `v1alpha1` sample paths while the repo is on `v1alpha2`; the SDK docs reference `sdk/python/v1alpha1` paths. Several deployment tutorials (IBM cloud) were removed as untested for v2. Read the repo when in doubt.
- **Networking startup.** The removal of the cert-gen pod improved the design but exposed a ZeroMQ/headless-service race that makes startup slow without `connectTimeout` tuning and network warmup tricks. Upstream acknowledges a residual Kubernetes networking issue they haven't fully root-caused.
- **Scheduling defaults.** You get a *simple* scheduler unless you manually load Fluxion — surprising if you came for Flux's graph scheduling and assumed it was on.
- **Storage.** The operator deliberately stepped *back* from managing volumes (v0.2.0) because the general case was too hard; you now wire up PV/PVC yourself. Honest, but it means storage is your problem.
- **Multi-container / multi-pod-per-node.** Only one container per pod may be the Flux runner; getting multiple pods per node requires static CPU manager policy plus Guaranteed QoS — fiddly.
- **Single-runner assumption and validation gaps.** Some constraints (one `runFlux: true`, `command` xor `script`) are validated; others you discover by failure.

None of this makes it unusable — the beginner guide runs real work on it. It does mean you should treat it as capable research software, budget time for debugging the tooling, and pin versions.

---

## 5. Practical Examples

### Example 1 — A fully-specified ephemeral MiniCluster

Bringing many reference fields together for an arm64 laptop run:

```yaml
# apply this
apiVersion: flux-framework.org/v1alpha2
kind: MiniCluster
metadata:
  name: flux-sample
  namespace: flux-operator
spec:
  size: 2
  flux:
    arch: "arm"                     # arm64 laptop
    connectTimeout: "2s"            # faster startup on a single node
    scheduler:
      queuePolicy: easy             # backfill
  network:
    disableAffinity: true           # single-node MiniKube
  logging:
    timed: true
  containers:
    - image: rockylinux:9
      command: "flux run -N2 hostname"
      resources:
        limits:
          cpu: 1
          memory: 512M
```

### Example 2 — Persistent cluster with archived state

```yaml
# apply this  (requires a shared PV mounted at /state across runs)
spec:
  size: 4
  interactive: true
  archive:
    path: /state/archive.tar.gz
  flux:
    arch: "arm"
  containers:
    - image: rockylinux:9
      volumes:
        state:
          path: /state
          claimName: flux-state
```

State is `flux system reload`ed at start and `flux dump`ed at stop, so a later MiniCluster resumes it.

### Example 3 — Reading the controller source to answer a real question

Question: *"When I re-apply with a larger `size`, what actually happens?"* Trace path: open `api/v1alpha2/minicluster_types.go` to confirm `Size`/`MaxSize` semantics, then `controllers/flux/` reconcile helpers for where the Job's parallelism/completions and the broker.toml worker list are computed. You'll find that `maxSize` pre-registers workers in broker.toml so scaling up to (but not beyond) `maxSize` doesn't require regenerating config. This is the kind of question the source answers faster than the docs.

---

## 6. Hands-On Exercises

1. **Map the object graph to owner references.** Apply a MiniCluster, then `kubectl get job,pod,cm,secret,svc -n flux-operator -o json | jq '.items[] | {kind:.kind, name:.metadata.name, owner:.metadata.ownerReferences}'`. Confirm the Job owns the pods and the MiniCluster owns the rest — this is what makes `kubectl delete minicluster` cascade.

2. **Prove the view is separate from the payload.** In an interactive Rocky MiniCluster, run `which flux` *before* sourcing the view (expect not found) and after (expect `/mnt/flux/...`). Then `ls /mnt/flux` and identify `flux-view.sh`, `flux-connect.sh`, `load-fluxion.sh`.

3. **Load Fluxion and inspect topology.** Load Fluxion (`bash /mnt/flux/load-fluxion.sh`), then set `flux.topology: kary:2` on a `size: 7` cluster and compare `flux overlay status` against the default flat topology.

4. **Tighten RBAC on paper.** Dump the operator's ClusterRole and write a namespaced Role that would grant the minimum for single-namespace operation. Note which cluster-scoped permissions (CRD registration) genuinely cannot be namespaced.

5. **Break the SDK-default assumption.** Create a MiniCluster via the Python SDK leaving a field unset that has a non-trivial CRD default, apply it, then `kubectl get minicluster -o yaml` and check whether the server applied the default you expected. Document any mismatch — this is the openapi-generator caveat made concrete.

6. **connectTimeout sweep.** On a fixed `size: 4` cluster, time startup with `connectTimeout` at `""`, `1s`, `5s`, and `""`+`logging.zeromq: true`. Watch the worker connect/retry log lines and correlate with startup time.

---

## 7. Troubleshooting

| Symptom | Cause | Resolution |
|---|---|---|
| Flux missing in pod even after startup | Didn't source the view, or `flux.container.disable: true` with no Flux in the image | `. /mnt/flux/flux-view.sh`; or remove `disable`, or bake Flux in |
| `flux resource list` shows fewer nodes than `size` | Some workers never joined (DNS/network) or affinity blocked scheduling | Check worker logs for connect retries; enable `ingress-dns`; `network.disableAffinity: true` on single node |
| Only the simple scheduler; no backfill/graph placement | Fluxion not loaded | `bash /mnt/flux/load-fluxion.sh`; `flux.scheduler.queuePolicy: easy` |
| Slow, flaky startup | ZeroMQ connect race before headless service is ready | Set `flux.connectTimeout` (1–5s); consider a warmup service container; `logging.zeromq: true` to observe |
| Scale-up beyond a point rejected | Exceeds `maxSize` (defaults to `size`) | Set `maxSize` up front for elasticity |
| Multiple pods won't share a node with resources set | Needs static CPU manager policy + Guaranteed QoS | Configure kubelet `cpuManagerPolicy: static`; give every container (incl. init) cpu+memory |
| SDK object applies unexpected defaults | openapi-generator doesn't carry all CRD defaults | Set fields explicitly; verify with `kubectl get minicluster -o yaml` |
| CSI-backed storage permission errors | Flux user can't own the mount | `commands.runFluxAsRoot: true` or a storage `prefix` |
| Deleting MiniCluster leaves orphans | Force-quit run broke owner-ref GC | Full teardown incantation (beginner guide, Step 10) |

---

## 8. References

- MiniCluster CRD spec (the field reference source) — https://flux-framework.org/flux-operator/getting_started/custom-resource-definition.html
- Developer Guide (flux-view sidecar, container requirements) — https://flux-framework.org/flux-operator/development/developer-guide.html
- Designs — https://flux-framework.org/flux-operator/development/designs.html
- Debugging — https://flux-framework.org/flux-operator/development/debugging.html
- Language SDKs (Python, openapi-gen caveat) — https://flux-framework.org/flux-operator/development/sdks.html
- User Guide — https://flux-framework.org/flux-operator/getting_started/user-guide.html
- Helper Clients — https://flux-framework.org/flux-operator/getting_started/helper-clients.html
- GitHub repo (`api/v1alpha2`, `controllers/flux`, `sdk/python`, `examples/tests`, `config/samples`) — https://github.com/flux-framework/flux-operator
- Fluxion Kubernetes scheduler plugin (`fluence`) — https://github.com/flux-framework/flux-k8s
- Flux Apps Helm — https://github.com/converged-computing/flux-apps-helm
- Flux RESTful API — https://github.com/flux-framework/flux-restful-api
- Flux core docs — https://flux-framework.readthedocs.io/
- The Flux Operator paper — Sochat et al., F1000Research 2024, 13:203 — https://doi.org/10.12688/f1000research.147989.1

---

## 9. Related Tutorials

- [[flux-operator-beginner-guide|Flux Operator Beginner's Guide]] — install, hands-on, and the arch-check discipline
- [[kubernetes-deep-dive|Kubernetes Deep Dive]] — Jobs, controllers, RBAC, and networking internals
- [[flux-basics|Flux Basics for Slurm Users]] — the Flux command and instance model
- [[flux-advanced-features|Advanced Flux Features]] — hierarchical scheduling and Fluxion in depth
- [[flux-system-setup|Flux System Setup]] — Flux at the system level on bare metal (the Sol/Phoenix comparison point)
- [[flux-snakemake-workflows|Flux + Snakemake Workflows]] — `launcher: true` and workflow-manager integration
- [[cgroups-deep-dive|Cgroups Deep Dive]] — the kernel mechanism behind Kubernetes resource limits and QoS
- [[linux-permissions-deep-dive|Linux Permissions Deep Dive]] — uid/gid and the security-context underpinnings
- [[isaaclab-metagrasp-apptainer-hpc-deep-dive|IsaacLab MetaGrasp on Apptainer/HPC]] — bind-mount tooling injection, the Apptainer analogue of the flux view
- [[docker-bake-deep-dive|Docker Bake Deep Dive]] — building the multi-arch workload images escape hatch 3 needs
- [[hyperqueue-deep-dive|HyperQueue Deep Dive]] — a lighter-weight meta-scheduler for packing tasks, for contrast

---

## 10. Summary

The Flux Operator reconciles a `v1alpha2` MiniCluster into ConfigMaps, a Secret, a headless Service, and an **Indexed Job** of Flux-broker pods — the Indexed Job chosen specifically because Flux needs stable ranks and hostnames that a Deployment can't give. Its defining design move is the **flux-view sidecar**: since v0.2.0 Flux is staged into `/mnt/flux` by an init container rather than baked into your workload image, which is the same decoupling instinct as an Apptainer bind mount and is why your containers can be trivially small and arm64-native. Brokers authenticate over ZeroMQ with a CURVE certificate (no cert-gen pod since the 3.3 refactor), find each other over the headless Service (DNS you must enable yourself on MiniKube), and tolerate the resulting startup race via `connectTimeout` tuning. The CRD field reference in §4.1 is the thing to bookmark; most fields you'll never set, but `size`, `interactive`, `command`/`script`/`batch`, `flux.arch`, `network.disableAffinity`, and the `volumes` types are your daily drivers. The Python SDK works but doesn't carry all CRD defaults — verify server-side. The project is early and the docs drift, but it's honest, capable research software.

---

## Closing Section — HPC / Slurm Relevance for Sol and Phoenix

This is the applied part: does any of this belong in an ASU HPC admin's world?

### Flux Operator vs. Slurm-on-bare-metal

| Dimension | Slurm on bare metal (Sol/Phoenix) | Flux Operator on Kubernetes |
|---|---|---|
| Scheduling model | Flat partitions/queues, central `slurmctld` | Hierarchical, graph-based (Flux); Fluxion optional and off by default |
| Provisioning | Warewulf images + Ansible, one-shot at boot | Container images pulled per-pod; continuous reconcile loop |
| Storage | BeeGFS / parallel FS, native, fast | PV/PVC/CSI you wire up; `ReadWriteMany` not universal; hostPath for dev |
| Multi-tenancy | Slurm accounts, QOS, fairshare — mature | Namespaces + RBAC + quotas — general but not HPC-shaped; fairshare absent |
| MPI / interconnect | Native libfabric/UCX over your fabric, tuned | Overheads; EFA/fabric via `resources` limits; not designed for tight coupling |
| Operational burden | Known, staffed, battle-tested | Extra stack (K8s + operator + CRDs); you debug the tooling; early software |
| Elasticity / burst | Hard (fixed metal) | Native — scale pods, burst to cloud with shared curve cert |
| Declarative state | Partial (config mgmt) | Whole cluster is a versioned YAML |

**Judgment.** For steady-state, tightly-coupled MPI on owned metal, Slurm-on-bare-metal wins on every axis that matters to a production HPC center: interconnect performance, mature fairshare multi-tenancy, native parallel storage, and an operational model your team already staffs. The Flux Operator's advantages — elasticity, declarative state, cloud burst, a uniform API — are real but orthogonal to what Sol and Phoenix do well today. It is not a Slurm replacement for your bare metal.

### Where this would (and wouldn't) fit Sol/Phoenix

The realistic options are (a) cloud burst, (b) a Kubernetes island alongside Slurm, (c) a researcher-facing self-service surface, or (d) not yet. **The argument is for (c), with (d) as the honest near-term answer.**

- Not (a) cloud burst as a first move: bursting is the operator's most experimental surface (curve-cert sharing, hostlist plumbing), and you'd be adopting the least-mature feature first.
- Not (b) a standing Kubernetes island purely for HPC: that's operational cost for capability you already have better in Slurm.
- Yes (c) eventually: the compelling niche is a *self-service, container-native surface* for researchers who already live in Kubernetes-adjacent tooling (ML pipelines, workflow engines like Snakemake/Nextflow via `launcher: true`, services that need to stand up a small Flux cluster on demand). That's a genuinely different user than your `sbatch` regulars, and it's where declarative, ephemeral MiniClusters shine.
- But (d) not yet, at v0.2.1: pilot it on a small K8s testbed, not on production capacity, until the networking startup story and version/docs stability improve.

### What transfers even if you never deploy it

- **Hierarchical scheduling.** Flux's "every allocation is itself a scheduler" model is worth internalizing regardless of substrate; it changes how you think about nested workflows even under Slurm. See [[flux-basics|Flux Basics]] and [[flux-advanced-features|Advanced Flux Features]].
- **Container-native job specs.** The `command`/`script`/`batch` + view model is a clean separation of payload from tooling — the same instinct you already apply with Apptainer bind mounts ([[isaaclab-metagrasp-apptainer-hpc-deep-dive|Apptainer HPC]]).
- **Declarative cluster state as a discipline.** Treating the whole cluster as one versioned, reconciled YAML is a useful lens on your Warewulf + Ansible provisioning — even if you never adopt Kubernetes, the reconcile-loop mindset (converge to declared state, continuously) is a better model than one-shot provisioning.

### What to read next

- **Flux core** — https://flux-framework.readthedocs.io/ (the scheduler you're actually driving)
- **Flux RESTful API** — https://github.com/flux-framework/flux-restful-api (programmatic job submission when no command is given)
- **Flux Apps Helm** — https://github.com/converged-computing/flux-apps-helm (ready-made HPC app deployments/experiments)
- **converged-computing org** — https://github.com/converged-computing (the flux-view builds, cloud experiments, and the broader HPC-on-Kubernetes effort)
- **The paper** — Sochat et al., F1000Research 2024, 13:203 — https://doi.org/10.12688/f1000research.147989.1
