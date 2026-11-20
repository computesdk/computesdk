"@computesdk/namespace": patch
---

Add `pause()`/`resume()` to the sandbox via ComputeService `SuspendInstance`/`WakeInstance`. Suspend snapshots RAM and disks and wakes the same instance id, so `pauseCapabilities` reports `memory: true`. Previously there was no native pause surface, so providers probing for pause fell back to the destroy-source volume snapshot.
