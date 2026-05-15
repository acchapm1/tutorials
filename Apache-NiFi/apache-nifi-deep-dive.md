---
title: "Apache NiFi: Deep Dive Reference"
date: 2026-04-10
difficulty: advanced
tags: [apache-nifi, data-flow, clustering, performance, security, expression-language, hpc-workflows, microservices]
---

# Apache NiFi: Deep Dive Reference

## 1. Overview

This reference guide covers the complete Apache NiFi ecosystem at an advanced level: cluster architecture and ZooKeeper coordination, performance tuning and bottleneck analysis, security frameworks and encryption strategies, the Expression Language for dynamic configuration, advanced processor patterns for HPC and multi-cluster workflows, Git-based flow versioning, Docker and Kubernetes deployment, monitoring and observability infrastructure, and production-grade operational best practices.

This guide assumes you are familiar with basic NiFi concepts (FlowFiles, Processors, Connections, Process Groups) covered in the [[apache-nifi-beginner-guide|Apache NiFi Beginner Guide]]. It is designed as a reference you can return to as your workflows grow in complexity and production requirements demand deeper understanding.

---

## 2. Prerequisites

Before starting this deep dive, you should have:

- **Hands-on experience with standalone NiFi** — you've built and debugged flows in the UI
- **Familiarity with basic concepts** — FlowFiles, Processors, Connections, Controller Services, Data Provenance
- **Understanding of the Expression Language** — at least the basics of `${attribute:function}` syntax
- **Java 21+** — required for NiFi 2.x
- **A Linux/UNIX environment** — commands in this guide assume a Bash shell
- **Docker and docker-compose** (optional but recommended for cluster simulation)
- **Knowledge of distributed systems** — basic understanding of coordination, consensus, and failure modes
- **Familiarity with monitoring tools** — Prometheus, HTTP clients, log aggregation concepts

---

## 3. Key Concepts

### 3.1 Cluster Architecture and Coordination

NiFi cluster mode runs multiple NiFi nodes orchestrated by ZooKeeper (ZK). One node is elected the **Primary Node** (runs single-node-only processors like ListFile), and another is the **Cluster Coordinator** (manages cluster state, handles join/leave events).

**Flow Distribution:**
- The **Cluster Coordinator** holds the authoritative flow definition
- When you modify the flow via any node's UI, the coordinator broadcasts the change to all nodes
- All nodes execute the flow, but **Primary Node** processors run only on the Primary Node

**FlowFile Repository:**
- Each node maintains its own FlowFile repository (pointer to content and attributes)
- When a node fails, its in-flight FlowFiles are recovered from the repository on restart
- **Connection backpressure** prevents queue explosion: if a connection reaches its limit (e.g., 10,000 FlowFiles or 1 GB), upstream processors pause

**Content Repository:**
- Content is stored on local fast storage (NVMe preferred)
- Multiple processors reference the same content via copy-on-write pointers
- **Claim management** prevents orphaned data after FlowFile termination

**Provenance Repository:**
- Provenance is written asynchronously to disk and indexed by Lucene
- Query performance degrades with size — rolling indices (hourly, daily) help
- Set `nifi.provenance.repository.retention.*` to manage retention

### 3.2 ZooKeeper and Leader Election

NiFi uses **ZooKeeper 3.9+** for distributed coordination:

- **Node registration** — each NiFi node registers itself as an ephemeral node in ZK when it starts
- **Primary Node election** — nodes compete for the Primary Node role; the winner gets an exclusive lock
- **Quorum management** — if you lose more than half of your ZK ensemble, the cluster becomes read-only (unavailable)
- **Session timeouts** — if a node loses ZK connection for longer than `zookeeper.session.timeout`, it is forcibly removed from the cluster

**Typical ZK setup for HA:**
- 3 ZK nodes for production (2-node ensemble is vulnerable; 1-node is not HA)
- ZK cluster must have odd node counts for quorum
- Separate ZK machines from NiFi machines (shared hardware defeats HA purpose)

### 3.3 Primary Node vs. All-Nodes Processors

Some processors are marked **Primary Node Only** (default isolation level):

**Primary Node Only:**
- `ListFile`, `ListSFTP`, `ListS3`, `ListDatabaseTable` — produce one FlowFile per source item
- Running these on all nodes would cause duplicate processing
- They block in-flight FlowFiles on non-primary nodes until Primary Node role is acquired

