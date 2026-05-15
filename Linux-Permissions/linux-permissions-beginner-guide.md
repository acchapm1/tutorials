---
title: "Linux Permissions: A Beginner's Guide"
date: 2026-04-10
difficulty: beginner
tags: [linux, permissions, file-system, security, chmod, chown]
---

# Linux Permissions: A Beginner's Guide

## 1. Overview

Every file and directory on a Linux system has a set of **permissions** that control who can read, write, or execute it. Understanding permissions is one of the most important fundamentals of working with Linux — it keeps your system secure, prevents accidental data loss, and is essential knowledge for anyone administering servers or developing software.

In this guide you will learn:

- How Linux decides who can access a file
- How to read and interpret permission strings like `drwxr-xr-x`
- How to change permissions with `chmod`, ownership with `chown`, and group with `chgrp`
- Practical, everyday scenarios where permissions matter

No prior Linux experience beyond basic command-line navigation (`cd`, `ls`, `cat`) is assumed.

---

## 2. Prerequisites

Before starting, make sure you have:

- **A Linux environment** — any distribution works (Ubuntu, Fedora, Debian, etc.). A virtual machine, WSL on Windows, or a cloud instance are all fine.
- **Terminal access** — you should be able to open a terminal and type commands.
- **A regular user account and access to `sudo`** — some commands require elevated privileges.
- **Basic command-line familiarity** — you know how to run `ls`, `cd`, `mkdir`, and `cat`.

---

## 3. Key Concepts

### Users, Groups, and Others

Linux organises access around three categories:

| Category | Meaning |
|----------|---------|
| **User (u)** | The owner of the file. Usually the person who created it. |
| **Group (g)** | A named collection of users. Every file belongs to one group. |
| **Others (o)** | Everyone else on the system who is not the owner and not in the file's group. |

### The Three Permission Types

Each category can be granted three kinds of access:

| Symbol | Permission | On a file | On a directory |
|--------|-----------|-----------|----------------|
| `r` | Read | View file contents | List directory contents |
| `w` | Write | Modify file contents | Create/delete files inside |
| `x` | Execute | Run the file as a program | Enter (`cd` into) the directory |

### The Permission String

When you run `ls -l`, you see something like:

```bash
ls -l myfile.txt
```

Expected output:

```
-rw-r--r-- 1 alan developers 1024 Apr 10 08:00 myfile.txt
```

The first 10 characters break down as:

```
-  rw-  r--  r--
│  │    │    │
│  │    │    └── Others: read only
│  │    └─────── Group: read only
│  └──────────── User/Owner: read + write
└─────────────── File type (- = regular file, d = directory, l = symlink)
```

### Octal (Numeric) Notation

Each permission has a numeric value:

| Permission | Value |
|-----------|-------|
| Read (r) | 4 |
| Write (w) | 2 |
| Execute (x) | 1 |
| None (-) | 0 |

You add them together for each category. For example, `rw-r--r--` becomes:

- User: r(4) + w(2) + -(0) = **6**
- Group: r(4) + -(0) + -(0) = **4**
- Others: r(4) + -(0) + -(0) = **4**

Result: **644**

---

## 4. Step-by-Step Instructions

### Step 1 — View Current Permissions

Use `ls -l` to see permissions on files, or `ls -ld` for directories:

```bash
ls -l /home/alan/
```

Expected output:

```
total 12
drwxr-xr-x 2 alan alan 4096 Apr  9 10:00 Documents
-rw-r--r-- 1 alan alan  220 Apr  1 12:00 .bashrc
-rwxr-xr-x 1 alan alan  512 Apr  8 14:30 backup.sh
```

**Why this matters:** Before changing anything, always check the current state so you know what you are working with.

### Step 2 — Change Permissions with `chmod` (Symbolic Mode)

Symbolic mode uses letters and operators:

- **Who:** `u` (user), `g` (group), `o` (others), `a` (all)
- **Operator:** `+` (add), `-` (remove), `=` (set exactly)
- **Permission:** `r`, `w`, `x`

