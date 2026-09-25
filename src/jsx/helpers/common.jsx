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
  // ES3 には JSON がないため eval で読む。入力は MCP Server が書いた JSON ファイルのみ
  if (typeof str !== "string" || str.length === 0) return null;
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
  // 未検証バージョン・UUID 重複の警告を添える（配列の結果には付けられない）
  if (result && typeof result === "object" && !(result instanceof Array)) {
    var extraWarnings = [];
    if (_versionWarning) extraWarnings.push(_versionWarning);
    for (var wi = 0; wi < _uuidAmbiguityWarnings.length; wi++) {
      extraWarnings.push(_uuidAmbiguityWarnings[wi]);
    }
    if (extraWarnings.length > 0) {
      if (!(result.warnings instanceof Array)) result.warnings = [];
      for (var wj = 0; wj < extraWarnings.length; wj++) {
        result.warnings.push(extraWarnings[wj]);
      }
    }
  }

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

// --- note フォーマット ---
// 永続 ID は PageItem.note に持つ（native PageItem.uuid は保存をまたぐと変わる）。
//   "<UUID>" / "<UUID>::ai-mcp:key=value" / "<UUID> <ユーザーのメモ>::ai-mcp:key=value"
// UUID は常に先頭36文字、既存メモは温存する。キーの "ai-mcp:" 名前空間はユーザーのメモとの衝突避け。
// 旧フォーマット "<UUID>::key=value" も読み、書き込み時に名前空間付きへ移行する

var NOTE_UUID_SEPARATOR = " ";
var NOTE_META_NAMESPACE = "ai-mcp:";

function extractUUIDFromNote(note) {
  if (!note || note.length < 36) return "";
  var head = note.substring(0, 36);
  if (head.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)) {
    return head;
  }
  return "";
}

// メタデータタグの位置を返す（名前空間付き優先、なければ旧フォーマット）。見つからなければ null
function _findNoteMetaTag(note, key) {
  if (!note) return null;
  var nsTag = "::" + NOTE_META_NAMESPACE + key + "=";
  var idx = note.indexOf(nsTag);
  if (idx >= 0) return { index: idx, tag: nsTag };
  // 旧フォーマット: "<UUID>::key=value::..."
  if (extractUUIDFromNote(note) && note.substring(36, 38) === "::") {
    var legacyTag = "::" + key + "=";
    var lidx = note.indexOf(legacyTag, 36);
    if (lidx >= 0) return { index: lidx, tag: legacyTag };
  }
  return null;
}

function getNoteMeta(note, key) {
  var found = _findNoteMetaTag(note, key);
  if (!found) return null;
  var start = found.index + found.tag.length;
  var end = note.indexOf("::", start);
  return end < 0 ? note.substring(start) : note.substring(start, end);
}

function setNoteMeta(item, key, value) {
  var note = "";
  try { note = item.note || ""; } catch(e) { return; }
  var nsTag = "::" + NOTE_META_NAMESPACE + key + "=";
  var found = _findNoteMetaTag(note, key);
  if (found) {
    // 既存のキーを置換（旧フォーマットのキーはこの場で名前空間付きに移行）
    var start = found.index + found.tag.length;
    var end = note.indexOf("::", start);
    note = note.substring(0, found.index) + nsTag + value + (end >= 0 ? note.substring(end) : "");
  } else {
    note = note + nsTag + value;
  }
  try { item.note = note; } catch(e) {}
}

function ensureUUID(pageItem) {
  // UUID がなければ付与する。既存のメモは消さず UUID の後ろに残す
  var note = "";
  try { note = pageItem.note || ""; } catch(e) { /* note がないオブジェクトもある */ }

  var uuid = extractUUIDFromNote(note);
  if (uuid) return uuid;

  uuid = generateUUID();
  try {
    pageItem.note = note.length > 0 ? (uuid + NOTE_UUID_SEPARATOR + note) : uuid;
  } catch(e) {
    // ロックされたオブジェクト等で書き込み不可の場合はそのまま返す
  }
  return uuid;
}

// UUID だけ差し替え、メモとメタデータは温存する。新しい UUID を返す
function reassignUUID(pageItem) {
  var note = "";
  try { note = pageItem.note || ""; } catch(e) {}
  var uuid = generateUUID();
  var newNote;
  if (extractUUIDFromNote(note)) {
    newNote = uuid + note.substring(36);
  } else {
    newNote = note.length > 0 ? (uuid + NOTE_UUID_SEPARATOR + note) : uuid;
  }
  try { pageItem.note = newNote; } catch(e) {}
  return uuid;
}

