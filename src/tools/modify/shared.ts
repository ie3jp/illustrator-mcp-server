import { schema as v } from '../../schema.ts';
import { inlineText } from '../../macros/inline-text.ts' with { type: 'macro' };


const cmykColorSchema = v.object({
  type: v.literal('cmyk').describe('Color type'),
  c: v.number().describe('Cyan'),
  m: v.number().describe('Magenta'),
  y: v.number().describe('Yellow'),
  k: v.number().describe('Black'),
});

const rgbColorSchema = v.object({
  type: v.literal('rgb').describe('Color type'),
  r: v.number().describe('Red'),
  g: v.number().describe('Green'),
  b: v.number().describe('Blue'),
});

const noColorSchema = v.object({
  type: v.literal('none').describe('Color type'),
});

export const colorSchema = v
  .discriminatedUnion('type', [cmykColorSchema, rgbColorSchema, noColorSchema])
  .optional();

export const strokeSchema = v
  .object({
    color: colorSchema.describe('Stroke color'),
    width: v.number().optional().describe('Stroke width'),
  })
  .optional();

export const FONT_HELPERS_JSX = inlineText('src/tools/modify/font-helpers.jsx');

export const COLOR_HELPERS_JSX = inlineText('src/tools/modify/color-helpers.jsx');
