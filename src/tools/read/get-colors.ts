import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';

/**
 * get_colors — ドキュメントの色情報取得
 * doc.swatches, doc.colors with color space info. No gradients/patterns collection like Illustrator.
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var includeSwatches = (params && typeof params.include_swatches === "boolean") ? params.include_swatches : true;
    var includeColors = (params && typeof params.include_colors === "boolean") ? params.include_colors : true;
    var includeTints = (params && typeof params.include_tints === "boolean") ? params.include_tints : true;
    var includeGradients = (params && typeof params.include_gradients === "boolean") ? params.include_gradients : true;

    var result = {};

    // スウォッチ一覧（全スウォッチ：色、グラデーション、ティント、なし、ペーパーを含む）
    if (includeSwatches) {
      var swatches = [];
      for (var si = 0; si < doc.swatches.length; si++) {
        var sw = doc.swatches[si];
        var swInfo = {
          name: sw.name,
          swatchType: sw.constructor.name || "Swatch"
        };
        try { swInfo.color = colorToObject(sw.color); } catch (e2) {}
        try {
          swInfo.colorSpace = "";
          var cs = sw.space;
          if (cs === ColorSpace.CMYK) swInfo.colorSpace = "CMYK";
          else if (cs === ColorSpace.RGB) swInfo.colorSpace = "RGB";
          else if (cs === ColorSpace.LAB) swInfo.colorSpace = "LAB";
          else swInfo.colorSpace = String(cs);
        } catch (e2) {}
        try {
          var cm = sw.model;
          if (cm === ColorModel.PROCESS) swInfo.colorModel = "process";
          else if (cm === ColorModel.SPOT) swInfo.colorModel = "spot";
          else if (cm === ColorModel.REGISTRATION) swInfo.colorModel = "registration";
          else if (cm === ColorModel.MIXED) swInfo.colorModel = "mixed";
          else swInfo.colorModel = "unknown";
        } catch (e2) { swInfo.colorModel = "unknown"; }
        swatches.push(swInfo);
      }
      result.swatches = swatches;
      result.swatchCount = swatches.length;
    }

    // プロセスカラー一覧（doc.colors）
    if (includeColors) {
      var colors = [];
      try {
        for (var ci = 0; ci < doc.colors.length; ci++) {
          var col = doc.colors[ci];
          var colInfo = {
            name: col.name,
            colorModel: "process",
            colorSpace: ""
          };
          try {
            var ccm = col.model;
            if (ccm === ColorModel.PROCESS) colInfo.colorModel = "process";
            else if (ccm === ColorModel.SPOT) colInfo.colorModel = "spot";
            else if (ccm === ColorModel.REGISTRATION) colInfo.colorModel = "registration";
          } catch (e2) {}
          try {
            var ccs = col.space;
            if (ccs === ColorSpace.CMYK) colInfo.colorSpace = "CMYK";
            else if (ccs === ColorSpace.RGB) colInfo.colorSpace = "RGB";
            else if (ccs === ColorSpace.LAB) colInfo.colorSpace = "LAB";
          } catch (e2) {}
          try { colInfo.colorValue = col.colorValue; } catch (e2) {}
          colors.push(colInfo);
        }
      } catch (e) {}
      result.colors = colors;
      result.colorCount = colors.length;
    }

    // ティント一覧（doc.tints）
    if (includeTints) {
      var tints = [];
      try {
        for (var ti = 0; ti < doc.tints.length; ti++) {
          var tint = doc.tints[ti];
          var tintInfo = {
            name: tint.name,
            tintValue: 0,
            baseSwatch: ""
          };
          try { tintInfo.tintValue = tint.tintValue || 0; } catch (e2) {}
          try {
            if (tint.baseColor) {
              tintInfo.baseSwatch = tint.baseColor.name || "";
            }
          } catch (e2) {}
          tints.push(tintInfo);
        }
      } catch (e) {}
      result.tints = tints;
      result.tintCount = tints.length;
    }

    // グラデーション一覧（doc.gradients）
    if (includeGradients) {
      var gradients = [];
      try {
        for (var gi = 0; gi < doc.gradients.length; gi++) {
          var grad = doc.gradients[gi];
          var gradInfo = {
            name: grad.name,
            type: "linear"
          };
          try {
            var gt = grad.type;
            if (gt === GradientType.LINEAR) gradInfo.type = "linear";
            else if (gt === GradientType.RADIAL) gradInfo.type = "radial";
          } catch (e2) {}
          try {
            var gradStops = [];
            for (var gsi = 0; gsi < grad.gradientStops.length; gsi++) {
              var gs = grad.gradientStops[gsi];
              var stopInfo = {
                location: 0,
                midpoint: 50,
                opacity: 100,
                swatchName: ""
              };
              try { stopInfo.location = gs.location || 0; } catch (e2) {}
              try { stopInfo.midpoint = gs.midpoint || 50; } catch (e2) {}
              try { stopInfo.opacity = gs.opacity || 100; } catch (e2) {}
              try {
                if (gs.stopColor) stopInfo.swatchName = gs.stopColor.name || "";
              } catch (e2) {}
              gradStops.push(stopInfo);
            }
            gradInfo.stops = gradStops;
          } catch (e2) {}
          gradients.push(gradInfo);
        }
      } catch (e) {}
      result.gradients = gradients;
      result.gradientCount = gradients.length;
    }

    // 混合インク一覧（doc.mixedInks）
    var mixedInks = [];
    try {
      for (var mi = 0; mi < doc.mixedInks.length; mi++) {
        var mk = doc.mixedInks[mi];
        mixedInks.push({ name: mk.name });
      }
    } catch (e) {}
    result.mixedInks = mixedInks;

    writeResultFile(RESULT_PATH, result);
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Failed to get color information: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'get_colors',
    {
      title: 'Get Colors',
      description: 'Get all color information from InDesign document: swatches, process colors, tints, gradients, and mixed inks with color space and model details.',
      inputSchema: {
        include_swatches: z
          .boolean()
          .optional()
          .default(true)
          .describe('Include swatch list (default: true)'),
        include_colors: z
          .boolean()
          .optional()
          .default(true)
          .describe('Include doc.colors (process/spot colors) list (default: true)'),
        include_tints: z
          .boolean()
          .optional()
          .default(true)
          .describe('Include tint list (default: true)'),
        include_gradients: z
          .boolean()
          .optional()
          .default(true)
          .describe('Include gradient list (default: true)'),
      },
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
