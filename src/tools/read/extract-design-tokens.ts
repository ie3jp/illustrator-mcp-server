import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as fs from 'fs/promises';
import { executeJsx } from '../../executor/jsx-runner.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';

/**
 * extract_design_tokens — デザイントークン抽出（InDesign版）
 * Extract swatches, paragraph styles, character styles, object styles as tokens.
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var doc = app.activeDocument;

    // スウォッチ収集
    var swatchTokens = [];
    for (var si = 0; si < doc.swatches.length; si++) {
      var sw = doc.swatches[si];
      var swName = sw.name || "";
      if (swName === "None" || swName === "Paper" || swName === "Black" || swName === "Registration") {
        // 基本スウォッチは保持
      }
      var swInfo = { name: swName };
      try { swInfo.color = colorToObject(sw.color); } catch (e2) {}
      try {
        var cs = sw.space;
        if (cs === ColorSpace.CMYK) swInfo.colorSpace = "CMYK";
        else if (cs === ColorSpace.RGB) swInfo.colorSpace = "RGB";
        else swInfo.colorSpace = "unknown";
      } catch (e2) {}
      try {
        var cm = sw.model;
        if (cm === ColorModel.SPOT) swInfo.isSpot = true;
        else swInfo.isSpot = false;
      } catch (e2) { swInfo.isSpot = false; }
      swatchTokens.push(swInfo);
    }

    // 段落スタイル収集
    var paraStyleTokens = [];
    for (var pi = 0; pi < doc.paragraphStyles.length; pi++) {
      var ps = doc.paragraphStyles[pi];
      var psInfo = {
        name: ps.name || "",
        basedOn: ""
      };
      try {
        if (ps.basedOn) psInfo.basedOn = ps.basedOn.name || "";
      } catch (e2) {}
      try { psInfo.fontSize = ps.pointSize || 0; } catch (e2) {}
      try {
        var paf = ps.appliedFont;
        if (paf) {
          psInfo.fontFamily = paf.fontFamily || "";
          psInfo.fontStyle = paf.fontStyleName || "";
        }
      } catch (e2) {}
      try { psInfo.leading = ps.leading || 0; } catch (e2) {}
      try { psInfo.tracking = ps.tracking || 0; } catch (e2) {}
      try {
        var pj = ps.justification;
        if (pj === Justification.LEFT_ALIGN) psInfo.justification = "left";
        else if (pj === Justification.CENTER_ALIGN) psInfo.justification = "center";
        else if (pj === Justification.RIGHT_ALIGN) psInfo.justification = "right";
        else if (pj === Justification.LEFT_JUSTIFIED) psInfo.justification = "justify-left";
        else if (pj === Justification.FULLY_JUSTIFIED) psInfo.justification = "justify-all";
        else psInfo.justification = "unknown";
      } catch (e2) {}
      try {
        if (ps.appliedParagraphStyle) {
          psInfo.basedOn = ps.appliedParagraphStyle.name || "";
        }
      } catch (e2) {}
      paraStyleTokens.push(psInfo);
    }

    // 文字スタイル収集
    var charStyleTokens = [];
    for (var ci = 0; ci < doc.characterStyles.length; ci++) {
      var cst = doc.characterStyles[ci];
      var csInfo = {
        name: cst.name || "",
        basedOn: ""
      };
      try {
        if (cst.basedOn) csInfo.basedOn = cst.basedOn.name || "";
      } catch (e2) {}
      try { csInfo.fontSize = cst.pointSize || 0; } catch (e2) {}
      try {
        var caf = cst.appliedFont;
        if (caf) {
          csInfo.fontFamily = caf.fontFamily || "";
          csInfo.fontStyle = caf.fontStyleName || "";
        }
      } catch (e2) {}
      try { csInfo.tracking = cst.tracking || 0; } catch (e2) {}
      charStyleTokens.push(csInfo);
    }

    // オブジェクトスタイル収集
    var objStyleTokens = [];
    try {
      for (var oi = 0; oi < doc.objectStyles.length; oi++) {
        var os = doc.objectStyles[oi];
        var osInfo = {
          name: os.name || "",
          basedOn: ""
        };
        try {
          if (os.basedOn) osInfo.basedOn = os.basedOn.name || "";
        } catch (e2) {}
        objStyleTokens.push(osInfo);
      }
    } catch (e) {}

    // ページサイズ情報
    var docPrefs = doc.documentPreferences;
    var pageWidth = 0;
    var pageHeight = 0;
    try {
      pageWidth = docPrefs.pageWidth;
      pageHeight = docPrefs.pageHeight;
    } catch (e) {}

    writeResultFile(RESULT_PATH, {
      swatches: swatchTokens,
      paragraphStyles: paraStyleTokens,
      characterStyles: charStyleTokens,
      objectStyles: objStyleTokens,
      pageWidth: pageWidth,
      pageHeight: pageHeight
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

interface StyleToken {
  name: string;
  basedOn?: string;
  fontSize?: number;
  fontFamily?: string;
  fontStyle?: string;
  leading?: number;
  tracking?: number;
  justification?: string;
  [key: string]: unknown;
}

interface SwatchToken {
  name: string;
  color?: ColorObj;
  colorSpace?: string;
  isSpot?: boolean;
}

function formatTokens(
  format: string,
  swatches: SwatchToken[],
  paraStyles: StyleToken[],
  charStyles: StyleToken[],
): string {
  if (format === 'json') {
    const colorObj: Record<string, string> = {};
    swatches.forEach((sw) => {
      if (sw.color) {
        const hex = colorToHex(sw.color);
        if (hex) {
          colorObj[sw.name] = hex;
        }
      }
    });

    const typoObj: Record<string, Record<string, string>> = {};
    paraStyles.forEach((ps) => {
      if (ps.name && ps.name !== '[No Paragraph Style]') {
        typoObj[ps.name] = {
          fontFamily: ps.fontFamily ?? '',
          fontSize: ps.fontSize ? `${ps.fontSize}pt` : '',
          fontStyle: ps.fontStyle ?? '',
          leading: ps.leading ? `${ps.leading}pt` : '',
        };
      }
    });

    return JSON.stringify({ color: colorObj, typography: typoObj }, null, 2);
  }

  if (format === 'tailwind') {
    const colorLines = swatches
      .filter((sw) => sw.color && colorToHex(sw.color))
      .map((sw) => `        '${sw.name.replace(/\s+/g, '-').toLowerCase()}': '${colorToHex(sw.color!)!}',`);
    return `// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
${colorLines.join('\n')}
      },
    },
  },
};`;
  }

  // CSS (default)
  const lines: string[] = [':root {'];
  swatches.forEach((sw) => {
    if (sw.color) {
      const hex = colorToHex(sw.color);
      if (hex) {
        const varName = sw.name.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
        lines.push(`  --color-${varName}: ${hex}; /* ${sw.name} */`);
      }
    }
  });
  lines.push('');
  paraStyles.forEach((ps) => {
    if (ps.name && ps.name !== '[No Paragraph Style]' && ps.fontFamily) {
      const varName = ps.name.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
      lines.push(`  --font-${varName}-family: "${ps.fontFamily}";`);
      if (ps.fontSize) lines.push(`  --font-${varName}-size: ${ps.fontSize}pt;`);
      if (ps.leading && ps.fontSize) {
        lines.push(`  --font-${varName}-line-height: ${(ps.leading / ps.fontSize).toFixed(2)};`);
      }
    }
  });
  lines.push('}');
  return lines.join('\n');
}

export function register(server: McpServer): void {
  server.registerTool(
    'extract_design_tokens',
    {
      title: 'Extract Design Tokens',
      description:
        'Extract InDesign design tokens: swatches (with hex conversion), paragraph styles, character styles, and object styles. Output as CSS custom properties, JSON, or Tailwind config.',
      inputSchema: {
        format: z
          .enum(['css', 'json', 'tailwind'])
          .optional()
          .default('css')
          .describe('Output format'),
        output_path: z
          .string()
          .optional()
          .describe('File path to save the output. If omitted, returns text only.'),
      },
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      const result = (await executeJsx(jsxCode, params)) as {
        swatches: SwatchToken[];
        paragraphStyles: StyleToken[];
        characterStyles: StyleToken[];
        objectStyles: StyleToken[];
        error?: boolean;
        message?: string;
      };

      if (result.error) {
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      const output = formatTokens(
        params.format ?? 'css',
        result.swatches ?? [],
        result.paragraphStyles ?? [],
        result.characterStyles ?? [],
      );

      if (params.output_path) {
        try {
          await fs.writeFile(params.output_path, output, 'utf-8');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { content: [{ type: 'text', text: `Failed to write file: ${msg}` }] };
        }
        return {
          content: [{ type: 'text', text: output + `\n\nSaved to: ${params.output_path}` }],
        };
      }

      return {
        content: [{ type: 'text', text: output }],
      };
    },
  );
}
