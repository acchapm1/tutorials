---
title: "Kubernetes: A Beginner's Guide"
date: 2026-04-10
difficulty: beginner
tags: [kubernetes, k8s, docker, containers, orchestration, kubectl, pods, deployments, services]
---

# Kubernetes: A Beginner's Guide

> A hands-on, project-based tutorial that takes you from zero to deploying real workloads on a local Kubernetes cluster.

---

## 1. Overview

Kubernetes (K8s) is an open-source container orchestration platform that automates the deployment, scaling, and management of containerized applications. Instead of running containers manually on individual machines, Kubernetes lets you describe what you want (using simple YAML files), and the cluster figures out how to make it happen — automatically scaling, handling failures, and managing networking.

In this beginner's guide, you will learn:

- How to set up a Kubernetes cluster locally on macOS
- Core Kubernetes concepts (Pods, Deployments, Services, ConfigMaps, Secrets)
- How to deploy real applications
- How to monitor and debug your cluster
- Best practices for organizing and managing workloads

This guide emphasizes hands-on practice with real YAML examples, actual kubectl commands, and a complete real-world project. No prior Kubernetes experience is required, but basic familiarity with Docker containers and the command line is assumed.

---

## 2. Prerequisites

Before starting, ensure you have:

- **macOS** (Apple Silicon or Intel)
- **Docker Desktop** installed and running, OR **Minikube** (recommended for the best learning experience), OR **OrbStack** (fastest option)
- **Homebrew** package manager for installing tools
- **~4 GB of free RAM** for the Kubernetes cluster
- **A terminal** (Terminal.app, iTerm2, Warp, Ghostty, or similar)
- **Basic command-line familiarity** — you should be comfortable with `cd`, `ls`, and running commands

### Choosing a Local Kubernetes Platform

| Option | Best For | Setup Time | Resource Usage |
|--------|----------|-----------|-----------------|
| **Docker Desktop** | Convenience if already installed | ~2 min (toggle) | 1-2 GB extra RAM |
| **Minikube** (recommended) | Learning & following tutorials | ~5 min | 2 GB RAM |
| **OrbStack** | Power users wanting the fastest experience | ~5 min | 500 MB idle RAM |
| **Kind** | Testing multi-node clusters | ~3 min | Minimal (nodes as containers) |

**For this tutorial, we recommend Minikube** because it has the most documentation and is the standard for learning paths. However, the commands and YAML examples work on all platforms.

---

## 3. Key Concepts

### The Kubernetes Object Model

Kubernetes is built around **declarative objects** — you describe what you want, and Kubernetes works to maintain that state.

**Pod (smallest unit)**
- The smallest deployable object in Kubernetes
- Wraps one or more containers that share networking and storage
- Containers in a pod can communicate via `localhost`
- Usually created indirectly via Deployments (not manually)

**Deployment**
- Manages a set of identical pods
- Handles rolling updates, scaling, and rollbacks
- Ensures the desired number of replicas are always running
- Example: "I want 3 copies of my web server running"

**Service**
- Provides stable network endpoints for accessing pods
- Routes traffic to a set of pods using label selectors
- Types: ClusterIP (internal), NodePort (expose on host), LoadBalancer (external)
- Pods are ephemeral; Services provide a permanent address

**ConfigMap**
- Stores non-sensitive configuration data (strings, JSON, config files)
- Injected into pods as environment variables or mounted as files
- Example: database URL, feature flags, app settings

**Secret**
- Like ConfigMap but for sensitive data (passwords, API keys, certificates)
- Base64-encoded by default (not encrypted in etcd without additional config)
- Injected into pods securely (not exposed in logs)

**Namespace**
- Virtual cluster within a physical cluster
- Provides isolation for environments, teams, or applications
- Default namespace is used if not specified

**Ingress**
- HTTP/HTTPS routing with hostname and path-based rules
- Requires an Ingress Controller (e.g., NGINX)
- Example: route `api.example.com/users` to one service, `api.example.com/orders` to another

**PersistentVolume (PV) & PersistentVolumeClaim (PVC)**
- PV: actual storage resource
- PVC: a pod's request for storage
- Data persists across pod restarts (unlike ephemeral storage)
- Example: database needs durable storage

### Key kubectl Commands

