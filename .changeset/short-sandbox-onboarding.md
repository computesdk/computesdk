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

Add read-only status diagnostics, resumable device login with explicit JSON and
wait modes, root-level kill/wait, and run completion summaries with confirmed
cleanup and settled cost when available. Machine-readable runs emit JSON Lines.

Support provider-first project creation (`compute new e2b .`) and one-way sync
between local directories and sandboxes, including sandbox relays, gitignore
filtering, incremental copies, dry runs, explicit deletion, and polling watch mode.

Reuse the pinned platform OCI checkpoint engine for sync scanning, diffing,
capture and integrity-checked restore, with selected-layer transfers and guarded
destination updates instead of a separate snapshot implementation.

Retain full sync captures in platform-managed storage for 30 days before applying
destination changes, and report snapshot IDs and expiry while cleaning only
filesystem staging. Storage billing is unchanged.
