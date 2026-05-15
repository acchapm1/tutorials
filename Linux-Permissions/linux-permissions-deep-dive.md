---
title: "Linux Permissions: Deep Dive Reference"
date: 2026-04-10
difficulty: advanced
tags: [linux, permissions, file-system, security, chmod, chown, acl, setuid, setgid, sticky-bit, umask, capabilities]
---

# Linux Permissions: Deep Dive Reference

## 1. Overview

Linux permissions are the primary mechanism the kernel uses to enforce access control on the filesystem. Built on the traditional UNIX Discretionary Access Control (DAC) model, the permission system governs every interaction between processes and files — from reading configuration files to executing binaries and traversing directory trees.

This reference goes beyond the basics of `chmod` and `chown` to cover the complete permissions landscape: special permission bits (setuid, setgid, sticky), the `umask` mechanism, Access Control Lists (ACLs), file attributes, Linux capabilities, and how permissions interact with modern security frameworks like SELinux and AppArmor. It is designed as a reference you can return to as questions arise in real-world system administration, development, and security hardening work.

For a gentler introduction, see the [Linux Permissions Beginner Guide](./linux-permissions-beginner-guide.md).

---

## 2. Prerequisites

- Comfortable with the Linux command line (shell navigation, piping, redirection)
- Familiarity with basic permission concepts (read/write/execute, user/group/other, `chmod`, `chown`) — covered in the beginner guide
- A Linux system with `sudo` access for testing advanced features
- Packages for ACL exercises: `acl` (install via `sudo apt install acl` on Debian/Ubuntu or `sudo dnf install acl` on Fedora)
- Basic understanding of processes, UIDs, and GIDs

---

## 3. Key Concepts

### 3.1 How the Kernel Evaluates Permissions

When a process attempts to access a file, the kernel checks in this order:

1. **Is the process running as root (UID 0)?** → If yes, most permission checks are bypassed (with some exceptions for execute).
2. **Does the process's effective UID match the file's owner UID?** → If yes, the **user** permission bits apply. The check stops here — group and other bits are not consulted.
3. **Does the process's effective GID (or any supplementary GID) match the file's group GID?** → If yes, the **group** bits apply. Again, the check stops.
4. **Otherwise** → The **other** bits apply.

This means a file owner who has fewer permissions than the group will be *denied* access even though group members are allowed. The kernel does not union the permission sets.

### 3.2 Inodes and Permission Storage

Permissions are stored in the file's **inode**, not in the directory entry. The inode contains:

- `st_mode` — a 16-bit field encoding file type and permission bits
- `st_uid` — owner's user ID
- `st_gid` — group ID

You can inspect the raw inode data with `stat`:

```bash
stat myfile.txt
```

Expected output (relevant fields):

```
  File: myfile.txt
  Size: 1024       Blocks: 8          IO Block: 4096   regular file
Access: (0644/-rw-r--r--)  Uid: ( 1000/   alan)   Gid: ( 1000/   alan)
Access: 2026-04-10 08:00:00.000000000 -0500
Modify: 2026-04-10 08:00:00.000000000 -0500
Change: 2026-04-10 08:00:00.000000000 -0500
```

The `st_mode` field `0644` is the octal representation. The leading `0` indicates the special permission bits (setuid/setgid/sticky) are all unset.

### 3.3 The Full 12-Bit Permission Model

The permission mode is actually 12 bits, not 9:

```
Special   User    Group   Other
 s s t    r w x   r w x   r w x
 │ │ │
 │ │ └── Sticky bit    (octal 1000)
 │ └──── Setgid bit    (octal 2000)
 └────── Setuid bit    (octal 4000)
```

Octal notation therefore has four digits: `4755` means setuid + rwxr-xr-x.

### 3.4 Directory Permissions Deep Dive

Permissions on directories behave differently from files:

| Permission | Effect on directory |
|-----------|-------------------|
| `r` (read) | List the names of entries inside (via `readdir`). Without `x`, you can see names but not metadata. |
| `w` (write) | Create, rename, or delete entries inside the directory. Requires `x` as well. |
| `x` (execute) | Traverse (enter) the directory. Required to `stat` any file inside, even if you know the name. |

