import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { WRITE_ANNOTATIONS, coerceBoolean } from './shared.js';

const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;

    var item = findItemByUUID(params.uuid);
    if (!item) {
      writeResultFile(RESULT_PATH, { error: true, message: "Object not found: " + params.uuid });
    } else {
      var style = doc.objectStyles.itemByName(params.style_name);
      if (!style || !style.isValid) {
        // List available styles
        var styleNames = [];
        for (var si = 0; si < doc.objectStyles.length; si++) {
          styleNames.push(doc.objectStyles.item(si).name);
        }
        writeResultFile(RESULT_PATH, { error: true, message: "Object style not found: " + params.style_name, available: styleNames });
      } else {
        var clearOverrides = params.clear_overrides === true;
        item.appliedObjectStyle = style;
        if (clearOverrides) {
          item.clearObjectStyleOverrides();
        }
        writeResultFile(RESULT_PATH, {
          success: true,
          uuid: params.uuid,
          styleName: params.style_name,
          verified: verifyItem(item)
        });
      }
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "apply_object_style failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'apply_object_style',
    {
      title: 'Apply Object Style',
      description: 'Apply an InDesign object style to a page item by UUID.',
      inputSchema: {
        uuid: z.string().describe('UUID of the target object'),
        style_name: z.string().describe('Name of the object style to apply'),
        clear_overrides: coerceBoolean
          .optional()
          .default(false)
          .describe('Clear existing object overrides after applying style'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
