import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import {
  coordinateSystemSchema,
  resolveCoordinateSystem,
} from '../session.js';
import { WRITE_ANNOTATIONS } from './shared.js';

const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var uuids = params.uuids;
    var alignment = params.alignment;
    var distribute = params.distribute || null;
    var reference = params.reference || "selection";

    if (!alignment && !distribute) {
      writeResultFile(RESULT_PATH, { error: true, message: "At least one of alignment or distribute must be specified" });
    } else if (!uuids || uuids.length < 2) {
      writeResultFile(RESULT_PATH, { error: true, message: "At least 2 UUIDs are required" });
    } else {
      // Collect items by UUID
      var items = [];
      for (var i = 0; i < uuids.length; i++) {
        var found = findItemByUUID(uuids[i]);
        if (found) {
          items.push(found);
        }
      }

      if (items.length < 2) {
        writeResultFile(RESULT_PATH, { error: true, message: "Could not find at least 2 objects with the given UUIDs" });
      } else {
        // Pre-cache all bounds (1回のDOM アクセスで済ませる)
        var boundsCache = [];
        for (var bi = 0; bi < items.length; bi++) {
          boundsCache.push(items[bi].geometricBounds);
        }

        // Get reference bounds
        var refLeft, refRight, refTop, refBottom;
        if (reference === "artboard") {
          var abIdx = doc.artboards.getActiveArtboardIndex();
          var abRect = getArtboardRectByIndex(abIdx);
          if (!abRect) {
            writeResultFile(RESULT_PATH, { error: true, message: "Could not resolve active artboard" });
            items = []; // alignment/distribution をスキップ
          } else {
            refLeft = abRect[0];
            refTop = abRect[1];
            refRight = abRect[2];
            refBottom = abRect[3];
          }
        } else {
          refLeft = Infinity;
          refTop = -Infinity;
          refRight = -Infinity;
          refBottom = Infinity;
          for (var si = 0; si < boundsCache.length; si++) {
            var sb = boundsCache[si];
            if (sb[0] < refLeft) refLeft = sb[0];
            if (sb[1] > refTop) refTop = sb[1];
            if (sb[2] > refRight) refRight = sb[2];
            if (sb[3] < refBottom) refBottom = sb[3];
          }
        }

        // Alignment
        if (alignment) {
          for (var ai = 0; ai < items.length; ai++) {
            var b = boundsCache[ai];
            var w = b[2] - b[0];
            var h = b[1] - b[3];

            if (alignment === "left") {
              items[ai].position = [refLeft, b[1]];
            } else if (alignment === "right") {
              items[ai].position = [refRight - w, b[1]];
            } else if (alignment === "center_h") {
              var cx = (refLeft + refRight) / 2;
              items[ai].position = [cx - w / 2, b[1]];
            } else if (alignment === "top") {
              items[ai].position = [b[0], refTop];
            } else if (alignment === "bottom") {
              items[ai].position = [b[0], refBottom + h];
            } else if (alignment === "center_v") {
              var cy = (refTop + refBottom) / 2;
              items[ai].position = [b[0], cy + h / 2];
            }
          }
        }

        // Distribution (bounds を再取得 — alignment で位置が変わっている可能性あり)
        if (distribute) {
          // 整列後の bounds を再取得
          var distBounds = [];
          for (var dbi = 0; dbi < items.length; dbi++) {
            distBounds.push(items[dbi].geometricBounds);
          }

          // ソート用のインデックス配列を構築（bounds と item の対応を維持）
          var indices = [];
          for (var ii = 0; ii < items.length; ii++) { indices.push(ii); }

          if (distribute === "horizontal") {
            indices.sort(function(a, b) { return distBounds[a][0] - distBounds[b][0]; });
            var totalWidth = 0;
            for (var di = 0; di < indices.length; di++) {
              var db = distBounds[indices[di]];
              totalWidth += (db[2] - db[0]);
            }
            var firstLeft = distBounds[indices[0]][0];
            var lastRight = distBounds[indices[indices.length - 1]][2];
            var totalSpace = (lastRight - firstLeft) - totalWidth;
            var gap = totalSpace / (indices.length - 1);
            var currentX = firstLeft;
            for (var di2 = 0; di2 < indices.length; di2++) {
              var idx = indices[di2];
              var itemW = distBounds[idx][2] - distBounds[idx][0];
              items[idx].position = [currentX, distBounds[idx][1]];
              currentX += itemW + gap;
            }
          } else if (distribute === "vertical") {
            indices.sort(function(a, b) { return distBounds[b][1] - distBounds[a][1]; });
            var totalHeight = 0;
            for (var dj = 0; dj < indices.length; dj++) {
              var dbv = distBounds[indices[dj]];
              totalHeight += (dbv[1] - dbv[3]);
            }
            var firstTop = distBounds[indices[0]][1];
            var lastBottom = distBounds[indices[indices.length - 1]][3];
            var totalSpaceV = (firstTop - lastBottom) - totalHeight;
            var gapV = totalSpaceV / (indices.length - 1);
            var currentY = firstTop;
            for (var dj2 = 0; dj2 < indices.length; dj2++) {
              var idxV = indices[dj2];
              var itemH = distBounds[idxV][1] - distBounds[idxV][3];
              items[idxV].position = [distBounds[idxV][0], currentY];
              currentY -= itemH + gapV;
            }
          }
        }

        if (items.length > 0) {
          writeResultFile(RESULT_PATH, {
            success: true,
            alignedCount: items.length,
            alignment: alignment || null,
            distribute: distribute
          });
        }
      }
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Align failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'align_objects',
    {
      title: 'Align Objects',
      description: 'Align and/or distribute multiple objects by their UUIDs',
      inputSchema: {
        uuids: z
          .array(z.string())
          .min(2)
          .describe('UUIDs of objects to align (minimum 2)'),
        alignment: z
          .enum(['left', 'center_h', 'right', 'top', 'center_v', 'bottom'])
          .optional()
          .describe('Alignment direction'),
        distribute: z
          .enum(['horizontal', 'vertical'])
          .optional()
          .describe('Distribute objects evenly'),
        reference: z
          .enum(['selection', 'artboard'])
          .optional()
          .default('selection')
          .describe('Align relative to selection bounding box or active artboard'),
        coordinate_system: coordinateSystemSchema,
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const resolvedParams = { ...params, coordinate_system: await resolveCoordinateSystem(params.coordinate_system) };
      const result = await executeJsx(jsxCode, resolvedParams);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
