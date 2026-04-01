// ============================================================
// common.jsx — 共通ヘルパー（ExtendScript ES3 準拠）
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
  // note プロパティに UUID がなければ遅延割り当て
  var note = "";
  try { note = pageItem.note || ""; } catch(e) { /* note がないオブジェクトもある */ }

  // UUID パターンチェック（xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx）
  if (note.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)) {
    return note;
  }

  var uuid = generateUUID();
  try {
    pageItem.note = uuid;
  } catch(e) {
    // ロックされたオブジェクト等で書き込み不可の場合はそのまま返す
  }
  return uuid;
}

// --- カラー変換 ---

function colorToObject(color) {
  if (color === void 0 || color === null) return { type: "none" };

  var tn = color.typename;
  if (tn === "CMYKColor") {
    return { type: "cmyk", c: color.cyan, m: color.magenta, y: color.yellow, k: color.black };
  }
  if (tn === "RGBColor") {
    return { type: "rgb", r: color.red, g: color.green, b: color.blue };
  }
  if (tn === "SpotColor") {
    return {
      type: "spot",
      name: color.spot.name,
      tint: color.tint,
      color: colorToObject(color.spot.color)
    };
  }
  if (tn === "GradientColor") {
    var stops = [];
    var grad = color.gradient;
    for (var i = 0; i < grad.gradientStops.length; i++) {
      var gs = grad.gradientStops[i];
      stops.push({
        color: colorToObject(gs.color),
        midPoint: gs.midPoint,
        rampPoint: gs.rampPoint
      });
    }
    return {
      type: "gradient",
      name: grad.name,
      gradientType: grad.type.toString(),
      stops: stops
    };
  }
  if (tn === "PatternColor") {
    return { type: "pattern", name: color.pattern.name };
  }
  if (tn === "GrayColor") {
    return { type: "gray", value: color.gray };
  }
  if (tn === "NoColor") {
    return { type: "none" };
  }
  return { type: "unknown", typename: tn || "undefined" };
}

// --- バウンディングボックス ---

// デフォルト: アートボード相対・Y軸下向き正（Web座標系）
function getBoundsWebCoord(item, artboardRect) {
  var b = item.geometricBounds; // [left, top, right, bottom] （Illustrator座標: Y軸上向き正）
  if (artboardRect) {
    // アートボード相対座標に変換
    var abLeft = artboardRect[0];
    var abTop = artboardRect[1];
    return {
      x: b[0] - abLeft,
      y: -(b[1] - abTop),  // Y 反転
      width: b[2] - b[0],
      height: b[1] - b[3]  // top - bottom (Illustrator座標では top > bottom)
    };
  }
  // アートボードなしの場合はドキュメント座標をWeb向きに変換
  return {
    x: b[0],
    y: -b[1],
    width: b[2] - b[0],
    height: b[1] - b[3]
  };
}

// ドキュメント座標（Illustratorネイティブ）
function getBoundsDocCoord(item) {
  var b = item.geometricBounds;
  return {
    x: b[0],
    y: b[1],
    width: b[2] - b[0],
    height: b[1] - b[3]
  };
}

function getBounds(item, coordSystem, artboardRect) {
  if (coordSystem === "document") {
    return getBoundsDocCoord(item);
  }
  return getBoundsWebCoord(item, artboardRect);
}

// --- アートボード関連 ---

function getActiveArtboardRect() {
  var doc = app.activeDocument;
  var abIdx = doc.artboards.getActiveArtboardIndex();
  return doc.artboards[abIdx].artboardRect;
}

function getArtboardRectByIndex(index) {
  var rects = _getArtboardRects();
  if (index >= 0 && index < rects.length) {
    return rects[index];
  }
  return null;
}

// アートボード矩形キャッシュ（同一 JSX 実行内で再利用）
var _artboardRectsCache = null;

function invalidateArtboardCache() {
  _artboardRectsCache = null;
}

function _getArtboardRects() {
  if (!_artboardRectsCache) {
    _artboardRectsCache = [];
    var doc = app.activeDocument;
    for (var i = 0; i < doc.artboards.length; i++) {
      _artboardRectsCache.push(doc.artboards[i].artboardRect);
    }
  }
  return _artboardRectsCache;
}

