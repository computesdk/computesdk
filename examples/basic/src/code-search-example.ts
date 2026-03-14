/**
 * Code Search Example
 *
 * Shows two ways to use Morph WarpGrep code search with ComputeSDK:
 *   1. Gateway mode:  sandbox.filesystem.codeSearch()
 *   2. Direct mode:   executeCodeSearch(sandbox, ...)  — works with ANY provider
 *
 * Prerequisites:
 *   - MORPH_API_KEY – get yours at https://morphllm.com/dashboard
 *   - A sandbox provider API key (e.g. E2B_API_KEY, MODAL_TOKEN_ID/SECRET)
 */

import { compute, executeCodeSearch } from 'computesdk';
import { config } from 'dotenv';
config();

// Sample files to write into the sandbox
const FILES: Record<string, string> = {
  '/workspace/src/auth/middleware.ts': `
import jwt from 'jsonwebtoken';

export function authMiddleware(req: any, res: any, next: any) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET!);
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
}`,
  '/workspace/src/routes/api.ts': `
import { Router } from 'express';
import { authMiddleware } from '../auth/middleware';

const router = Router();
router.get('/users', authMiddleware, (req, res) => res.json([]));
router.post('/users', authMiddleware, (req, res) => res.status(201).json(req.body));
export default router;`,
  '/workspace/src/db/connection.ts': `
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const query = (text: string, params?: any[]) => pool.query(text, params);
export const getClient = () => pool.connect();`,
};

// ----------------------------------------------------------------
// 1. Gateway mode — sandbox.filesystem.codeSearch()
// ----------------------------------------------------------------
async function gatewayExample() {
  console.log('=== Gateway Mode ===\n');

  compute.setConfig({
    provider: 'e2b',
    apiKey: process.env.COMPUTESDK_API_KEY || 'local',
    e2b: { apiKey: process.env.E2B_API_KEY },
  });

  const sandbox = await compute.sandbox.create();
  for (const [path, content] of Object.entries(FILES)) {
    await sandbox.filesystem.writeFile(path, content);
  }

  const results = await sandbox.filesystem.codeSearch!(
    'How is authentication handled?',
    '/workspace',
  );

  console.log(`Found ${results.length} result(s):`);
  for (const r of results) console.log(`  ${r.file}`);

  await sandbox.destroy();
}

// ----------------------------------------------------------------
// 2. Direct mode — executeCodeSearch(sandbox, ...) with any provider
// ----------------------------------------------------------------
async function directExample() {
  console.log('\n=== Direct Mode (works with any provider) ===\n');

  // Works the same with: modal(), e2b(), daytona(), etc.
  const { modal } = await import('@computesdk/modal');
  const provider = modal({
    tokenId: process.env.MODAL_TOKEN_ID,
    tokenSecret: process.env.MODAL_TOKEN_SECRET,
  });

  const sandbox = await provider.sandbox.create();

  for (const [path, content] of Object.entries(FILES)) {
    await sandbox.runCommand(`mkdir -p $(dirname ${path}) && cat > ${path} << 'FILEEOF'\n${content}\nFILEEOF`);
  }

  // executeCodeSearch works with ANY sandbox — gateway or direct
  const results = await executeCodeSearch(
    sandbox,
    'How is authentication handled?',
    '/workspace',
  );

  console.log(`Found ${results.length} result(s):`);
  for (const r of results) console.log(`  ${r.file}`);

  await sandbox.destroy();
}

async function main() {
  if (!process.env.MORPH_API_KEY) {
    console.error('Set MORPH_API_KEY — get yours at https://morphllm.com/dashboard');
    process.exit(1);
  }

  // Run whichever mode you have credentials for
  if (process.env.E2B_API_KEY) await gatewayExample();
  if (process.env.MODAL_TOKEN_ID) await directExample();
}

main().catch(console.error);