| Command | Purpose |
|---------|---------|
| `kubectl get pods` | List pods |
| `kubectl describe pod <name>` | Show detailed info about a pod |
| `kubectl logs <pod>` | View pod logs |
| `kubectl exec -it <pod> -- /bin/sh` | Shell into a pod |
| `kubectl apply -f file.yaml` | Create/update from YAML |
| `kubectl delete pod <name>` | Delete a pod |
| `kubectl port-forward <pod> 8080:80` | Forward local port to pod |
| `kubectl get all -n <namespace>` | List all resources in a namespace |

---

## 4. Step-by-Step Instructions

### Step 1 — Install Kubernetes

**Option A: Docker Desktop (simplest if already installed)**

1. Open **Docker Desktop**
2. Click the **gear icon** (Settings) in the top-right
3. Select **Kubernetes** in the left sidebar
4. Check **Enable Kubernetes**
5. Click **Apply & Restart**

Docker Desktop will download and start K8s (takes 2–5 minutes). Once done, you have a single-node cluster ready.

**Option B: Minikube (recommended for learning)**

```bash
# Install Minikube
brew install minikube

# Start a cluster
minikube start

# Verify it's running
kubectl cluster-info
```

**Option C: OrbStack (fastest option for Mac)**

```bash
# Install OrbStack
brew install --cask orbstack

# OrbStack includes Kubernetes by default — it starts automatically
kubectl cluster-info
```

### Step 2 — Install CLI Tools

All platforms need `kubectl` and benefit from `helm` and `k9s`:

```bash
# kubectl — the main Kubernetes CLI
brew install kubectl

# helm — Kubernetes package manager
brew install helm

# k9s — terminal-based cluster dashboard (optional but highly recommended)
brew install k9s
```

Verify installations:

```bash
kubectl version --client
helm version
k9s version
```

### Step 3 — Verify Your Cluster

Check that everything is set up correctly:

```bash
kubectl cluster-info
```

Expected output:

```
Kubernetes control plane is running at https://127.0.0.1:6443
CoreDNS is running at https://127.0.0.1:6443/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy
```

Check your nodes:

```bash
kubectl get nodes
```

Expected output:

```
NAME             STATUS   ROLES           AGE   VERSION
docker-desktop   Ready    control-plane   5m    v1.33.x
```

Or for Minikube:

```
NAME       STATUS   ROLES           AGE   VERSION
minikube   Ready    control-plane   3m    v1.35.x
```

Explore the system pods (K8s control plane components):

```bash
kubectl get pods -n kube-system
```

You should see: `coredns`, `etcd`, `kube-apiserver`, `kube-controller-manager`, `kube-proxy`, and `kube-scheduler`.

---

## 5. Practical Examples

### Example 1 — Create Your First Pod

A Pod is the smallest unit in Kubernetes. While you rarely create pods directly (you use Deployments instead), understanding pods is essential.

Create `pod-nginx.yaml`:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: my-nginx
  labels:
    app: nginx
spec:
  containers:
    - name: nginx
      image: nginx:alpine
      ports:
        - containerPort: 80
```

Deploy it:

```bash
kubectl apply -f pod-nginx.yaml
```

Watch the pod start:

```bash
kubectl get pods -w
```

Expected output:

```
NAME       READY   STATUS    RESTARTS   AGE
my-nginx   0/1     Pending   0          2s
my-nginx   0/1     ContainerCreating   0          3s
my-nginx   1/1     Running             0          5s
```

Inspect the pod:

```bash
kubectl describe pod my-nginx
```

View logs:

```bash
kubectl logs my-nginx
```

Access the web server from your machine:

```bash
kubectl port-forward my-nginx 8080:80
```

Open [http://localhost:8080](http://localhost:8080) in your browser — you should see the nginx welcome page.

Press `Ctrl+C` to stop port-forward.

Clean up:

```bash
kubectl delete pod my-nginx
```

### Example 2 — Deploy with a Deployment

A Deployment manages multiple identical pods, handles scaling, and manages updates. This is how you deploy real applications.

Create `deployment-nginx.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-deployment
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
        - name: nginx
          image: nginx:alpine
          ports:
            - containerPort: 80
          resources:
            requests:
              memory: "64Mi"
              cpu: "50m"
            limits:
              memory: "128Mi"
              cpu: "100m"
