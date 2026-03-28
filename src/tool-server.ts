import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { toJsonSchema } from '@valibot/to-json-schema';
import * as v from 'valibot';
import { buildObjectSchema, type SchemaShape } from './schema.ts';

interface ToolRegistration {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  validator: v.GenericSchema;
  handler: (params: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;
}

interface ServerInfo {
  name: string;
  version: string;
}

interface ToolConfig {
  title?: string;
  description?: string;
  inputSchema: SchemaShape;
  annotations?: Record<string, unknown>;
}

export interface ToolRegistry {
  registerTool(
    name: string,
    config: ToolConfig,
    handler: (params: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>,
  ): void;
}

export class ToolServer implements ToolRegistry {
  readonly #server: Server;
  readonly #tools = new Map<string, ToolRegistration>();

  constructor(info: ServerInfo) {
    this.#server = new Server(
      info,
      {
        capabilities: {
          tools: {},
        },
      },
    );

    this.#server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [...this.#tools.values()].map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      })),
    }));

    this.#server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const tool = this.#tools.get(request.params.name);
      if (!tool) {
        throw new Error(`Unknown tool: ${request.params.name}`);
      }

      const parsed = v.safeParse(tool.validator as never, request.params.arguments ?? {});
      if (!parsed.success) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: parsed.issues ? v.summarize(parsed.issues) : 'Invalid tool arguments.',
            },
          ],
        };
      }

      return await tool.handler(parsed.output as Record<string, unknown>);
    });
  }

  registerTool(
    name: string,
    config: ToolConfig,
    handler: (params: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>,
  ): void {
    const validator = buildObjectSchema(config.inputSchema);
    this.#tools.set(name, {
      name,
      title: config.title,
      description: config.description,
      inputSchema: toJsonSchema({ schema: validator as never }) as Record<string, unknown>,
      annotations: config.annotations,
      validator,
      handler,
    });
  }

  connect(transport: Parameters<Server['connect']>[0]) {
    return this.#server.connect(transport);
  }
}
