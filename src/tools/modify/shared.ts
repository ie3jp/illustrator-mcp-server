import { z } from 'zod';

// --- boolean coerce (MCP クライアントが "true"/"false" 文字列を送る場合の対策) ---

export const coerceBoolean = z.preprocess(
  (val) => {
    if (typeof val === 'string') {
      const normalized = val.trim().toLowerCase();
      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
    }
    return val;
  },
  z.boolean(),
);

// --- 共通 annotations 定数 ---

export const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

export const WRITE_IDEMPOTENT_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export const DESTRUCTIVE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const;

// 範囲外の値は Illustrator 側で clamp されるか例外になるか未検証のため、schema で弾く
export const cmykColorSchema = z.object({
  type: z.literal('cmyk').describe('Color type'),
  c: z.number().min(0).max(100).describe('Cyan (0-100)'),
  m: z.number().min(0).max(100).describe('Magenta (0-100)'),
  y: z.number().min(0).max(100).describe('Yellow (0-100)'),
  k: z.number().min(0).max(100).describe('Black (0-100)'),
});

export const rgbColorSchema = z.object({
  type: z.literal('rgb').describe('Color type'),
  r: z.number().min(0).max(255).describe('Red (0-255)'),
  g: z.number().min(0).max(255).describe('Green (0-255)'),
  b: z.number().min(0).max(255).describe('Blue (0-255)'),
});

export const grayColorSchema = z.object({
  type: z.literal('gray').describe('Color type'),
  value: z.number().min(0).max(100).describe('Gray value (0-100)'),
});

const noColorSchema = z.object({
  type: z.literal('none').describe('Color type'),
});

export const colorSchema = z
  .discriminatedUnion('type', [cmykColorSchema, rgbColorSchema, grayColorSchema, noColorSchema])
  .optional();

export const strokeSchema = z
  .object({
    color: colorSchema.describe('Stroke color'),
    width: z.number().optional().describe('Stroke width'),
  })
  .optional();

export const FONT_HELPERS_JSX = `
function findFontCandidates(fontName) {
  var candidates = [];
  var searchLower = fontName.toLowerCase();
  for (var fi = 0; fi < app.textFonts.length; fi++) {
    var f = app.textFonts[fi];
    if (f.name.toLowerCase().indexOf(searchLower) >= 0 ||
        (f.family && f.family.toLowerCase().indexOf(searchLower) >= 0)) {
      candidates.push({ name: f.name, family: f.family });
      if (candidates.length >= 10) break;
    }
  }
  return candidates;
}

// 作成系ツールでフォントが見つからないときのエラー結果。
// デフォルトフォントで作成して警告を添えるだけだと、LLM が警告を読み飛ばして
// 別フォントで組まれた版が残るため、何も作らずにエラーを返す
function fontNotFoundResult(fontName) {
  return {
    error: true,
    message: "Font '" + fontName + "' not found. Nothing was created. font_name must be an exact font name as listed by list_fonts (the 'name' field, e.g. PostScript name 'HelveticaNeue-Bold'). Retry with one of font_candidates, or omit font_name to use the default font.",
    font_candidates: findFontCandidates(fontName)
  };
}
`;

