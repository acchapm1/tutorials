
---
title: "SSH Config Deep Dive — Mastering ~/.ssh/config"
date: 2026-05-05
difficulty: intermediate-to-advanced
tags: [ssh, ssh-config, remote-access, linux, macos, networking, security, hpc]
---

## Overview

The `~/.ssh/config` file is one of the most powerful tools in a remote user's arsenal. It's a simple text file where you define named SSH hosts, their connection parameters, identity files, and behaviors—so instead of typing `ssh -i ~/.ssh/special_key -p 2222 -l deploy user.example.com`, you just type `ssh myhost` and OpenSSH reads your config to handle all the details.

This is more than a shortcut. A well-crafted config transforms SSH from a command-line chore into a seamless experience. It enables connection multiplexing (reusing connections), intelligent key selection across multiple accounts, jump-host chains, dynamic forwarding, and graceful timeouts. For power users—developers juggling GitHub accounts, sysadmins managing clusters, DevOps engineers orchestrating infrastructure with Ansible, or HPC researchers—a thoughtful config is non-negotiable.

This reference is the **deep dive companion** to [[ssh-tutorial|SSH Tutorial]], which covers SSH basics. Here we focus on config file mastery: parsing rules, every commonly-used directive, real-world recipes, and troubleshooting.

## Prerequisites

- **SSH basics:** familiarity with key pairs, `-i` flag, port redirection. See [[ssh-tutorial|SSH Tutorial]] if needed.
- **A working SSH client:** OpenSSH 7.3+. Check with `ssh -V`.
- **At least one remote host** to test against (a personal server, GitHub account, or cloud instance).
- **Text editor:** vim, nano, VS Code, or your preference.
- **File permissions knowledge:** understanding of `chmod` and file modes (see [[linux-permissions-beginner-guide|Linux Permissions Beginner Guide]]).

## Key Concepts

### First-Match-Wins Parsing

When OpenSSH processes `~/.ssh/config`, it reads directives **top to bottom** and applies the **first value it finds for each directive**. If you define `User alice` in a Host block and later define `User bob` in another block that also matches, OpenSSH uses `alice`. This is crucial: **order matters**. Put specific hosts near the top, general patterns (like `Host *`) at the bottom.

**Exception:** Some directives (like `IdentityFile`, `LocalForward`, `RemoteForward`) can appear multiple times and are all used; OpenSSH tries each one in order.

### Host Blocks vs Match Blocks

**`Host` blocks** match against the alias you type on the command line. They're the standard way to define named hosts.

**`Match` blocks** are more powerful but less commonly used. They match against criteria like the target hostname, the executing user, or output of an exec command. Use them when you need conditional logic beyond simple name matching.

Example:
```ini
Host github-work
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_work

Match host github.com user git
    AddKeysToAgent yes
```

### How Command-Line Flags Interact with Config

Command-line arguments **override** config file directives. For example:
```bash
ssh -i ~/.ssh/other_key myhost
```
will override the `IdentityFile` from `~/.ssh/config` for `myhost`. This is useful for one-off scenarios but dangerous if you're not paying attention—it's easy to accidentally leak a connection attempt with the wrong key.

## File Structure and Parsing Rules

### Basic Anatomy

```ini
Host alias1
    HostName hostname1.example.com
    User myuser
    Port 2222

Host alias2
    HostName hostname2.example.com
    User otheruser
    IdentityFile ~/.ssh/special_key
```

### Pattern Matching in Host Blocks

`Host` patterns support wildcards:
- `*` matches zero or more characters
- `?` matches exactly one character
- `!` prefix negates a pattern

Examples:
```ini
Host github-*
    HostName github.com
    User git

Host *.example.com
    Port 2222
    User deploy

Host !*.internal
    StrictHostKeyChecking accept-new
```

### Match Blocks and Criteria

Match blocks use criteria like:
- `host` — target hostname
- `user` — logged-in username
- `exec` — result of a shell command (exit 0 = true)
- `originalhost` — what you typed on the command line
- `final` — rarely used; matches after config is fully parsed

