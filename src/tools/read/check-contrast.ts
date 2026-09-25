import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { formatToolResult } from '../tool-executor.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';
/**
 * check_contrast — WCAG コントラスト比チェック
 *
 * GrayColor.gray は 0=白, 100=黒（公式リファレンスの逆の記載は誤り。Illustrator 2026 実機確認済み）。
 *
 * WCAG の相対輝度は sRGB 前提。CMYK / グレー / 特色は ICC プロファイルなしの素朴な変換なので
 * 比は近似値として返し、AA/AAA の合否は断定しない（null）。
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var autoDetect = (params && params.auto_detect === true);

    if (autoDetect) {
      var colorItems = [];
      var skippedHidden = 0;

      for (var i = 0; i < doc.pathItems.length; i++) {
        var item = doc.pathItems[i];
        try {
          if (!isItemEffectivelyVisible(item)) { skippedHidden++; continue; }
          var b = item.geometricBounds;
          var info = {
            uuid: ensureUUID(item),
            name: item.name || "",
            type: getItemType(item),
            bounds: { left: b[0], top: b[1], right: b[2], bottom: b[3] },
            fillColor: null,
            strokeColor: null
          };
          try { if (item.filled) info.fillColor = colorToObject(item.fillColor); } catch(e2) {}
          try { if (item.stroked) info.strokeColor = colorToObject(item.strokeColor); } catch(e2) {}
          if (info.fillColor || info.strokeColor) colorItems.push(info);
        } catch(e) {}
      }

      for (var ti = 0; ti < doc.textFrames.length; ti++) {
        var tf = doc.textFrames[ti];
        try {
          if (!isItemEffectivelyVisible(tf)) { skippedHidden++; continue; }
          var tb = tf.geometricBounds;
          var tInfo = {
            uuid: ensureUUID(tf),
            name: tf.name || tf.contents.substring(0, 30),
            type: "text",
            bounds: { left: tb[0], top: tb[1], right: tb[2], bottom: tb[3] },
            fillColor: null,
            strokeColor: null
          };
          try {
            if (tf.textRanges.length > 0) {
              tInfo.fillColor = colorToObject(tf.textRanges[0].characterAttributes.fillColor);
            }
          } catch(e2) {}
          if (tInfo.fillColor) colorItems.push(tInfo);
        } catch(e) {}
      }

      // 画像は色を評価できないが、背景として重なっていることを報告するために集める
      var imageCollections = [doc.rasterItems, doc.placedItems];
      for (var ci = 0; ci < imageCollections.length; ci++) {
        var coll = imageCollections[ci];
        for (var ii = 0; ii < coll.length; ii++) {
          var img = coll[ii];
          try {
            if (!isItemEffectivelyVisible(img)) { skippedHidden++; continue; }
            var ib = img.geometricBounds;
            colorItems.push({
              uuid: ensureUUID(img),
              name: img.name || "",
              type: "image",
              bounds: { left: ib[0], top: ib[1], right: ib[2], bottom: ib[3] },
              fillColor: { type: "image" },
              strokeColor: null
            });
          } catch(e) {}
        }
      }

      writeResultFile(RESULT_PATH, { colorItems: colorItems, skippedHidden: skippedHidden });
    } else {
      // Manual mode: just return success, calculation done in Node.js
      writeResultFile(RESULT_PATH, { colorItems: [] });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: e.message, line: e.line });
  }
}
`;

// --- WCAG contrast ratio calculation (Node.js side) ---

interface ColorValue {
  type: string;
  r?: number;
  g?: number;
  b?: number;
  c?: number;
  m?: number;
  y?: number;
  k?: number;
  [key: string]: unknown;
}

interface ColorItem {
  uuid: string;
  name: string;
  type: string;
  bounds: { left: number; top: number; right: number; bottom: number };
  fillColor: ColorValue | null;
  strokeColor: ColorValue | null;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 特色の濃度（tint）を元の色に適用する。変換できない色は null */
function applyTint(base: ColorValue, tint: number): ColorValue | null {
  const t = tint / 100;
  if (base.type === 'cmyk') {
    return { type: 'cmyk', c: (base.c ?? 0) * t, m: (base.m ?? 0) * t, y: (base.y ?? 0) * t, k: (base.k ?? 0) * t };
  }
  if (base.type === 'gray' && isNum(base.value)) {
    return { type: 'gray', value: base.value * t };
  }
  if (base.type === 'rgb' && isNum(base.r) && isNum(base.g) && isNum(base.b)) {
    const mix = (v: number) => 255 - (255 - v) * t;
    return { type: 'rgb', r: mix(base.r), g: mix(base.g), b: mix(base.b) };
  }
  return null;
}

