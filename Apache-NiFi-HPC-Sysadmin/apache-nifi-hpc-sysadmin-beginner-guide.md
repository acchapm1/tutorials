---
title: "Apache NiFi for HPC System Administrators: A Beginner's Guide"
date: 2026-04-10
difficulty: beginner
tags: [apache-nifi, hpc, slurm, beegfs, ceph, sysadmin, dataflow, automation]
---

# Apache NiFi for HPC System Administrators: A Beginner's Guide

## 1. Overview

Apache NiFi is an open-source **dataflow automation platform** that helps system administrators automate the movement and transformation of data across HPC systems. Originally developed by the NSA and donated to the Apache Software Foundation in 2014, NiFi provides a web-based graphical interface for designing data pipelines as directed graphs.

For HPC system administrators, NiFi is particularly valuable for:

- **Monitoring filesystems** and triggering actions when data appears (e.g., new simulation output)
- **Routing data between storage tiers** (HPC scratch → BeeGFS → Ceph S3 archive)
- **Automating job workflows** — submitting Slurm jobs, polling status, processing results
- **Coordinating data movement** across multiple systems without writing complex shell scripts
- **Sending notifications** when jobs complete or errors occur

In this beginner guide, you will learn:

- What a FlowFile is and how NiFi structures data
- How to install and start NiFi
- How to navigate the NiFi web UI
- How to build your first simple dataflow
- How to monitor a directory and move files automatically
- Practical examples with Slurm, BeeGFS, and Ceph S3

No prior NiFi experience is assumed. You should have basic Linux system administration knowledge and familiarity with command-line tools.

---

## 2. Prerequisites

Before starting, make sure you have:

- **A Linux system** — any HPC-relevant distribution (RHEL, Ubuntu, Debian, Rocky Linux, etc.). A virtual machine, container, or a spare compute node is fine.
- **Java 21 or later** — required by NiFi 2.x. Check with `java -version`.
- **Terminal/SSH access** — to download, install, and manage NiFi.
- **At least 2 GB of RAM** for a standalone NiFi instance; 8+ GB recommended if you plan to process large files.
- **Disk space** — NiFi maintains content, provenance, and flowfile repositories. Start with 10–20 GB for testing.
- **A web browser** — Chrome, Firefox, Safari, or Edge to access the NiFi UI.
- **Optional: Docker** — if you want to run NiFi in a container instead of bare metal.

---

## 3. Key Concepts

### FlowFile

A **FlowFile** is the fundamental unit of data in NiFi. Think of it as a packet carrying both a payload and metadata.

Every FlowFile has:

- **Content**: The actual data (file bytes, JSON response, command output, etc.), stored in NiFi's content repository on disk.
- **Attributes**: Metadata key-value pairs that travel with the FlowFile. Examples:
  - `filename` — the original filename (e.g., `experiment-2026-04-10.h5`)
  - `fileSize` — size in bytes
  - `path` — source directory path
  - `uuid` — globally unique identifier (auto-generated)
  - Custom attributes added by processors (e.g., `job.id`, `status`, `bucket`)

### Processor

A **Processor** is a worker that performs a specific task on one or more FlowFiles. NiFi ships with 400+ built-in processors. Common examples:

| Processor | What it does |
|-----------|--------------|
| `ListFile` | Monitors a directory and creates one FlowFile per matching file |
| `FetchFile` | Reads a file's content into a FlowFile |
| `PutS3Object` | Uploads a FlowFile to S3 or Ceph |
| `ExecuteProcess` | Runs a shell command (e.g., `sbatch`, `squeue`) |
| `InvokeHTTP` | Makes HTTP requests to REST APIs |
| `RouteOnAttribute` | Routes FlowFiles based on attribute values (e.g., job status) |
| `UpdateAttribute` | Adds or modifies FlowFile attributes |

Each processor has a **lifecycle**:

- **Stopped** — not running; you can configure it.
- **Running** — actively processing FlowFiles.
- **Invalid** — misconfigured; will not start.

### Connection

A **Connection** links the output of one processor to the input of another. Each connection maintains a **queue** of waiting FlowFiles. You can configure backpressure (pause upstream if the queue exceeds a threshold) and set queue expiration.

