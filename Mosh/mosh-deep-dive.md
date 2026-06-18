---
title: Mosh (Mobile Shell) — Deep Dive Reference
date: 2026-04-16
difficulty: advanced
tags:
  - mosh
  - hpc
  - terminal
  - networking
  - ssh
  - tmux
---

# Mosh (Mobile Shell) — Deep Dive Reference

## Overview

Mosh (mobile shell) is a remote terminal client designed to handle mobile, high-latency, and unreliable network conditions—critical for HPC clusters, intercontinental links, and VPN-routed sessions. Unlike SSH's traditional byte-stream model, Mosh implements **State Synchronization Protocol (SSP)**, delivering responsive terminal interaction even across laggy, packet-losing networks.

This deep-dive targets experienced HPC users already proficient with SSH and tmux. We explore Mosh's architecture, internals, advanced configuration, integration with Slurm workflows, security implications, and performance tuning. Real-world patterns for multi-hop login sequences, session recovery, and firewall navigation are included.

**Target use cases:**
- Interactive login to distant HPC clusters (intercontinental, satellite, VPN)
- Resume sessions across network transitions (WiFi ↔ Ethernet)
- Long-running interactive jobs requiring responsive terminal
- Mobile-friendly HPC workflows

---

## Prerequisites

- **SSH expertise:** Familiar with SSH keys, known_hosts, jump hosts, ProxyJump
- **tmux or screen:** Session management fundamentals
- **HPC environment:** Access to Slurm scheduler, non-root user account
- **Networking basics:** UDP vs TCP, packet loss, latency, NAT, firewalls
- **macOS or Linux:** This guide covers macOS (local) + Linux HPC cluster (remote)
- **Shell:** bash or zsh; understanding of shell initialization files (.bashrc, .zshenv)
- **Package managers:** mamba (or conda), apt/yum/dnf familiarity

---

## Key Concepts

### State Synchronization Protocol (SSP)

SSH sends **raw byte streams** over TCP. Every keystroke is a packet; the server echoes it back. On a high-latency link (100 ms RTT), you wait 200 ms to see your keystroke—frustrating for interactive work.

**Mosh differs fundamentally:**

- **Client-side prediction:** The client locally echoes your input immediately, *before* the server responds. No waiting.
- **Diff-based synchronization:** Instead of sending/receiving raw bytes, Mosh sends *terminal state differences*. Compress a 80×24 screen to ~100 bytes of deltas.
- **Speculative rendering:** Client predicts what the server will display next (e.g., command output). When confirmation arrives, it atomically replaces speculation with truth.

**Result:** Responsiveness feels native even with 200+ ms latency.

### UDP Transport Layer

Mosh runs on **UDP** (stateless, connectionless) instead of TCP (connection-oriented, reliable).

**Why UDP?**

- **Sessionless:** Your session survives IP address changes (WiFi ↔ Ethernet). No TCP reestablishment needed.
- **Connectionless:** Simpler roaming. Mosh reconnects transparently when your IP changes.
- **Lower overhead:** No TCP retransmit timers or ACK storms on lossy links.

**Packet loss & reordering:**

Mosh numbers each SSP frame. Lost packets are skipped; reordered packets are resequenced on arrival. Unlike TCP's "stop and wait," Mosh continues streaming. Occasional frame loss ≠ session death.

**Port range:** 60000–61000 (client picks randomly from this range for privacy; server sends replies back to that port).

### Prediction Engine

Three components:

1. **Local echo:** Client immediately displays your keystrokes locally.
2. **Speculative rendering:** Client predicts server's terminal output (e.g., shell prompts, command formatting).
3. **Atomic replacement:** When server confirms, all speculation atomically snaps to ground truth.

**Modes (MOSH_PREDICTION_DISPLAY):**

- `always`: Always speculate (default, best responsiveness but can flicker on slow terminals).
- `never`: No speculation; wait for server. Feels like high-latency SSH.
- `adaptive`: Speculate only if RTT > threshold (experiment with RTT latency; default ~100 ms).
- `experimental`: Advanced heuristics (limited docs; for power users only).

### Authentication & Session Model

1. **SSH handshake:** `mosh user@host` initiates SSH login (uses your normal SSH key, known_hosts, ProxyJump, etc.).
2. **Server spawns mosh-server:** SSH executes `/usr/bin/mosh-server` (or custom path).
3. **Session key exchange:** Over SSH, mosh-server sends client a session key + UDP port.
4. **SSH disconnects:** The SSH tunnel closes; UDP SSP streams begin.
5. **UDP "session":** Client and server exchange SSP frames on the negotiated UDP port using the session key.

