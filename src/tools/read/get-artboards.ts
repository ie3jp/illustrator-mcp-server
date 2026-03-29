import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import {
  coordinateSystemSchema,
  resolveCoordinateSystem,
} from '../session.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';

const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var coordSystem = params.coordinate_system || "artboard-web";
    var artboards = [];

    var startIdx = 0;
    var endIdx = doc.artboards.length;

    var hasError = false;
    if (typeof params.index === "number") {
      if (params.index < 0 || params.index >= doc.artboards.length) {
        writeResultFile(RESULT_PATH, {
          error: true,
          message: "Artboard index " + params.index + " is out of range (0-" + (doc.artboards.length - 1) + ")"
        });
        hasError = true;
      } else {
        startIdx = params.index;
        endIdx = params.index + 1;
      }
    }

    if (!hasError) {
    for (var i = startIdx; i < endIdx; i++) {
      var ab = doc.artboards[i];
      var rect = ab.artboardRect; // [left, top, right, bottom]
      var w = rect[2] - rect[0];
      var h = rect[1] - rect[3]; // top - bottom (Illustrator座標では top > bottom)

      var info = {
        index: i,
        name: ab.name,
        position: {},
        size: { width: w, height: h },
        orientation: w > h ? "landscape" : "portrait"
      };

      if (coordSystem === "artboard-web") {
        info.position = { x: rect[0], y: -rect[1] };
      } else {
        info.position = { x: rect[0], y: rect[1] };
      }

      artboards.push(info);
    }

    writeResultFile(RESULT_PATH, { artboards: artboards });
    } // end if (!hasError)
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Failed to get artboard info: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'get_artboards',
    {
      title: 'Get Artboards',
      description: 'Get all artboard information',
      inputSchema: {
        index: z.number().int().min(0).optional().describe('Get a specific artboard by index (0-based integer)'),
        coordinate_system: coordinateSystemSchema,
      },
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      const resolvedParams = { ...params, coordinate_system: await resolveCoordinateSystem(params.coordinate_system) };
      const result = await executeJsx(jsxCode, resolvedParams);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