A directory with `r--` lets you list file names but not access any file's contents or metadata. A directory with `--x` lets you access files by name if you already know them, but you cannot list the directory.

---

## 4. Step-by-Step Instructions

### 4.1 Understanding and Setting the umask

The `umask` determines the default permissions for newly created files and directories by *masking out* (removing) bits.

**How it works:**

- The base permissions for new files are `0666` (rw-rw-rw-).
- The base permissions for new directories are `0777` (rwxrwxrwx).
- The umask is subtracted: `result = base & ~umask`.

Check your current umask:

```bash
umask
```

Expected output:

```
0022
```

This means new files get `0644` (0666 & ~0022) and new directories get `0755` (0777 & ~0022).

To change the umask for the current session:

```bash
umask 0077
touch private-file.txt
mkdir private-dir
ls -la private-file.txt private-dir
```

Expected output:

```
-rw------- 1 alan alan    0 Apr 10 10:00 private-file.txt
drwx------ 2 alan alan 4096 Apr 10 10:00 private-dir
```

To make it permanent, add `umask 0077` to your `~/.bashrc` or `~/.profile`.

### 4.2 Setuid Bit

When the **setuid** bit is set on an executable binary, the process runs with the **effective UID of the file's owner** instead of the calling user. This is how ordinary users can change their passwords — `/usr/bin/passwd` is owned by root with setuid set.

```bash
ls -l /usr/bin/passwd
```

Expected output:

```
-rwsr-xr-x 1 root root 68208 Apr  1 12:00 /usr/bin/passwd
```

The `s` in the user execute position indicates setuid is active.

Setting setuid:

```bash
sudo chmod u+s /usr/local/bin/myapp
# Or numerically:
sudo chmod 4755 /usr/local/bin/myapp
```

**Security warning:** Setuid binaries are a major attack surface. A vulnerability in a setuid-root binary gives an attacker root access. Audit setuid files regularly:

```bash
find / -perm -4000 -type f 2>/dev/null
```

**Important:** Setuid on shell scripts is ignored by most modern Linux kernels for security reasons. It only works on compiled binaries.

### 4.3 Setgid Bit

The **setgid** bit has two different behaviors:

**On an executable:** The process runs with the effective GID of the file's group (analogous to setuid for groups).

**On a directory:** New files and subdirectories created inside inherit the directory's group instead of the creator's primary group. This is extremely useful for shared project directories.

```bash
sudo mkdir /opt/team-project
sudo chown :devteam /opt/team-project
sudo chmod 2775 /opt/team-project
ls -ld /opt/team-project
```

Expected output:

```
drwxrwsr-x 2 root devteam 4096 Apr 10 10:30 /opt/team-project
```

The `s` in the group execute position indicates setgid. Now any file created inside will belong to the `devteam` group:

```bash
touch /opt/team-project/notes.txt
ls -l /opt/team-project/notes.txt
```

Expected output:

```
-rw-rw-r-- 1 alan devteam 0 Apr 10 10:31 notes.txt
```

### 4.4 Sticky Bit

The **sticky bit** on a directory restricts deletion: only the file's owner, the directory's owner, or root can delete or rename files within the directory. The classic example is `/tmp`:

```bash
ls -ld /tmp
```

Expected output:

```
drwxrwxrwt 15 root root 4096 Apr 10 08:00 /tmp
```

The `t` in the other execute position indicates the sticky bit. Without it, any user with write access to `/tmp` could delete anyone else's files.

Setting the sticky bit:

```bash
sudo chmod +t /opt/shared-drop
# Or numerically:
sudo chmod 1777 /opt/shared-drop
```

### 4.5 Access Control Lists (ACLs)

Standard UNIX permissions only support one owner and one group. ACLs extend this to allow fine-grained per-user and per-group permissions.

**Check if ACLs are supported** (most modern Linux filesystems support them by default):

```bash
mount | grep -E 'ext4|xfs|btrfs'
```

**View ACLs:**

```bash
getfacl myfile.txt
```

Expected output (no ACL set):

```
# file: myfile.txt
# owner: alan
# group: alan
user::rw-
group::r--
other::r--
```

**Grant a specific user read/write access:**

```bash
setfacl -m u:bob:rw myfile.txt
getfacl myfile.txt
```

Expected output:

