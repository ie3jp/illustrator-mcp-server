import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';
/**
 * check_contrast — WCAG コントラスト比チェック
 *
 * 既知の問題: GrayColor の gray プロパティの解釈がリファレンス（0=黒, 100=白）と
 * インク量解釈（0=白, 100=黒）で矛盾あり。現在のコードはインク量解釈を使用。
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
      // Collect all objects with colors and bounds for overlap analysis
      var colorItems = [];

      // Path items
      for (var i = 0; i < doc.pathItems.length; i++) {
        var item = doc.pathItems[i];
        try {
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

      // Text frames (foreground text)
      for (var ti = 0; ti < doc.textFrames.length; ti++) {
        var tf = doc.textFrames[ti];
        try {
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

      writeResultFile(RESULT_PATH, { colorItems: colorItems });
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

function colorToRGB(color: ColorValue): { r: number; g: number; b: number } | null {
  if (color.type === 'rgb' && color.r !== undefined) {
    return { r: color.r, g: color.g!, b: color.b! };
  }
  if (color.type === 'cmyk' && color.c !== undefined) {
    // Simple CMYK to RGB conversion (no ICC profile)
    const c = color.c! / 100;
    const m = color.m! / 100;
    const y = color.y! / 100;
    const k = color.k! / 100;
    return {
      r: Math.round(255 * (1 - c) * (1 - k)),
      g: Math.round(255 * (1 - m) * (1 - k)),
      b: Math.round(255 * (1 - y) * (1 - k)),
    };
  }
  if (color.type === 'gray') {
    const v = Math.round(255 * (1 - (color.value as number ?? 0) / 100));
    return { r: v, g: v, b: v };
  }
  return null;
}

function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r / 255, g / 255, b / 255].map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function boundsOverlap(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return a.left < b.right && a.right > b.left && a.top > b.bottom && a.bottom < b.top;
}

export function register(server: McpServer): void {
  server.registerTool(
    'check_contrast',
    {
      title: 'Check Contrast',
      description:
        'Check WCAG color contrast ratios. Manual mode: provide two colors. Auto mode: detect overlapping foreground/background pairs in the document. Note: GrayColor uses ink-quantity interpretation (0=white, 100=black), which differs from the API reference.',
      inputSchema: {
        color1: z
          .object({
            type: z.enum(['cmyk', 'rgb', 'gray']),
            c: z.number().optional(),
            m: z.number().optional(),
            y: z.number().optional(),
            k: z.number().optional(),
            r: z.number().optional(),
            g: z.number().optional(),
            b: z.number().optional(),
            value: z.number().optional(),
          })
          .optional()
          .describe('First color (manual mode)'),
        color2: z
          .object({
            type: z.enum(['cmyk', 'rgb', 'gray']),
            c: z.number().optional(),
            m: z.number().optional(),
            y: z.number().optional(),
            k: z.number().optional(),
            r: z.number().optional(),
            g: z.number().optional(),
            b: z.number().optional(),
            value: z.number().optional(),
          })
          .optional()
          .describe('Second color (manual mode)'),
        auto_detect: z
          .boolean()
          .optional()
          .default(false)
          .describe('Auto-detect overlapping foreground/background color pairs in the document'),
      },
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      // Manual mode
      if (params.color1 && params.color2) {
        const rgb1 = colorToRGB(params.color1 as ColorValue);
        const rgb2 = colorToRGB(params.color2 as ColorValue);
        if (!rgb1 || !rgb2) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: true, message: 'Could not convert colors to RGB' }) }] };
        }
        const l1 = relativeLuminance(rgb1.r, rgb1.g, rgb1.b);
        const l2 = relativeLuminance(rgb2.r, rgb2.g, rgb2.b);
        const ratio = Math.round(contrastRatio(l1, l2) * 100) / 100;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  contrastRatio: ratio,
                  wcagAA_normal: ratio >= 4.5,
                  wcagAA_large: ratio >= 3,
                  wcagAAA: ratio >= 7,
                  color1_rgb: rgb1,
                  color2_rgb: rgb2,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // Auto-detect mode
      const result = (await executeJsx(jsxCode, params)) as {
        colorItems: ColorItem[];
        error?: boolean;
        message?: string;
      };

      if (result.error) {
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      const items = result.colorItems;
      const pairs: Array<{
        foreground: { color: ColorValue; uuid: string; name: string };
        background: { color: ColorValue; uuid: string; name: string };
        contrastRatio: number;
        wcagAA_normal: boolean;
        wcagAA_large: boolean;
        wcagAAA: boolean;
      }> = [];

      // Find overlapping pairs (text on shape, smaller on larger)
      for (let i = 0; i < items.length; i++) {
        for (let j = 0; j < items.length; j++) {
          if (i === j) continue;
          const fg = items[i];
          const bg = items[j];

          // Foreground should be text or smaller
          if (fg.type !== 'text' && fg.type !== 'path') continue;
          if (!fg.fillColor || !bg.fillColor) continue;
          if (!boundsOverlap(fg.bounds, bg.bounds)) continue;

          // Background should be larger (area comparison)
          const fgArea =
            (fg.bounds.right - fg.bounds.left) * (fg.bounds.top - fg.bounds.bottom);
          const bgArea =
            (bg.bounds.right - bg.bounds.left) * (bg.bounds.top - bg.bounds.bottom);
          if (fgArea >= bgArea) continue;

          const fgRgb = colorToRGB(fg.fillColor);
          const bgRgb = colorToRGB(bg.fillColor);
          if (!fgRgb || !bgRgb) continue;

          const l1 = relativeLuminance(fgRgb.r, fgRgb.g, fgRgb.b);
          const l2 = relativeLuminance(bgRgb.r, bgRgb.g, bgRgb.b);
          const ratio = Math.round(contrastRatio(l1, l2) * 100) / 100;

          pairs.push({
            foreground: { color: fg.fillColor, uuid: fg.uuid, name: fg.name },
            background: { color: bg.fillColor, uuid: bg.uuid, name: bg.name },
            contrastRatio: ratio,
            wcagAA_normal: ratio >= 4.5,
            wcagAA_large: ratio >= 3,
            wcagAAA: ratio >= 7,
          });
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

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ pairCount: unique.length, pairs: unique }, null, 2),
          },
        ],
      };
    },
  );
}
