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
              var fillColorObj = null;
              var strokeColorObj = null;
              var isK100 = false;
              var isRichBlack = false;
              var inkCoverage = 0;
              var intent = "unknown";
              try {
                if (item.filled) {
                  fillColorObj = colorToObject(item.fillColor);
                  if (item.fillColor.typename === "CMYKColor") {
                    var fc = item.fillColor;
                    inkCoverage = fc.cyan + fc.magenta + fc.yellow + fc.black;
                    if (fc.black === 100 && fc.cyan === 0 && fc.magenta === 0 && fc.yellow === 0) {
                      isK100 = true;
                    }
                    if (fc.black >= 90 && (fc.cyan > 0 || fc.magenta > 0 || fc.yellow > 0)) {
                      isRichBlack = true;
                    }
                  }
                }
              } catch(e3) {}
              try {
                if (item.stroked) {
                  strokeColorObj = colorToObject(item.strokeColor);
                }
              } catch(e3) {}
              if (fillOP && isK100) {
                intent = "intentional_k100";
              } else if (fillOP && isRichBlack) {
                intent = "rich_black_overprint";
              } else if (fillOP || strokeOP) {
                intent = "likely_accidental";
              }
              results.push({
                uuid: uuid,
                objectName: objName,
                fillOverprint: fillOP,
                strokeOverprint: strokeOP,
                layerName: getParentLayerName(item),
                fillColor: fillColorObj,
                strokeColor: strokeColorObj,
                isK100: isK100,
                isRichBlack: isRichBlack,
                inkCoverage: inkCoverage,
                intent: intent
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
                var fillColorObj2 = null;
                var strokeColorObj2 = null;
                var isK100_2 = false;
                var isRichBlack2 = false;
                var inkCoverage2 = 0;
                var intent2 = "unknown";
                try {
                  if (pathItem.filled) {
                    fillColorObj2 = colorToObject(pathItem.fillColor);
                    if (pathItem.fillColor.typename === "CMYKColor") {
                      var fc2 = pathItem.fillColor;
                      inkCoverage2 = fc2.cyan + fc2.magenta + fc2.yellow + fc2.black;
                      if (fc2.black === 100 && fc2.cyan === 0 && fc2.magenta === 0 && fc2.yellow === 0) {
                        isK100_2 = true;
                      }
                      if (fc2.black >= 90 && (fc2.cyan > 0 || fc2.magenta > 0 || fc2.yellow > 0)) {
                        isRichBlack2 = true;
                      }
                    }
                  }
                } catch(e3) {}
                try {
                  if (pathItem.stroked) {
                    strokeColorObj2 = colorToObject(pathItem.strokeColor);
                  }
                } catch(e3) {}
                if (fillOP2 && isK100_2) {
                  intent2 = "intentional_k100";
                } else if (fillOP2 && isRichBlack2) {
                  intent2 = "rich_black_overprint";
                } else if (fillOP2 || strokeOP2) {
                  intent2 = "likely_accidental";
                }
                results.push({
                  uuid: uuid2,
                  objectName: objName2,
                  fillOverprint: fillOP2,
                  strokeOverprint: strokeOP2,
                  layerName: getParentLayerName(pathItem),
                  fillColor: fillColorObj2,
                  strokeColor: strokeColorObj2,
                  isK100: isK100_2,
                  isRichBlack: isRichBlack2,
                  inkCoverage: inkCoverage2,
                  intent: intent2
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
      description: 'Get overprint settings with K100/rich black detection and intent classification',
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
