---
"@computesdk/gravixlayer": patch
---

Send the create lease as `timeout` and the HTTP budget as `requestTimeoutMs`.
In the new SDK, `timeout` is the product duration in seconds on every call —
matching what ComputeSDK's own millisecond `timeout` always meant — and
`timeoutSeconds` was removed. The 180s boot budget moves to
`requestTimeoutMs`, the per-call HTTP deadline, so it can no longer be
mistaken for a lifetime. Floors the SDK at ^0.1.36.