```
# file: myfile.txt
# owner: alan
# group: alan
user::rw-
user:bob:rw-
group::r--
mask::rw-
other::r--
```

Notice the `mask` entry — it acts as an upper bound for all ACL entries (except the owner). If the mask is `r--`, then even though bob has `rw-` in his ACL entry, his effective permissions are limited to `r--`.

**Grant a group access:**

```bash
setfacl -m g:qa-team:rx myfile.txt
```

**Set default ACLs on a directory** (inherited by new files):

```bash
setfacl -d -m u:bob:rwx /opt/team-project
setfacl -d -m g:qa-team:rx /opt/team-project
```

**Remove an ACL entry:**

```bash
setfacl -x u:bob myfile.txt
```

**Remove all ACLs:**

```bash
setfacl -b myfile.txt
```

When ACLs are present, `ls -l` shows a `+` after the permission string:

```
-rw-rw-r--+ 1 alan alan 1024 Apr 10 08:00 myfile.txt
```

### 4.6 File Attributes (chattr/lsattr)

Beyond permissions, Linux ext-family filesystems support **file attributes** that override normal permission behavior:

```bash
# Make a file immutable (cannot be modified, deleted, or renamed — even by root)
sudo chattr +i important-config.conf
lsattr important-config.conf
```

Expected output:

```
----i---------e------- important-config.conf
```

Common attributes:

| Attribute | Flag | Effect |
|-----------|------|--------|
| Immutable | `i` | No modifications, deletions, or renames (even by root) |
| Append-only | `a` | Can only append data; cannot overwrite or delete |
| No dump | `d` | Excluded from `dump` backups |
| Secure deletion | `s` | Blocks zeroed on deletion (filesystem-dependent) |

Remove the immutable attribute:

```bash
sudo chattr -i important-config.conf
```

### 4.7 Linux Capabilities

Traditional UNIX has a binary privilege model: you are either root (all-powerful) or a normal user. **Linux capabilities** break root's powers into discrete units that can be assigned individually to executables.

List capabilities on a file:

```bash
getcap /usr/bin/ping
```

Expected output:

```
/usr/bin/ping cap_net_raw=ep
```

This means `ping` can open raw network sockets without needing to be setuid-root.

Common capabilities:

| Capability | What it grants |
|-----------|---------------|
| `CAP_NET_BIND_SERVICE` | Bind to ports below 1024 |
| `CAP_NET_RAW` | Use raw sockets (ping, packet capture) |
| `CAP_DAC_OVERRIDE` | Bypass file read/write/execute permission checks |
| `CAP_CHOWN` | Change file ownership |
| `CAP_SYS_ADMIN` | Broad administrative operations (mount, sethostname, etc.) |

Assign a capability:

```bash
sudo setcap cap_net_bind_service=+ep /usr/local/bin/mywebserver
```

Remove all capabilities:

```bash
sudo setcap -r /usr/local/bin/mywebserver
```

**Why this matters:** Capabilities are the modern replacement for setuid-root. They follow the principle of least privilege — a web server that needs to bind port 80 does not need full root access.

---

## 5. Practical Examples

### Example 1 — Secure Shared Directory with Setgid and ACLs

A project directory where the `backend` team has full access, the `qa` team has read-only access, and new files automatically inherit these permissions:

```bash
# Create and configure the directory
sudo mkdir -p /opt/projects/api
sudo chown :backend /opt/projects/api
sudo chmod 2770 /opt/projects/api

# Set default ACLs
sudo setfacl -d -m g:backend:rwx /opt/projects/api
sudo setfacl -d -m g:qa:rx /opt/projects/api
sudo setfacl -m g:qa:rx /opt/projects/api

# Verify
getfacl /opt/projects/api
```

Expected output:

```
# file: opt/projects/api
# owner: root
# group: backend
# flags: -s-
user::rwx
group::rwx
group:qa:r-x
mask::rwx
other::---
default:user::rwx
default:group::rwx
default:group:qa:r-x
default:mask::rwx
default:other::---
```

### Example 2 — Hardening a Web Application Deployment

