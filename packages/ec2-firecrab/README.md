# @computesdk/ec2-firecrab

[Firecracker](https://firecracker-microvm.github.io) microVMs on self-hosted AWS EC2 as a ComputeSDK sandbox provider, driven by a [firecrab](https://github.com/SteelCrab/firecrab) host. Each sandbox is a Firecracker microVM built from an OCI image, carved out of a shared EC2 hypervisor host.

## Installation

```bash
npm install @computesdk/ec2-firecrab
```

## Prerequisites

- An EC2 host on a nested-virtualization-capable Intel type (`m8i`/`c8i`/`r8i`, `m7i`/`c7i`/`r7i`, `i7i`, or any `.metal`) launched with `CpuOptions.NestedVirtualization=enabled`
- [firecrab](https://github.com/SteelCrab/firecrab) installed on the host (`firecrab-api` on `127.0.0.1:5523`)
- A MicroNetwork created on the host (`POST /api/micro-networks`) — its CIDR must not overlap the VPC's
- At least one OCI image imported (`firecrab image import <ref>`)
- A path to the loopback API: SSH/SSM port-forward, or run the adapter on the host

## Configuration

```ts
import { ec2Firecrab } from '@computesdk/ec2-firecrab';

const provider = ec2Firecrab({
  apiUrl: 'http://127.0.0.1:5523',           // or EC2_FIRECRAB_API_URL
  microNetworkId: '<micro-network-uuid>',    // or EC2_FIRECRAB_MICRO_NETWORK_ID
  template: 'catthehacker-ubuntu-act-latest',// or EC2_FIRECRAB_TEMPLATE
  cpus: 2,
  memoryMib: 4096,
  diskGb: 16,
  egressPolicy: 'internet',                  // or 'isolated'
  sshUser: 'root',                           // or EC2_FIRECRAB_SSH_USER
  // Required when the caller is NOT on the host — the guest bridge IP is
  // host-local, so exec rides a jumphost:
  sshProxyCommand: 'ssh -W %h:%p ubuntu@<host-public-ip>', // or EC2_FIRECRAB_SSH_PROXY_COMMAND
});
```

## Usage

```ts
const sandbox = await provider.instances.create();
const result = await sandbox.runCommand('echo hello from the microVM');
console.log(result.stdout);
await provider.instances.destroy(sandbox.instanceId);
```

## Supported runtimes and features

- Any OCI image works as the guest rootfs — firecrab converts it to ext4 and pairs a kernel. `docker run` images like `node:22`, `alpine`, or `catthehacker/ubuntu:act-latest` boot directly.
- ~50ms Firecracker boot; ~19s cold create→running dominated by rootfs materialization (verified 2026-10-23 on `m8i.xlarge`).

## Limitations

- **Exec is SSH** — `runCommand` uses the per-VM managed SSH key (`GET /api/vms/{id}/ssh-key`) and the guest's sshd. Off-host callers must set `sshProxyCommand` since guest bridge IPs are only routable from the host. A `computesdk-runtime` guest agent is planned to replace this with the standard HTTP exec/fs surface.
- **No filesystem block yet** — file ops fall back to "not supported"; they run over SSH today and land formally with runtime injection.
- **No `getUrl`/preview URLs** — guest port publishing is not wired yet.
- **No snapshots, pause/resume, or `background` mode** — current firecrab builds don't expose these endpoints.
- **`destroy` is slow (~30s)** — `stop` is a graceful ACPI shutdown with no force flag; `DELETE` on a running VM returns `409`.
- **firecrab's API is unauthenticated loopback by design** — you own the transport (SSM/SSH tunnel).
