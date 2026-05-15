---
title: "Apache NiFi: A Beginner's Guide"
date: 2026-04-10
difficulty: beginner
tags: [apache-nifi, data-flow, automation, etl, workflow, processors, flowfiles]
---

# Apache NiFi: A Beginner's Guide

## 1. Overview

Apache NiFi is a **visual data flow automation platform** that lets you build pipelines to move, transform, and route data between systems without writing code. Instead of managing a tangle of shell scripts, cron jobs, and manual data transfers, NiFi gives you a graphical canvas where you can drag and drop processors, connect them, and see exactly what your data is doing in real time.

For someone new to data integration, think of NiFi as a visual programming tool: each processor is a building block that does one thing well, and you connect them together to create powerful workflows. The built-in audit trail (Data Provenance) lets you trace every byte of data through your pipeline — invaluable for debugging and compliance.

In this guide you will learn:

- What NiFi is and why it matters for data workflows
- The six core concepts that power everything: FlowFiles, Processors, Connections, Process Groups, Controller Services, and Data Provenance
- How to install and start NiFi on your system
- How to navigate the web UI
- How to build your first working flow
- How to use practical processors for real data movement tasks

No prior experience with data integration tools is required.

---

## 2. Prerequisites

Before starting, make sure you have:

- **Java 21 or later installed** — NiFi requires a modern Java environment. Check with `java -version`.
- **A Linux, macOS, or Windows system** — anywhere you can download and extract software and run commands in a terminal.
- **Network access** — you will run NiFi on localhost or a server and access it via a web browser.
- **About 500 MB disk space** — for the NiFi application and its repositories.
- **Basic command-line familiarity** — you should be comfortable opening a terminal and running commands like `cd`, `mkdir`, and executable files.
- **A web browser** — modern Chrome, Firefox, Safari, or Edge to access the NiFi UI.

If you are on a restricted corporate network, ensure HTTPS (port 8443) is accessible on your local machine.

---

## 3. Key Concepts

Before touching the UI, understand these six building blocks. Everything in NiFi is built from these foundational ideas.

### FlowFile

The fundamental unit of data in NiFi. A **FlowFile** is a reference to actual content (stored safely on disk) plus a set of **attributes** — key/value metadata that travels with the data.

Think of a FlowFile like a postal envelope: the envelope contains the letter (the content) and also has labels on it (the attributes) that describe what's inside — who it came from, where it's going, etc.

| Attribute | What it means | Example |
|---|---|---|
| `filename` | Original filename | `dataset.csv` |
| `path` | Directory path | `/home/user/data` |
| `uuid` | Unique ID for this FlowFile | `a1b2c3d4-...` |
| `fileSize` | Size in bytes | `1024000` |

You can add your own attributes as the FlowFile moves through your flow — for example, `processed.time`, `source.cluster`, or `job.status`.

### Processor

A **Processor** is a worker that reads FlowFiles from an input queue, does some specific job (read a file, copy to S3, transform content, run a command), and sends the result to output relationships (usually `success`, `failure`, etc.).

Think of processors as assembly-line workers: each one has a single, focused job. There are 400+ built-in processors in NiFi for common data tasks.

### Connection

A **Connection** is a queue between processors. When one processor finishes and outputs a FlowFile, that FlowFile goes into the connection queue waiting for the downstream processor to pick it up.

Connections also let you configure **back-pressure** — the queue will pause feeding upstream processors if it gets too full (to prevent memory issues).

### Process Group

A **Process Group** is like a folder on the canvas. Use them to organize related processors and make complex flows easier to understand. You can also pass data in and out of a Process Group using **Input** and **Output** ports.

### Controller Service

A **Controller Service** is a shared resource that multiple processors reference. Instead of each processor storing its own copy of credentials or configurations, you create one Controller Service (e.g., for AWS/Ceph credentials) and multiple processors use it.

Common Controller Services:
- **AWSCredentialsProviderControllerService** — Stores AWS/Ceph S3 credentials
- **SSLContextService** — Shared TLS certificates for HTTPS/SFTP
- **DBCPConnectionPool** — Database connection pool

### Data Provenance

