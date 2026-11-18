// Keep large manifests and ignore lists out of OS/API argv limits.
const fs = require('node:fs');
const path = require('node:path');
const [engine, operation, payload] = process.argv.slice(2);
// The upstream engine uses PID-based names in os.tmpdir(). Keep every operation
// inside a private directory, including when invoked in a remote sandbox.
process.umask(0o077);
const scratch = fs.mkdtempSync(path.join(path.dirname(payload), 'engine-'));
process.env.TMPDIR = scratch;
process.env.TMP = scratch;
process.env.TEMP = scratch;
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
process.argv = [process.execPath, engine, operation, fs.readFileSync(payload, 'utf8')];
require('node:module').runMain(engine);
