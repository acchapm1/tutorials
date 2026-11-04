---
title: "rclone — Beginner's Guide for the Linux/HPC Sysadmin"
date: 2026-08-21
difficulty: beginner
tags: [rclone, storage, s3, smb, sync, rsync, hpc, minio, sysadmin, backup]
---

## Overview

`rclone` is a single static Go binary that speaks roughly 70 storage protocols behind one command surface. You address everything with the same `remote:path` scheme, whether the target is a local disk, an SMB share, an S3 bucket, or a WebDAV server. If you already run `rsync` daily, treat rclone as "`rsync` for the whole zoo of object and network stores" — but read the *where the analogy breaks* notes carefully, because object storage violates POSIX assumptions your intuition depends on.

This guide targets a Linux/HPC systems administrator. It assumes you are fluent in shell, SSH, `rsync`, mount semantics, systemd, launchd, permissions, and TLS, and that you have never used rclone specifically. It runs two machines in parallel — an Apple Silicon MacBook (Homebrew) and an x86_64 systemd Linux desktop — with divergences called out inline. The hands-on lab uses only two storage families: a local SMB/CIFS NAS and S3-compatible object storage (a local [MinIO](https://min.io) container), so every destructive command runs against disposable data.

Written and verified against **rclone v1.75.0** (released 2026-07-31). Behavior that is version-gated is flagged. Commands whose exact output or provider-specific detail has not been confirmed against current docs are prefixed `> Unverified:`.

What you will learn: the remote model and config file, the five verbs that move data, the safety rails that stop `sync` from destroying data, installation on both machines, configuring an SMB remote two competing ways, standing up and driving an S3 remote, moving and filtering data, mounting, and making it all persistent under launchd and systemd.

The single-static-binary property matters for your world specifically: no runtime dependencies, drops into `~/bin`, works identically inside a scratch container or on a login node where you cannot install packages. See [[apple-container-beginner-guide|Apple container Beginner's Guide]] and [[docker-test-container-beginner-guide|Docker Test Container Guide]] for the container contexts where this pays off.

---

## Prerequisites

You should already be comfortable with:

- Shell, SSH, and `rsync` (see [[ssh-tutorial|SSH Tutorial]] and [[ssh-config-deep-dive|SSH Config Deep Dive]] if you want a refresher on the transport layer rclone rides over for some backends).
- Unix file ownership and permission bits — [[linux-permissions-beginner-guide|Linux Permissions Beginner Guide]] covers the `mount.cifs` `uid`/`gid`/`file_mode` mapping used below.
- systemd unit files (Linux) and launchd plists (macOS).
- Running a container locally with Docker or Podman.

What you need installed before starting the lab:

| Component | MacBook (arm64) | Linux desktop (x86_64) |
|---|---|---|
| rclone ≥ v1.75.0 | Homebrew or install script | package, install script, or binary drop-in |
| A container runtime for MinIO | Docker Desktop or Podman | Docker or Podman |
| Access to an SMB share | LAN NAS (Synology/TrueNAS/QNAP-class) | same share |
| FUSE (only for the mount section) | macFUSE (kext) | in-kernel FUSE |

> **Warning — destructive commands ahead.** This guide introduces `rclone sync`, which **deletes files on the destination** to make it match the source. Every first run of a `sync` in this guide uses `--dry-run`. Treat that as non-negotiable discipline, not decoration.

---

## Key Concepts

### What rclone actually is

One binary, ~70 backends, one addressing scheme. There is no daemon by default and no per-backend client to install. Because it is a static Go binary, `rclone` you copy to a login node runs without touching system libraries. Canonical docs: [rclone.org/docs](https://rclone.org/docs/).

### The remote model: `remote:path`

Every location is `name:path`, where `name` is a remote you defined in the config file and `path` is a path *within* that remote.

```bash
# A path inside a configured remote named "nas"
rclone ls nas:backups/2026

# The remote's root (note the trailing colon, no path)
rclone lsd nas:

# The local backend is implicit — a bare filesystem path is "local:"
rclone copy /data/project nas:project
```

You can also define a remote entirely on the command line with a **connection string**, bypassing the config file:

```bash
# :backend,option=value:path
rclone lsd :s3,provider=Minio,endpoint=http://localhost:9000,access_key_id=admin,secret_access_key=secret:
```

**Precedence** when the same setting is specified in multiple places (highest wins):

1. Command-line flag (`--s3-endpoint ...`)
2. Connection-string option (`:s3,endpoint=...:`)
3. Environment variable (`RCLONE_S3_ENDPOINT`, or the generic `RCLONE_CONFIG_<REMOTE>_<KEY>`)
4. Config file value

Environment variables follow the pattern `RCLONE_<FLAG>` for global flags (`RCLONE_TRANSFERS=8`) and `RCLONE_CONFIG_<REMOTE>_<KEY>` for a specific remote's settings.

### The config file

Find it — do not guess:

```bash
rclone config file
```

```text
Configuration file is stored at:
/home/you/.config/rclone/rclone.conf
```

On macOS the default is `~/.config/rclone/rclone.conf` as well (rclone does not use `~/Library`). It is an INI file, one `[section]` per remote.

Passwords in that file are **obscured**, not encrypted. Obscuring is reversible by anyone with the string — it exists only to keep shoulder-surfers and casual `cat` from reading a plaintext password, and to satisfy backends that expect an obscured value. Do not mistake it for security:

```bash
echo -n 'hunter2' | rclone obscure -
# prints the obscured token; rclone reverses it trivially at runtime
```

For actual at-rest protection, encrypt the whole config file with a password (`rclone config` → "Set configuration password", or `rclone config encryption set`). Once set, rclone prompts for it, or reads it from `RCLONE_CONFIG_PASS`, on every invocation. Worth it on shared or portable machines; a friction cost on a locked-down single-user workstation. This is separate from the `crypt` *backend*, which encrypts your data — covered in [[rclone-deep-dive|the deep-dive]].

### Backends vs. virtual (wrapping) backends

Real backends talk to storage. Virtual backends wrap another remote and transform it.

| Backend | Type | When you reach for it |
|---|---|---|
| `local` | real | Local disk, or an OS-mounted network share addressed as a path |
| `smb` | real | Talk SMB/CIFS directly, no OS mount ([rclone.org/smb](https://rclone.org/smb/)) |
| `s3` | real | Any S3-compatible store: AWS, MinIO, Ceph RGW, Wasabi ([rclone.org/s3](https://rclone.org/s3/)) |
| `crypt` | virtual | Transparently encrypt data on top of another remote |
| `alias` | virtual | Give a short name to a `remote:long/path` prefix |
| `union` | virtual | Merge several remotes into one directory tree |
| `combine` | virtual | Mount several remotes at fixed subdirectories of one tree |
| `chunker` | virtual | Split large files into size-bounded chunks on the wire/store |
| `compress` | virtual | Compress data on top of another remote |
| `hasher` | virtual | Add a hash cache in front of a backend that lacks native hashes |

### The five verbs that matter

| Verb | Deletes on dest? | Safe to interrupt? | Needs hashes? | Typical use |
|---|---|---|---|---|
| `copy` | No | Yes | No (uses size+modtime by default) | Additive backup, staging |
| `sync` | **Yes** | Yes (but a killed run may have already deleted) | No | Make dest identical to source |
| `move` | Removes source after transfer | Yes | No | Migrate, then reclaim source |
| `bisync` | Both sides, per change | Partially — needs a clean prior state | No | Two-way sync between endpoints |
| `check` | Never (read-only) | Yes | Ideally — falls back to size when absent | Verify two trees match |

Where the `rsync` analogy breaks: `rclone sync` is closest to `rsync --delete`, but there is **no `-a`**. rclone does not preserve ownership, permissions, hardlinks, or (on most object backends) any modtime semantics you would recognize. It syncs *file content and names*, not POSIX metadata. Do not reach for rclone expecting `rsync -a` fidelity; it is a data-mover, not a filesystem-image tool.

### Safety rails — learn these before anything destructive

- `--dry-run` — show what would happen, change nothing. Mandatory on any first `sync`.
- `--interactive` / `-i` — prompt before each destructive action.
- `--progress` / `-P` — live transfer stats on one refreshing line.
- `--log-level INFO|DEBUG` and `--log-file` — durable record of what ran.
- `--backup-dir remote:path` — instead of deleting/overwriting, move the old version aside. This is your undo button.
- `--max-delete N` — abort a `sync` if it would delete more than N files. A blast-radius limiter.

`sync` is the one command that destroys data when pointed the wrong way. The direction is `rclone sync SOURCE DEST` — DEST is the one that gets modified to match SOURCE. Read it aloud before you run it.

---

## Step-by-Step Instructions

### 1. Install rclone

**macOS (arm64).** Two paths, with a consequence:

```bash
# Homebrew — integrates with brew upgrade, but 'rclone selfupdate' will refuse
brew install rclone

# Official script — installs to /usr/local/bin, and 'rclone selfupdate' works
curl https://rclone.org/install.sh | sudo bash
```

`rclone selfupdate` only works on installs it owns (the script/binary path), not on Homebrew-managed binaries — Homebrew should own its own updates. Pick one lane and stay in it.

**Linux (x86_64).** Three paths:

```bash
# Distro package — convenient, but frequently several minor versions behind
sudo apt install rclone        # or: sudo dnf install rclone

# Official script — current version, installs to /usr/bin
curl https://rclone.org/install.sh | sudo bash

# Plain binary drop-in — no root, ideal for login nodes and ~/bin
curl -O https://downloads.rclone.org/rclone-current-linux-amd64.zip
unzip rclone-current-linux-amd64.zip && install -m 0755 rclone-*/rclone ~/bin/rclone
```

Distro lag matters because **backend availability is version-gated**. The `smb` backend, for example, only exists from **v1.60**. Confirm your version and that a backend is compiled in:

```bash
rclone version
```

```text
rclone v1.75.0
- os/version: ubuntu 24.04 (64 bit)
- os/kernel: 6.8.0-40-generic (x86_64)
- go/version: go1.24.x
```

```bash
# Is the smb backend present in this build?
rclone help backends | grep -i smb
```

```text
smb              SMB / CIFS
```

**Shell completion:**

```bash
# zsh (macOS default shell)
rclone completion zsh > "${fpath[1]}/_rclone"   # then restart the shell

# bash (typical on the Linux desktop)
rclone completion bash | sudo tee /etc/bash_completion.d/rclone > /dev/null
```

### 2. Configure the SMB NAS — two competing approaches

This is the section most often done badly. Both approaches work; choose deliberately.

#### Path A — the native `smb:` backend

Run the interactive config and pick `smb`:

```bash
rclone config
# n) New remote  → name: nas
# Storage: smb
```

The settings that matter:

| Field | Value / note |
|---|---|
| `host` | NAS hostname or IP |
| `user` | SMB username (use `guest` for anonymous — see below) |
| `port` | `445` |
| `pass` | Must be **obscured**; `rclone config` obscures it for you, or supply `rclone obscure` output |
| `domain` | Defaults to `WORKGROUP` |
| `spn` | Service principal name — only for Kerberos/domain-joined setups |

Non-obvious rules:

- The **first path segment is the share name**. `nas:media/movies` means share `media`, path `movies`.
- Enumerate shares when you do not know them:

```bash
rclone lsd nas:
```

```text
          -1 2026-08-01 12:00:00        -1 media
          -1 2026-08-01 12:00:00        -1 backups
```

- Anonymous access is **not** "no user". Use the `guest` user with an empty password.
- Domain-joined environments: `use_kerberos` and `kerberos_ccache` exist; that is a pointer, not a walkthrough.

Obscure the password explicitly if you are editing config by hand:

```bash
echo -n 'SmbPassw0rd' | rclone obscure -
```

#### Path B — let the OS mount it, address it as `local`/`alias`

**macOS:** mount via Finder or `mount_smbfs`; the share appears under `/Volumes`.

```bash
mkdir -p /Volumes/nas-media   # Finder usually handles the mount point itself
mount_smbfs //you@nas/media /Volumes/nas-media
```

**Linux:** `mount.cifs` with a credentials file and explicit ownership mapping (this is why [[linux-permissions-beginner-guide|Linux permissions]] matters — the server has no concept of your local UIDs):

```bash
# /etc/cifs-creds  (chmod 600)
# username=you
# password=SmbPassw0rd

sudo mount -t cifs //nas/media /mnt/nas-media \
  -o credentials=/etc/cifs-creds,uid=$(id -u),gid=$(id -g),file_mode=0644,dir_mode=0755
```

Then point an `alias` remote at the mount so your rclone commands are OS-independent:

```bash
rclone config create nasm alias remote /mnt/nas-media   # Linux
# rclone config create nasm alias remote /Volumes/nas-media   # macOS
rclone lsd nasm:
```

#### Choosing between them

| Consideration | Path A (`smb:` backend) | Path B (OS mount + `local`/`alias`) |
|---|---|---|
| Hashes for verification | **No** — SMB backend provides no checksums | **Yes** — local backend reads content to hash |
| `rclone check` fidelity | Size/modtime only | Full hash comparison |
| `--checksum` flag | Unavailable | Available |
| `cryptcheck` | Limited | Full |
| Dependency on an OS mount | None | Yes — a wedged mount breaks everything |
| Ownership/permission control (Linux) | None | Yes, via `mount.cifs` `uid`/`gid`/`file_mode` |
| macOS noise | Minimal | `.DS_Store` / resource-fork files need filtering |

> Note on modtime: the `smb` backend's key documented limitation is the **absence of hashes**. Verify current modtime/hash capability for your version at [rclone.org/overview](https://rclone.org/overview/) before relying on it for backup verification.

**Recommendation:** if this SMB share is a **backup target you need to verify**, use **Path B** — you cannot trust a backup you can only compare by size and modtime, and hash verification requires the local backend reading file content. If it is a convenience copy or a source you only read from, **Path A** is simpler and removes the wedged-mount failure mode. For the HPC backup use case that motivates most of this guide, Path B wins.

### 3. Stand up a self-contained S3 lab with MinIO

Run MinIO locally so every destructive S3 command is safe. Docker or Podman — Podman works fine and is often the Linux desktop default:

```bash
docker run -d --name minio -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=admin -e MINIO_ROOT_PASSWORD=miniosecret \
  quay.io/minio/minio server /data --console-address ":9001"
# podman run -d ... (identical flags)
```

Console: `http://localhost:9001` (user `admin`, password `miniosecret`). API endpoint: `http://localhost:9000`.

Configure the `s3` remote against it:

```bash
rclone config create lab s3 \
  provider Minio \
  endpoint http://localhost:9000 \
  access_key_id admin \
  secret_access_key miniosecret \
  region us-east-1 \
  force_path_style true
```

Why `force_path_style` is a top-three cause of confusing S3 failures: AWS uses **virtual-host** addressing (`https://bucket.s3.amazonaws.com`), while self-hosted stores usually only serve **path-style** (`http://localhost:9000/bucket`). If rclone tries virtual-host against MinIO, the bucket name becomes a hostname component that does not resolve, and you get DNS or TLS errors that look nothing like "wrong addressing mode". Setting `force_path_style true` fixes it. See failure injection #2 in [[rclone-deep-dive|the deep-dive]].

Provider deltas (verify endpoints against your deployment):

| Provider | `provider` value | Endpoint form | Quirks |
|---|---|---|---|
| MinIO | `Minio` | `http://host:9000` | Path-style; set `force_path_style true` |
| Ceph RGW | `Ceph` | Your RGW gateway URL | Path-style common; check tenant/user `:` in access keys |
| Wasabi | `Wasabi` | `https://s3.<region>.wasabisys.com` | Region-specific endpoints; no request charges but honor minimum-retention |

> Unverified: exact current Ceph RGW and Wasabi endpoint strings vary by deployment and region — confirm against [rclone.org/s3](https://rclone.org/s3/) and your provider before production use.

Make a bucket and inspect the store:

```bash
rclone mkdir lab:demo
rclone about lab:            # capacity/usage if the provider reports it
rclone lsd lab:              # list buckets
rclone tree lab:demo         # tree view
```

Listing commands, and which are scriptable:

```bash
rclone ls   lab:demo    # size + path, human-oriented — NOT for scripting
rclone lsl  lab:demo    # adds modtime
rclone lsf  lab:demo    # bare names, one per line — scriptable
rclone lsjson lab:demo  # structured JSON — scriptable
rclone size lab:demo    # total count + bytes
rclone ncdu lab:demo    # interactive disk-usage browser
```

Use `lsf` and `lsjson` when a script consumes the output; `ls` is for humans and its columns are not a stable interface.

### 4. Move data

Copy NAS → S3, dry-run first, then for real:

```bash
rclone copy nasm: lab:demo --dry-run          # nothing changes; read the plan
rclone copy nasm: lab:demo --progress         # do it
```

Sync the reverse direction with an undo net via `--backup-dir`:

```bash
# WARNING: sync makes DEST match SOURCE and deletes extras on DEST.
rclone sync lab:demo nasm: --dry-run
rclone sync lab:demo nasm: --backup-dir nasm-archive:$(date +%F) --progress
```

Anything `sync` would have deleted or overwritten on the destination is moved into the backup-dir instead of vanishing. That is the difference between "I synced the wrong way" being a five-minute recovery versus a restore-from-tape incident.

Verify — and see the SMB limitation in action:

```bash
rclone check lab:demo nasm:
```

Against the hashless SMB Path A remote, `check` cannot compare content and will tell you so, falling back to size (and modtime where available). Against Path B (local mount) it does a real hash comparison. This is the concrete reason the recommendation in step 2 favors Path B for backups.

Filtering — order matters, first match wins:

```bash
rclone copy nasm: lab:demo \
  --filter-from ~/rclone-filters.txt --progress
```

```text
# ~/rclone-filters.txt  — rules are evaluated top to bottom, first match wins
- .DS_Store
- ._*
- @eaDir/**
- .Trash*/**
+ **
```

Related flags: `--include`/`--exclude` (same ordering rules), `--files-from` (an explicit list, bypasses directory traversal). Full semantics: [rclone.org/filtering](https://rclone.org/filtering/).

Performance flags, and what each actually does:

| Flag | Effect | Raise it when |
|---|---|---|
| `--transfers N` | Parallel file transfers (default 4) | Many medium/large files, bandwidth to spare |
| `--checkers N` | Parallel existence/hash checks (default 8) | Huge trees, comparison is the bottleneck |
| `--multi-thread-streams N` | Split one large file into parallel streams | A few very large files |
| `--fast-list` | One recursive listing instead of per-directory | Big buckets — costs memory proportional to object count |
| `--bwlimit 10M` or `--bwlimit "08:00,1M 22:00,off"` | Cap bandwidth, optionally on a timetable | Shared links, business-hours courtesy |
| `--tpslimit N` | Cap transactions/sec | Rate-limited or fragile endpoints |

Server-side copy avoids routing bytes through your machine:

```bash
rclone copy lab:demo lab:demo-copy --progress   # S3→S3 within MinIO: server-side
```

It works only when source and destination are the *same backend/provider*. `lab:` (S3) → `nasm:` (SMB) cannot be server-side — the two systems share no copy protocol, so bytes must transit your host.

### 5. Mount a remote as a filesystem

**macOS:** `rclone mount` needs **macFUSE**, a third-party kernel extension requiring a reboot and Recovery-mode security approval — a genuine barrier on managed or Apple Silicon machines. The no-kext alternative is `nfsmount`, where rclone serves NFS on localhost and mounts that:

```bash
rclone nfsmount lab:demo ~/mnt/demo --vfs-cache-mode writes
```

**Linux:** FUSE is in-kernel. For other users to see the mount, enable `user_allow_other` in `/etc/fuse.conf` and pass `--allow-other`:

```bash
rclone mount lab:demo ~/mnt/demo --vfs-cache-mode writes --allow-other
```

VFS cache mode decides whether the mount is actually usable:

| `--vfs-cache-mode` | Reads | Writes | Random writes | Notes |
|---|---|---|---|---|
| `off` | Streamed | Sequential only | No | Lowest overhead; many apps break |
| `minimal` | Streamed | Sequential only | No | Slight metadata caching |
| `writes` | Streamed | Cached then uploaded | Yes | Sane default for general use |
| `full` | Cached on read | Cached | Yes | Best app compatibility; most disk use |

Companion flags: `--vfs-cache-max-size`, `--vfs-cache-max-age`, `--dir-cache-time`, `--poll-interval`. Reference: [rclone.org/commands/rclone_mount](https://rclone.org/commands/rclone_mount/).

What a mount is **not** good for: databases, build trees, or anything doing many small random I/Os — latency and the object-storage round trips will crush you. Heuristic: if the workload is bulk data movement, use `copy`/`sync`, not a mount.

### 6. Make it persistent

**macOS — launchd** (a scheduled sync). Note the `PATH` problem: launchd runs with a minimal `PATH`, so reference `rclone` by absolute path.

```xml
<!-- ~/Library/LaunchAgents/com.you.rclone-sync.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.you.rclone-sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/rclone</string>
    <string>sync</string>
    <string>nasm:</string>
    <string>lab:demo</string>
    <string>--backup-dir</string><string>lab:archive</string>
    <string>--log-file</string><string>/tmp/rclone-sync.log</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>2</integer><key>Minute</key><integer>0</integer></dict>
</dict>
</plist>
```

```bash
launchctl load  ~/Library/LaunchAgents/com.you.rclone-sync.plist
launchctl list | grep rclone
tail -f /tmp/rclone-sync.log
```

**Linux — systemd user timer** (scheduled sync):

```ini
# ~/.config/systemd/user/rclone-sync.service
[Unit]
Description=rclone nightly sync

[Service]
Type=oneshot
ExecStart=%h/bin/rclone sync nasm: lab:demo --backup-dir lab:archive
```

```ini
# ~/.config/systemd/user/rclone-sync.timer
[Unit]
Description=Run rclone sync nightly

[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
systemctl --user enable --now rclone-sync.timer
systemctl --user list-timers | grep rclone
```

A **user** unit reads config from `~/.config/rclone/rclone.conf`; a **system** unit runs as root and reads root's config — a common reason "it works in my shell but not the timer". Keep unattended rclone as a user unit unless you have a reason not to.

Credentials for unattended runs: keep `rclone.conf` at mode `0600`, and if the config is encrypted, pass the password via `RCLONE_CONFIG_PASS` in the unit's environment file (not inline in the unit). Putting secrets in a unit file's `Environment=` is worse than a mode-0600 config, because unit files are world-readable by default. For managing those dotfiles and secrets across machines, see [[chezmoi-beginner-guide|Chezmoi Beginner Guide]].

---

## Practical Examples

A complete, runnable lab session end to end:

```bash
# 1. MinIO up, remote configured (from step 3)
rclone mkdir lab:demo

# 2. Seed some data locally and push it
mkdir -p /tmp/seed && echo "hello rclone" > /tmp/seed/readme.txt
rclone copy /tmp/seed lab:demo --progress

# 3. Verify with hashes (local source has them)
rclone check /tmp/seed lab:demo

# 4. Server-side duplicate inside MinIO (no bytes cross your host)
rclone copy lab:demo lab:demo-copy --progress

# 5. Dry-run a destructive sync, then run it with an undo net
rclone sync /tmp/seed lab:demo --dry-run
rclone sync /tmp/seed lab:demo --backup-dir lab:archive/$(date +%F)

# 6. Browse it interactively
rclone ncdu lab:demo
```

An `rsync` → rclone quick reference (the full lossy-mapping table is in [[rclone-deep-dive|the deep-dive]]):

```bash
rsync -av  src/ host:/dst/      # →  rclone copy src remote:dst   (NOT -a: no perms/owner/hardlinks)
rsync -av --delete src/ dst/    # →  rclone sync src remote:dst   (delete-on-dest is the default here)
rsync -n   ...                  # →  rclone ... --dry-run
```

---

## Hands-On Exercises

1. **Prove the SMB hash gap.** Configure the NAS both ways (Path A `smb:` and Path B mount+`alias`). Run `rclone check` from each against the same MinIO bucket. Confirm Path A reports it cannot hash-verify while Path B does a full comparison. Write down which you would use for a backup and why.
2. **Break and fix path-style.** Create a second S3 remote against MinIO **without** `force_path_style`. Run `rclone lsd` and capture the error. Add `--s3-force-path-style` on the command line to confirm the fix, then bake it into the config.
3. **Undo a wrong-direction sync.** Put files in `lab:demo`, then run `rclone sync /tmp/empty lab:demo --dry-run` (an empty source — this would wipe the bucket). Read the plan. Now run it *for real with* `--backup-dir` and recover everything from the backup dir. Feel why `--dry-run` and `--backup-dir` are non-negotiable.
4. **Filter correctly.** Seed a tree containing `.DS_Store`, `._resource`, and a `@eaDir` directory. Write a `--filter-from` file that excludes all three, verify with `--dry-run` that they are skipped, and confirm ordering by moving the `+ **` rule to the top and watching it break.
5. **Persist it.** Install the systemd user timer (Linux) or launchd plist (macOS). Confirm it fires, writes a log, and reads the correct config file. Verify `systemctl --user list-timers` / `launchctl list` shows it.

---

## Troubleshooting

| Symptom | Likely cause | Command / fix |
|---|---|---|
| `sync` deleted files you wanted | Wrong argument order; DEST got made to match SOURCE | Recover from `--backup-dir`; always `--dry-run` first |
| S3 remote errors on every op against MinIO | Missing `force_path_style` (virtual-host addressing) | Set `force_path_style true`; see deep-dive injection #2 |
| `check` says it cannot verify | Backend has no hashes (SMB Path A) | Use Path B (OS mount + local backend) for verified backups |
| `smb` backend "not found" | rclone older than v1.60 | `rclone version`; upgrade via install script or binary drop-in |
| Endless re-transfers of unchanged files | Modtime mismatch between source and dest | Add `--checksum` (if both sides hash) or investigate modtime support |
| `rclone mount` fails on macOS | macFUSE not installed/approved | Install macFUSE + reboot, or use `rclone nfsmount` |
| launchd/systemd job runs `rclone: not found` or wrong config | Minimal `PATH`; system vs user unit reads different config | Absolute path to `rclone`; keep it a **user** unit |
| Slow listing of a huge bucket | Per-directory listing | `--fast-list` (watch memory) |

For deeper diagnostics — `--log-level DEBUG`, `--dump headers`, `--retries`, and the full symptom→cause→command playbook — see [[rclone-deep-dive|the deep-dive]].

---

## Related Tutorials

- [[rclone-deep-dive|rclone Deep Dive]] — crypt, bisync, union/combine, serve, the rc API, failure injections, and the closing verdict
- [[restic-beginner-guide|restic Beginner's Guide]] — use this rclone SMB remote as an encrypted, deduplicated restic backup repository
- [[ssh-tutorial|SSH Tutorial]] — the transport rclone rides for SFTP-family backends
- [[ssh-config-deep-dive|SSH Config Deep Dive]] — host aliases and jump hosts for remote storage access
- [[linux-permissions-beginner-guide|Linux Permissions Beginner Guide]] — `uid`/`gid`/`file_mode` mapping for `mount.cifs`
- [[linux-permissions-deep-dive|Linux Permissions Deep Dive]] — why rclone cannot preserve ownership on most remotes
- [[chezmoi-beginner-guide|Chezmoi Beginner Guide]] — manage `rclone.conf` and secrets across machines
- [[docker-test-container-beginner-guide|Docker Test Container Guide]] — the container context where a static rclone binary shines
- [[apple-container-beginner-guide|Apple container Beginner's Guide]] — running MinIO and rclone on Apple Silicon
- [[apache-nifi-hpc-sysadmin-beginner-guide|Apache NiFi HPC Sysadmin Guide]] — a heavier data-flow alternative for cluster pipelines

---

## Summary

rclone gives you one `remote:path` command surface over ~70 storage systems from a single static binary. The mental shifts from `rsync`: `sync` deletes on the destination by default, there is no `-a` (no ownership, permissions, or hardlink preservation), and object storage lacks the POSIX metadata your intuition assumes. The safety rails — `--dry-run`, `--backup-dir`, `--max-delete` — are what keep `sync` from becoming a data-loss incident.

You configured an SMB NAS two ways and learned that the hashless `smb` backend cannot verify backups, so an OS mount addressed via `local`/`alias` is the right call when verification matters. You stood up a disposable MinIO lab, learned why `force_path_style` is the classic self-hosted-S3 gotcha, moved and filtered data, mounted a remote (with the macFUSE-vs-`nfsmount` divergence on macOS), and made it persistent under launchd and systemd user units.

Next: work through [[rclone-deep-dive|the deep-dive]] for `crypt` (with the password-loss warning), `bisync` and its `--resync` first-run requirement, `union`/`combine`, `serve`, the `rc` API, three worked failure injections, the full `rsync` translation table, and a defended verdict on where rclone belongs versus `rsync` and native S3 CLIs.

**Sources:** [rclone v1.75.0 release](https://github.com/rclone/rclone/releases), [rclone.org/docs](https://rclone.org/docs/), [rclone.org/overview](https://rclone.org/overview/), [rclone.org/smb](https://rclone.org/smb/), [rclone.org/s3](https://rclone.org/s3/), [rclone.org/install](https://rclone.org/install/).
