// ============================================================
// common.jsx — 共通ヘルパー（ExtendScript ES3 準拠 / InDesign 版）
// ============================================================

// --- JSON ポリフィル ---

function jsonStringify(obj) {
  if (obj === null || obj === void 0) return "null";
  var t = typeof obj;
  if (t === "boolean") return String(obj);
  if (t === "number") {
    if (isNaN(obj) || !isFinite(obj)) return "null";
    return String(obj);
  }
  if (t === "string") return _jsonEscapeString(obj);
  if (obj instanceof Array) {
    var parts = [];
    for (var i = 0; i < obj.length; i++) {
      parts.push(jsonStringify(obj[i]));
    }
    return "[" + parts.join(",") + "]";
  }
  if (t === "object") {
    var keys = [];
    for (var k in obj) {
      if (obj.hasOwnProperty(k)) {
        keys.push(_jsonEscapeString(k) + ":" + jsonStringify(obj[k]));
      }
    }
    return "{" + keys.join(",") + "}";
  }
  return "null";
}

function _jsonEscapeString(s) {
  var result = [];
  result.push('"');
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    if (c === '"') { result.push('\\"'); }
    else if (c === '\\') { result.push('\\\\'); }
    else if (c === '\n') { result.push('\\n'); }
    else if (c === '\r') { result.push('\\r'); }
    else if (c === '\t') { result.push('\\t'); }
    else {
      var code = s.charCodeAt(i);
      if (code < 32) {
        var hex = code.toString(16);
        while (hex.length < 4) hex = "0" + hex;
        result.push("\\u" + hex);
      } else {
        result.push(c);
      }
    }
  }
  result.push('"');
  return result.join("");
}

function jsonParse(str) {
  // ExtendScript (ES3) には JSON オブジェクトが存在しないため、
  // eval ベースのパースが唯一の手段。
  // パラメータは MCP Server が生成した JSON ファイル経由で渡されるため、
  // ユーザー入力の直接埋め込みは発生せず、インジェクションリスクはない。
  if (typeof str !== "string" || str.length === 0) return null;
  // BOM 除去
  if (str.charCodeAt(0) === 0xFEFF) str = str.substring(1);
  return eval("(" + str + ")"); // eslint-disable-line no-eval
}

// --- ファイル I/O ---

function readParamsFile(filePath) {
  var f = new File(filePath);
  f.encoding = "UTF-8";
  if (!f.open("r")) {
    throw new Error("Cannot open params file: " + filePath);
  }
  var content = f.read();
  f.close();
  return jsonParse(content);
}

function writeResultFile(filePath, result) {
  var f = new File(filePath);
  f.encoding = "UTF-8";
  if (!f.open("w")) {
    throw new Error("Cannot open result file for writing: " + filePath);
  }
  f.write(jsonStringify(result));
  f.close();
}

// --- UUID 管理 ---

function generateUUID() {
  // ExtendScript 用の簡易 UUID v4 生成
  var chars = "0123456789abcdef";
  var segments = [8, 4, 4, 4, 12];
  var parts = [];
  for (var i = 0; i < segments.length; i++) {
    var seg = [];
    for (var j = 0; j < segments[i]; j++) {
      seg.push(chars.charAt(Math.floor(Math.random() * 16)));
    }
    parts.push(seg.join(""));
  }
  // version 4 marker
  parts[2] = "4" + parts[2].substring(1);
  // variant bits
  var v = parseInt(parts[3].charAt(0), 16);
  v = (v & 0x3) | 0x8;
  parts[3] = v.toString(16) + parts[3].substring(1);
  return parts.join("-");
}

function ensureUUID(pageItem) {
  // InDesign の insertLabel/extractLabel を使用（Illustrator の note より堅牢）
  var existing = "";
  try { existing = pageItem.extractLabel("mcp-uuid") || ""; } catch(e) {}

  // UUID パターンチェック（xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx）
  if (existing.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)) {
    return existing;
  }

  var uuid = generateUUID();
  try {
    pageItem.insertLabel("mcp-uuid", uuid);
  } catch(e) {
    // ロックされたオブジェクト等で書き込み不可の場合はそのまま返す
  }
  return uuid;
}

// --- カラー変換 ---

