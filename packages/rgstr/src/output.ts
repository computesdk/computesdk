// Plain text or --json, nothing else. Tables are padded columns, no deps.

export function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

export function table(rows: string[][], header?: string[]): string {
  const all = header ? [header, ...rows] : rows;
  const widths: number[] = [];
  for (const row of all) row.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, cell.length)));
  return all
    .map((row) => row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i]))).join('  ').trimEnd())
    .join('\n');
}

export function kv(pairs: Array<[string, string | null | undefined]>): string {
  const shown = pairs.filter((p): p is [string, string] => typeof p[1] === 'string' && p[1].length > 0);
  const w = Math.max(...shown.map(([k]) => k.length));
  return shown.map(([k, v]) => `${k.padEnd(w)}  ${v}`).join('\n');
}

export function fmtDownloads(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M/wk`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k/wk`;
  return `${n}/wk`;
}
