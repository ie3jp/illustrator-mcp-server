import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { READ_ANNOTATIONS, WRITE_ANNOTATIONS, coerceBoolean } from './shared.js';

/**
 * apply_graphic_style / list_graphic_styles
 *
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/GraphicStyle/ — GraphicStyle.applyTo(), mergeTo()
 *
 * JSX API:
 *   Document.graphicStyles → GraphicStyles コレクション
 *   GraphicStyles.getByName(name: String) → GraphicStyle
 *   GraphicStyle.applyTo(artItem: PageItem) → void
 *   GraphicStyle.mergeTo(artItem: PageItem) → void
 */
const applyJsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;

    var style = null;
    try {
      style = doc.graphicStyles.getByName(params.style_name);
    } catch(e) {
      writeResultFile(RESULT_PATH, { error: true, message: "Graphic style not found: " + params.style_name });
    }

    if (style) {
      var appliedCount = 0;
      for (var i = 0; i < params.uuids.length; i++) {
        var item = findItemByUUID(params.uuids[i]);
        if (item) {
          if (params.merge === true) {
            style.mergeTo(item);
          } else {
            style.applyTo(item);
          }
          appliedCount++;
        }
      }
      writeResultFile(RESULT_PATH, {
        success: true,
        styleName: params.style_name,
        appliedCount: appliedCount,
        merge: params.merge === true
      });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "apply_graphic_style failed: " + e.message, line: e.line });
  }
}
`;

const listJsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var doc = app.activeDocument;
    var styles = [];
    for (var i = 0; i < doc.graphicStyles.length; i++) {
      styles.push({ index: i, name: doc.graphicStyles[i].name });
    }
    writeResultFile(RESULT_PATH, { count: styles.length, styles: styles });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "list_graphic_styles failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'apply_graphic_style',
    {
      title: 'Apply Graphic Style',
      description:
        'Apply a graphic style to objects. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        style_name: z.string().describe('Name of the graphic style to apply'),
        uuids: z.array(z.string()).min(1).describe('UUIDs of target objects'),
        merge: coerceBoolean
          .optional()
          .default(false)
          .describe('true = merge with existing appearance, false = replace'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(applyJsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.registerTool(
    'list_graphic_styles',
    {
      title: 'List Graphic Styles',
      description: 'List all graphic styles in the active document.',
      inputSchema: {},
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(listJsxCode, params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
