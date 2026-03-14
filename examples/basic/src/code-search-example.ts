/**
 * Code Search Example
 *
 * This example shows how to use ComputeSDK's codeSearch feature, powered by
 * Morph WarpGrep, to run semantic code searches inside a sandbox.
 *
 * Prerequisites:
 *   - MORPH_API_KEY (or COMPUTESDK_API_KEY) – get yours at https://morphllm.com/dashboard
 *   - A sandbox provider API key (e.g. E2B_API_KEY)
 */

import { compute } from 'computesdk';
import { config } from 'dotenv';
config(); // Load environment variables from .env file

async function main() {
  if (!process.env.MORPH_API_KEY) {
    console.error('Please set MORPH_API_KEY environment variable');
    console.error('Get yours at https://morphllm.com/dashboard');
    process.exit(1);
  }

  try {
    // Configure compute – adjust the provider to match your setup
    compute.setConfig({
      provider: 'e2b',
      apiKey: process.env.COMPUTESDK_API_KEY || 'local',
      e2b: { apiKey: process.env.E2B_API_KEY },
    });

    // Create a sandbox
    const sandbox = await compute.sandbox.create();
    console.log('Created sandbox:', sandbox.sandboxId);

    // Write some sample files so there is code to search through
    await sandbox.filesystem.writeFile(
      '/home/user/auth.ts',
      `export function verifyToken(token: string): boolean {
  // TODO: implement JWT verification
  return token.length > 0;
}

export function hashPassword(password: string): string {
  return password; // placeholder
}
`,
    );
    await sandbox.filesystem.writeFile(
      '/home/user/server.ts',
      `import { verifyToken } from './auth';

export function handleRequest(req: any) {
  const token = req.headers['authorization'];
  if (!verifyToken(token)) {
    return { status: 401, body: 'Unauthorized' };
  }
  return { status: 200, body: 'OK' };
}
`,
    );

    // ---------------------------------------------------------------
    // 1. Direct usage via sandbox.filesystem.codeSearch()
    // ---------------------------------------------------------------
    console.log('\n--- Direct codeSearch usage ---');

    const results = await sandbox.filesystem.codeSearch!(
      'How is authentication handled?',
      '/home/user',
      { morphApiKey: process.env.MORPH_API_KEY },
    );

    console.log(`Found ${results.length} result(s):\n`);
    for (const r of results) {
      console.log(`File: ${r.file}`);
      console.log(`Lines: ${JSON.stringify(r.lines)}`);
      console.log(r.content.slice(0, 300));
      console.log('---');
    }

    // ---------------------------------------------------------------
    // 2. Using codeSearch as an agent tool
    // ---------------------------------------------------------------
    // In an agent loop you might expose codeSearch as a tool definition:
    //
    //   {
    //     name: 'code_search',
    //     description: 'Semantic search over the codebase',
    //     parameters: {
    //       query: { type: 'string', description: 'What to search for' },
    //     },
    //     execute: async ({ query }) => {
    //       const hits = await sandbox.filesystem.codeSearch!(query, '/home/user', {
    //         morphApiKey: process.env.MORPH_API_KEY,
    //         excludes: ['node_modules', '.git', 'dist'],
    //       });
    //       return hits.map(h => `${h.file}:\n${h.content}`).join('\n\n');
    //     },
    //   }

    // Clean up
    await sandbox.destroy();
    console.log('\nSandbox cleaned up successfully');
  } catch (error) {
    if (error instanceof Error) {
      console.error('Error:', error.message);
      if (error.message.includes('API key')) {
        console.error('Make sure MORPH_API_KEY is set. Get yours at https://morphllm.com/dashboard');
      }
    } else {
      console.error('Unknown error:', error);
    }
  }
}

main();
