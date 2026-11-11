#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer, readPackageVersion } from './server.js';
import { checkForUpdate } from './update-check.js';
import { ensureTmpDir, cleanupTmpDirSync } from './executor/file-transport.js';
import { waitForPendingExecutions } from './executor/jsx-runner.js';

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

  // 新しい版の確認は待たない（結果は最初のツール応答に添える。失敗しても何もしない）
  void checkForUpdate(readPackageVersion());
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
