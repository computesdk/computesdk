# @computesdk/uno

## 0.1.13

### Patch Changes

- Updated dependencies [b9a5708]
  - computesdk@4.1.25
  - @computesdk/provider@2.1.31

## 0.1.12

### Patch Changes

- Updated dependencies [05ed179]
  - computesdk@4.1.24
  - @computesdk/provider@2.1.30

## 0.1.11

### Patch Changes

- 0f42396: Refresh package descriptions and READMEs with current ComputeSDK branding, provider links, and setup instructions.
- Updated dependencies [0f42396]
  - computesdk@4.1.23
  - @computesdk/provider@2.1.29

## 0.1.10

### Patch Changes

- 6deb534: Uno: `create({ sizeClass })` maps every standard size (`xs`–`3xl`) to its exact vCPU/RAM, with the platform's 10/20/40/80 GiB disk on `sm`–`xl`; refuses native CPU/RAM/disk fields and `snapshotId` alongside it.
- Updated dependencies [eaec2cd]
  - computesdk@4.1.22
  - @computesdk/provider@2.1.28

## 0.1.9

### Patch Changes

- Updated dependencies [ce6d638]
  - computesdk@4.1.21
  - @computesdk/provider@2.1.27

## 0.1.8

### Patch Changes

- 28746d3: Faster pause, snapshots and restores. `instance.pause()` now pauses the machine in memory, so `resume()` takes milliseconds instead of a wake from disk; after `pauseInMemoryS` seconds (default 300, `0` to sleep on disk at once) the machine goes to sleep on disk on its own. `snapshot.create` copies the disk without booting the copy where the Uno API offers it, so a snapshot costs a flush and a copy-on-write copy. Waiting for a new instance asks the API to answer as soon as the machine is ready instead of polling. Older Uno APIs keep the previous behaviour.
- 26e5252: Create a sandbox in one request: `create` asks the API to hold its answer until the machine is ready (`wait_ready_s`, up to 30 s within `readyTimeoutMs`) and no longer polls when it is. If create comes back still starting (an older API, or a wait cut short), readiness is polled as before, now every 100 ms for the first 10 s, then once a second, instead of backing off 250 ms → 2 s; the interval counts from the start of each request, so the round trip no longer adds to the wait.
- 28746d3: Pause and resume, snapshots, and faster files. `instance.pause()`/`resume()` map to Uno's sleep and wake (memory and processes survive). Snapshots: `snapshot.create` copies the machine's disk into a sleeping snapshot machine, `instances.create({ snapshotId })` boots new machines from it (one snapshot serves many), `snapshot.list`/`delete` manage them; disk only, no memory. Files: `readFile`/`writeFile` use Uno's file API in one request where the API offers it, and otherwise need one shell command for a small file instead of two to three; `readdir` is one command. Concurrent commands on one machine are queued in the client instead of retried with backoff on `BOX_BUSY`.
- 26e5252: Retry `destroy` when the delete is lost on the way: a dropped connection, a timeout, 429 or a 5xx from the edge is tried again up to four times over about 3 s (each attempt capped at 15 s). Before, one lost DELETE left the machine running and failed the caller's cleanup. DELETE is idempotent, and a repeat of a delete that did land answers 404, which counts as done.
- 26e5252: Repeat a box read (`getBox`, readiness polling) lost on the way — dropped connection, timeout, 429 or 5xx — up to 4 times over ~3 s, so one dropped poll right after create no longer fails the create and deletes a healthy machine.
- 26e5252: Keep a sandbox's API calls on one connection: each request now waits one timer tick so the previous response's socket is back in the pool. Without it, Node's `fetch` opened a second connection for a call made right after the previous one, which could reach the API through a different edge server with a cold link to the origin (about +0.2 s).
- Updated dependencies [b979719]
  - computesdk@4.1.20
  - @computesdk/provider@2.1.26

## 0.1.7

### Patch Changes

- Updated dependencies [1fc7e73]
  - computesdk@4.1.19
  - @computesdk/provider@2.1.25

## 0.1.6

### Patch Changes

- computesdk@4.1.18
- @computesdk/provider@2.1.24

## 0.1.5

### Patch Changes

- Updated dependencies [8e11040]
  - @computesdk/provider@2.1.23
  - computesdk@4.1.17

## 0.1.4

### Patch Changes

- Updated dependencies [1904e82]
- Updated dependencies [1904e82]
- Updated dependencies [1904e82]
- Updated dependencies [1904e82]
- Updated dependencies [1904e82]
- Updated dependencies [4924af5]
  - @computesdk/provider@2.1.22
  - computesdk@4.1.16

## 0.1.3

### Patch Changes

- Updated dependencies [24803d6]
  - computesdk@4.1.15
  - @computesdk/provider@2.1.21

## 0.1.2

### Patch Changes

- Updated dependencies [2bd2e7d]
- Updated dependencies [0a54571]
  - @computesdk/provider@2.1.20
  - computesdk@4.1.14

## 0.1.1

### Patch Changes

- 255ad75: Add Uno provider
