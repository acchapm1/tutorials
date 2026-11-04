---
title: "restic — Deep Dive Reference"
date: 2026-08-22
difficulty: advanced
tags: [restic, backup, rclone, smb, deduplication, encryption, prune, append-only, ransomware, borg, kopia, systemd, launchd, sysadmin]
---

# restic — Deep Dive Reference

> Written against **restic 0.19.1** (released 2026-07-05). Version-gated behavior is flagged inline. Exact error-message text is marked `> Unverified:` where it is reconstructed from memory rather than a verified run against 0.19.1. Facts confirmed against the official 0.19.1 docs or the v0.19.1 source are stated plainly. Start with the [[restic-beginner-guide|restic Beginner's Guide]] if you have not initialized a repo yet.

## Overview

This is the operator's reference for running restic in production against an SMB/CIFS NAS reached through [[rclone-deep-dive|rclone]], on a mixed fleet of an Apple Silicon Mac and an x86_64 systemd Linux desktop. It assumes you can already take, inspect, and restore snapshots. It covers repository internals in enough detail to reason about failures, the rclone backend mechanism and its tuning, retention design, the honest limits of ransomware resistance, key management, repair and disaster recovery, monitoring and restore drills, and a defended verdict on restic versus borg versus kopia. It closes with four deliberate failure injections, a mental-model table for the rclone/rsync-trained, a purpose-grouped cheat sheet, and a day-one/week-one/steady-state operational summary.

The governing fact, repeated from the beginner guide because every failure traces back to forgetting it: **a restic repository is not a mirror.** It is an opaque, encrypted, content-addressed object store. You cannot recover a file without restic and the key.

## Prerequisites

- restic 0.19.x installed on both machines (`restic version` reports `0.19.1`); if a distro package lags, use the GitHub release binary — repository format and features are version-gated.
- A working rclone remote to an SMB share, verified with `rclone lsd nas:share`. See [[rclone-deep-dive|rclone Deep Dive]] for the SMB backend and its failure modes.
- `RESTIC_REPOSITORY` and a non-interactive `RESTIC_PASSWORD_COMMAND` already wired (Keychain on macOS, `pass`/`systemd-creds` on Linux) — see the [[restic-beginner-guide|beginner guide]], Step 3.
- Comfort with systemd user units, launchd plists, `jq`, and reading exit codes.
- For `restic mount`: in-kernel FUSE on Linux; macFUSE (third-party kext, reboot, Recovery-mode approval) on macOS.

## Key Concepts

### Repository on-disk layout

A restic repository — whether local, on SFTP, or presented by rclone over SMB — has a fixed structure. Understanding it is what lets you reason about a `check` failure instead of guessing.

| Path | Holds | Failure relevance |
| --- | --- | --- |
| `config` | Repo version, chunker polynomial, repo ID. Encrypted. | If unreadable, the repo is effectively lost; back up nothing else if this is gone. |
| `keys/` | One file per user key: the master key wrapped by a password-derived key. | Every key deleted = data unrecoverable. |
| `data/` | Pack files: batches of encrypted, compressed chunks. The bulk of the repo. | A damaged pack is repairable with `repair packs` if the chunk exists elsewhere; otherwise those blobs are lost. |
| `index/` | Which blob (by hash) lives in which pack and at what offset. | A stale/corrupt index is *recoverable*: `restic repair index` rebuilds it by scanning packs. |
| `snapshots/` | One file per snapshot: metadata plus a pointer to the root tree blob. | Deleting a snapshot frees no space; it only removes a pointer. |
| `locks/` | Active-operation lock files, each naming a host/PID/time. | Stale locks after a crash; cleared with `restic unlock`. |

### Content-defined chunking and why it beats `--link-dest`

restic splits file content into variable-length chunks using a rolling hash (a Rabin fingerprint parameterized by the per-repo `chunker_polynomial` stored in `config`). Chunk boundaries fall where the rolling hash hits a pattern, so they are determined by *content*, not by fixed offsets. Insert or delete bytes in the middle of a file and only the chunk spanning the edit changes its boundaries and hash; every chunk before and after is byte-identical to before and keeps its hash. Chunks are addressed by hash, so identical chunks are stored once — across files, across hosts writing to the same repo, and across snapshots.

`rsync --link-dest` deduplicates at *whole-file* granularity via hardlinks: a file that changed by one byte is a wholly new file and gets re-stored in full. For large, slowly-mutating files (mailboxes, databases, VM images, logs) the difference is enormous — restic re-stores kilobytes where `--link-dest` re-stores gigabytes. This is the core technical reason to use a backup program instead of a versioned sync.

### Pack files and `--pack-size`

Chunks are batched into *pack files* before upload rather than being written one object per chunk. This matters disproportionately on a high-latency SMB target: fewer, larger objects mean fewer round-trips and fewer files for the NAS to track. The default target pack size is 16 MiB; raise it to cut file count and per-object overhead on a chatty link:

```bash
restic backup ~/Projects --pack-size 64    # target 64 MiB packs (also RESTIC_PACK_SIZE / --pack-size)
```

Larger packs cost more memory during pack assembly and more repack work during `prune`, so this is a tradeoff, not a free win. On SMB-over-rclone the round-trip savings usually justify 32–128 MiB. See [tuning parameters](https://restic.readthedocs.io/en/stable/047_tuning_parameters.html).

### The index, and why a bad index is recoverable

The index maps blob hashes to (pack, offset). restic caches it locally so it does not re-read the whole index every run. If the index becomes stale (points at packs that changed) or corrupt, the repo data is still intact — the index is derivable. `restic repair index` (formerly `rebuild-index`) rescans the packs and regenerates it. Treat "index problems" as annoying-but-recoverable, categorically different from "pack data lost."

### Snapshots as pointers; forget vs prune

A snapshot is a small object: metadata plus a pointer to a root tree blob, which points at more tree and data blobs, all in the shared pool. Two consequences that govern all maintenance:

- **Deleting a snapshot frees nothing on its own.** `restic forget` removes the snapshot object (the pointer). The chunks it referenced remain until `restic prune` determines no surviving snapshot references them, repacks partially-used packs, and deletes the now-unreferenced ones.
- **`prune` is the expensive, dangerous operation**, especially against SMB: it reads indexes, computes reachability, downloads and rewrites partially-used packs, and deletes. Every one of those steps is round-trip-bound on a high-latency backend.

### Encryption and the key model

Every repo is encrypted; there is no plaintext mode. A single random **master key** encrypts all data. Each **user key** in `keys/` is the master key wrapped by a key derived (scrypt) from a password. `restic key add/list/remove/passwd` manage user keys. A profound and counterintuitive property, stated plainly because it has security consequences: **rotating a user key (or `passwd`) does not re-encrypt the data.** The master key is unchanged; you have only re-wrapped it under a new password. Anyone who captured the old master key (e.g. by extracting it from memory) still holds it. Real key rotation — invalidating a leaked master key — means `restic copy` to a *new* repository with a fresh master key, then destroying the old repo. See [encryption](https://restic.readthedocs.io/en/stable/070_encryption.html) and Section "Key and access management" below.

### The local cache

restic keeps a cache of index and metadata under `~/Library/Caches/restic` (macOS) or `~/.cache/restic` (Linux), overridable with `--cache-dir` / `RESTIC_CACHE_DIR`. It exists so operations do not re-download the whole index every run — significant on SMB. It is **not a backup** and is safe to delete; restic rebuilds it. Use `--no-cache` on read-only media, and `restic cache --cleanup` to prune old repo caches.

### Locking

restic locks the repo so concurrent operations do not corrupt it. Most operations take a *non-exclusive* lock (multiple reads, and backups, can coexist); `prune` and other structure-changing operations take an *exclusive* lock. A crashed run leaves a *stale lock*; `restic unlock` removes stale locks after confirming none are fresh. `--no-lock` disables locking entirely — acceptable only for reads against genuinely read-only storage, never for a repo something else might write.

### Repository format v2 and compression

restic 0.19.x's `init` creates **repository format version 2** by default, which supports compression. Compression modes: `--compression auto` (default, good ratio/speed balance), `off`, or `max` (slower, best ratio); also settable via `RESTIC_COMPRESSION`. `RESTIC_COMPRESSION` is only meaningful on a v2 repo. To upgrade an older v1 repo in place:

```bash
restic migrate upgrade_repo_v2      # one-way; enables compression for newly written data
```

Migration does not retroactively compress existing data; only data written after the upgrade is compressed. See [preparing a new repository](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html).

## Step-by-Step Instructions

### The rclone backend, in full

The repository spec `rclone:<remote>:<path>` hands everything after `rclone:` to rclone verbatim. The mechanism: restic spawns `rclone serve restic --stdio` as a child process and speaks HTTP/2 over the child's stdin/stdout; rclone speaks SMB to the NAS. There is no listening socket, no port to firewall, and the data is visible only to the user running both processes (and root). restic owns the rclone process lifecycle.

Two options control the child:

- `-o rclone.program` — path to the rclone binary (default: `rclone` on `PATH`). Set this explicitly under launchd/systemd where `PATH` is minimal.
- `-o rclone.args` — the argument list restic passes to rclone.

> **Verified against restic 0.19.1 source** (`internal/backend/rclone/config.go`): the default `rclone.args` is `serve restic --stdio --b2-hard-delete`. The default connection limit is 5 and the default startup timeout is 1 minute.

Overriding `rclone.args` **replaces** the default list rather than appending, so you must reproduce the defaults and add flags after them:

```bash
restic \
  -o rclone.program=/opt/homebrew/bin/rclone \
  -o rclone.args="serve restic --stdio --b2-hard-delete --transfers=8 --checkers=16 --bwlimit=20M --log-file=/tmp/rclone-restic.log --log-level=INFO" \
  backup ~/Projects
```

Drop `serve restic --stdio` and the backend cannot function — restic will be talking HTTP/2 to a process that is not serving it.

**Where rclone's config comes from** when restic spawns it: rclone reads `rclone.conf` for the user the *child* runs as, from that user's `~/.config/rclone/rclone.conf` (or `$RCLONE_CONFIG`). This is why a backup that works in your interactive shell fails under a systemd **system** unit (runs as root, reads root's rclone config, which does not have your `nas` remote) or under `sudo` (same problem). Use a systemd **user** unit, or set `RCLONE_CONFIG` explicitly in the unit, or pass `-o rclone.args` with `--config /path/to/rclone.conf`. This is the single most common automation failure with this backend after the password-newline bug.

### Inspecting deeply

```bash
restic snapshots --group-by host,paths,tags --json | jq '.[].short_id'
restic diff <id1> <id2>                      # + added, - removed, M content, U metadata, T type, ? bitrot
restic find --pack <packID>                  # which blobs/files live in a pack
restic stats --mode raw-data                 # storage actually occupied
restic stats --mode restore-size             # logical size of a restore
restic stats --mode files-by-contents        # unique files by content across snapshots
```

Know which number you are quoting: `raw-data` is what you pay the NAS for; `restore-size` is what you would get back.

### Integrity: check strategy

`restic check` verifies repository *structure* — that the index, snapshots, and trees are internally consistent — without reading pack data. It does not detect bitrot in the data blobs. To actually read and verify pack contents:

```bash
restic check                          # structure only; run often, cheap-ish
restic check --read-data              # download and verify every pack; correct but expensive
restic check --read-data-subset=1/10  # verify 1/10 of packs; rotate the slice each run
restic check --read-data-subset=5%    # or a percentage
```

On SMB, full `--read-data` can take hours or days. Schedule a rolling subset so the whole repo is verified over a window without one punishing run — e.g. `1/7` daily covers everything weekly. A failed check reports which packs are damaged and suggests next steps (`repair index`, `repair packs`, `repair snapshots --forget`); see the repair section.

### Retention and pruning

> **Destructive-command warning.** `forget` deletes snapshot references; `--prune`/`prune` permanently repacks and deletes unreferenced data. Dry-run `forget` first, every time.

```bash
restic forget \
  --keep-last 3 \
  --keep-hourly 0 \
  --keep-daily 7 \
  --keep-weekly 5 \
  --keep-monthly 12 \
  --keep-yearly 3 \
  --keep-within 14d \
  --keep-tag keep \
  --group-by host,paths \
  --dry-run
```

Remove `--dry-run` once the kept/removed sets look right, then reclaim space:

```bash
restic forget --keep-daily 7 --keep-weekly 5 --keep-monthly 12 --group-by host,paths
restic prune --max-unused 5% --max-repack-size 5G
```

`--max-unused` lets prune leave a tolerated fraction of dead data in place to avoid rewriting nearly-full packs (cheaper on SMB). `--max-repack-size` caps how much data a single prune will rewrite, so you can bound a prune's runtime on a slow link and let it make progress across several runs. See [forget and prune](https://restic.readthedocs.io/en/stable/060_forget.html).

## Practical Examples

### A recommended retention policy for this learner, with reasoning

For a laptop plus a desktop backing up to one SMB repo, this is a defensible default — not a menu:

```bash
restic forget \
  --keep-daily 14 \
  --keep-weekly 8 \
  --keep-monthly 12 \
  --group-by host,paths \
  --prune
```

Reasoning: **no hourly keeps** — a laptop is not a database; hourly RPO is meaningless when the machine is asleep half the day and you cannot restore to a 3pm-Tuesday state you never snapshotted. Fourteen daily keeps cover the "I deleted something last week and just noticed" case, which is the dominant real recovery scenario. Eight weekly plus twelve monthly give you two months of weekly granularity and a year of monthly points for slow-burn corruption you catch late. `--group-by host,paths` keeps the policy applied *per machine and path set*, so the desktop's retention is not consumed by the laptop's snapshots when both write to one repo. Run `forget --prune` **weekly, not daily** — prune is the expensive operation and daily prunes on SMB will dominate your backup window for no benefit.

### Automation with differentiated alerting

The point of exit codes is to alert differently for "some files couldn't be read" (annoying, usually fine) versus "repository unreachable" (page someone). Alerting identically on both is how people learn to ignore backup alerts.

> **Verified against the restic 0.19.1 docs** ([scripting](https://restic.readthedocs.io/en/stable/075_scripting.html)):

| Code | Meaning |
| --- | --- |
| 0 | Command was successful |
| 1 | Command failed, see command help for details |
| 2 | Go runtime error |
| 3 | `backup` could not read some source data, or `forget` could not remove one or more snapshots |
| 10 | Repository does not exist (since 0.17.0) |
| 11 | Failed to lock repository (since 0.17.0) |
| 12 | Wrong password (since 0.17.1) |
| 130 | Command was cancelled (SIGINT/SIGTERM) |

The docs warn: new exit codes will be added over time, and an unknown code MUST be treated as failure. A wrapper honoring that:

```bash
#!/usr/bin/env bash
set -uo pipefail
export RESTIC_REPOSITORY="rclone:nas:share/restic"
export RESTIC_PASSWORD_COMMAND="pass restic/nas"

restic backup "$HOME/Documents" "$HOME/Projects" \
  --exclude-file "$HOME/.restic-excludes" --exclude-caches \
  --one-file-system --host "$(hostname -s)" --tag scheduled
rc=$?

case "$rc" in
  0)  logger -t restic "backup ok" ;;
  3)  logger -t restic "backup: some source files unreadable (rc=3)"
      notify-warn "restic: some files could not be read — review, not urgent" ;;
  10) notify-page "restic: REPOSITORY UNREACHABLE (rc=10)"; exit 10 ;;
  11) notify-page "restic: repo locked (rc=11) — check for stale lock or overlapping run"; exit 11 ;;
  12) notify-page "restic: WRONG PASSWORD (rc=12) — credential/newline problem"; exit 12 ;;
  *)  notify-page "restic: unknown failure rc=$rc — treat as failure"; exit "$rc" ;;
esac
```

The chained daily job runs `backup` every day, `forget --prune` weekly, and a rolling `check --read-data-subset` continuously — never all three at full weight on the same run:

```bash
day=$(date +%u)                                   # 1..7
restic backup ... --tag scheduled
[ "$day" = "7" ] && restic forget --keep-daily 14 --keep-weekly 8 --keep-monthly 12 \
                      --group-by host,paths --prune
restic check --read-data-subset="1/7"
```

### systemd user timer and launchd plist (complete)

The complete units live in the [[restic-beginner-guide|beginner guide]], Step 8. The two production-relevant additions here: point `-o rclone.program` at the absolute rclone path in both, and set `OnFailure=` (systemd) or parse the exit code from the wrapper (launchd) so the differentiated alerting above actually fires. Under systemd, prefer a **user** unit with `loginctl enable-linger "$USER"` so rclone reads *your* `rclone.conf`; if you must use a system unit, set `Environment=RCLONE_CONFIG=/home/you/.config/rclone/rclone.conf` explicitly.

## Deep Dive: Ransomware Resistance, Keys, Repair, Monitoring, Verdict

### Append-only and ransomware resistance — the honest version

Lead with the uncomfortable truth: **an SMB share the backup host can write to is a share that malware on the backup host can encrypt or delete.** restic's encryption protects *confidentiality*, not *availability*. restic's own `forget`/`prune` require delete permission on the repo *by design* — a client that can maintain the repo can also destroy it. The rclone-to-SMB path has **no native append-only mode**. If your threat model includes host compromise, the default setup does not protect you, and "it's encrypted" is not an answer to "the attacker deleted my backups."

Three real mitigations, with tradeoffs:

**1. rest-server in `--append-only` mode on the NAS.** Run [rest-server](https://github.com/restic/rest-server) (Synology Container Manager / TrueNAS app / small VM) and point restic at it over HTTP(S) instead of SMB: `RESTIC_REPOSITORY=rest:https://nas:8000/restic`. In append-only mode the server accepts new data and new snapshots but refuses deletes, so a compromised client can add but cannot remove or overwrite. The cost: `prune` (which deletes) **cannot run through the append-only endpoint** — you must run maintenance from a separate, privileged context (a second key/endpoint the client does not hold, or direct access on the NAS), on a schedule the client cannot influence. That operational split is the price of the guarantee.

**2. NAS-side immutability.** Take ZFS snapshots (TrueNAS) or Btrfs/immutable-share snapshots (Synology) of the *dataset holding the restic repo*, on a schedule the backup client cannot reach or influence, ideally with WORM/locked-snapshot retention where the NAS supports it. A client that encrypts the live repo cannot alter yesterday's read-only ZFS snapshot; you roll the dataset back and your restic repo is intact. This is frequently the **highest-value, lowest-effort** option because it needs no change to the restic/rclone path at all — it is defense applied entirely on the storage side. Present it first when advising.

**3. `restic copy` to a second repository** with separate credentials on separate infrastructure that the primary host cannot reach:

```bash
restic copy \
  --from-repo rclone:nas:share/restic \
  --from-password-command "pass restic/nas" \
  --repo rest:https://offsite:8000/restic \
  --password-command "pass restic/offsite"
```

`copy` re-encrypts blobs under the *destination* repo's master key, so chunk IDs differ between the two repos.

> **Verify against current docs before relying on cross-repo dedup claims:** because `copy` re-encrypts under the destination key, deduplication is preserved *within* the destination repo but chunk identity does not carry across repos with different keys. Copying the same source into the same destination repeatedly deduplicates against what is already there; copying into a fresh repo re-stores everything. See [working with repositories](https://restic.readthedocs.io/en/stable/045_working_with_repos.html).

**Threat-to-mitigation mapping** — state plainly what the setup does and does not cover:

| Threat | Default SMB-over-rclone repo | Add ZFS/Btrfs immutable snapshots | Add rest-server append-only | Add `restic copy` offsite |
| --- | --- | --- | --- | --- |
| Disk failure on source | Covered (data is on NAS) | Covered | Covered | Covered |
| Accidental deletion on source | Covered (snapshot history) | Covered | Covered | Covered |
| NAS single-disk failure | Depends on NAS RAID | Depends on NAS RAID | Depends on NAS RAID | Covered (second copy) |
| Site loss (fire/theft) | Not covered | Not covered | Not covered | Covered (offsite) |
| Host compromise / ransomware | **Not covered** | Covered (client can't touch snapshots) | Covered (client can't delete) | Partially (if offsite creds unreachable from host) |

### Key and access management

```bash
restic key list
restic key add                       # add a new user key (new password), e.g. per host
restic key passwd                     # change the password on the current key
```

> **Destructive-command warning:** `restic key remove <id>` deletes a user key. Never remove the last remaining key — that is unrecoverable data loss. Confirm at least one other working key first with `restic key list`.

Multiple keys let each host have its own password; revoking a host's access is `restic key remove <that-host's-key-id>` from a machine holding a different key. But re-read the counterintuitive property from Key Concepts: **removing or changing a user key does not re-encrypt data, because the master key is unchanged.** If a host's key (and thus the master key it unwrapped) was exposed, removing that user key does not protect already-written data from an attacker who already extracted the master key. True remediation is `restic copy` to a new repo with a fresh master key, then destroy the old one.

### Repair and disaster recovery

Commands, ordered from least to most invasive (see [troubleshooting](https://restic.readthedocs.io/en/stable/077_troubleshooting.html)):

```bash
restic repair index                  # rebuild index/ by scanning packs — safe, first resort
restic repair snapshots --forget     # remove references to missing data from snapshots
restic repair packs <packID>...      # rewrite packs flagged damaged by check
restic recover                        # build a new snapshot from trees not referenced by any snapshot
```

> **Destructive-command warning:** `restic rewrite` rewrites existing snapshots. With `--forget` it drops the originals. Use it to excise an accidentally-backed-up secret or a giant file from history:

```bash
restic rewrite --exclude "secrets/id_rsa" --forget    # remove a path from all snapshots, drop originals
restic prune                                          # then reclaim the space
```

**"Corrupt repo, now what" decision tree:**

1. `restic check` reports errors → note whether it says index, packs, or snapshots.
2. Index errors only → `restic repair index`, then `check` again. Usually resolves.
3. `check --read-data` reports damaged packs → `restic repair packs <ids>`; if the blobs exist elsewhere they are recovered, otherwise those blobs are lost.
4. Snapshots reference missing data → `restic repair snapshots --forget` to produce consistent snapshots minus the lost data.
5. Snapshots directory itself damaged but trees survive → `restic recover` to rebuild a snapshot from reachable trees.
6. `config` or all of `keys/` gone → the repo is unrecoverable; restore from your `restic copy` / offsite. This is why Section "Ransomware resistance" insists on a second copy.

### Monitoring and restore drills

Alert on: job failure by exit-code class (above), **snapshot age exceeding a threshold** (a job that exits 0 but silently stopped producing snapshots is the scariest failure), check failure, and unexpected repo growth. A scripted freshness check:

```bash
latest_epoch=$(restic snapshots --host "$(hostname -s)" --json \
  | jq -r 'max_by(.time) | .time' \
  | xargs -I{} date -d {} +%s 2>/dev/null || echo 0)   # GNU date; macOS: use `date -j -f`
age_hours=$(( ( $(date +%s) - latest_epoch ) / 3600 ))
if [ "$age_hours" -gt 26 ]; then
  notify-page "restic: latest snapshot is ${age_hours}h old — backups may have silently stopped"
fi
```

**Quarterly restore-drill checklist** — treat as an operational practice, not a suggestion:

1. Restore `latest` (or a chosen older snapshot) to scratch: `restic restore latest --host "$(hostname -s)" --target /tmp/drill`.
2. Verify a checksum against the live file: `sha256sum /tmp/drill/.../file` vs the live copy — they must match.
3. Time the restore and record throughput; SMB restores are slow and you want the number *before* a real outage.
4. Record the result (date, snapshot, throughput, pass/fail) somewhere durable. An undrilled backup is unproven.

### Comparison and verdict — restic vs borg vs kopia

| Dimension | restic | borg | kopia |
| --- | --- | --- | --- |
| Deduplication | Content-defined chunking, global across hosts/snapshots | Content-defined chunking, per-repo (single-client) | Content-defined chunking, global |
| Compression | v2 repo: auto/off/max (zstd) | lz4/zstd/zlib/lzma | zstd/gzip/s2 |
| Encryption | Always on; master key wrapped by user keys | Optional; repokey/keyfile modes | Always on; per-repo |
| Backend breadth | Broad: local, SFTP, S3, B2, Azure, GCS, **rclone** (any rclone remote), rest-server | Narrow: SSH to a borg-installed host, or local | Broad: local, SFTP, S3, B2, GCS, Azure, WebDAV, **rclone** |
| Append-only support | Via rest-server `--append-only` | Native `--append-only` over SSH | Server mode; per-backend immutability |
| Multi-client to one repo | Yes, concurrent | Poor (borg locks; effectively one writer) | Yes, via server |
| Prune cost | Moderate–high; painful on high-latency backends | Low–moderate (efficient, but single-host) | Moderate; content-managed |
| Mount/browse | `restic mount` (FUSE) | `borg mount` (FUSE) | GUI + `kopia mount` |
| Restore performance | Good; parallel | Good on local/SSH | Good |
| Language / dependencies | Single static Go binary | Python + C (msgpack, etc.) | Single static Go binary |
| Maturity / cadence | Mature, steady releases | Very mature; borg 2.x modern | Mature; active, GUI-forward |
| GUI | Third-party only | Third-party (Vorta) | First-party GUI |

**Verdict for this learner — Mac + Linux endpoints, SMB NAS via rclone, sysadmin operator: use restic.** The decisive factor is the backend. This person's storage is an SMB NAS with no ability to run a borg binary on the storage side, and borg fundamentally wants SSH-to-a-borg-host or local storage — it has no first-class path to "an SMB share via rclone." restic's rclone backend turns *any* rclone remote into a repository, which is exactly the constraint here, and it does so with a single static binary that drops onto both an Apple Silicon Mac and an x86_64 Linux box identically. restic also handles two hosts writing to one repo cleanly, which borg does not.

The strongest counterargument is borg's efficiency: on a single Linux host with a dedicated SSH target, borg's prune and dedup are lighter and its native append-only over SSH is simpler than standing up rest-server. That is a real win — **in that environment.** It does not survive contact with "the target is an SMB NAS and one of the clients is a Mac," where borg has no good answer and restic has a purpose-built one.

Where restic is the **wrong** answer: (a) a single Linux host backing up to a dedicated SSH box you control — borg's efficiency and native append-only win, and restic's rclone indirection buys nothing; or (b) data that is *already versioned and immutable* (e.g. an object store with versioning, or content that never mutates), where a plain [[rclone-deep-dive|rclone sync]] is sufficient and restic only adds an opaque, key-gated layer over data that did not need deduplication. If the honest requirement is "mirror already-versioned files offsite," restic is overhead, not insurance.

kopia is the closest competitor and a legitimate choice — same rclone-friendly, single-binary, always-encrypted profile, with a first-party GUI. For a CLI-fluent sysadmin who wants the largest community, the most battle-tested rclone backend, and no GUI dependency, restic is the safer pick; if you specifically want a maintained GUI for less technical users on the same repo, kopia earns a second look.

## Hands-On Exercises

1. **Reproduce the rclone-config-under-sudo failure.** Run a working backup interactively, then run the identical command under `sudo`. Watch it fail to find the `nas` remote (root's rclone config lacks it). Fix it by passing `-o rclone.args="serve restic --stdio --b2-hard-delete --config /home/you/.config/rclone/rclone.conf"`. You have now internalized why user units matter.

2. **Bound a prune on SMB.** On a repo with some churn, run `restic prune --max-repack-size 1G --dry-run` and read how much it *would* repack, then run it for real and time it. Repeat and watch it make incremental progress. This is how you keep prune from eating an entire maintenance window.

3. **Stand up NAS-side immutability.** Configure a scheduled ZFS or Btrfs snapshot of the dataset holding your restic repo, with a retention the backup client cannot change. Then simulate "ransomware": delete the live restic repo and roll the dataset back to the snapshot. Confirm `restic snapshots` works against the rolled-back repo.

4. **Wire snapshot-age alerting.** Deploy the freshness-check script, then simulate a silent failure by disabling the backup timer for two days. Confirm the age alert fires even though no job ever exited non-zero.

5. **Run a full restore drill and record it.** Follow the quarterly checklist end to end, including the checksum comparison and the throughput number. File the result. Do this before you need it.

## Troubleshooting — Four Failure Injections

Each gives the command, the approximate resulting error, and the diagnostic path. Error text is marked `> Unverified:` where reconstructed rather than captured from a 0.19.1 run.

### 1. Stale lock after an interrupted backup

```bash
restic backup ~/Projects        # kill it mid-run (Ctrl-C hard, or the machine sleeps)
restic snapshots                # next operation
```

> Unverified (approximate): `unable to create lock in backend: repository is already locked exclusively by PID NNNN on host by user (UTC ...). the `unlock` command can be used to remove stale locks.`

Diagnostic path: confirm nothing is actually running first — `ps aux | grep '[r]estic'` on both hosts that use the repo, and check for an active scheduled run. Only when you are certain no live process holds it:

```bash
restic unlock                   # removes stale locks
restic list locks               # confirm none remain
```

Never paper over this with `--no-lock`. The lock exists to stop two operations from corrupting the repo.

### 2. Wrong password / trailing newline from `RESTIC_PASSWORD_COMMAND`

```bash
export RESTIC_PASSWORD_COMMAND='echo hunter2'   # echo appends \n
restic snapshots
```

> Unverified (approximate): `Fatal: wrong password or no key found` (exit code 12 since 0.17.1).

Diagnostic path: the password is right but has a stray newline. Inspect the command's raw output:

```bash
eval "$RESTIC_PASSWORD_COMMAND" | xxd | tail -1     # look for a trailing 0a byte
```

Fix by using a producer that emits no newline (`pass`, `security ... -w`) or `printf '%s'` in any wrapper. This is the most common automation-only failure — works interactively (you type the password cleanly) but fails under the job.

### 3. An interrupted `prune`

```bash
restic prune                    # interrupt it partway (SIGINT, or the SMB link drops)
```

restic's `prune` is designed to be safe to interrupt: it writes new packs and updates the index before deleting old packs, so an interruption leaves the repo *consistent but with more unused space than intended* — some data that was going to be reclaimed is still there, and the index may reference the state at the interruption point.

> Unverified (approximate, on the next command): a note that the repository contains unused data / that a previous prune did not complete.

Diagnostic path: run `restic check`. If it is clean (it usually is), simply re-run `restic prune` — it resumes the job of reclaiming space. If `check` flags index issues, `restic repair index` first, then `prune`. The repo is not corrupt; it is merely under-pruned. Do not panic-delete anything on the NAS.

### 4. Concurrent invocations against the same rclone-backed repo hanging on "open repository"

Two restic processes (e.g. an overlapping scheduled run and a manual one) hit the same `rclone:nas:...` repo. A documented real-world failure mode with the rclone backend (restic issue #5582) is that one invocation hangs on opening the repository rather than failing fast.

> Unverified (approximate): the second process prints nothing and blocks at `open repository`, or eventually times out after the backend's 1-minute default startup timeout.

Diagnostic path and prevention:

- **Detect:** `ps aux | grep '[r]estic'` shows two processes; one is wedged with no progress.
- **Timeout:** the rclone backend's default connection timeout is 1 minute (verified from 0.19.1 source); a wedged open should eventually error rather than hang forever, but do not rely on it.
- **Prevent overlap** — the real fix. Serialize runs so two never touch the repo at once:

```ini
# systemd: make manual and timed runs mutually exclusive via a shared lock
ExecStart=/usr/bin/flock -n /run/user/%U/restic.lock /usr/local/bin/restic backup ...
```

or wrap every invocation in `flock`:

```bash
flock -n /tmp/restic-nas.lock -c 'restic backup ~/Projects ...' || echo "another restic run holds the lock; skipping"
```

Overlapping scheduled runs (a backup that runs long enough to collide with the next timer firing) are the usual cause; `flock` plus a sane schedule eliminates it.

## Reference: Mental-Model Table, Cheat Sheet, Operational Summary

### rclone/rsync → restic mental model

| You know (rsync/rclone) | restic equivalent | Not equivalent because… |
| --- | --- | --- |
| `rsync -a src dst` mirror | `restic backup src` | The destination is an opaque encrypted object store, not a browsable copy of `src`. |
| Browse the destination | `restic ls <snap>` / `restic mount` | You cannot read the repo directly; only restic + key can. |
| `rsync --delete` to purge | `restic forget` (+ `prune`) | `forget` removes a snapshot pointer; space returns only after `prune`. |
| `--link-dest` incremental | Content-defined chunk dedup | restic dedups sub-file; `--link-dest` only dedups whole unchanged files. |
| Versioning via dated dirs | Snapshots | Snapshots share one chunk pool; a new snapshot of unchanged data is nearly free. |
| Partial restore = copy a subtree | `restic restore --include` / `dump` | You extract from the repo through restic; there is no subtree on disk to copy. |
| `rclone sync` is idempotent, stateless | restic is stateful, locked | restic locks the repo and maintains an index; two blind concurrent runs can collide. |

### Command cheat sheet (grouped by purpose)

```bash
# CREATE / CONFIGURE
restic init                                   # create a v2 repo (compression-capable)
restic key add | list | passwd | remove       # manage user keys (remove is destructive)
restic migrate upgrade_repo_v2                 # upgrade an old v1 repo

# BACK UP
restic backup PATHS --exclude-file F --exclude-caches --one-file-system --host H --tag T
restic backup PATHS --pack-size 64             # larger packs for SMB

# INSPECT
restic snapshots --group-by host,paths,tags
restic ls <snap> | restic find TERM | restic diff <a> <b>
restic stats --mode raw-data | restore-size | files-by-contents
restic cat config                              # cheap existence/health probe

# RESTORE
restic restore <snap> --target DIR [--include P] [--exclude P]
restic restore latest --host H --target DIR
restic dump <snap> PATH > file                 # single file to stdout
restic mount MNT                               # FUSE browse (macFUSE on mac)

# MAINTAIN (destructive: forget/prune)
restic forget --keep-daily N ... --group-by host,paths --dry-run   # preview first
restic forget ... --prune                      # remove pointers, then reclaim
restic prune --max-unused 5% --max-repack-size 5G
restic check [--read-data | --read-data-subset=1/7]

# REPAIR (destructive: rewrite --forget)
restic unlock                                  # clear stale locks
restic repair index | snapshots --forget | packs <id>
restic recover
restic rewrite --exclude P --forget            # excise data from history

# COPY / OFFSITE
restic copy --from-repo R1 --from-password-command C1 --repo R2 --password-command C2
```

### Day one / week one / steady state

| When | Do |
| --- | --- |
| **Day one (once)** | Install restic both machines; verify `rclone lsd nas:share`; `restic init`; store password in Keychain/`pass`; wire `RESTIC_REPOSITORY` + `RESTIC_PASSWORD_COMMAND`; first `backup`; **first restore drill to scratch**; write an exclude file. |
| **Week one (set up automation)** | systemd user timer (Linux) / launchd plist (macOS) with `-o rclone.program` absolute path and differentiated exit-code alerting; `flock` guard against overlap; snapshot-age alert; decide retention policy; stand up NAS-side ZFS/Btrfs immutable snapshots (highest value/effort ratio); optionally rest-server append-only and/or `restic copy` offsite. |
| **Steady state** | Daily `backup`; weekly `forget --prune`; continuous rolling `check --read-data-subset`; watch exit-code and snapshot-age alerts; **quarterly restore drill with checksum verification, timed and recorded**; review repo growth. |

## References

- [restic user manual](https://restic.readthedocs.io/en/stable/) — canonical documentation (0.19.1)
- [Preparing a new repository](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html) — rclone backend, repo format v2, `migrate`
- [Working with repositories](https://restic.readthedocs.io/en/stable/045_working_with_repos.html) — `copy`, keys, maintenance
- [Removing backup snapshots](https://restic.readthedocs.io/en/stable/060_forget.html) — `forget`/`prune` policy flags
- [Encryption](https://restic.readthedocs.io/en/stable/070_encryption.html) — master key / user key model
- [Scripting](https://restic.readthedocs.io/en/stable/075_scripting.html) — environment variables and the **verified exit-code table**
- [Troubleshooting](https://restic.readthedocs.io/en/stable/077_troubleshooting.html) — `repair`, `recover`, `rewrite`
- [Tuning parameters](https://restic.readthedocs.io/en/stable/047_tuning_parameters.html) — `--pack-size`, concurrency
- [rclone backend design](https://restic.net/blog/2018-04-01/rclone-backend/) — rationale for `serve restic --stdio`
- [rclone backend source, v0.19.1](https://pkg.go.dev/github.com/restic/restic@v0.19.1/internal/backend/rclone) — **verified** default `rclone.args`, connections, timeout
- [restic/rest-server](https://github.com/restic/rest-server) — append-only server for ransomware resistance
- [restic 0.19.1 release notes](https://restic.net/blog/2026-07-05/restic-0.19.1-released/) — targeted version

## Related Tutorials

- [[restic-beginner-guide|restic Beginner's Guide]] — install, init, first backup, dedup demo, restore, and basic automation
- [[rclone-deep-dive|rclone Deep Dive]] — the SMB backend, `crypt`, `serve`, and tuning the transport restic chains through
- [[rclone-beginner-guide|rclone Beginner's Guide]] — `remote:path` addressing and the SMB remote restic depends on
- [[ssh-config-deep-dive|SSH Config Deep Dive]] — host aliases and jump hosts for restic's SFTP backend and for reaching a rest-server host
- [[linux-permissions-deep-dive|Linux Permissions Deep Dive]] — mode-0600 secrets, ownership of the cache and restore targets, and why the repo carries no source ownership semantics you can browse
- [[chezmoi-deep-dive|Chezmoi Deep Dive]] — distributing `rclone.conf`, restic env files, and password-command wiring across the fleet
- [[headscale-deep-dive|Headscale Deep Dive]] — mesh networking to reach a rest-server or offsite copy target without port forwarding

## Summary

restic is a single Go binary implementing an encrypted, deduplicating, snapshot-based object-store repository — not a mirror. Reasoning about it in production means holding the layout (`config`/`keys`/`data`/`index`/`snapshots`/`locks`), understanding content-defined chunking (why it beats `--link-dest`), keeping `forget` and `prune` distinct, and respecting that prune and check are the expensive operations against a chatty SMB-over-rclone backend. The rclone backend works by spawning `rclone serve restic --stdio` (default args `serve restic --stdio --b2-hard-delete`, verified from 0.19.1 source) and speaking HTTP/2 over its pipe; overriding `rclone.args` replaces the defaults, and the child reads *its* user's `rclone.conf` — the root of most automation failures.

The security posture must be stated honestly: encryption protects confidentiality, not availability, and a client-writable share is a client-destroyable share. NAS-side immutable snapshots are usually the highest-value mitigation, with rest-server append-only and `restic copy` offsite as complements; map each to the threats it actually covers. Automate with the verified exit-code table so "unreadable files" and "repository unreachable" alert differently, monitor snapshot age (the silent-failure killer), and run — and record — quarterly restore drills. For this operator's Mac + Linux + SMB-NAS-via-rclone situation, restic is the right tool; borg wins only on a single-host dedicated-SSH target, and plain [[rclone-deep-dive|rclone sync]] wins only when the data is already versioned and restic would add opacity for no gain.