export const COLOR_HELPERS_JSX = `
// ドキュメントのカラーモードと異なる色（CMYK 文書への RGB 指定など）の記録。
// Illustrator は文書のカラーモードに変換して保存する（一次資料 CMYKColor.md: 変換で情報が失われる）。
// 変換自体は止めず、appendColorSpaceWarnings() で結果に警告として載せる
var _colorSpaceMismatches = [];
var _colorSpaceMismatchKeys = {};
var _colorSpaceDocSpace = null;

function _noteColorSpaceMismatch(colorObj) {
  if (colorObj.type !== "cmyk" && colorObj.type !== "rgb") return;
  if (_colorSpaceDocSpace === null) {
    try {
      _colorSpaceDocSpace = (app.activeDocument.documentColorSpace === DocumentColorSpace.CMYK) ? "cmyk" : "rgb";
    } catch (e) {
      _colorSpaceDocSpace = "";
    }
  }
  if (!_colorSpaceDocSpace || colorObj.type === _colorSpaceDocSpace) return;
  var label = (colorObj.type === "rgb")
    ? "rgb(" + colorObj.r + "," + colorObj.g + "," + colorObj.b + ")"
    : "cmyk(" + colorObj.c + "," + colorObj.m + "," + colorObj.y + "," + colorObj.k + ")";
  if (_colorSpaceMismatchKeys[label]) return;
  _colorSpaceMismatchKeys[label] = true;
  _colorSpaceMismatches.push(label);
}

// createColor() で記録した不一致を result.warnings に追加する
function appendColorSpaceWarnings(result) {
  if (_colorSpaceMismatches.length === 0 || !result || typeof result !== "object") return result;
  if (!(result.warnings instanceof Array)) result.warnings = [];
  var docLabel = (_colorSpaceDocSpace === "cmyk") ? "CMYK" : "RGB";
  var msg = "Color mode mismatch: " + _colorSpaceMismatches.join(", ") + " specified in a " + docLabel +
    " document. Illustrator converts these to " + docLabel + ", which can shift the color";
  if (_colorSpaceDocSpace === "cmyk") {
    msg += " (e.g. rgb(0,0,0) becomes a 4-color rich black, not K100). Specify {type:'cmyk'} colors in this document.";
  } else {
    msg += ". Specify {type:'rgb'} colors in this document.";
  }
  msg += " The stored values are shown in verified.fill / verified.stroke.";
  result.warnings.push(msg);
  return result;
}

function createColor(colorObj) {
  if (!colorObj || colorObj.type === "none") return new NoColor();
  _noteColorSpaceMismatch(colorObj);
  if (colorObj.type === "cmyk") {
    var c = new CMYKColor();
    c.cyan = colorObj.c;
    c.magenta = colorObj.m;
    c.yellow = colorObj.y;
    c.black = colorObj.k;
    return c;
  }
  if (colorObj.type === "rgb") {
    var c = new RGBColor();
    c.red = colorObj.r;
    c.green = colorObj.g;
    c.blue = colorObj.b;
    return c;
  }
  if (colorObj.type === "gray") {
    var c = new GrayColor();
    c.gray = colorObj.value;
    return c;
  }
  return new NoColor();
}

function applyOptionalFill(item, colorObj) {
  if (typeof colorObj === "undefined") return;
  if (!colorObj || colorObj.type === "none") {
    item.filled = false;
    return;
  }
  item.fillColor = createColor(colorObj);
  item.filled = true;
}

function applyStroke(item, strokeObj, defaultStroked) {
  if (!strokeObj) {
    item.stroked = defaultStroked;
    return;
  }
  if (typeof strokeObj.width === "number") {
    item.strokeWidth = strokeObj.width;
  }
  if (strokeObj.color && strokeObj.color.type === "none") {
    item.stroked = false;
    return;
  }
  if (strokeObj.color) {
    item.strokeColor = createColor(strokeObj.color);
    item.stroked = true;
  }
}
`;

/**
 * ドキュメントの使用色の収集（place_color_chips / place_style_guide 共用）。
 * パスの塗り・線（doc.pathItems はグループ・複合パス内部も含む）に加え、
 * テキストの文字色と、グラデーションの各分岐点の色も拾う。
 * 特色は tint 違いを別色として扱う。パターン等チップにできない色は skipped に数える。
 */