**All Nodes:**
- `FetchFile`, `FetchS3Object`, `PutFile`, `PutS3Object` — process inbound FlowFiles
- Run on all nodes for horizontal scalability
- Each node pulls from its local queue and processes independently

You can override execution mode on a per-processor basis via the **Execution** property in Configure → Scheduling, but understand the implications.

### 3.4 Expression Language Internals

NiFi's Expression Language (EL) evaluates at **runtime per FlowFile**. This enables dynamic configuration without flow restarts.

**Subject-function composition:**
```
${attribute-name:function-name:function-name:...}
```

**Evaluation context:**
- The **subject** (left of first colon) is resolved first: attribute lookup, system property, or environment variable
- Each **function** is applied left-to-right to the result
- If any function fails (e.g., regex mismatch), the result is null and the connection may route to `unmatched` (RouteOnAttribute)

**Common pitfalls:**
- **Precedence:** EL operators have strict precedence; use parentheses
- **Null handling:** Null propagates through most functions; `${attr:isEmpty()}` returns false for null, not true
- **Type coercion:** Numbers are coerced to strings; comparison `${fileSize:gt(1000)}` compares as strings lexicographically, not numerically — use `gt(1000)` syntax
- **Attribute names:** Must be alphanumeric + underscores; nested attributes require custom processors

**Advanced techniques:**
```
# Conditional: if "env" attribute equals "prod", use secret key, else use dev key
${env:equals('prod'):ifTrue(#{prod.secret.key}):ifFalse(#{dev.secret.key})}

# Dynamic routing based on file size tiers
${fileSize:ge(1073741824):ifTrue('large'):ifFalse(${fileSize:ge(1048576):ifTrue('medium'):ifFalse('small')})}

# Extract job ID from filename pattern: "job-12345-data.csv"
${filename:substringAfter('job-'):substringBefore('-')}
```

### 3.5 Controller Service and Property Encryption

**Controller Services** are singleton resources instantiated once per NiFi instance (even in cluster, only one copy).

**Common gotchas:**
- Services marked **Sharing Profile: Restricted** can only be referenced by processors in the same scope (process group)
- Services marked **Sharing Profile: Shared** are global
- Enabling a service in use by running processors requires those processors to be stopped
- Changing a service's properties triggers a brief pause in dependent processors

**Property Encryption:**
- All properties containing passwords, API keys, or other sensitive data are encrypted with `AES-GCM-256` using the key in `nifi.sensitive.props.key`
- This key is **never transmitted** — encrypted values are stored in `flow.json.gz`
- Changing the encryption key **will lose all encrypted properties** — do not do this in production

### 3.6 Back-Pressure and Queue Management

Each connection has a configured back-pressure strategy:

**Back-Pressure Object Threshold:**
- If queue depth (number of FlowFiles) exceeds this, upstream processor pauses
- Default: no limit (dangerous for unlimited sources)
- Recommendation: set to 10,000–100,000 depending on file size

**Back-Pressure Data Size Threshold:**
- If queue size (total bytes) exceeds this, upstream processor pauses
- Default: no limit
- Recommendation: set to 1–5 GB for bounded memory usage

**Overflow action:**
- **Fail** — drop FlowFile with error
- **Roll over** — use secondary storage (slower but safer for large queues)

**Monitoring back-pressure:**
- Check **Summary** table (top-right menu) — look for non-zero "out" values on connections
- View **Status History** on a connection to see queue depth over time
- If a connection consistently hits back-pressure limits, that processor is a bottleneck

---

## 4. Step-by-Step Instructions

### 4.1 Setting Up a 3-Node Cluster with Docker Compose

This setup uses Docker to simulate a real 3-node cluster for development and testing.

**Prerequisites:**
- Docker 24+
- docker-compose v2+
- At least 6 GB RAM available (2 GB per NiFi node + ZK overhead)

**Create docker-compose.yml:**

