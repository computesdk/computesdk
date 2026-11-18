---
"@computesdk/uno": patch
---

Pause and resume, snapshots, and faster files. `instance.pause()`/`resume()` map to Uno's sleep and wake (memory and processes survive). Snapshots: `snapshot.create` copies the machine's disk into a sleeping snapshot machine, `instances.create({ snapshotId })` boots new machines from it (one snapshot serves many), `snapshot.list`/`delete` manage them; disk only, no memory. Files: `readFile`/`writeFile` use Uno's file API in one request where the API offers it, and otherwise need one shell command for a small file instead of two to three; `readdir` is one command. Concurrent commands on one machine are queued in the client instead of retried with backoff on `BOX_BUSY`.