**Key insight:** Mosh authentication piggybacks on SSH. You can't use Mosh without SSH working first.

### Process Model

**Local (macOS):**
```
mosh-client  (PID 1234)
  └─ OpenSSH ssh (PID 1235, spawned during handshake, exits after key exchange)
     └─ (UDP datagrams stream asynchronously)
```

**Remote (Linux HPC):**
```
sshd
  └─ /bin/login
     └─ mosh-server (daemon, spawned by SSH_ORIGINAL_COMMAND)
        └─ /bin/bash (or login shell, with TTY)
```

The mosh-server runs as your user, manages the TTY, and echoes SSP frames back to the client.

---

## Step-by-Step Instructions

### 1. Install Mosh on Local Machine (macOS)

**Option A: Homebrew (recommended for macOS)**

```bash
brew install mosh
```

Verify:
```bash
mosh --version
```

Expected output:
```
mosh 1.4.0
```

**Option B: From source (if Homebrew unavailable)**

```bash
brew install pkg-config protobuf openssl

git clone https://github.com/mobile-shell/mosh.git
cd mosh
./autogen.sh
./configure --prefix=$HOME/.local
make
make install

export PATH="$HOME/.local/bin:$PATH"
mosh --version
```

### 2. Install Mosh on Remote Cluster (Linux, non-root)

**Option A: mamba/conda (conda-forge, recommended for HPC)**

```bash
mamba install -c conda-forge mosh
```

Verify:
```bash
mosh-server --version
```

**Option B: Build from source with home-directory prefix**

```bash
module load gcc  # Load compiler module if available

git clone https://github.com/mobile-shell/mosh.git
cd mosh
./autogen.sh
./configure --prefix=$HOME/.local --with-protobuf=$HOME/.local
make
make install

echo 'export PATH=$HOME/.local/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
mosh-server --version
```

**Option C: Pre-built static binary (portability across compute nodes)**