```yaml
version: "3.8"

services:
  zookeeper:
    image: bitnami/zookeeper:3.9
    container_name: nifi-zk
    environment:
      - ALLOW_ANONYMOUS_LOGIN=yes
    ports:
      - "2181:2181"
    healthcheck:
      test: ["CMD", "nc", "-z", "localhost", "2181"]
      interval: 5s
      timeout: 3s
      retries: 3

  nifi-1:
    image: apache/nifi:2.8.0
    container_name: nifi-1
    depends_on:
      zookeeper:
        condition: service_healthy
    environment:
      # Cluster configuration
      - NIFI_CLUSTER_IS_NODE=true
      - NIFI_ZK_CONNECT_STRING=zookeeper:2181
      - NIFI_CLUSTER_ADDRESS=nifi-1
      - NIFI_CLUSTER_NODE_ADDRESS=nifi-1
      - NIFI_CLUSTER_NODE_PROTOCOL_PORT=8080
      # Security (single-user auth)
      - SINGLE_USER_CREDENTIALS_USERNAME=admin
      - SINGLE_USER_CREDENTIALS_PASSWORD=admin123456
      # JVM tuning
      - NIFI_JVM_HEAP_INIT=2g
      - NIFI_JVM_HEAP_MAX=2g
    ports:
      - "8443:8443"
      - "8080:8080"
    volumes:
      - nifi_1_content:/opt/nifi/nifi-current/content_repository
      - nifi_1_flowfile:/opt/nifi/nifi-current/flowfile_repository
      - nifi_1_provenance:/opt/nifi/nifi-current/provenance_repository
    healthcheck:
      test: ["CMD", "curl", "-f", "-k", "https://localhost:8443/nifi-api/system-diagnostics"]
      interval: 10s
      timeout: 5s
      retries: 5

  nifi-2:
    image: apache/nifi:2.8.0
    container_name: nifi-2
    depends_on:
      zookeeper:
        condition: service_healthy
    environment:
      - NIFI_CLUSTER_IS_NODE=true
      - NIFI_ZK_CONNECT_STRING=zookeeper:2181
      - NIFI_CLUSTER_ADDRESS=nifi-2
      - NIFI_CLUSTER_NODE_ADDRESS=nifi-2
      - NIFI_CLUSTER_NODE_PROTOCOL_PORT=8080
      - SINGLE_USER_CREDENTIALS_USERNAME=admin
      - SINGLE_USER_CREDENTIALS_PASSWORD=admin123456
      - NIFI_JVM_HEAP_INIT=2g
      - NIFI_JVM_HEAP_MAX=2g
    ports:
      - "8444:8443"
      - "8081:8080"
    volumes:
      - nifi_2_content:/opt/nifi/nifi-current/content_repository
      - nifi_2_flowfile:/opt/nifi/nifi-current/flowfile_repository
      - nifi_2_provenance:/opt/nifi/nifi-current/provenance_repository
    healthcheck:
      test: ["CMD", "curl", "-f", "-k", "https://localhost:8443/nifi-api/system-diagnostics"]
      interval: 10s
      timeout: 5s
      retries: 5

  nifi-3:
    image: apache/nifi:2.8.0
    container_name: nifi-3
    depends_on:
      zookeeper:
        condition: service_healthy
    environment:
      - NIFI_CLUSTER_IS_NODE=true
      - NIFI_ZK_CONNECT_STRING=zookeeper:2181
      - NIFI_CLUSTER_ADDRESS=nifi-3
      - NIFI_CLUSTER_NODE_ADDRESS=nifi-3
      - NIFI_CLUSTER_NODE_PROTOCOL_PORT=8080
      - SINGLE_USER_CREDENTIALS_USERNAME=admin
      - SINGLE_USER_CREDENTIALS_PASSWORD=admin123456
      - NIFI_JVM_HEAP_INIT=2g
      - NIFI_JVM_HEAP_MAX=2g
    ports:
      - "8445:8443"
      - "8082:8080"
    volumes:
      - nifi_3_content:/opt/nifi/nifi-current/content_repository
      - nifi_3_flowfile:/opt/nifi/nifi-current/flowfile_repository
      - nifi_3_provenance:/opt/nifi/nifi-current/provenance_repository
    healthcheck:
      test: ["CMD", "curl", "-f", "-k", "https://localhost:8443/nifi-api/system-diagnostics"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  nifi_1_content:
  nifi_1_flowfile:
  nifi_1_provenance:
  nifi_2_content:
  nifi_2_flowfile:
  nifi_2_provenance:
  nifi_3_content:
  nifi_3_flowfile:
  nifi_3_provenance:
```