```bash
# Application code: owned by deploy user, readable by web server
sudo chown -R deploy:www-data /var/www/app
sudo find /var/www/app -type d -exec chmod 2750 {} \;
sudo find /var/www/app -type f -exec chmod 640 {} \;

# Upload directory: web server needs write access
sudo chmod 2770 /var/www/app/uploads
sudo setfacl -d -m u:www-data:rwx /var/www/app/uploads

# Config files: extra restrictive
sudo chmod 600 /var/www/app/.env
sudo chown deploy:deploy /var/www/app/.env

# Log directory: append-only for integrity
sudo chattr +a /var/www/app/logs/*.log
```

### Example 3 — Auditing Permissions

Find all setuid and setgid executables on the system:

```bash
find / -type f \( -perm -4000 -o -perm -2000 \) -exec ls -la {} \; 2>/dev/null
```

Find world-writable files (potential security risk):

```bash
find / -type f -perm -0002 -not -path "/proc/*" -not -path "/sys/*" 2>/dev/null
```

Find files with no owner (orphaned after user deletion):

```bash
find / -nouser -o -nogroup 2>/dev/null
```

### Example 4 — Using Capabilities Instead of Setuid

Replace a setuid-root binary with capabilities:

```bash
# Remove setuid
sudo chmod u-s /usr/local/bin/mynetworktool

# Grant only the needed capability
sudo setcap cap_net_raw=ep /usr/local/bin/mynetworktool

# Verify
getcap /usr/local/bin/mynetworktool
ls -l /usr/local/bin/mynetworktool
```

Expected output:

```
/usr/local/bin/mynetworktool cap_net_raw=ep
-rwxr-xr-x 1 root root 45056 Apr 10 11:00 /usr/local/bin/mynetworktool
```

---

## 6. Hands-On Exercises

### Exercise 1 — umask Experimentation

1. Note your current umask with `umask`.
2. Set `umask 0077`, create a file and a directory. Verify their permissions.
3. Set `umask 0000`, create a file and a directory. Verify their permissions.
4. Restore your original umask.
5. Explain why files created with `umask 0000` are `0666` and not `0777`.

### Exercise 2 — Setgid Shared Directory

1. Create a group called `labteam` and add your user to it.
2. Create `/opt/labshare` owned by root with group `labteam`.
3. Set permissions to `2775`.
4. Create files inside as your user. Verify they belong to the `labteam` group.
5. Log in as a different user in `labteam` and confirm they can modify the files.

### Exercise 3 — ACL Challenge

1. Create a file `confidential.txt` owned by you with permissions `600`.
2. Using ACLs, grant user `auditor` read-only access without changing the base permissions.
3. Grant group `management` read-write access.
4. Verify with `getfacl`.
5. Remove the ACL for `auditor` and verify it is gone.

### Exercise 4 — Permission Forensics

1. Run `find /etc -maxdepth 1 -type f -perm -0002 2>/dev/null` — are there any world-writable config files?
2. Run `find /usr -perm -4000 -type f 2>/dev/null` — list all setuid binaries and determine why each needs setuid.
3. Pick one setuid binary and determine if it could be replaced with a capability.

### Exercise 5 — Immutable File Protection

1. Create a file `protected.conf` with some content.
2. Set the immutable attribute.
3. Try to edit, delete, and rename the file (even with `sudo`). Observe the errors.
4. Remove the immutable attribute and confirm normal operations work again.

---

## 7. Troubleshooting

### ACLs seem to have no effect

**Cause:** The filesystem may not be mounted with ACL support.
**Diagnosis:** `mount | grep <mountpoint>` — look for `acl` in the options.
**Fix:** Remount with ACL support: `sudo mount -o remount,acl /dev/sdX /mountpoint` or add `acl` to the options in `/etc/fstab`.

### Setuid bit disappears after `chmod`

**Cause:** When you set permissions numerically without including the special bits, they are cleared. `chmod 755 file` clears setuid/setgid.
**Fix:** Always include the leading digit: `chmod 4755 file` preserves setuid.

### ACL mask is limiting effective permissions

**Cause:** The ACL mask acts as an upper bound. If you run `chmod g=r file`, it also sets the mask to `r--`, limiting all ACL entries.
**Fix:** Set the mask explicitly: `setfacl -m m::rwx file`.

### `chattr` says "Operation not supported"

