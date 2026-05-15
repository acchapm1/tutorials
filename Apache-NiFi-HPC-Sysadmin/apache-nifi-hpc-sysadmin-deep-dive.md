---
title: "Apache NiFi for HPC System Administrators: Deep Dive Reference"
date: 2026-04-10
difficulty: advanced
tags: [apache-nifi, hpc, slurm, beegfs, ceph, clustering, kubernetes, registry, security, monitoring, sysadmin]
---

# Apache NiFi for HPC System Administrators: Deep Dive Reference

## 1. Overview

This deep-dive reference covers advanced Apache NiFi topics for HPC system administrators: clustering architecture, integration with HPC schedulers (Slurm) and storage systems (BeeGFS, Ceph), containerized deployments (Docker, Kubernetes), flow version control (Registry and Git), security hardening, and comprehensive monitoring strategies.

This guide assumes familiarity with basic NiFi concepts (FlowFile, Processor, Connection, Expression Language) covered in the [[apache-nifi-hpc-sysadmin-beginner-guide|Beginner Guide]]. It is designed as a reference you can return to as you design and maintain production HPC dataflow pipelines.

---

## 2. Prerequisites

Before working through this guide, you should have:

- A working standalone NiFi 2.x installation (from the Beginner Guide)
- Comfortable with Linux system administration (users, groups, file permissions, systemd)
- Access to HPC infrastructure or simulators:
  - Slurm cluster (or ability to run `slurmrestd` standalone)
  - BeeGFS filesystem (or equivalent POSIX-compliant parallel filesystem)
  - Ceph cluster with S3 RadosGW or access to AWS S3
- Docker and Docker Compose installed (for clustered testing)
- Kubernetes cluster (for K8s deployment section; minikube or a test cluster acceptable)
- Git repository for flow version control (GitHub, GitLab, Bitbucket, or local)
- Text editor or IDE for configuration files and scripts

---

## 3. Key Concepts

### 3.1 NiFi Core Abstractions

#### Expression Language (EL)

NiFi Expression Language enables dynamic processor configuration using FlowFile attributes. Syntax: `${attribute_name}` or `${attribute_name:function()}`.

**Common patterns for HPC**:
```
# Extract job ID from Slurm output
${slurm.output:substringAfter('job')
                    :substringBefore(':')}

# Construct S3 key with date partitioning
jobs/${job.id}/${now():format('yyyy/MM/dd')}/${filename}

# Conditional routing by job status
${job.status:equals('COMPLETED')}

# Test file size threshold
${fileSize:gt(1073741824)}  # > 1 GB

# Dynamic SFTP host from attribute
sftp://${sftp.remote.host}:${sftp.remote.port}/${path}${filename}
```

**Function categories**:
- String: `toUpper()`, `toLower()`, `trim()`, `substringBefore()`, `substringAfter()`, `length()`, `substring()`, `replace()`, `split()`
- Numeric: `lt()`, `gt()`, `le()`, `ge()`, `equals()`, `plus()`, `minus()`
- Boolean: `matches()`, `contains()`, `startsWith()`, `endsWith()`
- Date: `now()`, `format()`, `toDate()`, `fromDate()`
- Type conversion: `toNumber()`, `toBoolean()`

### 3.2 Cluster Architecture

A NiFi **cluster** consists of:

1. **ZooKeeper**: Distributed coordination service for cluster state (leader election, configuration sync).
2. **Multiple NiFi nodes**: Each node can process FlowFiles independently.
3. **Cluster Coordinator**: Elected by ZooKeeper; manages cluster-wide state and flow propagation.
4. **Primary Node**: A separately elected role; only processes that require single-point coordination (ListFile, ListSFTP, ListS3) run here.

**Key behaviors**:

- **Flow synchronization**: The Cluster Coordinator syncs the flow definition to all nodes.
- **Queue replication**: Connection queues are replicated across nodes for fault tolerance.
- **Load balancing**: ProcessGroups can distribute load across available nodes.
- **Backpressure**: If a node's queue fills (by data size or FlowFile count), upstream nodes pause.

### 3.3 Data Provenance Architecture

NiFi maintains a complete audit trail in the **provenance repository**:

- Every FlowFile creation, read, write, route, fork, join, drop event is recorded.
- Records include: processor ID, timestamp, FlowFile UUID, attribute snapshots, lineage.
- Stored on disk in configurable location (default: `./provenance_repository/`).
- Queryable via the Data Provenance UI or REST API.
- **Replay feature**: Resend a FlowFile from any point in its history to re-run processing.

