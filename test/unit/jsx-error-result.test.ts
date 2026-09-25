import { describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { JsxToolError } from '../../src/executor/jsx-runner.js';
import { returnJsxErrorsAsResults } from '../../src/server.js';

async function callWith(handler: () => Promise<unknown>) {
  const server = new McpServer({ name: 't', version: '0' });
  returnJsxErrorsAsResults(server);
  server.registerTool('t', { description: 't' }, handler as never);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'c', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const r = await client.callTool({ name: 't', arguments: {} });
  await client.close();
  return r as { isError?: boolean; content: Array<{ text: string }> };
}

describe('JSX のエラー結果', () => {
  it('追加フィールドを落とさず isError で返す', async () => {
    const r = await callWith(async () => {
      throw new JsxToolError('Font not found', { error: true, message: 'Font not found', font_candidates: ['A', 'B'] });
    });
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.content[0].text)).toEqual({ error: true, message: 'Font not found', font_candidates: ['A', 'B'] });
  });

  it('それ以外の例外は従来どおり message のみ', async () => {
    const r = await callWith(async () => {
      throw new Error('boom');
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('boom');
  });
});
