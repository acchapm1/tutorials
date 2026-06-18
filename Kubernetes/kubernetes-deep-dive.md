---
title: "Kubernetes: Deep Dive Reference"
date: 2026-04-10
difficulty: advanced
tags: [kubernetes, k8s, operators, helm, rbac, networking, storage, monitoring, production, cluster-architecture]
---

# Kubernetes: Deep Dive Reference

> A comprehensive reference guide to advanced Kubernetes concepts, cluster architecture, production patterns, and enterprise-grade features.

---

## 1. Overview

This deep-dive guide builds on Kubernetes fundamentals to cover enterprise-scale cluster management, advanced workload patterns, security, networking, storage, monitoring, and operational best practices. It is designed as a reference you can return to as you build production systems, manage multi-cluster deployments, and solve real-world operational challenges.

Topics include:

- Cluster architecture and control plane components
- Advanced workload patterns (StatefulSets, DaemonSets, Jobs, CronJobs)
- Custom Resource Definitions (CRDs) and Operators
- RBAC and security policies
- Network Policies and advanced networking
- Storage provisioning and management
- Helm for package management and templating
- Monitoring, logging, and observability
- Production deployment patterns
- Troubleshooting at scale

For a gentler introduction, see the [[kubernetes-beginner-guide|Kubernetes Beginner's Guide]].

---

## 2. Prerequisites

Before diving into this material, you should have:

- **Solid grasp of Kubernetes fundamentals** — Pods, Deployments, Services, ConfigMaps, Secrets, Namespaces
- **Practical kubectl experience** — comfort with `apply`, `get`, `describe`, `logs`, `exec`
- **Understanding of container basics** — Docker images, registries, container networking
- **Linux/UNIX command-line skills** — shell scripting, file permissions, package management
- **A running Kubernetes cluster** — local (Minikube/Docker Desktop) or cloud (GKE, EKS, AKS)
- **Optional tools** — `helm`, `k9s`, `kustomize`, or `kubectx` for enhanced workflows

---

## 3. Key Concepts

### 3.1 Cluster Architecture

A Kubernetes cluster consists of:

**Control Plane (Master)**
- **kube-apiserver** — REST API for all cluster operations. All kubectl commands hit this endpoint.
- **etcd** — Distributed key-value store that holds the entire cluster state. Loss of etcd = loss of cluster.
- **kube-scheduler** — Assigns pods to nodes based on resource requirements, affinity rules, and taints.
- **kube-controller-manager** — Runs controllers (Deployment, ReplicaSet, StatefulSet, Job) that reconcile desired state with actual state.
- **cloud-controller-manager** — Integrates with cloud providers (AWS, GCP, Azure) for LoadBalancer services, persistent volumes, etc.

**Nodes (Workers)**
- **kubelet** — Agent on each node that runs pods. Communicates with API server.
- **kube-proxy** — Networking component that maintains network rules. Routes traffic to correct pods via iptables or IPVS.
- **Container runtime** — Docker, containerd, CRI-O, etc. Pulls and runs container images.

**Add-ons (typically installed separately)**
- **DNS (CoreDNS)** — Provides cluster DNS so pods can find services by name
- **Ingress Controller** — Routes HTTP/HTTPS traffic based on hostnames/paths
- **Network Plugin (CNI)** — Manages pod-to-pod networking (Flannel, Calico, Weave, etc.)
- **Storage Driver (CSI)** — Manages persistent volume provisioning

### 3.2 Advanced Workload Controllers

**StatefulSets**
- For stateful applications (databases, message queues, distributed systems)
- Pods have stable, unique identities (pod-0, pod-1, pod-2)
- Persistent volume claims are created per pod
- Rolling updates happen in order (0 → 1 → 2)
- Common for PostgreSQL, MongoDB, Redis Cluster, Kafka

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
spec:
  serviceName: postgres
  replicas: 3
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
        - name: postgres
          image: postgres:14
          ports:
            - containerPort: 5432
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 10Gi
```

**DaemonSets**
- Runs exactly one pod on each node (or nodes matching selectors)
- Used for node-level services (logging agents, monitoring daemons, CNI plugins)
- Ignores pod scheduling — automatically places on all nodes
- When a new node joins, daemon automatically starts there

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: fluentd
spec:
  selector:
    matchLabels:
      app: fluentd
  template:
    metadata:
      labels:
        app: fluentd
    spec:
      containers:
        - name: fluentd
          image: fluent/fluentd:latest
          volumeMounts:
            - name: varlog
              mountPath: /var/log
      volumes:
        - name: varlog
          hostPath:
            path: /var/log
```

**Jobs and CronJobs**
- Jobs run one or more pods to completion (batch work)
- CronJobs run Jobs on a schedule (like Unix cron)
- Useful for backups, reports, data processing

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: backup-database
spec:
  template:
    spec:
      containers:
        - name: backup
          image: postgres:14
          command: ["pg_dump", "-h", "postgres-service", "mydb", ">", "/backup/dump.sql"]
      restartPolicy: Never
  backoffLimit: 3
---
apiVersion: batch/v1
kind: CronJob
metadata:
  name: daily-backup
spec:
  schedule: "2 3 * * *"  # 3:02 AM UTC daily
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: backup
              image: postgres:14
          restartPolicy: Never
```

### 3.3 Custom Resources and Operators

**CustomResourceDefinition (CRD)**
- Extends Kubernetes API with custom object types
- Example: PostgreSQL database objects, Kafka topics, Elasticsearch clusters

```yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: databases.example.com
spec:
  group: example.com
  names:
    kind: Database
    plural: databases
  scope: Namespaced
  versions:
    - name: v1
      served: true
      storage: true
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              properties:
                dbType:
                  type: string
                  enum: [postgres, mysql]
                size:
                  type: string
                  enum: [small, medium, large]
```

**Operators**
- Controllers that manage custom resources
- Implement domain knowledge (how to deploy, upgrade, backup a database)
- Common operators: Prometheus Operator, PostgreSQL Operator, Redis Operator
- Example: PostgreSQL Operator watches `PostgreSQL` CRDs and automatically sets up replication, backups, failover

### 3.4 RBAC (Role-Based Access Control)

Controls who can do what in your cluster. Built on four objects:

**Role** — Defines permissions within a namespace

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
  namespace: default
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["pods/logs"]
    verbs: ["get"]
```

**RoleBinding** — Grants a Role to a user/group/service account

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: read-pods
  namespace: default
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: pod-reader
subjects:
  - kind: User
    name: alice@example.com
  - kind: ServiceAccount
    name: app-reader
    namespace: default
```

**ClusterRole & ClusterRoleBinding** — Cluster-wide scope (for resources like nodes, namespaces)

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: node-reader
rules:
  - apiGroups: [""]
    resources: ["nodes"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["persistentvolumes"]
    verbs: ["get", "list"]
```

**Service Accounts** — Identity for applications (pods)

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: app-reader
  namespace: default
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: app-read-pods
  namespace: default
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: pod-reader
subjects:
  - kind: ServiceAccount
    name: app-reader
    namespace: default
```

Pods automatically mount their service account token and can authenticate to the API:

```bash
kubectl exec -it <pod> -- sh
curl --cacert /var/run/secrets/kubernetes.io/serviceaccount/ca.crt \
  -H "Authorization: Bearer $(cat /var/run/secrets/kubernetes.io/serviceaccount/token)" \
  https://kubernetes.default.svc/api/v1/namespaces/default/pods
```

### 3.5 Network Policies

By default, all pods can communicate with all other pods. Network Policies enforce firewall-like rules:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-all-ingress
spec:
  podSelector: {}
  policyTypes:
    - Ingress
  ingress: []  # Empty = deny all ingress
```

Allow traffic only from a specific namespace:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend-to-backend
spec:
  podSelector:
    matchLabels:
      tier: backend
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: default
      ports:
        - port: 5432
          protocol: TCP
```

Restrict egress (outbound):

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-external-egress
spec:
  podSelector:
    matchLabels:
      app: web
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              name: default
    - ports:
        - port: 53
          protocol: UDP
    - ports:
        - port: 53
          protocol: TCP
```

---

## 4. Step-by-Step Instructions

### 4.1 Deploy a StatefulSet

```bash
# Create a StorageClass if not present (for dynamic volume provisioning)
kubectl get storageclasses

# Create a headless service for StatefulSet DNS
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Service
metadata:
  name: postgres
spec:
  clusterIP: None
  selector:
    app: postgres
  ports:
    - port: 5432
EOF

# Deploy the StatefulSet
cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
spec:
  serviceName: postgres
  replicas: 3
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
        - name: postgres
          image: postgres:14-alpine
          ports:
            - containerPort: 5432
          env:
            - name: POSTGRES_PASSWORD
              value: "password123"
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
              subPath: postgres
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 1Gi
EOF

# Verify
kubectl get statefulsets
kubectl get pods
kubectl get pvc

# Access pod 0
kubectl exec -it postgres-0 -- psql -U postgres -c "\l"

# Scale down (removes pod-2, pod-1 in order)
kubectl scale statefulset postgres --replicas=1

# Scale back up (adds pod-1, pod-2 in order)
kubectl scale statefulset postgres --replicas=3

# Delete StatefulSet but keep data
kubectl delete statefulset postgres --cascade=orphan

# Clean up
kubectl delete statefulset postgres pvc --all
kubectl delete service postgres
```

### 4.2 Implement RBAC

```bash
# 1. Create a namespace for the application
kubectl create namespace app-ns

# 2. Create a service account
kubectl apply -f - <<EOF
apiVersion: v1
kind: ServiceAccount
metadata:
  name: app-sa
  namespace: app-ns
EOF

# 3. Create a Role with specific permissions
kubectl apply -f - <<EOF
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
  namespace: app-ns
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/logs"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["get"]
EOF

# 4. Bind the Role to the ServiceAccount
kubectl apply -f - <<EOF
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: read-pods
  namespace: app-ns
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: pod-reader
subjects:
  - kind: ServiceAccount
    name: app-sa
    namespace: app-ns
EOF

# 5. Create a test pod using that service account
kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: app-pod
  namespace: app-ns
spec:
  serviceAccountName: app-sa
  containers:
    - name: app
      image: curlimages/curl
      command: ["sleep", "3600"]
EOF

# 6. Test permissions from inside the pod
kubectl exec -it app-pod -n app-ns -- sh

# Inside the pod, try to list pods (should work)
curl -s -H "Authorization: Bearer $(cat /var/run/secrets/kubernetes.io/serviceaccount/token)" \
  --cacert /var/run/secrets/kubernetes.io/serviceaccount/ca.crt \
  https://kubernetes.default.svc/api/v1/namespaces/app-ns/pods | head -20

# Try to get secrets (should be denied)
curl -s -H "Authorization: Bearer $(cat /var/run/secrets/kubernetes.io/serviceaccount/token)" \
  --cacert /var/run/secrets/kubernetes.io/serviceaccount/ca.crt \
  https://kubernetes.default.svc/api/v1/namespaces/app-ns/secrets

# exit
```

### 4.3 Apply Network Policies

```bash
# 1. Create test namespaces and deployments
kubectl create namespace frontend
kubectl create namespace backend

kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: frontend
spec:
  replicas: 1
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: nginx:alpine
          ports:
            - containerPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: web
  namespace: frontend
spec:
  selector:
    app: web
  ports:
    - port: 80
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: backend
spec:
  replicas: 1
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
    spec:
      containers:
        - name: api
          image: httpbin:latest
          ports:
            - containerPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: backend
spec:
  selector:
    app: api
  ports:
    - port: 80
EOF

# 2. Test connectivity (should work — no policies yet)
kubectl exec -it -n frontend deployment/web -- wget -O- http://api.backend.svc.cluster.local

# 3. Apply a deny-all policy to backend
kubectl apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-all
  namespace: backend
spec:
  podSelector: {}
  policyTypes:
    - Ingress
EOF

# 4. Test connectivity again (should fail)
kubectl exec -it -n frontend deployment/web -- timeout 5 wget -O- http://api.backend.svc.cluster.local || echo "Connection denied"

# 5. Allow traffic from frontend to backend
kubectl apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-from-frontend
  namespace: backend
spec:
  podSelector:
    matchLabels:
      app: api
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: frontend
      ports:
        - port: 80
EOF

# Label the frontend namespace
kubectl label namespace frontend name=frontend

# 6. Test connectivity again (should work)
kubectl exec -it -n frontend deployment/web -- wget -O- http://api.backend.svc.cluster.local | head -5

# Clean up
kubectl delete namespace frontend backend
```

### 4.4 Use Helm for Package Management

**Install Helm** (if not already):

```bash
brew install helm
```

**Add a chart repository:**

```bash
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update
```

**Search and install a chart:**

```bash
# Search for charts
helm search repo bitnami | grep redis

# Install a release
helm install my-redis bitnami/redis --set auth.password=mypassword

# See what was installed
helm list

# View the release history
helm history my-redis

# Get notes for connecting
helm get notes my-redis
```

**Customize values:**

```bash
# View default values
helm show values bitnami/redis

# Install with custom values
helm install my-redis bitnami/redis \
  --set architecture=standalone \
  --set auth.password=mypassword \
  --set replica.replicaCount=2

# Or use a values file
cat > custom-values.yaml <<EOF
architecture: standalone
auth:
  password: mypassword
replica:
  replicaCount: 2
EOF

helm install my-redis bitnami/redis -f custom-values.yaml
```

**Upgrade and rollback:**

```bash
# Upgrade to new values
helm upgrade my-redis bitnami/redis --set replica.replicaCount=3

# View history
helm history my-redis

# Rollback to previous version
helm rollback my-redis 1

# Clean up
helm uninstall my-redis
```

**Create your own chart:**

```bash
# Create a new chart scaffold
helm create my-app

# Edit templates and values
cd my-app
# Modify Chart.yaml, values.yaml, and templates/

# Validate the chart
helm lint my-app

# Dry-run to see what will be created
helm install test my-app --dry-run --debug

# Install locally
helm install my-release my-app

# Package for distribution
helm package my-app
```

### 4.5 Advanced Pod Scheduling

**Node Affinity** — Schedule pods on specific nodes:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: with-affinity
spec:
  affinity:
    nodeAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
          - matchExpressions:
              - key: disktype
                operator: In
                values:
                  - ssd
  containers:
    - name: app
      image: nginx:alpine
```

**Pod Affinity** — Schedule pods near or far from other pods:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: with-pod-affinity
spec:
  affinity:
    podAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        - labelSelector:
            matchExpressions:
              - key: app
                operator: In
                values:
                  - web
          topologyKey: kubernetes.io/hostname
  containers:
    - name: app
      image: nginx:alpine
```

**Taints and Tolerations** — Reserve nodes for specific workloads:

```bash
# Taint a node (e.g., for GPU workloads)
kubectl taint nodes gpu-node gpu=true:NoSchedule

# Pod tolerates the taint
kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: gpu-job
spec:
  tolerations:
    - key: gpu
      operator: Equal
      value: "true"
      effect: NoSchedule
  containers:
    - name: app
      image: tensorflow/tensorflow:latest-gpu
EOF

# Remove the taint
kubectl taint nodes gpu-node gpu=true:NoSchedule-
```

---

## 5. Practical Examples

### Example 1 — Multi-Tier Application with StatefulSet Backend

Deploy a complete application: web frontend, API backend, and PostgreSQL database.

```bash
# Create namespace
kubectl create namespace production

# Deploy PostgreSQL StatefulSet
kubectl apply -f - <<EOF
apiVersion: v1
kind: Service
metadata:
  name: postgres
  namespace: production
spec:
  clusterIP: None
  selector:
    app: postgres
  ports:
    - port: 5432
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
  namespace: production
spec:
  serviceName: postgres
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
        - name: postgres
          image: postgres:14-alpine
          env:
            - name: POSTGRES_DB
              value: appdb
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: db-secret
                  key: password
          ports:
            - containerPort: 5432
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 5Gi
---
apiVersion: v1
kind: Secret
metadata:
  name: db-secret
  namespace: production
type: Opaque
stringData:
  password: postgres123
EOF

# Deploy API backend
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
    spec:
      containers:
        - name: api
          image: myregistry/api:v1.0.0
          ports:
            - containerPort: 8080
          env:
            - name: DATABASE_URL
              value: postgres://postgres:postgres123@postgres:5432/appdb
            - name: LOG_LEVEL
              valueFrom:
                configMapKeyRef:
                  name: app-config
                  key: log_level
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
          livenessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /ready
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: production
spec:
  selector:
    app: api
  ports:
    - port: 80
      targetPort: 8080
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
  namespace: production
data:
  log_level: info
EOF

# Deploy web frontend
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: production
spec:
  replicas: 2
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: myregistry/web:v1.0.0
          ports:
            - containerPort: 3000
          env:
            - name: API_URL
              value: http://api/api
          resources:
            requests:
              cpu: 50m
              memory: 128Mi
            limits:
              cpu: 200m
              memory: 256Mi
---
apiVersion: v1
kind: Service
metadata:
  name: web
  namespace: production
spec:
  type: LoadBalancer
  selector:
    app: web
  ports:
    - port: 80
      targetPort: 3000
EOF

# Deploy Ingress for advanced routing
kubectl apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-ingress
  namespace: production
spec:
  ingressClassName: nginx
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: api
                port:
                  number: 80
    - host: app.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: web
                port:
                  number: 80
EOF

# Verify deployment
kubectl get all -n production
kubectl get statefulsets -n production
kubectl get ingress -n production

# Test database connectivity
kubectl exec -it postgres-0 -n production -- psql -U postgres -d appdb -c "SELECT now();"

# View logs
kubectl logs -n production -l app=api --tail=50
kubectl logs -n production -l app=web --tail=50

# Scale API backend
kubectl scale deployment api -n production --replicas=5

# Monitor with k9s (if installed)
k9s -n production
```

### Example 2 — Running Batch Jobs and CronJobs

```bash
# One-time job: database backup
kubectl apply -f - <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: backup-database
spec:
  template:
    spec:
      containers:
        - name: backup
          image: postgres:14-alpine
          command:
            - /bin/sh
            - -c
            - |
              pg_dump -h postgres.production.svc.cluster.local \
                -U postgres \
                -d appdb > /backup/dump-$(date +%s).sql && \
              echo "Backup complete" && \
              ls -la /backup/
          volumeMounts:
            - name: backup-storage
              mountPath: /backup
      volumes:
        - name: backup-storage
          persistentVolumeClaim:
            claimName: backup-pvc
      restartPolicy: Never
  backoffLimit: 3
  completions: 1
  parallelism: 1
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: backup-pvc
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
EOF

# Monitor the job
kubectl get job backup-database -w
kubectl logs -l job-name=backup-database

# Scheduled job: daily reports at 2 AM UTC
kubectl apply -f - <<EOF
apiVersion: batch/v1
kind: CronJob
metadata:
  name: daily-report
spec:
  schedule: "0 2 * * *"
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 1
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: report
              image: python:3.9
              command:
                - /bin/bash
                - -c
                - |
                  python /scripts/generate-report.py && \
                  echo "Report generated at $(date)"
              volumeMounts:
                - name: scripts
                  mountPath: /scripts
          volumes:
            - name: scripts
              configMap:
                name: report-scripts
          restartPolicy: OnFailure
EOF

# View cron job schedule
kubectl get cronjob daily-report
kubectl describe cronjob daily-report

# Manually trigger a cron job
kubectl create job --from=cronjob/daily-report manual-trigger-$(date +%s)

# View job history
kubectl get jobs -l cronjob-name=daily-report

# Clean up completed jobs
kubectl delete job backup-database
```

### Example 3 — Production Monitoring with Prometheus

```bash
# Add Prometheus Helm chart
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

# Install Prometheus stack
helm install monitoring prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --create-namespace \
  --set prometheus.prometheusSpec.retention=30d \
  --set grafana.adminPassword=admin123

# Verify installation
kubectl get pods -n monitoring
kubectl get svc -n monitoring

# Access Prometheus
kubectl port-forward -n monitoring svc/prometheus-operated 9090:9090 &
# Open http://localhost:9090

# Access Grafana
kubectl port-forward -n monitoring svc/monitoring-grafana 3000:80 &
# Open http://localhost:3000 (user: admin, password: admin123)

# Create a custom PrometheusRule for alerting
kubectl apply -f - <<EOF
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: custom-alerts
  namespace: monitoring
spec:
  groups:
    - name: custom.rules
      interval: 30s
      rules:
        - alert: HighPodMemoryUsage
          expr: |
            (sum(container_memory_usage_bytes) by (pod, namespace) / 
             sum(container_spec_memory_limit_bytes) by (pod, namespace)) > 0.9
          for: 5m
          annotations:
            summary: "Pod {{ $labels.pod }} has high memory usage"
            description: "Memory usage is {{ $value | humanizePercentage }} in {{ $labels.namespace }}"
EOF

# Query metrics in Prometheus
# Example queries:
#   up{job="kubernetes-apiservers"}
#   rate(http_requests_total[5m])
#   container_memory_usage_bytes{pod="my-pod"}
```

---

## 6. Production Deployment Patterns

### Blue-Green Deployments

Deploy new version alongside old, then switch traffic instantly:

```bash
# Deploy blue version
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app-blue
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
      version: blue
  template:
    metadata:
      labels:
        app: myapp
        version: blue
    spec:
      containers:
        - name: app
          image: myapp:v1.0.0
---
apiVersion: v1
kind: Service
metadata:
  name: myapp
spec:
  selector:
    app: myapp
    version: blue
  ports:
    - port: 80
      targetPort: 8080
EOF

# Deploy green version (in parallel)
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app-green
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
      version: green
  template:
    metadata:
      labels:
        app: myapp
        version: green
    spec:
      containers:
        - name: app
          image: myapp:v2.0.0
EOF

# Test green version from internal pod
kubectl run test-pod --image=curlimages/curl -it --rm -- \
  curl http://app-green-svc/health

# Switch traffic to green
kubectl patch service myapp -p '{"spec":{"selector":{"version":"green"}}}'

# Monitor
kubectl get pods -l app=myapp -o wide

# Rollback to blue if needed
kubectl patch service myapp -p '{"spec":{"selector":{"version":"blue"}}}'

# Delete old blue version
kubectl delete deployment app-blue
```

### Canary Deployments

Gradually shift traffic to new version:

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: myapp
spec:
  hosts:
    - myapp
  http:
    - match:
        - uri:
            prefix: /
      route:
        - destination:
            host: myapp-v1
          weight: 90
        - destination:
            host: myapp-v2
          weight: 10
```

Gradually increase weight to v2 as metrics look good, until 100% traffic flows to v2.

### GitOps with ArgoCD

Declare desired state in Git, ArgoCD keeps cluster in sync:

```bash
# Install ArgoCD
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# Create Application pointing to Git repo
kubectl apply -f - <<EOF
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/myorg/my-app-config
    targetRevision: main
    path: k8s/
  destination:
    server: https://kubernetes.default.svc
    namespace: production
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
EOF

# ArgoCD automatically syncs Git changes to cluster
# Get ArgoCD password
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d

# Port forward to UI
kubectl port-forward -n argocd svc/argocd-server 8080:443
```

---

## 7. Troubleshooting at Scale

### Cluster Health Checks

```bash
# Check control plane
kubectl get nodes
kubectl get cs  # component status (deprecated in newer versions)
kubectl top nodes  # resource usage

# Check API server connectivity
kubectl cluster-info
kubectl api-resources

# Etcd health (if you have access to control plane)
kubectl -n kube-system get pods -l component=etcd
kubectl -n kube-system logs -l component=etcd

# Check DNS
kubectl run test-dns --image=busybox --rm -it -- nslookup kubernetes.default

# Verify scheduler
kubectl -n kube-system get pods -l component=kube-scheduler
kubectl -n kube-system logs -l component=kube-scheduler
```

### Pod Debugging

```bash
# Comprehensive pod info
kubectl get pod <name> -o yaml
kubectl describe pod <name>

# Check events for failures
kubectl get events --sort-by='.lastTimestamp' | tail -10

# Logs from current container
kubectl logs <pod> -c <container>

# Logs from previous crash
kubectl logs <pod> --previous

# Follow logs live
kubectl logs <pod> -f

# Debug with ephemeral container (K8s 1.23+)
kubectl debug <pod> -it --image=busybox

# Copy files for forensics
kubectl cp <pod>:/path/to/file ./local-file
kubectl cp ./local-file <pod>:/path/to/file
```

### Resource Constraints

```bash
# Check resource usage
kubectl top nodes
kubectl top pods

# Check resource requests/limits
kubectl describe nodes

# Identify pods using most resources
kubectl get pods --all-namespaces -o json | \
  jq '[.items[] | {namespace: .metadata.namespace, pod: .metadata.name, cpu: .spec.containers[].resources.limits.cpu, memory: .spec.containers[].resources.limits.memory}]'

# Scale down to free resources
kubectl scale deployment <name> --replicas=0

# Increase node resources (cloud-specific)
# For GKE: gcloud container node-pools create/update
# For EKS: AWS Auto Scaling groups
# For AKS: az aks nodepool scale
```

### Persistent Volume Issues

```bash
# Check PVC status
kubectl get pvc
kubectl describe pvc <name>

# Check PV status
kubectl get pv
kubectl describe pv <name>

# Force delete stuck PVC
kubectl patch pvc <name> -p '{"metadata":{"finalizers":null}}'

# Reclaim policy: Retain (manual), Delete (auto), Recycle (deprecated)
kubectl patch pv <name> -p '{"spec":{"persistentVolumeReclaimPolicy":"Delete"}}'

# Snapshot for disaster recovery
kubectl apply -f - <<EOF
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata:
  name: mydata-snapshot
spec:
  volumeSnapshotClassName: csi-hostpath-snapclass
  source:
    persistentVolumeClaimName: mydata
EOF
```

---

## 8. References

- **Kubernetes Official Docs:** [kubernetes.io/docs](https://kubernetes.io/docs/)
- **API Reference:** [kubernetes.io/docs/reference/](https://kubernetes.io/docs/reference/)
- **Helm Documentation:** [helm.sh/docs](https://helm.sh/docs/)
- **Prometheus Operator:** [github.com/prometheus-operator/prometheus-operator](https://github.com/prometheus-operator/prometheus-operator)
- **Istio (Service Mesh):** [istio.io](https://istio.io/)
- **ArgoCD (GitOps):** [argoproj.github.io/argo-cd/](https://argoproj.github.io/argo-cd/)
- **Kubernetes Security Best Practices:** [kubernetes.io/docs/concepts/security/](https://kubernetes.io/docs/concepts/security/)
- **kube-bench (CIS Benchmarks):** [github.com/aquasecurity/kube-bench](https://github.com/aquasecurity/kube-bench)
- **Falco (Runtime Security):** [falco.org](https://falco.org/)

---

## 9. Summary

**Key takeaways:**

- **StatefulSets** manage stateful applications with persistent identities and ordered deployments
- **DaemonSets** ensure critical services run on every node
- **Jobs and CronJobs** handle batch and scheduled workloads
- **Custom Resource Definitions (CRDs)** and **Operators** extend Kubernetes for domain-specific workflows
- **RBAC** controls access through Roles, RoleBindings, and ServiceAccounts
- **Network Policies** enforce firewall rules between pods
- **Helm** simplifies package management and templating for complex deployments
- **Taints, tolerations, and affinity rules** provide fine-grained pod scheduling
- **Advanced deployment patterns** (blue-green, canary, GitOps) minimize downtime and risk
- **Monitoring with Prometheus and Grafana** gives visibility into cluster health and application metrics
- **Proper RBAC, network policies, and security scanning** are essential for production systems

**Next steps:**

- Deploy a production-grade multi-tier application with RBAC, network policies, and monitoring
- Set up GitOps with ArgoCD for continuous deployment from Git
- Explore service meshes (Istio) for advanced traffic management
- Implement security scanning with kube-bench, Falco, and vulnerability scanning
- Practice disaster recovery scenarios and backup/restore procedures
- Study cloud-provider-specific features (GKE Config Connector, EKS IRSA, etc.)

See also: [[kubernetes-beginner-guide|Kubernetes Beginner's Guide]] for fundamentals.

---

## Related Tutorials

- [[linux-permissions-beginner-guide|Linux Permissions]]
- [[apache-nifi-beginner-guide|Apache NiFi]]

---

*Updated 2026-04-10 for Kubernetes v1.35+, Helm v3.x, and modern production patterns.*
# Related Tutorials

- [[just-deep-dive|Just Deep Dive]] — Advanced just patterns for Kubernetes cluster management and deployment automation
- [[just-vs-make|Just vs GNU Make]] — Comparing task runners for infrastructure workflows

- [[cgroups-beginner-guide|Cgroups Beginner Guide]] — The Linux kernel mechanism behind Kubernetes resource limits
- [[cgroups-deep-dive|Cgroups Deep Dive]] — Advanced cgroups internals and container runtime integration

- [[headscale-beginner-guide|Headscale Beginner Guide]] — self-hosted WireGuard mesh VPN for connecting Kubernetes nodes across clouds
- [[headscale-deep-dive|Headscale Deep Dive]] — overlay networking with Headscale for multi-cloud Kubernetes clusters