```

Deploy it:

```bash
kubectl apply -f deployment-nginx.yaml
```

Watch pods being created:

```bash
kubectl get pods -l app=nginx -w
```

Expected output:

```
NAME                               READY   STATUS    RESTARTS   AGE
nginx-deployment-66b6c48dd5-2xq8l   1/1     Running   0          5s
nginx-deployment-66b6c48dd5-5p9kz   1/1     Running   0          5s
nginx-deployment-66b6c48dd5-8hb3m   1/1     Running   0          5s
```

Scale the deployment:

```bash
# Scale to 5 replicas
kubectl scale deployment nginx-deployment --replicas=5

# Watch new pods appear
kubectl get pods -l app=nginx -w

# Scale back down
kubectl scale deployment nginx-deployment --replicas=2
```

Update the image (rolling update):

```bash
kubectl set image deployment/nginx-deployment nginx=nginx:latest

# Watch the rollout
kubectl rollout status deployment/nginx-deployment
```

Rollback if needed:

```bash
kubectl rollout history deployment/nginx-deployment
kubectl rollout undo deployment/nginx-deployment
```

### Example 3 — Services and Networking

Pods have ephemeral IPs. Services provide stable endpoints that route traffic to pods.

Create `service-clusterip.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: nginx-service
spec:
  type: ClusterIP
  selector:
    app: nginx
  ports:
    - port: 80
      targetPort: 80
```

Deploy it:

```bash
kubectl apply -f service-clusterip.yaml
kubectl get services
```

Expected output:

```
NAME            TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)
nginx-service   ClusterIP   10.96.220.233   <none>        80/TCP
```

Test from inside the cluster:

```bash
# Run a temporary pod with curl
kubectl run curl-test --image=curlimages/curl --rm -it -- curl nginx-service
```

Expected output:

```
<!DOCTYPE html>
<html>
<head>
    <title>Welcome to nginx!</title>
...
```

**NodePort Service** — Expose on your machine:

Create `service-nodeport.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: nginx-nodeport
spec:
  type: NodePort
  selector:
    app: nginx
  ports:
    - port: 80
      targetPort: 80
      nodePort: 30080
```

```bash
kubectl apply -f service-nodeport.yaml
```

Open [http://localhost:30080](http://localhost:30080) in your browser.

**LoadBalancer Service** — Docker Desktop special (binds directly to localhost):

Create `service-loadbalancer.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: nginx-lb
spec:
  type: LoadBalancer
  selector:
    app: nginx
  ports:
    - port: 8080
      targetPort: 80
```

```bash
kubectl apply -f service-loadbalancer.yaml
kubectl get services
```

Open [http://localhost:8080](http://localhost:8080).

Clean up services:

```bash
kubectl delete service nginx-service nginx-nodeport nginx-lb
```

### Example 4 — ConfigMaps and Secrets

**ConfigMaps** for non-sensitive configuration:

Create `configmap.yaml`:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  APP_ENV: "production"
  APP_DEBUG: "false"
  LOG_LEVEL: "info"
  config.json: |
    {
      "database": {
        "host": "db-service",
        "port": 5432
      }
    }
```

**Secrets** for sensitive data:

```bash
# Create a secret from command line
kubectl create secret generic db-credentials \
  --from-literal=username=admin \
  --from-literal=password=supersecret123
```

Or as YAML (`secret.yaml`):

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: db-credentials
type: Opaque
stringData:
  username: admin
  password: supersecret123
```

**Use them in a pod:**

Create `pod-with-config.yaml`:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app-with-config
spec:
  containers:
    - name: app
      image: busybox
      command: ['sh', '-c', 'echo "Env: $APP_ENV, User: $DB_USER" && cat /config/config.json && sleep 3600']
      env:
        - name: APP_ENV
          valueFrom:
            configMapKeyRef:
              name: app-config
              key: APP_ENV
        - name: DB_USER
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: username
      volumeMounts:
        - name: config-volume
          mountPath: /config
  volumes:
    - name: config-volume
      configMap:
        name: app-config
        items:
          - key: config.json
            path: config.json
```

Deploy and view logs:

```bash
kubectl apply -f configmap.yaml secret.yaml pod-with-config.yaml
kubectl logs app-with-config
```

Expected output:

```
Env: production, User: admin
{
  "database": {
    "host": "db-service",
    "port": 5432
  }
}
```

Clean up:

```bash
kubectl delete pod app-with-config configmap app-config secret db-credentials
```

### Example 5 — Namespaces for Organization

Namespaces organize your cluster like folders. Use them for different environments or teams.

