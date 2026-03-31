import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { vi } from 'vitest';

export function captureInputSchema(register: (server: McpServer) => void) {
  let inputSchema: Record<string, z.ZodTypeAny> | undefined;
  const server = {
    registerTool: vi.fn((_name: string, config: { inputSchema: Record<string, z.ZodTypeAny> }) => {
      inputSchema = config.inputSchema;
    }),
  } as unknown as McpServer;

  register(server);

  if (!inputSchema) {
    throw new Error('Tool schema was not registered');
  }

  return z.object(inputSchema);
}
