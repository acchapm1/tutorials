---
title: "SSH Tutorial — Connecting to Remote Servers"
date: 2026-05-05
difficulty: beginner-to-intermediate
tags: [ssh, remote-access, linux, macos, security, keys, tunneling, hpc]
---

## Overview

SSH (Secure Shell) is the industry standard for securely connecting to and managing remote servers. Whether you're deploying applications, running jobs on HPC clusters, or administering infrastructure, SSH is the foundational tool you'll use daily.

At its core, SSH implements a **client-server model**: your local machine runs an SSH client that initiates encrypted connections to a remote machine running an SSH server (sshd). All data—including passwords and commands—travels encrypted, protecting you from eavesdropping on untrusted networks.

The de facto implementation is **OpenSSH**, which provides these essential tools:

- **`ssh`** — The client; establishes remote connections
- **`sshd`** — The server daemon; listens for and handles connections
- **`ssh-keygen`** — Generates cryptographic key pairs
- **`ssh-agent`** — Manages keys in memory, avoiding repeated passphrases
- **`ssh-add`** — Adds keys to ssh-agent
- **`scp`** — Secure copy; transfers files (note: being phased out in favor of sftp protocol)
- **`sftp`** — Secure file transfer with interactive shell
- **`ssh-copy-id`** — Installs your public key on remote servers (highly recommended)

Quick sanity check on your system:

```bash
ssh -V
```

Expected output (version number varies):
```
OpenSSH_9.6p1, LibreSSL 3.3.6
```

If you see a version, OpenSSH is installed and ready.

---

## Prerequisites

To get started with SSH, you need:

1. **A terminal** — macOS Terminal, Linux terminal, Windows PowerShell, or WSL
2. **OpenSSH client** — Pre-installed on macOS and most Linux distributions; Windows 10+ includes OpenSSH via optional features or WSL2
3. **A remote server to connect to** — A server with SSH enabled and network accessibility
4. **Access credentials** — Either a password (less secure) or SSH keys (recommended)

If you're using Windows and lack OpenSSH or WSL, refer to the OpenSSH installation guide or enable WSL2 with a Linux distribution.

---

## Key Concepts

Before diving into commands, build these mental models:

**Symmetric vs Asymmetric Encryption**

SSH uses both. Symmetric encryption (shared secret) is fast and used for all data once connected. Asymmetric encryption (public/private key pairs) is slower but solves the chicken-and-egg problem: how do you exchange a secret securely if you have no secure channel yet? The answer: public keys are shared freely; private keys remain secret. Asymmetry lets you prove you own a key without revealing it.

**Public/Private Key Pairs**

Think of your public key as a mailbox (anyone can put letters in), and your private key as the mailbox key (only you open it). The server stores your public key in `~/.ssh/authorized_keys`. When you connect, SSH uses cryptographic math to prove you own the corresponding private key—without ever transmitting the private key itself.

**Authentication vs Encryption**

Authentication answers: "Are you who you claim to be?" Encryption answers: "Can anyone eavesdrop?" SSH does both. Your key pair handles authentication; a session key (negotiated at connection time) handles encryption of all traffic.

**Host Keys vs User Keys**

Servers have host keys (stored in `/etc/ssh/ssh_host_*`) used to prove the server's identity. Users have user keys (in `~/.ssh/id_*`) used to prove the user's identity. The first time you connect to a server, SSH alerts you to the server's unknown host key—you verify it (typically by asking the server admin) and then trust it for future connections.

---

## Your First Connection (Step-by-Step Instructions)

### Basic SSH Connection

Open a terminal and connect to a remote server:

```bash
ssh user@host
```

Replace `user` with your remote username and `host` with the server's IP address or hostname. For example:

```bash
ssh alice@example.com
```

If your server runs SSH on a non-standard port (not 22), specify it:

```bash
ssh -p 2222 user@host
```

### Host Key Verification (First Connection)

On your first connection to a new server, SSH displays:

```
The authenticity of host 'example.com (203.0.113.45)' can't be established.
ED25519 key fingerprint is SHA256:abc123xyz...
Are you sure you want to continue connecting (yes/no/[fingerprint])? 
```

