import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeJsx } from '../../executor/jsx-runner.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';

const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var doc = app.activeDocument;

    function analyzeOverprintPath(pathItem, results) {
      var fillOP = false;
      var strokeOP = false;
      try { fillOP = pathItem.fillOverprint; } catch(e) {}
      try { strokeOP = pathItem.strokeOverprint; } catch(e) {}
      if (!fillOP && !strokeOP) return;

      var uuid = ensureUUID(pathItem);
      var objName = "";
      try { objName = pathItem.name || ""; } catch(e) {}
      var fillColorObj = null;
      var strokeColorObj = null;
      var isK100 = false;
      var isRichBlack = false;
      var inkCoverage = 0;
      var intent = "unknown";
      try {
        if (pathItem.filled) {
          fillColorObj = colorToObject(pathItem.fillColor);
          if (pathItem.fillColor.typename === "CMYKColor") {
            var fc = pathItem.fillColor;
            inkCoverage = fc.cyan + fc.magenta + fc.yellow + fc.black;
            if (fc.black === 100 && fc.cyan === 0 && fc.magenta === 0 && fc.yellow === 0) {
              isK100 = true;
            }
            if (fc.black >= 90 && (fc.cyan > 0 || fc.magenta > 0 || fc.yellow > 0)) {
              isRichBlack = true;
            }
          }
        }
      } catch(e) {}
      try {
        if (pathItem.stroked) {
          strokeColorObj = colorToObject(pathItem.strokeColor);
        }
      } catch(e) {}
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
        layerName: getParentLayerName(pathItem),
        fillColor: fillColorObj,
        strokeColor: strokeColorObj,
        isK100: isK100,
        isRichBlack: isRichBlack,
        inkCoverage: inkCoverage,
        intent: intent
      });
    }

    function collectOverprintItems(container, results) {
      for (var i = 0; i < container.pageItems.length; i++) {
        var item = container.pageItems[i];
        try {
          if (item.typename === "GroupItem") {
            collectOverprintItems(item, results);
          } else if (item.typename === "PathItem") {
            analyzeOverprintPath(item, results);
          } else if (item.typename === "CompoundPathItem") {
            for (var j = 0; j < item.pathItems.length; j++) {
              analyzeOverprintPath(item.pathItems[j], results);
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
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'get_overprint_info',
    {
      title: 'Get Overprint Info',
      description: 'Get overprint settings with K100/rich black detection and intent classification',
      inputSchema: {},
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