**Cause:** The filesystem does not support extended attributes (e.g., FAT32, some network filesystems).
**Fix:** Use a supported filesystem (ext4, XFS, Btrfs).

### Capability not working after file modification

**Cause:** Security feature — capabilities are cleared when a file is written to, to prevent modified binaries from retaining elevated privileges.
**Fix:** Re-apply capabilities with `setcap` after modifying the binary.

### Process has unexpected permissions despite correct file permissions

**Cause:** SELinux or AppArmor may be enforcing additional restrictions beyond DAC.
**Diagnosis:**

```bash
# For SELinux:
getenforce
ausearch -m avc -ts recent

# For AppArmor:
aa-status
journalctl | grep apparmor
```

**Fix:** Adjust the SELinux policy or AppArmor profile, or set SELinux to permissive mode for debugging (`sudo setenforce 0`).

---

## 8. References

- [chmod(1) man page](https://man7.org/linux/man-pages/man1/chmod.1.html)
- [chown(1) man page](https://man7.org/linux/man-pages/man1/chown.1.html)
- [setfacl(1) man page](https://man7.org/linux/man-pages/man1/setfacl.1.html)
- [getfacl(1) man page](https://man7.org/linux/man-pages/man1/getfacl.1.html)
- [capabilities(7) man page](https://man7.org/linux/man-pages/man7/capabilities.7.html)
- [chattr(1) man page](https://man7.org/linux/man-pages/man1/chattr.1.html)
- [ArchWiki — File permissions and attributes](https://wiki.archlinux.org/title/File_permissions_and_attributes)
- [ArchWiki — Access Control Lists](https://wiki.archlinux.org/title/Access_Control_Lists)
- [Red Hat — SELinux User's and Administrator's Guide](https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/8/html/using_selinux/)
- [Linux Kernel Documentation — Capabilities](https://www.kernel.org/doc/html/latest/userspace-api/capabilities.html)

---

## 9. Summary

**Key takeaways:**

- The kernel evaluates permissions in a strict order: owner → group → other, with no fallthrough between categories.
- Permissions are stored in the inode's 12-bit `st_mode` field — 3 bits for special permissions (setuid, setgid, sticky) plus 9 for the standard rwx triplets.
- The **umask** controls default permissions for new files and directories by masking out bits from the base mode.
- **Setuid** and **setgid** on executables change the effective UID/GID of the running process. **Setgid on directories** forces group inheritance — essential for shared workspaces.
- The **sticky bit** on directories restricts deletion to the file owner, directory owner, or root.
- **ACLs** extend the user/group/other model to support arbitrary per-user and per-group permissions, with a mask that acts as an upper bound.
- **File attributes** (`chattr`) provide controls like immutability that override even root's normal abilities.
- **Linux capabilities** decompose root's monolithic privileges into granular units, enabling least-privilege security design.
- Modern systems layer **SELinux** or **AppArmor** (Mandatory Access Control) on top of DAC for defense in depth.

**Next steps:**

- Explore SELinux contexts and policy modules for production server hardening.
- Study `namespaces` and `cgroups` to understand how containers interact with the permission model.
- Review your system's setuid binaries and evaluate which can be migrated to capabilities.
- Set up automated permission auditing with tools like `aide` or `osquery`.

---

## Related Tutorials

- [[linux-permissions-beginner-guide|Linux Permissions: Beginner Guide]]
- [[apache-nifi-hpc-sysadmin-deep-dive|Apache NiFi HPC Sysadmin — Deep Dive]] — file permissions for NiFi data flows and HPC storage
- [[kubernetes-deep-dive|Kubernetes — Deep Dive]] — RBAC, security contexts, and Pod security standards
- [[isaaclab-metagrasp-apptainer-hpc-deep-dive|IsaacLab MetaGrasp on HPC — Deep Dive]] — container permissions on HPC clusters
# Related Tutorials

- [[just-deep-dive|Just Deep Dive]] — Automate permission management and server maintenance with just recipes

- [[micropython-ttgo-t-display-beginner-guide|MicroPython TTGO T-Display Beginner Guide]] — practical serial device access on macOS
- [[micropython-ttgo-t-display-deep-dive|MicroPython TTGO T-Display Deep Dive]] — udev rules and device permissions for embedded development