---

## 4. Step-by-Step Instructions

### 4.1 Installing NiFi as a Systemd Service

For production deployments, run NiFi as a managed systemd service for automatic restart and clean shutdown:

```bash
# Install as a service
/opt/nifi/bin/nifi.sh install

# Start the service
systemctl start nifi

# Enable auto-start on boot
systemctl enable nifi

# Check status
systemctl status nifi

# View logs
journalctl -u nifi -f
```

Expected output:
```
● nifi.service - Apache NiFi
   Loaded: loaded (/opt/nifi/bin/nifi > loaded to systemd)
   Active: active (running) since Thu 2026-04-10 12:00:00 UTC
```

### 4.2 Configuring NiFi for Production

Edit `/opt/nifi/conf/nifi.properties`:

```properties
# Web UI security (HTTPS required for cluster)
nifi.web.https.host=nifi1.hpc.example.com
nifi.web.https.port=8443

# TLS keystore/truststore (generated by tls-toolkit.sh)
nifi.security.keystore=./conf/keystore.p12
nifi.security.keystoreType=PKCS12
nifi.security.keystorePasswd=<generated-password>
nifi.security.truststore=./conf/truststore.p12
nifi.security.truststoreType=PKCS12
nifi.security.trusstorePasswd=<generated-password>

# Authentication
nifi.security.user.login.identity.provider=single-user-provider

# Encryption of sensitive properties
nifi.sensitive.props.key=<12+ character passphrase>
nifi.sensitive.props.algorithm=NIFI_PBKDF2_AES_GCM_256

# Repository paths (can point to fast/large storage)
nifi.content.repository.directory.default=/data/nifi/content_repository
nifi.flowfile.repository.directory=/data/nifi/flowfile_repository
nifi.provenance.repository.directory.default=/data/nifi/provenance_repository
nifi.database.repository.directory=./database_repository

# Provenance storage limits
nifi.provenance.repository.max.storage.size=50 GB
nifi.provenance.repository.max.storage.time=30 days
nifi.provenance.repository.rollover.time=10 mins

# JVM memory settings (in bootstrap.conf)
# java.arg.2=-Xms4g
# java.arg.3=-Xmx16g

# Cluster mode (set per-node)
nifi.cluster.is.node=false  # Set true on each node
nifi.cluster.node.address=nifi1.hpc.example.com
nifi.cluster.node.protocol.port=11443
nifi.zookeeper.connect.string=zk1.hpc.example.com:2181,zk2.hpc.example.com:2181,zk3.hpc.example.com:2181
nifi.cluster.flow.election.max.candidates=3
nifi.cluster.protocol.is.secure=true
```

### 4.3 Generating TLS Certificates for Cluster

Use NiFi's TLS Toolkit to generate proper certificates:

```bash
# Generate certificates for all nodes
/opt/nifi/bin/tls-toolkit.sh standalone \
  -n "nifi1.hpc.example.com,nifi2.hpc.example.com,nifi3.hpc.example.com" \
  -C "CN=admin,OU=NiFi" \
  -o ./nifi-certs

# Output: nifi-certs/nifi1.hpc.example.com/, nifi2.hpc.example.com/, etc.
# Each contains: nifi.properties, keystore.p12, truststore.p12
```

For each node:
1. Copy the node's directory contents to `/opt/nifi/conf/`
2. Update nifi.properties with the node address and ZK quorum
3. Set proper permissions: `chmod 600 conf/keystore.p12 conf/truststore.p12`

### 4.4 Building a Slurm Integration Pipeline

**Complete workflow**: Monitor input → Submit Slurm job → Poll status → Process output → Archive results

**Components**:

1. **Input Monitor** — `ListFile` watching `/scratch/jobs/input/`
2. **Job Submission** — `ExecuteProcess` running `sbatch`
3. **Job ID Extraction** — `ExtractText` parsing sbatch output
4. **Status Polling** — `ExecuteStreamCommand` running `squeue` on a loop
5. **Routing** — `RouteOnAttribute` branching on job status (RUNNING/COMPLETED/FAILED)
6. **Output Processing** — `ListFile` monitoring job output directory
7. **Archive** — `PutS3Object` uploading to Ceph
8. **Notification** — `PutSlack` or `PutEmail` on completion