/**
 * 色を sRGB（0-255）に変換する。成分が欠けている色・グラデーション・パターン・Lab・画像は null。
 * CMYK / グレーは ICC プロファイルなしの素朴な変換（isApproximateColor 参照）。
 */
export function colorToRGB(color: ColorValue): { r: number; g: number; b: number } | null {
  if (color.type === 'rgb') {
    if (!isNum(color.r) || !isNum(color.g) || !isNum(color.b)) return null;
    return { r: color.r, g: color.g, b: color.b };
  }
  if (color.type === 'cmyk') {
    if (!isNum(color.c) || !isNum(color.m) || !isNum(color.y) || !isNum(color.k)) return null;
    const k = color.k / 100;
    return {
      r: Math.round(255 * (1 - color.c / 100) * (1 - k)),
      g: Math.round(255 * (1 - color.m / 100) * (1 - k)),
      b: Math.round(255 * (1 - color.y / 100) * (1 - k)),
    };
  }
  if (color.type === 'gray') {
    if (!isNum(color.value)) return null;
    const v = Math.round(255 * (1 - color.value / 100));
    return { r: v, g: v, b: v };
  }
  if (color.type === 'spot') {
    const base = color.color as ColorValue | undefined;
    if (!base) return null;
    const tinted = applyTint(base, isNum(color.tint) ? color.tint : 100);
    return tinted ? colorToRGB(tinted) : null;
  }
  return null;
}

/** sRGB 以外（CMYK・グレー・特色）はプロファイルなし変換なので近似 */
function isApproximateColor(color: ColorValue): boolean {
  return color.type !== 'rgb';
}