Example:
```ini
Match host github.com exec "[ -f ~/.ssh/github_work ]"
    User git
    IdentityFile ~/.ssh/id_ed25519_work
```

This uses your work key **only if** the file `~/.ssh/github_work` exists—a neat way to switch identities without editing config.

### Include Directives

Break up a large config into multiple files:

```ini
Include ~/.ssh/config.d/personal
Include ~/.ssh/config.d/work
Include ~/.ssh/config.d/hpc

Host *
    ServerAliveInterval 60
```

Each file is parsed in order. This keeps credentials and hostnames organized.

### File Permissions: Must Be 600

```bash
chmod 600 ~/.ssh/config
```

OpenSSH refuses to read a config file that's world-readable (or group-writable). It's a security boundary. See [[linux-permissions-beginner-guide|Linux Permissions Beginner Guide]] for deeper explanation.

> ⚠️ **Warning:** If you get "Bad permissions on config file," immediately check with `ls -l ~/.ssh/config`. Many tools and scripts accidentally relax permissions. Always reset to 600.

## Most-Used Directives: Reference Table

| Directive | What It Does | Example | Notes |
|-----------|--------------|---------|-------|
| `HostName` | Actual hostname/IP to connect to | `HostName server.example.com` | Required for each Host block; can differ from the alias |
| `User` | Remote username | `User deploy` | Overrides `~/.ssh/config`'s global User or ssh default (your local username) |
| `Port` | SSH port on remote | `Port 2222` | Defaults to 22 |
| `IdentityFile` | Private key file | `IdentityFile ~/.ssh/id_ed25519` | Tried in order listed; multiple entries allowed. SSH tries each key until one works |
| `IdentitiesOnly` | Only use listed IdentityFile(s)? | `IdentitiesOnly yes` | If `yes`, SSH ignores default keys and agent keys. Critical for multi-account setups |
| `ProxyJump` | Jump host (bastion) | `ProxyJump bastion` | Modern, simple replacement for ProxyCommand. Alias must be defined earlier in config |
| `ProxyCommand` | Custom command to establish tunnel | `ProxyCommand ssh -q -W %h:%p bastion` | Powerful but verbose; prefer ProxyJump unless you need special logic |
| `ForwardAgent` | Pass SSH agent to remote? | `ForwardAgent yes` | Risky on untrusted servers; agent-forwarded keys can be abused |
| `AddKeysToAgent` | Add keys to agent on first use? | `AddKeysToAgent yes` | Convenient; agent remembers key passphrase so you type it once |
| `UseKeychain` | macOS: use system keychain? | `UseKeychain yes` | Stores passphrases in Keychain; macOS only |
| `ServerAliveInterval` | Send keep-alive every N seconds | `ServerAliveInterval 60` | Prevents timeouts on idle connections; 0 = disabled |
| `ServerAliveCountMax` | Miss N keep-alives before exit? | `ServerAliveCountMax 3` | Session dies after `Interval × CountMax` seconds of no response |
| `ControlMaster` | Enable connection multiplexing? | `ControlMaster auto` | Values: `no`, `yes`, `ask`, `auto`. Auto = create master if none exists |
| `ControlPath` | Socket file for multiplexed sessions | `ControlPath ~/.ssh/sockets/%r@%h-%p` | Tokens: `%r` = remote user, `%h` = target host, `%p` = port. Create sockets dir first |
| `ControlPersist` | Keep master alive for N seconds | `ControlPersist 600` | After last client exits, master persists (huge speed boost for loops) |
| `LocalForward` | Forward local port → remote | `LocalForward 5432 db.internal:5432` | Syntax: `LocalForward local_port remote_host:remote_port`. Can list multiple times |
| `RemoteForward` | Forward remote port → local | `RemoteForward 8080 localhost:3000` | Reverse tunnel; useful for exposing local dev server to remote |
| `DynamicForward` | SOCKS5 proxy via SSH | `DynamicForward 1080` | Turn SSH connection into SOCKS proxy for all traffic; great for privacy on untrusted networks |
| `StrictHostKeyChecking` | Accept unknown host keys? | `StrictHostKeyChecking accept-new` | Values: `yes`, `no`, `accept-new`. `accept-new` = safe default (accept first-time keys, reject changed ones) |
| `UserKnownHostsFile` | Alternative known_hosts file | `UserKnownHostsFile ~/.ssh/known_hosts` | Rarely changed; defaults to `~/.ssh/known_hosts` |
| `PreferredAuthentications` | Auth methods to try (and order) | `PreferredAuthentications publickey,password` | Comma-separated list; SSH tries in order. Usually keep pubkey first |
| `PubkeyAcceptedAlgorithms` | Allowed public key algorithms | `PubkeyAcceptedAlgorithms ssh-ed25519,rsa-sha2-512` | Restrict to strong algorithms (ed25519 preferred). Filter weak ones out |
| `RequestTTY` | Allocate terminal? | `RequestTTY yes` | Values: `yes`, `no`, `force`, `auto`. Needed for interactive shells |
| `RemoteCommand` | Command to run on connect | `RemoteCommand "cd /data && bash"` | Useful for jump hosts + command chaining |
| `LogLevel` | Verbosity of SSH logs | `LogLevel DEBUG` | Values: `QUIET`, `FATAL`, `ERROR`, `INFO`, `VERBOSE`, `DEBUG`, `DEBUG1`, `DEBUG2`, `DEBUG3` |

