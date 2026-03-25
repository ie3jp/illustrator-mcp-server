import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { register as registerQuickLayout } from './quick-layout.js';
import { register as registerPrintPreflightWorkflow } from './print-preflight-workflow.js';

export function registerAllPrompts(server: McpServer): void {
  registerQuickLayout(server);
  registerPrintPreflightWorkflow(server);
}