Download a static binary for your architecture from [Mosh releases](https://github.com/mobile-shell/mosh/releases) and place in `$HOME/.local/bin`.

```bash
mkdir -p ~/.local/bin
wget https://github.com/mobile-shell/mosh/releases/download/mosh-1.4.0/mosh-1.4.0-static.tar.gz
tar -xzf mosh-1.4.0-static.tar.gz -C ~/.local/bin
chmod +x ~/.local/bin/mosh-*
```

### 3. Initial Connection

```bash
mosh user@cluster.hpc.edu
```

On first run, mosh:
1. Spawns SSH to `user@cluster.hpc.edu` (uses your SSH key).
2. SSH runs `mosh-server` on the cluster.
3. Server reports back the UDP port and session key.
4. SSH closes; UDP session begins.
5. You're in your remote shell.

**Expected output:**

```
[mosh-server connection closed.]

You have mail.
user@cluster:~$
```

(The "connection closed" message is normal—it confirms SSH handed off to UDP.)

### 4. Verify UDP Connectivity

From your local machine, check if the mosh-server's UDP port is reachable:

```bash
nc -uz cluster.hpc.edu 60001  # Example port; replace with actual
```

Expected output:
```
Connection successful
```

If it times out or fails, the firewall may block mosh (see **Troubleshooting**).

### 5. Disconnect & Resume

**Suspend mosh session (without terminating):**

Press **Ctrl+Z** to suspend the session (if your terminal supports it, or use SSH escape sequences).

Alternatively, disconnect your network:
- Close the laptop; join a new WiFi; reconnect.
- Mosh auto-reconnects to the same mosh-server instance (if it's still alive).

**Resume the session:**

```bash
mosh user@cluster.hpc.edu
```

Mosh detects the existing mosh-server and reconnects. Your shell session, shell history, and running jobs are intact.

**Clean up stale mosh-server processes (after network failure):**

```bash
pkill -f "mosh-server" 2>/dev/null
```

Or set a cron job to clean up orphaned processes (see **Troubleshooting**).

---

## Practical Examples

### Example 1: Mosh + tmux for Long-Running HPC Jobs

Scenario: You're on a laptop, working on an HPC cluster. You need to submit a Slurm job, monitor it interactively, and survive network outages.

**Setup tmux on the cluster:**

```bash
# On the cluster login node
tmux new-session -s work
```

**From your laptop, connect via Mosh:**

```bash
mosh user@cluster.hpc.edu
```

**Inside mosh, attach or create tmux:**

```bash
# If tmux session exists, attach
tmux attach -t work

# Or create a new one
tmux new-session -s interactive
```

**Submit a job and monitor:**

```bash
# Inside tmux
salloc -N 1 -t 1:00:00 -q interactive
# Now you're on a compute node with an interactive allocation

# Run a long-running task
python3 train_model.py --epochs=100
```

**Network dies (WiFi drops):**

- Mosh client detects UDP silence after ~3 seconds.
- mosh-server continues running on the cluster (still connected to the tmux session).
- Your training job keeps running.

**Reconnect:**

```bash
mosh user@cluster.hpc.edu
# Automatically attaches to the same tmux session
tmux attach -t interactive
```

Your terminal scrollback, job output, and shell history are intact.

### Example 2: SSH Tunneling Through Jump Host

Scenario: The cluster is only accessible through a jump host; direct UDP from your laptop won't work.

**Using ProxyJump with Mosh:**

```bash
mosh -a --server=mosh-server -- user@cluster.hpc.edu \
  -o ProxyJump=jump.organization.org -o ProxyUseFdpass=yes
```

**Or, configure in ~/.ssh/config:**

```
Host cluster.hpc.edu
  User myuser
  ProxyJump jump.organization.org
  StrictHostKeyChecking=accept-new

Host jump.organization.org
  User myuser
  StrictHostKeyChecking=accept-new
```

Then:

```bash
mosh user@cluster.hpc.edu
```

Mosh uses the SSH ProxyJump to establish the initial connection, then UDP takes over from the cluster itself (not the jump host).

**Note:** UDP from the cluster back to your laptop must traverse the jump host's firewall. This is usually fine—the jump host doesn't need to route UDP, just TCP to set up the SSH tunnel.

### Example 3: Performance Tuning for Satellite Link (High Latency)

Scenario: You're on a satellite link with 500 ms RTT but low packet loss.

**Set prediction mode to `always`:**

```bash
MOSH_PREDICTION_DISPLAY=always mosh user@cluster.hpc.edu
```

All keystrokes are immediately echoed locally; the server's confirmation follows later. Feels responsive despite the high latency.

**Monitor actual RTT:**

Inside mosh, check the status bar (bottom right, if enabled in mosh config):

```
RTT: 523ms  UDP  [some]  ▔▔▔▔▔▔
```

**Disable scrollback temporarily (large scrollback slows prediction on huge output):**

```bash
MOSH_SERVER_WRITE_TIMEOUT=1000 mosh user@cluster.hpc.edu
```

---

## Hands-On Exercises

### Exercise 1: Verify SSP Diffing in Action

**Goal:** Observe that Mosh sends terminal state diffs, not raw bytes.

1. **On local machine, enable MOSH_LOG:**

```bash
export MOSH_LOG=/tmp/mosh_debug.log
mosh user@cluster.hpc.edu
```

2. **Inside mosh, type slowly:**

```bash
echo "hello"
```

3. **Exit mosh and inspect the log:**

```bash
# After exiting mosh
tail -n 100 /tmp/mosh_debug.log | grep -i "frame\|diff"
```

You'll see references to SSP frames with terminal state checksums and deltas—not raw keystroke bytes.

### Exercise 2: Network Failover Test

**Goal:** Confirm mosh reconnects after IP change.

1. **Start mosh session:**

```bash
mosh user@cluster.hpc.edu
```

2. **Inside mosh, start a long-running task:**

```bash
watch -n 1 uptime
```

3. **Kill the mosh-client process (from another terminal):**

```bash
# On local machine, in another terminal
pkill -f "mosh-client"
```

4. **Watch the original mosh window:** It should freeze (waiting for client reconnection).

5. **Reconnect:**

```bash
mosh user@cluster.hpc.edu
```

6. **Observe:** The `watch` command continues running; no output was lost.

### Exercise 3: Benchmark Mosh vs SSH Latency

**Goal:** Measure interactive responsiveness.

**Setup:** On the cluster, create a simple script:

```bash
cat > ~/latency_test.sh << 'EOF'
#!/bin/bash
for i in {1..10}; do
  date +%s%N
  sleep 0.1
done
EOF
chmod +x ~/latency_test.sh
```

**Via SSH:**

```bash
time ssh user@cluster.hpc.edu '~/latency_test.sh'
```

**Via Mosh:**

```bash
time mosh user@cluster.hpc.edu '~/latency_test.sh'
```

Mosh should be noticeably faster if the RTT is high (>50 ms) due to local prediction.

### Exercise 4: Explore UDP Port Dynamics

**Goal:** Understand the UDP port negotiation.

1. **Start mosh with verbose SSH output:**

```bash
mosh --verbose user@cluster.hpc.edu 2>&1 | head -n 50
```

Look for lines like:

```
MOSH_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx MOSH_SERVER=cluster.hpc.edu MOSH_PORT=60847
```

2. **Note the port number.**

3. **In another terminal, use netstat/ss to monitor:**

```bash
watch -n 0.5 'ss -u | grep 60847'
```

You'll see UDP datagrams flowing between your local port and the remote server's port.

### Exercise 5: Locale & UTF-8 Verification

**Goal:** Confirm Mosh handles multi-byte characters correctly.

1. **Ensure remote and local have matching UTF-8 locale:**

```bash
# Local
locale | grep UTF

# Inside mosh
locale | grep UTF
```

Both should show `en_US.UTF-8` (or similar).

2. **Test multi-byte characters:**

```bash
echo "Hello 世界 مرحبا мир"
```

Output should display correctly without mojibake.

---

## Troubleshooting

### Issue: "mosh-server not found" on Cluster

**Symptom:**

```
[mosh server: not found]
```

**Causes:**

- Mosh not installed on cluster.
- Mosh installed in a non-standard location; not in PATH.
- Module system in use; mosh module not loaded.

**Solutions:**

1. **Install mosh (see **Installation** above).**

2. **If installed but not in PATH:**

```bash
# Find mosh-server
find $HOME -name mosh-server 2>/dev/null

# Add to .bashrc
echo 'export PATH=$HOME/.local/bin:$PATH' >> ~/.bashrc
```

3. **If in a module:**

```bash
# In mosh invocation, specify full path
mosh --server=/path/to/mosh-server user@cluster.hpc.edu
```

Or:

```bash
# In ~/.bashrc on cluster
module load mosh  # or relevant module
```

### Issue: UDP Port Not Reachable (Firewall Blocks Mosh)

**Symptom:**

```
[mosh server: exited abnormally]
```

Or connection hangs after SSH handshake.

**Diagnosis:**

From local machine:

```bash
# Test UDP connectivity to the cluster
nc -uz cluster.hpc.edu 60000
# Timeout or connection refused indicates firewall block

# Try with mosh's preferred port range
for port in {60000..60010}; do
  nc -uz -w1 cluster.hpc.edu $port && echo "Port $port open"
done
```

**Solutions:**

1. **Ask cluster admin to open UDP port range 60000–61000** to your source IP (preferred).

2. **SSH tunnel as workaround (last resort):**

```bash
ssh -L 6000:localhost:60000 user@cluster.hpc.edu &
mosh --server="mosh-server --port=60000" localhost
```

(This defeats some of Mosh's benefits but works in restricted environments.)

### Issue: Protobuf Version Mismatch

**Symptom:**

```
error: mosh-server: error while loading shared libraries: libprotobuf.so.32: cannot open shared object file
```

**Cause:** Client and server compiled against different protobuf versions.

**Solutions:**

1. **Recompile server against matching protobuf:**

```bash
# On cluster
cd ~/mosh
./configure --prefix=$HOME/.local \
  --with-protobuf=$HOME/.local
make clean
make
make install
```

2. **Or, static-link mosh-server:**

```bash
./configure --prefix=$HOME/.local \
  --enable-static-protobuf
make
make install
```

### Issue: Stale mosh-server Processes Accumulating

**Symptom:** After network failures, orphaned mosh-server processes consume resources.

**Solution: Automated cleanup cron job**

```bash
# Add to crontab
cat >> ~/.crontab << 'EOF'
# Every hour, kill mosh-servers inactive for >6 hours
0 * * * * pkill -f "mosh-server" -o -amin +360 2>/dev/null
EOF

crontab ~/.crontab
```

Or, manually:

```bash
ps aux | grep mosh-server
kill -9 <PID>
```

### Issue: Poor Performance or Flicker with Speculative Rendering

**Symptom:** Terminal flickers or redraw is slow despite low latency.

**Causes:**

- Prediction mode set too aggressively (mosh guessing incorrectly).
- Large terminal size or slow rendering.
- High scrollback buffer.

**Solutions:**

1. **Disable speculation temporarily:**

```bash
MOSH_PREDICTION_DISPLAY=never mosh user@cluster.hpc.edu
```

2. **Use adaptive mode:**

```bash
MOSH_PREDICTION_DISPLAY=adaptive mosh user@cluster.hpc.edu
```

3. **Reduce scrollback in tmux:**

```bash
# In ~/.tmux.conf
set -g history-limit 2000  # Default is often 2000 anyway
```

### Issue: Locale Errors (garbled UTF-8)

**Symptom:**

```
Error: Please set the LANG environment variable to en_US.UTF-8 or similar
```

**Solution:**

```bash
# On local machine
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

# Or on remote, in ~/.bashrc
export LANG=en_US.UTF-8

# Then reconnect
mosh user@cluster.hpc.edu
```

---

## Advanced Configuration & Patterns

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `MOSH_PREDICTION_DISPLAY` | `adaptive` | Prediction mode: `always`, `never`, `adaptive`, `experimental` |
| `MOSH_SERVER_NETWORK_TIMEOUT` | `60` | Seconds of UDP silence before server exits |
| `MOSH_SERVER_SIGNAL_TIMEOUT` | `5` | Seconds before signal (TERM/KILL) escalates |
| `MOSH_CLIENT_NETWORK_TIMEOUT` | `60` | Client-side timeout |
| `MOSH_LOG` | (unset) | Path to debug log file (verbose) |

**Example:**

```bash
export MOSH_PREDICTION_DISPLAY=always
export MOSH_SERVER_NETWORK_TIMEOUT=120
mosh user@cluster.hpc.edu
```

### Custom mosh-server Path

Useful if mosh-server is in a non-standard location:

```bash
mosh --server=$HOME/.local/bin/mosh-server user@cluster.hpc.edu
```

Or, in ~/.ssh/config:

```bash
Host cluster.hpc.edu
  User myuser
  RemoteCommand $HOME/.local/bin/mosh-server
```

### Mosh + SSH Multiplexing (ControlMaster)

Mosh itself doesn't use SSH after the initial handshake, but you can optimize the handshake:

```bash
Host cluster.hpc.edu
  ControlMaster auto
  ControlPath ~/.ssh/control-%h-%p-%r
  ControlPersist 600
```

This caches the SSH connection for 10 minutes, speeding up subsequent Mosh connections.

### Advanced .tmux.conf for HPC

```bash
# Optimized for HPC + Mosh
set -g default-terminal "tmux-256color"
set -g history-limit 5000
set -g mouse on

# Status bar shows hostname and current node
set -g status-right "#{user}@#h | %a %b %d %H:%M"

# Aggressive resize (useful for multi-hop sessions)
setw -g aggressive-resize on

# Enable focus events (helps Mosh prediction)
set -g focus-events on

# Scrollback keys (macOS: Shift+PageUp/Down)
bind -n S-PageUp send-keys -X copy-mode -u
bind -n S-PageDown send-keys -X paste-buffer
```

### Nested Mosh + tmux Workflow

Advanced users sometimes run tmux both locally and remotely:

```
Local (macOS)
  └─ tmux (Session A: local files, editors)
  └─ mosh (connects to cluster)
       └─ tmux (Session B: remote job monitoring)
```

**Avoid confusion:**

- Local tmux uses `Ctrl+A` (change bind key in .tmux.conf).
- Remote tmux uses `Ctrl+B` (default).
- Or, use tmux plugins like `tmux-resurrect` to manage both sessions.

---

## Mosh in Slurm Workflows (Advanced)

### Typical HPC Multi-Hop Workflow

```
Laptop (mosh-client)
  ↓ (UDP)
Cluster login node (mosh-server + tmux)
  ↓ (SSH, local)
Compute node (allocated via salloc)
  ↓ (local terminal)
Running job (sbatch, srun, or interactive shell)
```

**Step-by-step:**

1. **From laptop, Mosh to login node:**

```bash
mosh user@cluster.hpc.edu
```

2. **On login node, start tmux session:**

```bash
tmux new-session -s work
```

3. **Inside tmux, allocate a compute node:**

```bash
salloc -N 1 -t 2:00:00 -q gpu  # Allocate 1 GPU node for 2 hours
# Now you're on compute-node-42
```

4. **Run interactive job:**

```bash
python3 << 'EOF'
import torch
for i in range(100):
    x = torch.randn(1000, 1000).cuda()
    y = x @ x
    if i % 10 == 0:
        print(f"Iteration {i}: sum={y.sum().item()}")
EOF
```

5. **Network dies; reconnect:**

```bash
# On laptop (new network)
mosh user@cluster.hpc.edu
# Automatically in same tmux session, on the same compute node
```

### Why Mosh Can't Connect Directly to Compute Nodes

Compute nodes are typically behind login-node firewalls and don't have public IP addresses. UDP from your laptop can't route to them. Solutions:

1. **Mosh via login node + SSH to compute:** (Recommended)

   - Mosh handles the login-node connection (handles IP changes, high latency).
   - SSH to compute from login is fast and local (same cluster network).

2. **VPN tunnel:** If your cluster has a VPN, connect first.

3. **Proxy through login:** Custom SSH ProxyCommand can tunnel UDP, but it's complex.

### Automating Compute-Node Reattach

Create shell functions for quick reattachment:

```bash
# Add to ~/.bashrc on cluster
function mosh-gpu() {
  # Check if GPU job allocation exists
  if squeue -u $USER -h --format="%N" | grep -q "gpu-node"; then
    node=$(squeue -u $USER -h --format="%N" | head -1)
    ssh $node
  else
    echo "No active GPU allocation. Starting salloc..."
    salloc -N 1 -t 2:00:00 -q gpu
  fi
}

function mosh-resume() {
  # Reattach to most recent tmux session
  tmux attach -t $(tmux list-sessions -F "#{session_name}" | tail -1)
}
```

Then:

```bash
# From laptop
mosh user@cluster.hpc.edu
# On login node
mosh-gpu  # Allocates GPU or reconnects
mosh-resume  # Reattach to tmux
```

---

## Security Considerations

### Encryption: AES-128-OCB

The UDP data stream uses **AES-128-OCB** (authenticated encryption):

- **Key derivation:** The session key (256 bits) is generated during SSH handshake and shared securely.
- **Per-packet authentication:** Each SSP frame includes an authentication tag, preventing tampering.
- **Nonce:** Derived from frame sequence number (monotonically increasing).

**Security note:** AES-128-OCB is strong but not post-quantum. For highly sensitive work, ask your cluster admin about Mosh + TLS overlay (not standard).

### Key Exchange Mechanism

1. SSH establishes authenticated channel to mosh-server.
2. Server generates 256-bit session key.
3. mosh-server sends key to client over SSH (encrypted by SSH layer).
4. SSH closes; UDP uses the session key.

**No key re-exchange after handshake.** Long-lived sessions (days) use the same key. Consider periodic reconnection for maximum security.

### Attack Surface vs SSH

| Threat | SSH | Mosh |
|--------|-----|------|
| Man-in-the-middle (MITM) on TCP | Mitigated by TCP/IP stack, TLS layer | Mitigated by AES-128-OCB; UDP less scrutinized |
| Eavesdropping | SSH encryption | AES-128-OCB encryption |
| UDP amplification DDoS | N/A | Possible if server is exposed; mitigate via firewall |
| Packet injection/replay | TCP checksums, sequence numbers | OCB auth tags prevent tampering; sequence numbers prevent replay |
| Key compromise | Attacker can decrypt past & future traffic | Session key used for one session only (though key is not rotated) |

**Cluster hardening:**

1. **Restrict UDP port range:** Only allow 60000–61000 from trusted subnets.

```bash
# On firewall / cluster border
ufw allow from <your_subnet> to any port 60000:61000 proto udp
```

2. **Monitor for UDP amplification:** Check for large outbound UDP from cluster.

```bash
# On cluster login node
iftop -n
```

3. **Audit trail:** mosh-server logs to syslog (if enabled). Check `/var/log/auth.log` or similar.

```bash
grep mosh-server /var/log/auth.log
```

---

## Performance Tuning

### Prediction Modes Deep-Dive

**`always`** (Default for high-latency networks)

- Pros: Maximum responsiveness on laggy links (>100 ms RTT).
- Cons: Occasional flicker if prediction is wrong (e.g., command with unexpected output).
- Use case: Satellite, intercontinental, VPN.

**`never`**

- Pros: No flicker; always ground truth.
- Cons: Feels sluggish on high-latency links (wait for server echo on every keystroke).
- Use case: LAN, low-latency links (<30 ms).

**`adaptive`**

- Pros: Best of both—speculate only if RTT > ~100 ms.
- Cons: Slight overhead to measure RTT.
- Use case: Mixed networks (sometimes fast, sometimes slow).

**`experimental`**

- Pros: Advanced heuristics (undocumented).
- Cons: May be unstable; intended for testing only.
- Use case: Power users only; file a GitHub issue if it helps.

**Testing prediction modes:**

```bash
# Measure responsiveness with always
time (echo "hello" | mosh user@cluster.hpc.edu)

# Repeat with never
MOSH_PREDICTION_DISPLAY=never time (echo "hello" | mosh user@cluster.hpc.edu)

# Compare results
```

### Latency Benchmarking

**Simple RTT test:**

```bash
# Inside mosh session, monitor the status bar
# Bottom-right should show "RTT: Xms"

# Or, via command-line
mosh --version 2>&1 | grep -i "rtt\|latency"  # Limited info

# More precise: use ping on the UDP port (requires nping)
nping -c 3 cluster.hpc.edu --source-port 60000 --dest-port 60001 -u
```

### Bandwidth Usage

Mosh transmits only **terminal state deltas**, much smaller than SSH's byte stream.

**Rough comparison over 1 hour:**

- **SSH:** 10–50 MB (typing, echoing, periodic output)
- **Mosh:** 1–5 MB (sparse terminal updates)

This makes Mosh efficient on metered connections (mobile, satellite).

### Scrollback & Terminal Size

Large scrollback or huge terminal dimensions slow prediction:

```bash
# Reduce scrollback in mosh-server
export MOSH_SERVER_TERMINAL_ROWS=24
export MOSH_SERVER_TERMINAL_COLS=80

mosh user@cluster.hpc.edu
```

Or, in ~/.tmux.conf:

```bash
set -g default-shell /bin/bash
bind C-l send-keys "clear" C-m  # Quick clear to reduce scrollback impact
```

---

## Comparison with Alternatives

| Tool | Transport | Session Roaming | Latency Feel | Setup | Best For |
|------|-----------|-----------------|--------------|-------|----------|
| **SSH** | TCP | No (reconnect required) | Laggy (>50 ms) | Simple | LAN, fast networks, one-off commands |
| **Mosh** | UDP | Yes (transparent roaming) | Responsive even at 200+ ms | Medium (install) | Mobile, high-latency, HPC interactive |
| **Eternal Terminal** | TCP + mosh-like features | Yes | Responsive | Complex (requires ET server) | Power users, extreme environments |
| **autossh** | SSH wrapper | Restart on disconnect | Laggy (still SSH) | Simple | Fragile networks, but wants SSH feel |
| **tmux alone** | Local, no network | Yes (local only) | Native | Simple | Local multi-window work |
| **tmux + SSH** | SSH carrying tmux | No (SSH dies) | Laggy on high-latency | Medium | Balance of simplicity & recovery |

**Decision matrix:**

- **Low latency (<30 ms), reliable network:** SSH + tmux
- **High latency (>100 ms), mobile:** Mosh + tmux
- **Satellite/intercontinental:** Mosh + tmux, tuned for latency
- **Extreme environments (restricted UDP, custom auth):** Eternal Terminal or SSH + VPN

---

## Quick Reference Card

### Common Invocations

```bash
# Simple connection
mosh user@cluster.hpc.edu

# With custom mosh-server path
mosh --server=$HOME/.local/bin/mosh-server user@cluster.hpc.edu

# With prediction tuning
MOSH_PREDICTION_DISPLAY=always mosh user@cluster.hpc.edu

# Via ProxyJump
mosh user@cluster.hpc.edu -o ProxyJump=jump.example.com

# Verbose debugging
mosh --verbose user@cluster.hpc.edu 2>&1 | head -50

# Test UDP connectivity
nc -uz cluster.hpc.edu 60000
```

### Key Environment Variables

```bash
MOSH_PREDICTION_DISPLAY=always|never|adaptive|experimental
MOSH_SERVER_NETWORK_TIMEOUT=60  # Seconds
MOSH_SERVER_SIGNAL_TIMEOUT=5
MOSH_LOG=/tmp/debug.log
```

### Troubleshooting Checklist

- [ ] `mosh --version` works locally
- [ ] `ssh user@cluster.hpc.edu` works (test SSH first)
- [ ] `nc -uz cluster.hpc.edu 60000` succeeds (UDP open?)
- [ ] `.bashrc` on cluster exports PATH including mosh-server
- [ ] LANG/LC_ALL set to UTF-8
- [ ] Firewall allows UDP 60000–61000 from your IP
- [ ] No stale mosh-server processes (pkill old ones)

---

## Related Tutorials

- [[dotfiles-beginner-guide]] and [[dotfiles-deep-dive|dotfiles deep-dive]] — Configuring shell initialization files (.bashrc, .zshenv, .ssh/config)
- [[sesh-beginner-guide]] and [[sesh-deep-dive|sesh deep-dive]] — Terminal session management and multiplexers
- [[linux-permissions-beginner-guide]] and [[linux-permissions-deep-dive|linux permissions deep-dive]] — Understanding user-space installations and permissions
- [[mosh-beginner-guide]] — Quick-start guide to Mosh for first-time users
- [[kubernetes-deep-dive]] — Container and network concepts relevant to Mosh in containerized HPC

---

## Summary

Mosh (Mobile Shell) represents a paradigm shift from SSH's byte-stream model to a responsive, state-synchronized protocol built on UDP. For experienced HPC users working across high-latency, mobile, or unreliable networks, Mosh delivers:

- **Responsiveness:** Local prediction eliminates keystroke latency, even on intercontinental links.
- **Roaming:** Network transitions (WiFi ↔ Ethernet, IP change) reconnect transparently.
- **Efficiency:** Terminal state deltas use far less bandwidth than SSH's byte-stream.
- **Simplicity:** Layers atop SSH's proven authentication, requiring no cluster admin privileges.

**Key takeaways:**

1. Understand the **SSP architecture**—terminal state, not bytes.
2. **Install on both local and cluster** using mamba/conda or from source.
3. Pair Mosh with **tmux** for session persistence and recovery.
4. **Tune prediction modes** for your network latency.
5. Use **Mosh + SSH ProxyJump** for jump-host scenarios.
6. Monitor **UDP connectivity**; firewall restrictions are the main barrier.
7. **Security is strong** (AES-128-OCB) but understand the implications of long-lived sessions.

For HPC workflows combining interactive development, monitoring, and job submission, Mosh is a powerful tool that transforms the remote-work experience. Start with simple connections, then progressively adopt advanced patterns (tmux nesting, Slurm integration, performance tuning) as your confidence grows.

**Further exploration:**

- Inspect MOSH_LOG for protocol internals.
- Experiment with Eternal Terminal for even more advanced scenarios.
- Contribute to [Mosh GitHub](https://github.com/mobile-shell/mosh) if you find issues.

---

*Last updated: 2026-04-16*
# Related Tutorials

- [[openmux-beginner-guide|OpenMux Beginner Guide]] and [[openmux-deep-dive|OpenMux Deep Dive]] — modern terminal multiplexer alternative to tmux

- [[micropython-ttgo-t-display-beginner-guide|MicroPython TTGO T-Display Beginner Guide]] — IoT device development where persistent remote access matters
- [[micropython-ttgo-t-display-deep-dive|MicroPython TTGO T-Display Deep Dive]] — remote embedded development workflows

- [[hyperqueue-basics|HyperQueue Basics]] — HPC meta-scheduler for managing tasks over remote HPC connections
- [[hyperqueue-deep-dive|HyperQueue Deep Dive]] — production task scheduling on Slurm clusters

- [[honeymux-beginner-guide|Honeymux Beginner Guide]] and [[honeymux-deep-dive|Honeymux Deep Dive]] — TUI wrapper for tmux with SSH pane stitching for remote work
- [[docker-test-container-deep-dive|Docker Test Container Deep Dive]] — test remote connection configs in containers
- [[ssh-tutorial|SSH Tutorial]]
- [[ssh-config-deep-dive|SSH Config Deep Dive]]
- [[dtach-beginner-guide|Dtach Beginner Guide]] — minimal session persistence to pair with Mosh's connection resilience
- [[dtach-deep-dive|Dtach Deep Dive]] — advanced dtach usage including the Mosh + dtach + tmux stack

- [[tmux-claude-code-beginner-guide|Tmux + Claude Code Beginner Guide]] — tmux + Claude Code fundamentals
- [[tmux-claude-code-deep-dive|Tmux + Claude Code Deep Dive]] — Mosh + tmux + Claude Code remote workflow patterns

- [[pixi-beginner-guide|Pixi Beginner Guide]] — Modern conda/PyPI package manager (alternative to mamba for installing tools like Mosh)
- [[pixi-deep-dive|Pixi Deep Dive]] — Advanced pixi patterns including HPC deployment
- [[uv-beginner-guide|uv Beginner Guide]] — Fast Python-only package manager by Astral
- [[uv-deep-dive|uv Deep Dive]] — Advanced uv workflows for Python projects

- [[headscale-beginner-guide|Headscale Beginner Guide]] — self-hosted WireGuard mesh VPN; Mosh works well over Headscale tailnets for persistent remote access
- [[headscale-deep-dive|Headscale Deep Dive]] — advanced Headscale with DERP relays and subnet routing; complements Mosh for reliable remote sessions

- [[herdr-beginner-guide|Herdr Beginner Guide]] — agent multiplexer for remote agent management via Mosh+SSH