function colorToObject(color) {
  if (color === void 0 || color === null) return { type: "none" };

  try {
    // Swatch オブジェクトの場合
    if (color.constructor && color.constructor.name === "Swatch") {
      if (color.name === "None") return { type: "none" };
      if (color.name === "Paper") return { type: "paper" };
      return { type: "swatch", name: color.name, color: colorToObject(color.color) };
    }

    // Color オブジェクトの場合
    if (color.space !== void 0) {
      if (color.space === ColorSpace.CMYK) {
        var cv = color.colorValue;
        return { type: "cmyk", c: cv[0], m: cv[1], y: cv[2], k: cv[3] };
      }
      if (color.space === ColorSpace.RGB) {
        var rv = color.colorValue;
        return { type: "rgb", r: rv[0], g: rv[1], b: rv[2] };
      }
      if (color.space === ColorSpace.LAB) {
        var lv = color.colorValue;
        return { type: "lab", l: lv[0], a: lv[1], b: lv[2] };
      }
    }

    // 名前で判定
    if (color.name === "None") return { type: "none" };
    if (color.name === "Paper") return { type: "paper" };
    if (color.name === "Black") return { type: "cmyk", c: 0, m: 0, y: 0, k: 100 };
    if (color.name === "Registration") return { type: "registration" };
  } catch(e) {}

  return { type: "unknown" };
}

// --- バウンディングボックス ---
// InDesign: geometricBounds = [top, left, bottom, right]（Y軸下向き正）
// Illustrator とは順序が異なる（Illustrator: [left, top, right, bottom], Y軸上向き正）

function getBounds(item) {
  var b = item.geometricBounds; // [top, left, bottom, right]
  return {
    x: b[1],
    y: b[0],
    width: b[3] - b[1],
    height: b[2] - b[0]
  };
}

function getBoundsOnPage(item, page) {
  var b = item.geometricBounds; // [top, left, bottom, right] in pasteboard coords
  var pb = page.bounds; // [top, left, bottom, right]
  return {
    x: b[1] - pb[1],
    y: b[0] - pb[0],
    width: b[3] - b[1],
    height: b[2] - b[0]
  };
}

// --- ページ関連 ---

function getPageForItem(item) {
  try { return item.parentPage; } catch(e) { return null; }
}

function getPageBounds(page) {
  var b = page.bounds; // [top, left, bottom, right]
  return { top: b[0], left: b[1], bottom: b[2], right: b[3] };
}

function resolveTargetPage(doc, pageIndex) {
  if (typeof pageIndex === "number" && pageIndex >= 0 && pageIndex < doc.pages.length) {
    return doc.pages[pageIndex];
  }
  // デフォルト: アクティブウィンドウの表示ページ or 最初のページ
  try {
    return app.activeWindow.activePage;
  } catch(e) {
    return doc.pages[0];
  }
}

// --- バージョンチェック ---

function checkInDesignVersion() {
  var ver = parseInt(app.version.split(".")[0], 10);
  if (ver < 19) {
    return { error: true, message: "InDesign 2024 or later is required (current: " + app.version + ")" };
  }
  return null;
}

// --- ドキュメント存在チェック ---

function checkDocumentOpen() {
  if (app.documents.length === 0) {
    return { error: true, message: "No document is open. Please open a file in InDesign." };
  }
  return null;
}

// --- 共通の前提条件チェック ---

function preflightChecks() {
  var verErr = checkInDesignVersion();
  if (verErr) return verErr;
  var docErr = checkDocumentOpen();
  if (docErr) return docErr;
  return null;
}

// --- オブジェクトタイプ判定 ---

function getItemType(item) {
  var tn;
  try { tn = item.constructor.name; } catch(e) { return "other"; }
  if (tn === "TextFrame") return "text";
  if (tn === "Rectangle") return "rectangle";
  if (tn === "Oval") return "oval";
  if (tn === "GraphicLine") return "line";
  if (tn === "Polygon") return "polygon";
  if (tn === "Image" || tn === "EPS" || tn === "PDF") return "image";
  if (tn === "Group") return "group";
  if (tn === "Table") return "table";
  return "other";
}

// --- zIndex 計算 ---
// InDesign の pageItems は前面→背面の順

