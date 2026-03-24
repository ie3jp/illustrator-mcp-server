import { z } from 'zod';

const cmykColorSchema = z.object({
  type: z.literal('cmyk').describe('Color type'),
  c: z.number().describe('Cyan'),
  m: z.number().describe('Magenta'),
  y: z.number().describe('Yellow'),
  k: z.number().describe('Black'),
});

const rgbColorSchema = z.object({
  type: z.literal('rgb').describe('Color type'),
  r: z.number().describe('Red'),
  g: z.number().describe('Green'),
  b: z.number().describe('Blue'),
});

const noColorSchema = z.object({
  type: z.literal('none').describe('Color type'),
});

export const colorSchema = z
  .discriminatedUnion('type', [cmykColorSchema, rgbColorSchema, noColorSchema])
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
`;

export const COLOR_HELPERS_JSX = `
function createColor(colorObj) {
  if (!colorObj || colorObj.type === "none") return new NoColor();
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
  }
  item.stroked = true;
}
`;
