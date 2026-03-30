import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';

/**
 * get_styles — スタイル一覧の取得
 * List paragraph/character/object/table/cell styles with hierarchy (basedOn).
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var styleType = (params && params.style_type) ? params.style_type : "all";

    var result = {};

    // 段落スタイル
    if (styleType === "all" || styleType === "paragraph") {
      var paraStyles = [];
      for (var pi = 0; pi < doc.paragraphStyles.length; pi++) {
        var ps = doc.paragraphStyles[pi];
        var psInfo = {
          name: ps.name || "",
          basedOn: "",
          nextStyle: "",
          fontSize: 0,
          fontFamily: "",
          fontStyle: "",
          leading: 0,
          autoLeading: true,
          tracking: 0,
          justification: "left",
          spaceBefore: 0,
          spaceAfter: 0
        };
        try { if (ps.basedOn) psInfo.basedOn = ps.basedOn.name || ""; } catch (e2) {}
        try { if (ps.nextStyle) psInfo.nextStyle = ps.nextStyle.name || ""; } catch (e2) {}
        try { psInfo.fontSize = ps.pointSize || 0; } catch (e2) {}
        try {
          var paf = ps.appliedFont;
          if (paf) {
            psInfo.fontFamily = paf.fontFamily || "";
            psInfo.fontStyle = paf.fontStyleName || "";
          }
        } catch (e2) {}
        try { psInfo.leading = ps.leading || 0; } catch (e2) {}
        try { psInfo.autoLeading = ps.autoLeading !== false; } catch (e2) {}
        try { psInfo.tracking = ps.tracking || 0; } catch (e2) {}
        try {
          var pj = ps.justification;
          if (pj === Justification.LEFT_ALIGN) psInfo.justification = "left";
          else if (pj === Justification.CENTER_ALIGN) psInfo.justification = "center";
          else if (pj === Justification.RIGHT_ALIGN) psInfo.justification = "right";
          else if (pj === Justification.LEFT_JUSTIFIED) psInfo.justification = "justify-left";
          else if (pj === Justification.CENTER_JUSTIFIED) psInfo.justification = "justify-center";
          else if (pj === Justification.RIGHT_JUSTIFIED) psInfo.justification = "justify-right";
          else if (pj === Justification.FULLY_JUSTIFIED) psInfo.justification = "justify-all";
        } catch (e2) {}
        try { psInfo.spaceBefore = ps.spaceBefore || 0; } catch (e2) {}
        try { psInfo.spaceAfter = ps.spaceAfter || 0; } catch (e2) {}
        try {
          var fillColor = ps.fillColor;
          if (fillColor) psInfo.color = colorToObject(fillColor);
        } catch (e2) {}
        paraStyles.push(psInfo);
      }
      result.paragraphStyles = paraStyles;
      result.paragraphStyleCount = paraStyles.length;
    }

    // 文字スタイル
    if (styleType === "all" || styleType === "character") {
      var charStyles = [];
      for (var ci = 0; ci < doc.characterStyles.length; ci++) {
        var cs = doc.characterStyles[ci];
        var csInfo = {
          name: cs.name || "",
          basedOn: "",
          fontSize: 0,
          fontFamily: "",
          fontStyle: "",
          tracking: 0
        };
        try { if (cs.basedOn) csInfo.basedOn = cs.basedOn.name || ""; } catch (e2) {}
        try { csInfo.fontSize = cs.pointSize || 0; } catch (e2) {}
        try {
          var caf = cs.appliedFont;
          if (caf) {
            csInfo.fontFamily = caf.fontFamily || "";
            csInfo.fontStyle = caf.fontStyleName || "";
          }
        } catch (e2) {}
        try { csInfo.tracking = cs.tracking || 0; } catch (e2) {}
        try {
          var cfillColor = cs.fillColor;
          if (cfillColor) csInfo.color = colorToObject(cfillColor);
        } catch (e2) {}
        charStyles.push(csInfo);
      }
      result.characterStyles = charStyles;
      result.characterStyleCount = charStyles.length;
    }

    // オブジェクトスタイル
    if (styleType === "all" || styleType === "object") {
      var objStyles = [];
      try {
        for (var oi = 0; oi < doc.objectStyles.length; oi++) {
          var os = doc.objectStyles[oi];
          var osInfo = {
            name: os.name || "",
            basedOn: ""
          };
          try { if (os.basedOn) osInfo.basedOn = os.basedOn.name || ""; } catch (e2) {}
          try {
            var osFill = os.fillColor;
            if (osFill) osInfo.fillColor = colorToObject(osFill);
          } catch (e2) {}
          try {
            var osStroke = os.strokeColor;
            if (osStroke) osInfo.strokeColor = colorToObject(osStroke);
            osInfo.strokeWeight = os.strokeWeight || 0;
          } catch (e2) {}
          objStyles.push(osInfo);
        }
      } catch (e) {}
      result.objectStyles = objStyles;
      result.objectStyleCount = objStyles.length;
    }

    // テーブルスタイル
    if (styleType === "all" || styleType === "table") {
      var tableStyles = [];
      try {
        for (var tsi = 0; tsi < doc.tableStyles.length; tsi++) {
          var ts = doc.tableStyles[tsi];
          var tsInfo = {
            name: ts.name || "",
            basedOn: ""
          };
          try { if (ts.basedOn) tsInfo.basedOn = ts.basedOn.name || ""; } catch (e2) {}
          tableStyles.push(tsInfo);
        }
      } catch (e) {}
      result.tableStyles = tableStyles;
      result.tableStyleCount = tableStyles.length;
    }

    // セルスタイル
    if (styleType === "all" || styleType === "cell") {
      var cellStyles = [];
      try {
        for (var csi = 0; csi < doc.cellStyles.length; csi++) {
          var cst = doc.cellStyles[csi];
          var cstInfo = {
            name: cst.name || "",
            basedOn: ""
          };
          try { if (cst.basedOn) cstInfo.basedOn = cst.basedOn.name || ""; } catch (e2) {}
          cellStyles.push(cstInfo);
        }
      } catch (e) {}
      result.cellStyles = cellStyles;
      result.cellStyleCount = cellStyles.length;
    }

    writeResultFile(RESULT_PATH, result);
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "get_styles: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'get_styles',
    {
      title: 'Get Styles',
      description: 'List InDesign styles with hierarchy (basedOn). Supports paragraph, character, object, table, and cell styles. Returns font, size, color, leading, tracking, and justification where applicable.',
      inputSchema: {
        style_type: z
          .enum(['all', 'paragraph', 'character', 'object', 'table', 'cell'])
          .optional()
          .default('all')
          .describe('Type of styles to retrieve (default: all)'),
      },
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