**Start the cluster:**

```bash
docker compose up -d
```

**Wait for health checks to pass:**

```bash
docker compose ps
```

Expected output (all services should show healthy after 30–60 seconds):

```
CONTAINER ID   IMAGE              STATUS          PORTS
...            nifi-1             healthy        ...
...            nifi-2             healthy        ...
...            nifi-3             healthy        ...
```

**Access the cluster:**

Open `https://localhost:8443/nifi` (nifi-1), `https://localhost:8444/nifi` (nifi-2), or `https://localhost:8445/nifi` (nifi-3). All should show the same flow. Log in with admin/admin123456.

**Verify cluster membership:**

- Top-right menu → **Cluster**
- You should see three nodes listed
- One will be marked Primary Node, one is Cluster Coordinator

**Monitor ZooKeeper activity:**

```bash
docker compose logs -f zookeeper | grep -E "follower|leader|quorum"
```

**Tear down:**

```bash
docker compose down -v
```

### 4.2 Git-Based Flow Versioning with Flow Registry

NiFi 2.x has native Git integration (NiFi Registry, the separate service, is deprecated).

**Prerequisites:**
- A Git repository (GitHub, GitLab, Gitea, or self-hosted)
- SSH key pair for Git access (or PAT token if using HTTPS)

**Step 1: Create a Git Repository**

On GitHub (or your Git provider), create a new repository named `nifi-flows`:

```bash
git init nifi-flows
cd nifi-flows
echo "# NiFi Flow Repository" > README.md
git add README.md
git commit -m "Initial commit"
git remote add origin git@github.com:your-org/nifi-flows.git
git push -u origin main
```

**Step 2: Configure SSH Key Controller Service**

In NiFi UI:

1. Top-right menu → **Controller Settings** → **Controller Services** tab
2. Click **+** to add a new service
3. Choose **StandardPrivateKeyCredentialsProvider**
4. Configure:
   - **Username:** `git` (or your GitHub username)
   - **Private Key Path:** `/home/nifi/.ssh/id_ed25519` (path to your SSH private key)
   - **Known Hosts Path:** `/home/nifi/.ssh/known_hosts` (populate by running `ssh-keyscan github.com >> known_hosts`)
5. Enable the service (lightning bolt icon)

**Step 3: Create a Flow Registry Client**

1. Top-right menu → **Controller Settings** → **Registry Clients** tab
2. Click **+**
3. Choose **GitFlowRegistryClient**
4. Configure:
   - **Name:** `GitHub`
   - **Flow Storage Directory:** `/opt/nifi-flows` (NiFi will initialize this as a Git repo)
   - **Remote Clone Repository:** `git@github.com:your-org/nifi-flows.git`
   - **Branch:** `main`
   - **Remote Access Credentials:** Select your PrivateKeyCredentialsProvider service

**Step 4: Version a Process Group**

1. Create a Process Group on your canvas (or use an existing one)
2. Right-click the Process Group → **Version**
3. Click **Start Version Control**
4. Select registry client: **GitHub**
5. Fill in:
   - **Bucket:** `default` (maps to a subdirectory in the repo)
   - **Flow Name:** `my-hpc-flow`
   - **Flow Description:** Describe your flow
6. Click **Save**

NiFi will:
- Create `/opt/nifi-flows/default/my-hpc-flow.json` (the flow definition)
- Push it to the Git repo
- Track changes from now on

**Step 5: Commit Changes**

After modifying your flow:

1. Right-click the Process Group → **Version** → **Commit Local Changes**
2. Add a commit message
3. Click **Commit**

NiFi pushes the new version to Git with full history.

**Step 6: Review and Deploy Across Environments**

On another NiFi instance (test, prod):

1. Create a Flow Registry Client pointing to the same Git repo
2. Right-click canvas → **Version** → **Import from Registry**
3. Select your flow and version
4. Click **Import**

This enables environment promotion: develop on dev, commit, then import the same version to production.

### 4.3 Tuning NiFi for High Throughput

**Scenario:** You have 10 million small files to process. Default settings will be slow.

**JVM Tuning (`conf/bootstrap.conf`):**