// アイテム自身と、グループ・複合パス内の子孫（サブグループも含む）を配列で返す
function collectItemWithDescendants(item) {
  var list = [item];
  if (item.typename === "GroupItem") {
    iterateAllItems(item, function(child) { list.push(child); });
  } else if (item.typename === "CompoundPathItem") {
    for (var cp = 0; cp < item.pathItems.length; cp++) list.push(item.pathItems[cp]);
  }
  return list;
}

// duplicate() は note ごと UUID を継承するため、複製と子孫の UUID を振り直す。
// UUID のないアイテムには付けない
function reassignUUIDDeep(item) {
  var list = collectItemWithDescendants(item);
  for (var i = 0; i < list.length; i++) {
    var n = "";
    try { n = list[i].note || ""; } catch(e) { continue; }
    if (extractUUIDFromNote(n)) reassignUUID(list[i]);
  }
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
  if (tn === "LabColor") {
    return { type: "lab", l: color.l, a: color.a, b: color.b };
  }
  if (tn === "NoColor") {
    return { type: "none" };
  }
  return { type: "unknown", typename: tn || "undefined" };
}

// colorToObject() の結果を同一色ごとにまとめ、count の多い順に返す（渡した要素に count を書き込む）
function summarizeColors(colors) {
  var byKey = {};
  var list = [];
  for (var i = 0; i < colors.length; i++) {
    var key = jsonStringify(colors[i]);
    if (byKey[key]) {
      byKey[key].count++;
    } else {
      var entry = colors[i];
      entry.count = 1;
      byKey[key] = entry;
      list.push(entry);
    }
  }
  list.sort(function(a, b) { return b.count - a.count; });
  return list;
}

// --- 画像のピクセル数 ---