### Process Group

A **Process Group** is a container for organizing related processors and connections. You can nest Process Groups for hierarchical flow organization. Each Process Group can have:

- **Input Ports** — entry points for data
- **Output Ports** — exit points for data
- **Parameter Contexts** — environment-specific configuration (hostnames, paths, credentials)

---

## 4. Step-by-Step Instructions

### Step 1 — Download and Extract NiFi

```bash
# Download NiFi 2.8.0
cd /tmp
wget https://downloads.apache.org/nifi/2.8.0/nifi-2.8.0-bin.zip

# Verify the SHA512 checksum (optional but recommended)
wget https://downloads.apache.org/nifi/2.8.0/nifi-2.8.0-bin.zip.sha512
sha512sum -c nifi-2.8.0-bin.zip.sha512

# Extract to /opt/
unzip nifi-2.8.0-bin.zip -d /opt/

# Create a symlink for convenience
ln -s /opt/nifi-2.8.0 /opt/nifi
```

Expected output:
```
Archive:  nifi-2.8.0-bin.zip
  inflating: /opt/nifi-2.8.0/bin/nifi.sh
  inflating: /opt/nifi-2.8.0/bin/nifi-env.sh
  ...
```

### Step 2 — Set Security Credentials Before First Start

NiFi defaults to HTTPS and single-user authentication. Set your admin credentials before first run:

```bash
/opt/nifi/bin/nifi.sh set-single-user-credentials admin MySecurePassword123!
```

Expected output:
```
Updated login identity provider 'single-user-provider' in file ./conf/login-identity-providers.xml
```

**Requirements**: Username must be at least 4 characters, password at least 12 characters.

### Step 3 — Start NiFi

```bash
# Start NiFi in the background
/opt/nifi/bin/nifi.sh start

# Wait for it to initialize (up to 120 seconds)
/opt/nifi/bin/nifi.sh start --wait-for-init 120

# Check status
/opt/nifi/bin/nifi.sh status
```

Expected output:
```
NiFi running with PID 12345.
```

**Note**: First startup takes 30-60 seconds as NiFi generates HTTPS certificates and initializes repositories.

### Step 4 — Access the Web UI

Once running, open your browser and navigate to:

```
https://localhost:8443/nifi
```

Accept the self-signed certificate (browser may show a warning). Log in with:
- **Username**: `admin`
- **Password**: `MySecurePassword123!`

You should see the NiFi canvas — a blank white workspace ready for building flows.

### Step 5 — Stop NiFi

When you're done testing, stop NiFi cleanly:

```bash
/opt/nifi/bin/nifi.sh stop

# Check status
/opt/nifi/bin/nifi.sh status
```

Expected output:
```
NiFi is not running.
```

---

## 5. Practical Examples

### Example 1 — Monitor a Directory and Log File Names

**Goal**: Watch a directory and print any new filenames to the logs.

**Steps**:

1. In the NiFi UI, drag a **Processor** from the toolbar onto the canvas.
2. Search for and select `ListFile`.
3. Configure the processor:
   - Input Directory: `/tmp/incoming`
   - File Filter: `.*\.csv` (match `.csv` files only)
   - Minimum File Age: `10 sec` (skip files still being written)
4. Start the processor (press the play button).
5. Drag another **Processor** onto the canvas and select `LogMessage`.
6. Right-click `ListFile` → Connect → success (connect the green "success" arrow to `LogMessage`).
7. Start `LogMessage`.
8. Create a test file: `touch /tmp/incoming/test.csv`
9. Check the logs:
   ```bash
   tail -f /opt/nifi/logs/nifi-app.log | grep LogMessage
   ```

Expected behavior: After 10 seconds, the LogMessage processor logs a message with the filename.

### Example 2 — Copy Files from One Directory to Another

**Goal**: Monitor `/scratch/staging/` for new files and move them to `/scratch/archive/` when done.

**Steps**:

1. Drag `ListFile` onto the canvas. Configure:
   - Input Directory: `/scratch/staging/`
   - File Filter: `.*`
   - Minimum File Age: `30 sec`