```properties
# For 10 million files, you need significant heap
java.arg.2=-Xms16g
java.arg.3=-Xmx16g

# Tune GC for low latency
java.arg.4=-XX:+UseG1GC
java.arg.5=-XX:MaxGCPauseMillis=50
java.arg.6=-XX:+ParallelRefProcEnabled
```

**Repository Tuning (`conf/nifi.properties`):**

```properties
# Point repositories to NVMe for speed
nifi.flowfile.repository.directory=/mnt/nvme/flowfile_repository
nifi.content.repository.directory.default=/mnt/nvme/content_repository
nifi.provenance.repository.directory.default=/mnt/nvme/provenance_repository

# Increase write buffer for content repo
nifi.content.claim.max.appendable.size=10MB

# Compress provenance to save disk I/O
nifi.provenance.repository.compress.on.rollover=true
nifi.provenance.repository.rollover.time=15 mins

# Disable full-text indexing of provenance if not needed
nifi.provenance.repository.index.shard.size=500MB
```

**Processor Tuning:**

For **ListFile** (the bottleneck):

```
Concurrent Tasks:  8 (higher parallelism per node)
Yield Duration:    0 secs (no backoff when directory is empty)
Batch Size:        100 (emit 100 FlowFiles per execution)
```

For **FetchFile/PutFile** (I/O heavy):

```
Concurrent Tasks:  16 (I/O bound; leverage parallelism)
Yield Duration:    100 ms (small backoff when no work)
```

**Connection Back-Pressure:**

```
Back-Pressure Object Threshold:  100,000 FlowFiles
Back-Pressure Data Size Threshold: 5 GB
```

Allows ListFile to stay ahead without growing unbounded.

**Cluster Scaling:**

- **3-node cluster** → each FetchFile processor runs on all 3 nodes → 3× throughput
- **ListFile** (Primary Node only) → runs on 1 node; scale by increasing Concurrent Tasks
- **Layout:** Keep ListFile output queued small; push work downstream

### 4.4 Implementing Sensitive Properties and Secrets Management

**Scenario:** You have Ceph credentials, API keys, and database passwords to manage securely.

**Step 1: Set the Sensitive Properties Key**

Before storing any credentials, set `nifi.sensitive.props.key` in `conf/nifi.properties`:

```properties
nifi.sensitive.props.key=generated-32-character-random-key-here
```

Generate a secure key:

```bash
openssl rand -hex 16  # outputs 32 hex characters
```

**Important:** This key is used for AES-GCM-256 encryption. Changing it will lock you out of all stored credentials. Back it up securely.

**Step 2: Create a Parameter Context for Secrets**

1. Top-right menu → **Parameter Contexts** → **+**
2. Name it `HPC Secrets`
3. Add parameters:
   - **ceph.access.key** (sensitive) — your Ceph RadosGW access key
   - **ceph.secret.key** (sensitive) — your Ceph RadosGW secret key
   - **slurm.rest.api.token** (sensitive) — if using slurmrestd

4. Click **Create**

**Step 3: Reference in Processors**

In any processor property, instead of hardcoding credentials, use:

```
#{ceph.access.key}
#{ceph.secret.key}
```

These are resolved at runtime and the actual values never appear in logs or the flow definition.

**Step 4: Secure Parameter Context Access**

Parameter Contexts can be assigned at the Process Group level:

1. Right-click Process Group → **Configure**
2. Go to **Parameter Context** tab
3. Select `HPC Secrets`

Only processors in that group (and children) can reference those parameters.

**Step 5: Using External Secret Stores (Advanced)**

For production, consider integrating with HashiCorp Vault:

- Write a custom Controller Service that pulls secrets from Vault at runtime
- Instead of storing in Parameter Contexts, call Vault's API
- Credentials never touch NiFi's disk; pulled on-demand and cached in memory

**Implementation sketch:**

```java
// Pseudo-code for VaultCredentialsProviderService
@ControllerService
public class VaultCredentialsProvider {
  private VaultClient client;
  
  public String getSecret(String key) {
    return client.read("secret/data/nifi/" + key).getValue();
  }
}
```

### 4.5 Advanced Processor Patterns for HPC Workflows

**Pattern 1: Trigger External Compute Jobs and Wait for Completion**

Flow structure:

```
ListDatasets → FetchDataset → TriggerJobViaHttp → PollJobStatus (looped) → ArchiveResults
```

**TriggerJobViaHttp** (InvokeHTTP):

```
HTTP Method:  POST
Remote URL:   http://slurmrestd:6820/slurm/v0.0.42/job/submit
Body:         {"job": {"script": "#!/bin/bash...", ...}}
Headers:      Content-Type: application/json
```

Extract job ID from response using **EvaluateJsonPath**:

```
slurm.job.id:  $.job_id
```

**PollJobStatus** (ExecuteStreamCommand in a loop):

```
Command:           /bin/bash
Command Arguments: -c;curl -s http://slurmrestd:6820/slurm/v0.0.42/job/${slurm.job.id}
```

Extract state with **EvaluateJsonPath**:

```
slurm.job.state:  $.job[0].job_state
```

**RouteOnAttribute**:

| Route | Condition |
|---|---|
| `complete` | `${slurm.job.state:equals('COMPLETED')}` |
| `failed` | `${slurm.job.state:in('FAILED','CANCELLED','TIMEOUT')}` |
| `polling` | `${slurm.job.state:in('PENDING','RUNNING')}` |

Connect `polling` back to a **Wait** processor (60s delay) to create a polling loop.

**Pattern 2: Multi-Cluster Data Staging**

Flow structure:

```
ListS3(ceph) → FetchS3Object → StageToNVMe → InvokeHTTP(notify-remote-cluster) → DeleteS3Object
```

Use **parameter contexts** to switch between clusters:

- **Cluster A**: `ceph.endpoint=http://ceph-a:7480`, `stage.path=/nvme/ceph-ingest`
- **Cluster B**: `ceph.endpoint=http://ceph-b:7480`, `stage.path=/nvme/ceph-ingest`

Assign the appropriate context to the Process Group — same flow works for both clusters.

**Pattern 3: Error Recovery with Dead Letter Routing**

Instead of terminating failures, route them to a **Dead Letter Process Group**:

```
MainFlow (success) → ProcessData
MainFlow (failure) → DeadLetterGroup
```

In DeadLetterGroup:

```
Input → LogError → StoreToArchive → NotifyAdmins
```

Use **Data Provenance** to replay from the dead letter queue once the issue is fixed:

1. View Data Provenance in DeadLetterGroup
2. Select a failed FlowFile
3. Right-click → **Replay** → choose the processor to replay from

---

## 5. Practical Examples

### Example 1 — Building a Three-Layer HPC Pipeline with Parameter Contexts

**Scenario:** Archive simulation outputs from multiple clusters to Ceph, trigger post-processing jobs, and notify users.

**Architecture:**

```
Layer 1 (Source): ListFile (per-cluster)
Layer 2 (Archive): FetchFile → UpdateAttribute → PutS3Object
Layer 3 (Compute): TriggerJob → PollStatus → ArchiveResults
Layer 4 (Notify):  PutSlack + PutEmail
```

**Parameter Context: `ArchiveConfig`**

```
cluster.name = cluster-a
source.path = /beegfs/scratch/outputs
s3.bucket = hpc-archive
s3.endpoint = http://ceph-rgw:7480
```

**UpdateAttribute** adds metadata:

```
archive.time = ${now():format('yyyy-MM-dd HH:mm:ss')}
archive.cluster = ${cluster.name}
archive.path = ${s3.bucket}/${archive.cluster}/${now():format('yyyy/MM/dd')}/${filename}
```

**PutS3Object** uses these:

```
Object Key: ${archive.path}
Endpoint Override URL: ${s3.endpoint}
```

Switching to Cluster B: only change the Parameter Context values. The flow stays the same.

### Example 2 — Handling Failures and Retries

**Scenario:** A network transfer occasionally fails. Retry up to 3 times before alerting.

**Flow:**

```
FetchFile → PutSFTP → Router
  success → Archive
  failure → UpdateRetryCount → CheckRetries
    (if < 3) → Wait(30s) → FetchFile (loop)
    (if >= 3) → AlertAdmin
```

**UpdateRetryCount**:

```
retry.count = ${retry.count:isEmpty():ifTrue(1):ifFalse(${retry.count:toNumber():plus(1)})}
```