// アイテムがどのアートボードに属するか判定（中心座標ベース）
function getArtboardIndexForItem(item) {
  var rects = _getArtboardRects();
  var b = item.geometricBounds;
  var cx = (b[0] + b[2]) / 2;
  var cy = (b[1] + b[3]) / 2;

  for (var i = 0; i < rects.length; i++) {
    var r = rects[i];
    if (cx >= r[0] && cx <= r[2] && cy <= r[1] && cy >= r[3]) {
      return i;
    }
  }
  return -1; // アートボード外
}

// --- バージョンチェック ---

function checkIllustratorVersion() {
  var ver = parseInt(app.version.split(".")[0], 10);
  if (ver < 28) {
    return { error: true, message: "Illustrator CC 2024 or later is required (current: " + app.version + ")" };
  }
  return null;
}

// --- ドキュメント存在チェック ---

function checkDocumentOpen() {
  if (app.documents.length === 0) {
    return { error: true, message: "No document is open. Please open a file in Illustrator." };
  }
  return null;
}

// --- 共通の前提条件チェック ---

function preflightChecks() {
  var verErr = checkIllustratorVersion();
  if (verErr) return verErr;
  var docErr = checkDocumentOpen();
  if (docErr) return docErr;
  return null;
}

// --- フォアグラウンド必須メニューコマンド実行 ---

/**
 * app.executeMenuCommand のラッパー。
 * 失敗時にフォアグラウンド要求のガイダンス付きエラーを投げる。
 * executeMenuCommand はIllustratorが前面でないと失敗するため、
 * ユーザーにウィンドウを切り替えないよう案内する。
 */
function executeMenuCommandSafe(command) {
  try {
    app.executeMenuCommand(command);
  } catch (e) {
    throw new Error(
      "Menu command \"" + command + "\" failed. " +
      "Illustrator must be in the foreground during execution. " +
      "Please do not switch windows while the operation is running. " +
      "(コマンド \"" + command + "\" に失敗しました。実行中は Illustrator を前面に保ち、ウィンドウを切り替えないでください)" +
      " / Original error: " + e.message
    );
  }
}

/**
 * TrimMark メニューコマンドを実行する。
 * v25 → レガシー の順にフォールバック。
 */
function executeTrimMark() {
  try {
    executeMenuCommandSafe("TrimMark v25");
  } catch (e1) {
    executeMenuCommandSafe("TrimMark");
  }
}

// --- オブジェクトタイプ判定 ---

function getItemType(item) {
  var tn = item.typename;
  if (tn === "TextFrame") return "text";
  if (tn === "PathItem") return "path";
  if (tn === "CompoundPathItem") return "compound-path";
  if (tn === "PlacedItem" || tn === "RasterItem") return "image";
  if (tn === "GroupItem") return "group";
  if (tn === "SymbolItem") return "symbol";
  return "other";
}

// --- zIndex 計算 ---
// Illustrator の pageItems は前面→背面の順
// zIndex は 0-based 背面→前面の昇順

function getZIndex(item) {
  try {
    var parent = item.parent;
    var total = 0;
    if (parent.typename === "Layer") {
      total = parent.pageItems.length;
    } else if (parent.typename === "GroupItem") {
      total = parent.pageItems.length;
    } else {
      return 0;
    }
    var idx = total - item.itemIndex;
    if (isNaN(idx)) return 0;
    return idx;
  } catch(e) {
    return 0;
  }
}

// --- UUID 検索（インデックス付き） ---

// 同一 JSX 実行内で UUID→item マップを遅延構築し、2回目以降は O(1) で引く
var _uuidIndex = null;

function _buildUUIDIndex() {
  _uuidIndex = {};
  var doc = app.activeDocument;
  for (var li = 0; li < doc.layers.length; li++) {
    _indexContainer(doc.layers[li]);
  }
}

function _indexContainer(container) {
  for (var i = 0; i < container.pageItems.length; i++) {
    var item = container.pageItems[i];
    try {
      if (item.note && item.note.length > 0) {
        _uuidIndex[item.note] = item;
      }
    } catch(e) {}
    try {
      if (item.typename === "GroupItem") {
        _indexContainer(item);
      }
    } catch(e) {}
  }
}