2. Drag `FetchFile` and configure:
   - File to Fetch: `${absolute.path}` (uses the path from ListFile)
   - Completion Strategy: Move to Directory
   - Move Destination Directory: `/scratch/archive/`

3. Connect `ListFile` → success → `FetchFile`
4. Connect `FetchFile` → success → LogMessage (for verification)
5. Start all three processors.

**Behavior**: ListFile discovers files, FetchFile reads them, and moves the originals to archive.

### Example 3 — Submit a Slurm Job and Notify on Completion

**Goal**: When a job input file appears, submit a Slurm job and send a notification.

**Steps**:

1. Drag `ListFile`, configure to watch `/scratch/inputs/jobs/`.
2. Drag `ExecuteProcess`, configure:
   - Command: `/usr/bin/sbatch`
   - Command Arguments: `--job-name=nifi-job --ntasks=4 --mem=8G --time=00:30:00 /opt/scripts/process.sh`
3. Drag `ExtractText`, configure to extract the job ID:
   - Property name: `slurm.job.id`
   - Property value (regex): `Submitted batch job (\d+)`
4. Drag `PutSlack`, configure:
   - Webhook URL: (your Slack incoming webhook)
   - Message: `Job ${slurm.job.id} submitted!`
5. Connect: ListFile → ExecuteProcess → ExtractText → PutSlack
6. Start all processors.

**Behavior**: When a file arrives in `/scratch/inputs/jobs/`, a Slurm job is submitted and a Slack notification is sent with the job ID.

---

## 6. Hands-On Exercises

### Exercise 1 — Set Up a Simple File Watcher

1. Create test directories:
   ```bash
   mkdir -p /tmp/test-nifi/{input,output}
   ```

2. Build a flow:
   - `ListFile` (Input Directory: `/tmp/test-nifi/input/`) → `FetchFile` → `PutFile` (Directory: `/tmp/test-nifi/output/`)

3. Drop a test file into the input directory:
   ```bash
   echo "test data" > /tmp/test-nifi/input/sample.txt
   ```

4. Verify it appears in the output directory within 30 seconds.

5. Check NiFi logs to confirm no errors occurred.

### Exercise 2 — Route Files Based on Size

1. Create a flow: `ListFile` (watching `/tmp/test-nifi/input/`) → `RouteOnAttribute`

2. Configure `RouteOnAttribute` with two dynamic properties:
   - Property name: `small` → Value: `${fileSize:lt(1024)}`  (less than 1 KB)
   - Property name: `large` → Value: `${fileSize:ge(1024)}`  (1 KB or more)

3. Connect both outputs to separate `PutFile` processors (output to `/tmp/test-nifi/output-small/` and `/tmp/test-nifi/output-large/`)

4. Create test files of different sizes and verify they route correctly.

### Exercise 3 — Extract and Display File Metadata

1. Build a flow: `ListFile` → `UpdateAttribute` → `LogMessage`

2. In `UpdateAttribute`, add properties:
   - Property name: `file.info`
   - Value: `${filename} is ${fileSize} bytes, modified at ${file.lastModifiedTime}`

3. Configure `LogMessage` to log the `file.info` attribute.

4. Drop a file and check the logs for the metadata message.

### Exercise 4 — Monitor Real HPC Output

If you have access to an HPC cluster with BeeGFS:

1. Build a flow to monitor `/beegfs/scratch/jobs/` (or your equivalent path).
2. Use `ListFile` with:
   - File Filter: `.*\.out$` (match `.out` files only)
   - Minimum File Age: `60 sec`
3. Connect to `PutSlack` with a message: `Job output available: ${filename}`
4. When a real job completes and writes output, you'll receive a Slack notification.

---

## 7. Troubleshooting

### NiFi won't start

**Symptom**: `./nifi.sh start` hangs or returns an error.

**Diagnosis**:
- Check Java version: `java -version` (must be 21+)
- Check logs: `tail /opt/nifi/logs/nifi-bootstrap.log`
- Verify disk space: `df -h /opt/nifi` (ensure > 500 MB free)

**Fix**: Address the underlying issue (install Java, free disk space) and retry.

### UI shows "Invalid Processor" in red

**Symptom**: A processor appears red with an "X" badge.