function getZIndex(item) {
  try {
    var parent = item.parent;
    var total = 0;
    if (parent.pageItems) {
      total = parent.pageItems.length;
    } else {
      return 0;
    }
    // InDesign の itemIndex は 0-based (前面が 0)
    var idx = total - 1 - item.itemIndex;
    if (isNaN(idx)) return 0;
    return idx;
  } catch(e) {
    return 0;
  }
}

// --- UUID 検索 ---

function findItemByUUID(uuid) {
  var doc = app.activeDocument;
  var allItems = doc.allPageItems;
  for (var i = 0; i < allItems.length; i++) {
    try {
      if (allItems[i].extractLabel("mcp-uuid") === uuid) return allItems[i];
    } catch(e) {}
  }
  return null;
}

// --- レイヤー解決 ---

function resolveTargetLayer(doc, layerName) {
  if (!layerName) return doc.activeLayer;
  try {
    return doc.layers.itemByName(layerName);
  } catch (e) {
    var nl = doc.layers.add();
    nl.name = layerName;
    return nl;
  }
}

// --- 親レイヤー名取得 ---

function getParentLayerName(item) {
  try {
    return item.itemLayer.name;
  } catch(e) {
    return "";
  }
}

// --- テキストフレーム情報 ---

function getTextFrameInfo(tf) {
  var info = {};
  try { info.overflows = tf.overflows; } catch(e) {}
  try {
    info.storyId = tf.parentStory.id;
    info.threadedFrameCount = tf.parentStory.textContainers.length;
  } catch(e) {}
  try {
    info.previousTextFrame = tf.previousTextFrame ? ensureUUID(tf.previousTextFrame) : null;
  } catch(e) { info.previousTextFrame = null; }
  try {
    info.nextTextFrame = tf.nextTextFrame ? ensureUUID(tf.nextTextFrame) : null;
  } catch(e) { info.nextTextFrame = null; }
  return info;
}

// --- 再帰的アイテム走査 ---

function iterateAllItems(container, callback) {
  var items;
  try {
    items = container.allPageItems;
  } catch(e) {
    try { items = container.pageItems; } catch(e2) { return; }
  }
  for (var i = 0; i < items.length; i++) {
    callback(items[i]);
  }
}

// --- 操作結果の検証（Post-Operation Verification） ---

/**
 * 単一アイテムの現在の状態をスナップショットとして返す。
 * 操作後に呼び出し、結果に含めることで「実際にどうなったか」を確認できる。
 */
function verifyItem(item) {
  var snap = {
    name: "",
    type: getItemType(item),
    bounds: getBounds(item)
  };

  try { snap.name = item.name || ""; } catch(e) {}

  var pg = getPageForItem(item);
  if (pg) {
    try {
      snap.pageIndex = pg.documentOffset;
      snap.boundsOnPage = getBoundsOnPage(item, pg);
    } catch(e) {}
  }

  if (getItemType(item) === "text") {
    try { snap.contents = item.contents; } catch(e) {}
    try {
      var tfInfo = getTextFrameInfo(item);
      snap.overflows = tfInfo.overflows;
      snap.storyId = tfInfo.storyId;
    } catch(e) {}
  }

  try { snap.fillColor = colorToObject(item.fillColor); } catch(e) {}
  try {
    snap.strokeColor = colorToObject(item.strokeColor);
    snap.strokeWeight = item.strokeWeight;
  } catch(e) {}

  snap.layer = getParentLayerName(item);
  try { snap.visible = item.visible; } catch(e) { snap.visible = true; }

  return snap;
}

/**
 * 指定ページ上の名前付きアイテムのスナップショットを返す。
 */
function verifyPageContents(pageIndex) {
  var doc = app.activeDocument;
  var pg = doc.pages[pageIndex];
  var items = [];

  var allItems = pg.allPageItems;
  for (var i = 0; i < allItems.length; i++) {
    var item = allItems[i];
    var itemName = "";
    try { itemName = item.name; } catch(e) {}
    if (itemName && itemName !== "") {
      var entry = { name: itemName, type: getItemType(item) };
      if (getItemType(item) === "text") {
        try { entry.contents = item.contents; } catch(e) {}
      }
      items.push(entry);
    }
  }

  return { page: pg.name, index: pageIndex, itemCount: items.length, items: items };
}