function findItemByUUID(uuid) {
  if (!_uuidIndex) _buildUUIDIndex();
  return _uuidIndex[uuid] || null;
}

// --- レイヤー解決 ---

function resolveTargetLayer(doc, layerName) {
  if (!layerName) return doc.activeLayer;
  try {
    return doc.layers.getByName(layerName);
  } catch (e) {
    var nl = doc.layers.add();
    nl.name = layerName;
    return nl;
  }
}

// --- 座標変換（Web → Illustrator ネイティブ） ---

function webToAiPoint(x, y, coordSystem, artboardRect) {
  if (coordSystem === "artboard-web" && artboardRect) {
    return [artboardRect[0] + x, artboardRect[1] + (-y)];
  }
  return [x, y];
}

// --- 親レイヤー名取得 ---

function getParentLayerName(item) {
  var obj = item.parent;
  while (obj) {
    if (obj.typename === "Layer") return obj.name;
    try { obj = obj.parent; } catch(e) { break; }
  }
  return "";
}

// --- テキストフレーム種別 ---

function getTextKind(tf) {
  try {
    if (tf.kind === TextType.POINTTEXT) return "point";
    if (tf.kind === TextType.AREATEXT) return "area";
    if (tf.kind === TextType.PATHTEXT) return "path";
  } catch(e) {}
  return "unknown";
}

// --- 再帰的アイテム走査 ---

function iterateAllItems(container, callback) {
  for (var i = 0; i < container.pageItems.length; i++) {
    var item = container.pageItems[i];
    callback(item);
    if (item.typename === "GroupItem") {
      iterateAllItems(item, callback);
    }
  }
}

// --- 操作結果の検証（Post-Operation Verification） ---

/**
 * 単一アイテムの現在の状態をスナップショットとして返す。
 * 操作後に呼び出し、結果に含めることで「実際にどうなったか」を確認できる。
 *
 * @param {PageItem} item - 検証対象
 * @param {string} [coordSystem] - "artboard-web" | "document"
 * @param {Array} [artboardRect] - アートボード矩形（artboard-web時に必要）
 * @returns {Object} アイテムのスナップショット
 */
function verifyItem(item, coordSystem, artboardRect) {
  var snap = {
    name: item.name || "",
    type: getItemType(item),
    bounds: getBounds(item, coordSystem, artboardRect)
  };

  if (item.typename === "TextFrame") {
    snap.contents = item.contents;
    snap.textKind = getTextKind(item);
  }

  try {
    if (item.filled) {
      snap.fill = colorToObject(item.fillColor);
    } else {
      snap.fill = { type: "none" };
    }
  } catch(e) {}

  try {
    if (item.stroked) {
      snap.stroke = { color: colorToObject(item.strokeColor), width: item.strokeWidth };
    }
  } catch(e) {}

  snap.layer = getParentLayerName(item);
  snap.visible = item.hidden !== true;

  return snap;
}

/**
 * 指定アートボード上の名前付きアイテムのスナップショットを返す。
 * アートボード操作やバッチ操作の検証に使う。
 *
 * @param {number} artboardIndex - アートボードインデックス
 * @returns {Object} { artboard: string, items: Array }
 */
function verifyArtboardContents(artboardIndex) {
  var doc = app.activeDocument;
  var ab = doc.artboards[artboardIndex];
  var abRect = ab.artboardRect;
  var items = [];

  for (var i = 0; i < doc.pageItems.length; i++) {
    var item = doc.pageItems[i];
    var gb = item.geometricBounds;
    var cx = (gb[0] + gb[2]) / 2;
    var cy = (gb[1] + gb[3]) / 2;
    if (cx >= abRect[0] && cx <= abRect[2] && cy <= abRect[1] && cy >= abRect[3]) {
      if (item.name && item.name !== "") {
        var entry = { name: item.name, type: getItemType(item) };
        if (item.typename === "TextFrame") {
          entry.contents = item.contents;
        }
        items.push(entry);
      }
    }
  }

  return { artboard: ab.name, index: artboardIndex, itemCount: items.length, items: items };
}
