import { describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

vi.mock('../../src/executor/jsx-runner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/executor/jsx-runner.js')>();
  return { ...actual, executeJsx: vi.fn(), executeJsxHeavy: vi.fn() };
});

import { JsxToolError, executeJsx } from '../../src/executor/jsx-runner.js';
import { applyToolErrorBoundary } from '../../src/server.js';
import { formatToolResult } from '../../src/tools/tool-executor.js';
import { register as registerExport } from '../../src/tools/export/export.js';
import { register as registerDeleteObjects } from '../../src/tools/modify/delete-objects.js';

type CallResult = { isError?: boolean; content: Array<{ type: string; text?: string; data?: string }> };

async function connect(register: (server: McpServer) => void) {
  const server = new McpServer({ name: 't', version: '0' });
  applyToolErrorBoundary(server);
  register(server);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'c', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

async function callWith(handler: () => Promise<unknown>): Promise<CallResult> {
  const client = await connect((server) => server.registerTool('t', { description: 't' }, handler as never));
  const r = await client.callTool({ name: 't', arguments: {} });
  await client.close();
  return r as CallResult;
}

describe('ツール応答の失敗判定（isError）', () => {
  it('JSX の error: true は追加フィールドを落とさず isError で返す', async () => {
    const r = await callWith(async () => {
      throw new JsxToolError('Font not found', { error: true, message: 'Font not found', font_candidates: ['A', 'B'] });
    });
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.content[0].text!)).toEqual({ error: true, message: 'Font not found', font_candidates: ['A', 'B'] });
  });

  it('それ以外の例外は従来どおり message のみ', async () => {
    const r = await callWith(async () => {
      throw new Error('boom');
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('boom');
  });

  it('success: false（部分失敗）は JSON を全部残して isError で返す', async () => {
    const body = { success: false, deletedCount: 1, notFound: ['x'] };
    const r = await callWith(async () => formatToolResult(body));
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.content[0].text!)).toEqual(body);
  });

  it('TS 側で直接返す入力エラー（error: true）も isError', async () => {
    const r = await callWith(async () => formatToolResult({ error: true, message: 'bad input' }));
    expect(r.isError).toBe(true);
  });

  it('成功は isError を付けない', async () => {
    const r = await callWith(async () => formatToolResult({ success: true, n: 1 }));
    expect(r.isError).toBeFalsy();
  });

  it('画像など独自に組んだ content はそのまま通す', async () => {
    const r = await callWith(async () => ({
      content: [...formatToolResult({ success: true }).content, { type: 'image', data: 'AAAA', mimeType: 'image/png' }],
    }));
    expect(r.isError).toBeFalsy();
    expect(r.content[1]).toMatchObject({ type: 'image', data: 'AAAA' });
  });

  it('実ツール: export の相対パス拒否と delete_objects の部分失敗が isError になる', async () => {
    const client = await connect((server) => {
      registerExport(server);
      registerDeleteObjects(server);
    });
    const rel = (await client.callTool({ name: 'export', arguments: { target: 'artboard:0', format: 'png', output_path: 'out.png' } })) as CallResult;
    expect(rel.isError).toBe(true);
    expect(JSON.parse(rel.content[0].text!).message).toMatch(/absolute/);

    vi.mocked(executeJsx).mockResolvedValueOnce({ success: false, deletedCount: 0, notFound: ['u1'] });
    const del = (await client.callTool({ name: 'delete_objects', arguments: { uuids: ['u1'] } })) as CallResult;
    expect(del.isError).toBe(true);
    expect(JSON.parse(del.content[0].text!).notFound).toEqual(['u1']);
    await client.close();
  });
});
