import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { coordinateSystemSchema } from '../session.js';
import { executeToolJsx } from '../tool-executor.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';
/**
 * get_selection — 現在の選択オブジェクト情報の取得
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/Document/ — Document.selection
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
    var sel = doc.selection;

    if (!sel || sel.length === 0) {
      writeResultFile(RESULT_PATH, { selectionCount: 0, items: [] });
    } else {
      var items = [];

      for (var i = 0; i < sel.length; i++) {
        var item = sel[i];
        var uuid = ensureUUID(item);
        var zIdx = getZIndex(item);
        var itemType = getItemType(item);

        // artboard detection for coordinate conversion
        var abIndex = getArtboardIndexForItem(item);
        var artboardRect = getArtboardRectByIndex(abIndex);

        var bounds = getBounds(item, coordSystem, artboardRect);

        var info = {
          uuid: uuid,
          zIndex: zIdx,
          type: itemType,
          name: "",
          artboardIndex: abIndex,
          bounds: bounds,
          locked: false,
          hidden: false,
          opacity: 100
        };

        try { info.name = item.name || ""; } catch(e) {}
        try { info.locked = item.locked; } catch(e) {}
        try { info.hidden = item.hidden; } catch(e) {}
        try { info.opacity = item.opacity; } catch(e) {}

        // type-specific attributes
        if (itemType === "text") {
          try {
            info.contents = item.contents;
          } catch(e) {
            info.contents = "";
          }
          try {
            if (item.textRanges.length > 0) {
              var firstRange = item.textRanges[0];
              info.fontFamily = firstRange.characterAttributes.textFont.family;
              info.fontSize = firstRange.characterAttributes.size;
            }
          } catch(e) {}
          try { info.textKind = getTextKind(item); } catch(e) {}
        }

        if (itemType === "path") {
          try {
            info.filled = item.filled;
            if (item.filled) {
              info.fillColor = colorToObject(item.fillColor);
            }
          } catch(e) {}
          try {
            info.stroked = item.stroked;
            if (item.stroked) {
              info.strokeColor = colorToObject(item.strokeColor);
              info.strokeWidth = item.strokeWidth;
            }
          } catch(e) {}
          try {
            info.closed = item.closed;
          } catch(e) {}
        }

        if (itemType === "compound-path") {
          try {
            if (item.pathItems.length > 0) {
              var firstPath = item.pathItems[0];
              info.filled = firstPath.filled;
              if (firstPath.filled) {
                info.fillColor = colorToObject(firstPath.fillColor);
              }
              info.stroked = firstPath.stroked;
              if (firstPath.stroked) {
                info.strokeColor = colorToObject(firstPath.strokeColor);
                info.strokeWidth = firstPath.strokeWidth;
              }
            }
          } catch(e) {}
        }

        if (itemType === "image") {
          try {
            if (item.typename === "PlacedItem") {
              info.imageType = "linked";
              try {
                info.filePath = item.file.fsName;
              } catch(e) {
                info.filePath = "";
              }
            } else if (item.typename === "RasterItem") {
              info.imageType = item.embedded ? "embedded" : "linked";
            }
          } catch(e) {}
        }

        if (itemType === "group") {
          try {
            info.childCount = item.pageItems.length;
          } catch(e) {}
        }

        if (itemType === "symbol") {
          try {
            info.symbolName = item.symbol.name;
          } catch(e) {}
        }

        items.push(info);
      }

      writeResultFile(RESULT_PATH, {
        selectionCount: sel.length,
        coordinateSystem: coordSystem,
        items: items
      });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'get_selection',
    {
      title: 'Get Selection',
      description: 'Get detailed information about the currently selected objects',
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
