import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeToolJsx } from '../tool-executor.js';
import { coordinateSystemSchema } from '../session.js';
import { WRITE_ANNOTATIONS } from './shared.js';

/**
 * place_symbol — シンボルインスタンスの配置・シンボル定義の差し替え
 *
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/SymbolItems/ — SymbolItems.add(), SymbolItem.symbol
 *
 * JSX API:
 *   Document.symbolItems.add(symbol: Symbol) → SymbolItem
 *   Document.symbols.getByName(name: String) → Symbol
 *   SymbolItem.position → [x, y] (writable)
 *   SymbolItem.symbol → Symbol (writable — 差し替え可能)
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var coordSystem = params.coordinate_system || "artboard-web";
    var abRect = (coordSystem === "artboard-web") ? getActiveArtboardRect() : null;

    if (params.action === "place") {
      var sym = null;
      try {
        sym = doc.symbols.getByName(params.symbol_name);
      } catch(e) {
        writeResultFile(RESULT_PATH, { error: true, message: "Symbol not found: " + params.symbol_name });
      }
      if (sym) {
        var si = doc.symbolItems.add(sym);
        if (typeof params.x === "number" && typeof params.y === "number") {
          si.position = webToAiPoint(params.x, params.y, coordSystem, abRect);
        }
        var uuid = ensureUUID(si);
        writeResultFile(RESULT_PATH, { success: true, uuid: uuid, symbolName: params.symbol_name, coordinateSystem: coordSystem, verified: verifyItem(si, coordSystem, abRect) });
      }
    } else if (params.action === "replace") {
      if (!params.uuid) {
        writeResultFile(RESULT_PATH, { error: true, message: "uuid is required for replace action" });
      } else {
        var item = findItemByUUID(params.uuid);
        if (!item || item.typename !== "SymbolItem") {
          writeResultFile(RESULT_PATH, { error: true, message: "Symbol item not found: " + params.uuid });
        } else {
          var newSym = null;
          try {
            newSym = doc.symbols.getByName(params.symbol_name);
          } catch(e) {
            writeResultFile(RESULT_PATH, { error: true, message: "Symbol not found: " + params.symbol_name });
          }
          if (newSym) {
            item.symbol = newSym;
            writeResultFile(RESULT_PATH, { success: true, uuid: params.uuid, newSymbolName: params.symbol_name, coordinateSystem: coordSystem, verified: verifyItem(item, coordSystem, abRect) });
          }
        }
      }
    } else {
      writeResultFile(RESULT_PATH, { error: true, message: "Unknown action: " + params.action });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "place_symbol failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'place_symbol',
    {
      title: 'Place Symbol',
      description:
        'Place a new symbol instance or replace the symbol definition of an existing instance. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        action: z
          .enum(['place', 'replace'])
          .describe('place = new instance, replace = swap symbol definition'),
        symbol_name: z
          .string()
          .describe('Symbol name to place or new symbol name for replace'),
        x: z.number().optional().describe('X of the instance top-left (for place action)'),
        y: z.number().optional().describe('Y of the instance top-left (for place action)'),
        uuid: z
          .string()
          .optional()
          .describe('UUID of existing symbol item (for replace action)'),
        coordinate_system: coordinateSystemSchema,
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      return executeToolJsx(jsxCode, params, { activate: true, resolveCoordinate: true });
    },
  );
}
