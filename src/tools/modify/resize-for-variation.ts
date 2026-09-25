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
// 複製直後のアイテムと、グループ・複合パス内の子孫が継承した UUID を振り直す
// （duplicate() は note を継承するため、放置すると UUID が重複する）
function reassignDuplicatedUUIDs(dup) {
  var list = [dup];
  if (dup.typename === "GroupItem") {
    iterateAllItems(dup, function(child) { list.push(child); });
  } else if (dup.typename === "CompoundPathItem") {
    for (var cp = 0; cp < dup.pathItems.length; cp++) list.push(dup.pathItems[cp]);
  }
  for (var li = 0; li < list.length; li++) {
    var n = "";
    try { n = list[li].note || ""; } catch(e) {}
    if (extractUUIDFromNote(n)) reassignUUID(list[li]);
  }
}
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  var doc = null;
  var savedActiveAbIdx = -1;
  var savedSelection = null;
  try {
    var params = readParamsFile(PARAMS_PATH);
    doc = app.activeDocument;
    // 作業中にアクティブアートボードと選択を書き換えるため、元の状態を控えて finally で戻す
    savedActiveAbIdx = doc.artboards.getActiveArtboardIndex();
    savedSelection = [];
    var curSel = doc.selection;
    if (curSel && curSel.length) {
      for (var si = 0; si < curSel.length; si++) savedSelection.push(curSel[si]);
    }
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
      // 複製元を配列に控える（以降の複製で選択が変わっても参照が残る）
      var srcItems = [];
      var srcSel = doc.selection;
      if (srcSel && srcSel.length) {
        for (var ssi = 0; ssi < srcSel.length; ssi++) srcItems.push(srcSel[ssi]);
      }

      if (srcItems.length === 0) {
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

          // 新規アートボードは全アートボードの右端より右に置く
          // （コレクション末尾が空間的な右端とは限らないため、末尾基準だと既存と重なる）
          var maxRight = srcRect[2];
          for (var ai = 0; ai < doc.artboards.length; ai++) {
            var abR = doc.artboards[ai].artboardRect;
            if (abR[2] > maxRight) maxRight = abR[2];
          }
          var offsetX = maxRight + 50; // 50pt gap
          var newRect = [offsetX, srcRect[1], offsetX + tgtWidthPt, srcRect[1] - tgtHeightPt];

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

          // Duplicate and transform each item
          var duplicatedItems = [];
          for (var ii = 0; ii < srcItems.length; ii++) {
            var dup = srcItems[ii].duplicate();
            reassignDuplicatedUUIDs(dup);
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
  } finally {
    if (doc) {
      try { if (savedActiveAbIdx >= 0) doc.artboards.setActiveArtboardIndex(savedActiveAbIdx); } catch(eAb) {}
      try { doc.selection = (savedSelection && savedSelection.length > 0) ? savedSelection : null; } catch(eSel) {}
    }
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'resize_for_variation',
    {
      title: 'Resize for Variation',
      description:
        'Create size variations from a source artboard. Duplicates all objects and scales/repositions them proportionally to fit target sizes. New artboards are placed to the right of all existing artboards; copies get new UUIDs. Limitations: no text reflow, effects/strokes scale with objects but may need manual adjustment, proportional placement only (not smart layout).',
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