function relativeLuminance(r: number, g: number, b: number): number {
  // WCAG 2.x 現行の閾値 0.04045（旧版は 0.03928）
  const [rs, gs, bs] = [r / 255, g / 255, b / 255].map((c) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** 比と WCAG 判定。近似値のときは合否を断定しない（null） */
function evaluateContrast(
  rgb1: { r: number; g: number; b: number },
  rgb2: { r: number; g: number; b: number },
  approximate: boolean,
) {
  const ratio =
    Math.round(
      contrastRatio(relativeLuminance(rgb1.r, rgb1.g, rgb1.b), relativeLuminance(rgb2.r, rgb2.g, rgb2.b)) * 100,
    ) / 100;
  return {
    contrastRatio: ratio,
    approximate,
    wcagAA_normal: approximate ? null : ratio >= 4.5,
    wcagAA_large: approximate ? null : ratio >= 3,
    wcagAAA: approximate ? null : ratio >= 7,
  };
}

const APPROXIMATE_NOTE =
  'Non-RGB colors (CMYK / gray / spot) are converted to sRGB without an ICC profile, so the ratio is an estimate and WCAG pass/fail is not asserted (null). Check with the actual RGB values used on screen.';

function boundsOverlap(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return a.left < b.right && a.right > b.left && a.top > b.bottom && a.bottom < b.top;
}

/** 自動検出で評価する最大アイテム数（ペア探索は O(N²)） */
const MAX_AUTO_ITEMS = 1000;
/** 評価できなかったペアを列挙する上限 */
const MAX_UNEVALUATED_LISTED = 50;

const manualColorSchema = z.object({
  type: z.enum(['cmyk', 'rgb', 'gray']),
  c: z.number().optional(),
  m: z.number().optional(),
  y: z.number().optional(),
  k: z.number().optional(),
  r: z.number().optional(),
  g: z.number().optional(),
  b: z.number().optional(),
  value: z.number().optional(),
});

const REQUIRED_COMPONENTS: Record<string, string> = { rgb: 'r, g, b', cmyk: 'c, m, y, k', gray: 'value' };

export function register(server: McpServer): void {
  server.registerTool(
    'check_contrast',
    {
      title: 'Check Contrast',
      description:
        'Check WCAG color contrast ratios. Manual mode: provide color1 and color2. Auto mode (auto_detect: true): find visible foreground/background pairs by bounding-box overlap (stacking order, opacity and clipping are not considered; gradient/pattern/image backgrounds are reported as unevaluated). Non-RGB colors are converted without ICC profiles, so their ratio is approximate and WCAG pass/fail is null. GrayColor uses ink-quantity interpretation (0=white, 100=black), which differs from the API reference.',
      inputSchema: {
        color1: manualColorSchema.optional().describe('First color (manual mode)'),
        color2: manualColorSchema.optional().describe('Second color (manual mode)'),
        auto_detect: z
          .boolean()
          .optional()
          .default(false)
          .describe('Auto-detect overlapping foreground/background color pairs in the document. Do not combine with color1/color2.'),
      },
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      const hasManual = params.color1 !== undefined || params.color2 !== undefined;
      if (hasManual && params.auto_detect) {
        return formatToolResult({
          error: true,
          message: 'Use either color1 + color2 (manual mode) or auto_detect: true, not both.',
        });
      }

      if (hasManual) {
        if (!params.color1 || !params.color2) {
          return formatToolResult({ error: true, message: 'Manual mode requires both color1 and color2.' });
        }
        const c1 = params.color1 as ColorValue;
        const c2 = params.color2 as ColorValue;
        const rgb1 = colorToRGB(c1);
        const rgb2 = colorToRGB(c2);
        if (!rgb1 || !rgb2) {
          const bad = !rgb1 ? ['color1', c1] as const : ['color2', c2] as const;
          return formatToolResult({
            error: true,
            message: `${bad[0]}: ${bad[1].type} color requires ${REQUIRED_COMPONENTS[bad[1].type]}`,
          });
        }
        const approximate = isApproximateColor(c1) || isApproximateColor(c2);
        return formatToolResult({
          ...evaluateContrast(rgb1, rgb2, approximate),
          ...(approximate ? { approximationNote: APPROXIMATE_NOTE } : {}),
          color1_rgb: rgb1,
          color2_rgb: rgb2,
        });
      }

      if (!params.auto_detect) {
        return formatToolResult({
          error: true,
          message: 'Provide color1 and color2 (manual mode), or set auto_detect: true.',
        });
      }

      // Auto-detect mode
      const result = (await executeJsx(jsxCode, params)) as {
        colorItems: ColorItem[];
        skippedHidden?: number;
        error?: boolean;
        message?: string;
        warnings?: unknown[];
      };

      if (result.error) {
        return formatToolResult(result);
      }

      const totalItemCount = result.colorItems.length;
      const items = result.colorItems.slice(0, MAX_AUTO_ITEMS);
      type PairSide = { color: ColorValue; uuid: string; name: string };
      const pairs: Array<{ foreground: PairSide; background: PairSide } & ReturnType<typeof evaluateContrast>> = [];
      const unevaluated: Array<{ foreground: PairSide; background: PairSide; reason: string }> = [];

      // Find overlapping pairs (text on shape, smaller on larger)
      for (let i = 0; i < items.length; i++) {
        for (let j = 0; j < items.length; j++) {
          if (i === j) continue;
          const fg = items[i];
          const bg = items[j];

          if (fg.type !== 'text' && fg.type !== 'path') continue;
          if (!fg.fillColor || !bg.fillColor) continue;
          if (!boundsOverlap(fg.bounds, bg.bounds)) continue;

          const fgArea =
            (fg.bounds.right - fg.bounds.left) * (fg.bounds.top - fg.bounds.bottom);
          const bgArea =
            (bg.bounds.right - bg.bounds.left) * (bg.bounds.top - bg.bounds.bottom);
          if (fgArea >= bgArea) continue;

          const foreground = { color: fg.fillColor, uuid: fg.uuid, name: fg.name };
          const background = { color: bg.fillColor, uuid: bg.uuid, name: bg.name };
          const fgRgb = colorToRGB(fg.fillColor);
          const bgRgb = colorToRGB(bg.fillColor);
          if (!fgRgb || !bgRgb) {
            const badType = !fgRgb ? `foreground ${fg.fillColor.type}` : `background ${bg.fillColor.type}`;
            unevaluated.push({ foreground, background, reason: `${badType} color cannot be evaluated` });
            continue;
          }

          const approximate = isApproximateColor(fg.fillColor) || isApproximateColor(bg.fillColor);
          pairs.push({ foreground, background, ...evaluateContrast(fgRgb, bgRgb, approximate) });
        }
      }

      // Deduplicate and sort by contrast ratio (worst first)
      const seen = new Set<string>();
      const unique = pairs.filter((p) => {
        const key = `${p.foreground.uuid}-${p.background.uuid}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      unique.sort((a, b) => a.contrastRatio - b.contrastRatio);

      return formatToolResult({
        pairCount: unique.length,
        pairs: unique,
        unevaluatedPairCount: unevaluated.length,
        unevaluatedPairs: unevaluated.slice(0, MAX_UNEVALUATED_LISTED),
        skippedHiddenCount: result.skippedHidden ?? 0,
        ...(totalItemCount > MAX_AUTO_ITEMS
          ? { truncated: true, evaluatedItemCount: MAX_AUTO_ITEMS, totalItemCount }
          : {}),
        ...(unique.some((p) => p.approximate) ? { approximationNote: APPROXIMATE_NOTE } : {}),
        limitations:
          'Pairs are inferred from bounding-box overlap and area only: stacking order, opacity, blend modes, clipping masks and glyph shapes are not considered, and text color is taken from the first character. A pairCount of 0 does not mean the document passes WCAG.',
        ...(result.warnings && result.warnings.length > 0
          ? { warnings: result.warnings }
          : {}),
      });
    },
  );
}