NiFi records **every event** that touches every FlowFile: when it was created, who processed it, where it went, whether it succeeded or failed. You can query this provenance data by filename, attribute, processor, or date range — and even **replay** any FlowFile from any point in its history.

This is invaluable for debugging: "What happened to file X? Why did it fail? Can I reprocess it?"

---

## 4. Step-by-Step Instructions

### Step 1 — Verify Java Installation

NiFi requires Java 21 or later. Check if you have it:

```bash
java -version
```

Expected output (versions 21+ are fine):

```
openjdk version "21.0.2" 2024-01-16 LTS
OpenJDK Runtime Environment (build 21.0.2+13-LTS)
```

If you don't have Java 21, install it. On Ubuntu/Debian:

```bash
sudo apt update
sudo apt install openjdk-21-jre-headless
```

On Fedora/Rocky/Alma:

```bash
sudo dnf install java-21-openjdk-headless
```

### Step 2 — Download and Extract NiFi

Download the latest stable version (2.8.0 as of February 2026):

```bash
cd /opt
wget https://downloads.apache.org/nifi/2.8.0/nifi-2.8.0-bin.zip
```

Always verify the checksum to ensure the download was not corrupted:

```bash
wget https://downloads.apache.org/nifi/2.8.0/nifi-2.8.0-bin.zip.sha256
sha256sum -c nifi-2.8.0-bin.zip.sha256
```

Expected output:

```
nifi-2.8.0-bin.zip: OK
```

Extract the archive:

```bash
unzip nifi-2.8.0-bin.zip
cd nifi-2.8.0
```

### Step 3 — Set Your Admin Password

NiFi 2.x uses HTTPS by default and requires you to set credentials before starting. Run:

```bash
./bin/nifi.sh set-single-user-credentials admin 'MySecurePassword123!'
```

Note: The password must be at least 12 characters. Use a strong password that combines letters, numbers, and special characters.

### Step 4 — Configure Basic Properties

Edit `conf/nifi.properties` to match your environment:

```bash
nano conf/nifi.properties
```

Change these lines (look for them in the file):

```properties
# The hostname NiFi listens on
nifi.web.https.host=localhost

# HTTPS port (8443 is the default)
nifi.web.https.port=8443

# Encryption key for stored credentials — set this once and never change it
# Generate a random 32-character string
nifi.sensitive.props.key=your-32-character-random-key-here
```

To generate a secure random key, you can use:

```bash
openssl rand -hex 16
```

Save the file (Ctrl+X, then Y, then Enter if using nano).

### Step 5 — Start NiFi

```bash
./bin/nifi.sh start
```

This starts NiFi in the background. Wait 30–60 seconds for it to fully start up. Monitor the startup log:

```bash
tail -f logs/nifi-app.log
```

Look for this line indicating NiFi is ready:

```
INFO org.apache.nifi.web.server.JettyServer: NiFi has started. The UI is available at https://localhost:8443/nifi
```

Once you see that message, press Ctrl+C to stop tailing the log.

### Step 6 — Access the Web UI

Open your browser and navigate to:

```
https://localhost:8443/nifi
```

Your browser will warn about a self-signed certificate — this is expected in a fresh install. Click through the warning (the exact steps vary by browser; look for "Advanced" or "Proceed anyway" options).

Log in with:
- **Username:** `admin`
- **Password:** (the one you set in Step 3)

You should now see the NiFi canvas — a blank canvas with toolbars on the left and top.

### Step 7 — Stop NiFi (When You're Done)

To shut down NiFi:

```bash
./bin/nifi.sh stop
```

The shutdown may take a minute. Check the log to confirm:

```bash
tail -f logs/nifi-app.log
```

Look for:

```
INFO org.apache.nifi.web.server.JettyServer: NiFi has stopped
```

---

## 5. Practical Examples

### Example 1 — Your First Flow: Watch a Directory and Move Files

**Scenario:** Watch `/tmp/nifi-watch` for new files, log their attributes, and move them to `/tmp/nifi-done`.

#### Create the Watch Directories

First, set up the directories NiFi will use:

```bash
mkdir -p /tmp/nifi-watch /tmp/nifi-done
```

#### Build the Flow

