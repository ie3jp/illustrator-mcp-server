import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { ensureTmpDir, cleanupTmpDirSync } from './executor/file-transport.js';

async function main(): Promise<void> {
  // 一時ディレクトリを作成
  await ensureTmpDir();

  // プロセス終了時のクリーンアップ
  process.on('exit', () => {
    cleanupTmpDirSync();
  });
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
