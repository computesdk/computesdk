# @computesdk/givemeanode

## 1.0.2

### Patch Changes

- 88e078e: Surface the API's error message instead of `[object Object]`.

  The door answers a refusal with `{"error": {"code", "message"}}`, but the
  client ran `String()` over that object, so every non-2xx response arrived
  with its explanation discarded. Since the check sits in the shared request
  path, this affected every operation: create, exec, fork, snapshot and
  prepare-image.

## 1.0.1

### Patch Changes

- d0d29df: Add givemeanode provider
- d0d29df: givemeanode: map `vcpus`/`cpus`/`resources.vcpus` onto named instance types, surface the door's 1 MiB stdout truncation on stderr, fall back to the service token when a signed credential is refused early, keep the request deadline over the response body, refuse a plaintext `baseUrl`, and treat `memory` as decimal MB.
