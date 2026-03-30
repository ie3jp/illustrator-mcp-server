import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAllTools } from './tools/registry.js';
import { registerAllPrompts } from './prompts/registry.js';

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'indesign-mcp-server',
    version: '0.1.0',
  });

  registerAllTools(server);
  registerAllPrompts(server);

  return server;
}