**Configuration example**:

```
[ListFile: /scratch/jobs/input/]
  Input Directory: /scratch/jobs/input/
  File Filter: .*\.job$
  Minimum File Age: 30 sec
  --> success
[UpdateAttribute]
  job.submitted.time = ${now():format('yyyy-MM-dd HH:mm:ss')}
  job.input.file = ${absolute.path}
  --> [ExecuteProcess: sbatch]
  Command: /usr/bin/sbatch
  Arguments: --job-name=${filename:substringBefore('.')} --time=02:00:00 \
             --export=INPUT_FILE=${job.input.file} \
             /opt/scripts/process.sh
  --> success
[ExtractText]
  Property: slurm.job.id
  Value (regex): Submitted batch job (\d+)
  --> success
[Wait]
  Wait Duration: 30 sec
  --> [ExecuteStreamCommand: squeue polling loop]
  Command: /bin/bash
  Arguments: -c "squeue --job=${slurm.job.id} --format='%T' --noheader"
  --> success
[ExtractText]
  Property: slurm.status
  Value: (RUNNING|PENDING|COMPLETED|FAILED)
  --> 
[RouteOnAttribute]
  "completed": ${slurm.status:equals('COMPLETED')}
  "failed": ${slurm.status:equals('FAILED')}
  "pending": ${slurm.status:matches('RUNNING|PENDING')}

  completed --> [ListFile: /scratch/jobs/${slurm.job.id}/output/]
                --> [FetchFile]
                --> [UpdateAttribute]
                  s3.key = jobs/${slurm.job.id}/${now():format('yyyy/MM/dd')}/${filename}
                  --> [PutS3Object]
                  Bucket: job-results
                  Endpoint: http://ceph-rgw.hpc.example.com:7480
                  --> success
                --> [PutSlack]
                Message: Job ${slurm.job.id} completed!

  failed --> [PutSlack]
             Message: Job ${slurm.job.id} FAILED

  pending --> [RouteOnAttribute: decision point, feeds back to squeue loop]
```

### 4.5 BeeGFS Integration Pipeline

BeeGFS is a POSIX-compliant parallel filesystem. No special integration needed — use standard file processors:

```bash
# Monitor BeeGFS for new data
ListFile:
  Input Directory: /beegfs/scratch/experiments/
  File Filter: .*\.h5$       # HDF5 files
  Minimum File Age: 60 sec   # Files still being written
  Recurse Subdirectories: true

# Read file content
FetchFile:
  File to Fetch: ${absolute.path}
  Completion Strategy: Move to Directory
  Move Destination: /beegfs/scratch/processing/

# Transform path for S3 upload
UpdateAttribute:
  s3.bucket: hpc-data
  s3.key: raw/${now():format('yyyy/MM/dd')}/${filename}

# Upload to Ceph
PutS3Object:
  Bucket: ${s3.bucket}
  Object Key: ${s3.key}
  Endpoint Override URL: http://ceph-rgw.hpc.example.com:7480
  AWS Credentials Provider: CephCredentials
```

**Performance considerations**:
- Set `Minimum File Age` to prevent reading files still being written (typically 30-60 seconds)
- For large files (>1 GB), ensure NiFi heap is sized appropriately (content repository holds file in memory temporarily)
- Consider keeping NiFi content repository on fast local NVMe, separate from monitored BeeGFS paths
- Use FetchFile **Move to Directory** completion strategy to atomically move processed files, preventing re-ingestion

### 4.6 Ceph S3 Integration with AWSCredentialsProviderControllerService

**Setup Controller Service**:

1. Right-click canvas → Configure → Controller Services tab
2. Add: `AWSCredentialsProviderControllerService`
3. Configure:
   ```
   Access Key ID: <ceph-rgw-access-key>
   Secret Access Key: <ceph-rgw-secret-key>
   ```
4. Click lightning bolt to enable

**Processor configuration**:

For `PutS3Object`:
```
Bucket: hpc-results
Region: us-east-1   # Ceph uses us-east-1 as default
Endpoint Override URL: http://ceph-rgw.hpc.example.com:7480
AWS Credentials Provider Service: AWSCredentialsProviderControllerService
Use Path Style Access: true    # REQUIRED for Ceph
Multipart Upload Threshold: 5 GB
Multipart Part Size: 100 MB
Content Type: ${mime.type}
```

