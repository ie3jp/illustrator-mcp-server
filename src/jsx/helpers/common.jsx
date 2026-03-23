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
  f.open("r");
  var content = f.read();
  f.close();
  return jsonParse(content);
}

function writeResultFile(filePath, result) {
  var f = new File(filePath);
  f.encoding = "UTF-8";
  f.open("w");
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
  var doc = app.activeDocument;
  if (index >= 0 && index < doc.artboards.length) {
    return doc.artboards[index].artboardRect;
  }
  return null;
}

// アイテムがどのアートボードに属するか判定（中心座標ベース）
function getArtboardIndexForItem(item) {
  var doc = app.activeDocument;
  var b = item.geometricBounds;
  var cx = (b[0] + b[2]) / 2;
  var cy = (b[1] + b[3]) / 2;

  for (var i = 0; i < doc.artboards.length; i++) {
    var r = doc.artboards[i].artboardRect;
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
