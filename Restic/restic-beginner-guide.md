---
title: "restic — Beginner's Guide"
date: 2026-08-22
difficulty: beginner
tags: [restic, backup, rclone, smb, deduplication, encryption, snapshots, macos, linux, sysadmin]
---

# restic — Beginner's Guide

> Written against **restic 0.19.1** (released 2026-07-05). Version-gated behavior is flagged inline. Where exact error text is reproduced from memory rather than a verified run, it is marked `> Unverified:`.

## Overview

restic is a single Go binary that implements an encrypted, deduplicating, snapshot-based backup repository. There is no server, no daemon, and no central catalog living outside the repository itself. You point it at a storage location, give it a password, and it stores versioned, content-addressed, encrypted backups there.

This guide is written for a Linux/HPC sysadmin who is fluent in shell, SSH, filesystems, `rsync`, systemd, launchd, and credential hygiene, and who has recently picked up [[rclone-beginner-guide|rclone]] — but who has not used restic and has not internalized how a backup program differs from a sync program. If that is you, read the next paragraph twice.

**A restic repository is not a mirror.** Your `rsync`/rclone intuition says the destination should be browsable and should resemble the source. It does not. A restic repo is an opaque, encrypted, content-addressed object store — directories full of packed, encrypted blobs with names that are SHA-256 hashes. You cannot list your files by looking at the destination, and you cannot recover a single file from it without the `restic` binary and the repository key. Every mistake beginners make with restic traces back to expecting a mirror and getting an object store. Establish this now.

By the end of this guide you will have installed restic on a Mac and a Linux box, initialized a repository on an SMB/CIFS NAS reached through rclone, taken and inspected snapshots, seen deduplication happen, restored files, and set up automated backups. The companion [[restic-deep-dive|restic Deep Dive]] covers internals, tuning, ransomware resistance, repair, and the restic-vs-borg-vs-kopia decision.

## Prerequisites

Before starting, you should have:

- **A working rclone remote pointing at your NAS share.** This guide targets an SMB/CIFS share on a Synology/TrueNAS/QNAP-class NAS, addressed through rclone. If you do not have this yet, set it up first — see [[rclone-beginner-guide|the rclone Beginner's Guide]] for the SMB backend and `remote:path` addressing. We will call the remote `nas` and assume a share named `share`; adjust to your `rclone.conf`.
- **A Mac (Apple Silicon, Homebrew installed)** and/or **a Linux desktop (x86_64, systemd, a standard package manager).** Commands are given for both, with divergences called out inline.
- **Comfort with environment variables and credential storage** — macOS Keychain, or `pass`/`systemd-creds`/mode-0600 files on Linux.
- **A scratch directory you can afford to lose**, for restore drills.

Quick rclone recap (one paragraph, not a re-teach): rclone addresses storage as `remote:path`, where `remote` is a named block in `~/.config/rclone/rclone.conf` and everything after the colon is a path within that remote's backend. `rclone lsd nas:share` lists directories under the share; `rclone about nas:` reports capacity. restic will reuse this exact `remote:path` grammar. If `rclone lsd nas:share` works, restic's rclone backend will work.

## Key Concepts

You need six ideas before you touch a command. Rushing past these is how people end up with a repo they cannot reason about.

**1. The repository is an opaque object store.** On disk (or on the NAS) a restic repo is a fixed set of directories: `config` (repo parameters), `keys/` (wrapped encryption keys), `data/` (packed, encrypted file chunks), `index/` (which chunk lives in which pack), `snapshots/` (pointers describing each backup), and `locks/` (active-operation markers). None of it is human-readable. The [[restic-deep-dive|deep dive]] walks the layout in detail; for now, internalize that browsing the destination tells you nothing.

**2. Content-defined chunking and deduplication.** restic splits files into variable-length chunks at boundaries determined by the *content*, not by fixed offsets. Insert a byte in the middle of a large file and only the chunk containing that byte changes — every subsequent chunk keeps its old boundary and old hash. Because chunks are content-addressed by hash, an identical chunk is stored exactly once, no matter how many files, hosts, or snapshots contain it. This is why restic deduplicates where `rsync --link-dest` (which links whole unchanged files) cannot: `--link-dest` sees a 1-byte-changed 4 GB file as entirely new; restic re-stores one chunk.

**3. Snapshots are pointers, not copies.** A snapshot is a small object pointing into the shared chunk pool. Taking a snapshot of mostly-unchanged data adds almost nothing. The corollary bites later: **deleting a snapshot frees no space by itself** — it only removes a pointer. Space is reclaimed by a separate `prune` operation that finds chunks no snapshot references anymore and repacks. `forget` removes pointers; `prune` reclaims space. Keep these two verbs separate in your head.

**4. Encryption is not optional.** Every restic repository is encrypted; there is no plaintext mode. The repo has a single master key that actually encrypts the data, and that master key is itself wrapped by one or more *user keys*, each unlocked by a password. You manage user keys with `restic key list/add/remove/passwd`. State this to yourself plainly: **if you lose every key/password, the data is gone.** There is no vendor, no recovery service, no backdoor. This is a feature (nobody else can read your backup) and a responsibility (nobody, including you, can rescue you from a lost password).

**5. Password handling determines whether automation is safe.** restic reads the password from, in order of increasing safety: `RESTIC_PASSWORD` (the actual password in an environment variable — worst, visible to anything that can read the process environment), `RESTIC_PASSWORD_FILE` (a file path), and `RESTIC_PASSWORD_COMMAND` (a command whose stdout is the password — best, because you can source it from Keychain or a secret manager and it never sits in a file or the environment). We initialize interactively, then switch to `RESTIC_PASSWORD_COMMAND` for everything automated.

**6. The local cache and locking.** restic keeps a local cache (metadata and index data) so it does not re-download the whole index on every run. The cache is *not* a backup and is safe to delete; restic rebuilds it. restic also *locks* the repo during operations so two runs do not corrupt each other. A crashed run can leave a *stale lock*; `restic unlock` clears it once you are sure nothing else is running. Both topics get full treatment in the [[restic-deep-dive|deep dive]] — for now, know they exist.

## Step-by-Step Instructions

### Step 1 — Install restic

**macOS (Apple Silicon, Homebrew):**

```bash
brew install restic
restic version
```

Expected output (version/arch will match your machine):

```
restic 0.19.1 compiled with go1.24.x on darwin/arm64
```

**Linux (x86_64):** distro packages lag, sometimes by a full release. Because repository-format and feature availability are version-gated, prefer the official GitHub release binary if your distro ships something older than 0.19.x.

```bash
# Option A: distro package (may be old — check the version afterward)
sudo apt install restic        # Debian/Ubuntu
# or: sudo dnf install restic   # Fedora/RHEL

# Option B: official release binary (recommended if the distro lags)
curl -fsSL -o restic.bz2 \
  https://github.com/restic/restic/releases/download/v0.19.1/restic_0.19.1_linux_amd64.bz2
bunzip2 restic.bz2
chmod +x restic
sudo mv restic /usr/local/bin/restic
restic version
```

> Verify the current download URL on the [releases page](https://github.com/restic/restic/releases); asset naming occasionally changes.

If you installed the release binary (not a distro package or Homebrew), you can self-update in place:

```bash
restic self-update
```

`self-update` replaces the binary it is running from. It will refuse or misbehave against package-manager-managed installs (Homebrew, apt, dnf) — let the package manager handle those instead. Do not `self-update` a Homebrew restic; `brew upgrade restic`.

Enable shell completion and man pages while you are here:

```bash
# bash
restic generate --bash-completion /etc/bash_completion.d/restic
# zsh (macOS default)
restic generate --zsh-completion "${fpath[1]}/_restic"
# man pages
restic generate --man /usr/local/share/man/man1
```

### Step 2 — Confirm the rclone backend works

restic's repository spec for the rclone backend is:

```
rclone:<remote>:<path>
```

Everything after `rclone:` is handed to rclone verbatim, so `rclone:nas:share/restic` means "the rclone remote `nas`, path `share/restic`." Before restic ever touches it, prove the remote works:

```bash
rclone lsd nas:share
rclone mkdir nas:share/restic
```

**How the backend actually works (this matters for every later decision):** restic does not speak SMB. When you run a restic command against `rclone:nas:share/restic`, restic starts `rclone serve restic --stdio` as a child process and talks HTTP/2 to it over the child's stdin/stdout. rclone, in turn, speaks SMB to your NAS. Consequences worth understanding now:

- **No TCP port** is opened and nothing to firewall — the transport is a pipe between two processes you own.
- **No coordination with other users** on the box; the data is visible only to the user running the two processes (and root).
- **restic manages the rclone process lifecycle** — it starts and stops rclone for you.
- **rclone reads its own config** (`rclone.conf`) as the user restic spawns it as. This becomes a real gotcha under systemd/launchd, covered in Step 8 and expanded in the [[restic-deep-dive|deep dive]].

### Step 3 — Initialize the repository

> **Destructive-adjacent warning:** `init` creates a new repository and prints a password prompt. The password you set here is the only thing standing between you and total data loss. If you lose it, the repo is unrecoverable. Store it in your password manager *before* you finish this step.

```bash
restic -r rclone:nas:share/restic init
```

You will be prompted twice for a new password. Expected output:

```
created restic repository a1b2c3d4e5 at rclone:nas:share/restic

Please note that knowledge of your password is required to access
the repository. Losing your password means that your data is
irrecoverably lost.
```

restic 0.19.x initializes **repository format version 2** by default (the format that supports compression). You do not need to pass anything special to get it. See [preparing a new repository](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html) for the full option set.

Now stop typing the password. Move it into a command restic can call. Set two environment variables so you can drop `-r` and the prompt from every command:

**macOS — store the password in Keychain, read it via `security`:**

```bash
# Store once (interactive; the password is not echoed into shell history if you use -w without an argument):
security add-generic-password -a "$USER" -s restic-nas -w

# Then, in your shell profile or a sourced env file:
export RESTIC_REPOSITORY="rclone:nas:share/restic"
export RESTIC_PASSWORD_COMMAND="security find-generic-password -a $USER -s restic-nas -w"
```

**Linux — use `pass` (or a mode-0600 file):**

```bash
# With pass:
pass insert restic/nas          # prompts for the password, stores it encrypted
export RESTIC_REPOSITORY="rclone:nas:share/restic"
export RESTIC_PASSWORD_COMMAND="pass restic/nas"

# Or a plain file, if you accept the tradeoff (readable by anything running as you):
umask 077
printf '%s' 'your-password-here' > ~/.restic-nas-pass
chmod 600 ~/.restic-nas-pass
export RESTIC_PASSWORD_FILE="$HOME/.restic-nas-pass"
```

> **Foot-gun, flagged now because it bites everyone:** `RESTIC_PASSWORD_COMMAND` uses the command's stdout *verbatim*, including a trailing newline. `echo` adds a newline; `pass` and `security ... -w` do not. If a wrapper script does `echo "$secret"`, restic sees a password with a `\n` on the end and reports the wrong password. Use `printf '%s'` (no newline) in any script that prints a password. This is covered as a full failure injection in the [[restic-deep-dive|deep dive]].

Verify the environment wiring with a cheap read:

```bash
restic cat config
```

Expected (a small JSON blob):

```json
{"version":2,"id":"a1b2c3...","chunker_polynomial":"3abc..."}
```

### Step 4 — First backup

Create an exclude file so you do not back up caches, build artifacts, and OS noise. This one works on both platforms:

```bash
cat > ~/.restic-excludes <<'EOF'
# Caches and build artifacts
**/node_modules
**/.cache
**/__pycache__
*.pyc
# VM images / large ephemeral blobs
*.vmdk
*.qcow2
*.img
# macOS noise
.DS_Store
**/Library/Caches
@eaDir
# Linux noise
/var/cache
/var/tmp
EOF
```

Now run the backup. See [backing up](https://restic.readthedocs.io/en/stable/040_backup.html) for every flag:

```bash
restic backup ~/Documents ~/Projects \
  --exclude-file ~/.restic-excludes \
  --exclude-caches \
  --exclude-if-present .nobackup \
  --one-file-system \
  --tag laptop --tag docs \
  --host "$(hostname -s)"
```

What the important flags do:

- `--exclude-file` — read exclusion patterns from your file.
- `--exclude-caches` — skip any directory containing a `CACHEDIR.TAG` file (a cross-tool standard many cache directories drop in; excluding them is nearly always right).
- `--exclude-if-present .nobackup` — skip any directory containing a marker file you place, giving you per-directory opt-out.
- `--one-file-system` — do not cross mount points; keeps a backup of `/home` from wandering into a mounted NAS or `/proc`.
- `--tag` — attach labels you can filter and retain on later.
- `--host` — set the hostname recorded in the snapshot (useful when one repo holds multiple machines).

Expected summary (numbers will differ):

```
Files:        4213 new,     0 changed,     0 unmodified
Dirs:          512 new,     0 changed,     0 unmodified
Added to the repository: 1.842 GiB (1.203 GiB stored)

processed 4213 files, 2.104 GiB in 1:47
snapshot 9f8e7d6c saved
```

Note `Added to the repository: 1.842 GiB (1.203 GiB stored)` — the second number is smaller because of compression (repo format v2).

### Step 5 — Watch deduplication happen

Run the *exact same backup again*, immediately, changing nothing:

```bash
restic backup ~/Documents ~/Projects \
  --exclude-file ~/.restic-excludes --exclude-caches \
  --one-file-system --tag laptop --tag docs --host "$(hostname -s)"
```

Expected summary:

```
Files:           0 new,     0 changed,  4213 unmodified
Dirs:            0 new,     0 changed,   512 unmodified
Added to the repository: 4.201 KiB (1.100 KiB stored)

processed 4213 files, 2.104 GiB in 0:09
snapshot 1a2b3c4d saved
```

Two gigabytes "processed," a few kilobytes "added." This is the moment restic's value lands: the second snapshot is a full, independent point-in-time backup, yet it cost almost nothing because every chunk already existed in the pool. This is what `rsync --link-dest` cannot give you at sub-file granularity.

### Step 6 — Inspect what you have

```bash
restic snapshots
```

```
ID        Time                 Host       Tags         Paths
--------------------------------------------------------------------
9f8e7d6c  2026-08-22 09:14:02  mymac      laptop,docs  /Users/you/Documents
1a2b3c4d  2026-08-22 09:15:51  mymac      laptop,docs  /Users/you/Documents
--------------------------------------------------------------------
2 snapshots
```

Group them, list a snapshot's contents, search across snapshots, and diff two:

```bash
restic snapshots --group-by host,paths,tags
restic ls 1a2b3c4d /Users/you/Documents        # list files in a snapshot
restic find "budget-2026.xlsx"                  # find a file across all snapshots
restic diff 9f8e7d6c 1a2b3c4d                   # what changed between two snapshots
```

Two `stats` modes you will use constantly — know which is which:

```bash
restic stats --mode restore-size    # what it would cost to restore (logical size)
restic stats --mode raw-data        # what the repo actually occupies (deduped+compressed)
```

`restore-size` answers "how big is the data I'd get back"; `raw-data` answers "how much storage am I actually paying for." They diverge a lot once dedup kicks in.

### Step 7 — Restore (the part people skip)

> A backup that has never been restored is a hypothesis, not a backup. Do this step for real.

Always restore to an *alternate* target first, as a matter of discipline — never straight over the live data. See [restoring](https://restic.readthedocs.io/en/stable/050_restore.html):

```bash
mkdir -p /tmp/restore-test
restic restore 1a2b3c4d --target /tmp/restore-test
```

```
restoring snapshot 1a2b3c4d of [/Users/you/Documents] at 2026-08-22 09:15:51 to /tmp/restore-test
Summary: Restored 4213 files/dirs (2.104 GiB) in 0:41
```

Restore just one path, or the most recent snapshot for a host:

```bash
restic restore 1a2b3c4d --target /tmp/restore-test --include /Users/you/Documents/budget-2026.xlsx
restic restore latest --host "$(hostname -s)" --target /tmp/restore-test
```

Extract a single file to stdout without a full restore (handy for spot checks):

```bash
restic dump 1a2b3c4d /Users/you/Documents/budget-2026.xlsx > /tmp/budget.xlsx
```

**Browsing a snapshot as a filesystem** with `restic mount` is convenient but has a prerequisite: FUSE. On Linux, FUSE is in-kernel and `restic mount /mnt/snapshots` generally just works. On macOS it requires **macFUSE**, a third-party kernel extension that needs an admin install, a reboot, and approval in Recovery mode on Apple Silicon. On a locked-down Mac where you cannot install kernel extensions, there is **no `nfsmount`-style escape hatch** as there is in rclone — use `dump`/`restore` instead of `mount`.

```bash
mkdir -p /mnt/snapshots
restic mount /mnt/snapshots      # Ctrl-C to unmount; Linux: in-kernel FUSE, Mac: needs macFUSE
```

### Step 8 — Automate it

The goal is a scheduled backup that reads its password non-interactively and alerts you *differently* for "some files couldn't be read" versus "the repository was unreachable." Full, production-grade units (with exit-code handling, `forget --prune`, and rolling `check`) are in the [[restic-deep-dive|deep dive]]; here is the minimal working version for each platform.

**Linux — systemd *user* timer.** A user unit (not a system unit) inherits your `rclone.conf` at `~/.config/rclone/` and your `pass` store naturally. Enable lingering so it runs when you are not logged in: `loginctl enable-linger "$USER"`.

`~/.config/systemd/user/restic-backup.service`:

```ini
[Unit]
Description=restic backup to NAS
OnFailure=restic-alert@%n.service

[Service]
Type=oneshot
Environment=RESTIC_REPOSITORY=rclone:nas:share/restic
Environment=RESTIC_PASSWORD_COMMAND=pass restic/nas
ExecStart=/usr/local/bin/restic backup %h/Documents %h/Projects \
  --exclude-file %h/.restic-excludes --exclude-caches \
  --one-file-system --host %H --tag scheduled
```

`~/.config/systemd/user/restic-backup.timer`:

```ini
[Unit]
Description=Daily restic backup

[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now restic-backup.timer
systemctl --user list-timers | grep restic
```

**macOS — launchd.** The classic launchd gotcha: launchd jobs run with a minimal `PATH` that does *not* include `/opt/homebrew/bin`, so restic cannot find the `rclone` binary. Fix it by setting `PATH` (and `RESTIC_*`) in the plist's `EnvironmentVariables`.

`~/Library/LaunchAgents/net.restic.backup.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>net.restic.backup</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>RESTIC_REPOSITORY</key><string>rclone:nas:share/restic</string>
    <key>RESTIC_PASSWORD_COMMAND</key>
      <string>security find-generic-password -a you -s restic-nas -w</string>
  </dict>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/restic</string>
    <string>backup</string>
    <string>/Users/you/Documents</string>
    <string>/Users/you/Projects</string>
    <string>--exclude-file</string><string>/Users/you/.restic-excludes</string>
    <string>--exclude-caches</string>
    <string>--one-file-system</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>2</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardErrorPath</key><string>/tmp/restic-backup.err</string>
  <key>StandardOutPath</key><string>/tmp/restic-backup.out</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/net.restic.backup.plist
launchctl start net.restic.backup     # run once now to test
```

## Practical Examples

**A complete "back up, prune weekly, verify continuously" mental model.** You run three things on different cadences. Back up daily; reclaim space weekly; verify a rolling slice of the data continuously so the whole repo gets checked over time without one punishing run.

```bash
# Daily: back up
restic backup ~/Documents ~/Projects --exclude-file ~/.restic-excludes \
  --exclude-caches --one-file-system --host "$(hostname -s)" --tag scheduled

# Weekly: apply retention, then reclaim space (see warning below)
restic forget --keep-daily 7 --keep-weekly 5 --keep-monthly 12 --prune

# Continuously: verify 1/10 of the pack data each run; whole repo covered in ~10 runs
restic check --read-data-subset=1/10
```

> **Destructive-command warning.** `forget` deletes snapshot references and `--prune` permanently repacks and deletes unreferenced data. Always dry-run `forget` first: `restic forget --keep-daily 7 --dry-run` shows exactly which snapshots would go. Only add `--prune` once the retention math looks right.

**Checking a repository is initialized before a script tries to init it** (uses exit code 10, which restic returns since 0.17.0 when a repo does not exist):

```bash
if restic cat config >/dev/null 2>&1; then
  echo "repo exists"
else
  echo "repo missing (or unreachable) — investigate before init"
fi
```

**Passing rclone tuning flags through restic.** On a chatty SMB link you may want to cap bandwidth or raise parallelism. restic exposes rclone options via `-o`:

```bash
restic -o rclone.args="serve restic --stdio --b2-hard-delete --transfers=8 --bwlimit=20M" \
  backup ~/Documents
```

> **Verified against restic 0.19.1 source:** the default `rclone.args` is `serve restic --stdio --b2-hard-delete`. Overriding `rclone.args` **replaces** the default list — it does not append — so you must reproduce `serve restic --stdio --b2-hard-delete` and add your flags after it, exactly as above. Drop `serve restic --stdio` and the backend breaks. The deep dive treats this and `-o rclone.program` in full.

## Hands-On Exercises

1. **Prove the "not a mirror" claim to yourself.** After your first backup, run `rclone ls nas:share/restic | head` and try to find one of your actual filenames in the output. You will not. Then run `restic ls latest | head` and see your real paths. Write down, in one sentence, why the destination listing is useless without restic.

2. **Force a deduplication win.** Copy a large file, append one line to the copy (`cp big.log big2.log && echo "one more line" >> big2.log`), back up the directory containing both, and read the summary. Confirm that "Added to the repository" is far smaller than the size of `big2.log` — because only the changed chunk was stored.

3. **Do a real restore drill.** Restore `latest` to `/tmp/drill`, pick one file, and compare checksums against the live copy: `shasum ~/Documents/somefile` vs `shasum /tmp/drill/Users/you/Documents/somefile` (use `sha256sum` on Linux). They must match. This is the exercise that turns a hypothesis into a backup.

4. **Break and fix your password command.** Temporarily set `RESTIC_PASSWORD_COMMAND="echo $(pass restic/nas)"` (note: `echo` adds a newline) and run `restic snapshots`. Observe the wrong-password error. Switch back to `pass restic/nas` (or `printf '%s'`) and confirm it works. You have now met the single most common restic automation bug.

5. **Set up and trigger the scheduled job.** Install the systemd user timer or launchd plist above, run it once manually, and confirm a new snapshot appears in `restic snapshots`. Then check the exit code (`echo $?` on Linux after a manual `systemctl --user start`, or the log files on macOS).

## Troubleshooting

**"repository does not exist" / exit code 10.** Either the repo really is not initialized, or restic could not reach it. Distinguish the two by testing rclone directly: `rclone lsd nas:share/restic`. If rclone fails, it is a connectivity/config problem (see [[rclone-deep-dive|rclone Deep Dive]]), not a restic problem.

**Wrong password on a job that works interactively.** Almost always a trailing newline from `RESTIC_PASSWORD_COMMAND`, or the command running under a different environment (systemd/launchd) that cannot reach your Keychain/`pass` store. Test the command in isolation: `eval "$RESTIC_PASSWORD_COMMAND" | xxd | tail` and check for a stray `0a` byte at the end.

**"unable to create lock" / "repository is already locked."** A previous run crashed and left a stale lock. First make sure nothing is actually running (`ps aux | grep restic`), then clear it:

```bash
restic unlock
```

Do not reach for `--no-lock`; it disables the safety that prevents two operations from corrupting each other. The [[restic-deep-dive|deep dive]] covers stale locks and concurrent-run hangs (a real failure mode with the rclone backend) as dedicated failure injections.

**launchd job can't find rclone.** The launchd `PATH` does not include `/opt/homebrew/bin`. Set `PATH` in the plist's `EnvironmentVariables`, as shown in Step 8.

**Backups are slow over SMB.** Expected. SMB-over-rclone is chatty and the first backup is dominated by upload. `check` and especially `prune` will be slow against a high-latency target. The deep dive's tuning section (`--pack-size`, rclone `--transfers`) helps, but set expectations honestly: this backend trades speed for using storage you already have.

**Cache warnings or a huge cache.** The cache is safe to delete and restic rebuilds it: `restic cache --cleanup`. On read-only media, pass `--no-cache`.

## References

- [restic user manual](https://restic.readthedocs.io/en/stable/) — the canonical documentation (0.19.1)
- [Preparing a new repository](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html) — backends including rclone, repo format
- [Backing up](https://restic.readthedocs.io/en/stable/040_backup.html) — the `backup` command and exclude handling
- [Restoring from backup](https://restic.readthedocs.io/en/stable/050_restore.html) — `restore`, `dump`, `mount`
- [Removing backup snapshots](https://restic.readthedocs.io/en/stable/060_forget.html) — `forget` vs `prune`
- [Scripting / exit codes](https://restic.readthedocs.io/en/stable/075_scripting.html) — environment variables and the exit-code table
- [Using rclone as a restic backend](https://restic.net/blog/2018-04-01/rclone-backend/) — the design rationale for the `serve restic --stdio` mechanism
- [restic 0.19.1 release notes](https://restic.net/blog/2026-07-05/restic-0.19.1-released/) — the version this guide targets

## Related Tutorials

- [[rclone-beginner-guide|rclone Beginner's Guide]] — the remote model, `remote:path` addressing, and the SMB backend restic chains through
- [[rclone-deep-dive|rclone Deep Dive]] — `crypt`, `serve`, tuning flags, and diagnosing the SMB layer beneath restic
- [[ssh-config-deep-dive|SSH Config Deep Dive]] — host aliases and jump hosts, relevant if you ever use restic's SFTP backend instead of rclone
- [[linux-permissions-beginner-guide|Linux Permissions]] — mode-0600 password files and why the local cache and restore targets need careful ownership
- [[chezmoi-deep-dive|Chezmoi Deep Dive]] — templating and secret handling to distribute `rclone.conf` and restic env files across machines
- [[restic-deep-dive|restic Deep Dive]] — internals, SMB tuning, automation with exit-code handling, append-only/ransomware resistance, repair, and the restic-vs-borg-vs-kopia verdict

## Summary

restic gives you encrypted, deduplicated, snapshot-based backups from a single binary, with no server and no central catalog. The one idea that governs everything is that the repository is an opaque, encrypted, content-addressed object store — not a mirror — so you interact with it only through restic and the key. You installed restic on Mac and Linux, initialized a repo on an SMB NAS reached through rclone's `serve restic --stdio` child process, took snapshots and watched deduplication make the second one nearly free, restored to an alternate target, and scheduled automated backups with a non-interactive password command.

Two habits carry the most weight: keep `forget` (removes pointers) and `prune` (reclaims space) firmly distinct, and treat an unrestored backup as unproven — run restore drills. When you are ready for internals, tuning the chatty SMB path, ransomware-resistant designs, repository repair, and choosing restic over borg or kopia, continue to the [[restic-deep-dive|restic Deep Dive]].
