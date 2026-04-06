import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeToolJsx } from '../tool-executor.js';
import { coordinateSystemSchema } from '../session.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';
/**
 * get_symbols — シンボル定義・インスタンスの取得
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/Symbols/ — Symbols collection
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/SymbolItem/ — symbol, position
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var coordSystem = (params && params.coordinate_system) ? params.coordinate_system : "artboard-web";
    var doc = app.activeDocument;

    // Build instance count map by symbol name
    var instanceCountMap = {};
    for (var i = 0; i < doc.symbolItems.length; i++) {
      var si = doc.symbolItems[i];
      try {
        var sName = si.symbol.name;
        if (instanceCountMap[sName]) {
          instanceCountMap[sName] = instanceCountMap[sName] + 1;
        } else {
          instanceCountMap[sName] = 1;
        }
      } catch (e) {}
    }

    // Symbol definitions
    var definitions = [];
    for (var d = 0; d < doc.symbols.length; d++) {
      var sym = doc.symbols[d];
      var defName = "";
      try { defName = sym.name; } catch(e) {}
      definitions.push({
        name: defName,
        instanceCount: instanceCountMap[defName] || 0
      });
    }

    // Symbol instances
    var instances = [];
    for (var k = 0; k < doc.symbolItems.length; k++) {
      var sItem = doc.symbolItems[k];
      var uuid = ensureUUID(sItem);
      var zIdx = getZIndex(sItem);
      var abIndex = getArtboardIndexForItem(sItem);
      var artboardRect = getArtboardRectByIndex(abIndex);
      var bounds = getBounds(sItem, coordSystem, artboardRect);

      var instInfo = {
        uuid: uuid,
        zIndex: zIdx,
        symbolName: "",
        artboardIndex: abIndex,
        bounds: bounds
      };

      try { instInfo.symbolName = sItem.symbol.name; } catch(e) {}
      try { instInfo.name = sItem.name || ""; } catch(e) {}

      instances.push(instInfo);
    }

    writeResultFile(RESULT_PATH, {
      definitionCount: definitions.length,
      instanceCount: instances.length,
      coordinateSystem: coordSystem,
      definitions: definitions,
      instances: instances
    });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'get_symbols',
    {
      title: 'Get Symbols',
      description: 'Get symbol definitions and instances',
      inputSchema: {
        coordinate_system: coordinateSystemSchema,
      },
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      return executeToolJsx(jsxCode, params, { resolveCoordinate: true });
    },
  );
}