1. **Add a ListFile Processor**
   - Drag the **Processor** icon (the gear) onto the canvas
   - Search for `ListFile` and click **Add**
   - Right-click the processor and select **Configure**
   - Go to the **Properties** tab and set:
     - **Input Directory:** `/tmp/nifi-watch`
     - **Recurse Subdirectories:** `false`
     - **Minimum File Age:** `5 secs` (prevents reading files still being written)

2. **Add a FetchFile Processor**
   - Add another processor: `FetchFile`
   - Configure:
     - **File to Fetch:** `${absolute.path}/${filename}` (uses FlowFile attributes)
     - **Completion Strategy:** `Move File`
     - **Move Destination Directory:** `/tmp/nifi-done`

3. **Add a LogAttribute Processor**
   - Add processor: `LogAttribute`
   - No configuration needed — it will log all FlowFile attributes to the log

4. **Connect the Processors**
   - Hover over ListFile until an arrow appears
   - Drag to FetchFile, select **success**, click **Add**
   - Hover over FetchFile, drag to LogAttribute, select **success**, click **Add**

5. **Terminate Unused Relationships**
   - Right-click FetchFile → **Configure** → **Relationships** tab
   - Check **Terminate** for `not.found` and `permission.denied`
   - Right-click LogAttribute → Configure → Relationships tab
   - Check **Terminate** for `success`

6. **Start the Flow**
   - Right-click the canvas → **Start All**
   - The processors should turn green

7. **Test It**

Create a test file in the watch directory:

```bash
echo "Hello from NiFi!" > /tmp/nifi-watch/test.txt
```

Wait a few seconds. Check the results:

```bash
ls -la /tmp/nifi-done/
```

You should see `test.txt` there. Check the log:

```bash
tail -20 logs/nifi-app.log | grep LogAttribute
```

You'll see a line with all the file's attributes printed.

### Example 2 — Extract Metadata Into FlowFile Attributes

**Scenario:** Read the filename and add custom attributes based on the filename pattern.

Use an **UpdateAttribute** processor between FetchFile and LogAttribute:

1. Add processor: `UpdateAttribute`
2. Right-click → **Configure** → **Properties** tab
3. Add dynamic properties (click the **+** button):
   - Property: `file.base.name` → Value: `${filename:substringBefore('.')}`
   - Property: `file.ext` → Value: `${filename:substringAfter('.')}`
   - Property: `processed.time` → Value: `${now():format('yyyy-MM-dd HH:mm:ss')}`

4. Connect: FetchFile `success` → UpdateAttribute → LogAttribute

Now when you test, LogAttribute will show the extracted metadata.

### Example 3 — Route Files by Type

**Scenario:** Move CSV files to one directory, TXT files to another.

Use a **RouteOnAttribute** processor:

1. Add processor: `RouteOnAttribute`
2. Configure:
   - Add dynamic properties:
     - **csv-route** → `${filename:endsWith('.csv')}`
     - **txt-route** → `${filename:endsWith('.txt')}`

3. Add two PutFile processors (one for each route)
4. Connect:
   - UpdateAttribute → RouteOnAttribute
   - RouteOnAttribute `csv-route` → PutFile (configure directory: `/tmp/nifi-done/csv`)
   - RouteOnAttribute `txt-route` → PutFile (configure directory: `/tmp/nifi-done/txt`)

Test by dropping both `.csv` and `.txt` files into `/tmp/nifi-watch` and verify they go to the correct directories.

---

## 6. Hands-On Exercises

### Exercise 1 — Understand the Permission Model

1. Create a test file with a restrictive permission:
   ```bash
   echo "restricted" > /tmp/nifi-watch/private.txt
   chmod 000 /tmp/nifi-watch/private.txt
   ```
2. Add it to your flow and see what happens. What error does FetchFile produce? Check the bulletin board on the processor.
3. Fix the permissions:
   ```bash
   chmod 644 /tmp/nifi-watch/private.txt
   ```
4. Re-run the flow. Did it succeed this time?

### Exercise 2 — Explore FlowFile Attributes