```bash
# Create namespaces
kubectl create namespace dev
kubectl create namespace staging

# Deploy into a specific namespace
kubectl run test-pod --image=nginx:alpine -n dev

# List pods in a namespace
kubectl get pods -n dev

# List pods across all namespaces
kubectl get pods -A

# Set a default namespace
kubectl config set-context --current --namespace=dev
kubectl get pods  # now shows dev namespace by default

# Reset to default
kubectl config set-context --current --namespace=default

# Clean up
kubectl delete namespace dev staging
```

---

## 6. Hands-On Exercises

### Exercise 1 — Create and Manage a Deployment

1. Create a deployment that runs 2 replicas of the `nginx:alpine` image
2. Verify all pods are running with `kubectl get pods`
3. Scale it to 5 replicas
4. Create a Service to expose it
5. Forward a port to test it in your browser
6. Scale it back to 2 replicas
7. Delete the deployment and service

### Exercise 2 — Configure an App

1. Create a ConfigMap with some application settings (e.g., `DATABASE_URL=localhost:5432`)
2. Create a Pod that reads the ConfigMap as environment variables
3. Verify the environment variable is set by viewing the pod's logs
4. Update the ConfigMap and observe that new pods use the updated values
5. Delete the pod and ConfigMap

### Exercise 3 — Multi-tier Application

1. Deploy a Redis instance (use `redis:alpine` image)
2. Create a Service to expose it internally
3. Deploy a web frontend that connects to Redis
4. Expose the frontend with a NodePort Service
5. Test the application from your browser
6. Scale the frontend to 3 replicas
7. Clean up all resources

### Exercise 4 — Debugging

1. Create a Pod with an invalid image (e.g., `image: nonexistent:123`)
2. Watch it fail with `kubectl get pods -w`
3. Use `kubectl describe pod <name>` to see the error
4. Fix the image and reapply
5. Create a Pod that crashes (e.g., exits immediately) and practice using `kubectl logs --previous`

---

## 7. Troubleshooting

### Kubernetes cluster won't start

**Symptom:** `kubectl cluster-info` fails or shows "Unauthorized"

**Solution:**
- **Docker Desktop:** Go to Settings > Kubernetes > Reset Kubernetes Cluster
- **Minikube:** `minikube delete && minikube start`
- **OrbStack:** Restart OrbStack from the system menu

### Pod stuck in "Pending"

**Symptom:** Pod is not transitioning to Running after several seconds

**Solution:**
```bash
kubectl describe pod <pod-name>
```

Check the Events section at the bottom. Usually means insufficient resources. Try:
- Reduce resource requests: `requests: {cpu: "10m", memory: "32Mi"}`
- Increase Docker Desktop resources: Settings > Resources > Memory/CPUs
- On Minikube: `minikube start --cpus=4 --memory=4096`

### Pod stuck in "CrashLoopBackOff"

**Symptom:** Pod restarts repeatedly

**Solution:**
```bash
kubectl logs <pod-name>
kubectl logs <pod-name> --previous  # View previous log before crash
```

Check for:
- Wrong image name or tag
- Missing environment variables
- Application errors in logs
- Incorrect command or entry point

### Pod stuck in "ImagePullBackOff"

**Symptom:** Cannot pull the container image

**Solution:**
```bash
kubectl describe pod <pod-name>
```

Check:
- Image name spelling
- Tag exists (e.g., `nginx:nonexistent`)
- Internet connection (can you `docker pull` the image?)
- Private registry credentials (need `imagePullSecrets` in spec)

### Service not reachable

**Symptom:** Cannot connect to service endpoint

**Solution:**
```bash
# Verify service exists and has endpoints
kubectl get svc
kubectl get endpoints <service-name>

# If no endpoints, check that pod labels match service selector
kubectl get pods --show-labels
```

Match labels exactly: if service has `selector: app: nginx`, pods must have `labels: app: nginx`.

### Port already in use

**Symptom:** `port-forward` or NodePort fails with "address already in use"

**Solution:**
```bash
# Find what's using the port
lsof -i :8080

# Either kill the process or use a different port
kubectl port-forward <pod> 9090:80
```

### Cannot shell into pod

**Symptom:** `kubectl exec` fails with "container not running" or similar

**Solution:**
- Pod must be in Running state: `kubectl get pods`
- Container must have a shell: `bash`, `sh`, or `ash` (Alpine)
- Not all container images have shells (e.g., minimal images)

