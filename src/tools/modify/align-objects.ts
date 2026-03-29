import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import {
  coordinateSystemSchema,
  resolveCoordinateSystem,
} from '../session.js';

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

    if (!uuids || uuids.length < 2) {
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
        // Get reference bounds
        var refLeft, refRight, refTop, refBottom;
        if (reference === "artboard") {
          var abIdx = doc.artboards.getActiveArtboardIndex();
          var abRect = doc.artboards[abIdx].artboardRect;
          refLeft = abRect[0];
          refTop = abRect[1];
          refRight = abRect[2];
          refBottom = abRect[3];
        } else {
          // "selection" — use bounding box of all items
          refLeft = Infinity;
          refTop = -Infinity;
          refRight = -Infinity;
          refBottom = Infinity;
          for (var si = 0; si < items.length; si++) {
            var sb = items[si].geometricBounds;
            if (sb[0] < refLeft) refLeft = sb[0];
            if (sb[1] > refTop) refTop = sb[1];
            if (sb[2] > refRight) refRight = sb[2];
            if (sb[3] < refBottom) refBottom = sb[3];
          }
        }

        // Alignment
        if (alignment) {
          for (var ai = 0; ai < items.length; ai++) {
            var item = items[ai];
            var b = item.geometricBounds;
            var w = b[2] - b[0];
            var h = b[1] - b[3];

            if (alignment === "left") {
              item.position = [refLeft, b[1]];
            } else if (alignment === "right") {
              item.position = [refRight - w, b[1]];
            } else if (alignment === "center_h") {
              var cx = (refLeft + refRight) / 2;
              item.position = [cx - w / 2, b[1]];
            } else if (alignment === "top") {
              item.position = [b[0], refTop];
            } else if (alignment === "bottom") {
              item.position = [b[0], refBottom + h];
            } else if (alignment === "center_v") {
              var cy = (refTop + refBottom) / 2;
              item.position = [b[0], cy + h / 2];
            }
          }
        }

        // Distribution
        if (distribute) {
          // Sort items by position
          var sorted = items.slice();
          if (distribute === "horizontal") {
            sorted.sort(function(a, b) { return a.geometricBounds[0] - b.geometricBounds[0]; });
            // Calculate total item widths
            var totalWidth = 0;
            for (var di = 0; di < sorted.length; di++) {
              var db = sorted[di].geometricBounds;
              totalWidth += (db[2] - db[0]);
            }
            var firstLeft = sorted[0].geometricBounds[0];
            var lastRight = sorted[sorted.length - 1].geometricBounds[2];
            var totalSpace = (lastRight - firstLeft) - totalWidth;
            var gap = totalSpace / (sorted.length - 1);
            var currentX = firstLeft;
            for (var di2 = 0; di2 < sorted.length; di2++) {
              var db2 = sorted[di2].geometricBounds;
              var itemW = db2[2] - db2[0];
              sorted[di2].position = [currentX, db2[1]];
              currentX += itemW + gap;
            }
          } else if (distribute === "vertical") {
            sorted.sort(function(a, b) { return b.geometricBounds[1] - a.geometricBounds[1]; }); // top to bottom
            var totalHeight = 0;
            for (var dj = 0; dj < sorted.length; dj++) {
              var dbv = sorted[dj].geometricBounds;
              totalHeight += (dbv[1] - dbv[3]);
            }
            var firstTop = sorted[0].geometricBounds[1];
            var lastBottom = sorted[sorted.length - 1].geometricBounds[3];
            var totalSpaceV = (firstTop - lastBottom) - totalHeight;
            var gapV = totalSpaceV / (sorted.length - 1);
            var currentY = firstTop;
            for (var dj2 = 0; dj2 < sorted.length; dj2++) {
              var dbv2 = sorted[dj2].geometricBounds;
              var itemH = dbv2[1] - dbv2[3];
              sorted[dj2].position = [dbv2[0], currentY];
              currentY -= itemH + gapV;
            }
          }
        }

        writeResultFile(RESULT_PATH, {
          success: true,
          alignedCount: items.length,
          alignment: alignment || null,
          distribute: distribute
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
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      const resolvedParams = { ...params, coordinate_system: await resolveCoordinateSystem(params.coordinate_system) };
      const result = await executeJsx(jsxCode, resolvedParams);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
