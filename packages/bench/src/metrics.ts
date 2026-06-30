import * as fs from 'node:fs';
import * as os from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';

export interface BenchmarkSystemMetricsSample {
  ts: string;
  uptimeMs: number;
  cpuUserUs: number;
  cpuSystemUs: number;
  memRssMb: number;
  memHeapUsedMb: number;
  memHeapTotalMb: number;
  memExternalMb: number;
  eventLoopP50Ms: number;
  eventLoopP99Ms: number;
  eventLoopMaxMs: number;
  loadavg1m: number;
  loadavg5m: number;
  loadavg15m: number;
  openFds: number | null;
  sockstat: Record<string, number> | null;
}

export interface BenchmarkSystemMetricsCollector {
  sample(): BenchmarkSystemMetricsSample;
  stop(): void;
}

function readSockstat(): Record<string, number> | null {
  try {
    const data = fs.readFileSync('/proc/net/sockstat', 'utf-8');
    const out: Record<string, number> = {};
    for (const line of data.split('\n')) {
      const index = line.indexOf(':');
      if (index < 0) continue;
      const section = line.slice(0, index).trim().toLowerCase();
      const parts = line.slice(index + 1).trim().split(/\s+/);
      for (let i = 0; i + 1 < parts.length; i += 2) {
        const value = Number.parseInt(parts[i + 1], 10);
        if (!Number.isNaN(value)) out[`${section}_${parts[i]}`] = value;
      }
    }
    return out;
  } catch {
    return null;
  }
}

function countOpenFds(): number | null {
  try {
    return fs.readdirSync('/proc/self/fd').length;
  } catch {
    return null;
  }
}

export function createSystemMetricsCollector(): BenchmarkSystemMetricsCollector {
  const startedAt = Date.now();
  const cpuBaseline = process.cpuUsage();
  const eventLoop = monitorEventLoopDelay({ resolution: 20 });
  eventLoop.enable();

  return {
    sample() {
      const cpu = process.cpuUsage(cpuBaseline);
      const memory = process.memoryUsage();
      const loadavg = os.loadavg();
      const sample: BenchmarkSystemMetricsSample = {
        ts: new Date().toISOString(),
        uptimeMs: Date.now() - startedAt,
        cpuUserUs: cpu.user,
        cpuSystemUs: cpu.system,
        memRssMb: Math.round(memory.rss / 1024 / 1024),
        memHeapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
        memHeapTotalMb: Math.round(memory.heapTotal / 1024 / 1024),
        memExternalMb: Math.round(memory.external / 1024 / 1024),
        eventLoopP50Ms: eventLoop.percentile(50) / 1e6,
        eventLoopP99Ms: eventLoop.percentile(99) / 1e6,
        eventLoopMaxMs: eventLoop.max / 1e6,
        loadavg1m: loadavg[0],
        loadavg5m: loadavg[1],
        loadavg15m: loadavg[2],
        openFds: countOpenFds(),
        sockstat: readSockstat(),
      };
      eventLoop.reset();
      return sample;
    },
    stop() {
      eventLoop.disable();
    },
  };
}
