---
"@computesdk/cli": patch
---

feat(cli): `compute actions providers` gains `configure`, `verify`, `remove`

`configure <provider>` saves the org's provider credential via
`PUT /api/v1/actions/providers/{provider}/key` (`--key` or `--field
name=value`), `--verify` runs the placement probe,
`verify <provider>` re-runs it, and `remove <provider>` deletes the stored
key. Requires an owner/admin-level org API key.
