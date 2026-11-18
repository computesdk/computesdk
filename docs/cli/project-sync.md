# Project sync

Copy a local project into a sandbox, download results, or copy directories between sandboxes. Complete the [CLI quickstart](../getting-started/quick-start.md) first.

## Create with a project

```bash
compute new e2b .                         # provider first, local project last
compute new daytona ./my-app
compute new .                             # use your router
compute exec --cwd /app npm test
compute sync . :/app                      # update the selected sandbox
compute sync :/app ./results              # download directory contents
compute sync <sandbox-a>:/app <sandbox-b>:/app
compute sync . :/app --dry-run
compute sync . :/app --delete
compute sync . :/app --watch
```

`new` accepts an optional final local directory using explicit path syntax
(`.`, `./project`, `../project`, or an absolute path); bare operands remain
provider names. It validates the source before provisioning, syncs contents to
`/app`, then selects the sandbox. `--no-use` preserves the existing selection.
If initial sync fails, teardown is attempted and the old selection is retained;
a cleanup failure includes the sandbox ID for manual teardown.

`sync <source> <destination>` operates on directory contents, in one direction.
An endpoint is local, `<sandbox-uuid>:/absolute/path`, or `:/absolute/path` for
the selected sandbox. At least one endpoint must be remote. Both sandboxes
use the invocation's credentials, organization, and platform URL.

Content hashes and permissions identify changed files. Local uploads honor
nested `.gitignore` files and repository ancestor rules. `.git` is excluded;
`--delete` removes destination-only entries while preserving ignored paths.
Binary files, executable permissions, and project-contained relative symlinks
are preserved. Filesystem roots, overlapping endpoints on the same sandbox,
symlink traversal, and file/directory type conflicts are refused. Source hardlinks are copied as separate files; overwriting hard-linked destination files is refused.

`--dry-run` returns a plan without changing destination files. `--watch` polls
every two seconds, serializes passes, and finishes the active pass before
stopping on Ctrl-C; `--dry-run --watch` is invalid. `--json` returns `dryRun`,
`copied`, and `deleted` (relative path arrays); watch mode emits JSON Lines for
passes with changes. Errors use the standard stderr JSON envelope.

Node.js is required in each sandbox. Deletions happen after files are copied
successfully. A sync does not update the entire directory at once, so avoid
editing destination files while it runs. The sandbox working directory is
unchanged: use `exec --cwd /app` for the synced project. Watch mode is one-way;
it does not merge conflicting edits. Literal `*` and `?` characters in endpoint
paths are unsupported.

## Sync snapshots

Before copying files, ComputeSDK saves a snapshot of the source directory,
excluding ignored files. If the snapshot cannot be saved, sync stops before
changing destination files. The snapshot remains available until its reported
expiry, even if copying fails.

The CLI prints the snapshot ID and expiry. With `--json`, `compute sync` returns
these as `snapshot: { id, expiresAt }`; `compute new` with a project directory
returns them as `syncSnapshot`. Dry runs, unchanged syncs and syncs that only
delete files do not create a snapshot.

After running your project, use `compute destroy` to release compute.
