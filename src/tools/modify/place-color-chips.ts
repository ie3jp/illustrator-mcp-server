import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeToolJsx } from '../tool-executor.js';
import { coordinateSystemSchema } from '../session.js';
import { DOCUMENT_COLORS_JSX, WRITE_ANNOTATIONS } from './shared.js';

/**
 * place_color_chips — ドキュメント使用色のカラーチップ配置
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/PathItems/ — PathItems.rectangle()
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/TextFrameItems/ — TextFrameItems.add()
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    ${DOCUMENT_COLORS_JSX}
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var abIdx = (typeof params.artboard_index === "number") ? params.artboard_index : doc.artboards.getActiveArtboardIndex();
    var chipSize = (typeof params.chip_size === "number") ? params.chip_size : 30;
    var position = params.position || "right";
    var includeInfo = (typeof params.include_info === "boolean") ? params.include_info : true;
    var layerName = params.layer_name || "Color Chips";
    var isCMYKDoc = (doc.documentColorSpace === DocumentColorSpace.CMYK);

    if (abIdx < 0 || abIdx >= doc.artboards.length) {
      writeResultFile(RESULT_PATH, { error: true, message: "Artboard index out of range" });
    } else {
      var abRect = doc.artboards[abIdx].artboardRect;

      // Collect unique colors（パス・テキスト・グラデーション分岐。チップ用レイヤー自身は除外）
      var colorScan = collectDocumentColors(doc, [layerName]);
      var colorList = colorScan.list;

      // Get or create layer
      var chipLayer = resolveTargetLayer(doc, layerName);

      // Calculate start position
      var startX, startY;
      var gap = 8;
      if (position === "right") {
        startX = abRect[2] + 30; // 30pt right of artboard
        startY = abRect[1]; // top of artboard
      } else {
        startX = abRect[0]; // left of artboard
        startY = abRect[3] - 30; // 30pt below artboard
      }

      var placedCount = 0;
      for (var ci = 0; ci < colorList.length; ci++) {
        var entry = colorList[ci];
        var chipX, chipY;
        if (position === "right") {
          chipX = startX;
          chipY = startY - ci * (chipSize + gap);
        } else {
          chipX = startX + ci * (chipSize + gap + (includeInfo ? 80 : 0));
          chipY = startY;
        }

        // Create color chip rectangle
        var rect = chipLayer.pathItems.rectangle(chipY, chipX, chipSize, chipSize);
        try { rect.fillColor = entry.color; } catch(e) {}
        rect.stroked = true;
        var strokeC = new GrayColor();
        strokeC.gray = 80;
        rect.strokeColor = strokeC;
        rect.strokeWidth = 0.5;

        // Add info text
        if (includeInfo) {
          var label = docColorLabel(entry.info);

          if (label) {
            var textX, textY;
            if (position === "right") {
              textX = chipX + chipSize + 6;
              textY = chipY - 2;
            } else {
              textX = chipX;
              textY = chipY - chipSize - 4;
            }
            var textFrame = chipLayer.textFrames.add();
            textFrame.contents = label.split(String.fromCharCode(10)).join(String.fromCharCode(13));
            textFrame.position = [textX, textY];
            try {
              textFrame.textRange.characterAttributes.size = 7;
              // Set text to black/dark
              if (isCMYKDoc) {
                var tc = new CMYKColor();
                tc.cyan = 0; tc.magenta = 0; tc.yellow = 0; tc.black = 100;
                textFrame.textRange.characterAttributes.fillColor = tc;
              } else {
                var trgb = new RGBColor();
                trgb.red = 0; trgb.green = 0; trgb.blue = 0;
                textFrame.textRange.characterAttributes.fillColor = trgb;
              }
            } catch(e) {}
          }
        }

        placedCount++;
      }

      var coordSystem = params.coordinate_system || "artboard-web";
      var verifyAbRect = (coordSystem === "artboard-web") ? abRect : null;
      var verifiedChips = [];
      var chipItems = chipLayer.pageItems;
      for (var vci = 0; vci < chipItems.length && vci < 5; vci++) {
        verifiedChips.push(verifyItem(chipItems[vci], coordSystem, verifyAbRect));
      }
      writeResultFile(RESULT_PATH, {
        success: true,
        coordinateSystem: coordSystem,
        chipCount: placedCount,
        skippedColors: colorScan.skipped,
        layerName: layerName,
        position: position,
        verified: verifiedChips
      });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Place color chips failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'place_color_chips',
    {
      title: 'Place Color Chips',
      description:
        'Extract all unique colors used in the document (path fills/strokes including inside groups and compound paths, text colors, gradient stop colors; spot colors per tint) and place color chip swatches with labels outside the artboard. Pattern fills cannot be shown as chips and are counted in skippedColors. Items already on the chip layer are ignored.',
      inputSchema: {
        artboard_index: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Target artboard (default: active artboard)'),
        chip_size: z
          .number()
          .optional()
          .default(30)
          .describe('Chip size in points (default: 30)'),
        position: z
          .enum(['right', 'bottom'])
          .optional()
          .default('right')
          .describe('Place chips to the right or below the artboard'),
        include_info: z
          .boolean()
          .optional()
          .default(true)
          .describe('Include color value labels next to chips'),
        layer_name: z
          .string()
          .optional()
          .default('Color Chips')
          .describe('Layer name for color chips'),
        coordinate_system: coordinateSystemSchema,
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      return executeToolJsx(jsxCode, params, { heavy: true, resolveCoordinate: true });
    },
  );
}
