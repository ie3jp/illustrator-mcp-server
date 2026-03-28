import { ToolServer } from './tool-server.ts';
import { registerAllTools } from './tools/registry.ts';

export function createServer(): ToolServer {
  const server = new ToolServer({
    name: 'illustrator-mcp-server',
    version: '1.2.4',
  });

  registerAllTools(server);

  return server;
}
