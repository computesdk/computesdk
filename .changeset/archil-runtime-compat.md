---
"@computesdk/archil": patch
---

Improve Archil provider runtime compatibility in integration environments.

- Ensure `runCommand` sets a default `HOME` value when not present in exec environments.
- Make `runCode` throw on syntax errors for Node/Python to match provider test-suite expectations.
