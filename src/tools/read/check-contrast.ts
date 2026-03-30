import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';

/**
 * check_contrast — WCAG コントラスト比チェック（InDesign版）
 * Same concept, adapted for InDesign colors (swatches, colorToObject).
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

      // 全ページアイテムを走査
      var allItems = doc.allPageItems;
      for (var i = 0; i < allItems.length; i++) {
        var item = allItems[i];
        var itemType = getItemType(item);

        // テキストフレーム
        if (itemType === "TextFrame") {
          try {
            var b = item.geometricBounds; // [top, left, bottom, right]
            var tInfo = {
              uuid: ensureUUID(item),
              name: "",
              type: "TextFrame",
              bounds: { top: b[0], left: b[1], bottom: b[2], right: b[3] },
              fillColor: null
            };
            try { tInfo.name = item.name || item.contents.substring(0, 30); } catch (e2) {}

            // テキストフレームの先頭文字の色
            try {
              if (item.characters.length > 0) {
                tInfo.fillColor = colorToObject(item.characters[0].fillColor);
              }
            } catch (e2) {}

            if (tInfo.fillColor && tInfo.fillColor.type !== "none") {
              colorItems.push(tInfo);
            }
          } catch (e) {}
          continue;
        }

        // 矩形・楕円など（背景として機能する可能性）
        if (itemType === "Rectangle" || itemType === "Oval" || itemType === "Polygon") {
          try {
            var sb = item.geometricBounds;
            var sInfo = {
              uuid: ensureUUID(item),
              name: "",
              type: itemType,
              bounds: { top: sb[0], left: sb[1], bottom: sb[2], right: sb[3] },
              fillColor: null
            };
            try { sInfo.name = item.name || ""; } catch (e2) {}
            try { sInfo.fillColor = colorToObject(item.fillColor); } catch (e2) {}
            if (sInfo.fillColor && sInfo.fillColor.type !== "none") {
              colorItems.push(sInfo);
            }
          } catch (e) {}
        }
      }

      writeResultFile(RESULT_PATH, { colorItems: colorItems });
    } else {
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
  value?: number;
  [key: string]: unknown;
}

interface ColorItem {
  uuid: string;
  name: string;
  type: string;
  bounds: { top: number; left: number; bottom: number; right: number };
  fillColor: ColorValue | null;
}

function colorToRGB(color: ColorValue): { r: number; g: number; b: number } | null {
  if (color.type === 'rgb' && color.r !== undefined) {
    return { r: color.r, g: color.g!, b: color.b! };
  }
  if (color.type === 'cmyk' && color.c !== undefined) {
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
    const v = Math.round(255 * (1 - ((color.value as number) ?? 0) / 100));
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
  a: { top: number; left: number; bottom: number; right: number },
  b: { top: number; left: number; bottom: number; right: number },
): boolean {
  // InDesign: Y is down, so top < bottom
  return (
    a.left < b.right &&
    a.right > b.left &&
    a.top < b.bottom &&
    a.bottom > b.top
  );
}

export function register(server: McpServer): void {
  server.registerTool(
    'check_contrast',
    {
      title: 'Check Contrast',
      description:
        'Check WCAG color contrast ratios for InDesign. Manual mode: provide two colors. Auto mode: detect overlapping foreground/background pairs in the document. Colors can be CMYK, RGB, or gray.',
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
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: true, message: 'Could not convert colors to RGB' }),
              },
            ],
          };
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

          if (fg.type !== 'TextFrame' && fg.type !== 'Rectangle' && fg.type !== 'Oval') continue;
          if (!fg.fillColor || !bg.fillColor) continue;
          if (!boundsOverlap(fg.bounds, bg.bounds)) continue;

          const fgArea =
            (fg.bounds.right - fg.bounds.left) * (fg.bounds.bottom - fg.bounds.top);
          const bgArea =
            (bg.bounds.right - bg.bounds.left) * (bg.bounds.bottom - bg.bounds.top);
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
