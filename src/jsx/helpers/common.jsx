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
  // 未検証バージョンの警告を結果に添える（checkIllustratorVersion() が設定）。
  // 配列を返すツールには付与できないため、オブジェクトの場合のみ。
  if (result && typeof result === "object" && !(result instanceof Array)) {
    var extraWarnings = [];
    if (_versionWarning) extraWarnings.push(_versionWarning);
    // findItemByUUID() が重複 UUID を解決した場合の警告
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
//
// PageItem.note に UUID とメタデータを格納する（note は保存・再オープン後も残る。
// native PageItem.uuid は保存をまたぐと変わるため永続 ID には使えない）。
//
//   "<UUID>"                                  … UUID のみ
//   "<UUID>::ai-mcp:key=value::ai-mcp:k2=v2"  … UUID + メタデータ
//   "<UUID> <ユーザーのメモ>"                   … 既存メモがあった場合（メモは温存）
//   "<UUID> <ユーザーのメモ>::ai-mcp:key=value"
//
// - UUID は常に先頭36文字。extractUUIDFromNote() は先頭36文字だけを見る
//   （duplicate_objects は substring(36) で UUID 部分だけ差し替えている）
// - 既存メモがある場合は UUID の後ろに NOTE_UUID_SEPARATOR を挟んで元の文字列を残す
// - メタデータのキーは "ai-mcp:" 名前空間付き。ユーザーが "::rot=" と書いていても壊さない
// - 旧フォーマット（"<UUID>::key=value"、名前空間なし）も読み取る。書き込み時に名前空間付きへ移行する
//   旧フォーマットのメタデータは UUID 直後の "::" 連鎖にしか存在しないため、
//   名前空間なしキーは note が "<UUID>::" で始まる場合のみ探す

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
  // note プロパティに UUID がなければ遅延割り当て。
  // 既存の note（ユーザーのメモ等）は消さず、先頭に UUID を付加する。
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

// UUID を新しい値に差し替える（duplicate() は note を継承するため複製側に使う）。
// ユーザーのメモとメタデータは温存する。新しい UUID を返す
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
  // アートボードなしの場合はドキュメント座標をWeb向きに変換（Y だけ反転）。
  // アイテムがどのアートボードにも属さない（getArtboardIndexForItem() が -1）と
  // artboard-web 指定でもここに来る。アートボード相対ではない第三の座標系になるため、
  // 無警告で返さず artboardRelative: false と coordinateNote で明示する。
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

// 動作下限（Illustrator 2020 = v24）。
// 本サーバーが使う ExtendScript API はすべて v24 以前から存在するもののみ
// （Adobe 公式の scripting changelog でも API 追加は 24.0 が最後）。
var MIN_ILLUSTRATOR_VERSION = 24;

// 実機で検証済みの下限（Illustrator 2024 = v28）。
// これ未満は「動くはずだが未検証」の扱いで、警告を添えて実行する。
var VERIFIED_ILLUSTRATOR_VERSION = 28;

// 未検証バージョンで実行中に立つ警告。writeResultFile() が全ツールの結果に付与する。
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
// zIndex は 0-based 背面→前面の昇順（親コンテナ内）。
// PageItem.itemIndex は実機に存在しない（undefined）ため、PageItem.zOrderPosition
// （親コンテナ内の重なり順、1 始まり・背面が 1。実機確認済み）を 0 始まりに直して使う。
// ただし同一 JSX 内で作成した直後のアイテムは再描画前だと zOrderPosition が
// "No such element" を投げる（実機確認済み）。その場合は親の pageItems（前面→背面の順）
// から同一参照を探して算出する。

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

// UUID 重複の記録（uuid → 出現数。2 以上のものだけ入る）。
// duplicate() やコピー&ペーストは note を継承するため、同じ UUID を持つオブジェクトが
// 実際に複数存在しうる。インデックスは先勝ち（上のレイヤー・前面側が先）のまま、
// 重複は getUUIDDuplicates() で取得できるようにする。
var _uuidDuplicates = null;

// findItemByUUID() が重複 UUID を解決したときの警告。writeResultFile() が結果に付与する
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
        // Layer.pageItems / GroupItem.pageItems は複合パス内部の PathItem を含まない
        // （実機確認済み）。get_groups 等が内部パスに発行した UUID を解決できるよう明示的に辿る
        for (var pi = 0; pi < item.pathItems.length; pi++) {
          _indexItem(item.pathItems[pi]);
        }
      }
    } catch(e) {}
  }
  // container.pageItems only returns items placed directly in this container.
  // Sublayers (nested Layer objects, e.g. Layer > sublayer > pageItem) are a
  // separate collection (container.layers) and were previously never walked,
  // so any item living inside a named sublayer was invisible to findItemByUUID
  // even though read-only scans (list_text_frames/get_images/get_document_structure)
  // recurse into sublayers and find it fine. Recurse into sublayers here too.
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

// container（Layer / GroupItem）配下の全 PageItem に callback を呼ぶ。
// GroupItem・複合パス内部の PathItem・サブレイヤー（Layer.layers）も辿る。
// 複合パスは本体（CompoundPathItem）→ 内部 PathItem の順に呼ばれる。
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

/**
 * 単一アイテムの現在の状態をスナップショットとして返す。
 * 操作後に呼び出し、結果に含めることで「実際にどうなったか」を確認できる。
 *
 * @param {PageItem} item - 検証対象
 * @param {string} [coordSystem] - "artboard-web" | "document"
 * @param {Array} [artboardRect] - アートボード矩形（artboard-web時に必要）
 * @returns {Object} アイテムのスナップショット
 */
function checkArtboardBounds(item, artboardRect) {
  if (!artboardRect) return null;
  // ストローク幅を含む visibleBounds で判定する（geometricBounds だと太いストロークで
  // 実際には見えているのに「completely outside」と誤報する）。取れなければ geometricBounds
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

// 対象自身の hidden に加え、親 GroupItem 等の hidden と Layer.visible を
// Document まで遡って判定する（非表示レイヤー上のオブジェクトは見えていない）
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
      // TextFrame 自体は塗りを持たないため、文字の塗り色を fill として報告する。
      // 範囲全体で取れない（混在等）場合は先頭文字の色を使う
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
