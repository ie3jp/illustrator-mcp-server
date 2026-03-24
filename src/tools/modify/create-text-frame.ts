import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { colorSchema, COLOR_HELPERS_JSX } from './shared.js';

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

    function webToAiCoords(x, y, artboardRect) {
      if (artboardRect) {
        return [artboardRect[0] + x, artboardRect[1] - y];
      }
      return [x, y];
    }

    var inputX = params.x;
    var inputY = params.y;
    var kind = params.kind || "point";

    var abRect = null;
    if (coordSystem === "artboard-web") {
      var ab = doc.artboards[doc.artboards.getActiveArtboardIndex()];
      abRect = ab.artboardRect;
    }

    var aiCoords = webToAiCoords(inputX, inputY, abRect);
    var aiX = aiCoords[0];
    var aiY = aiCoords[1];

    var resolvedFont = null;
    var fontCandidates = null;
    if (params.font_name) {
      try {
        resolvedFont = app.textFonts.getByName(params.font_name);
      } catch (e) {
        var candidates = [];
        var searchLower = params.font_name.toLowerCase();
        for (var fi = 0; fi < app.textFonts.length; fi++) {
          var f = app.textFonts[fi];
          if (f.name.toLowerCase().indexOf(searchLower) >= 0 ||
              (f.family && f.family.toLowerCase().indexOf(searchLower) >= 0)) {
            candidates.push({ name: f.name, family: f.family });
            if (candidates.length >= 10) break;
          }
        }
        fontCandidates = candidates;
      }
    }

    var targetLayer = doc.activeLayer;
    if (params.layer_name) {
      try {
        targetLayer = doc.layers.getByName(params.layer_name);
      } catch (e) {
        targetLayer = doc.layers.add();
        targetLayer.name = params.layer_name;
      }
    }

    var tf;
    if (kind === "area") {
      var w = params.width || 100;
      var h = params.height || 100;
      var rectPath = targetLayer.pathItems.rectangle(aiY, aiX, w, h);
      tf = targetLayer.textFrames.areaText(rectPath);
    } else {
      tf = targetLayer.textFrames.pointText([aiX, aiY]);
    }

    tf.contents = params.contents || "";

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
        coordinate_system: z
          .enum(['artboard-web', 'document'])
          .optional()
          .default('artboard-web')
          .describe('Coordinate system (artboard-web: artboard-relative Y-down, document: native Illustrator coordinates)'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