(If no retry.count attribute, start at 1; otherwise increment)

**CheckRetries** (RouteOnAttribute):

```
retry_again = ${retry.count:toNumber():lt(3)}
max_retries = ${retry.count:toNumber():ge(3)}
```

**Wait** processor:

```
Release After: 30 secs
```

When the FlowFile comes back through FetchFile, it has `retry.count = 2` and will retry.

### Example 3 — Dynamic Batch Processing

**Scenario:** Accumulate files until you have at least 10 or 5 minutes have passed, then process as a batch.

**Flow:**

```
ListFile → UpdateAttribute(batch.id) → MergeContent → ExecuteScript(process-batch.sh)
```

**MergeContent**:

```
Merge Strategy: Bin Packing
Minimum Number of Files: 10
Maximum Bin Age: 5 mins
Correlation Attribute Name: batch.id
```

This accumulates up to 10 files with the same `batch.id` before merging them into a single FlowFile (a TAR or ZIP archive of all inputs).

**ExecuteScript** unpacks the archive, processes it, and outputs a result FlowFile.

---

## 6. Hands-On Exercises

### Exercise 1 — Cluster Failover Testing

1. Start the 3-node Docker cluster (see Section 4.1)
2. Create a simple flow: ListFile → LogAttribute
3. View the Cluster page (top-right menu → Cluster)
4. Note which node is Primary
5. Stop the Primary Node: `docker compose stop nifi-1` (or whichever is Primary)
6. Watch the logs: `docker compose logs -f` — look for "Primary Node election"
7. After 30–60 seconds, check Cluster page again — a new Primary should be elected
8. Drop files into the watch directory — they should still be processed by the remaining nodes
9. Restart the failed node: `docker compose up -d nifi-1`
10. Confirm it rejoins the cluster (Cluster page shows 3 nodes again)

### Exercise 2 — Expression Language Mastery

1. Create a flow with **UpdateAttribute** that:
   - Takes a filename like `dataset-2026-04-10-001.csv`
   - Extracts the date: `extract.date = ${filename:substringAfter('-'):substringBefore('-'):regex('(\\d{4}-\\d{2}-\\d{2})', '$1')}`
   - Extracts the sequence number: `extract.seq = ${filename:substringAfterLast('-'):substringBefore('.')}`
   - Builds a routing key: `route.key = ${extract.date}/${extract.seq}`
2. Log these attributes and verify they match your expectations
3. Use the routing key in a RouteOnAttribute processor to branch to different directories

### Exercise 3 — Performance Analysis with Status History

1. Build a flow with ListFile → FetchFile → PutFile
2. Drop 1000 files into the input directory
3. Start the flow and watch the throughput
4. Right-click the **ListFile → FetchFile** connection → **View Status History**
5. Graph: bytes in, bytes out, FlowFiles in, FlowFiles out over time
6. Increase ListFile's Concurrent Tasks from 1 to 4 to 8
7. Observe the performance impact on the status history graph
8. Find the optimal setting (CPU saturation vs. throughput)

### Exercise 4 — Dead Letter Routing and Recovery

1. Create a flow that intentionally fails some FlowFiles (e.g., RouteOnAttribute with a bad path)
2. Route failures to a DeadLetterGroup (separate Process Group)
3. In DeadLetterGroup, log the failed FlowFile but don't terminate it
4. Using Data Provenance, find a failed FlowFile
5. Right-click → Replay → replay from the original processor
6. Verify the replayed FlowFile goes through the flow again
7. Fix the underlying issue (e.g., correct the path)
8. Verify the replayed FlowFile now succeeds

---

## 7. Troubleshooting

### ZooKeeper Quorum Loss

**Symptom:** Cluster goes read-only; you see "Insufficient connected nodes to form quorum" in logs.
**Cause:** More than half of ZK nodes are down.
**Fix:**
- Bring ZK nodes back online immediately
- Alternatively, restart all NiFi nodes after ZK is healthy (they will rejoin)
- Prevent this by monitoring ZK separately and alerting on node failures

### Primary Node Stuck in Election

**Symptom:** No Primary Node elected; processors with Primary Node isolation don't run.
**Cause:** ZK connectivity issue or network partition between nodes
**Fix:**
- Verify ZK is running and all NiFi nodes can reach it
- Check firewall/network — NiFi nodes need to communicate on port 11443 (cluster protocol port)
- Check logs for ZK session timeout errors

