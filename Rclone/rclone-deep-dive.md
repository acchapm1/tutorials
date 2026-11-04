---
title: "rclone — Deep-Dive Reference for the Linux/HPC Sysadmin"
date: 2026-08-21
difficulty: advanced
tags: [rclone, crypt, bisync, union, serve, rc-api, s3, smb, storage, hpc, sysadmin]
---

## Overview

This is the reference half of the rclone pair. The [[rclone-beginner-guide|beginner guide]] takes you from install to a working SMB + S3 lab with persistence. This document covers the parts you revisit: the `crypt` backend and its irreversible failure mode, `bisync` two-way sync, `union`/`combine` for presenting NAS + S3 as one tree, the `serve` family, the `rc` remote-control API, three worked failure injections, an `rsync` → rclone translation table with a "not equivalent because" column, a flags cheat sheet grouped by purpose, and a closing verdict that takes a position on where rclone belongs.

Written and verified against **rclone v1.75.0** (released 2026-07-31). Version-gated behavior is flagged. Anything not confirmed against current docs is prefixed `> Unverified:` — this applies especially to exact error-message text and provider-specific S3 settings.

The audience assumption is unchanged: a Linux/HPC sysadmin fluent in shell, SSH, systemd, launchd, TLS, and `rsync`, learning rclone specifically and the ways object storage breaks POSIX intuition.

> **Warning — destructive commands ahead.** This document uses `sync`, `bisync`, `move`, and `crypt`. `bisync --resync` overwrites one side to establish a baseline, and losing a `crypt` password makes data permanently unrecoverable. Run against the disposable MinIO lab from the beginner guide, and read `--dry-run` output before committing.

---

## Prerequisites