For `ListS3`:
```
Bucket: hpc-raw-data
Prefix: incoming/2026/
Endpoint Override URL: http://ceph-rgw.hpc.example.com:7480
AWS Credentials Provider Service: AWSCredentialsProviderControllerService
```

For `FetchS3Object`:
```
Bucket: ${s3.bucket}
Object Key: ${s3.key}
Endpoint Override URL: http://ceph-rgw.hpc.example.com:7480
AWS Credentials Provider Service: AWSCredentialsProviderControllerService
```

**Complete BeeGFS → Slurm → Ceph pipeline**:

```
[ListFile: /beegfs/raw-data/] (Primary Node, 5 min)
  --> [FetchFile: Move to /beegfs/in-processing/]
  --> [UpdateAttribute]
      s3.key = raw/${now():format('yyyy/MM/dd')}/${filename}
      s3.bucket = hpc-input
      slurm.input_s3_key = ${s3.key}
  --> [PutS3Object: Endpoint=http://ceph-rgw:7480]
  --> [UpdateAttribute]
      slurm.script = /opt/scripts/process.sh
  --> [ExecuteProcess: sbatch]
      sbatch --export=INPUT_S3_KEY=${slurm.input_s3_key} \
             ${slurm.script}
  --> [ExtractText: slurm.job.id = Submitted batch job (\d+)]
  --> [Wait + squeue poll loop]
  --> [RouteOnAttribute: completed/failed]
  --> [PutSlack: "Pipeline complete: ${slurm.job.id}"]
```

### 4.7 Docker Compose Multi-Node Cluster

**File**: `docker-compose.yml`

```yaml
version: '3.8'

services:
  zookeeper:
    image: bitnami/zookeeper:3.8
    hostname: zookeeper
    container_name: zookeeper
    ports:
      - "2181:2181"
    environment:
      ALLOW_ANONYMOUS_LOGIN: "yes"
      ZOO_MY_ID: "1"
    volumes:
      - zookeeper_data:/bitnami/zookeeper

  nifi:
    image: apache/nifi:2.8.0
    ports:
      - "8080-8082:8080"   # Maps host ports 8080-8082 to container 8080
    environment:
      NIFI_WEB_HTTP_PORT: "8080"
      NIFI_CLUSTER_IS_NODE: "true"
      NIFI_CLUSTER_NODE_PROTOCOL_PORT: "8082"
      NIFI_ZK_CONNECT_STRING: "zookeeper:2181"
      NIFI_ELECTION_MAX_WAIT: "1 min"
      NIFI_ELECTION_MAX_CANDIDATES: "3"
      SINGLE_USER_CREDENTIALS_USERNAME: "admin"
      SINGLE_USER_CREDENTIALS_PASSWORD: "adminpassword123"
    depends_on:
      - zookeeper
    volumes:
      - nifi_content:/opt/nifi/nifi-current/content_repository
      - nifi_db:/opt/nifi/nifi-current/database_repository
      - nifi_flowfile:/opt/nifi/nifi-current/flowfile_repository
      - nifi_provenance:/opt/nifi/nifi-current/provenance_repository

volumes:
  zookeeper_data:
  nifi_content:
  nifi_db:
  nifi_flowfile:
  nifi_provenance:
```

**Operations**:

```bash
# Start with 3 nodes
docker compose up --scale nifi=3 -d

# View logs
docker compose logs -f nifi

# Scale to 5 nodes
docker compose up --scale nifi=5 -d

# Stop everything
docker compose down

# Access UI (each node on different port)
https://localhost:8080/nifi   # Node 1
https://localhost:8081/nifi   # Node 2
https://localhost:8082/nifi   # Node 3
```

**Cluster notes**:
- ZooKeeper elects a **Cluster Coordinator** automatically.
- The **Primary Node** is separately elected — schedule listing processors to run "on Primary Node only."
- Scaling down loses in-flight data on removed nodes; drain queues first.

### 4.8 NiFi on Kubernetes with Helm Chart

**Add Apache Helm repository**:

```bash
helm repo add apache https://charts.apache.org
helm repo update
```

**Basic values.yaml**:

```yaml
replicaCount: 3

image:
  repository: apache/nifi
  tag: "2.8.0"

service:
  type: ClusterIP
  port: 8080

persistence:
  enabled: true
  storageClass: "fast-ssd"   # Must exist in your cluster
  size: 50Gi

zookeeper:
  enabled: true
  replicaCount: 3

properties:
  sensitive:
    key: "your-12-char-minimum-passphrase"
```

