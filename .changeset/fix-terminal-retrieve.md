---
"computesdk": patch
---

Fix `sandbox.terminal.retrieve(id)` to return a writable `TerminalInstance` instead of a static `TerminalResponse`.