### Content Repository Growing Unbounded

**Symptom:** Disk space on content repository partition fills up
**Cause:** FlowFiles are being created but not cleaned up; dead FlowFiles aren't being claimed
**Fix:**
- Check for hanging flows (processes that never terminate FlowFiles)
- Monitor queue depths — if any connection has millions of FlowFiles, investigate
- Run a provenance query for orphaned FlowFiles — these should be rare
- Increase provenance retention cleanup frequency in `nifi.properties`

### Slow Flow Registry Pushes

**Symptom:** Committing a flow to Git takes 30+ seconds
**Cause:** Large flow JSON files; slow Git push over network
**Fix:**
- Break large flows into smaller Process Groups (versioned separately)
- Use local Git server instead of GitHub for lower latency
- Configure Git's SSH connection to use compression: add to `~/.ssh/config`:
  ```
  Host github.com
    Compression yes
    CompressionLevel 6
  ```

### Expression Language Returns Unexpected Null

**Symptom:** EL evaluates to null; processor routes to unmatched
**Cause:** Attribute doesn't exist, function failed, or null propagated through chain
**Fix:**
- Use **LogAttribute** to dump all attributes and verify the one you're referencing exists
- Use `${attr:isEmpty()}` instead of `${attr:equals('')}` to handle null
- Use try-catch style: `${attr:trim():isEmpty():ifTrue('EMPTY'):ifFalse(${attr})}`

### Cluster Coordinator Change Causes Flow Disruption

**Symptom:** Processors pause briefly when Coordinator election occurs
**Cause:** During Coordinator election, the cluster is briefly unavailable
**Fix:**
- This is normal and unavoidable; design for brief pauses
- Use connection back-pressure to handle temporary queue buildup
- Deploy ZK separately from NiFi to stabilize Coordinator role

---

## 8. References

| Resource | URL |
|---|---|
| Official NiFi Administration Guide | https://nifi.apache.org/docs/nifi-docs/html/administration-guide.html |
| NiFi Cluster Setup Guide | https://nifi.apache.org/docs/nifi-docs/html/setup-wizard.html |
| Expression Language Reference | https://nifi.apache.org/docs/nifi-docs/html/expression-language-guide.html |
| Processor Documentation | https://nifi.apache.org/components/ |
| NiFiKop Kubernetes Operator | https://konpyutaika.github.io/nifikop/ |
| Apache ZooKeeper Documentation | https://zookeeper.apache.org/doc/current/ |
| Slurm REST API | https://slurm.schedmd.com/rest.html |
| Prometheus NiFi Exporter | https://github.com/prometheus-community/nifi_exporter |

---

## 9. Summary

**Key takeaways:**

- **Cluster mode** multiplies throughput by running on multiple nodes, coordinated by ZooKeeper and managed by a Primary Node and Coordinator
- **FlowFiles and content are durable** — repositories on fast storage guarantee no data loss even during node failures
- **Expression Language is powerful and dynamic** — use it to build flexible, parameterizable flows that work across environments
- **Back-pressure prevents resource exhaustion** — tune queue limits based on file size and target throughput
- **Git-based versioning enables environment promotion** — develop, commit, then deploy the same flow to production
- **Security is layered** — sensitive properties encrypted at rest, parameter contexts restrict credential scope, capabilities limit processor privileges
- **Monitoring and observability** — Prometheus metrics, status history graphs, and data provenance are essential for production operations
- **Patterns matter** — understand retry, aggregation, routing, and external job integration patterns to solve real-world problems

**Next steps:**

- Deploy to [[kubernetes-deep-dive|Kubernetes]] for cloud-native operations and auto-scaling
- Integrate with [[apache-nifi-hpc-sysadmin-deep-dive]] for HPC-specific workflows
- Explore custom processors and Controller Services for domain-specific logic
- Set up automated monitoring and alerting with Prometheus + Grafana
- Review your organization's data governance policies and implement audit trails to satisfy compliance

---

## Related Tutorials

- [[apache-nifi-beginner-guide]]
- [[apache-nifi-hpc-sysadmin-deep-dive]]
- [[kubernetes-deep-dive]]
