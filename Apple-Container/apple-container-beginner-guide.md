---
title: "Apple container — Beginner's Guide"
date: 2026-06-24
difficulty: beginner
tags: [apple-container, containers, macos, apple-silicon, docker, oci, rosetta, arm64, amd64, virtualization]
---

# Apple `container` — Beginner's Guide

> **Version note:** This guide targets `container` **1.0.0** (released 2026-06-09). The project is under active development and the official docs are published *per release tag* — the `main`-branch docs warn they describe the current branch, not a fixed release. Where a flag matters, confirm it against `container <subcommand> --help` on your machine. A couple of `container machine` flags below differ from earlier prompts circulating online; the behavior here follows the current Apple documentation.

## Overview

Apple `container` is a command-line tool for **creating and running Linux containers on an Apple silicon Mac**. It is written in Swift, open-sourced by Apple, and built on Apple's [Containerization](https://github.com/apple/containerization) framework. If you have used Docker, the command surface will feel familiar — `container run`, `container build`, `container exec` — but the engine underneath is fundamentally different.

The headline difference: **each container runs in its own lightweight virtual machine**. Most Mac container tools (Docker Desktop, Colima, Lima, OrbStack) boot a *single* shared Linux VM and run all your containers inside it. Apple `container` instead spins up a minimal, dedicated VM per container using Apple's Virtualization and vmnet frameworks. This gives each workload VM-grade isolation while keeping boot times and memory use close to ordinary containers.

By the end of this guide you will be able to install `container`, start its background services, run and build OCI images, mount files, publish ports, run `linux/amd64` images via Rosetta, and clean up — everything you need for day-to-day container work on a Mac. The advanced material (the per-container-VM internals, `container machine`, tool comparisons, and HPC workflows) lives in the companion [[apple-container-deep-dive|Apple container Deep Dive]].

## Prerequisites

You need **all** of the following — these are hard constraints, not recommendations:

- **An Apple silicon Mac (M1 or newer).** `container` does not run on Intel Macs.
- **macOS 26.** `container` depends on new virtualization and networking features in macOS 26. It can be *installed* on macOS 15, but with significant limitations (no container-to-container networking, no custom networks). Treat macOS 26 as the real requirement.
- **The `container` 1.0.0 installer**, downloaded from the [releases page](https://github.com/apple/container/releases). Install the signed package, then confirm the CLI is on your `PATH`:

  ```zsh
  container --version
  ```

- **Comfort with a terminal and basic Docker concepts** (images, containers, Dockerfiles). If container resource isolation is new to you, [[cgroups-beginner-guide|the Cgroups Beginner Guide]] explains the Linux primitives, and [[linux-permissions-beginner-guide|Linux Permissions]] covers the file-ownership model you will see inside containers.

> **Callout — Apple silicon + macOS 26 only.** If `container system start` fails immediately, check `sw_vers` and `uname -m` first. You should see `ProductVersion: 26.x` and `arm64`.

## Key Concepts

**OCI images.** `container` consumes and produces standard [Open Container Initiative](https://opencontainers.org/) images. Images you build run anywhere, and you can run images built by Docker, Podman, or any OCI-compliant tool. Nothing about your images is Apple-specific.

**Per-container VM.** Every container you start gets its own lightweight Linux VM with a minimal init (`vminitd`) as PID 1. There is no shared "docker daemon" Linux box. This is the single most important mental-model shift coming from Docker.

**The system service.** `container` runs a launch agent, `container-apiserver`, that you start with `container system start` and stop with `container system stop`. The CLI talks to this service over XPC; the service launches per-container runtime helpers and a networking helper. Nothing runs until you start the service.

**The builder.** Image builds run in a *separate* utility VM (a BuildKit-based builder) that `container` starts on first `container build`. It has its own resource limits, independent of your containers.

**Rosetta for amd64.** Your Mac is `arm64`. When you run a `linux/amd64` image, `container` executes it under **Rosetta 2 translation** — it is emulation, not native execution. It works well for most software but is slower and occasionally incompatible. See the deep dive for benchmarks and caveats.

**Default resources.** A container VM gets **1 GB RAM and 4 CPUs** by default; the builder VM gets **2 GB RAM and 2 CPUs**. Override per run with `--memory` and `--cpus`.

## Step-by-Step Instructions

### 1. Start the container service

```zsh
container system start
```

On first run, if no Linux kernel is installed yet, you are prompted to install the recommended default kernel:

```
Verifying apiserver is running...
Installing base container filesystem...
No default kernel configured.
Install the recommended default kernel from [https://github.com/kata-containers/kata-containers/...]? [Y/n]: y
Installing kernel...
```

**Verify:** list containers — you should get an empty table, not an error.

```zsh
container list --all
```

```
ID  IMAGE  OS  ARCH  STATE  IP
```

### 2. Run your first container

```zsh
container run --rm docker.io/library/alpine:latest uname -a
```

**Verify:** you should see a Linux kernel string ending in `aarch64 Linux` — proof you are running a real Linux VM on your Mac.

### 3. (Optional) Set up a local DNS domain

This lets you reach named containers by hostname (`my-web-server.test`) instead of raw IPs:

```zsh
sudo container system dns create test
```

Enter your admin password when prompted (it writes a file under `/etc/resolver`).

### 4. Build an image from a Dockerfile

Create a project directory and a `Dockerfile`:

```zsh
mkdir web-test && cd web-test
```

```dockerfile
FROM docker.io/python:alpine
WORKDIR /content
RUN apk add curl
RUN echo '<!DOCTYPE html><html><head><title>Hello</title></head><body><h1>Hello, world!</h1></body></html>' > index.html
CMD ["python3", "-m", "http.server", "80", "--bind", "0.0.0.0"]
```

Build it:

```zsh
container build --tag web-test --file Dockerfile .
```

**Verify:** the image appears in the list.

```zsh
container image list
```

```
NAME      TAG     DIGEST
python    alpine  b4d299311845
web-test  latest  25b99501f174
```

### 5. Run the web server detached

```zsh
container run --name my-web-server --detach --rm web-test
```

`--detach` (`-d`) backgrounds it; `--rm` removes it automatically when it stops. Find its IP:

```zsh
container ls
```

```
ID             IMAGE            OS     ARCH   STATE    IP
my-web-server  web-test:latest  linux  arm64  running  192.168.64.3
```

**Verify:** open the page (or use the `.test` hostname if you set up DNS):

```zsh
open http://192.168.64.3
# or: open http://my-web-server.test
```

### 6. Inspect, exec, and read logs

```zsh
container exec -it my-web-server sh        # interactive shell inside the container
container logs my-web-server               # application stdout/stderr
container logs --boot my-web-server        # VM boot + init logs
container stats --no-stream my-web-server  # one-shot resource snapshot
```

### 7. Stop and shut down

```zsh
container stop my-web-server   # --rm means it is removed on stop
container system stop          # stop the whole service when you are done
```

## Practical Examples

### Mount a host folder into a container

The `--volume` (`-v`) option maps `HOST_PATH:CONTAINER_PATH`:

```zsh
container run --rm \
  --volume ${HOME}/Desktop/assets:/content/assets \
  docker.io/python:alpine ls -l /content/assets
```

```
total 4
-rw-r--r-- 1 root root 2410 May 14 01:36 link.svg
```

The `--mount` option does the same with explicit `key=value` syntax:

```zsh
container run --rm \
  --mount source=${HOME}/Desktop/assets,target=/content/assets \
  docker.io/python:alpine ls -l /content/assets
```

### Publish a port to localhost

`--publish` (`-p`) takes `[host-ip:]host-port:container-port[/protocol]`:

```zsh
container run -d --rm -p 127.0.0.1:8080:8000 \
  node:latest npx http-server -a :: -p 8000

curl http://127.0.0.1:8080
```

### Override memory and CPUs

```zsh
container run --rm --cpus 8 --memory 32g big-image
```

### Run a `linux/amd64` image through Rosetta

```zsh
container run --arch amd64 --rm web-test uname -a
```

```
Linux ... x86_64 GNU/Linux
```

The same image run with `--arch arm64` reports `aarch64`. The `amd64` run is **Rosetta-translated emulation** — correct, but slower than native. Cross-architecture work is covered in depth in the deep dive and complements [[docker-bake-beginner-guide|Docker Bake]] for multi-platform image builds.

### Push to a registry

`container` stores registry credentials in the macOS **Keychain**:

```zsh
container registry login some-registry.example.com
container image tag web-test some-registry.example.com/fido/web-test:latest
container image push some-registry.example.com/fido/web-test:latest
```

## Hands-On Exercises

1. **First light.** Start the service and run `container run --rm docker.io/library/hello-world` (or `alpine echo hi`). Confirm it runs, then `container system stop`.
2. **Build and serve.** Recreate the `web-test` image from the steps above, run it detached, and `curl` its IP. Then `container exec -it` into it and `cat /content/index.html`.
3. **Mount and edit.** Create a folder on your Desktop with an `index.html`, mount it into a `python:alpine` container as `/content`, and serve it with `python3 -m http.server`. Edit the file on the Mac and re-request — confirm the change shows up.
4. **Resource limits.** Run a container with `--memory 512m --cpus 2`, then `container stats --no-stream` it and confirm the memory limit column reads `512 MiB`.
5. **Cross-arch.** Run a small image with `--arch arm64` and again with `--arch amd64`, comparing `uname -a` output. Note which one is emulated.

## Troubleshooting

**`container system start` fails or hangs.** Confirm you are on macOS 26 (`sw_vers`) and Apple silicon (`uname -m` → `arm64`). On macOS 15 some features are unavailable by design.

**No network access on macOS 15.** vmnet on macOS 15 creates the container network only when the first container starts, which can cause subnet disagreement and total loss of connectivity. This is a known macOS 15 limitation — the fix is to move to macOS 26. (Full detail in the deep dive and Apple's troubleshooting doc.)

**Builds run out of memory.** The builder VM defaults to 2 GB / 2 CPUs. Give it more before building:

```zsh
container builder start --cpus 8 --memory 32g
```

If it is already running: `container builder stop && container builder delete && container builder start --cpus 8 --memory 32g`.

**An `amd64` image misbehaves.** Remember it is running under Rosetta translation, not natively. Some low-level or JIT-heavy software does not translate cleanly — try the `arm64` variant, or build a native multi-arch image.

**A container reports huge memory in Activity Monitor.** macOS Virtualization only partially supports memory ballooning, so memory freed *inside* the VM is not always returned to the host. For long-running, memory-heavy containers, restart them occasionally.

**Container hostname (`*.test`) does not resolve.** You only get this if you ran `sudo container system dns create test`. Without it, use the container's IP from `container ls`.

## References

- Apple `container` repository & README — <https://github.com/apple/container>
- 1.0.0 release notes — <https://github.com/apple/container/releases>
- Guided tour (start here) — <https://github.com/apple/container/blob/main/docs/tutorials/start-here.md>
- How-to guide — <https://github.com/apple/container/blob/main/docs/how-to.md>
- Technical overview — <https://github.com/apple/container/blob/main/docs/technical-overview.md>
- Command reference — <https://github.com/apple/container/blob/main/docs/command-reference.md>
- Full documentation site — <https://apple.github.io/container/documentation/>

## Related Tutorials

- [[apple-container-deep-dive|Apple container Deep Dive]] — internals, `container machine`, tool comparison, and HPC workflows
- [[docker-test-container-beginner-guide|Docker Test Container Beginner Guide]] — Docker fundamentals that map directly onto `container`
- [[docker-test-container-deep-dive|Docker Test Container Deep Dive]] — multi-stage builds and advanced Dockerfile patterns
- [[docker-bake-beginner-guide|Docker Bake Beginner Guide]] — declarative multi-platform image builds
- [[cgroups-beginner-guide|Cgroups Beginner Guide]] — the Linux resource-isolation primitives behind containers
- [[linux-permissions-beginner-guide|Linux Permissions Beginner Guide]] — the ownership model you meet inside Linux containers
- [[kubernetes-beginner-guide|Kubernetes Beginner Guide]] — where OCI images go once you orchestrate them
- [[isaaclab-metagrasp-apptainer-hpc-beginner-guide|IsaacLab + Apptainer HPC Guide]] — taking container images to an HPC cluster

---

## Summary

Apple `container` brings Docker-style workflows to Apple silicon Macs with a distinctive twist: **one lightweight VM per container** instead of a single shared Linux VM. You start the service with `container system start`, run and build standard OCI images with familiar commands, mount host files with `--volume`, publish ports with `--publish`, and run `amd64` images through Rosetta translation. The hard constraints are real — **Apple silicon and macOS 26** — so verify your platform first.

**Next step:** when you are comfortable running and building containers, read the [[apple-container-deep-dive|Apple container Deep Dive]] to understand the per-container-VM architecture, set up a persistent `container machine` Linux environment, and learn the local-authoring → Apptainer → cluster workflow for HPC.
