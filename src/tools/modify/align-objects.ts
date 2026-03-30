import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
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
    var alignment = params.alignment || null;
    var distribute = params.distribute || null;
    var reference = params.reference || "selection";

    if (!alignment && !distribute) {
      writeResultFile(RESULT_PATH, { error: true, message: "At least one of alignment or distribute must be specified" });
    } else if (!uuids || uuids.length < 2) {
      writeResultFile(RESULT_PATH, { error: true, message: "At least 2 UUIDs are required" });
    } else {
      var items = [];
      for (var i = 0; i < uuids.length; i++) {
        var found = findItemByUUID(uuids[i]);
        if (found) items.push(found);
      }

      if (items.length < 2) {
        writeResultFile(RESULT_PATH, { error: true, message: "Could not find at least 2 objects with the given UUIDs" });
      } else {
        // Cache bounds: geometricBounds = [top, left, bottom, right]
        var boundsCache = [];
        for (var bi = 0; bi < items.length; bi++) {
          boundsCache.push(items[bi].geometricBounds);
        }

        // Reference bounding box
        var refTop, refLeft, refBottom, refRight;
        if (reference === "page") {
          var pg = doc.pages[0];
          try {
            var pgBounds = pg.bounds; // [top, left, bottom, right]
            refTop    = pgBounds[0];
            refLeft   = pgBounds[1];
            refBottom = pgBounds[2];
            refRight  = pgBounds[3];
          } catch(e2) {
            refTop = 0; refLeft = 0;
            refBottom = doc.documentPreferences.pageHeight;
            refRight  = doc.documentPreferences.pageWidth;
          }
        } else {
          // selection bounding box
          refTop    =  Infinity;
          refLeft   =  Infinity;
          refBottom = -Infinity;
          refRight  = -Infinity;
          for (var si = 0; si < boundsCache.length; si++) {
            var sb = boundsCache[si];
            if (sb[0] < refTop)    refTop    = sb[0];
            if (sb[1] < refLeft)   refLeft   = sb[1];
            if (sb[2] > refBottom) refBottom = sb[2];
            if (sb[3] > refRight)  refRight  = sb[3];
          }
        }

        // Alignment
        if (alignment) {
          for (var ai = 0; ai < items.length; ai++) {
            var b = boundsCache[ai];
            var w = b[3] - b[1];
            var h = b[2] - b[0];

            if (alignment === "left") {
              items[ai].geometricBounds = [b[0], refLeft, b[0] + h, refLeft + w];
            } else if (alignment === "right") {
              items[ai].geometricBounds = [b[0], refRight - w, b[0] + h, refRight];
            } else if (alignment === "center_h") {
              var cx = (refLeft + refRight) / 2;
              items[ai].geometricBounds = [b[0], cx - w / 2, b[0] + h, cx + w / 2];
            } else if (alignment === "top") {
              items[ai].geometricBounds = [refTop, b[1], refTop + h, b[1] + w];
            } else if (alignment === "bottom") {
              items[ai].geometricBounds = [refBottom - h, b[1], refBottom, b[1] + w];
            } else if (alignment === "center_v") {
              var cy = (refTop + refBottom) / 2;
              items[ai].geometricBounds = [cy - h / 2, b[1], cy + h / 2, b[1] + w];
            }
          }
        }

        // Distribution
        if (distribute) {
          var distBounds = [];
          for (var dbi = 0; dbi < items.length; dbi++) {
            distBounds.push(items[dbi].geometricBounds);
          }
          var indices = [];
          for (var ii = 0; ii < items.length; ii++) { indices.push(ii); }

          if (distribute === "horizontal") {
            indices.sort(function(a, b) { return distBounds[a][1] - distBounds[b][1]; });
            var totalWidth = 0;
            for (var di = 0; di < indices.length; di++) {
              var db = distBounds[indices[di]];
              totalWidth += (db[3] - db[1]);
            }
            var firstLeft2 = distBounds[indices[0]][1];
            var lastRight2 = distBounds[indices[indices.length - 1]][3];
            var totalSpace = (lastRight2 - firstLeft2) - totalWidth;
            var gap = (indices.length > 1) ? (totalSpace / (indices.length - 1)) : 0;
            var currentX = firstLeft2;
            for (var di2 = 0; di2 < indices.length; di2++) {
              var idx = indices[di2];
              var db2 = distBounds[idx];
              var iw = db2[3] - db2[1];
              var ih = db2[2] - db2[0];
              items[idx].geometricBounds = [db2[0], currentX, db2[0] + ih, currentX + iw];
              currentX += iw + gap;
            }
          } else if (distribute === "vertical") {
            indices.sort(function(a, b) { return distBounds[a][0] - distBounds[b][0]; });
            var totalHeight = 0;
            for (var dj = 0; dj < indices.length; dj++) {
              var dbv = distBounds[indices[dj]];
              totalHeight += (dbv[2] - dbv[0]);
            }
            var firstTop2 = distBounds[indices[0]][0];
            var lastBottom2 = distBounds[indices[indices.length - 1]][2];
            var totalSpaceV = (lastBottom2 - firstTop2) - totalHeight;
            var gapV = (indices.length > 1) ? (totalSpaceV / (indices.length - 1)) : 0;
            var currentY = firstTop2;
            for (var dj2 = 0; dj2 < indices.length; dj2++) {
              var idxV = indices[dj2];
              var dbv2 = distBounds[idxV];
              var ivw = dbv2[3] - dbv2[1];
              var ivh = dbv2[2] - dbv2[0];
              items[idxV].geometricBounds = [currentY, dbv2[1], currentY + ivh, dbv2[1] + ivw];
              currentY += ivh + gapV;
            }
          }
        }

        var verifiedItems = [];
        for (var vi = 0; vi < items.length; vi++) {
          verifiedItems.push(verifyItem(items[vi]));
        }
        writeResultFile(RESULT_PATH, {
          success: true,
          alignedCount: items.length,
          alignment: alignment,
          distribute: distribute,
          verified: verifiedItems
        });
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
      description: 'Align and/or distribute multiple InDesign page items by their UUIDs.',
      inputSchema: {
        uuids: z.array(z.string()).min(2).describe('UUIDs of objects to align (minimum 2)'),
        alignment: z
          .enum(['left', 'center_h', 'right', 'top', 'center_v', 'bottom'])
          .optional()
          .describe('Alignment direction'),
        distribute: z
          .enum(['horizontal', 'vertical'])
          .optional()
          .describe('Distribute objects evenly'),
        reference: z
          .enum(['selection', 'page'])
          .optional()
          .default('selection')
          .describe('Align relative to selection bounding box or page bounds'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
