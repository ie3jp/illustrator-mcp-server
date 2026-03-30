import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { colorSchema, COLOR_HELPERS_JSX, FONT_HELPERS_JSX, WRITE_ANNOTATIONS } from './shared.js';

const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    ${COLOR_HELPERS_JSX}
    ${FONT_HELPERS_JSX}

    var x = params.x;
    var y = params.y;
    var w = params.width || 100;
    var h = params.height || 50;

    var page = resolveTargetPage(doc, params.page_index);
    var targetLayer = resolveTargetLayer(doc, params.layer_name);

    var tf = page.textFrames.add(targetLayer, LocationOptions.UNKNOWN, {
      geometricBounds: [y, x, y + h, x + w]
    });

    // Handle \\n in contents
    var rawContents = params.contents || "";
    rawContents = rawContents.replace(/\\\\n/g, "\\n");
    tf.contents = rawContents;

    if (params.name) {
      tf.name = params.name;
    }

    if (params.fill) {
      applyFill(tf, doc, params.fill);
    }

    var fontCandidates = null;
    if (params.font_name) {
      try {
        tf.texts[0].appliedFont = app.fonts.item(params.font_name);
      } catch(e) {
        fontCandidates = findFontCandidates(params.font_name);
      }
    }

    if (typeof params.font_size === "number") {
      try {
        tf.texts[0].pointSize = params.font_size;
      } catch(e) {}
    }

    var uuid = ensureUUID(tf);
    var resultData = { uuid: uuid, verified: verifyItem(tf) };
    if (fontCandidates !== null) {
      resultData.font_warning = "Font '" + params.font_name + "' not found. Text frame created with default font.";
      resultData.font_candidates = fontCandidates;
    }
    writeResultFile(RESULT_PATH, resultData);
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Failed to create text frame: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'create_text_frame',
    {
      title: 'Create Text Frame',
      description: 'Create an area text frame on the active InDesign document page.',
      inputSchema: {
        x: z.number().describe('Left edge X coordinate (points from page left)'),
        y: z.number().describe('Top edge Y coordinate (points from page top)'),
        width: z.number().optional().default(100).describe('Width in points'),
        height: z.number().optional().default(50).describe('Height in points'),
        contents: z.string().optional().describe('Text contents. Use \\n for line breaks.'),
        font_name: z.string().optional().describe('Font name (e.g. "Arial", "Helvetica-Bold"). Use list_fonts to find names.'),
        font_size: z.number().optional().describe('Font size in points'),
        fill: colorSchema.describe('Fill color of the frame'),
        layer_name: z.string().optional().describe('Target layer name (created if not exists)'),
        name: z.string().optional().describe('Object name'),
        page_index: z.number().int().min(0).optional().describe('Zero-based page index (default: active page)'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
