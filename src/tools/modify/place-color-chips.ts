import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsxHeavy } from '../../executor/jsx-runner.js';
import {
  coordinateSystemSchema,
  resolveCoordinateSystem,
} from '../session.js';
import { WRITE_ANNOTATIONS } from './shared.js';

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

      // Collect unique colors
      var colorMap = {};
      var colorList = [];

      function addColor(color) {
        try {
          var key = "";
          if (color.typename === "CMYKColor") {
            key = "cmyk_" + Math.round(color.cyan) + "_" + Math.round(color.magenta) + "_" + Math.round(color.yellow) + "_" + Math.round(color.black);
          } else if (color.typename === "RGBColor") {
            key = "rgb_" + Math.round(color.red) + "_" + Math.round(color.green) + "_" + Math.round(color.blue);
          } else if (color.typename === "SpotColor") {
            key = "spot_" + color.spot.name;
          } else if (color.typename === "GrayColor") {
            key = "gray_" + Math.round(color.gray);
          } else {
            return;
          }
          if (!colorMap[key]) {
            colorMap[key] = true;
            colorList.push({ color: color, key: key, info: colorToObject(color) });
          }
        } catch(e) {}
      }

      for (var i = 0; i < doc.pathItems.length; i++) {
        var item = doc.pathItems[i];
        try { if (item.filled) addColor(item.fillColor); } catch(e) {}
        try { if (item.stroked) addColor(item.strokeColor); } catch(e) {}
      }

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
        try {
          // Clone the color for the chip
          if (entry.color.typename === "CMYKColor") {
            var nc = new CMYKColor();
            nc.cyan = entry.color.cyan;
            nc.magenta = entry.color.magenta;
            nc.yellow = entry.color.yellow;
            nc.black = entry.color.black;
            rect.fillColor = nc;
          } else if (entry.color.typename === "RGBColor") {
            var nr = new RGBColor();
            nr.red = entry.color.red;
            nr.green = entry.color.green;
            nr.blue = entry.color.blue;
            rect.fillColor = nr;
          } else if (entry.color.typename === "SpotColor") {
            var ns = new SpotColor();
            ns.spot = entry.color.spot;
            ns.tint = entry.color.tint;
            rect.fillColor = ns;
          } else if (entry.color.typename === "GrayColor") {
            var ng = new GrayColor();
            ng.gray = entry.color.gray;
            rect.fillColor = ng;
          }
        } catch(e) {}
        rect.stroked = true;
        var strokeC = new GrayColor();
        strokeC.gray = 80;
        rect.strokeColor = strokeC;
        rect.strokeWidth = 0.5;

        // Add info text
        if (includeInfo) {
          var label = "";
          var info = entry.info;
          if (info.type === "cmyk") {
            label = "C" + Math.round(info.c) + " M" + Math.round(info.m) + " Y" + Math.round(info.y) + " K" + Math.round(info.k);
          } else if (info.type === "rgb") {
            label = "R" + Math.round(info.r) + " G" + Math.round(info.g) + " B" + Math.round(info.b);
          } else if (info.type === "spot") {
            label = info.name;
          } else if (info.type === "gray") {
            label = "Gray " + Math.round(info.value) + "%";
          }

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

      var verifiedChips = [];
      var chipItems = chipLayer.pageItems;
      for (var vci = 0; vci < chipItems.length && vci < 5; vci++) {
        verifiedChips.push(verifyItem(chipItems[vci]));
      }
      writeResultFile(RESULT_PATH, {
        success: true,
        chipCount: placedCount,
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
        'Extract all unique colors from the document and place color chip swatches with labels outside the artboard',
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
      const resolvedParams = { ...params, coordinate_system: await resolveCoordinateSystem(params.coordinate_system) };
      const result = await executeJsxHeavy(jsxCode, resolvedParams);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
