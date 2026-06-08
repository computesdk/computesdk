import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { BenchEvent } from './events';
import type { BenchRawStorageConfig } from './types';

const DEFAULT_MAX_PART_BYTES = 16 * 1024 * 1024;

type RawPart = {
  path: string;
  records: number;
  bytes: number;
  firstTimestamp: string;
  lastTimestamp: string;
};

function eventTimestamp(event: BenchEvent): string {
  if ('timestamp' in event && typeof event.timestamp === 'string') return event.timestamp;
  if ('startedAt' in event && typeof event.startedAt === 'string') return event.startedAt;
  return new Date().toISOString();
}

function defaultDir(): string {
  return join(homedir(), '.benchmark');
}

export function shouldEnableRawStorage(config?: BenchRawStorageConfig): boolean {
  if (!config) return false;
  return config.enabled !== false;
}

export function createRawEventStore(params: {
  config?: BenchRawStorageConfig;
  runId: string;
  batch?: string;
  shardIndex?: number;
  shardCount?: number;
  provider?: string;
  label: string;
}) {
  const baseDir = params.config?.dir ?? defaultDir();
  const maxPartBytes = Math.max(1024, params.config?.maxPartBytes ?? DEFAULT_MAX_PART_BYTES);
  const groupId = params.batch ?? 'none';
  const shard = typeof params.shardIndex === 'number' ? String(params.shardIndex) : 'none';
  const runDir = join(baseDir, 'bench', 'v1', `group_id=${groupId}`, `run_id=${params.runId}`, `shard=${shard}`);

  let initialized = false;
  let closing = false;
  let partIndex = 0;
  let currentPartBytes = 0;
  let currentPartRecords = 0;
  let currentPartFirstTimestamp = '';
  let currentPartLastTimestamp = '';
  let currentPartPath = '';
  const partStats: RawPart[] = [];

  const queue: string[] = [];
  let draining: Promise<void> | undefined;

  async function ensureReady(): Promise<void> {
    if (initialized) return;
    await fs.mkdir(runDir, { recursive: true });
    initialized = true;
  }

  function nextPartPath(): string {
    return join(runDir, `part-${String(partIndex).padStart(6, '0')}.jsonl`);
  }

  async function rotateIfNeeded(nextLineBytes: number): Promise<void> {
    if (currentPartPath === '') {
      currentPartPath = nextPartPath();
      partIndex += 1;
      currentPartBytes = 0;
      currentPartRecords = 0;
      currentPartFirstTimestamp = '';
      currentPartLastTimestamp = '';
      return;
    }
    if (currentPartBytes + nextLineBytes <= maxPartBytes) return;
    partStats.push({
      path: currentPartPath,
      records: currentPartRecords,
      bytes: currentPartBytes,
      firstTimestamp: currentPartFirstTimestamp,
      lastTimestamp: currentPartLastTimestamp,
    });
    currentPartPath = nextPartPath();
    partIndex += 1;
    currentPartBytes = 0;
    currentPartRecords = 0;
    currentPartFirstTimestamp = '';
    currentPartLastTimestamp = '';
  }

  async function drain(): Promise<void> {
    await ensureReady();
    while (queue.length > 0) {
      const line = queue.shift()!;
      const bytes = Buffer.byteLength(line, 'utf8');
      await rotateIfNeeded(bytes);
      await fs.appendFile(currentPartPath, line, 'utf8');
      currentPartBytes += bytes;
      currentPartRecords += 1;
    }
  }

  function scheduleDrain(): void {
    if (draining) return;
    draining = (async () => {
      try {
        await drain();
      } finally {
        draining = undefined;
      }
    })();
  }

  function write(event: BenchEvent): void {
    if (closing) return;
    const ts = eventTimestamp(event);
    if (currentPartFirstTimestamp === '') currentPartFirstTimestamp = ts;
    currentPartLastTimestamp = ts;
    const record = {
      schemaVersion: 'bench.raw.v1',
      eventType: event.event,
      ts,
      runId: 'runId' in event ? event.runId : params.runId,
      groupId: 'batch' in event ? (event.batch ?? params.batch ?? null) : (params.batch ?? null),
      shardIndex: 'shardIndex' in event ? (event.shardIndex ?? params.shardIndex ?? null) : (params.shardIndex ?? null),
      shardCount: 'shardCount' in event ? (event.shardCount ?? params.shardCount ?? null) : (params.shardCount ?? null),
      provider: 'provider' in event ? (event.provider ?? params.provider ?? null) : (params.provider ?? null),
      eventId: 'eventId' in event ? event.eventId : null,
      payload: event,
    };
    queue.push(`${JSON.stringify(record)}\n`);
    scheduleDrain();
  }

  async function close(): Promise<void> {
    closing = true;
    if (draining) await draining;
    if (queue.length > 0) await drain();
    if (!initialized) return;

    if (currentPartPath !== '' && currentPartRecords > 0) {
      partStats.push({
        path: currentPartPath,
        records: currentPartRecords,
        bytes: currentPartBytes,
        firstTimestamp: currentPartFirstTimestamp,
        lastTimestamp: currentPartLastTimestamp,
      });
    }

    const manifest = {
      schemaVersion: 'bench.manifest.v1',
      label: params.label,
      runId: params.runId,
      groupId: params.batch ?? null,
      shardIndex: params.shardIndex ?? null,
      shardCount: params.shardCount ?? null,
      provider: params.provider ?? null,
      createdAt: new Date().toISOString(),
      parts: partStats.map((part) => ({
        path: part.path,
        records: part.records,
        bytes: part.bytes,
        firstTimestamp: part.firstTimestamp,
        lastTimestamp: part.lastTimestamp,
      })),
      totals: {
        records: partStats.reduce((sum, part) => sum + part.records, 0),
        bytes: partStats.reduce((sum, part) => sum + part.bytes, 0),
      },
    };

    await fs.writeFile(join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  }

  return { write, close, runDir };
}
