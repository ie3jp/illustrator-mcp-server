import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAllTools } from './tools/registry.js';

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'illustrator-mcp-server',
    version: '0.1.0',
  });

  registerAllTools(server);

  return server;
}
