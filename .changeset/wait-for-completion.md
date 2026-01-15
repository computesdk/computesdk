---
"computesdk": minor
---

Add waitForCompletion support for overlay and background commands

- `overlay.create({ waitForCompletion: true })` - blocks until background copy is done
- `overlay.waitForCompletion(id)` - wait for an existing overlay's copy to complete
- `run.command('cmd', { background: true, waitForCompletion: true })` - wait for background command
- `run.waitForCompletion(terminalId, cmdId)` - wait for background command manually
- Background command results now include `cmdId` and `terminalId` for manual tracking