> 💡 **Tip:** Use `ssh -G hostname` to see the effective resolved configuration for a host. This is invaluable for debugging.

## Recipes / Patterns

### Pattern 1: Per-Project Identity (GitHub / GitLab Multi-Account)

You have a personal GitHub account and a work GitHub account, each with its own key:

```ini
# Personal GitHub
Host github-personal
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_personal
    IdentitiesOnly yes

# Work GitHub
Host github-work
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_work
    IdentitiesOnly yes
```

When you clone a repo from work, use:
```bash
git clone git@github-work:company/repo.git
```

And set up Git to auto-match:
```bash
git config --global url."git@github-work:".insteadOf "git@github.com:"
```

Or configure per-directory with `.git/config`:
```ini
[url "git@github-work:"]
    insteadOf = git@github.com:
```

**Why `IdentitiesOnly yes`?** Without it, OpenSSH tries your agent's keys first, which can be wrong. With it, only the listed `IdentityFile` is used—fast and predictable.

### Pattern 2: Bastion / Jump Host with Downstream Targets

You have a bastion (jump) host; downstream servers only accept SSH from the bastion:

```ini
Host bastion
    HostName bastion.example.com
    User admin
    IdentityFile ~/.ssh/id_ed25519_bastion

Host internal-db
    HostName db.internal
    User deploy
    ProxyJump bastion
    IdentityFile ~/.ssh/id_ed25519_deploy

Host internal-*
    User deploy
    ProxyJump bastion
    IdentityFile ~/.ssh/id_ed25519_deploy
```

Now `ssh internal-db` transparently jumps through bastion. Under the hood, it's equivalent to:
```bash
ssh -J bastion internal-db
```

> 💡 **Tip:** Chain proxies with comma-separated aliases: `ProxyJump bastion,internal-vpn`. Handy for multi-hop topologies.

### Pattern 3: Connection Multiplexing for Speed

Connection multiplexing is a **game-changer** for Ansible, rsync loops, and repeated SSH commands. The first SSH connection to a host opens a "master" socket; subsequent connections reuse it instead of negotiating new ones. In practice: **10x to 100x faster** on high-latency networks.

```ini
Host *
    ControlMaster auto
    ControlPath ~/.ssh/sockets/%r@%h-%p
    ControlPersist 600
```

Set it up:
```bash
mkdir -p ~/.ssh/sockets
chmod 700 ~/.ssh/sockets
```

Test it:
```bash
# First connection (slow, ~3-5s on remote server)
ssh myhost hostname

# Second connection (instant, <100ms)
ssh myhost hostname

# Master socket persists for 600s, so repeated commands are fast
```

