# CLI maintenance

## Sync checkpoint engine

The CLI bundles a copy of the platform checkpoint module. `packages/cli/checkpoint-provenance.json` records its upstream commit and digest. Refresh it from the repository root with:

```bash
node scripts/sync-checkpoint-engine.mjs /path/to/benchmarks-platform <revision>
pnpm --filter @computesdk/cli test
```

Do not edit the bundled engine directly. The adapter owns sync filtering and destination guards. Deploy the managed sync snapshot API before releasing a CLI that requires retention. User-visible retention must use the platform's returned snapshot ID and expiry; see [project sync](../cli/project-sync.md).

## Command reference

After changing commands or flags, run `pnpm --filter @computesdk/cli run manifest` and verify the committed manifest against the built CLI. Benchmark passthrough commands depend on the separately published benchmark packages.

## Documentation source

Product docs live in `docs/` in this repository. The root `gitbook-docs.yaml` points GitBook at that directory, and `docs/SUMMARY.md` defines navigation. GitBook derives published paths from navigation groups, so preserving a file path alone does not preserve its URL. `docs/.gitbook.yaml` maps legacy entry URLs to the current source pages. Update those redirects when splitting or moving guides, and verify the rendered preview links. A separate `computesdk-docs` mirror has its own navigation and sync history: confirm the active publishing connection before syncing or replacing its layout. Its sync script excludes the root README, so syncing files alone does not publish a new introduction.
