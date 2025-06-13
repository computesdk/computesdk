# ComputeSDK Kubernetes Cluster Architecture

ComputeSDK's backend relies on several key Kubernetes services and workloads, organized into distinct namespaces for enhanced security and manageability. All manifests, etc live in `/deployments`. There are older manifests for the node application (that we are rewriting) that live in `/k8s`, but we only reference those for now. I severely overcomplciated them by trying to deploy to multiple clouds.

*   **Core Services Namespace:** `computesdk-system`
*   **User Workloads Namespace:** `computesdk-workloads`

---

*   **Gateway (`compute-gateway`)**
    *   **Namespace:** `computesdk-system`
    *   **Type:** Kubernetes Service (e.g., LoadBalancer or via Ingress Controller like AWS ALB).
    *   **Role:** 
        *   Single entry point for all external traffic.
        *   Handles authentication, authorization, and routing.
        *   Manages WebSocket connections for compute pods.
        *   Proxies requests to the API service and manages access to Compute Pods.
    *   **Exposes:** The main API and secure access to individual Compute Pods.

*   **API Service**
    *   **Namespace:** `computesdk-system`
    *   **Type:** Kubernetes Service (typically `ClusterIP`).
    *   **Role:** 
        *   Provides the core business logic and data management for ComputeSDK.
        *   Accessed internally, primarily through the Gateway.
    *   **Instances:** Runs as a Kubernetes Deployment with multiple replicas for scalability.

*   **Compute Pod Runtime Environment** 
    *   **Namespace (for Pods):** `computesdk-workloads`
    *   **Type:** Runs within each dynamically created Compute Pod (not a standalone K8s Service).
    *   **Role:** 
        *   The execution environment for user code, running within a gVisor-isolated container per pod.
        *   Includes the runtime agent that communicates with the Gateway (e.g., for terminal I/O, file system operations, port forwarding via WebSockets).
    *   **Access:** Lifecycle and communication are managed by the Gateway; not directly exposed with its own K8s service.

*   **MySQL**
    *   **Namespace:** `computesdk-system`
    *   **Type:** Kubernetes Service (`ClusterIP`) fronting a Deployment (using `mysql:latest` image for local dev).
    *   **Role:** Relational database for persistent application data (e.g., user accounts, filesystem metadata).
    *   **Storage:** Utilizes Kubernetes PersistentVolumeClaims (PVCs) for data persistence, backed by OrbStack's local storage provider.

*   **Redis**
    *   **Namespace:** `computesdk-system`
    *   **Type:** Kubernetes Service (`ClusterIP`) fronting a Deployment (using `redis:alpine` image for local dev).
    *   **Role:** Caching, session management, and potentially as a message broker for real-time updates.
    *   **Storage:** Utilizes Kubernetes PersistentVolumeClaims (PVCs) for data persistence (AOF enabled by default with the image used).

*   **Object Storage (SeaweedFS - Local Development)**
    *   **Namespace:** `computesdk-system`
    *   **Type:** Kubernetes Services (`ClusterIP`) fronting Deployments for Master, Volume, and Filer components.
    *   **Role:** Provides S3-compatible object storage for user file uploads, application assets, etc., within the local development environment.
    *   **Storage:** Utilizes Kubernetes PersistentVolumeClaims (PVCs) for Master metadata, Volume server data, and Filer metadata.
    *   **Configuration:** Filer exposes S3 API on port `8333` and Filer API on port `8888`. S3 credentials managed via a ConfigMap (`seaweedfs-s3-config`).


---

## Node Strategy

ComputeSDK utilizes a hybrid node strategy within the EKS cluster:

*   **User Workloads (`computesdk-workloads` namespace):**
    *   **Type:** AWS Fargate.
    *   **Architecture:** Consider using ARM64 (AWS Graviton) based tasks for better price-performance. Requires ARM-compatible container images.
    *   **Rationale:** Serverless compute for dynamic, isolated user code execution environments, simplifying management and scaling for spiky workloads.

*   **Core System Services (`computesdk-system` namespace):**
    *   **Type:** EKS Managed Node Group with EC2 instances.
    *   **Architecture:** Consider using ARM64 (AWS Graviton) based EC2 instances (e.g., `m6g`, `r6g` series) for better price-performance. Requires ARM-compatible software for system services.
    *   **Instance Families (Examples for x86):**
        *   General Purpose (e.g., AWS `m6i` series) for Gateway and API services.
        *   Memory/IO Optimized (e.g., AWS `r6i` series with `io2` EBS) if running stateful services like MySQL or persistent Redis directly on nodes.
    *   **Rationale:** Provides control, cost-effectiveness for stable long-running services (especially with Savings Plans/RIs), and optimized performance for stateful applications. Nodes will be configured for auto-scaling and spread across multiple Availability Zones.