**Cause**: Misconfiguration (missing required property, invalid directory path, etc.).

**Fix**: Right-click the processor → Configure. The validation summary shows what's wrong. Fix the property and revalidate.

### Files aren't being picked up by ListFile

**Symptom**: You drop a file in the directory, but ListFile doesn't create a FlowFile.

**Causes**:
- File is too new (doesn't meet Minimum File Age). ListFile ignores files younger than the threshold.
- File Filter regex doesn't match. Check the pattern against your filenames.
- Input Directory doesn't exist or is wrong. Verify the path exists and permissions are correct.

**Fix**:
- Verify: `ls -la /path/to/directory/`
- Reduce Minimum File Age to 0 for testing
- Test your regex pattern: `[[ "filename.csv" =~ .*\.csv ]] && echo match`

### Notifications not being sent

**Symptom**: PutSlack or PutEmail processors are running but no messages appear.

**Diagnosis**:
- Right-click processor → View bulletins (warnings/errors at top right)
- Check processor logs: Hamburger menu → Bulletin Board

**Common causes**:
- Invalid webhook URL or credentials
- Slack/email configuration is missing required fields
- Processor lacks input FlowFiles (connection not properly wired)

**Fix**: Verify credentials and re-test with a simple message first.

### NiFi crashes or becomes unresponsive

**Symptom**: NiFi process stops or becomes slow.

**Cause**: Insufficient memory or disk space.

**Diagnosis**:
- Check memory: `ps aux | grep nifi` → look at RSS column
- Check disk: `df -h /opt/nifi`
- Check heap usage: In UI, Hamburger menu → System Diagnostics

**Fix**:
- Increase JVM heap in `/opt/nifi/conf/bootstrap.conf`:
  ```properties
  java.arg.2=-Xms2g
  java.arg.3=-Xmx4g
  ```
- Restart NiFi for changes to take effect
- Free up disk space (delete old provenance data)

---

## 8. References

- [Apache NiFi Official Download](https://nifi.apache.org/download/)
- [Apache NiFi Getting Started Guide](https://nifi.apache.org/nifi-docs/getting-started.html)
- [Apache NiFi User Guide](https://nifi.apache.org/docs/nifi-docs/html/user-guide.html)
- [Apache NiFi Expression Language Guide](https://nifi.apache.org/docs/nifi-docs/html/expression-language-guide.html)
- [Apache NiFi System Administrator's Guide](https://nifi.apache.org/docs/nifi-docs/html/administration-guide.html)
- [NiFi Expression Language Functions](https://nifi.apache.org/docs/nifi-docs/html/expression-language-guide.html#functions)

---

## 9. Related Tutorials

- [[apache-nifi-beginner-guide|Apache NiFi Beginner Guide]]
- [[apache-nifi-hpc-sysadmin-deep-dive|Apache NiFi HPC Sysadmin Deep Dive]]
- [[kubernetes-beginner-guide]]
- [[linux-permissions-beginner-guide]]
- [[docker-beginner-guide]]

---

## Summary

**Key takeaways:**

- **NiFi is a dataflow platform** — it automates the movement and transformation of data via a graphical interface.
- **FlowFiles are data packets** — each carries content plus metadata attributes.
- **Processors do the work** — ListFile watches directories, FetchFile reads content, PutS3Object uploads, ExecuteProcess runs commands, etc.
- **Connections queue FlowFiles** — they link processor outputs to inputs, forming a directed graph.
- **The web UI is intuitive** — drag processors, right-click to configure, press play to start.
- **Start simple** — monitor a directory, transform a file, send a notification — then build from there.

**Next steps:**

- Explore the [[apache-nifi-hpc-sysadmin-deep-dive|Deep Dive guide]] to learn about clustering, Slurm integration, BeeGFS/Ceph integration, Kubernetes deployment, and advanced security.
- Build a complete HPC pipeline: monitor BeeGFS → submit Slurm job → upload results to Ceph S3 → notify on completion.
- Set up NiFi as a systemd service so it persists across reboots.
- Enable LDAP or Kerberos authentication for multi-user HPC environments.
- Integrate with your monitoring stack (Prometheus, Grafana, Slack).
