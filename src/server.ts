import { readFileSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { JsxToolError } from './executor/jsx-runner.js';
import { registerAllTools } from './tools/registry.js';
import { formatToolResult } from './tools/tool-executor.js';
import { registerAllPrompts } from './prompts/registry.js';

/**
 * serverInfo.version は package.json から読む（手書き定数はリリースのたびにずれる）。
 * dist/server.js・dist/bundle.cjs・src/server.ts のいずれからも ../package.json で届く
 */
export function readPackageVersion(): string {
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(path.resolve(dir, '../package.json'), 'utf-8')) as { version?: unknown };
    if (typeof pkg.version === 'string' && pkg.version) return pkg.version;
  } catch {
    // package.json が同梱されていない配置でもサーバー自体は起動させる
  }
  return '0.0.0-unknown';
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'illustrator-mcp-server',
    version: readPackageVersion(),
  });

  applyToolErrorBoundary(server);
  registerAllTools(server);
  registerAllPrompts(server);

  return server;
}

/**
 * 失敗をツール応答の isError に揃える境界。JSX の error: true は JsxToolError として投げられるので、
 * ここで formatToolResult() に通して追加情報ごと返す（例外のまま SDK に渡すと message しか残らない）。
 * 戻り値の error: true / success: false は formatToolResult() が isError を付ける
 */
export function applyToolErrorBoundary(server: McpServer): void {
  const register = server.registerTool.bind(server) as (...args: unknown[]) => unknown;
  (server as { registerTool: unknown }).registerTool = (name: string, config: unknown, handler: (...a: unknown[]) => unknown) =>
    register(name, config, async (...args: unknown[]) => {
      try {
        return await handler(...args);
      } catch (e) {
        if (!(e instanceof JsxToolError)) throw e;
        return formatToolResult(e.result);
      }
    });
}