// geometricBounds は回転で膨らんだ AABB なので、変形行列（1px あたりの pt）で
// AABB 幅 = W*|a| + H*|c|、高さ = W*|b| + H*|d| を解いてピクセル数 W,H を求める。45° 付近など解けなければ null
function pixelSizeFromMatrix(m, aabbW, aabbH) {
  var a = Math.abs(m.mValueA), b = Math.abs(m.mValueB);
  var c = Math.abs(m.mValueC), d = Math.abs(m.mValueD);
  var det = a * d - c * b;
  var scale = Math.max(a * d, c * b);
  if (scale <= 0 || Math.abs(det) < scale * 1e-3) return null;
  var w = (aabbW * d - c * aabbH) / det;
  var h = (a * aabbH - b * aabbW) / det;
  if (!(w > 0) || !(h > 0)) return null;
  return { width: Math.round(w), height: Math.round(h) };
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
  // アートボードなし: ドキュメント座標の Y だけ反転。どのアートボードにも属さないアイテムは
  // artboard-web 指定でもここに来るため、アートボード相対でないことを結果に明示する
  return {
    x: b[0],
    y: -b[1],
    width: b[2] - b[0],
    height: b[1] - b[3],
    artboardRelative: false,
    coordinateNote: "Not artboard-relative (no artboard resolved, e.g. the object's center is outside every artboard): x/y are document coordinates with Y flipped (Y down)."
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

// 動作下限 Illustrator 2020。使う API はすべて v24 以前からある（公式 scripting changelog の API 追加も 24.0 が最後）
var MIN_ILLUSTRATOR_VERSION = 24;

// 実機検証済みの下限 Illustrator 2024。これ未満は警告付きで実行する
var VERIFIED_ILLUSTRATOR_VERSION = 28;

// writeResultFile() が全ツールの結果に付与する
var _versionWarning = null;

function checkIllustratorVersion() {
  var ver = parseInt(app.version.split(".")[0], 10);
  if (isNaN(ver) || ver < MIN_ILLUSTRATOR_VERSION) {
    return {
      error: true,
      message: "Illustrator 2020 (v24) or later is required (current: " + app.version + ")"
    };
  }
  if (ver < VERIFIED_ILLUSTRATOR_VERSION) {
    _versionWarning =
      "Illustrator " + app.version + " is below the verified baseline. " +
      "This server is tested only on Illustrator 2024 (v28) and later. " +
      "Older versions are expected to work but are unverified \u2014 " +
      "please report anything broken at https://github.com/ie3jp/illustrator-mcp-server/issues";
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

// executeMenuCommand は Illustrator が前面でないと失敗するため、失敗時は前面維持を案内する
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

// "TrimMark v25" → レガシー "TrimMark" の順に試す
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
// 親コンテナ内の 0 始まり・背面→前面の昇順。以下いずれも実機確認済み:
// - PageItem.itemIndex は存在しない。zOrderPosition は 1 始まり・背面が 1
// - 同一 JSX 内で作成直後のアイテムは zOrderPosition が "No such element" を投げるため、
//   親の pageItems（前面→背面）から同一参照を探す

function getZIndex(item) {
  try {
    var pos = item.zOrderPosition;
    if (typeof pos === "number" && !isNaN(pos) && pos >= 1) return pos - 1;
  } catch(e) {}
  try {
    var siblings = item.parent.pageItems;
    var total = siblings.length;
    for (var i = 0; i < total; i++) {
      if (siblings[i] == item) return total - 1 - i;
    }
  } catch(e2) {}
  return 0;
}

// --- UUID 検索（インデックス付き） ---

// 同一 JSX 実行内で UUID→item マップを遅延構築し、2回目以降は O(1) で引く
var _uuidIndex = null;

// uuid → 出現数（2 以上のみ）。duplicate() やコピー&ペーストは note を継承するため重複しうる。
// インデックス自体は先勝ち（上のレイヤー・前面側）
var _uuidDuplicates = null;

// writeResultFile() が結果に付与する
var _uuidAmbiguityWarnings = [];

function _resetUUIDIndex() {
  _uuidIndex = {};
  _uuidDuplicates = {};
}

function _buildUUIDIndex() {
  _resetUUIDIndex();
  var doc = app.activeDocument;
  for (var li = 0; li < doc.layers.length; li++) {
    _indexContainer(doc.layers[li]);
  }
}

function _indexItem(item) {
  try {
    if (item.note && item.note.length > 0) {
      var uid = extractUUIDFromNote(item.note);
      if (uid) {
        if (!_uuidIndex[uid]) {
          _uuidIndex[uid] = item;
        } else {
          _uuidDuplicates[uid] = (_uuidDuplicates[uid] || 1) + 1;
        }
      }
    }
  } catch(e) {}
}

function _indexContainer(container) {
  for (var i = 0; i < container.pageItems.length; i++) {
    var item = container.pageItems[i];
    _indexItem(item);
    try {
      if (item.typename === "GroupItem") {
        _indexContainer(item);
      } else if (item.typename === "CompoundPathItem") {
        // pageItems は複合パス内部の PathItem を含まない（実機確認済み）
        for (var pi = 0; pi < item.pathItems.length; pi++) {
          _indexItem(item.pathItems[pi]);
        }
      }
    } catch(e) {}
  }
  // サブレイヤーは pageItems ではなく layers にある
  try {
    if (container.layers && container.layers.length > 0) {
      for (var sl = 0; sl < container.layers.length; sl++) {
        _indexContainer(container.layers[sl]);
      }
    }
  } catch(e) {}
}

function findItemByUUID(uuid) {
  if (!_uuidIndex) _buildUUIDIndex();
  var item = _uuidIndex[uuid] || null;
  if (item && _uuidDuplicates && _uuidDuplicates[uuid]) {
    var msg = "UUID " + uuid + " is shared by " + _uuidDuplicates[uuid] +
      " objects (duplicate/copy-paste copies the note that stores the UUID). " +
      "The first match in layer order (top layer, frontmost first) was used; it may not be the object you meant.";
    var seen = false;
    for (var i = 0; i < _uuidAmbiguityWarnings.length; i++) {
      if (_uuidAmbiguityWarnings[i] === msg) { seen = true; break; }
    }
    if (!seen) _uuidAmbiguityWarnings.push(msg);
  }
  return item;
}

// 重複している UUID の一覧を返す: [{ uuid: string, count: number }]
function getUUIDDuplicates() {
  if (!_uuidIndex) _buildUUIDIndex();
  var list = [];
  if (!_uuidDuplicates) return list;
  for (var uid in _uuidDuplicates) {
    if (_uuidDuplicates.hasOwnProperty(uid)) {
      list.push({ uuid: uid, count: _uuidDuplicates[uid] });
    }
  }
  return list;
}

// --- レイヤー解決 ---

// トップレベルレイヤーのうち名前が一致するもののインデックスを全件返す（上から順）。
// getByName() は最初の 1 件しか返さず、同名レイヤーの存在に気づけない
function findTopLevelLayerIndices(doc, name) {
  var result = [];
  for (var li = 0; li < doc.layers.length; li++) {
    if (doc.layers[li].name === name) result.push(li);
  }
  return result;
}

// 名前でトップレベルレイヤーを解決する。見つからなければ null。
// 同名が複数あるときは最上位（index 最小。getByName と同じ）を返し、warnings 配列に警告を積む
function resolveTopLevelLayer(doc, name, warnings) {
  var indices = findTopLevelLayerIndices(doc, name);
  if (indices.length === 0) return null;
  if (indices.length > 1 && warnings) {
    warnings.push(indices.length + " top-level layers are named '" + name + "'; used the topmost one (position " + indices[0] + "). Rename layers to make them unique.");
  }
  return { layer: doc.layers[indices[0]], index: indices[0] };
}

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

// container 配下の全 PageItem に callback を呼ぶ（グループ・複合パス内部・サブレイヤーも辿る）
function iterateAllItems(container, callback) {
  for (var i = 0; i < container.pageItems.length; i++) {
    var item = container.pageItems[i];
    callback(item);
    if (item.typename === "GroupItem") {
      iterateAllItems(item, callback);
    } else if (item.typename === "CompoundPathItem") {
      // Layer.pageItems は複合パス内部を含まないため明示的に辿る
      for (var pi = 0; pi < item.pathItems.length; pi++) {
        callback(item.pathItems[pi]);
      }
    }
  }
  var subLayers = null;
  try { subLayers = container.layers; } catch(e) {}
  if (subLayers && subLayers.length > 0) {
    for (var sl = 0; sl < subLayers.length; sl++) {
      iterateAllItems(subLayers[sl], callback);
    }
  }
}

// --- 操作結果の検証（Post-Operation Verification） ---

function checkArtboardBounds(item, artboardRect) {
  if (!artboardRect) return null;
  // geometricBounds だと太いストロークが見えていても「completely outside」と誤報するため visibleBounds
  var gb = null; // [left, top, right, bottom]
  try { gb = item.visibleBounds; } catch(e) {}
  if (!gb || gb.length !== 4) gb = item.geometricBounds;
  var abL = artboardRect[0], abT = artboardRect[1], abR = artboardRect[2], abB = artboardRect[3];
  var itemL = gb[0], itemT = gb[1], itemR = gb[2], itemB = gb[3];
  // fully inside
  if (itemL >= abL && itemR <= abR && itemT <= abT && itemB >= abB) return null;
  // fully outside
  if (itemR <= abL || itemL >= abR || itemB >= abT || itemT <= abB) {
    return "WARNING: This object is completely outside the artboard. It will not be visible in the final output. Check your coordinates — in artboard-web mode, (0,0) is the top-left of the artboard and Y increases downward.";
  }
  // partially outside
  return "WARNING: This object extends beyond the artboard edges. Parts of it may be clipped in the final output.";
}

// 親 GroupItem の hidden と Layer.visible も Document まで遡って判定する
function isItemEffectivelyVisible(item) {
  try { if (item.hidden === true) return false; } catch(e) {}
  var obj = null;
  try { obj = item.parent; } catch(e) {}
  var depth = 0;
  while (obj && depth < 100) {
    var tn = "";
    try { tn = obj.typename; } catch(e) { break; }
    if (tn === "Document") break;
    if (tn === "Layer") {
      try { if (obj.visible === false) return false; } catch(e) {}
    } else {
      try { if (obj.hidden === true) return false; } catch(e) {}
    }
    try { obj = obj.parent; } catch(e) { break; }
    depth++;
  }
  return true;
}

function verifyItem(item, coordSystem, artboardRect) {
  var snap = {
    name: item.name || "",
    type: getItemType(item),
    bounds: getBounds(item, coordSystem, artboardRect)
  };

  if (item.typename === "TextFrame") {
    snap.contents = item.contents;
    snap.textKind = getTextKind(item);
    // 文字属性は環境によって取得できないことがあるため個別に握りつぶす
    try {
      var ca = item.textRange.characterAttributes;
      try { snap.fontSize = ca.size; } catch (eSize) {}
      try { snap.tracking = ca.tracking; } catch (eTrack) {}
      // TextFrame 自体は塗りを持たないため文字の塗りを報告する（混在時は先頭文字）
      try {
        var tfFill = ca.fillColor;
        if (tfFill === void 0 || tfFill === null) {
          try { tfFill = item.characters[0].characterAttributes.fillColor; } catch (eFirst) {}
        }
        snap.fill = colorToObject(tfFill);
      } catch (eFill) {}
    } catch (eAttr) {}
  } else {
    try {
      if (item.filled) {
        snap.fill = colorToObject(item.fillColor);
      } else {
        snap.fill = { type: "none" };
      }
    } catch(e) {}
  }

  try {
    if (item.stroked) {
      snap.stroke = { color: colorToObject(item.strokeColor), width: item.strokeWidth };
    }
  } catch(e) {}

  snap.layer = getParentLayerName(item);
  snap.visible = isItemEffectivelyVisible(item);

  var boundsWarning = checkArtboardBounds(item, artboardRect);
  if (boundsWarning) snap.warning = boundsWarning;

  return snap;
}

// アートボード上（中心座標で判定）の名前付きアイテム一覧。アートボード操作・バッチ操作の検証用
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
