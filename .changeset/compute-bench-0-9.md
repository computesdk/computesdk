---
'@computesdk/cli': minor
---

`compute bench` forwards `COMPUTE_PLATFORM_URL`, `COMPUTE_API_KEY` and `COMPUTE_ORG` (or a leading `compute --org <slug> bench …`) to bench as `BENCHMARKS_PLATFORM_URL`, `BENCHMARKS_PLATFORM_API_KEY` and `--org`, without overriding bench's own settings, and a refused connection names the URL it tried. `compute whoami` and `compute org current` read `COMPUTE_API_KEY`; with an org API key they print the key's organization and no user instead of "No credentials found".