1. Modify your LogAttribute processor to log only certain attributes instead of all of them.
   - Right-click → Configure → Properties
   - Set **Attributes to Log** to `filename,fileSize,uuid`
2. Check the log and note what gets printed. Understand what each attribute means.

### Exercise 3 — Data Provenance

1. In your flow, right-click the FetchFile processor.
2. Select **View Data Provenance**.
3. A provenance table will open showing all FlowFiles that passed through this processor.
4. Click on one of the rows to see the full detail — input attributes, output attributes, and the lineage of that FlowFile.
5. Close the detail and refresh the page. Notice the timestamp — provenance is recorded in real time.

### Exercise 4 — Build a Three-Processor Flow

1. Add a custom attribute to each FlowFile using **UpdateAttribute** that records the processor it came from:
   - Use `${hostname()}` and `${now()}` functions
2. Pass it through three different processors (e.g., ListFile → FetchFile → UpdateAttribute → LogAttribute).
3. View the data provenance and trace the complete path of one FlowFile from creation to termination.

---

## 7. Troubleshooting

### "Permission denied" when ListFile tries to read a directory

**Cause:** NiFi process doesn't have read permission on the directory.
**Fix:** Make sure the directory and its parent are readable:

```bash
chmod 755 /tmp/nifi-watch
```

### Processors are yellow/orange with error symbols

**Cause:** The processor is misconfigured (e.g., missing required property).
**Fix:** Right-click the processor and look at the error message. Hover over the yellow icon for hints.

### No FlowFiles appearing in a processor's queue

**Cause:** The upstream processor is not producing data, or back-pressure has paused it.
**Fix:** 
- Check the upstream processor's configuration
- Right-click connections and look at queue depth
- Check the global **Summary** (top-right menu) to see all queue depths

### NiFi UI won't load after starting

**Cause:** NiFi is still starting up, or HTTPS port is blocked.
**Fix:**
- Wait another minute and refresh the page
- Check if something else is using port 8443: `netstat -tuln | grep 8443`
- Check the log: `tail logs/nifi-app.log`

### Can't stop NiFi cleanly

**Cause:** NiFi is still shutting down, or the process hung.
**Fix:**
- Wait a minute and try again: `./bin/nifi.sh stop`
- If still stuck, force-kill: `kill -9 $(pgrep -f nifi)`

---

## 8. References

| Resource | URL |
|---|---|
| Official NiFi Documentation | https://nifi.apache.org/docs.html |
| NiFi User Guide | https://nifi.apache.org/docs/nifi-docs/html/user-guide.html |
| NiFi Processor Documentation | https://nifi.apache.org/components/ |
| Expression Language Guide | https://nifi.apache.org/docs/nifi-docs/html/expression-language-guide.html |
| Community Slack | https://cwiki.apache.org/confluence/display/NIFI/Community+Slack |
| Stack Overflow Tag | https://stackoverflow.com/questions/tagged/apache-nifi |

---

## 9. Summary

**Key takeaways:**

- **NiFi is a visual data flow platform** — you drag and drop processors onto a canvas and connect them together. No code required.
- **FlowFiles are the unit of work** — each carries content plus attributes (metadata) through your flow.
- **Processors do the work** — read, write, transform, or route data. The 400+ built-in processors handle most common tasks.
- **Connections are queues** with built-in back-pressure and retry logic — NiFi handles reliability automatically.
- **Data Provenance is powerful** — every byte is tracked, and you can replay any FlowFile from any point in its history.
- **The web UI is your development environment** — no compilation or redeployment needed. Changes take effect instantly.

**Next steps:**

- Learn about **Process Groups** to organize larger flows into folders
- Explore **Controller Services** to manage credentials securely
- Study the [[apache-nifi-deep-dive|Apache NiFi Deep Dive]] for clustering, performance tuning, and advanced patterns
- Look at [[kubernetes-beginner-guide|Kubernetes]] if you want to run NiFi in containers
- Check the [[apache-nifi-hpc-sysadmin-beginner-guide]] for integration with Slurm and HPC systems

---

## Related Tutorials

- [[apache-nifi-hpc-sysadmin-beginner-guide]]
- [[kubernetes-beginner-guide]]
- [[linux-permissions-beginner-guide]]
