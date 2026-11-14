---
"@computesdk/cli": patch
---

Expose everyday sandbox commands directly under compute, guide users with shorter
first-workload examples, and open browser-assisted device login for interactive
creation with an empty credential store before continuing the requested command.
Keep existing command paths, version shorthand and noninteractive auth behavior.

Match the familiar exec command pattern: interpret a single argument as a remote
shell command, preserve multi-argument quoting, and support --detach, --stream,
and --timeout in seconds while keeping spawn and --timeout-ms compatible.
