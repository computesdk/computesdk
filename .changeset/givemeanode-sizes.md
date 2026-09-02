---
"@computesdk/givemeanode": patch
---

givemeanode: map `vcpus`/`cpus`/`resources.vcpus` onto named instance types, surface the door's 1 MiB stdout truncation on stderr, fall back to the service token when a signed credential is refused early, keep the request deadline over the response body, refuse a plaintext `baseUrl`, and treat `memory` as decimal MB.
