import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeToolJsx } from '../tool-executor.js';
import { coordinateSystemSchema } from '../session.js';
import { WRITE_ANNOTATIONS } from './shared.js';

/**
 * resize_for_variation — アートボード単位のサイズバリエーション生成
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/Artboards/ — Artboards.add()
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/PageItem/ — duplicate(), resize()
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/Document/ — selectObjectsOnActiveArtboard()
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var srcIdx = params.source_artboard_index;
    var targetSizes = params.target_sizes;
    var scaleMode = params.scale_mode || "proportional";

    if (srcIdx < 0 || srcIdx >= doc.artboards.length) {
      writeResultFile(RESULT_PATH, {
        error: true,
        message: "Source artboard index " + srcIdx + " is out of range (0-" + (doc.artboards.length - 1) + ")"
      });
    } else {
      var srcAb = doc.artboards[srcIdx];
      var srcRect = srcAb.artboardRect; // [left, top, right, bottom]
      var srcWidth = srcRect[2] - srcRect[0];
      var srcHeight = srcRect[1] - srcRect[3]; // top - bottom (AI coords: top > bottom)

      // Collect all items on source artboard
      doc.artboards.setActiveArtboardIndex(srcIdx);
      doc.selectObjectsOnActiveArtboard();
      var srcItems = doc.selection;

      if (!srcItems || srcItems.length === 0) {
        writeResultFile(RESULT_PATH, {
          error: true,
          message: "No objects found on source artboard " + srcIdx
        });
      } else {
        var createdArtboards = [];

        for (var ti = 0; ti < targetSizes.length; ti++) {
          var target = targetSizes[ti];
          // Convert mm to points if coordinate_system is artboard-web (assume points input)
          var tgtWidthPt = target.width;
          var tgtHeightPt = target.height;

          // Calculate new artboard position (place to the right of existing artboards)
          var lastAb = doc.artboards[doc.artboards.length - 1];
          var lastRect = lastAb.artboardRect;
          var offsetX = lastRect[2] + 50; // 50pt gap
          var newRect = [offsetX, lastRect[1], offsetX + tgtWidthPt, lastRect[1] - tgtHeightPt];

          // Create new artboard
          var newAb = doc.artboards.add(newRect);
          invalidateArtboardCache();
          var newAbIdx = doc.artboards.length - 1;
          if (target.name) {
            newAb.name = target.name;
          }

          // Calculate scale factor
          var scaleX = tgtWidthPt / srcWidth;
          var scaleY = tgtHeightPt / srcHeight;
          var scale = 1;
          if (scaleMode === "proportional") {
            scale = Math.min(scaleX, scaleY);
          } else if (scaleMode === "fit_width") {
            scale = scaleX;
          } else if (scaleMode === "fit_height") {
            scale = scaleY;
          }

          // Re-select source items (selection may have been lost)
          doc.artboards.setActiveArtboardIndex(srcIdx);
          doc.selectObjectsOnActiveArtboard();
          var itemsToCopy = doc.selection;

          // Duplicate and transform each item
          var duplicatedItems = [];
          for (var ii = 0; ii < itemsToCopy.length; ii++) {
            var srcItem = itemsToCopy[ii];
            var dup = srcItem.duplicate();
            duplicatedItems.push(dup);
          }

          // Move and scale duplicated items
          for (var di = 0; di < duplicatedItems.length; di++) {
            var dupItem = duplicatedItems[di];
            var origPos = duplicatedItems[di].position; // [x, y] in doc coords

            // Calculate relative position within source artboard (0-1)
            var relX = (origPos[0] - srcRect[0]) / srcWidth;
            var relY = (origPos[1] - srcRect[1]) / srcHeight; // srcRect[1] is top

            // Scale the item
            var scalePercent = scale * 100;
            dupItem.resize(scalePercent, scalePercent);

            // Position on target artboard
            var newX = newRect[0] + relX * tgtWidthPt;
            var newY = newRect[1] + relY * tgtHeightPt;
            dupItem.position = [newX, newY];
          }

          createdArtboards.push({
            artboardIndex: newAbIdx,
            name: target.name || ("Variation " + (ti + 1)),
            width: tgtWidthPt,
            height: tgtHeightPt,
            scaleFactor: Math.round(scale * 100),
            objectCount: duplicatedItems.length
          });
        }

        // Deselect
        doc.selection = null;

        // Verify created artboards
        var verifiedArtboards = [];
        for (var vai = 0; vai < createdArtboards.length; vai++) {
          verifiedArtboards.push(verifyArtboardContents(createdArtboards[vai].artboardIndex));
        }

        writeResultFile(RESULT_PATH, {
          success: true,
          coordinateSystem: params.coordinate_system || "artboard-web",
          sourceArtboard: srcIdx,
          createdCount: createdArtboards.length,
          artboards: createdArtboards,
          verified: verifiedArtboards
        });
      }
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Resize for variation failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'resize_for_variation',
    {
      title: 'Resize for Variation',
      description:
        'Create size variations from a source artboard. Duplicates all objects and scales/repositions them proportionally to fit target sizes. Limitations: no text reflow, effects/strokes scale with objects but may need manual adjustment, proportional placement only (not smart layout).',
      inputSchema: {
        source_artboard_index: z
          .number()
          .int()
          .min(0)
          .describe('Source artboard index to duplicate from (0-based)'),
        target_sizes: z
          .array(
            z.object({
              width: z.number().describe('Target width in points'),
              height: z.number().describe('Target height in points'),
              name: z.string().optional().describe('Artboard name for this variation'),
            }),
          )
          .min(1)
          .max(10)
          .describe('Target sizes for variations'),
        scale_mode: z
          .enum(['proportional', 'fit_width', 'fit_height'])
          .optional()
          .default('proportional')
          .describe('How to scale objects: proportional (fit within, maintain aspect), fit_width, or fit_height'),
        coordinate_system: coordinateSystemSchema,
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      return executeToolJsx(jsxCode, params, { heavy: true, resolveCoordinate: true });
    },
  );
}