export const DOCUMENT_COLORS_JSX = `
function _docColorKey(color) {
  var tn = color.typename;
  if (tn === "CMYKColor") return "cmyk_" + Math.round(color.cyan) + "_" + Math.round(color.magenta) + "_" + Math.round(color.yellow) + "_" + Math.round(color.black);
  if (tn === "RGBColor") return "rgb_" + Math.round(color.red) + "_" + Math.round(color.green) + "_" + Math.round(color.blue);
  if (tn === "SpotColor") return "spot_" + color.spot.name + "_" + Math.round(color.tint);
  if (tn === "GrayColor") return "gray_" + Math.round(color.gray);
  if (tn === "LabColor") return "lab_" + Math.round(color.l) + "_" + Math.round(color.a) + "_" + Math.round(color.b);
  return null;
}

function _addDocColor(state, color) {
  if (!color) return;
  var tn = "";
  try { tn = color.typename; } catch (e) { return; }
  if (tn === "NoColor") return;
  if (tn === "GradientColor") {
    var stops = color.gradient.gradientStops;
    for (var gi = 0; gi < stops.length; gi++) {
      try { _addDocColor(state, stops[gi].color); } catch (e) {}
    }
    return;
  }
  var key = _docColorKey(color);
  if (!key) {
    state.skipped[tn] = (state.skipped[tn] || 0) + 1;
    return;
  }
  if (!state.map[key]) {
    state.map[key] = true;
    state.list.push({ color: color, key: key, info: colorToObject(color) });
  }
}

function collectDocumentColors(doc, excludeLayerNames) {
  var state = { map: {}, list: [], skipped: {} };
  function isExcluded(item) {
    var ln = "";
    try { ln = item.layer.name; } catch (e) { return false; }
    for (var xi = 0; xi < excludeLayerNames.length; xi++) {
      if (ln === excludeLayerNames[xi]) return true;
    }
    return false;
  }
  for (var pi = 0; pi < doc.pathItems.length; pi++) {
    var p = doc.pathItems[pi];
    if (isExcluded(p)) continue;
    try { if (p.filled) _addDocColor(state, p.fillColor); } catch (e) {}
    try { if (p.stroked) _addDocColor(state, p.strokeColor); } catch (e) {}
  }
  for (var ti = 0; ti < doc.textFrames.length; ti++) {
    var tf = doc.textFrames[ti];
    if (isExcluded(tf)) continue;
    try {
      for (var ri = 0; ri < tf.textRanges.length; ri++) {
        var ca = tf.textRanges[ri].characterAttributes;
        try { _addDocColor(state, ca.fillColor); } catch (e) {}
        try { if (ca.strokeWeight > 0) _addDocColor(state, ca.strokeColor); } catch (e) {}
      }
    } catch (e) {}
  }
  return state;
}

// チップ用のラベル文字列
function docColorLabel(info) {
  if (info.type === "cmyk") return "C" + Math.round(info.c) + " M" + Math.round(info.m) + " Y" + Math.round(info.y) + " K" + Math.round(info.k);
  if (info.type === "rgb") return "R" + Math.round(info.r) + " G" + Math.round(info.g) + " B" + Math.round(info.b);
  if (info.type === "spot") return info.name + (Math.round(info.tint) < 100 ? " " + Math.round(info.tint) + "%" : "");
  if (info.type === "gray") return "Gray " + Math.round(info.value) + "%";
  if (info.type === "lab") return "L" + Math.round(info.l) + " a" + Math.round(info.a) + " b" + Math.round(info.b);
  return "";
}
`;

/**
 * 段落の揃え（ParagraphAttributes.justification）。
 * justify_* はパネルの「均等配置（最終行 左/中央/右揃え）」、justify_all は「両端揃え」
 */
export const justificationSchema = z
  .enum(['left', 'center', 'right', 'justify_left', 'justify_center', 'justify_right', 'justify_all'])
  .optional()
  .describe(
    'Paragraph alignment for all paragraphs: left | center | right, or justified with the last line left/center/right (justify_left, justify_center, justify_right) or all lines forced (justify_all). Justified values only have an effect on area text.',
  );

export const JUSTIFICATION_JSX = `
function applyJustification(tf, name) {
  var map = {
    left: Justification.LEFT,
    center: Justification.CENTER,
    right: Justification.RIGHT,
    justify_left: Justification.FULLJUSTIFYLASTLINELEFT,
    justify_center: Justification.FULLJUSTIFYLASTLINECENTER,
    justify_right: Justification.FULLJUSTIFYLASTLINERIGHT,
    justify_all: Justification.FULLJUSTIFY
  };
  if (typeof map[name] === "undefined") throw new Error("Unknown justification: " + name);
  // テキスト全体の範囲に設定すると全段落に適用される
  tf.textRange.paragraphAttributes.justification = map[name];
}
`;
