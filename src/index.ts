#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.ts';
import { ensureTmpDir, cleanupTmpDirSync } from './executor/file-transport.ts';
import { waitForPendingExecutions } from './executor/jsx-runner.ts';

async function main(): Promise<void> {
  // 一時ディレクトリを作成
  await ensureTmpDir();

  // プロセス終了時のクリーンアップ
  process.on('exit', () => {
    cleanupTmpDirSync();
  });

  // グレースフルシャットダウン: 実行中の JSX を待ってから終了
  let shuttingDown = false;
  const gracefulShutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await waitForPendingExecutions();
    process.exit(0);
  };
  process.on('SIGINT', () => { void gracefulShutdown().catch(() => process.exit(1)); });
  process.on('SIGTERM', () => { void gracefulShutdown().catch(() => process.exit(1)); });

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