Try:
```bash
# Use sh instead of bash
kubectl exec -it <pod> -- sh

# Or use /bin/sh explicitly
kubectl exec -it <pod> -- /bin/sh
```

---

## 8. References

- **Official Kubernetes Documentation:** [kubernetes.io/docs](https://kubernetes.io/docs/)
- **Interactive Tutorials:** [killercoda.com/kubernetes](https://killercoda.com/kubernetes)
- **Kubernetes the Hard Way:** [github.com/kelseyhightower/kubernetes-the-hard-way](https://github.com/kelseyhightower/kubernetes-the-hard-way)
- **kubectl Cheat Sheet:** [kubernetes.io/docs/reference/kubectl/cheatsheet/](https://kubernetes.io/docs/reference/kubectl/cheatsheet/)
- **k9s Documentation:** [k9scli.io](https://k9scli.io/)
- **Helm Documentation:** [helm.sh/docs](https://helm.sh/docs/)
- **Container Image Registry:** [hub.docker.com](https://hub.docker.com/)

---

## 9. Summary

**Key takeaways:**

- **Pods** are the smallest unit but are usually managed by Deployments
- **Deployments** manage replicas, rolling updates, and scaling
- **Services** provide stable networking and load balancing
- **ConfigMaps** store non-sensitive config; **Secrets** store sensitive data
- **Namespaces** organize resources into virtual clusters
- **kubectl** is your main tool — learn the core commands well
- **k9s** provides a visual dashboard for real-time monitoring
- Always check events and logs when something goes wrong: `kubectl describe` and `kubectl logs`

**Next steps:**

Once you're comfortable with the basics, explore:

- **StatefulSets** — for databases and stateful workloads
- **DaemonSets** — run a pod on every node
- **Jobs and CronJobs** — batch and scheduled tasks
- **RBAC (Role-Based Access Control)** — secure who can do what
- **Network Policies** — firewall rules between pods
- **Horizontal Pod Autoscaler (HPA)** — auto-scale based on CPU/memory
- **Probes** — liveness, readiness, and startup health checks
- **Helm Charts** — package your applications for reuse
- **Ingress Controllers** — advanced routing (NGINX, Traefik, etc.)

Read the [[kubernetes-deep-dive|Kubernetes Deep Dive]] for advanced production patterns, cluster architecture, and enterprise features.

---

## Related Tutorials

- [[apache-nifi-beginner-guide|Apache NiFi]]
- [[linux-permissions-beginner-guide|Linux Permissions]]

---

## Quick Reference

### Essential kubectl Commands

```bash
# Get resources
kubectl get pods|deployments|services|nodes [-n namespace] [-o wide|yaml]

# Describe (detailed info + events)
kubectl describe pod|deployment|service <name>

# Logs
kubectl logs <pod-name> [-f] [--previous]

# Execute into a pod
kubectl exec -it <pod-name> -- /bin/sh

# Apply/delete from file
kubectl apply -f <file.yaml>
kubectl delete -f <file.yaml>

# Port forward
kubectl port-forward <pod-or-service> <local-port>:<remote-port>

# Scale
kubectl scale deployment <name> --replicas=N

# All resources in a namespace
kubectl get all -n <namespace>

# Watch for changes
kubectl get pods -w
```

### Common Resource Shortnames

| Full Name | Short |
|-----------|-------|
| pods | po |
| deployments | deploy |
| services | svc |
| configmaps | cm |
| secrets | sec |
| persistentvolumeclaims | pvc |
| namespaces | ns |
| ingresses | ing |
| replicasets | rs |

*Updated 2026-04-10 for Kubernetes v1.35+*
# Related Tutorials

- [[just-beginner-guide|Just Command Runner — Beginner Guide]] — Use just as a task runner for Kubernetes workflows (`just deploy`, `just status`, `just teardown`)
- [[just-deep-dive|Just Deep Dive]] — Advanced just patterns for Docker and Kubernetes management

- [[docker-test-container-beginner-guide|Docker Test Container Beginner Guide]] — use Docker containers for safe config testing (foundational Docker skills)

- [[headscale-beginner-guide|Headscale Beginner Guide]] — self-hosted mesh VPN; can provide overlay networking for Kubernetes
- [[headscale-deep-dive|Headscale Deep Dive]] — advanced Headscale deployment including Kubernetes integration
