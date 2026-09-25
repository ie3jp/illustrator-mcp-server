import { readFileSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { JsxToolError } from './executor/jsx-runner.js';
import { registerAllTools } from './tools/registry.js';
import { registerAllPrompts } from './prompts/registry.js';

/**
 * package.json の version を実行時に読む（serverInfo.version 用）。
 *
 * dist/server.js（tsc）・dist/bundle.cjs（esbuild）のどちらもパッケージ直下の
 * dist/ に置かれ、npm パッケージにも mcpb バンドルにも package.json が同梱されるため、
 * モジュール位置から ../package.json で解決できる。src/server.ts（vitest / tsx）でも同じ。
 * 手書きの定数はリリースのたびにずれるので持たない。
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

  returnJsxErrorsAsResults(server);
  registerAllTools(server);
  registerAllPrompts(server);

  return server;
}

/**
 * JSX のエラー結果を、追加情報（font_candidates / existing_files / unsavedChanges 等）ごと
 * isError のツール結果として返す。例外のまま SDK に渡すと message しか残らない。
 */
export function returnJsxErrorsAsResults(server: McpServer): void {
  const register = server.registerTool.bind(server) as (...args: unknown[]) => unknown;
  (server as { registerTool: unknown }).registerTool = (name: string, config: unknown, handler: (...a: unknown[]) => unknown) =>
    register(name, config, async (...args: unknown[]) => {
      try {
        return await handler(...args);
      } catch (e) {
        if (!(e instanceof JsxToolError)) throw e;
        return { content: [{ type: 'text', text: JSON.stringify(e.result, null, 2) }], isError: true };
      }
    });
}