This is SSH protecting you: it's verifying the server's identity. Before typing `yes`, **contact the server admin** and confirm the fingerprint matches. If you blindly accept, you're vulnerable to man-in-the-middle attacks on subsequent connections.

Type `yes` and press Enter. SSH saves the host key to `~/.ssh/known_hosts` for future connections—you won't see this prompt again for that server (unless the server's keys change).

### Exiting a Session

You have three ways:

```bash
exit
```

```bash
logout
```

Or use the SSH escape sequence (if the connection hangs):

```
~.
```

(Type `~` followed by `.` on a new line.) This immediately closes the connection.

### Common First-Time Errors

**Connection refused**
```
ssh: connect to host example.com port 22: Connection refused
```
The server isn't running SSH, the port is wrong, or a firewall is blocking port 22. Verify the server address and port with your admin.

**Timeout**
```
ssh: connect to host example.com port 22: Connection timed out
```
Network can't reach the server (firewall, wrong IP, routing issue). Check the address and your network connectivity.

**Permission denied (publickey) or Permission denied (password)**
```
Permission denied (publickey,password).
```
Your credentials aren't accepted. If you're using passwords, your username or password is wrong. If you're using keys, either the public key isn't installed on the server or permissions are misconfigured (see the section on SSH keys).

---

## SSH Keys (Public-Key Authentication)

Passwords are convenient but weak: they're easy to guess, leak across networks, and burden you with secure password managers. SSH keys are cryptographically strong and don't require typing a password each time (thanks to `ssh-agent`).

### Why Keys Beat Passwords

- **No eavesdropping risk** — Your private key never leaves your machine; SSH proves ownership through cryptographic math
- **No weak passwords** — Key strength is inherent; no "password123" nonsense
- **Automation-friendly** — Scheduled jobs and scripts can use keys with passphrases stored in ssh-agent
- **Revocation control** — Remove a public key from a server and that key no longer works, instantly and globally

### Choosing a Key Type

Three types are still in use:

| Type | Strength | Status | Use Case |
|------|----------|--------|----------|
| Ed25519 | 256-bit elliptic curve | **Recommended** | All new keys; modern servers |
| RSA 4096 | 4096-bit factorization | Legacy but safe | Compatibility with older servers |
| ECDSA, DSA | Older standards | **Avoid** | Phased out; don't use unless forced |

**Always use Ed25519 for new keys.** It's faster, shorter, and equally or more secure than RSA 4096.

### Generating Your Key

```bash
ssh-keygen -t ed25519 -C "you@example.com"
```

The `-C` flag adds a comment (typically your email) for identification. Expected output:

```
Generating public/private ed25519 key pair.
Enter file in which to save the key (/Users/you/.ssh/id_ed25519): 
```

Press Enter to accept the default location.

```
Enter passphrase (empty for no passphrase): 
```

**Use a passphrase.** It encrypts your private key at rest, protecting it if your laptop is stolen. You won't type it frequently because `ssh-agent` caches it (see the section on ssh-agent).

```
Enter same passphrase again: 
```

Verify the passphrase.

```
Your identification has been saved in /Users/you/.ssh/id_ed25519
Your public key has been saved in /Users/you/.ssh/id_ed25519.pub
The key fingerprint is:
SHA256:abc123xyz... you@example.com
The key's randomart image is:
+--[ED25519 256]--+
|        . +=*..  |
|       . o =+... |
...
```

Two files are created:

- **`~/.ssh/id_ed25519`** — Your private key (keep it secret, mode 600)
- **`~/.ssh/id_ed25519.pub`** — Your public key (safe to share, mode 644)

### Installing Your Public Key on a Remote Server

The **preferred method** uses `ssh-copy-id`:

```bash
ssh-copy-id -i ~/.ssh/id_ed25519.pub user@host
```

You'll be prompted for your password once. The tool then appends your public key to `~/.ssh/authorized_keys` on the remote server with correct permissions.

