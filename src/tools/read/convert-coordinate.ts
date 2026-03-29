import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';

/**
 * convert_coordinate — 座標系間の座標変換
 *
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/Document/ — Document.convertCoordinate()
 *
 * JSX API:
 *   Document.convertCoordinate(coordinate: Point, source: CoordinateSystem, destination: CoordinateSystem)
 *   CoordinateSystem: ARTBOARDCOORDINATESYSTEM | DOCUMENTCOORDINATESYSTEM
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;

    var fromMap = {
      "artboard": CoordinateSystem.ARTBOARDCOORDINATESYSTEM,
      "document": CoordinateSystem.DOCUMENTCOORDINATESYSTEM
    };
    var toMap = {
      "artboard": CoordinateSystem.ARTBOARDCOORDINATESYSTEM,
      "document": CoordinateSystem.DOCUMENTCOORDINATESYSTEM
    };

    var fromSys = fromMap[params.from];
    var toSys = toMap[params.to];

    if (fromSys == null || toSys == null) {
      writeResultFile(RESULT_PATH, { error: true, message: "Invalid coordinate system. Use 'artboard' or 'document'." });
    } else {
      var result = doc.convertCoordinate([params.point.x, params.point.y], fromSys, toSys);
      writeResultFile(RESULT_PATH, {
        x: result[0],
        y: result[1],
        from: params.from,
        to: params.to
      });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "convert_coordinate failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'convert_coordinate',
    {
      title: 'Convert Coordinate',
      description:
        'Convert a point between artboard and document coordinate systems in the active document.',
      inputSchema: {
        point: z
          .object({
            x: z.number().describe('X value'),
            y: z.number().describe('Y value'),
          })
          .describe('Point to convert'),
        from: z
          .enum(['artboard', 'document'])
          .describe('Source coordinate system'),
        to: z
          .enum(['artboard', 'document'])
          .describe('Destination coordinate system'),
      },
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
