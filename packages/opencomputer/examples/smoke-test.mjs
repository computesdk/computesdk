import { readFileSync } from 'node:fs';
import { opencomputer } from '../dist/index.mjs';

function readKey() {
  if (process.env.OPENCOMPUTER_API_KEY) {
    return process.env.OPENCOMPUTER_API_KEY;
  }

  const keyPath = process.env.OPENCOMPUTER_API_KEY_FILE || process.env.OC_API_KEY_PATH;
  if (keyPath) {
    return readFileSync(keyPath, 'utf8').trim();
  }

  throw new Error('Set OPENCOMPUTER_API_KEY, OPENCOMPUTER_API_KEY_FILE, or OC_API_KEY_PATH.');
}

const provider = opencomputer({
  apiKey: readKey(),
  apiUrl: process.env.OPENCOMPUTER_API_URL,
});

let sandbox;
let clone;
let snapshot;
const persistedPath = '/home/sandbox/compute-sdk-opencomputer.txt';

try {
  sandbox = await provider.sandbox.create({
    templateId: process.env.OPENCOMPUTER_TEMPLATE || 'base',
    timeout: 300_000,
    envs: { COMPUTESDK_OPENCOMPUTER_SMOKE: '1' },
    metadata: { test: 'computesdk-opencomputer-smoke' },
  });
  console.log(`created sandbox ${sandbox.sandboxId}`);

  const command = await sandbox.runCommand('printf "hello-opencomputer\\n" && pwd');
  console.log(`command exit=${command.exitCode}`);
  console.log(command.stdout.trim());
  if (command.exitCode !== 0) {
    throw new Error(`command failed: ${command.stderr}`);
  }

  await sandbox.filesystem.writeFile(persistedPath, 'hello from ComputeSDK OpenComputer provider');
  const file = await sandbox.filesystem.readFile(persistedPath);
  console.log(`file ok=${file.includes('ComputeSDK OpenComputer provider')}`);

  const url = await sandbox.getUrl({ port: 3000 });
  console.log(`preview url ${url}`);

  snapshot = await provider.snapshot.create(sandbox.sandboxId, {
    name: `computesdk-smoke-${Date.now()}`,
  });
  console.log(`snapshot ${snapshot.id}`);
  console.log(`snapshot kind default is disk_only with promoteToFull=true in provider request`);

  clone = await provider.sandbox.create({
    snapshotId: snapshot.id,
    timeout: 300_000,
  });
  console.log(`created clone ${clone.sandboxId}`);

  const cloneResult = await clone.runCommand(`cat ${persistedPath}`);
  console.log(`clone command exit=${cloneResult.exitCode}`);
  console.log(cloneResult.stdout.trim());
  if (cloneResult.exitCode !== 0) {
    throw new Error(`clone command failed: ${cloneResult.stderr}`);
  }
} finally {
  if (clone) {
    try {
      await clone.destroy();
      console.log(`destroyed clone ${clone.sandboxId}`);
    } catch (error) {
      console.error(`failed to destroy clone: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (snapshot && provider.snapshot) {
    try {
      await provider.snapshot.delete(snapshot.id);
      console.log(`deleted snapshot ${snapshot.id}`);
    } catch (error) {
      console.error(`failed to delete snapshot: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (sandbox) {
    try {
      await sandbox.destroy();
      console.log(`destroyed sandbox ${sandbox.sandboxId}`);
    } catch (error) {
      console.error(`failed to destroy sandbox: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
