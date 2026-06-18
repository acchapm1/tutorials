---
title: "Headscale — Deep Dive Reference"
date: 2026-05-29
difficulty: advanced
tags: [headscale, tailscale, wireguard, vpn, mesh-networking, self-hosted, networking, oidc, acl, derp, production]
---

# Headscale — Deep Dive Reference

## 1. Overview

This reference builds on the [[headscale-beginner-guide|Headscale Beginner Guide]] and explores the internals of Headscale's coordination architecture, advanced ACL policies, OIDC integration, custom DERP infrastructure, subnet routing, exit nodes, production hardening, and operational patterns for running Headscale at scale.

You will learn how to architect a production-grade Headscale deployment, enforce zero-trust network segmentation, integrate with enterprise identity providers, and troubleshoot complex networking scenarios.

## 2. Prerequisites

- Completion of the [[headscale-beginner-guide|Headscale Beginner Guide]] — you should have a working Headscale instance
- Strong familiarity with Linux system administration, including [[linux-permissions-deep-dive|ACLs and file permissions]], systemd services, and networking
- Understanding of TLS, DNS, and reverse proxies
- Experience with [[docker-test-container-deep-dive|Docker Compose]] for container deployments
- Familiarity with [[ssh-config-deep-dive|SSH configuration]] for remote server management
- Basic knowledge of OIDC/OAuth2 flows if implementing SSO

## 3. Key Concepts

### 3.1 Coordination Architecture

Headscale implements the Tailscale coordination protocol. Understanding the flow is essential for debugging:

```
Client A                     Headscale                    Client B
   |                            |                            |
   |-- Register (public key) -->|                            |
   |                            |<-- Register (public key) --|
   |                            |                            |
   |<-- Peer list + endpoints --|-- Peer list + endpoints -->|
   |                            |                            |
   |========= Direct WireGuard tunnel (no relay) ===========|
   |                            |                            |
   |  (if direct fails)        |                            |
   |-------- DERP relay ------->|--------- DERP relay ------>|
```

