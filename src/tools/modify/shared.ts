import { z } from 'zod';

// --- boolean coerce (MCP クライアントが "true"/"false" 文字列を送る場合の対策) ---

export const coerceBoolean = z.preprocess(
  (val) => {
    if (typeof val === 'string') {
      if (val === 'true') return true;
      if (val === 'false') return false;
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

export const cmykColorSchema = z.object({
  type: z.literal('cmyk').describe('Color type'),
  c: z.number().describe('Cyan'),
  m: z.number().describe('Magenta'),
  y: z.number().describe('Yellow'),
  k: z.number().describe('Black'),
});

export const rgbColorSchema = z.object({
  type: z.literal('rgb').describe('Color type'),
  r: z.number().describe('Red'),
  g: z.number().describe('Green'),
  b: z.number().describe('Blue'),
});

export const grayColorSchema = z.object({
  type: z.literal('gray').describe('Color type'),
  value: z.number().min(0).max(100).describe('Gray value (0-100)'),
});

const noColorSchema = z.object({
  type: z.literal('none').describe('Color type'),
});

export const swatchColorSchema = z.object({
  type: z.literal('swatch').describe('Color type'),
  name: z.string().describe('Swatch name (e.g. "Black", "Paper", or custom swatch)'),
});

export const colorSchema = z
  .discriminatedUnion('type', [cmykColorSchema, rgbColorSchema, grayColorSchema, noColorSchema, swatchColorSchema])
  .optional();

export const strokeSchema = z
  .object({
    color: colorSchema.describe('Stroke color'),
    weight: z.number().optional().describe('Stroke weight (pt)'),
  })
  .optional();

export const FONT_HELPERS_JSX = `
function findFontCandidates(fontName) {
  var candidates = [];
  var searchLower = fontName.toLowerCase();
  for (var fi = 0; fi < app.fonts.length; fi++) {
    var f = app.fonts[fi];
    if (f.name.toLowerCase().indexOf(searchLower) >= 0 ||
        (f.fontFamily && f.fontFamily.toLowerCase().indexOf(searchLower) >= 0)) {
      candidates.push({ name: f.name, family: f.fontFamily, style: f.fontStyleName });
      if (candidates.length >= 10) break;
    }
  }
  return candidates;
}
`;

export const COLOR_HELPERS_JSX = `
function createColor(doc, colorObj) {
  if (!colorObj || colorObj.type === "none") return doc.swatches.item("None");
  if (colorObj.type === "paper") return doc.swatches.item("Paper");
  if (colorObj.type === "swatch") return doc.swatches.item(colorObj.name);
  if (colorObj.type === "cmyk") {
    try {
      var c = doc.colors.add();
      c.model = ColorModel.PROCESS;
      c.space = ColorSpace.CMYK;
      c.colorValue = [colorObj.c, colorObj.m, colorObj.y, colorObj.k];
      return c;
    } catch(e) {
      // 既存の同一色がある場合のフォールバック
      return doc.swatches.item("Black");
    }
  }
  if (colorObj.type === "rgb") {
    try {
      var c = doc.colors.add();
      c.model = ColorModel.PROCESS;
      c.space = ColorSpace.RGB;
      c.colorValue = [colorObj.r, colorObj.g, colorObj.b];
      return c;
    } catch(e) {
      return doc.swatches.item("Black");
    }
  }
  if (colorObj.type === "gray") {
    try {
      var c = doc.colors.add();
      c.model = ColorModel.PROCESS;
      c.space = ColorSpace.CMYK;
      c.colorValue = [0, 0, 0, colorObj.value];
      return c;
    } catch(e) {
      return doc.swatches.item("Black");
    }
  }
  return doc.swatches.item("None");
}

function applyFill(item, doc, colorObj) {
  if (typeof colorObj === "undefined") return;
  if (!colorObj || colorObj.type === "none") {
    item.fillColor = doc.swatches.item("None");
    return;
  }
  item.fillColor = createColor(doc, colorObj);
}

function applyStroke(item, doc, strokeObj) {
  if (!strokeObj) return;
  if (typeof strokeObj.weight === "number") {
    item.strokeWeight = strokeObj.weight;
  }
  if (strokeObj.color) {
    if (strokeObj.color.type === "none") {
      item.strokeColor = doc.swatches.item("None");
      return;
    }
    item.strokeColor = createColor(doc, strokeObj.color);
  }
}
`;
