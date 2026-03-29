import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import {
  coordinateSystemSchema,
  resolveCoordinateSystem,
} from '../session.js';
import { colorSchema, COLOR_HELPERS_JSX, FONT_HELPERS_JSX, WRITE_ANNOTATIONS } from './shared.js';

const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var coordSystem = params.coordinate_system || "artboard-web";
    ${COLOR_HELPERS_JSX}
    ${FONT_HELPERS_JSX}

    var inputX = params.x;
    var inputY = params.y;
    var kind = params.kind || "point";

    var abRect = (coordSystem === "artboard-web") ? getActiveArtboardRect() : null;
    var aiCoords = webToAiPoint(inputX, inputY, coordSystem, abRect);
    var aiX = aiCoords[0];
    var aiY = aiCoords[1];

    var resolvedFont = null;
    var fontCandidates = null;
    if (params.font_name) {
      try {
        resolvedFont = app.textFonts.getByName(params.font_name);
      } catch (e) {
        fontCandidates = findFontCandidates(params.font_name);
      }
    }

    var targetLayer = resolveTargetLayer(doc, params.layer_name);

    var tf;
    var rectPath = null;
    if (kind === "area") {
      var w = params.width || 100;
      var h = params.height || 100;
      rectPath = targetLayer.pathItems.rectangle(aiY, aiX, w, h);
      try {
        tf = targetLayer.textFrames.areaText(rectPath);
      } catch (eArea) {
        try { rectPath.remove(); } catch (_) {}
        throw eArea;
      }
    } else {
      tf = targetLayer.textFrames.pointText([aiX, aiY]);
    }

    var rawContents = params.contents || "";
    tf.contents = rawContents.split(String.fromCharCode(10)).join(String.fromCharCode(13));

    if (params.name) {
      tf.name = params.name;
    }

    var charAttrs = tf.textRange.characterAttributes;

    if (resolvedFont) {
      charAttrs.textFont = resolvedFont;
    }

    if (typeof params.font_size === "number") {
      charAttrs.size = params.font_size;
    }

    if (typeof params.fill !== "undefined") {
      charAttrs.fillColor = createColor(params.fill);
    }

    var uuid = ensureUUID(tf);
    var resultData = { uuid: uuid };
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
      description: 'Create a text frame. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        x: z.number().describe('X coordinate'),
        y: z.number().describe('Y coordinate'),
        contents: z.string().describe('Text contents'),
        kind: z
          .enum(['point', 'area'])
          .optional()
          .default('point')
          .describe('Text frame type (point or area)'),
        width: z.number().optional().describe('Area text width'),
        height: z.number().optional().describe('Area text height'),
        font_name: z.string().optional().describe('Font name (partial match, e.g. "Arial", "Helvetica"). Use list_fonts to find exact PostScript names.'),
        font_size: z.number().optional().describe('Font size (pt)'),
        fill: colorSchema.describe('Text color'),
        layer_name: z.string().optional().describe('Target layer name'),
        name: z.string().optional().describe('Object name'),
        coordinate_system: coordinateSystemSchema,
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const resolvedParams = { ...params, coordinate_system: await resolveCoordinateSystem(params.coordinate_system) };
      const result = await executeJsx(jsxCode, resolvedParams, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