**Install**:

```bash
helm install nifi apache/nifi -f values.yaml -n nifi --create-namespace

# Watch pods come up
kubectl get pods -n nifi -w

# Port-forward for testing
kubectl port-forward -n nifi svc/nifi 8080:8080

# Access at http://localhost:8080/nifi
```

### 4.9 NiFi Registry and Git-Based Flow Version Control

**NiFi 2.x Git-based Registry** (recommended):

```
1. In UI: Hamburger menu → Controller Settings → Registry Clients
2. Add: GitHubFlowRegistryClient (or GitLabFlowRegistryClient, etc.)
3. Configure:
   Repository URL: https://github.com/yourorg/nifi-flows.git
   Branch: main
   Access Token: (GitHub personal access token with repo scope)
4. Right-click Process Group → Version → Start Version Control
5. Select Registry Client and bucket (directory in repo)
6. On each change, right-click → Version → Commit Changes
```

Each version is stored as JSON in the git repo, enabling:
- Full audit trail
- Rollback to previous versions
- CI/CD pipeline integration
- Collaborative flow development

### 4.10 Security Hardening

#### LDAP Authentication

Edit `/opt/nifi/conf/login-identity-providers.xml`:

```xml
<provider>
  <identifier>ldap-provider</identifier>
  <class>org.apache.nifi.ldap.LdapProvider</class>
  <property name="Authentication Strategy">SIMPLE</property>
  <property name="Manager DN">cn=admin,dc=example,dc=com</property>
  <property name="Manager Password">password</property>
  <property name="TLS - Keystore">./conf/keystore.p12</property>
  <property name="TLS - Truststore">./conf/truststore.p12</property>
  <property name="Referral Strategy">FOLLOW</property>
  <property name="Connect Timeout">10 secs</property>
  <property name="Read Timeout">10 secs</property>
  <property name="Url">ldap://ldap.example.com:389/dc=example,dc=com</property>
  <property name="User Search Filter">(uid={0})</property>
  <property name="Identity Strategy">USE_USERNAME</property>
</provider>
```

Then update `nifi.properties`:

```properties
nifi.security.user.login.identity.provider=ldap-provider
```

#### Authorization: Role-Based Access Control

Edit `/opt/nifi/conf/authorizers.xml` to define users and permissions:

```xml
<authorizer>
  <identifier>managed-authorizer</identifier>
  <class>org.apache.nifi.authorization.StandardManagedAuthorizer</class>
  <property name="Access Control Strategy">with-external-authorization-provider</property>
  <property name="Authorizations File">./conf/authorizations.xml</property>
  <property name="Users File">./conf/users.xml</property>
  <property name="Initial Admin Identity">admin</property>
</authorizer>
```

In UI, assign users to roles (Viewer, Editor, Admin) and set processor/canvas permissions.

#### Securing Sensitive Properties

All sensitive properties (passwords, API keys, S3 credentials) in processor configs are encrypted at rest using the `nifi.sensitive.props.key`. Set this **before first run**:

```bash
# In nifi.properties
nifi.sensitive.props.key=MySecure12CharKey!
nifi.sensitive.props.algorithm=NIFI_PBKDF2_AES_GCM_256
```

View an encrypted property:
```bash
# Encrypted in flow.xml.gz
cat conf/flow.xml.gz | gunzip | grep -A2 "sensitivePropertyValue"
# Output: enc{N4...} (encrypted)
```

### 4.11 Advanced Monitoring

#### Prometheus Metrics Scraping

NiFi 2.x exposes Prometheus metrics at: `/nifi-api/flow/metrics/prometheus`

**Prometheus scrape config**:

```yaml
global:
  scrape_interval: 30s

scrape_configs:
  - job_name: 'nifi'
    scheme: https
    tls_config:
      insecure_skip_verify: true   # For self-signed; use ca_file in production
    basic_auth:
      username: 'admin'
      password: 'adminpassword123'
    static_configs:
      - targets: ['nifi1.hpc.example.com:8443']
    metrics_path: '/nifi-api/flow/metrics/prometheus'
```

**Grafana dashboard**:
- Import dashboard ID 12314 (NiFi Prometheus Reporting Task Dashboard)
- Shows real-time flow rates, queue sizes, processor latencies, cluster status

#### Data Provenance Queries

**REST API examples**:

