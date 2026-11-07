import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { registerAgentsCommands, type AgentEventView } from '../agents.js';

describe('agents interrupt over HTTP', () => {
  let baseUrl: string;
  let events: AgentEventView[] = [];
  let requests: Array<{ method: string | undefined; url: string | undefined; body: unknown }> = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, url: req.url, body: JSON.parse(body) });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ events }));
  });
  beforeAll(async () => {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing HTTP fixture port');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    requests = [];
    events = [];
  });
  afterAll(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  async function interrupt(sessionId: string, json = false) {
    const program = new Command();
    registerAgentsCommands(program);
    await program.parseAsync(['agents', 'interrupt', sessionId, '--api-key', 'test-key', '--base-url', baseUrl, ...(json ? ['--json'] : [])], { from: 'user' });
    expect(requests).toEqual([{ method: 'POST', url: `/api/v1/agent-sessions/${sessionId}/controls`, body: { action: 'interrupt' } }]);
  }
  it.each(['stopped', 'suspended'])('reports an unchanged %s session, without claiming an interruption or waking it', async status => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await interrupt(status);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(`unchanged ${status} — no active turn to interrupt`);
  });
  it('reports an actual interrupt and preserves the returned events', async () => {
    events = [{ seq: 1, kind: 'turn', payload: { type: 'control', action: 'interrupt' }, createdAt: new Date().toISOString() }];
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await interrupt('active');
    expect(log).toHaveBeenLastCalledWith('interrupted active — conversation preserved');
    expect(log).toHaveBeenCalledTimes(2);
  });
  it.each([false, true])('keeps raw JSON output unchanged (active=%s)', async active => {
    if (active) events = [{ seq: 1, kind: 'turn', payload: { type: 'control', action: 'interrupt' }, createdAt: new Date().toISOString() }];
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await interrupt('json', true);
    expect(write).toHaveBeenCalledWith(JSON.stringify({ events }, null, 2) + '\n');
    expect(log).not.toHaveBeenCalled();
  });
});