Give the group write permission on a file:

```bash
chmod g+w myfile.txt
ls -l myfile.txt
```

Expected output:

```
-rw-rw-r-- 1 alan developers 1024 Apr 10 08:00 myfile.txt
```

**Why this matters:** Symbolic mode is intuitive — you say exactly what you want to add or remove without recalculating numbers.

### Step 3 — Change Permissions with `chmod` (Numeric Mode)

Set permissions to `rwxr-xr--` (user: all, group: read+execute, others: read):

```bash
chmod 754 myfile.txt
ls -l myfile.txt
```

Expected output:

```
-rwxr-xr-- 1 alan developers 1024 Apr 10 08:00 myfile.txt
```

**Why this matters:** Numeric mode sets all three categories at once and is widely used in documentation, deployment scripts, and configuration management.

### Step 4 — Change File Ownership with `chown`

Transfer ownership of a file to a different user and group:

```bash
sudo chown bob:staff myfile.txt
ls -l myfile.txt
```

Expected output:

```
-rwxr-xr-- 1 bob staff 1024 Apr 10 08:00 myfile.txt
```

**Why this matters:** When you deploy files to a web server or set up shared project directories, the owner and group determine who the `u` and `g` permissions apply to.

### Step 5 — Change Group Only with `chgrp`

```bash
sudo chgrp www-data myfile.txt
ls -l myfile.txt
```

Expected output:

```
-rwxr-xr-- 1 bob www-data 1024 Apr 10 08:00 myfile.txt
```

### Step 6 — Apply Permissions Recursively

To change permissions on a directory and everything inside it:

```bash
chmod -R 755 /home/alan/project/
```

**Why this matters:** Recursive operations save time when you need to fix permissions on an entire directory tree (common after extracting an archive or cloning a repository).

---

## 5. Practical Examples

### Example 1 — Making a Script Executable

You write a bash script but get "Permission denied" when you try to run it:

```bash
echo '#!/bin/bash' > hello.sh
echo 'echo "Hello, world!"' >> hello.sh
./hello.sh
```

Output:

```
bash: ./hello.sh: Permission denied
```

Fix it:

```bash
chmod u+x hello.sh
./hello.sh
```

Output:

```
Hello, world!
```

### Example 2 — Protecting a Private File

You have a file with sensitive data that only you should read:

```bash
chmod 600 secrets.txt
ls -l secrets.txt
```

Output:

```
-rw------- 1 alan alan 256 Apr 10 09:00 secrets.txt
```

Now only the owner can read or write the file. No one else can even see its contents.

### Example 3 — Setting Up a Shared Team Directory

Create a directory where everyone in the `devteam` group can add and edit files:

```bash
sudo mkdir /opt/shared-project
sudo chown alan:devteam /opt/shared-project
sudo chmod 775 /opt/shared-project
ls -ld /opt/shared-project
```

Output:

```
drwxrwxr-x 2 alan devteam 4096 Apr 10 09:30 /opt/shared-project
```

### Example 4 — Web Server Document Root

A common pattern for serving files with Apache or Nginx:

```bash
sudo chown -R www-data:www-data /var/www/html
sudo chmod -R 755 /var/www/html
sudo chmod -R 644 /var/www/html/*.html
```

This lets the web server user own the files, everyone can read/traverse, but only the owner can modify.

---

## 6. Hands-On Exercises

### Exercise 1 — Read the Permission String

Run `ls -l /etc/passwd` and answer:

1. Who is the owner?
2. What permissions does the group have?
3. Can "others" write to this file?

### Exercise 2 — Create and Protect

1. Create a file called `diary.txt` with some text inside.
2. Set its permissions so only you can read and write it.
3. Verify with `ls -l`.
4. Try accessing it from a different user account (use `sudo -u nobody cat diary.txt`) and confirm it is denied.

### Exercise 3 — Symbolic vs. Numeric

