// @computesdk/test-utils@2.0.0 references `__dirname` at import time (for a
// best-effort dotenv load) but ships as ESM, where `__dirname` is undefined —
// throwing ReferenceError on import. Provide a global shim so the import
// succeeds; the resolved path is a harmless no-op for this standalone package.
const g = globalThis as Record<string, unknown>;
if (g.__dirname === undefined) g.__dirname = process.cwd();
if (g.__filename === undefined) g.__filename = process.cwd() + "/index.js";
