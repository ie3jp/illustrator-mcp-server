import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';
/**
 * extract_design_tokens — デザイントークン（色・タイポグラフィ・スペーシング）の抽出
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/Swatches/ — Swatches
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/CharacterAttributes/ — size, textFont
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var doc = app.activeDocument;
    var isCMYKDoc = (doc.documentColorSpace === DocumentColorSpace.CMYK);

    // Collect colors
    var fillColors = [];
    var strokeColors = [];
    for (var i = 0; i < doc.pathItems.length; i++) {
      var item = doc.pathItems[i];
      try {
        if (item.filled) fillColors.push(colorToObject(item.fillColor));
      } catch(e) {}
      try {
        if (item.stroked) strokeColors.push(colorToObject(item.strokeColor));
      } catch(e) {}
    }

    // Collect fonts and sizes from text frames
    var fontEntries = [];
    var textBounds = [];
    for (var ti = 0; ti < doc.textFrames.length; ti++) {
      var tf = doc.textFrames[ti];
      try {
        var b = tf.geometricBounds;
        textBounds.push({ left: b[0], top: b[1], right: b[2], bottom: b[3] });
        for (var ri = 0; ri < tf.textRanges.length; ri++) {
          var tr = tf.textRanges[ri];
          try {
            var ca = tr.characterAttributes;
            var fontName = "";
            var fontStyle = "";
            try { fontName = ca.textFont.name; } catch(e2) {}
            try { fontStyle = ca.textFont.style; } catch(e2) {}
            fontEntries.push({
              fontFamily: fontName,
              fontStyle: fontStyle,
              fontSize: ca.size
            });
          } catch(e2) {}
        }
      } catch(e) {}
    }

    // Collect object bounds for spacing analysis
    var objectBounds = [];
    for (var oi = 0; oi < doc.pageItems.length; oi++) {
      try {
        var ob = doc.pageItems[oi].geometricBounds;
        objectBounds.push({ left: ob[0], top: ob[1], right: ob[2], bottom: ob[3] });
      } catch(e) {}
    }

    writeResultFile(RESULT_PATH, {
      documentColorSpace: isCMYKDoc ? "CMYK" : "RGB",
      fillColors: fillColors,
      strokeColors: strokeColors,
      fontEntries: fontEntries,
      objectBounds: objectBounds
    });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: e.message, line: e.line });
  }
}
`;

// --- Node.js post-processing ---

interface ColorObj {
  type: string;
  c?: number;
  m?: number;
  y?: number;
  k?: number;
  r?: number;
  g?: number;
  b?: number;
  [key: string]: unknown;
}

function colorKey(c: ColorObj): string {
  if (c.type === 'cmyk') return `cmyk(${c.c},${c.m},${c.y},${c.k})`;
  if (c.type === 'rgb') return `rgb(${c.r},${c.g},${c.b})`;
  if (c.type === 'spot') return `spot(${c.name})`;
  if (c.type === 'gray') return `gray(${c.value})`;
  return `${c.type}`;
}

function colorToHex(c: ColorObj): string | null {
  let r: number, g: number, b: number;
  if (c.type === 'rgb') {
    r = c.r ?? 0;
    g = c.g ?? 0;
    b = c.b ?? 0;
  } else if (c.type === 'cmyk') {
    const ck = (c.k ?? 0) / 100;
    r = Math.round(255 * (1 - (c.c ?? 0) / 100) * (1 - ck));
    g = Math.round(255 * (1 - (c.m ?? 0) / 100) * (1 - ck));
    b = Math.round(255 * (1 - (c.y ?? 0) / 100) * (1 - ck));
  } else if (c.type === 'gray') {
    const v = Math.round(255 * (1 - ((c.value as number) ?? 0) / 100));
    r = v;
    g = v;
    b = v;
  } else {
    return null;
  }
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase()}`;
}

interface FontEntry {
  fontFamily: string;
  fontStyle: string;
  fontSize: number;
}

function formatTokens(
  format: string,
  colors: Array<{ hex: string; original: ColorObj; count: number }>,
  fonts: Array<{ family: string; style: string; size: number; count: number }>,
  spacings: number[],
): string {
  if (format === 'json') {
    const colorObj: Record<string, string> = {};
    colors.forEach((c, i) => {
      const name = i === 0 ? 'primary' : i === 1 ? 'secondary' : i === 2 ? 'tertiary' : `color-${i + 1}`;
      colorObj[name] = c.hex;
    });
    const fontObj: Record<string, { family: string; size: string; weight: string }> = {};
    fonts.forEach((f, i) => {
      const name = i === 0 ? 'heading' : i === 1 ? 'body' : `text-${i + 1}`;
      fontObj[name] = { family: f.family, size: `${f.size}pt`, weight: f.style };
    });
    return JSON.stringify({ color: colorObj, typography: fontObj, spacing: spacings.map((s) => `${s}pt`) }, null, 2);
  }

  if (format === 'tailwind') {
    const colorLines = colors.map((c, i) => {
      const name = i === 0 ? 'primary' : i === 1 ? 'secondary' : i === 2 ? 'tertiary' : `color-${i + 1}`;
      return `        '${name}': '${c.hex}',`;
    });
    const spacingLines = spacings.map((s) => `        '${s}': '${s}pt',`);
    return `// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
${colorLines.join('\n')}
      },
      spacing: {
${spacingLines.join('\n')}
      },
    },
  },
};`;
  }

  // CSS (default)
  const lines: string[] = [':root {'];
  colors.forEach((c, i) => {
    const name = i === 0 ? 'primary' : i === 1 ? 'secondary' : i === 2 ? 'tertiary' : `color-${i + 1}`;
    lines.push(`  --color-${name}: ${c.hex};`);
  });
  lines.push('');
  fonts.forEach((f, i) => {
    const name = i === 0 ? 'heading' : i === 1 ? 'body' : `text-${i + 1}`;
    lines.push(`  --font-${name}-family: "${f.family}";`);
    lines.push(`  --font-${name}-size: ${f.size}pt;`);
  });
  if (spacings.length > 0) {
    lines.push('');
    spacings.forEach((s) => {
      lines.push(`  --spacing-${s}: ${s}pt;`);
    });
  }
  lines.push('}');
  return lines.join('\n');
}

export function register(server: McpServer): void {
  server.registerTool(
    'extract_design_tokens',
    {
      title: 'Extract Design Tokens',
      description:
        'Extract colors, typography, and spacing from the document as design tokens in CSS custom properties, JSON, or Tailwind format',
      inputSchema: {
        format: z
          .enum(['css', 'json', 'tailwind'])
          .optional()
          .default('css')
          .describe('Output format'),
      },
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      const result = (await executeJsx(jsxCode, params)) as {
        fillColors: ColorObj[];
        strokeColors: ColorObj[];
        fontEntries: FontEntry[];
        objectBounds: Array<{ left: number; top: number; right: number; bottom: number }>;
        error?: boolean;
        message?: string;
      };

      if (result.error) {
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      // Deduplicate and count colors
      const colorCounts = new Map<string, { color: ColorObj; count: number }>();
      for (const c of [...result.fillColors, ...result.strokeColors]) {
        if (c.type === 'none' || c.type === 'pattern' || c.type === 'gradient') continue;
        const key = colorKey(c);
        const existing = colorCounts.get(key);
        if (existing) {
          existing.count++;
        } else {
          colorCounts.set(key, { color: c, count: 1 });
        }
      }

      const sortedColors = [...colorCounts.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, 12)
        .map((entry) => ({
          hex: colorToHex(entry.color) ?? colorKey(entry.color),
          original: entry.color,
          count: entry.count,
        }));

      // Deduplicate fonts
      const fontCounts = new Map<string, { entry: FontEntry; count: number }>();
      for (const f of result.fontEntries) {
        const key = `${f.fontFamily}|${f.fontStyle}|${Math.round(f.fontSize)}`;
        const existing = fontCounts.get(key);
        if (existing) {
          existing.count++;
        } else {
          fontCounts.set(key, { entry: f, count: 1 });
        }
      }

      const sortedFonts = [...fontCounts.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, 8)
        .map((entry) => ({
          family: entry.entry.fontFamily,
          style: entry.entry.fontStyle,
          size: Math.round(entry.entry.fontSize),
          count: entry.count,
        }));

      // Detect common spacing patterns
      const gaps: number[] = [];
      const bounds = result.objectBounds;
      for (let i = 0; i < bounds.length && i < 100; i++) {
        for (let j = i + 1; j < bounds.length && j < 100; j++) {
          const hGap = Math.abs(bounds[j].left - bounds[i].right);
          const vGap = Math.abs(bounds[i].bottom - bounds[j].top);
          if (hGap > 0 && hGap < 200) gaps.push(Math.round(hGap));
          if (vGap > 0 && vGap < 200) gaps.push(Math.round(vGap));
        }
      }

      // Find most common spacing values
      const gapCounts = new Map<number, number>();
      for (const g of gaps) {
        gapCounts.set(g, (gapCounts.get(g) ?? 0) + 1);
      }
      const commonSpacings = [...gapCounts.entries()]
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([val]) => val)
        .sort((a, b) => a - b);

      const output = formatTokens(params.format ?? 'css', sortedColors, sortedFonts, commonSpacings);

      return {
        content: [{ type: 'text', text: output }],
      };
    },
  );
}