1. Create a file called `practice.txt`.
2. Using **symbolic** mode, give the group read and write permissions.
3. Using **numeric** mode, set permissions to `750`.
4. Verify each change with `ls -l`.

### Exercise 4 — Script Permissions

1. Create a script file `greet.sh` containing `#!/bin/bash` and `echo "Hi there!"`.
2. Try to run it — it should fail.
3. Add execute permission for the owner only.
4. Run it again and confirm it works.

---

## 7. Troubleshooting

### "Permission denied" when running a script

**Cause:** The file lacks execute (`x`) permission for your user.
**Fix:** `chmod u+x script.sh`

### "Operation not permitted" when using `chown`

**Cause:** Only `root` (or `sudo`) can change file ownership.
**Fix:** Prefix the command with `sudo`.

### Changed permissions recursively and now things are broken

**Cause:** Using `chmod -R 777` or similar on system directories wipes out security.
**Fix:** Restore the correct permissions. For common directories:

```bash
sudo chmod 755 /home/youruser
sudo chmod 644 /home/youruser/.bashrc
```

If the damage is extensive, you may need to reinstall packages or restore from backup.

### A directory is readable but you cannot `cd` into it

**Cause:** The directory lacks execute (`x`) permission. Execute on a directory means "enter/traverse."
**Fix:** `chmod u+x /path/to/directory`

### Files created in a shared directory are owned by the wrong group

**Cause:** New files inherit the creating user's primary group by default.
**Fix:** Set the **setgid** bit on the directory so new files inherit the directory's group:

```bash
chmod g+s /opt/shared-project
```

---

## 8. References

- [Linux man page for chmod](https://man7.org/linux/man-pages/man1/chmod.1.html)
- [Linux man page for chown](https://man7.org/linux/man-pages/man1/chown.1.html)
- [Ubuntu Community — File Permissions](https://help.ubuntu.com/community/FilePermissions)
- [The Linux Documentation Project — Permissions](https://tldp.org/LDP/intro-linux/html/sect_03_04.html)
- [ArchWiki — File permissions and attributes](https://wiki.archlinux.org/title/File_permissions_and_attributes)

---

## 9. Summary

**Key takeaways:**

- Every file and directory has an **owner**, a **group**, and permissions for **others**.
- Permissions are **read (r/4)**, **write (w/2)**, and **execute (x/1)**.
- Use `ls -l` to view permissions, `chmod` to change them, `chown` to change ownership, and `chgrp` to change the group.
- Symbolic mode (`chmod g+w file`) is readable; numeric mode (`chmod 664 file`) is concise.
- Always check permissions before and after changes.

**Next steps:**

- Learn about **special permissions** (setuid, setgid, sticky bit) in the [[linux-permissions-deep-dive|Linux Permissions Deep Dive]].
- Explore **Access Control Lists (ACLs)** for more fine-grained control beyond the basic user/group/other model.
- Practice on a test system before modifying permissions on production servers.

---

## Related Tutorials

- [[linux-permissions-deep-dive|Linux Permissions: Deep Dive Reference]]
- [[apache-nifi-hpc-sysadmin-beginner-guide|Apache NiFi HPC Sysadmin — Beginner Guide]] — file permissions matter for NiFi data flows
- [[kubernetes-beginner-guide|Kubernetes — Beginner Guide]] — container security contexts build on Linux permissions
- [[isaaclab-metagrasp-apptainer-hpc-beginner-guide|IsaacLab MetaGrasp on HPC — Beginner Guide]] — HPC cluster permissions
# Related Tutorials

- [[just-beginner-guide|Just Command Runner — Beginner Guide]] — Automate permission management tasks with just recipes

- [[micropython-ttgo-t-display-beginner-guide|MicroPython TTGO T-Display Beginner Guide]] — working with serial device permissions for USB-connected microcontrollers
- [[micropython-ttgo-t-display-deep-dive|MicroPython TTGO T-Display Deep Dive]] — serial port access and device file permissions for ESP32 development
