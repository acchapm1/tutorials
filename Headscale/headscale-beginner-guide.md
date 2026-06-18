---
title: "Headscale — Beginner's Guide"
date: 2026-05-29
difficulty: beginner
tags: [headscale, tailscale, wireguard, vpn, mesh-networking, self-hosted, networking]
---

# Headscale — Beginner's Guide

## 1. Overview

Headscale is an open-source, self-hosted implementation of the Tailscale control server. Tailscale builds encrypted mesh networks on top of WireGuard, but its coordination server is proprietary. Headscale replaces that server so you keep full control of your network metadata, user accounts, and access policies while still using the standard Tailscale clients on every device.

**Why it matters:** if you have compliance constraints (GDPR, HIPAA), want unlimited users without per-seat costs, or need an air-gapped overlay network, Headscale lets you run the coordination plane on your own infrastructure.

**What you will learn:**

- What Headscale does and how it fits into the Tailscale ecosystem
- How to install and configure Headscale on a Linux server
- How to register Tailscale clients against your Headscale instance
- How to manage users, nodes, and pre-authentication keys
- Basic DNS and ACL configuration

## 2. Prerequisites

- A Linux server (Ubuntu 22.04+, Debian 12+, or Rocky/RHEL 9+) with a public IP address or accessible hostname
- A domain name with DNS control (e.g., `headscale.example.com`)
- Basic command-line comfort — navigating directories, editing files, running `systemctl`
- Familiarity with [[linux-permissions-beginner-guide|Linux file permissions]] (ownership, `chmod`)
- Tailscale client installed on at least one device you want to connect (macOS, Linux, Windows, iOS, or Android)
- A reverse proxy or the ability to obtain TLS certificates (Let's Encrypt via Certbot works well)

**Optional but helpful:**

- Experience with [[docker-test-container-beginner-guide|Docker containers]] if you prefer the container deployment path
- Familiarity with [[ssh-tutorial|SSH]] for remote server management

## 3. Key Concepts

### Tailnet

A **tailnet** is the private network that Headscale coordinates. Every device registered with your Headscale server joins your tailnet and can communicate with other devices over encrypted WireGuard tunnels. Think of it as a virtual LAN that spans the internet.

### Coordination Server

The coordination server (Headscale) never sees your traffic. It only exchanges public keys, IP assignments, and policy information between nodes. All data flows directly between devices through WireGuard tunnels.

### Users

A **user** in Headscale is the equivalent of a Tailscale "login" or "tailnet user." Nodes belong to users, and ACL policies reference users to control access. You can create multiple users to represent different people or service accounts.

### Nodes

A **node** is any device registered with Headscale — a laptop, server, phone, or container. Each node gets a stable IP address in the tailnet (by default in the `100.64.0.0/10` range).

### Pre-Authentication Keys (PreAuth Keys)

A **preauthkey** is a one-time or reusable token that lets a Tailscale client register with Headscale without interactive authentication. This is essential for headless servers, containers, and automation.

### DERP Relay

When two nodes cannot establish a direct WireGuard connection (e.g., behind restrictive NATs), traffic relays through a **DERP server** (Designated Encrypted Relay for Packets). Headscale can use Tailscale's public DERP servers or you can run your own.

### MagicDNS

**MagicDNS** gives every node in your tailnet a DNS name based on its hostname and your configured base domain. Instead of remembering `100.64.0.5`, you reach the machine at `myserver.example.com`.

### ACLs (Access Control Lists)

ACL policies define which nodes and users can talk to each other and on which ports. By default Headscale allows all traffic within the tailnet; ACLs let you enforce least-privilege segmentation.

## 4. Step-by-Step Instructions

### Step 1 — Prepare the Server

Update packages and ensure your firewall allows the necessary ports:

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y   # Debian/Ubuntu
# or
sudo dnf update -y                        # Rocky/RHEL

# Open required ports
# 443/tcp  — HTTPS for the control plane and DERP
# 3478/udp — STUN for NAT traversal
sudo ufw allow 443/tcp
sudo ufw allow 3478/udp
sudo ufw reload
```

### Step 2 — Set Up DNS

Create an A record pointing your chosen subdomain to your server's public IP:

```
headscale.example.com  →  203.0.113.10
```

Verify it resolves:

```bash
dig +short headscale.example.com
```

Expected output:
```
203.0.113.10
```

### Step 3 — Install Headscale (Standalone Binary)

Download the latest release from GitHub:

```bash
# Check https://github.com/juanfont/headscale/releases for the latest version
HEADSCALE_VERSION="0.25.1"

wget -O /tmp/headscale.deb \
  "https://github.com/juanfont/headscale/releases/download/v${HEADSCALE_VERSION}/headscale_${HEADSCALE_VERSION}_linux_amd64.deb"

sudo dpkg -i /tmp/headscale.deb
```

For RPM-based systems:

```bash
wget -O /tmp/headscale.rpm \
  "https://github.com/juanfont/headscale/releases/download/v${HEADSCALE_VERSION}/headscale_${HEADSCALE_VERSION}_linux_amd64.rpm"

sudo rpm -i /tmp/headscale.rpm
```

### Step 4 — Configure Headscale

The default configuration lives at `/etc/headscale/config.yaml`. Download the example config for your version and edit it:

```bash
sudo nano /etc/headscale/config.yaml
```

Key settings to change:

```yaml
# The public URL clients will use to reach Headscale
server_url: https://headscale.example.com

# Address and port Headscale listens on
listen_addr: 0.0.0.0:8080

# Where Headscale stores its data
database:
  type: sqlite
  sqlite:
    path: /var/lib/headscale/db.sqlite

# IP ranges for tailnet nodes
prefixes:
  v4: 100.64.0.0/10
  v6: fd7a:115c:a1e0::/48

# DNS configuration
dns:
  magic_dns: true
  base_domain: example.com
  nameservers:
    global:
      - 1.1.1.1
      - 8.8.8.8
```

Create the data directory:

```bash
sudo mkdir -p /var/lib/headscale
```

### Step 5 — Set Up TLS with a Reverse Proxy

Headscale needs HTTPS. The simplest approach is a reverse proxy with automatic TLS. Here is an example using Caddy:

```bash
sudo apt install caddy
```

Edit `/etc/caddy/Caddyfile`:

```
headscale.example.com {
    reverse_proxy localhost:8080
}
```

```bash
sudo systemctl restart caddy
```

Caddy automatically obtains and renews Let's Encrypt certificates. Alternatively, you can use nginx or configure Headscale's built-in TLS by specifying `tls_cert_path` and `tls_key_path` in `config.yaml`.

### Step 6 — Start Headscale

```bash
# Enable and start the service
sudo systemctl enable --now headscale

# Verify it is running
sudo systemctl status headscale
```

Expected output:
```
● headscale.service - headscale controller
     Loaded: loaded (/usr/lib/systemd/system/headscale.service; enabled)
     Active: active (running) since ...
```

Test the endpoint:

```bash
curl https://headscale.example.com/health
```

Expected output:
```json
{"status":"ok"}
```

### Step 7 — Create a User

```bash
headscale users create alice
```

Expected output:
```
User created
```

List users:

```bash
headscale users list
```

### Step 8 — Register Your First Node

On the client machine, install Tailscale and point it at your Headscale server:

```bash
# Linux
tailscale up --login-server https://headscale.example.com
```

The client will print a URL. On the Headscale server, register the node using the key from that URL:

```bash
headscale nodes register --user alice --key mkey:<key_from_url>
```

**Alternative — use a preauthkey for headless registration:**

```bash
# On the Headscale server
headscale preauthkeys create --user alice --expiration 1h

# On the client
tailscale up --login-server https://headscale.example.com \
  --authkey <preauthkey>
```

### Step 9 — Verify Connectivity

On the client:

```bash
tailscale status
```

Expected output:
```
100.64.0.1  headscale-server  alice  linux  -
100.64.0.2  my-laptop         alice  linux  active; direct ...
```

Ping another node:

```bash
tailscale ping headscale-server
```

## 5. Practical Examples

### Example 1 — Connect a Home Server and Laptop

You have a home server behind NAT and a laptop on a coffee-shop Wi-Fi. After registering both with Headscale, you can [[ssh-tutorial|SSH]] directly between them using tailnet IPs or MagicDNS names:

```bash
ssh user@home-server.example.com
```

No port forwarding, no dynamic DNS, no VPN client configuration — WireGuard handles the encryption, and Headscale coordinates the connection.

### Example 2 — Docker Deployment

If you prefer containers (see [[docker-test-container-beginner-guide|Docker basics]]):

```yaml
# docker-compose.yml
services:
  headscale:
    image: headscale/headscale:0.25.1
    container_name: headscale
    restart: unless-stopped
    ports:
      - "8080:8080"
      - "9090:9090"
    volumes:
      - ./config:/etc/headscale
      - ./data:/var/lib/headscale
    command: serve
```

```bash
# Create config directory and download example config
mkdir -p config data
wget -O config/config.yaml \
  https://raw.githubusercontent.com/juanfont/headscale/main/config-example.yaml

# Edit config.yaml with your settings, then start
docker compose up -d

# Run CLI commands via docker exec
docker exec headscale headscale users create alice
```

### Example 3 — Automated Server Registration with PreAuth Keys

For deploying many servers (e.g., in a [[kubernetes-beginner-guide|Kubernetes]] cluster):

```bash
# Create a reusable preauthkey valid for 24 hours
headscale preauthkeys create --user servers --reusable --expiration 24h
```

Use this key in your provisioning scripts or cloud-init:

```bash
tailscale up --login-server https://headscale.example.com \
  --authkey <reusable-preauthkey> \
  --hostname "web-server-01"
```

## 6. Hands-On Exercises

### Exercise 1: Basic Setup

1. Install Headscale on a server (VM or cloud instance)
2. Create two users: `personal` and `servers`
3. Register two devices — one under each user
4. Verify both devices can see each other with `tailscale status`
5. Ping between the two devices using their MagicDNS names

### Exercise 2: PreAuth Key Workflow

1. Create a preauthkey for the `servers` user with a 1-hour expiration
2. Use that key to register a new node without interactive authentication
3. List all preauthkeys and verify the one you created shows as "used"
4. Try using an expired key and observe the error

### Exercise 3: Basic ACL Policy

1. Create a policy file at `/etc/headscale/acl.hujson`:

```json
{
  "groups": {
    "group:admin": ["alice"]
  },
  "acls": [
    {
      "action": "accept",
      "src": ["group:admin"],
      "dst": ["*:*"]
    },
    {
      "action": "accept",
      "src": ["*"],
      "dst": ["*:443", "*:80"]
    }
  ]
}
```

2. Set `policy.path: /etc/headscale/acl.hujson` in `config.yaml`
3. Restart Headscale and verify admin users have full access while others are limited to HTTP/HTTPS

## 7. Troubleshooting

### "Cannot reach control server"

**Cause:** The Tailscale client cannot connect to your Headscale URL.

**Fix:**
- Verify DNS resolves: `dig +short headscale.example.com`
- Confirm the server is listening: `curl https://headscale.example.com/health`
- Check firewall rules allow port 443
- Ensure TLS is configured correctly (expired or self-signed certificates will fail)

### "Node registered but cannot ping other nodes"

**Cause:** Usually a DERP/NAT traversal issue.

**Fix:**
- Check `tailscale netcheck` on both nodes for DERP connectivity
- Ensure UDP port 3478 (STUN) is open on the Headscale server
- Verify the `derp` section in `config.yaml` is configured (Headscale uses Tailscale's public DERP servers by default)
- Try `tailscale ping <node>` — it will show whether the connection is direct or relayed

### "Key expired" or "Not authorized"

**Cause:** Node keys or preauthkeys have expired.

**Fix:**
- For expired node keys: `headscale nodes expire <node-id>` then re-register
- For expired preauthkeys: create a new one with `headscale preauthkeys create`
- Check key expiration with `headscale nodes list` or `headscale preauthkeys list`

### "MagicDNS names not resolving"

**Cause:** DNS configuration issue.

**Fix:**
- Verify `dns.magic_dns: true` in `config.yaml`
- Check `dns.base_domain` is set
- On the client, run `tailscale dns status` to check DNS configuration
- Restart the Tailscale client: `sudo systemctl restart tailscaled`

### Headscale fails to start

**Cause:** Configuration or permission error.

**Fix:**
- Check logs: `journalctl -u headscale -e`
- Validate YAML syntax in `config.yaml`
- Ensure `/var/lib/headscale/` is writable by the `headscale` user
- Review [[linux-permissions-beginner-guide|file permissions]] on the config and data directories

## 8. References

- [Headscale GitHub Repository](https://github.com/juanfont/headscale)
- [Headscale Official Documentation](https://headscale.net/stable/)
- [Headscale Setup Requirements](https://headscale.net/stable/setup/requirements/)
- [Headscale Configuration Reference](https://headscale.net/stable/ref/configuration/)
- [Headscale DNS Reference](https://headscale.net/stable/ref/dns/)
- [Headscale ACL Reference](https://headscale.net/stable/ref/acls/)
- [Tailscale Client Downloads](https://tailscale.com/download)
- [Tailscale Custom Control Server Docs](https://tailscale.com/docs/how-to/set-up-custom-control-server)
- [WireGuard Project](https://www.wireguard.com/)

## 9. Related Tutorials

- [[headscale-deep-dive|Headscale Deep Dive]] — advanced configuration, OIDC, custom DERP servers, production hardening
- [[ssh-tutorial|SSH Tutorial]] — SSH fundamentals used alongside Headscale for remote access
- [[ssh-config-deep-dive|SSH Config Deep Dive]] — advanced SSH configuration that pairs well with Headscale tunnels
- [[mosh-beginner-guide|Mosh Beginner Guide]] — persistent remote sessions; Mosh works over Headscale tailnets
- [[mosh-deep-dive|Mosh Deep Dive]] — advanced Mosh usage over mesh networks
- [[docker-test-container-beginner-guide|Docker Test Container Beginner Guide]] — Docker fundamentals for container-based Headscale deployment
- [[docker-test-container-deep-dive|Docker Test Container Deep Dive]] — advanced Docker patterns including Compose
- [[linux-permissions-beginner-guide|Linux Permissions Beginner Guide]] — file ownership and permissions for Headscale config files
- [[linux-permissions-deep-dive|Linux Permissions Deep Dive]] — ACLs and advanced permission management
- [[kubernetes-beginner-guide|Kubernetes Beginner Guide]] — orchestrating containers; Headscale can provide overlay networking for clusters

## 10. Summary

You now have a working Headscale instance coordinating encrypted WireGuard tunnels between your devices. The key takeaways:

- Headscale replaces Tailscale's proprietary control server, giving you full ownership of your mesh network
- The coordination server never sees your traffic — it only exchanges keys and metadata
- Users, nodes, and preauthkeys are the three core management primitives
- MagicDNS and ACLs make the network usable and secure without manual IP management
- Docker and standalone binary deployments are both well-supported

**Next steps:**

- Read the [[headscale-deep-dive|Headscale Deep Dive]] for OIDC integration, custom DERP servers, subnet routes, and production hardening
- Set up ACL policies to enforce least-privilege access between nodes
- Configure OIDC with an identity provider like Keycloak or Authelia for SSO
- Explore the Headscale web UI options (headscale-ui or Headplane) for graphical management
