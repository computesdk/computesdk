---
"@computesdk/provider": patch
"@computesdk/modal": patch
"@computesdk/isorun": patch
"@computesdk/sandbox0": patch
"@computesdk/microsandbox": patch
"@computesdk/createos-sandbox": patch
---

Validate file-backed command output and child exit status before returning a completed command result.

Missing or malformed byte-count metadata, persistent output-length mismatches, and missing or malformed child exit status now reject with an explicit command-output integrity error rather than trusting partial output or the wrapper's exit code. Valid empty output and completed commands with nonzero child exit codes remain supported.

Byte counts establish length completeness, not content hashes or arbitrary binary preservation. This change does not add remote cancellation guarantees.