Key points:
- Headscale stores public keys, IP assignments, user associations, and ACL policy
- The `noise` protocol (Tailscale's custom Noise Protocol Framework variant) secures the control channel
- WireGuard data traffic never touches Headscale unless it is also acting as a DERP relay
- Headscale assigns stable IPs from the configured `prefixes` range and persists them in its database

### 3.2 Database Backend

Headscale uses SQLite by default but supports PostgreSQL for high-availability deployments:

```yaml
# SQLite (default — suitable for most deployments)
database:
  type: sqlite
  sqlite:
    path: /var/lib/headscale/db.sqlite

# PostgreSQL (for HA or large deployments)
database:
  type: postgres
  postgres:
    host: db.internal
    port: 5432
    name: headscale
    user: headscale
    pass: <password>
    ssl: true
    max_open_conns: 10
    max_idle_conns: 5
    conn_max_idle_time_secs: 3600
```

SQLite handles hundreds of nodes without issue. Switch to PostgreSQL when you need database replication or want Headscale to be stateless for container orchestration.

### 3.3 The Noise Protocol and Key Types

Headscale manages several key types:

| Key Type | Purpose | Format |
|----------|---------|--------|
| Machine Key (`mkey:`) | Identifies the device hardware | Persists across re-registrations |
| Node Key (`nodekey:`) | WireGuard public key for this node | Rotates on key expiry |
| Disco Key | Used for NAT traversal discovery | Ephemeral per session |
| Pre-Auth Key | One-time or reusable registration token | Created via CLI, expires |
| API Key | Programmatic access to Headscale API | Created via CLI, expires |

### 3.4 Subnet Routes and Exit Nodes

**Subnet routes** let a node advertise access to a local network:

```bash
# On the node that has access to 192.168.1.0/24
tailscale up --login-server https://headscale.example.com \
  --advertise-routes=192.168.1.0/24
```

```bash
# On the Headscale server — enable the route
headscale routes list
headscale routes enable --route <route-id>
```

**Exit nodes** route all internet traffic through a specific node:

```bash
# On the exit node
tailscale up --login-server https://headscale.example.com \
  --advertise-exit-node

# On the Headscale server
headscale routes enable --route <exit-route-id>

# On the client wanting to use the exit node
tailscale up --exit-node=<exit-node-ip>
```

## 4. Step-by-Step Instructions

### 4.1 Production systemd Hardening

The default systemd unit file provides security hardening. Review and customize it:

```bash
sudo systemctl cat headscale.service
```

Key hardening directives in the unit file:

```ini
[Service]
User=headscale
Group=headscale
ExecStart=/usr/bin/headscale serve

# Security hardening
NoNewPrivileges=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/var/lib/headscale /var/run/headscale
ProtectKernelTunables=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
RestrictNamespaces=yes
```

If you are using a non-standard data path, add it to `ReadWritePaths`. The systemd sandboxing ensures Headscale cannot access files outside its designated directories (see [[linux-permissions-deep-dive|Linux Permissions Deep Dive]] for how these restrictions layer with filesystem ACLs).

### 4.2 Full Configuration Reference

Below is an annotated production configuration covering the most important sections:

```yaml
# --- Server Identity ---
server_url: https://headscale.example.com
listen_addr: 0.0.0.0:8080
metrics_listen_addr: 127.0.0.1:9090

# --- gRPC ---
grpc_listen_addr: 0.0.0.0:50443
grpc_allow_insecure: false

# --- TLS (if not using a reverse proxy) ---
tls_cert_path: ""
tls_key_path: ""

# --- Noise Protocol ---
noise:
  private_key_path: /var/lib/headscale/noise_private.key

# --- IP Allocation ---
prefixes:
  v4: 100.64.0.0/10
  v6: fd7a:115c:a1e0::/48
  allocation: sequential  # or "random"

# --- Database ---
database:
  type: sqlite
  sqlite:
    path: /var/lib/headscale/db.sqlite
    write_ahead_log: true

# --- DERP ---
derp:
  server:
    enabled: false          # Enable if running embedded DERP
    region_id: 999
    region_code: "custom"
    region_name: "My DERP"
    stun_listen_addr: 0.0.0.0:3478
    private_key_path: /var/lib/headscale/derp_server_private.key
    automatically_add_embedded_derp_region: true
    ipv4: 203.0.113.10
    ipv6: ""
  urls:
    - https://controlplane.tailscale.com/derpmap/default
  paths: []
  auto_update_enabled: true
  update_frequency: 24h

# --- DNS ---
dns:
  magic_dns: true
  base_domain: tail.example.com
  nameservers:
    global:
      - 1.1.1.1
      - 8.8.8.8
    split: {}
  search_domains: []
  extra_records: []

# --- ACL Policy ---
policy:
  mode: file
  path: /etc/headscale/acl.hujson

# --- OIDC ---
oidc:
  only_start_if_oidc_is_available: true
  issuer: ""
  client_id: ""
  client_secret_path: ""
  scope: ["openid", "profile", "email"]
  extra_params: {}
  allowed_domains: []
  allowed_groups: []
  allowed_users: []
  strip_email_domain: true

# --- Logging ---
log:
  format: text   # text or json
  level: info    # trace, debug, info, warn, error

# --- Tuning ---
ephemeral_node_inactivity_timeout: 30m
node_update_check_interval: 10s
```

### 4.3 OIDC Authentication Integration

OIDC replaces manual user creation with SSO from an identity provider.

#### Keycloak Setup

1. In Keycloak, create a new client:
   - Client ID: `headscale`
   - Client Protocol: `openid-connect`
   - Access Type: `confidential`
   - Valid Redirect URIs: `https://headscale.example.com/oidc/callback`

2. Under the client's **Client Scopes**, create a new scope called `groups` with a **Group Membership** mapper (if you need group-based authorization).

3. Configure Headscale:

```yaml
oidc:
  only_start_if_oidc_is_available: true
  issuer: "https://keycloak.example.com/realms/myrealm"
  client_id: "headscale"
  client_secret_path: "/etc/headscale/oidc_secret"
  scope: ["openid", "profile", "email", "groups"]
  allowed_domains:
    - "example.com"
  strip_email_domain: true
```

4. Store the client secret:

```bash
echo -n "your-client-secret" | sudo tee /etc/headscale/oidc_secret
sudo chmod 600 /etc/headscale/oidc_secret
sudo chown headscale:headscale /etc/headscale/oidc_secret
```

#### Authelia Setup

Authelia natively supports OIDC. Add a client definition to Authelia's configuration:

```yaml
# In Authelia's configuration
identity_providers:
  oidc:
    clients:
      - client_id: headscale
        client_name: Headscale
        client_secret: '<hashed-secret>'
        public: false
        authorization_policy: two_factor
        redirect_uris:
          - https://headscale.example.com/oidc/callback
        scopes:
          - openid
          - profile
          - email
          - groups
        response_types:
          - code
        grant_types:
          - authorization_code
        userinfo_signed_response_alg: none
```

Then configure Headscale's OIDC section to point at your Authelia issuer.

#### OIDC Client Login Flow

Once OIDC is configured, clients authenticate via browser:

```bash
tailscale up --login-server https://headscale.example.com
```

This opens a browser window for SSO login. After authentication, Headscale creates (or maps to) a user based on the email address and registers the node automatically.

### 4.4 Advanced ACL Policies

ACL policies use huJSON format (JSON with comments and trailing commas). Here is a comprehensive example implementing zero-trust segmentation:

```json
{
  // --- Groups ---
  "groups": {
    "group:admin":    ["alice", "bob"],
    "group:dev":      ["charlie", "dave"],
    "group:intern":   ["eve"],
    "group:ops":      ["alice", "frank"]
  },

  // --- Tag Owners ---
  // Tags identify device roles, not users
  "tagOwners": {
    "tag:server":     ["group:ops"],
    "tag:database":   ["group:ops"],
    "tag:monitoring": ["group:ops"],
    "tag:webserver":  ["group:ops", "group:dev"]
  },

  // --- Hosts (aliases) ---
  "hosts": {
    "prod-db":    "100.64.0.10/32",
    "staging-db": "100.64.0.11/32",
    "internal":   "192.168.1.0/24"
  },

  // --- ACL Rules ---
  "acls": [
    // Admins can access everything
    {
      "action": "accept",
      "src": ["group:admin"],
      "dst": ["*:*"]
    },
    // Ops can access all servers
    {
      "action": "accept",
      "src": ["group:ops"],
      "dst": ["tag:server:*", "tag:database:*", "tag:monitoring:*"]
    },
    // Devs can access web servers and staging DB
    {
      "action": "accept",
      "src": ["group:dev"],
      "dst": [
        "tag:webserver:80,443,8080",
        "staging-db:5432"
      ]
    },
    // Monitoring servers can reach all tagged servers on metrics port
    {
      "action": "accept",
      "src": ["tag:monitoring"],
      "dst": ["tag:server:9090,9100", "tag:database:9090,9100"]
    },
    // All nodes can reach DNS
    {
      "action": "accept",
      "src": ["*"],
      "dst": ["*:53"]
    },
    // Interns can only access web servers on HTTP/HTTPS
    {
      "action": "accept",
      "src": ["group:intern"],
      "dst": ["tag:webserver:80,443"]
    }
  ],

  // --- SSH Policy ---
  "ssh": [
    {
      "action": "accept",
      "src": ["group:admin"],
      "dst": ["tag:server"],
      "users": ["root", "admin"]
    },
    {
      "action": "accept",
      "src": ["group:dev"],
      "dst": ["tag:webserver"],
      "users": ["deploy"]
    }
  ]
}
```

Register nodes with tags:

```bash
# On the server to be tagged
tailscale up --login-server https://headscale.example.com \
  --advertise-tags=tag:server,tag:webserver

# Alternatively, set tags from the Headscale server
headscale nodes tag --identifier <node-id> --tags tag:server,tag:database
```

Reload the policy after editing:

```bash
sudo systemctl restart headscale
```

### 4.5 Custom DERP Server Infrastructure

For low-latency relaying or air-gapped environments, deploy your own DERP servers.

#### Embedded DERP (simplest)

Enable the DERP server built into Headscale:

```yaml
derp:
  server:
    enabled: true
    region_id: 999
    region_code: "myderp"
    region_name: "My Private DERP"
    stun_listen_addr: 0.0.0.0:3478
    private_key_path: /var/lib/headscale/derp_server_private.key
    automatically_add_embedded_derp_region: true
    ipv4: 203.0.113.10
  urls: []          # Remove default Tailscale DERP servers
  paths: []
```

#### External DERP Map

For multiple DERP relays across regions, create a custom DERP map JSON:

```json
{
  "Regions": {
    "900": {
      "RegionID": 900,
      "RegionCode": "us-east",
      "RegionName": "US East",
      "Nodes": [
        {
          "Name": "us-east-1",
          "RegionID": 900,
          "HostName": "derp-us-east.example.com",
          "STUNPort": 3478,
          "DERPPort": 443
        }
      ]
    },
    "901": {
      "RegionID": 901,
      "RegionCode": "eu-west",
      "RegionName": "EU West",
      "Nodes": [
        {
          "Name": "eu-west-1",
          "RegionID": 901,
          "HostName": "derp-eu-west.example.com",
          "STUNPort": 3478,
          "DERPPort": 443
        }
      ]
    }
  }
}
```

Save to `/etc/headscale/derp.json` and reference it:

```yaml
derp:
  server:
    enabled: false
  urls: []
  paths:
    - /etc/headscale/derp.json
```

### 4.6 Subnet Routes and Split DNS

#### Advertising Subnet Routes

Make an entire on-premises network accessible through the tailnet:

```bash
# On the gateway node (has access to 192.168.1.0/24)
tailscale up --login-server https://headscale.example.com \
  --advertise-routes=192.168.1.0/24,10.0.0.0/8

# Enable IP forwarding on the gateway
echo 'net.ipv4.ip_forward = 1' | sudo tee /etc/sysctl.d/99-tailscale.conf
echo 'net.ipv6.conf.all.forwarding = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
sudo sysctl -p /etc/sysctl.d/99-tailscale.conf
```

Enable the routes on Headscale:

```bash
headscale routes list
# ID | Node         | Prefix          | Enabled
# 1  | gateway      | 192.168.1.0/24  | false
# 2  | gateway      | 10.0.0.0/8      | false

headscale routes enable --route 1
headscale routes enable --route 2
```

#### Split DNS

Route DNS queries for specific domains to internal resolvers:

```yaml
dns:
  magic_dns: true
  base_domain: tail.example.com
  nameservers:
    global:
      - 1.1.1.1
    split:
      internal.corp:
        - 192.168.1.53
      dev.local:
        - 10.0.0.53
```

This routes `*.internal.corp` queries to `192.168.1.53` while using Cloudflare for everything else.

### 4.7 Production Docker Compose Deployment

A complete production-ready Docker Compose setup:

```yaml
# docker-compose.yml
services:
  headscale:
    image: headscale/headscale:0.25.1
    container_name: headscale
    restart: unless-stopped
    ports:
      - "8080:8080"     # Control plane
      - "9090:9090"     # Metrics
      - "3478:3478/udp" # STUN (if embedded DERP)
    volumes:
      - ./config:/etc/headscale
      - headscale-data:/var/lib/headscale
    environment:
      - TZ=UTC
    command: serve
    healthcheck:
      test: ["CMD", "headscale", "health"]
      interval: 30s
      timeout: 10s
      retries: 3

  caddy:
    image: caddy:2-alpine
    container_name: headscale-caddy
    restart: unless-stopped
    ports:
      - "443:443"
      - "80:80"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy-data:/data
      - caddy-config:/config
    depends_on:
      headscale:
        condition: service_healthy

  # Optional: Web UI
  headscale-ui:
    image: ghcr.io/ifargle/headscale-webui:latest
    container_name: headscale-ui
    restart: unless-stopped
    environment:
      - HS_SERVER=http://headscale:8080
      - KEY=<your-api-key>
    depends_on:
      headscale:
        condition: service_healthy

volumes:
  headscale-data:
  caddy-data:
  caddy-config:
```

For Docker Compose patterns and multi-service workflows, see [[docker-test-container-deep-dive|Docker Test Container Deep Dive]].

### 4.8 Headscale API and Automation

Headscale exposes a gRPC API that the CLI uses internally. Create an API key for programmatic access:

```bash
headscale apikeys create --expiration 90d
```

Use the API key with the remote CLI or HTTP endpoints:

```bash
# Remote CLI (from a different machine)
export HEADSCALE_CLI_ADDRESS="headscale.example.com:443"
export HEADSCALE_CLI_API_KEY="<your-api-key>"

headscale nodes list
headscale users list
```

Or via direct HTTP (the gRPC-gateway exposes REST-like endpoints):

```bash
curl -s -H "Authorization: Bearer <api-key>" \
  https://headscale.example.com/api/v1/node | jq '.nodes[] | {name, ipAddresses}'
```

### 4.9 Monitoring and Observability

Headscale exposes Prometheus metrics on `metrics_listen_addr`:

```bash
curl http://localhost:9090/metrics
```

Key metrics to monitor:

| Metric | Description |
|--------|-------------|
| `headscale_connected_clients` | Number of actively connected nodes |
| `headscale_registered_nodes` | Total registered nodes |
| `headscale_update_request_total` | Control plane update requests |
| `headscale_http_request_duration_seconds` | API latency histogram |

Example Prometheus scrape config:

```yaml
scrape_configs:
  - job_name: 'headscale'
    static_configs:
      - targets: ['headscale.internal:9090']
    scrape_interval: 15s
```

### 4.10 Backup and Recovery

#### SQLite Backup

```bash
# Hot backup using SQLite's online backup API
sqlite3 /var/lib/headscale/db.sqlite ".backup /backup/headscale-$(date +%Y%m%d).sqlite"

# Or via filesystem snapshot (stop Headscale first for consistency)
sudo systemctl stop headscale
cp /var/lib/headscale/db.sqlite /backup/
cp /var/lib/headscale/noise_private.key /backup/
cp /var/lib/headscale/derp_server_private.key /backup/  # if using embedded DERP
sudo systemctl start headscale
```

**Critical files to back up:**
- `db.sqlite` — all state (nodes, users, keys, routes)
- `noise_private.key` — server identity; if lost, all clients must re-register
- `config.yaml` — your configuration
- `acl.hujson` — ACL policy

#### PostgreSQL Backup

```bash
pg_dump -h db.internal -U headscale headscale > /backup/headscale-$(date +%Y%m%d).sql
```

## 5. Practical Examples

### Example 1 — Multi-Site Office Mesh

Connect three offices with subnet routes so each office can reach the others' LANs:

```
Office A (192.168.1.0/24)  ←──→  Headscale  ←──→  Office B (192.168.2.0/24)
                                     ↕
                              Office C (10.0.0.0/24)
```

Deploy a gateway node in each office:

```bash
# Office A gateway
tailscale up --login-server https://headscale.example.com \
  --advertise-routes=192.168.1.0/24 --hostname=gw-office-a

# Office B gateway
tailscale up --login-server https://headscale.example.com \
  --advertise-routes=192.168.2.0/24 --hostname=gw-office-b

# Office C gateway
tailscale up --login-server https://headscale.example.com \
  --advertise-routes=10.0.0.0/24 --hostname=gw-office-c
```

Enable all routes on Headscale, and every node in the tailnet can reach every office subnet.

### Example 2 — Zero-Trust IoT Network

Isolate IoT devices so they can only reach their management server:

```json
{
  "tagOwners": {
    "tag:iot":        ["group:ops"],
    "tag:iot-mgmt":   ["group:ops"]
  },
  "acls": [
    // IoT devices can only reach their management server
    {
      "action": "accept",
      "src": ["tag:iot"],
      "dst": ["tag:iot-mgmt:8883,443"]
    },
    // Management server can reach IoT devices for updates
    {
      "action": "accept",
      "src": ["tag:iot-mgmt"],
      "dst": ["tag:iot:22,443"]
    },
    // IoT devices cannot talk to each other (implicit deny)
  ]
}
```

### Example 3 — Kubernetes Cluster Networking

Use Headscale to provide overlay networking for a [[kubernetes-deep-dive|Kubernetes]] cluster spanning multiple clouds:

```bash
# On each K8s node, register with Headscale and advertise the pod CIDR
tailscale up --login-server https://headscale.example.com \
  --advertise-routes=10.244.1.0/24 \
  --hostname=k8s-node-01 \
  --authkey=<reusable-preauthkey>
```

This lets pods across different cloud providers communicate through WireGuard tunnels without cloud-specific VPN configurations.

## 6. Hands-On Exercises

### Exercise 1: OIDC Integration

1. Deploy a local Authelia or Keycloak instance (use Docker Compose)
2. Configure the OIDC client for Headscale
3. Disable pre-auth key registration and rely solely on OIDC
4. Register a node using browser-based SSO login
5. Verify the auto-created user matches the OIDC email

### Exercise 2: Custom DERP Deployment

1. Deploy Headscale with the embedded DERP server enabled
2. Disable Tailscale's public DERP servers (`urls: []`)
3. Register two nodes and verify they can communicate via your private DERP
4. Check `tailscale netcheck` to confirm only your DERP region appears
5. Monitor DERP traffic in the Headscale logs

### Exercise 3: Multi-Subnet Routing

1. Set up three VMs (or containers) on different subnets
2. Install Tailscale on one VM in each subnet; register all with Headscale
3. Advertise each subnet as a route
4. Enable the routes and verify cross-subnet connectivity
5. Apply an ACL policy that allows only specific subnets to communicate

### Exercise 4: Production Hardening Audit

Review your Headscale deployment against this checklist:

1. Headscale runs as a dedicated non-root user
2. systemd unit has `ProtectSystem=strict`, `PrivateTmp=yes`, `NoNewPrivileges=yes`
3. TLS terminates at a reverse proxy with automatic certificate renewal
4. ACL policy enforces least-privilege (no `*:*` for non-admin groups)
5. Database backups are automated and tested
6. `noise_private.key` permissions are `600`, owned by `headscale:headscale`
7. Metrics endpoint (`9090`) is not publicly accessible
8. OIDC secret file has `600` permissions
9. Preauthkeys have reasonable expiration times
10. Unused nodes are regularly expired or removed

## 7. Troubleshooting

### Direct Connections Failing (Everything Via DERP)

**Symptom:** `tailscale ping` always shows "via DERP" even between machines on the same LAN.

**Diagnosis:**
```bash
tailscale netcheck
```

Look for:
- UDP connectivity: if `UDP: false`, a firewall is blocking UDP
- STUN results: if no STUN responses, port 3478/UDP is blocked

**Fix:**
- Open UDP port 41641 on host firewalls (Tailscale's default WireGuard port)
- Ensure NAT devices support UDP hole-punching
- If behind CGNAT, direct connections may be impossible — DERP relay is the fallback

### ACL Changes Not Taking Effect

**Symptom:** Policy updates don't seem to apply.

**Fix:**
1. Validate huJSON syntax (trailing commas and comments are allowed, but structural errors silently fail):
```bash
headscale policy get
```
2. Restart Headscale after policy changes
3. On clients, force a policy refresh:
```bash
tailscale up --force-reauth
```

### OIDC "Invalid redirect URI" Error

**Symptom:** Browser shows redirect error during SSO login.

**Fix:**
- Verify the redirect URI in your IdP matches exactly: `https://headscale.example.com/oidc/callback`
- Check for trailing slashes — the URI must match character-for-character
- Ensure `server_url` in `config.yaml` matches the external URL clients use

### Database Locked Errors (SQLite)

**Symptom:** Logs show `database is locked` errors under load.

**Fix:**
- Enable WAL mode (default in recent versions):
```yaml
database:
  sqlite:
    write_ahead_log: true
```
- If the problem persists, migrate to PostgreSQL
- Ensure only one Headscale process accesses the SQLite file

### Nodes Appear Offline After Server Restart

**Symptom:** After restarting Headscale, nodes show as offline.

**Fix:**
- This is normal — nodes re-establish their control connections within `node_update_check_interval` (default 10s)
- If nodes don't reconnect, check that `noise_private.key` wasn't regenerated (this invalidates all existing sessions)
- Verify the server URL didn't change

### High Memory Usage

**Symptom:** Headscale uses more memory than expected.

**Fix:**
- Check the number of connected nodes: each active connection maintains state
- Review `derp` settings: fetching large DERP maps frequently uses memory
- Monitor with `headscale_connected_clients` metric
- Consider increasing `ephemeral_node_inactivity_timeout` to clean up ephemeral nodes faster

## 8. References

- [Headscale GitHub Repository](https://github.com/juanfont/headscale)
- [Headscale Configuration Example](https://github.com/juanfont/headscale/blob/main/config-example.yaml)
- [Headscale Official Documentation](https://headscale.net/stable/)
- [Headscale ACL Reference](https://headscale.net/stable/ref/acls/)
- [Headscale DNS Reference](https://headscale.net/stable/ref/dns/)
- [Headscale OIDC Reference](https://headscale.net/stable/ref/oidc/)
- [Headscale Remote CLI](https://headscale.net/stable/ref/remote-cli/)
- [Tailscale ACL Policy Syntax](https://tailscale.com/docs/reference/syntax/policy-file)
- [Tailscale ACL Examples](https://tailscale.com/kb/1192/acl-samples)
- [Tailscale Tags Documentation](https://tailscale.com/docs/features/tags)
- [WireGuard Protocol](https://www.wireguard.com/protocol/)
- [Noise Protocol Framework](http://www.noiseprotocol.org/)
- [Headscale WebUI](https://github.com/iFargle/headscale-webui)
- [Headplane](https://github.com/tale/headplane)

## 9. Related Tutorials

- [[headscale-beginner-guide|Headscale Beginner Guide]] — installation, first node registration, basic concepts
- [[ssh-config-deep-dive|SSH Config Deep Dive]] — SSH over Headscale tunnels for secure remote access
- [[ssh-tutorial|SSH Tutorial]] — SSH fundamentals
- [[mosh-beginner-guide|Mosh Beginner Guide]] — persistent remote sessions that work over Headscale tailnets
- [[mosh-deep-dive|Mosh Deep Dive]] — advanced Mosh usage and network resilience
- [[docker-test-container-beginner-guide|Docker Test Container Beginner Guide]] — Docker fundamentals for container deployment
- [[docker-test-container-deep-dive|Docker Test Container Deep Dive]] — Docker Compose patterns used in Headscale production stacks
- [[linux-permissions-beginner-guide|Linux Permissions Beginner Guide]] — file ownership for Headscale config files
- [[linux-permissions-deep-dive|Linux Permissions Deep Dive]] — ACLs and systemd sandboxing
- [[kubernetes-beginner-guide|Kubernetes Beginner Guide]] — container orchestration
- [[kubernetes-deep-dive|Kubernetes Deep Dive]] — running Headscale as overlay networking for multi-cloud K8s

## 10. Summary

Key takeaways for production Headscale deployments:

- Use OIDC for authentication instead of manual user/preauthkey management at scale
- ACL policies should follow zero-trust principles: deny by default, allow specific flows with tags and groups
- The embedded DERP server removes dependency on Tailscale's infrastructure; deploy multiple DERP relays for geographic coverage
- Subnet routes and exit nodes extend your tailnet beyond registered devices to entire networks
- SQLite is fine for most deployments; PostgreSQL is available when you need HA
- Back up `noise_private.key` and the database — losing the private key forces all clients to re-register
- Monitor with Prometheus metrics and set alerts on `headscale_connected_clients` drops
- The gRPC/REST API enables automation for infrastructure-as-code workflows

**Next steps:**

- Implement infrastructure-as-code for Headscale configuration using Ansible or Terraform
- Set up Grafana dashboards using the Prometheus metrics endpoint
- Evaluate Headplane or headscale-webui for team-friendly graphical management
- Integrate Headscale node registration into your CI/CD pipeline for automated server provisioning
- Explore Tailscale SSH for managing [[ssh-config-deep-dive|SSH access]] through ACL policies instead of authorized_keys files
