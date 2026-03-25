import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeJsx } from '../../executor/jsx-runner.js';

const jsxCode = `
try {
  var err = preflightChecks();
  if (err) {
    writeResultFile(RESULT_PATH, err);
  } else {
    var doc = app.activeDocument;

    function getParentLayerName(item) {
      var current = item.parent;
      while (current) {
        if (current.typename === "Layer") return current.name;
        current = current.parent;
      }
      return "";
    }

    function collectOverprintItems(container, results) {
      for (var i = 0; i < container.pageItems.length; i++) {
        var item = container.pageItems[i];
        try {
          if (item.typename === "GroupItem") {
            collectOverprintItems(item, results);
          } else if (item.typename === "PathItem") {
            var fillOP = false;
            var strokeOP = false;
            try { fillOP = item.fillOverprint; } catch(e2) {}
            try { strokeOP = item.strokeOverprint; } catch(e2) {}
            if (fillOP || strokeOP) {
              var uuid = ensureUUID(item);
              var objName = "";
              try { objName = item.name || ""; } catch(e2) {}
              results.push({
                uuid: uuid,
                objectName: objName,
                fillOverprint: fillOP,
                strokeOverprint: strokeOP,
                layerName: getParentLayerName(item)
              });
            }
          } else if (item.typename === "CompoundPathItem") {
            for (var j = 0; j < item.pathItems.length; j++) {
              var pathItem = item.pathItems[j];
              var fillOP2 = false;
              var strokeOP2 = false;
              try { fillOP2 = pathItem.fillOverprint; } catch(e2) {}
              try { strokeOP2 = pathItem.strokeOverprint; } catch(e2) {}
              if (fillOP2 || strokeOP2) {
                var uuid2 = ensureUUID(pathItem);
                var objName2 = "";
                try { objName2 = pathItem.name || ""; } catch(e2) {}
                results.push({
                  uuid: uuid2,
                  objectName: objName2,
                  fillOverprint: fillOP2,
                  strokeOverprint: strokeOP2,
                  layerName: getParentLayerName(item)
                });
              }
            }
          }
        } catch(e) {}
      }
    }

    var results = [];

    for (var layerIdx = 0; layerIdx < doc.layers.length; layerIdx++) {
      collectOverprintItems(doc.layers[layerIdx], results);
    }

    writeResultFile(RESULT_PATH, {
      overprintCount: results.length,
      items: results
    });
  }
} catch (e) {
  writeResultFile(RESULT_PATH, { error: true, message: e.message, line: e.line });
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'get_overprint_info',
    {
      title: 'Get Overprint Info',
      description: 'Get overprint settings',
      inputSchema: {},
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
