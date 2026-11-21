---
title: "Skopeo — Deep-Dive Reference"
date: 2026-11-10
difficulty: advanced
tags: [skopeo, containers, oci, apptainer, hpc, registry, multi-arch, sigstore, sync, go, rootless, amd64]
---

# Skopeo — Deep-Dive Reference

## Overview

This is the reference you come back to once the basics in [[skopeo-beginner-guide|the beginner's guide]] are second nature. It covers how skopeo is actually built, how its flags map onto the underlying library, and the features that matter when you move from "pull one image" to "mirror a fleet of base images, pin everything by digest, verify signatures, and script it all into a Slurm prep step."

The running context is the same as the beginner guide: ASU **Sol** (Slurm, Rocky Linux 8, `amd64`), no root, no daemon, registry work on login nodes, a cross-compiled static `skopeo 1.25.1`, and [[isaaclab-metagrasp-apptainer-hpc-deep-dive|Apptainer]] as the runtime target. A recurring sub-theme is cross-architecture work: building on an Apple Silicon (`arm64`) Mac for deployment to `amd64` clusters, where inspecting and selecting the right platform is not optional.

**What this reference covers:** the CLI-over-library architecture; multi-arch manifest handling; digests and reproducibility; `skopeo sync` for mirroring; the four configuration files and their lookup order; signing and verification; compression and performance tuning; building skopeo from source and the meaning of each build tag; scripting patterns; and a decision table against crane, regctl, `apptainer pull`, and podman.

## Prerequisites

You should already be comfortable with everything in [[skopeo-beginner-guide|the beginner's guide]]: installing the static binary, `policy.json`, transports, `inspect`, `list-tags`, and `copy` to `oci-archive:`. You should also have:

- `jq` available for parsing JSON output.
- A mental model of OCI image manifests (a manifest points at a config blob plus layer blobs; a *manifest list* / *image index* points at several per-platform manifests).
- Familiarity with reading `man` pages — the authoritative flag references are the `docs/*.1.md` files in the skopeo source tree.
- For the signing section: GPG or a willingness to generate a sigstore keypair.
- For the HPC scripting section: knowledge of how to submit an `sbatch` job (see [[skopeo-apptainer-hpc-workflow|the HPC workflow guide]]).

## Key Concepts

### 1. Architecture: a thin CLI over `go.podman.io/image`

Skopeo is a deliberately thin [cobra](https://github.com/spf13/cobra) command-line program sitting on top of the **`go.podman.io/image`** library (historically `github.com/containers/image`). That library is where all the real work lives: it knows every transport, every manifest format, how to talk to registries, how to copy blobs, and how to evaluate the trust policy. Podman, Buildah, and CRI-O use the same library. Skopeo is the standalone CLI face of it.

Two consequences matter in practice:

- **Transports are library objects, not CLI conveniences.** When you write `oci-archive:x.tar:tag`, the string is parsed by the library's transport registry. The same transport strings work identically in Podman.
- **A `SystemContext` carries all your knobs.** Internally, every operation receives a `SystemContext` struct — where `auth.json` is, which architecture to assume, which registries config to read, TLS settings, the temp dir, and so on. Most skopeo flags are just ways to populate fields on that struct. Understanding this explains the flag naming below.

### 2. `--src-*` / `--dest-*`: two system contexts for one copy

A `skopeo copy` touches two endpoints, and each gets its own `SystemContext`. That is why many flags come in `--src-…` / `--dest-…` pairs:

| Concern | Source flag | Dest flag | Both/global |
|---|---|---|---|
| Credentials | `--src-creds user:pass` | `--dest-creds user:pass` | `--creds` (for single-endpoint cmds) |
| TLS verification | `--src-tls-verify=false` | `--dest-tls-verify=false` | — |
| Auth file | `--src-authfile` | `--dest-authfile` | `--authfile` |
| Per-endpoint registries config | `--src-registries-conf` | — | `--registries-conf` |
| Compression on write | — | `--dest-compress-format`, `--dest-compress-level` | — |
| Daemon/host | `--src-daemon-host` | `--dest-daemon-host` | — |

Single-endpoint commands (`inspect`, `delete`, `list-tags`) use the un-prefixed forms (`--creds`, `--tls-verify`, `--authfile`). The mental rule: *a copy has a left side and a right side; each side has its own context.*

### 3. Manifests vs. manifest lists (image indexes)

A single-platform image is a **manifest** → config + layers. A multi-platform image is a **manifest list** (Docker) / **image index** (OCI) → a list of `{digest, platform}` entries, each pointing at a per-platform manifest. `skopeo inspect` on a multi-arch reference, by default, resolves to *your* platform. To see the whole index, use `--raw`:

```bash
skopeo inspect --raw docker://docker.io/library/rockylinux:8.10 | jq '.manifests[] | {arch: .platform.architecture, os: .platform.os, digest: .digest}'
```

```json
{"arch": "amd64", "os": "linux", "digest": "sha256:a1b2…"}
{"arch": "arm64", "os": "linux", "digest": "sha256:c3d4…"}
{"arch": "ppc64le", "os": "linux", "digest": "sha256:e5f6…"}
```

If `.manifests` is absent, the image is single-arch.

## Step-by-Step Instructions

The "steps" in a reference are the major capability areas. Work through the ones you need.

### 1. Multi-arch handling (the cross-platform core)

When you build on an `arm64` Mac but deploy to `amd64` Rocky 8, two mechanisms matter: **overriding the assumed platform** on reads, and **controlling which platforms are copied**.

**Override the platform on inspect/copy** — pick a specific child manifest out of a list:

```bash
# Force the amd64 view even though you are on arm64
skopeo inspect --override-arch amd64 --override-os linux \
  docker://docker.io/library/rockylinux:8.10 | jq '.Architecture'
```

```text
"amd64"
```

`--override-arch`, `--override-os`, and `--override-variant` set the platform the library selects from a manifest list. Use `--override-variant v8` to distinguish, say, `arm/v7` from `arm/v8`.

**Control what `copy` writes with `--multi-arch`:**

| Value | Behavior |
|---|---|
| `system` (default) | Copy only the single image matching the current (or overridden) platform |
| `all` | Copy the *entire* manifest list and every referenced platform |
| `index-only` | Copy the manifest list structure but only the already-present images (no re-pull of children) |
| `os/arch,...` *(newer builds)* | Copy only the listed platforms |

```bash
# Mirror the full multi-arch image, preserving the index
skopeo copy --multi-arch all \
  docker://docker.io/library/rockylinux:8.10 \
  oci:/scratch/$USER/rocky-index:8.10
```

`--strip-removed-platforms` (newer builds) prunes platform entries that were filtered out so the resulting index does not dangle references.

**Checking platforms with `inspect --raw | jq`** is the reliable way to confirm an image actually ships your architecture before you spend a GPU-hour on it. A Mac→cluster example:

```bash
# On the Mac, verify the amd64 child exists and capture its digest
AMD64_DIGEST=$(skopeo inspect --raw docker://docker.io/library/python:3.12-slim \
  | jq -r '.manifests[] | select(.platform.architecture=="amd64" and .platform.os=="linux") | .digest')
echo "$AMD64_DIGEST"
# Copy exactly that child to a tarball for the amd64 cluster
skopeo copy "docker://docker.io/library/python@${AMD64_DIGEST}" \
  oci-archive:/scratch/$USER/py312-amd64.tar
```

This is the cross-platform pattern that [[docker-bake-deep-dive|Docker Bake]] complements on the build side: Bake *produces* the multi-arch image; skopeo *selects and transfers* the right slice of it.

### 2. Digests and reproducibility

Tags are mutable; digests are not. For reproducible science you pin by `@sha256:…`.

- `--preserve-digests` (on `copy`) fails the copy rather than silently re-compressing in a way that would change the digest. Use it when the exact digest must survive the transfer.
- `--digestfile PATH` (on `copy`) writes the resulting manifest digest to a file, so a script can capture what it just produced:

  ```bash
  skopeo copy --digestfile rocky.digest \
    docker://docker.io/library/rockylinux:8.10 oci-archive:rocky.tar
  cat rocky.digest   # sha256:d7d4…
  ```

- Pin in job scripts by digest, never by tag:

  ```bash
  IMG="docker://docker.io/library/rockylinux@sha256:d7d4…e3f1"
  skopeo copy "$IMG" oci-archive:/scratch/$USER/rocky-pinned.tar
  ```

This is the same discipline you apply to pinned environments with [[uv-deep-dive|uv]] or [[pixi-deep-dive|Pixi]]: pin the inputs so the output is identical months later.

### 3. `skopeo sync` — mirroring at scale

`sync` copies many images in one invocation. It has two source modes.

**Repo mode** — mirror everything (or tag-filtered) from one repository:

```bash
skopeo sync --src docker --dest dir \
  docker.io/library/rockylinux /scratch/$USER/mirror
```

The `--src` / `--dest` here name *transport kinds* (`docker`, `dir`, `yaml`), not full references.

**YAML mode** — declare a whole fleet in a file, with per-registry credentials and TLS settings:

```yaml
# images.yaml
docker.io:
  images-by-tag-regex:
    library/rockylinux: '^(8\.10|9\.3)$'
  images:
    library/alpine:
      - latest
quay.io:
  tls-verify: true
  credentials:
    username: myuser
    password: mytoken
  images-by-semver:
    libpod/alpine: '>=3.18.0'
```

```bash
skopeo sync --src yaml --dest docker images.yaml myregistry.example.org/mirror
```

Selectors inside YAML mode:

- `images` — explicit tag lists,
- `images-by-tag-regex` — all tags matching a regex,
- `images-by-semver` — all tags satisfying a semver constraint,
- per-registry `credentials`, `tls-verify`, and `cert-dir`.

Useful `sync` flags:

- `--scoped` — preserve the source registry hostname in the destination path, so `docker.io/library/alpine` lands at `…/docker.io/library/alpine` and never collides with a same-named repo from another registry.
- `--dry-run` — print what *would* be copied without transferring anything. Always run this first against a big YAML.
- `--keep-going` — do not abort the whole sync on the first failed image; report at the end. Essential for large mirrors where one bad tag should not sink the run.

**Worked example — mirror a set of base images to `/scratch` for offline compute nodes:**

```bash
cat > base-images.yaml <<'EOF'
docker.io:
  images:
    library/rockylinux: ["8.10", "9.3"]
    library/python: ["3.12-slim"]
quay.io:
  images:
    libpod/alpine: ["latest"]
EOF

skopeo sync --src yaml --dest dir --scoped --keep-going --dry-run \
  base-images.yaml /scratch/$USER/mirror      # inspect the plan
skopeo sync --src yaml --dest dir --scoped --keep-going \
  base-images.yaml /scratch/$USER/mirror      # do it
```

Now compute nodes with no internet can `apptainer build` straight from `dir:/scratch/$USER/mirror/docker.io/library/rockylinux:8.10`.

### 4. Configuration: the four files and their lookup order

| File | Default location | Purpose |
|---|---|---|
| `policy.json` | `~/.config/containers/policy.json` (root: `/etc/containers/`) | Signature trust policy. **Required.** |
| `registries.conf` | `~/.config/containers/registries.conf` (system: `/etc/containers/`) | Short-name aliases, per-registry mirrors, insecure flags |
| `registries.d/` | `~/.config/containers/registries.d/` | Per-registry signature storage/lookaside config |
| `auth.json` | `$XDG_RUNTIME_DIR/containers/auth.json`, then `~/.config/containers/auth.json` | Registry credentials written by `login` |

**`policy.json` scopes** — beyond `insecureAcceptAnything`:

```json
{
  "default": [{"type": "reject"}],
  "transports": {
    "docker": {
      "quay.io/myorg": [{
        "type": "signedBy",
        "keyType": "GPGKeys",
        "keyPath": "/home/me/.config/containers/myorg.gpg"
      }],
      "docker.io/library": [{"type": "insecureAcceptAnything"}]
    }
  }
}
```

This rejects everything by default, requires a GPG signature from `quay.io/myorg`, and accepts official Docker Hub library images unsigned. `sigstoreSigned` replaces `signedBy` for sigstore/cosign-style signatures.

**`registries.conf`** — short names and mirrors:

```toml
unqualified-search-registries = ["docker.io"]

[[registry]]
prefix = "docker.io/library"
location = "docker.io/library"
  [[registry.mirror]]
  location = "mirror.example.org/dockerhub"

[[registry]]
location = "insecure-internal.example.org"
insecure = true
```

`auth.json` **lookup order** matters on a cluster: skopeo checks `--authfile` / `--src-authfile` / `--dest-authfile` first, then `$REGISTRY_AUTH_FILE`, then `$XDG_RUNTIME_DIR/containers/auth.json`, then `~/.config/containers/auth.json`, then the legacy `~/.docker/config.json`. On a login node where `$XDG_RUNTIME_DIR` may be unset or cleared between sessions, set `REGISTRY_AUTH_FILE=~/.config/containers/auth.json` for persistence.

### 5. Signing and verification

Skopeo can both consume and produce signatures.

**sigstore (keyless-adjacent, modern):**

```bash
# Generate a sigstore keypair
skopeo generate-sigstore-key --output-prefix mykey
# → mykey.pub and mykey.private

# Sign on copy
skopeo copy --sign-by-sigstore-private-key mykey.private \
  docker://docker.io/library/alpine:latest \
  docker://myregistry.example.org/alpine:latest

# Require a valid sigstore signature on pull (combined with a sigstoreSigned policy.json)
skopeo copy --require-signed … 
```

**GPG and standalone:**

```bash
# Sign a manifest out-of-band
skopeo standalone-sign manifest.json quay.io/myorg/app mykeyfingerprint --output app.sig
# Verify it
skopeo standalone-verify manifest.json quay.io/myorg/app mykeyfingerprint app.sig
```

Note: this cross-compiled static build uses `-tags containers_image_openpgp`, a pure-Go OpenPGP implementation, so GPG signing works without a system GPG/C library. Newer builds may use `containers_image_sequoia` instead (see source build section).

### 6. Compression and performance

For large images or slow cluster networks, these flags earn their keep:

- `--dest-compress-format zstd|gzip` and `--dest-compress-level N` — recompress layers on write. `zstd` is smaller and faster to decompress; use it when your destination and runtime support it.
- `--image-parallel-copies N` — copy N blobs concurrently (default is a sensible small number). Raise it on fat pipes; lower it if you are rate-limited or hammering a shared filesystem.
- `--retry-times N` — retry failed blob transfers, essential on flaky login-node networks.
- `--command-timeout DURATION` — hard cap on the whole operation (e.g. `--command-timeout 10m`).
- `--tmpdir DIR` — where intermediate blobs land; point it at `/scratch`, never `$HOME`.

```bash
skopeo copy --retry-times 5 --image-parallel-copies 6 \
  --dest-compress-format zstd --tmpdir /scratch/$USER/tmp \
  docker://docker.io/library/python:3.12 \
  oci-archive:/scratch/$USER/py312.tar
```

### 7. Building skopeo from source

```bash
git clone https://github.com/containers/skopeo
cd skopeo
make bin/skopeo BUILDTAGS='containers_image_openpgp exclude_graphdriver_btrfs'
# Cross-compile static for the cluster:
make bin/skopeo.linux.amd64 \
  GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
  BUILDTAGS='containers_image_openpgp exclude_graphdriver_btrfs'
```

**Build tags and what they cost you:**

| Tag | Effect |
|---|---|
| `containers_image_openpgp` | Pure-Go OpenPGP instead of linking the system GPG/C library → enables a static, cgo-free binary |
| `containers_image_sequoia` | Use the Sequoia-PGP backend (newer alternative to the above; may need cgo) |
| `exclude_graphdriver_btrfs` | Drop the btrfs storage driver (needs btrfs C headers otherwise) |
| `exclude_graphdriver_devicemapper` | Drop devicemapper driver similarly |

**What dropping cgo costs:** with `CGO_ENABLED=0` you get a gloriously portable static binary — but the `containers-storage:` transport cannot re-exec itself into a user namespace for rootless operation. On HPC this is a non-issue: you use `oci:` / `oci-archive:` for Apptainer and never touch local Podman storage. If you genuinely need rootless `containers-storage:`, you must build with cgo and the storage drivers, which reintroduces glibc coupling.

### 8. Scripting patterns

**Exit codes** are the backbone of robust scripts: **2 = image not found**, **1 = any other error**, **0 = success**.

```bash
# Idempotent "pull only if the tarball is missing or stale"
pull_if_needed() {
  local ref="$1" out="$2"
  if skopeo inspect "$ref" >/dev/null 2>&1; then
    skopeo copy --retry-times 3 --tmpdir /scratch/$USER/tmp "$ref" "oci-archive:$out"
  else
    rc=$?
    if [ "$rc" -eq 2 ]; then echo "NOT FOUND: $ref" >&2; else echo "ERROR ($rc): $ref" >&2; fi
    return "$rc"
  fi
}
```

**Go-template `--format`** pulls exactly the field you need, no `jq` required:

```bash
skopeo inspect --format '{{.Digest}} {{.Architecture}} {{len .Layers}}' \
  docker://docker.io/library/alpine:latest
```

```text
sha256:beef… amd64 1
```

**JSON + `jq`** for anything structured (tag lists, manifest indexes, labels):

```bash
skopeo inspect docker://docker.io/library/rockylinux:8.10 | jq -r '.Labels["org.opencontainers.image.version"] // "unlabeled"'
```

**Retry wrapper** for flaky networks beyond skopeo's own `--retry-times`:

```bash
for i in 1 2 3; do
  skopeo copy "$SRC" "$DST" && break
  echo "attempt $i failed; sleeping" >&2; sleep $((i*10))
done
```

**In a Slurm prep step on a login node** — see [[skopeo-apptainer-hpc-workflow|the HPC workflow guide]] for the full pattern of pulling on a login node and building/running on compute nodes, including a reusable `pull-to-sif.sh`.

## Practical Examples

**Delete a stale tag from your private mirror:**

```bash
skopeo delete docker://myregistry.example.org/mirror/app:old-rc
```

**Copy from a `docker save` tarball someone emailed you into something Apptainer can build:**

```bash
skopeo copy docker-archive:received.tar oci-archive:ready.tar
```

**Audit every image in a YAML mirror for architecture before syncing:**

```bash
for repo in rockylinux python alpine; do
  printf '%s: ' "$repo"
  skopeo inspect --raw "docker://docker.io/library/$repo:latest" \
    | jq -rc '[.manifests[].platform.architecture] // ["single-arch"]'
done
```

**Compare two digests to prove an image did not change between runs:**

```bash
skopeo inspect --format '{{.Digest}}' docker://docker.io/library/rockylinux:8.10 > now.digest
diff <(cat baseline.digest) now.digest && echo "unchanged" || echo "IMAGE MOVED"
```

## Hands-On Exercises

1. **Trace the SystemContext.** Run a `skopeo copy` with `--src-tls-verify=false` against an insecure internal registry and `--dest-compress-format zstd` to an `oci-archive:`. Explain in one sentence which `SystemContext` each flag populated.

2. **Full multi-arch mirror.** Pick a known multi-arch image, confirm its platforms with `inspect --raw | jq`, then `copy --multi-arch all` it into an `oci:` layout. Verify the resulting index still lists every platform.

3. **Reproducibility proof.** Pin an image by digest, copy it with `--digestfile`, wait a day, repeat, and `diff` the two digest files. They must match.

4. **YAML sync with filters.** Write an `images.yaml` using `images-by-tag-regex` to grab only `8.10` and `9.3` of rockylinux, add `--dry-run`, and read the plan. Then drop `--dry-run` and mirror to `dir:` under `/scratch`.

5. **Policy tightening.** Write a `policy.json` that rejects by default, accepts `docker.io/library` unsigned, and requires a sigstore signature from one namespace you control. Generate a key, sign an image into your mirror, and prove that an unsigned pull from that namespace now fails.

6. **Build it yourself.** Clone the source and produce a static `linux/amd64` binary with `containers_image_openpgp`. Confirm `ldd bin/skopeo.linux.amd64` reports "not a dynamic executable."

## Troubleshooting

**`--multi-arch all` copies only one image.** Your destination transport may not support indexes. `dir:` and `oci:` do; a plain `oci-archive:` with a single `:tag` selector resolves to one platform. Use `oci:` layout for full indexes.

**`copy` changes the digest even with the same source.** Recompression altered the layers. Add `--preserve-digests`, or avoid `--dest-compress-format` when the digest must be stable.

**`sync` aborts partway through a large YAML.** Add `--keep-going` so one bad tag does not kill the run, and `--dry-run` first to catch typos in repo names.

**Credentials ignored despite `skopeo login`.** The auth file lookup found a different file first. Set `REGISTRY_AUTH_FILE` explicitly, or pass `--authfile`. On login nodes `$XDG_RUNTIME_DIR` is a common culprit.

**`containers-storage:` fails to re-exec in a user namespace.** Expected in the no-cgo static build. Use `oci:`/`oci-archive:`. Only a cgo build with storage drivers supports rootless `containers-storage:`.

**Signature verification fails on an image you trust.** Your `policy.json` scope requires a signature that is not present, or the lookaside/`registries.d` config points at the wrong signature store. Re-check the scope path (it is a longest-prefix match) and the `registries.d` lookaside URL.

**Slow or stalling copies on the login node.** Lower `--image-parallel-copies`, raise `--retry-times`, set `--command-timeout`, and move `--tmpdir` to `/scratch`. Shared login-node networks and home filesystems punish concurrency.

## References

- Skopeo project & README: https://github.com/containers/skopeo
- Man pages (authoritative flag references, `docs/*.1.md`): https://github.com/containers/skopeo/tree/main/docs
- `skopeo sync` man page: https://github.com/containers/skopeo/blob/main/docs/skopeo-sync.1.md
- `go.podman.io/image` (the engine library): https://github.com/containers/image
- `policy.json` format: https://github.com/containers/image/blob/main/docs/containers-policy.json.5.md
- `registries.conf` format: https://github.com/containers/image/blob/main/docs/containers-registries.conf.5.md
- sigstore / cosign signing concepts: https://docs.sigstore.dev/
- Apptainer docs (the runtime target): https://apptainer.org/docs/

## Related Tutorials

- [[skopeo-beginner-guide|Skopeo Beginner's Guide]] — install, transports, inspect, and the first registry → `oci-archive:` → `.sif` pass
- [[skopeo-apptainer-hpc-workflow|Skopeo + Apptainer HPC Workflow]] — the end-to-end job pipeline and reusable `pull-to-sif.sh`
- [[isaaclab-metagrasp-apptainer-hpc-deep-dive|IsaacLab + Apptainer HPC Deep Dive]] — production Apptainer/Slurm/GPU workflows that consume skopeo's output
- [[docker-bake-deep-dive|Docker Bake Deep Dive]] — multi-platform build internals; the build-side counterpart to skopeo's transfer-side multi-arch control
- [[apple-container-deep-dive|Apple Container Deep Dive]] — authoring `amd64` images on an Apple Silicon Mac for an x86 cluster
- [[docker-test-container-deep-dive|Docker Test Container Deep Dive]] — advanced image and Dockerfile patterns behind the manifests skopeo moves
- [[uv-deep-dive|uv Deep Dive]] — the same pin-your-inputs reproducibility discipline for Python environments
- [[pixi-deep-dive|Pixi Deep Dive]] — reproducible environments matching cluster glibc, paired with pinned base images
- [[flux-advanced-features|Flux Advanced Features]] — scheduling containerized workloads where mirrored images are pre-staged
- [[hyperqueue-deep-dive|HyperQueue Deep Dive]] — high-throughput dispatch of containerized tasks
- [[ssh-config-deep-dive|SSH Config Deep Dive]] — moving binaries and tarballs to login nodes efficiently
- [[linux-permissions-deep-dive|Linux Permissions Deep Dive]] — the ownership and capability model underneath rootless image handling

---

## Summary

Skopeo is a thin cobra CLI over `go.podman.io/image`; once you see that, the flags stop being arbitrary. A `copy` has a source and a destination `SystemContext`, which is why flags pair up as `--src-*` / `--dest-*`. Multi-arch work hinges on two things: `--override-arch/os/variant` to pick the platform you read, and `--multi-arch system|all|index-only|os/arch` to control what you copy — with `inspect --raw | jq` as the ground truth for which platforms an image actually ships. Reproducibility means pinning by `@sha256:` digest and capturing results with `--digestfile` and `--preserve-digests`. `skopeo sync` scales all of this to fleets via repo mode or a YAML manifest with regex/semver selectors, `--scoped`, `--dry-run`, and `--keep-going`. Four config files govern behavior — `policy.json` (required), `registries.conf`, `registries.d/`, and `auth.json` with its ordered lookup. Signing spans sigstore and GPG/standalone. Performance comes from compression format, parallel copies, retries, timeouts, and a `/scratch`-based `--tmpdir`. The static, no-cgo build you run on HPC trades rootless `containers-storage:` for a portable binary — a trade that costs nothing when Apptainer is your target.

**Next step:** codify your team's base images into a single `images.yaml`, mirror them to `/scratch` with `skopeo sync --dry-run` then for real, and wire the pinned-by-digest pull into the `pull-to-sif.sh` script in [[skopeo-apptainer-hpc-workflow|the HPC workflow guide]].
