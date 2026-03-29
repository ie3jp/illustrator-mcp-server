import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { WRITE_ANNOTATIONS } from './shared.js';

/**
 * move_to_layer — オブジェクトを別レイヤーに移動
 *
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/PageItem/ — PageItem.move()
 *
 * JSX API:
 *   PageItem.move(relativeObject: Layer, insertionLocation?: ElementPlacement) → PageItem
 *   ElementPlacement: PLACEATBEGINNING (最前面) | PLACEATEND (最背面)
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;

    var targetLayer = null;
    try {
      targetLayer = doc.layers.getByName(params.target_layer);
    } catch(e) {
      writeResultFile(RESULT_PATH, { error: true, message: "Layer not found: " + params.target_layer });
    }

    if (targetLayer) {
      var placement = (params.position === "end")
        ? ElementPlacement.PLACEATEND
        : ElementPlacement.PLACEATBEGINNING;

      var movedCount = 0;
      for (var i = 0; i < params.uuids.length; i++) {
        var item = findItemByUUID(params.uuids[i]);
        if (item) {
          item.move(targetLayer, placement);
          movedCount++;
        }
      }

      writeResultFile(RESULT_PATH, {
        success: true,
        movedCount: movedCount,
        targetLayer: params.target_layer
      });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "move_to_layer failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'move_to_layer',
    {
      title: 'Move to Layer',
      description:
        'Move one or more objects to a different layer. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        uuids: z.array(z.string()).min(1).describe('UUIDs of objects to move'),
        target_layer: z.string().describe('Target layer name'),
        position: z
          .enum(['beginning', 'end'])
          .optional()
          .default('beginning')
          .describe('beginning = front of layer, end = back of layer'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
