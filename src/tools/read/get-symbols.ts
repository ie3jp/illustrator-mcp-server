import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';

const jsxCode = `
try {
  var err = preflightChecks();
  if (err) {
    writeResultFile(RESULT_PATH, err);
  } else {
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
      var artboardRect = null;
      if (abIndex >= 0) {
        artboardRect = doc.artboards[abIndex].artboardRect;
      }
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
  }
} catch (e) {
  writeResultFile(RESULT_PATH, { error: true, message: e.message, line: e.line });
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'get_symbols',
    {
      title: 'Get Symbols',
      description: 'Get symbol definitions and instances',
      inputSchema: {
        coordinate_system: z
          .enum(['artboard-web', 'document'])
          .optional()
          .default('artboard-web'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
