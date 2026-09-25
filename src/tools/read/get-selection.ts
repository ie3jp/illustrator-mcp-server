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

    // テキスト編集中の Document.selection は PageItem 配列ではなく TextRange / InsertionPoint になり、
    // geometricBounds 等がなく選択全体がエラーになるため、親の TextFrame に置き換える
    function isTextSelection(obj) {
      var tn = "";
      try { tn = obj.typename; } catch(e) {}
      return tn === "TextRange" || tn === "InsertionPoint";
    }

    function findTextFrameOfRange(range) {
      var obj = range;
      for (var guard = 0; guard < 10 && obj; guard++) {
        var tn = "";
        try { tn = obj.typename; } catch(e) { break; }
        if (tn === "TextFrame") return obj;
        try { obj = obj.parent; } catch(e) { break; }
      }
      // parent で辿れない場合は story のフレームから、選択開始位置を含むものを選ぶ（スレッド連結対策）
      try {
        var frames = range.story.textFrames;
        var rs = -1;
        try { rs = range.start; } catch(e) {}
        for (var fi = 0; fi < frames.length; fi++) {
          try {
            var fr = frames[fi].textRange;
            if (rs >= fr.start && rs <= fr.end) return frames[fi];
          } catch(e) {}
        }
        if (frames.length > 0) return frames[0];
      } catch(e) {}
      return null;
    }

    var selList = [];
    if (sel) {
      var selTn = "";
      try { selTn = sel.typename; } catch(e) {}
      if (selTn) {
        selList.push(sel);
      } else {
        for (var si = 0; si < sel.length; si++) selList.push(sel[si]);
      }
    }

    function describeItem(item) {
      var uuid = ensureUUID(item);
      var zIdx = getZIndex(item);
      var itemType = getItemType(item);

      var abIndex = -1;
      var bounds = null;
      try { abIndex = getArtboardIndexForItem(item); } catch(e) {}
      try { bounds = getBounds(item, coordSystem, getArtboardRectByIndex(abIndex)); } catch(e) {}

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

      return info;
    }

    if (selList.length === 0) {
      writeResultFile(RESULT_PATH, { selectionCount: 0, items: [] });
    } else {
      var items = [];

      for (var i = 0; i < selList.length; i++) {
        var entry = selList[i];
        try {
          if (isTextSelection(entry)) {
            var tf = findTextFrameOfRange(entry);
            if (!tf) continue;
            var tInfo = describeItem(tf);
            var textSel = { contents: "", length: 0 };
            try { textSel.contents = entry.contents; } catch(e) {}
            try { textSel.length = entry.length; } catch(e) {}
            try { textSel.start = entry.start; } catch(e) {}
            textSel.insertionPoint = (textSel.length === 0);
            tInfo.textSelection = textSel;
            items.push(tInfo);
          } else {
            items.push(describeItem(entry));
          }
        } catch(itemErr) {
          // 1 件の失敗で選択全体をエラーにしない
          var errType = "unknown";
          try { errType = entry.typename; } catch(e) {}
          items.push({ typename: errType, error: "Failed to read selected item: " + itemErr.message });
        }
      }

      writeResultFile(RESULT_PATH, {
        selectionCount: items.length,
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
      description:
        'Get detailed information about the currently selected objects. While editing text (text cursor or selected characters), the containing text frame is returned with a textSelection field (selected contents, length, start; insertionPoint: true for a bare cursor).',
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