**Manual method** (if `ssh-copy-id` isn't available):

1. Copy your public key's contents:
   ```bash
   cat ~/.ssh/id_ed25519.pub
   ```

2. SSH to the server (password auth):
   ```bash
   ssh user@host
   ```

3. On the server, append to `authorized_keys`:
   ```bash
   mkdir -p ~/.ssh
   echo "your-public-key-here" >> ~/.ssh/authorized_keys
   chmod 600 ~/.ssh/authorized_keys
   ```

4. Exit and try public-key auth:
   ```bash
   exit
   ssh user@host
   ```

### Permissions Matter

Incorrect file permissions are the **most common cause** of "Permission denied (publickey)". SSH is strict about this—it ignores files if permissions are wrong (preventing other users from reading your secrets).

Set these exact permissions:

| Path | Mode | Reason |
|------|------|--------|
| `~/.ssh` | 700 | Only you can read, write, execute |
| `~/.ssh/authorized_keys` | 600 | Only you can read/write; sshd ignores world-readable files |
| Private keys (e.g., `id_ed25519`) | 600 | Only you can read the secret |
| Public keys (e.g., `id_ed25519.pub`) | 644 | You write, others read (safe because it's public) |

For a detailed explanation of chmod, see [[linux-permissions-beginner-guide|Linux Permissions Beginner Guide]].

Quick permission fix:

```bash
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
chmod 600 ~/.ssh/id_ed25519
chmod 644 ~/.ssh/id_ed25519.pub
```

### Testing Your Key Setup

Use verbose mode to diagnose:

```bash
ssh -v user@host
```

Read the output line by line. Look for:

```
...
debug1: Offering public key: /Users/you/.ssh/id_ed25519 ED25519 SHA256:abc123...
debug1: Server accepts key: /Users/you/.ssh/id_ed25519 ED25519 SHA256:abc123...
...
```

If you see "Server accepts key," your key is installed and working. If you see "Server accepts key" then hang, there may be other issues (see Troubleshooting).

If keys are rejected and SSH falls back to password auth, check:

1. Public key installed on server: `cat ~/.ssh/authorized_keys` (from the remote server)
2. File permissions: `ls -la ~/.ssh` on both local and remote machines
3. Verbose output for clues

---

## ssh-agent and Key Management

Passphrases protect your private key, but typing the passphrase every connection is tedious. **ssh-agent** solves this: it's a background process that holds decrypted keys in memory. You unlock your key once (type the passphrase), and ssh-agent provides the key for all subsequent SSH calls during that session.

### Starting ssh-agent

On macOS, ssh-agent starts automatically. On Linux:

```bash
eval "$(ssh-agent -s)"
```

This starts the agent and sets `SSH_AUTH_SOCK` and `SSH_AGENT_PID` environment variables so SSH can find it. You can verify:

```bash
echo $SSH_AUTH_SOCK
```

You should see a socket path like `/tmp/ssh-xxxx/agent.123`.

### Adding Keys to ssh-agent

```bash
ssh-add ~/.ssh/id_ed25519
```

You'll be prompted for your passphrase. After entering it, the key is cached in memory.

### Listing Cached Keys

```bash
ssh-add -l
```

Output:

```
256 SHA256:abc123xyz... you@example.com (ED25519)
```

Shows all keys currently cached.

### Removing All Cached Keys

```bash
ssh-add -D
```

Useful if you're leaving your machine unattended.

### macOS Keychain Integration

macOS allows ssh-agent to store passphrases in your Keychain (the system password manager). Add this to `~/.ssh/config`:

```ini
Host *
    UseKeychain yes
    AddKeysToAgent yes
```

With `UseKeychain yes`, macOS prompts you to save the passphrase in Keychain the first time you use a key. Future connections automatically unlock the key from Keychain without prompting. This is safe and convenient.

### Agent Forwarding (Security Warning)

Agent forwarding (`ssh -A` or `ForwardAgent yes` in config) lets you jump through a bastion host and use your local keys on the remote server—without copying keys to the bastion.

```bash
ssh -A user@bastion
# Now, from bastion, you can ssh to another server using your local key
ssh user@internal-server
# This works because your keys are forwarded through the bastion
```

**⚠️ Warning:** If the bastion is compromised, an attacker can use your forwarded keys to access servers you have access to. Only enable forwarding for trusted servers, and be mindful on shared systems.

---

## SSH Config File (`~/.ssh/config`)

Typing `ssh -p 2222 alice@example.com -i ~/.ssh/id_ed25519` every time is error-prone. The SSH config file lets you define **hosts** with pre-configured options, drastically simplifying your workflow.

### What It Does

`~/.ssh/config` is a simple text file where you define "Host" blocks. Each block specifies connection defaults for matching hosts.

### Motivating Examples

**Example 1: Host Alias**

```ini
Host prod
    HostName prod.example.com
    User alice
    IdentityFile ~/.ssh/id_ed25519
    Port 2222
```

Now connect with:

```bash
ssh prod
```

SSH expands `prod` to `prod.example.com`, uses user `alice`, the specified key, and port 2222. Much cleaner.

**Example 2: Multiple Identities**

Different projects use different keys:

```ini
Host github.com
    IdentityFile ~/.ssh/id_github

Host gitlab.com
    IdentityFile ~/.ssh/id_gitlab

Host *
    IdentityFile ~/.ssh/id_ed25519
```

The `Host *` rule applies defaults to all hosts. SSH tries each identity in order, so `github.com` tries `id_github` first, then falls back to `id_ed25519` if needed.

### Comprehensive Reference

For detailed coverage of every directive, advanced patterns, multi-host setups, and troubleshooting, see the [[ssh-config-deep-dive|SSH Config Deep Dive]].

### Required Permissions

Your config file must be readable only by you:

```bash
chmod 600 ~/.ssh/config
```

SSH silently ignores the file if it's world-readable (a security measure).

### Managing SSH Config Across Machines

If you work on multiple computers, you'll want to keep your SSH config synchronized. Two excellent approaches:

1. **Dotfiles** — Store your entire `~/.ssh` directory (minus private keys) in a git repo. See [[dotfiles-beginner-guide|Dotfiles Beginner Guide]] for strategies.
2. **Chezmoi** — A state-management tool designed for dotfiles. [[chezmoi-beginner-guide|Chezmoi Beginner Guide]] covers setup and best practices.

---

## File Transfer (Practical Examples)

SSH isn't just for remote command execution—it's a foundation for secure file transfer.

### scp (Secure Copy)

```bash
# Copy a file from local to remote
scp local-file.txt user@host:~/

# Copy from remote to local
scp user@host:~/remote-file.txt .

# Recursive copy (directories)
scp -r user@host:~/project-dir .

# Specify a non-standard SSH port
scp -P 2222 file.txt user@host:~/
```

**Note:** `scp` is being phased out in favor of the SFTP protocol due to historical security concerns. For new work, prefer `sftp` or `rsync` below.

### sftp (Secure File Transfer Protocol)

SFTP is interactive and safer. Start an SFTP session:

```bash
sftp user@host
```

You're now in an SFTP shell. Common commands:

```sftp
ls                          # List remote files
pwd                         # Print remote working directory
cd projects                 # Change remote directory
get remote-file.txt         # Download remote-file.txt to local dir
put local-file.txt          # Upload local-file.txt to remote dir
lcd Downloads               # Change local working directory
lpwd                        # Print local working directory
put -r local-dir            # Upload entire directory recursively
exit                        # Close the session
```

Example session:

```bash
$ sftp alice@example.com
Connected to example.com.
sftp> ls
documents  projects  public_html
sftp> cd projects
sftp> get report.pdf
Fetching /home/alice/projects/report.pdf to report.pdf
sftp> exit
```

### rsync over SSH

For syncing directories (especially large ones), rsync is unbeatable:

```bash
rsync -avz -e ssh local-dir/ user@host:~/remote-dir/
```

Breaking down the flags:

- `-a` — Archive mode (preserves permissions, timestamps, symlinks)
- `-v` — Verbose (shows files being synced)
- `-z` — Compress (good for slower networks)
- `-e ssh` — Use SSH as the transport

Two-way sync (careful!):

```bash
rsync -avz -e ssh user@host:~/remote-dir/ local-dir/
```

rsync only transfers changed files, making it efficient for incremental backups.

### sshfs

Mount a remote directory locally:

```bash
sshfs user@host:/remote/path ~/mount-point
```

Files on the remote server appear as if they're on your local filesystem. Great for interactive work on remote files.

```bash
ls ~/mount-point          # Lists remote /remote/path
cat ~/mount-point/file    # Reads remote file
umount ~/mount-point      # Unmount when done
```

---

## Port Forwarding & Tunneling

SSH can tunnel traffic through a secure connection, giving you access to services on the remote network or exposing local services remotely.

### Local Port Forwarding (`-L`)

Forward a local port to a remote service:

```bash
ssh -L 5432:localhost:5432 user@dbserver
```

This listens on your local port 5432 and tunnels all traffic to `localhost:5432` on `dbserver`. Now connect to your local database:

```bash
psql -h localhost -U postgres
```

The connection is encrypted and proxied through the SSH server.

**Practical example:** Access a database on a private network:

```bash
ssh -L 3306:db.internal:3306 user@bastion
# In another terminal:
mysql -h localhost -P 3306 -u root
```

### Remote Port Forwarding (`-R`)

Expose a local service on a remote server:

```bash
ssh -R 8080:localhost:3000 user@host
```

This listens on `host:8080` and tunnels back to your local `localhost:3000`. Useful for demos: someone on the remote network can visit `http://host:8080` to access your local application.

### Dynamic Forwarding (`-D`, SOCKS Proxy)

Create a SOCKS proxy to route all traffic through the SSH server:

```bash
ssh -D 1080 user@host
```

Configure your browser to use SOCKS proxy `localhost:1080`. All browser traffic is tunneled through the SSH server—useful for accessing internal-only websites when on a VPN or untrusted network.

### Background Tunnels

Long-lived tunnels run in the background:

```bash
ssh -f -N -L 5432:localhost:5432 user@dbserver
```

- `-f` — Fork to background after authentication
- `-N` — Don't execute remote commands (just forward)

Keep the tunnel alive with a loop in a systemd service or tmux session for production use.

---

## Jump Hosts / Bastions

Some networks use **bastion hosts** (jump hosts): publicly accessible servers that relay connections to internal servers. You can't reach the internal server directly; you must go through the bastion.

### The Problem

```
Your machine ---> Bastion (public) ---> Internal Server (private)
```

Traditional solution: SSH to bastion, then SSH to the internal server. Annoying and slow.

### Modern Solution: ProxyJump

```bash
ssh -J user@bastion user@internal
```

SSH connects through the bastion to the internal server in one command.

### SSH Config with ProxyJump

```ini
Host internal
    HostName internal.example.com
    User alice
    ProxyJump bastion

Host bastion
    HostName bastion.example.com
    User alice
```

Now:

```bash
ssh internal
```

SSH automatically jumps through bastion.

### Multi-Hop (Chain Multiple Bastions)

```bash
ssh -J bastion1,bastion2 user@target
```

Or in config:

```ini
Host target
    ProxyJump bastion1,bastion2
```

For advanced ProxyJump patterns and alternative approaches, see the [[ssh-config-deep-dive|SSH Config Deep Dive]].

### Legacy: ProxyCommand

Older SSH uses `ProxyCommand`:

```ini
Host internal
    HostName internal.example.com
    User alice
    ProxyCommand ssh bastion -W %h:%p
```

`ProxyJump` is simpler and preferred; use `ProxyCommand` only for compatibility with very old SSH versions.

---

## Server-Side Configuration (sshd) — Brief Overview

While this tutorial focuses on the client, you should know the basics of server-side SSH hardening.

### The sshd Config File

SSH servers read `/etc/ssh/sshd_config` (requires root to edit). Key hardening settings:

```ini
# Disable password authentication; use keys only
PasswordAuthentication no

# Disable root login
PermitRootLogin no

# Enable public-key authentication
PubkeyAuthentication yes

# Change the port (non-standard ports reduce automated attacks)
Port 2222

# Restrict which users can log in
AllowUsers alice bob
```

### Safe Testing and Reloading

Always test config syntax before reloading:

```bash
sudo sshd -t
```

If there are errors, they're reported. Never reload an invalid config—you'll lock yourself out.

If syntax is okay, reload the service:

```bash
sudo systemctl reload ssh
```

Or on older systems:

```bash
sudo service ssh reload
```

**Keep an existing SSH session open** during testing. If reload breaks the service, you can still SSH in and fix it.

---

## Troubleshooting

Most SSH issues fall into a few categories. Use verbose modes to diagnose:

### Verbose Modes

```bash
ssh -v user@host      # One level of debug output
ssh -vv user@host     # Two levels (more detail)
ssh -vvv user@host    # Three levels (verbose forensics)
```

Read the output—it tells you exactly where things fail. Look for lines mentioning your key, authentication methods attempted, and any errors.

### known_hosts and Host Key Mismatches

If a server's host key changes (rare, but happens during maintenance), SSH refuses to connect:

```
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
```

After confirming with your server admin that the key actually changed, remove the old entry:

```bash
ssh-keygen -R hostname
```

This removes the old host key from `~/.ssh/known_hosts`. Your next connection prompts you to verify the new key.

### Permission Denied (publickey)

Symptoms:

```
Permission denied (publickey).
```

Causes (in order of frequency):

1. **Public key not on server** — Verify `~/.ssh/authorized_keys` exists and contains your public key
2. **Permissions wrong** — Check `ls -la ~/.ssh/authorized_keys` on the remote; must be mode 600. Check `ls -la ~/.ssh` locally; must be mode 700.
3. **Wrong key** — Verify you're offering the right key with `ssh -vv` and confirm the server's `authorized_keys` matches
4. **Newlines in key** — If you manually pasted your key, ensure each key is on its own line with no extra whitespace

Diagnostic steps:

```bash
# Check the key on the server
ssh user@host "cat ~/.ssh/authorized_keys"

# Check permissions
ssh user@host "ls -ld ~/.ssh && ls -l ~/.ssh/authorized_keys"

# Verbose output to see what key SSH is trying
ssh -vv user@host
```

### Connection Refused vs Timed Out vs Host Unreachable

- **Connection refused** — The host is reachable, but nothing is listening on port 22 (SSH not running, wrong port, firewall rejecting)
- **Connection timed out** — No response from the host (wrong IP, network unreachable, firewall dropping packets)
- **Host unreachable** — Network layer can't find a route to the host (wrong network, broken routing)

For connection refused, verify the port with the server admin. For timeouts, ping the host and check your network. For unreachable, check your network routing.

### Server-Side Logs

Check the server's logs (requires server access):

```bash
# Ubuntu/Debian
tail -f /var/log/auth.log

# CentOS/RHEL
tail -f /var/log/secure

# Systemd journal
journalctl -u ssh -n 50  # Last 50 SSH-related log lines
```

Look for permission errors, authentication failures, or connection rejections. These often point directly to the problem.

---

## Security Best Practices

SSH is secure only if used correctly. Follow this checklist:

- ✅ **Use Ed25519 keys** — Strong, modern, and fast
- ✅ **Always use a passphrase** — Protects your key if stolen
- ✅ **Disable password authentication** — On servers you control, set `PasswordAuthentication no` in sshd_config
- ✅ **Disable root login** — Set `PermitRootLogin no`; use sudo for elevated access
- ✅ **Be cautious with agent forwarding** — Only enable `-A` / `ForwardAgent yes` for trusted servers
- ✅ **Rotate keys periodically** — Generate new keys every 1–2 years, deprecate old ones
- ✅ **Verify host keys** — On first connection, confirm the fingerprint with the server admin
- ✅ **Keep OpenSSH updated** — Regularly update your SSH client and servers; security patches are critical
- ✅ **Audit authorized_keys** — Periodically review keys on your servers; remove any you no longer use
- ✅ **Use SSH config aliases** — Reduces typing errors and typos (a common vector for phishing)

---

## HPC-Specific Notes

If you're using SSH for high-performance computing clusters, a few cluster-specific practices apply.

### Login Nodes vs Compute Nodes

HPC clusters separate login nodes (public, for submitting jobs) from compute nodes (private, for running jobs). You SSH to the login node, then use job schedulers (Slurm, PBS, etc.) to run on compute nodes.

```bash
ssh user@login.cluster.example.com
# Once logged in, submit a job:
sbatch my-job.sh
# Or for interactive work:
salloc -N 1 -t 1:00:00
```

### SSH Config for Cluster Logins

Define your clusters in `~/.ssh/config` to avoid typing long hostnames:

```ini
Host hpc1-login
    HostName login.hpc1.example.com
    User alice
    IdentityFile ~/.ssh/id_ed25519

Host hpc2-login
    HostName login.hpc2.example.com
    User alice
    IdentityFile ~/.ssh/id_ed25519
```

### Key Handling on Shared Filesystems

Many clusters use shared home directories (mounted via NFS). **Never store private keys on the shared filesystem**—other users on compute nodes can read them. Instead:

- Store keys only on your local machine
- Use `ssh-agent` forwarding to compute nodes (with caution and only if the cluster is trusted)
- Or, generate cluster-specific keys with restricted permissions

### ssh-agent on Clusters

Forward your agent to login nodes:

```bash
ssh -A user@login.cluster.example.com
```

This lets you SSH from the login node to other resources (e.g., Git, internal databases) using your local keys, without storing keys on the cluster.

For deeper HPC-specific SSH configuration, see [[hyperqueue-basics|HyperQueue Basics]] and [[apache-nifi-hpc-sysadmin-beginner-guide|Apache NiFi HPC Sysadmin Guide]].

---

## Hands-On Exercises

Try these practical tasks:

**Exercise 1: Generate an SSH Key and Connect**

1. Generate an Ed25519 key:
   ```bash
   ssh-keygen -t ed25519 -C "yourname@example.com"
   ```
2. Install it on a test server (ask an admin for credentials or use a VM):
   ```bash
   ssh-copy-id -i ~/.ssh/id_ed25519.pub user@testhost
   ```
3. Connect without a password:
   ```bash
   ssh user@testhost
   ```
4. Verify key authentication in verbose mode:
   ```bash
   ssh -v user@testhost
   ```

**Exercise 2: Set Up SSH Config Aliases**

1. Edit `~/.ssh/config`:
   ```ini
   Host myserver
       HostName example.com
       User alice
       Port 2222
   ```
2. Connect using the alias:
   ```bash
   ssh myserver
   ```

**Exercise 3: Create a Local Port Forward**

1. Create a forward to a remote database:
   ```bash
   ssh -L 5432:localhost:5432 user@dbserver
   ```
2. In another terminal, connect to the local forward:
   ```bash
   psql -h localhost
   ```

**Exercise 4: Transfer Files with rsync**

1. Sync a directory to a remote server:
   ```bash
   rsync -avz -e ssh ~/my-project/ user@host:~/backups/my-project/
   ```
2. Verify files on the remote:
   ```bash
   ssh user@host "ls -la ~/backups/my-project/"
   ```

---

## Quick Reference Cheat Sheet

| Task | Command |
|------|---------|
| Connect to server | `ssh user@host` |
| Connect on non-standard port | `ssh -p 2222 user@host` |
| Generate Ed25519 key | `ssh-keygen -t ed25519 -C "email@example.com"` |
| Copy public key to server | `ssh-copy-id -i ~/.ssh/id_ed25519.pub user@host` |
| List cached keys in ssh-agent | `ssh-add -l` |
| Add key to ssh-agent | `ssh-add ~/.ssh/id_ed25519` |
| Remove all cached keys | `ssh-add -D` |
| Verbose SSH output | `ssh -vv user@host` |
| SCP file to remote | `scp file.txt user@host:~/` |
| SCP file from remote | `scp user@host:~/file.txt .` |
| Start SFTP session | `sftp user@host` |
| Sync directories via rsync | `rsync -avz -e ssh src/ user@host:dest/` |
| Local port forward | `ssh -L 5432:localhost:5432 user@host` |
| Remote port forward | `ssh -R 8080:localhost:3000 user@host` |
| SOCKS proxy | `ssh -D 1080 user@host` |
| Jump through bastion | `ssh -J user@bastion user@target` |
| Remove host key | `ssh-keygen -R hostname` |
| Test SSH key permissions | `ssh -vv user@host` (look for "Offer publickey") |
| Fix SSH config permissions | `chmod 600 ~/.ssh/config` |

---

## Related Tutorials

Deepen your SSH knowledge and explore related tools:

- [[ssh-config-deep-dive|SSH Config Deep Dive]] — Comprehensive reference for `~/.ssh/config` directives, advanced patterns, and cluster configurations
- [[linux-permissions-beginner-guide|Linux Permissions Beginner Guide]] — Understand `chmod` and file ownership (essential for SSH key permissions)
- [[linux-permissions-deep-dive|Linux Permissions Deep Dive]] — Advanced permission topics and edge cases
- [[mosh-beginner-guide|Mosh Beginner Guide]] — SSH alternative optimized for unstable/mobile connections
- [[mosh-deep-dive|Mosh Deep Dive]] — In-depth Mosh configuration and use cases
- [[dotfiles-beginner-guide|Dotfiles Beginner Guide]] — Sync your `~/.ssh/config` and dotfiles across machines
- [[dotfiles-deep-dive|Dotfiles Deep Dive]] — Advanced dotfiles management techniques
- [[chezmoi-beginner-guide|Chezmoi Beginner Guide]] — State management for dotfiles, including SSH config
- [[chezmoi-deep-dive|Chezmoi Deep Dive]] — Advanced Chezmoi templates and workflows
- [[gh-cli-beginner-guide|GitHub CLI Beginner Guide]] — Interact with GitHub; uses SSH for authentication
- [[gh-cli-deep-dive|GitHub CLI Deep Dive]] — Advanced GitHub CLI workflows and integrations
- [[docker-test-container-beginner-guide|Docker Test Container Guide]] — Use SSH to interact with Docker containers and remote registries
- [[kubernetes-beginner-guide|Kubernetes Beginner Guide]] — SSH into Kubernetes pods and nodes
- [[honeymux-beginner-guide|Honeymux Beginner Guide]] — Multiplexing SSH sessions for team collaboration
- [[sesh-beginner-guide|Sesh Beginner Guide]] — Terminal multiplexer integrating SSH session management
- [[omp-beginner-guide|Oh My Pi (omp) Beginner Guide]] — terminal coding agent; the vLLM provider configuration requires an SSH tunnel from workstation to HPC compute node
- [[omp-deep-dive|Oh My Pi (omp) Deep Dive]] — in-depth HPC chapter with concrete `ssh -L` tunnel commands for routing omp to a vLLM server on a Slurm compute node
- [[openmux-beginner-guide|OpenMux Beginner Guide]] — SSH multiplexing tool for complex networks
- [[hyperqueue-basics|HyperQueue Basics]] — Job submission on HPC clusters; uses SSH for login nodes
- [[apache-nifi-hpc-sysadmin-beginner-guide|Apache NiFi HPC Sysadmin Guide]] — Data flow automation on clusters; often SSH-based
- [[git-worktrees-worktrunk-beginner-guide|Git Worktrees Beginner Guide]] — Manage Git repos; often accessed via SSH

---


- [[maestri-beginner-guide|Maestri Beginner Guide]] — Orchestrate AI agents and terminals on an infinite canvas; uses SSH for connecting to remote clusters
- [[maestri-deep-dive|Maestri Deep Dive]] — Advanced agent orchestration patterns for HPC administration


- [[dtach-beginner-guide|Dtach Beginner Guide]] — keep programs alive across SSH disconnections with minimal overhead
- [[dtach-deep-dive|Dtach Deep Dive]] — advanced dtach patterns for SSH workflows and jump hosts


- [[headscale-beginner-guide|Headscale Beginner Guide]] — self-hosted WireGuard mesh networking; eliminates port forwarding and dynamic DNS for SSH access
- [[headscale-deep-dive|Headscale Deep Dive]] — advanced Headscale configuration including SSH policy via ACLs

## Summary

SSH is your gateway to remote systems. Master these essentials:

1. **Use public-key authentication** — Generate Ed25519 keys, install them with `ssh-copy-id`, and use passphrases
2. **Leverage ssh-agent** — Cache your passphrase once; SSH handles unlocking afterward
3. **Configure `~/.ssh/config`** — Define hosts, identities, and ports to avoid repetitive typing
4. **Understand port forwarding** — Tunnel database connections, expose local services, or create SOCKS proxies
5. **Know the security basics** — Disable root login, password auth, and verify host keys on first connection

**Your next high-value step:** Set up SSH keys on a server you use regularly and configure `~/.ssh/config` with an alias. This single change eliminates password typing and reduces connection friction enormously.

From there, explore [[ssh-config-deep-dive|SSH Config Deep Dive]] for advanced patterns, and practice port forwarding and jumping for multi-hop environments. Happy secure shell-ing!
