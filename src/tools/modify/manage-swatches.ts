import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { formatToolResult } from '../tool-executor.js';
import { DESTRUCTIVE_ANNOTATIONS, COLOR_HELPERS_JSX, colorSchema } from './shared.js';

/**
 * manage_swatches — スウォッチの追加・更新・削除
 *
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/Swatches/ — Swatches, Swatch
 *
 * JSX API:
 *   Swatches.add() → Swatch
 *   Swatch.name → String (writable)
 *   Swatch.color → Color (writable)
 *   Swatch.remove() → void
 *   Swatches.getByName(name: String) → Swatch
 */
const jsxCode = `
${COLOR_HELPERS_JSX}

var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var action = params.action;

    if (action === "add") {
      if (!params.color) {
        writeResultFile(RESULT_PATH, { error: true, message: "color is required for add action" });
      } else {
        var swatch = doc.swatches.add();
        swatch.name = params.name;
        swatch.color = createColor(params.color);
        writeResultFile(RESULT_PATH, { success: true, action: "add", name: params.name, verified: { swatchCount: doc.swatches.length, name: swatch.name } });
      }
    } else if (action === "update") {
      try {
        var existing = doc.swatches.getByName(params.name);
        if (params.color) {
          existing.color = createColor(params.color);
        }
        writeResultFile(RESULT_PATH, { success: true, action: "update", name: params.name, verified: { swatchCount: doc.swatches.length, name: existing.name } });
      } catch(e) {
        writeResultFile(RESULT_PATH, { error: true, message: "Swatch not found: " + params.name });
      }
    } else if (action === "delete") {
      try {
        var toDelete = doc.swatches.getByName(params.name);
        toDelete.remove();
        writeResultFile(RESULT_PATH, { success: true, action: "delete", name: params.name, verified: { swatchCount: doc.swatches.length } });
      } catch(e) {
        writeResultFile(RESULT_PATH, { error: true, message: "Swatch not found: " + params.name });
      }
    } else {
      writeResultFile(RESULT_PATH, { error: true, message: "Unknown action: " + action });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "manage_swatches failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'manage_swatches',
    {
      title: 'Manage Swatches',
      description:
        'Add, update, or delete swatches in the active document. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        action: z.enum(['add', 'update', 'delete']).describe('Action to perform'),
        name: z.string().describe('Swatch name'),
        color: colorSchema.describe('Color for add/update (required for add)'),
      },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return formatToolResult(result);
    },
  );
}