Check active sockets:
```bash
ls -la ~/.ssh/sockets/
```

### Pattern 4: Wildcard Defaults at the Bottom

Put a `Host *` block at the very end to set defaults for all hosts:

```ini
Host github-personal
    ...

Host bastion
    ...

Host *
    ServerAliveInterval 60
    ServerAliveCountMax 3
    IdentitiesOnly no
    AddKeysToAgent yes
    UseKeychain yes
    ControlMaster auto
    ControlPath ~/.ssh/sockets/%r@%h-%p
    ControlPersist 600
```

Because of first-match-wins, the `Host *` directives apply **only if they weren't defined earlier**. This is how you set global defaults without repeating them in every block.

### Pattern 5: HPC Cluster Login Alias

SSH to an HPC cluster often requires a specific key, a non-standard port, and aggressive keep-alives (cluster terminals time out quickly):

```ini
Host hpc-cluster
    HostName hpc.university.edu
    User alice
    Port 2222
    IdentityFile ~/.ssh/id_ed25519_hpc
    IdentitiesOnly yes
    ServerAliveInterval 30
    ServerAliveCountMax 10
    RequestTTY yes
```

Now `ssh hpc-cluster` drops you into a robust shell on the HPC login node.

### Pattern 6: Dynamic Forwarding (SOCKS Proxy)

Turn your SSH connection into a SOCKS5 proxy to route all traffic through a remote server (useful for privacy on untrusted WiFi):

```ini
Host socks-proxy
    HostName proxy.example.com
    User alice
    DynamicForward 1080
    ServerAliveInterval 60
```

Connect:
```bash
ssh -f -N socks-proxy  # -f = background, -N = no command
```

Then configure your browser or app to use `SOCKS5` proxy on `localhost:1080`. All traffic routes through the remote server.

## Hands-On Exercises

### Exercise 1: Create a Named Alias

1. Edit `~/.ssh/config` and add a new host (use a server you have access to):
```ini
Host my-test-server
    HostName server.example.com
    User myuser
    IdentityFile ~/.ssh/id_ed25519
```

2. Test it:
```bash
ssh my-test-server
```

3. Verify the config was applied:
```bash
ssh -G my-test-server | head -20
```

**Expected outcome:** You connect without typing the full hostname or `-i` flag.

### Exercise 2: Set Up Connection Multiplexing and Benchmark

1. Create the sockets directory:
```bash
mkdir -p ~/.ssh/sockets
chmod 700 ~/.ssh/sockets
```

2. Add multiplexing to your config (e.g., under `Host *`):
```ini
ControlMaster auto
ControlPath ~/.ssh/sockets/%r@%h-%p
ControlPersist 600
```

3. Benchmark (pick any remote host):
```bash
time ssh myhost hostname
time ssh myhost hostname
time ssh myhost hostname
```

**Expected outcome:** First connection takes ~3-5s; second and third are instant (< 100ms).

### Exercise 3: Configure a Jump Host Chain

If you have a bastion and an internal server:

1. Define the bastion:
```ini
Host bastion
    HostName bastion.example.com
    User admin
```

2. Define the internal target:
```ini
Host internal-server
    HostName 10.0.0.5
    User deploy
    ProxyJump bastion
```

3. Test:
```bash
ssh internal-server
```

**Expected outcome:** You're on the internal server without manually jumping through bastion first.

### Exercise 4: GitHub Multi-Account Setup

If you have both a personal and work GitHub account:

