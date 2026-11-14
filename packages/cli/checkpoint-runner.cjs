// Keep large manifests and ignore lists out of OS/API argv limits.
const fs = require('node:fs');
const [engine, operation, payload] = process.argv.slice(2);
process.argv = [process.execPath, engine, operation, fs.readFileSync(payload, 'utf8')];
require('node:module').runMain(engine);
