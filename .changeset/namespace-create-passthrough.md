---
"@computesdk/namespace": patch
---

`create()` accepts `containerOptions` and `instanceOptions`, raw Namespace API fields merged into the ContainerRequest and CreateInstanceRequest (e.g. `containerOptions: { nsc_state_path: '/var/run/nsc' }` to inject the workload token). Provider-set fields take precedence.