- The working lab from the [[rclone-beginner-guide|beginner guide]]: a MinIO `lab:` remote and an SMB `nasm:`/`nas:` remote.
- Comfort with the five verbs, the `remote:path` model, the config file, obscured-vs-encrypted, and flag/env/config precedence — all covered there.
- systemd user units and launchd plists (for the `serve` and unattended sections).
- Understanding that the `smb` backend provides no hashes; see the capability discussion in [[rclone-beginner-guide|the beginner guide]] and [rclone.org/overview](https://rclone.org/overview/).

---

## Key Concepts

### crypt: encryption as a wrapping backend

`crypt` ([rclone.org/crypt](https://rclone.org/crypt/)) wraps an existing remote and encrypts data written through it, decrypting on read. The underlying store only ever sees ciphertext. It uses two passwords: a data password and an optional salt/"password2". Filename encryption has modes with real tradeoffs:

| Filename mode | Structure visible? | Path-length cost | Use when |
|---|---|---|---|
| `standard` | No | Higher (encrypted names are longer) | Default; hides names |
| `obfuscate` | Partially | Low | Light obscurity, keeps lengths sane |
| `off` | Yes (names in clear) | None | You only need file *contents* hidden |

> **Warning — irreversible.** There is no recovery, backdoor, or reset for a lost crypt password. Losing it means the data is gone as surely as if you had shredded it. Escrow the password in a real secrets manager before you write anything you care about.

### bisync: two-way synchronization

`bisync` ([rclone.org/bisync](https://rclone.org/bisync/)) keeps two remotes mutually in sync, propagating changes in both directions — unlike `sync`, which is strictly one-way. It maintains state between runs to detect what changed on each side. It is less battle-hardened than `sync`; treat it accordingly.

### union and combine: many remotes, one tree

`union` merges several upstream remotes into one namespace governed by policies. `combine` maps remotes to fixed subdirectories. Use `union` when you want a pooled view with placement rules; `combine` when you want a predictable, static layout.

### serve: expose a remote over a protocol

`rclone serve` turns any remote into a server speaking `http`, `webdav`, `sftp`, `nfs`, `s3`, or `dlna` ([rclone.org/commands/rclone_serve](https://rclone.org/commands/rclone_serve/)). This is how you let a machine that cannot run rclone consume an rclone remote.

### rc: the remote-control API

`rclone rcd` starts an HTTP API you drive with `curl` or a web GUI, exposing live stats and job control ([rclone.org/rc](https://rclone.org/rc/)). This is the automation and monitoring hook.

---

## Step-by-Step Instructions

### 1. Layer crypt over S3

```bash
# Create a crypt remote wrapping a path inside the MinIO S3 remote
rclone config create secure crypt \
  remote lab:demo-encrypted \
  filename_encryption standard \
  directory_name_encryption true \
  password "$(rclone obscure 'data-password')" \
  password2 "$(rclone obscure 'salt-password')"
```

Now write through `secure:` and inspect the underlying store to prove the ciphertext:

```bash
echo "top secret" > /tmp/secret.txt
rclone copy /tmp/secret.txt secure:
rclone ls secure:          # you see: secret.txt (decrypted view)
rclone ls lab:demo-encrypted   # you see: an encrypted blob name, unreadable
```

Verify and decode:

```bash
rclone cryptcheck /tmp secure:         # hash-verify plaintext against encrypted store
rclone cryptdecode secure: <enc-name>  # map an encrypted filename back to plaintext
```

`--crypt-server-side-across-configs` allows server-side operations between two crypt remotes sharing the same underlying provider and keys — useful for moving encrypted data without a decrypt/re-encrypt round trip through your host.

### 2. Two-way sync with bisync

The first run **must** be `--resync`, which establishes the baseline by making one side authoritative. Skipping it is the most common bisync mistake:

```bash
# First run only — establishes the sync baseline (overwrites to match)
rclone bisync nasm: lab:demo --resync --dry-run
rclone bisync nasm: lab:demo --resync

# Subsequent runs — propagate changes both directions
rclone bisync nasm: lab:demo --max-delete 25 --dry-run
rclone bisync nasm: lab:demo --max-delete 25
```

Conflict handling: when both sides changed the same file since the last run, bisync flags a conflict and (by default) preserves both by renaming, rather than silently picking a winner. `--max-delete` is your safety valve against a run that would delete an unexpected number of files (a sign the state got confused). Documented limitations exist around case-insensitive filesystems, moved directories, and interrupted runs — read the maturity notes at [rclone.org/bisync](https://rclone.org/bisync/) before trusting it with a primary copy. Honest framing: `sync` is production-grade; `bisync` is good but you should keep `--dry-run` and `--backup-dir` habits tighter with it.

### 3. Present NAS + S3 as one tree with union

```bash
rclone config create pool union \
  upstreams "nasm: lab:demo" \
  action_policy epall \
  create_policy epmfs \
  search_policy ff
```

The policy system has three axes: `action` (where modifications land), `create` (where new files go), and `search` (how existing files are found). For a first sane setup, `create_policy epmfs` ("existing path, most free space") spreads new writes toward the emptier upstream while keeping related files together. Verify:

```bash
rclone lsd pool:
rclone copy /tmp/seed pool:   # lands per create_policy
```

`combine` is the simpler cousin when you want fixed placement:

```bash
rclone config create both combine \
  upstreams "nas=nasm: cloud=lab:demo"
rclone lsd both:      # shows nas/ and cloud/ subdirectories
```

### 4. serve — expose the S3 remote over WebDAV

`serve` targets:

| Target | For |
|---|---|
| `rclone serve http` | Read-only (or read-write) HTTP access to a remote |
| `rclone serve webdav` | WebDAV clients, incl. macOS Finder and Windows Explorer |
| `rclone serve sftp` | SFTP clients against any backend |
| `rclone serve nfs` | NFS mounts (also the engine behind `nfsmount`) |
| `rclone serve s3` | Present any remote as an S3 endpoint |
| `rclone serve dlna` | Media players on the LAN |

Worked example — serve the MinIO remote over WebDAV so the NAS or another host can consume it:

```bash
rclone serve webdav lab:demo \
  --addr 127.0.0.1:8080 \
  --user webdavuser \
  --pass "$(rclone obscure 'webdavpass')"
```

```bash
# From another machine on the LAN, mount it (macOS example)
mount_webdav http://HOST:8080/ /Volumes/rclone-dav
```

> **Warning.** Binding `serve` to `0.0.0.0` without `--user`/`--pass` (or `--cert`/`--key` for TLS) publishes the remote to the whole network unauthenticated. Bind to `127.0.0.1` for local-only, and add auth before exposing beyond localhost.

### 5. rc — live stats and automation

```bash
# Start the daemon with the web GUI and an auth pair
rclone rcd --rc-web-gui \
  --rc-addr 127.0.0.1:5572 \
  --rc-user admin --rc-pass "$(rclone obscure 'rcpass')"
```

Pull live transfer stats and job status via `curl`:

```bash
curl -s -u admin:rcpass -X POST http://127.0.0.1:5572/core/stats | jq
curl -s -u admin:rcpass -X POST http://127.0.0.1:5572/job/list  | jq
```

```json
{
  "bytes": 10485760,
  "checks": 12,
  "transfers": 3,
  "elapsedTime": 4.2,
  "speed": 2621440
}
```

Frame it as the monitoring hook: a systemd timer kicks a `sync`, and a Prometheus exporter or a small poller hits `core/stats` for live throughput. Endpoints of interest: `core/stats`, `core/bwlimit` (change bandwidth caps at runtime), `job/status`, `job/stop`.

---

## Practical Examples

### Three failure injections

These are the failures you will actually hit. Each gives the command, the (approximate) error, and the diagnostic path.

**Injection 1 — `check` against the hashless SMB remote.**

```bash
rclone check nas:media/photos lab:demo
```

> Unverified (approximate error text):
```text
NOTICE: hash unsupported on source:remote - ignoring hashes for checking
... : file not in destination (or size differs)
```

Diagnosis: the `smb` backend provides no checksums, so `check` cannot hash-compare and silently degrades to size/modtime. This is a real gap for backup verification. Fix: address the share via an OS mount + `local`/`alias` remote (Path B in the [[rclone-beginner-guide|beginner guide]]), where rclone reads content to compute hashes, then `check` does a true comparison. Confirm with `rclone check /mnt/nas-media lab:demo` and observe it now hashes.

**Injection 2 — S3 without `force_path_style` against MinIO.**

```bash
rclone lsd :s3,provider=Minio,endpoint=http://localhost:9000,access_key_id=admin,secret_access_key=miniosecret:
```

> Unverified (approximate error text):
```text
Failed to create file system: didn't find section in config file
... or: RequestError: send request failed ... no such host: demo.localhost
```

Diagnosis: rclone defaulted to virtual-host addressing (`bucket.localhost`), which does not resolve for a self-hosted store. The tell is a DNS/host error mentioning the bucket name as a hostname. Fix: add `force_path_style=true` (config) or `--s3-force-path-style` (flag). Re-run and it lists.

**Injection 3 — `sync` in the wrong direction, caught by `--dry-run`.**

```bash
# Intended: push local → cloud. Typed backwards: cloud → local (empty local wipes cloud... no —
# this makes LOCAL match an empty CLOUD? read carefully). Demonstrate with dry-run:
rclone sync lab:demo /tmp/emptydir --dry-run
```

> Unverified (approximate dry-run output):
```text
NOTICE: readme.txt: Skipped delete as --dry-run is set (size 13)
NOTICE: report.csv: Skipped delete as --dry-run is set (size 4096)
```

Diagnosis: the dry-run plan shows deletions you did not intend — the destination (`/tmp/emptydir`) was about to be made to match, or the source/dest were swapped. Because it was a dry run, nothing happened. Recovery path *had it run for real*: if you had added `--backup-dir /tmp/rclone-backup/$(date +%F)`, every "deleted" file would instead be sitting in the backup dir, and you would restore with a reverse `rclone move`. The lesson: `--dry-run` first, `--backup-dir` always on `sync`.

### rsync → rclone translation table

| rsync invocation | rclone equivalent | Not equivalent because… |
|---|---|---|
| `rsync -av src/ dst/` | `rclone copy src remote:dst` | No `-a`: rclone preserves no ownership, permissions, or hardlinks |
| `rsync -av --delete src/ dst/` | `rclone sync src remote:dst` | rclone `sync` deletes-on-dest by default; there is no separate `--delete` |
| `rsync -avz src/ dst/` | `rclone copy src remote:dst` | No stream compression flag; use the `compress` backend instead of `-z` |
| `rsync -n ...` | `rclone ... --dry-run` | Equivalent in intent |
| `rsync --partial --progress` | `rclone copy ... --progress` | rclone resumes at file granularity, not partial-file byte offsets on most backends |
| `rsync -e ssh src/ host:/dst` | `rclone copy src sftp-remote:dst` | Configure an `sftp` remote; ownership/perms still not preserved |
| `rsync --checksum` | `rclone ... --checksum` | Only works if **both** sides expose hashes; unavailable on `smb` |
| `rsync -aH` (hardlinks) | (no equivalent) | rclone has no hardlink preservation on any backend |

### Flags cheat sheet, grouped by purpose

```text
# Safety
--dry-run                 show the plan, change nothing
--interactive / -i        confirm each destructive action
--backup-dir DIR          move overwritten/deleted files aside instead of destroying
--max-delete N            abort if a sync would delete more than N files
--track-renames           detect renames instead of re-uploading (needs hashes)

# Performance
--transfers N             parallel file transfers (default 4)
--checkers N              parallel comparison workers (default 8)
--multi-thread-streams N  parallel streams for a single large file
--fast-list               one recursive listing (memory cost scales with object count)
--bwlimit 10M | timetable cap bandwidth, optionally on a schedule
--tpslimit N              cap transactions per second

# Filtering
--include / --exclude     first-match-wins, order matters
--filter-from FILE        rules from a file (same ordering semantics)
--files-from FILE         explicit list, skips directory traversal

# Logging / diagnostics
--progress / -P           live one-line stats
--log-level DEBUG         maximum verbosity
--log-file FILE           durable log
--dump headers            dump HTTP headers (protocol-level debugging)
--retries N / --low-level-retries N   whole-run and per-operation retry counts

# VFS / mount
--vfs-cache-mode off|minimal|writes|full
--vfs-cache-max-size SIZE ; --vfs-cache-max-age AGE
--dir-cache-time DUR ; --poll-interval DUR ; --allow-other
```

---

## Hands-On Exercises

1. **Crypt round trip.** Wrap `lab:demo-encrypted` with a `crypt` remote, write a file, and prove via `rclone ls lab:demo-encrypted` that the underlying names/contents are ciphertext. Then `cryptdecode` a name back. Finally, escrow the password somewhere real before you forget it.
2. **bisync baseline and conflict.** Run `bisync --resync`, then modify the *same* file on both sides and run again. Observe the conflict handling. Add `--max-delete 5` and delete six files on one side to watch the safety valve trip.
3. **union placement.** Build a `union` of `nasm:` and `lab:demo` with `create_policy epmfs`. Copy files and use `rclone lsf` on each upstream to see where they landed. Change the policy and observe the difference.
4. **serve + consume.** `rclone serve webdav lab:demo` on localhost with auth, then mount it from the same machine as a second client. Confirm reads and writes propagate to MinIO. Then try binding `0.0.0.0` without auth and articulate why that is a mistake.
5. **rc monitoring.** Start `rclone rcd`, kick a long `copy` as a job, and poll `core/stats` with `curl` every few seconds to watch throughput. Bonus: change `--bwlimit` at runtime via `core/bwlimit`.

---

## Troubleshooting

Symptom → cause → command playbook:

| Symptom | Cause | Command / fix |
|---|---|---|
| Files re-transfer every run despite no changes | Modtime mismatch (backend rounds or lacks modtime) | `--checksum` if both sides hash; else `--size-only`; inspect with `--dump headers` |
| `--checksum` errors "hash not supported" | Hashless backend (SMB, some crypt configs) | Verify via local-mount path; check [rclone.org/overview](https://rclone.org/overview/) |
| SMB "directory not found" but share exists | Confusing share name with path | First path segment is the share; `rclone lsd remote:` to enumerate |
| S3 ops fail with host/DNS errors | Virtual-host addressing against self-hosted S3 | `force_path_style true` / `--s3-force-path-style` |
| `x509: certificate signed by unknown authority` | Self-signed TLS on MinIO/Ceph | Add the CA to the trust store, or `--ca-cert FILE`; avoid `--no-check-certificate` in production |
| Mount goes stale after NAS sleeps | Underlying connection dropped; VFS cache holds stale handles | Remount; raise `--dir-cache-time`/`--poll-interval` tolerances; prefer `copy`/`sync` for bulk work |
| `429 Too Many Requests` / throttling | Provider rate limits | `--tpslimit`, `--bwlimit`, raise `--low-level-retries`; back off `--transfers` |
| Job hangs with no output | Waiting on a wedged backend | `--log-level DEBUG`, `--contimeout`/`--timeout`; check `job/status` via rc |

Global debugging escalation: start with `--log-level DEBUG`, add `--dump headers` for protocol issues, and tune `--retries` (whole-run) and `--low-level-retries` (per-operation) for flaky endpoints.

---

## Related Tutorials

- [[rclone-beginner-guide|rclone Beginner's Guide]] — install, remote model, SMB two ways, MinIO lab, mounting, persistence
- [[restic-deep-dive|restic Deep Dive]] — restic chains through rclone (`serve restic --stdio`) to back up to an SMB NAS; internals, tuning, and append-only designs
- [[restic-beginner-guide|restic Beginner's Guide]] — encrypted, deduplicated snapshots over an rclone SMB remote
- [[ssh-config-deep-dive|SSH Config Deep Dive]] — host aliases and jump hosts for SFTP-family remotes and `serve` access
- [[linux-permissions-deep-dive|Linux Permissions Deep Dive]] — why rclone preserves no ownership/permissions on most backends
- [[chezmoi-deep-dive|Chezmoi Deep Dive]] — templating and secret handling for `rclone.conf` across machines
- [[docker-test-container-deep-dive|Docker Test Container Deep Dive]] — running MinIO and rclone in disposable containers
- [[apple-container-deep-dive|Apple container Deep Dive]] — OCI runtime context on Apple Silicon for the S3 lab
- [[apache-nifi-hpc-sysadmin-deep-dive|Apache NiFi HPC Sysadmin Deep Dive]] — a flow-based alternative when you need routing/transformation, not just transfer
- [[headscale-deep-dive|Headscale Deep Dive]] — mesh networking to reach remote storage/`serve` endpoints without port forwarding

---

## Summary

The deep-dive layer is where rclone earns its keep beyond "`rsync` for the cloud": `crypt` gives you client-side encryption on any backend (with an unforgiving password-loss failure mode), `bisync` handles two-way sync if you respect its `--resync` baseline and lesser maturity, `union`/`combine` present heterogeneous storage as one tree, `serve` exposes a remote to clients that cannot run rclone, and the `rc` API turns a transfer into something you can monitor and automate. The three failure injections — hashless SMB `check`, missing `force_path_style`, and a wrong-direction `sync` caught by `--dry-run` — are the ones you will actually meet.

### Closing verdict — where rclone belongs

Take a position: **rclone is the right default whenever a leg of the transfer touches object storage or a protocol `rsync` cannot speak, and the wrong tool whenever you need POSIX fidelity or filesystem-image behavior.**

Use rclone when moving data to or from S3/SMB/WebDAV and friends, when you want one command surface across many backends, when you need client-side encryption via `crypt`, or when a static binary that drops onto a login node without dependencies is worth more than metadata preservation. In this Linux/HPC context, that covers most cluster-to-cloud backup and staging.

Prefer `rsync` when both endpoints are POSIX filesystems and you need ownership, permissions, hardlinks, or partial-file delta transfer — `rsync -aH --partial` has no honest rclone equivalent, and pretending otherwise loses data semantics silently. Prefer a **native S3 CLI** (`aws s3`, `mc`) when you are scripting deep against one provider's quirks (multipart tuning, bucket policies, lifecycle rules, presigned URLs) — rclone's abstraction is a liability there, hiding the provider-specific controls you actually need.

Where rclone is the *wrong* tool: as a live filesystem for databases, build trees, or many-small-random-I/O workloads (mount latency and per-object round trips will hurt you — use `copy`/`sync` instead); as a permissions-preserving backup of a POSIX tree (it is not one); and as the automation layer against a single provider whose native CLI exposes controls rclone abstracts away. Reach for it deliberately, not reflexively, and it is the most versatile data-mover in the kit.

**Sources:** [rclone.org/crypt](https://rclone.org/crypt/), [rclone.org/bisync](https://rclone.org/bisync/), [rclone.org/commands/rclone_serve](https://rclone.org/commands/rclone_serve/), [rclone.org/rc](https://rclone.org/rc/), [rclone.org/s3](https://rclone.org/s3/), [rclone.org/overview](https://rclone.org/overview/), [rclone v1.75.0 release](https://github.com/rclone/rclone/releases).