```bash
# Search provenance events
curl -k -u admin:password \
  'https://nifi1.hpc.example.com:8443/nifi-api/provenance/search' \
  -X POST -d '{
    "request": {
      "searchTerms": {
        "ProcessorID": "<processor-uuid>",
        "EventType": "SEND"
      },
      "startDate": "2026-04-10T00:00:00Z",
      "endDate": "2026-04-10T23:59:59Z"
    }
  }'

# Get lineage for a FlowFile
curl -k -u admin:password \
  'https://nifi1.hpc.example.com:8443/nifi-api/provenance/<event-id>/lineage'

# Replay a FlowFile from a specific point
curl -k -u admin:password \
  'https://nifi1.hpc.example.com:8443/nifi-api/provenance/<event-id>/replay' \
  -X POST
```

#### Bulletins and Warnings

**View in UI**: Hamburger menu → Bulletin Board

**Configure per-processor**:
1. Right-click processor → Configure → Settings
2. Set Bulletin Level: DEBUG / INFO / WARN / ERROR
3. Only messages at or above this level appear

---

## 5. Practical Examples

### Example 1 — HPC Job Completion Pipeline

Monitor a Slurm job output directory, validate results, archive to Ceph, and notify team.

```
[ListFile: /scratch/jobs/*/output/]
  (Primary Node, 60 sec)
  File Filter: .*\.result$
  Minimum File Age: 30 sec
  --> success
[FetchFile: Move to /scratch/jobs/*/output-processed/]
  --> success
[ExecuteStreamCommand: validate results]
  Command: /bin/bash
  Arguments: -c "python3 /opt/scripts/validate.py ${absolute.path}"
  --> success
[RouteOnContent: check validation output]
  Property "valid": ^PASS
  Property "invalid": ^FAIL
  --> valid
[UpdateAttribute]
  s3.bucket: job-results
  s3.key: ${path:substringAfter('jobs/'):substringBefore('/output')}/${filename}
  --> [PutS3Object]
      Bucket: ${s3.bucket}
      Object Key: ${s3.key}
      Endpoint: http://ceph-rgw:7480
      --> success
[PutSlack: "Result ${s3.key} validated and archived"]

  --> invalid
[PutSlack: "Result validation FAILED: ${absolute.path}"]
[PutEmail: alert@hpc.example.com with attachment]
```

### Example 2 — Multi-Tier Data Archival

Route files to different storage based on size and age.

```
[ListFile: /beegfs/archive-queue/]
  Minimum File Age: 1 day
  --> [FetchFile]
  --> [RouteOnAttribute]
      "small": ${fileSize:lt(1073741824)}          # < 1 GB
      "large": ${fileSize:ge(1073741824)}          # >= 1 GB
      --> small
[UpdateAttribute]
  s3.bucket: archive-cold
  storage.tier: cold-archive
  --> [PutS3Object: Ceph STANDARD storage class]

  --> large
[UpdateAttribute]
  s3.bucket: archive-warm
  storage.tier: warm-archive
  --> [PutS3Object: Ceph INTELLIGENT_TIERING storage class]
```

### Example 3 — Load Balancing Across Cluster Nodes

Distribute processing across all nodes (not just Primary Node).

```
[ListFile: /beegfs/input/ (Primary Node only)]
  --> success
[FetchFile]
  --> success (processed on ANY node)
[ExecuteStreamCommand: heavy computation]
  (will load-balance across cluster)
  --> success
[PutS3Object: upload results]
```

---

## 6. Hands-On Exercises

### Exercise 1 — Cluster Setup and Monitoring

1. Deploy 3-node NiFi cluster using Docker Compose
2. Verify all nodes register with ZooKeeper
3. View cluster status in UI: Hamburger → Summary
4. Scale up to 5 nodes, observe queue redistribution
5. Kill one node's container and observe failover

### Exercise 2 — Provenance Replay

1. Create a simple flow: ListFile → ReplaceText → PutFile
2. Introduce an error in ReplaceText (bad regex)
3. Fix the error
4. Use Data Provenance → Replay to reprocess failed FlowFiles without re-ingesting source files

### Exercise 3 — Slurm Job Integration

1. Set up a Slurm test environment (or use `slurmctld` in Docker)
2. Build complete pipeline: monitor input → sbatch → squeue poll → process output → Ceph archive
3. Submit a real job, watch NiFi track its lifecycle
4. Test failure handling (kill job, verify alert routing)

