# @computesdk/ec2-firecrab

## 1.0.2

### Patch Changes

- 91b5ee8: Fall back to the 120s default when `bootTimeoutMs` is non-finite or non-positive — an unbounded deadline would strand the allocated microVM.
- 168a8c5: Add `bootTimeoutMs` config for the create→running wait (default 120s) so bursts on small hosts aren't truncated by the hardcoded boot deadline.

## 1.0.1

### Patch Changes

- 90381f3: Add EC2 Firecrab provider — Firecracker microVMs on self-hosted EC2 via a firecrab host