1. Create separate keys (if you haven't):
```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_personal -C "personal@gmail.com"
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_work -C "work@company.com"
```

2. Add both public keys to their respective GitHub accounts.

3. Configure SSH:
```ini
Host github-personal
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_personal
    IdentitiesOnly yes

Host github-work
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_work
    IdentitiesOnly yes
```

4. Clone and test:
```bash
git clone git@github-personal:myname/personal-repo.git
git clone git@github-work:company/work-repo.git
```

**Expected outcome:** Both clones succeed with the correct keys.

## Troubleshooting Config Issues

### Check Effective Config with `ssh -G`

Don't guess—ask SSH what config it actually resolved:

```bash
ssh -G myhost
```

Output:
```
host myhost
hostname server.example.com
user deploy
port 22
identityfile ~/.ssh/id_ed25519
identitiesonly yes
serveraliveinterval 60
...
```

If a directive is missing or wrong, you have a config parsing issue.

### Common Pitfalls

**1. Order of Host Blocks**

Remember: first-match-wins. This config is **wrong**:
```ini
Host *
    User alice

Host github.com
    User git
```

SSH will use `User alice` for github.com, not `User git`. Fix by reordering:
```ini
Host github.com
    User git

Host *
    User alice
```

**2. Forgotten IdentitiesOnly**

Without `IdentitiesOnly yes`, SSH tries your agent's keys first—which might be the wrong one. Always add it for multi-account scenarios:
```ini
Host github-work
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_work
    IdentitiesOnly yes
```

**3. Permissions Issues**

```bash
ls -l ~/.ssh/config
```

Must be `600` (read/write for owner only):
```
-rw------- 1 alice alice 1234 May 5 10:00 ~/.ssh/config
```

Fix with:
```bash
chmod 600 ~/.ssh/config
```

### Debugging with `ssh -vvv`

For deep debugging, use verbose mode:
```bash
ssh -vvv myhost
```

Look for lines like:
```
debug1: Reading configuration data /home/alice/.ssh/config
debug1: Applying options for myhost
debug1: Offering public key: ~/.ssh/id_ed25519 ED25519 sha256:...
```

This shows which config block matched and which key was offered. If the key is wrong, backtrack to your IdentityFile directive.

### Link to Troubleshooting

See [[ssh-tutorial|SSH Tutorial]] for additional troubleshooting steps and common SSH errors.

## Security Considerations

### Don't Commit Config with Private Hostnames to Public Repos

Your `~/.ssh/config` may contain internal hostnames, IP ranges, or proxy chains that reveal infrastructure. **Never commit it to a public GitHub repo.** If you must share config, scrub sensitive details:

```bash
# Save to a file, remove internal IPs and hostnames
sed 's/10\.0\..*/REDACTED/g' ~/.ssh/config > config-shareable
```

### Be Intentional with StrictHostKeyChecking

`StrictHostKeyChecking no` is convenient but dangerous:

```ini
Host *
    StrictHostKeyChecking no  # ❌ Not recommended
```

This accepts any key from any server, including man-in-the-middle attacks. Use only in **ephemeral CI/CD environments** where you control the infrastructure:

```ini
Host ci-runner-*.example.com
    StrictHostKeyChecking no  # OK in CI, where hostname is ephemeral
    UserKnownHostsFile /dev/null
```

For production and personal use, **stick with the default** (`StrictHostKeyChecking accept-new`), which accepts the first key but rejects changed ones:

```ini
Host prod-server
    HostName prod.example.com
    StrictHostKeyChecking accept-new  # Safe default
```

### Managing Config with Dotfiles Tools

Your `~/.ssh/config` is part of your environment. Consider managing it with:
- [[chezmoi-beginner-guide|Chezmoi]] — state-based, template-aware dotfiles manager
- [[dotfiles-beginner-guide|Dotfiles]] — simple version-controlled symlinks

Both let you version-control your config while keeping secrets (passphrases, private keys) out of the repository.

### Agent Forwarding Risks

`ForwardAgent yes` is convenient but risky:

```ini
Host work-server
    ForwardAgent yes  # SSH agent forwarded to remote
```

An attacker on `work-server` can abuse your agent to access **other servers you can SSH to**. Only enable it for truly trusted servers, or avoid it entirely and use `ProxyJump` instead:

```ini
Host internal-db
    ProxyJump bastion  # Safer than ForwardAgent
```

## Complete Example Config

Here's a realistic, well-commented `~/.ssh/config` pulling together multiple patterns:

```ini
# ============================================================================
# Personal SSH Config
# Generated: 2026-05-05
# Permissions: chmod 600 ~/.ssh/config
# ============================================================================

# GitHub — Personal Account
Host github-personal
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_personal
    IdentitiesOnly yes
    AddKeysToAgent yes

# GitHub — Work Account
Host github-work
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_work
    IdentitiesOnly yes
    AddKeysToAgent yes

# Work Bastion / Jump Host
Host work-bastion
    HostName bastion.work.example.com
    User admin
    IdentityFile ~/.ssh/id_ed25519_work
    IdentitiesOnly yes
    ServerAliveInterval 60

# Internal Servers (via Bastion)
Host work-internal-*
    ProxyJump work-bastion
    User deploy
    IdentityFile ~/.ssh/id_ed25519_work
    IdentitiesOnly yes

# Specific internal DB
Host work-db
    HostName db.internal
    User deploy
    ProxyJump work-bastion
    IdentityFile ~/.ssh/id_ed25519_work
    IdentitiesOnly yes
    RemoteCommand "cd /data && bash"

# HPC Cluster
Host hpc
    HostName hpc.university.edu
    User alice
    Port 2222
    IdentityFile ~/.ssh/id_ed25519_hpc
    IdentitiesOnly yes
    ServerAliveInterval 30
    ServerAliveCountMax 10
    RequestTTY yes

# SOCKS Proxy (for privacy on untrusted networks)
Host socks-proxy
    HostName proxy.example.com
    User alice
    DynamicForward 1080
    ServerAliveInterval 60

# Defaults for all hosts (at the bottom!)
Host *
    # Connection reuse (multiplexing) — huge speed boost for loops
    ControlMaster auto
    ControlPath ~/.ssh/sockets/%r@%h-%p
    ControlPersist 600
    
    # Keep alive
    ServerAliveInterval 60
    ServerAliveCountMax 3
    
    # Auth
    AddKeysToAgent yes
    UseKeychain yes
    PreferredAuthentications publickey,password
    PubkeyAcceptedAlgorithms ssh-ed25519,rsa-sha2-512,rsa-sha2-256
    
    # Security
    StrictHostKeyChecking accept-new
    
    # Logging
    LogLevel INFO
```

**Setup:**
```bash
# Create sockets directory for multiplexing
mkdir -p ~/.ssh/sockets
chmod 700 ~/.ssh/sockets

# Set config permissions
chmod 600 ~/.ssh/config

# Verify
ssh -G github-personal | head -10
```

## References

- **Official OpenSSH man pages:** `man ssh_config` — authoritative; covers every directive
- **OpenSSH source:** https://github.com/openssh/openssh-portable
- **Connection multiplexing guide:** https://superuser.com/questions/590808/how-to-speed-up-ssh-logins-by-reusing-tcp-connections
- **SSH Best Practices:** NIST SP 800-15 (though dated, still relevant for key management)

## Related Tutorials

- [[ssh-tutorial|SSH Tutorial]] — companion beginner guide
- [[linux-permissions-beginner-guide|Linux Permissions Beginner Guide]] — understanding 600, 700, etc.
- [[linux-permissions-deep-dive|Linux Permissions Deep Dive]] — deep dive on permissions
- [[mosh-beginner-guide|Mosh Beginner Guide]] — mobile shell; pairs well with SSH config for unstable connections
- [[mosh-deep-dive|Mosh Deep Dive]] — advanced Mosh usage
- [[dotfiles-beginner-guide|Dotfiles Beginner Guide]] — version-controlling your config
- [[dotfiles-deep-dive|Dotfiles Deep Dive]] — advanced dotfiles patterns
- [[chezmoi-beginner-guide|Chezmoi Beginner Guide]] — templated dotfiles management
- [[chezmoi-deep-dive|Chezmoi Deep Dive]] — secrets, templates, and sync strategies
- [[gh-cli-beginner-guide|GitHub CLI Beginner Guide]] — GitHub authentication via SSH or token
- [[gh-cli-deep-dive|GitHub CLI Deep Dive]] — advanced GitHub automation
- [[docker-test-container-beginner-guide|Docker Test Container Guide]] — SSH into containers
- [[kubernetes-beginner-guide|Kubernetes Beginner Guide]] — SSH tunnels to k8s clusters
- [[honeymux-beginner-guide|Honeymux Beginner Guide]] — terminal multiplexer over SSH
- [[sesh-beginner-guide|Sesh Beginner Guide]] — session management tool
- [[openmux-beginner-guide|OpenMux Beginner Guide]] — alternative mux
- [[hyperqueue-basics|HyperQueue Basics]] — HPC job scheduler; often uses SSH for cluster access
- [[git-worktrees-worktrunk-beginner-guide|Git Worktrees Beginner Guide]] — multiple worktrees; often SSHed to
- [[apache-nifi-hpc-sysadmin-beginner-guide|Apache NiFi HPC Sysadmin Guide]] — HPC workflows that rely on SSH


- [[maestri-beginner-guide|Maestri Beginner Guide]] — Infinite canvas for orchestrating terminals and AI agents; SSH config is essential for creating cluster terminal nodes
- [[maestri-deep-dive|Maestri Deep Dive]] — Advanced Maestri patterns including multi-cluster layouts and Floor-based isolation


- [[dtach-beginner-guide|Dtach Beginner Guide]] — lightweight session detach for resilient SSH workflows
- [[dtach-deep-dive|Dtach Deep Dive]] — dtach with ProxyJump, jump hosts, and scripted SSH sessions


- [[headscale-beginner-guide|Headscale Beginner Guide]] — self-hosted Tailscale control server; Headscale tunnels complement SSH for secure mesh networking
- [[headscale-deep-dive|Headscale Deep Dive]] — advanced Headscale ACLs, OIDC, and production deployment; SSH over Headscale tailnets

## Summary

**Key Takeaways:**

1. **`~/.ssh/config` is non-negotiable** if you SSH regularly. It eliminates typing, enables multiplexing, and makes multi-account workflows painless.

2. **Order matters:** first-match-wins. Specific hosts at the top, `Host *` defaults at the bottom.

3. **IdentitiesOnly yes is your friend** for multi-account setups (GitHub, GitLab, etc.). Without it, SSH tries agent keys in unpredictable order.

4. **Connection multiplexing** (`ControlMaster auto`, `ControlPath`, `ControlPersist`) is a game-changer. Set it globally under `Host *` and watch your loops accelerate 10-100x.

5. **ProxyJump replaces ProxyCommand** for jump hosts. Simpler, safer, more readable.

6. **Verify with `ssh -G hostname`** instead of guessing. This tool shows the effective resolved config.

7. **Permissions: 600.** Always. Non-negotiable.

8. **Security is intentional:** use `StrictHostKeyChecking accept-new` by default, reserve `no` for ephemeral CI only. Avoid `ForwardAgent` unless necessary; prefer `ProxyJump`.

**Must-Know Directives (in priority order):**
- `HostName`, `User`, `Port` — basics
- `IdentityFile`, `IdentitiesOnly` — key selection
- `ProxyJump` — jump hosts
- `ControlMaster`, `ControlPath`, `ControlPersist` — speed boost
- `ServerAliveInterval`, `ServerAliveCountMax` — keep-alives
- `StrictHostKeyChecking` — security

**Next Steps:**

1. Review your current `~/.ssh/config` (if it exists) against the recipes here.
2. Set up connection multiplexing under `Host *` and benchmark it.
3. If you have multiple GitHub/GitLab accounts, implement multi-account setup with `IdentitiesOnly yes`.
4. For HPC or bastion access, add `ProxyJump` and appropriate keep-alives.
5. Consider managing your config with [[chezmoi-beginner-guide|Chezmoi]] or [[dotfiles-beginner-guide|Dotfiles]] for version control and easy sync across machines.

Happy SSHing. Your future self will thank you.