### Exercise 4 — Git-Based Flow Version Control

1. Create a GitHub repository: `nifi-flows`
2. In NiFi UI, set up GitHub Flow Registry Client
3. Create a Process Group, start version control
4. Make changes, commit (creates JSON in git)
5. Verify git history: `git log --oneline nifi/flows.json`
6. Rollback to previous version in UI

### Exercise 5 — Security Hardening

1. Generate TLS certificates using tls-toolkit.sh for 3 nodes
2. Configure cluster with HTTPS and mutual TLS
3. Set up LDAP authentication (use OpenLDAP in Docker for testing)
4. Create users and assign roles (Viewer, Editor, Admin)
5. Verify role-based access control (viewer can't edit, admin can)

---

## 7. Troubleshooting

### Cluster coordination fails, nodes won't elect coordinator

**Symptom**: NiFi logs show "Unable to connect to ZooKeeper" or coordinator never elected.

**Diagnosis**:
- Check ZooKeeper is running: `echo ruok | nc localhost 2181`
- Verify network connectivity between nodes and ZK: `telnet zk-host 2181`
- Check nifi.properties `zookeeper.connect.string` on all nodes (must be identical)

**Fix**: Ensure ZooKeeper quorum is correct and all nodes can reach it. Restart NiFi after fixing connection.

### Primary Node never elected

**Symptom**: Listing processors (ListFile, ListSFTP, ListS3) show "Node does not have the Primary role."

**Diagnosis**:
- Check ZooKeeper is healthy
- Verify cluster has stable quorum (odd number of nodes recommended)
- Check logs for coordination errors

**Fix**: Restart coordinator node (or entire cluster if persistent).

### Files disappear from BeeGFS but don't appear in next processor

**Symptom**: ListFile deletes source, but FetchFile fails with "File not found."

**Diagnosis**:
- `Completion Strategy` on ListFile is "Delete" (not recommended)
- File is deleted by external process between ListFile and FetchFile

**Fix**:
- Set ListFile `Keep Source File: true` for testing
- Use FetchFile `Completion Strategy: Move to Directory` instead

### High memory usage, NiFi crashes

**Symptom**: NiFi process uses > 10 GB RAM or is killed by OOM killer.

**Diagnosis**:
- Check System Diagnostics: Hamburger → System Diagnostics
- Look at content repository disk space

**Fix**:
- Increase JVM heap: Edit `/opt/nifi/conf/bootstrap.conf`, raise `java.arg.3` (Xmx)
- Reduce queue back-pressure thresholds to prevent queues from growing unbounded
- Enable disk-based queue overflow (advanced config)
- Delete old provenance data: `rm -rf ./provenance_repository/` then restart

### Ceph S3 upload fails with "Signature does not match"

**Symptom**: PutS3Object returns 403 Forbidden with signature error.

**Diagnosis**:
- Access key or secret key is wrong
- Endpoint URL format is incorrect
- Region mismatch

**Fix**:
- Verify credentials: test with `aws s3 ls s3://bucket --endpoint-url http://ceph-rgw:7480`
- Check `Use Path Style Access` is enabled (required for Ceph)
- Verify `Endpoint Override URL` format: `http://ceph-rgw.hpc.example.com:7480` (no trailing slash)

### Slurm integration stops updating job status

**Symptom**: ExecuteStreamCommand runs but `squeue` output stops updating.

**Diagnosis**:
- Job has finished and aged off squeue output
- SSH connection to Slurm node is stale

**Fix**:
- Use Slurm REST API (`slurmrestd`) instead of CLI (more reliable)
- Add timeout to ExecuteStreamCommand and add retry logic

---

## 8. References

### Official NiFi Documentation

- [Apache NiFi System Administrator's Guide](https://nifi.apache.org/docs/nifi-docs/html/administration-guide.html)
- [Apache NiFi Expression Language Guide](https://nifi.apache.org/docs/nifi-docs/html/expression-language-guide.html)
- [Apache NiFi User Guide](https://nifi.apache.org/docs/nifi-docs/html/user-guide.html)
- [NiFi Cluster Architecture](https://nifi.apache.org/docs/nifi-docs/html/administration-guide.html#cluster-setup)

### Processor Documentation

- [ListFile Processor](https://nifi.apache.org/components/org.apache.nifi.processors.standard.ListFile/)
- [FetchFile Processor](https://nifi.apache.org/components/org.apache.nifi.processors.standard.FetchFile/)
- [ListS3 Processor](https://nifi.apache.org/components/org.apache.nifi.processors.aws.s3.ListS3/)
- [PutS3Object Processor](https://nifi.apache.org/components/org.apache.nifi.processors.aws.s3.PutS3Object/)
- [ExecuteProcess Processor](https://nifi.apache.org/components/org.apache.nifi.processors.standard.ExecuteProcess/)
- [ExecuteStreamCommand Processor](https://nifi.apache.org/components/org.apache.nifi.processors.standard.ExecuteStreamCommand/)
- [InvokeHTTP Processor](https://nifi.apache.org/components/org.apache.nifi.processors.standard.InvokeHTTP/)
- [RouteOnAttribute Processor](https://nifi.apache.org/components/org.apache.nifi.processors.standard.RouteOnAttribute/)
- [JoltTransformJSON Processor](https://nifi.apache.org/components/org.apache.nifi.processors.standard.JoltTransformJSON/)

### Integration Guides

- [NiFiKop Kubernetes Operator](https://github.com/konpyutaika/nifikop)
- [Stackable NiFi Operator](https://docs.stackable.tech/home/stable/nifi/)
- [Apache NiFi Helm Chart](https://github.com/apache/nifi/tree/main/nifi-docker)
- [NiFi Docker Community](https://hub.docker.com/r/apache/nifi)
- [NiFi.rocks Docker Compose Clustering](https://www.nifi.rocks/apache-nifi-docker-compose-cluster/)

### HPC-Specific Integration

- [Slurm REST API Documentation](https://slurm.schedmd.com/rest_api.html)
- [BeeGFS Official Documentation](https://www.beegfs.io/wiki/)
- [Ceph RadosGW S3 API Documentation](https://docs.ceph.com/en/latest/radosgw/s3/)

### Monitoring and Security

- [Prometheus Integration](https://prometheus.io/)
- [Grafana NiFi Dashboard (ID: 12314)](https://grafana.com/grafana/dashboards/12314-nifi-prometheusreportingtask-dashboard/)
- [NiFi TLS Toolkit](https://nifi.apache.org/docs/nifi-docs/html/administration-guide.html#tls_toolkit)

### Community Resources

- [Apache NiFi Mailing Lists](https://nifi.apache.org/mailing_lists.html)
- [NiFi JIRA Issue Tracker](https://issues.apache.org/jira/browse/NIFI)
- [NiFi Slack Community](https://nifi.apache.org/)

---

## 9. Related Tutorials

- [[apache-nifi-hpc-sysadmin-beginner-guide|Apache NiFi HPC Sysadmin Beginner Guide]]
- [[kubernetes-beginner-guide]]
- [[docker-beginner-guide]]
- [[linux-permissions-deep-dive]]
- [[slurm-administrator-guide]]

---

## Summary

**Key takeaways:**

- **Clustering with ZooKeeper** enables fault tolerance, automatic failover, and load distribution across nodes.
- **Primary Node election** ensures listing processors (ListFile, ListS3, ListSFTP) run once per cycle, preventing duplicate processing.
- **Data Provenance** provides complete audit trail and replay capabilities for debugging and compliance.
- **Slurm integration** automates HPC job submission, status monitoring, and result processing through ExecuteProcess and InvokeHTTP.
- **BeeGFS/Ceph integration** leverages NiFi's file processors (no special connectors needed) for multi-tier data archival and movement.
- **Kubernetes deployment** via Helm or NiFiKop operator enables cloud-native HPC dataflow automation.
- **Git-based flow version control** (NiFi 2.x) enables collaborative flow development and CI/CD integration.
- **Security hardening** includes TLS, LDAP/Kerberos authentication, RBAC, and encrypted sensitive properties.
- **Monitoring via Prometheus/Grafana** and provenance queries enables real-time visibility into flow health and data lineage.

**Next steps:**

- Deploy a production 3-node NiFi cluster with external ZooKeeper on your HPC infrastructure.
- Build a complete BeeGFS → Slurm → Ceph → Notification pipeline tailored to your workflows.
- Integrate NiFi monitoring with your existing Prometheus/Grafana stack.
- Set up Git-based flow version control for collaborative development across your team.
- Evaluate Kubernetes deployment if your HPC center is containerization-ready.
- Document runbooks for common operational tasks (scaling, backup/restore, certificate renewal).
