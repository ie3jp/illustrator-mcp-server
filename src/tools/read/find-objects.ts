import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import {
  coordinateSystemSchema,
  resolveCoordinateSystem,
} from '../session.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';

/**
 * find_objects — 条件によるオブジェクト検索
 * Search by name, type, layer, page_index. Use doc.allPageItems.
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var coordSystem = params.coordinate_system || "page-relative";
    var doc = app.activeDocument;
    var results = [];

    function matchesFilters(item) {
      // name filter（部分一致）
      if (params.name) {
        var itemName = "";
        try { itemName = item.name || ""; } catch (e) {}
        if (itemName.indexOf(params.name) < 0) { return false; }
      }

      // type filter
      var itemType = getItemType(item);
      if (params.type) {
        if (itemType !== params.type) { return false; }
      }

      // layer_name filter
      if (params.layer_name) {
        var layerName = getParentLayerName(item);
        if (layerName !== params.layer_name) { return false; }
      }

      // page_index filter
      if (params.page_index !== undefined) {
        var pageIdx = -1;
        try {
          var pp = item.parentPage;
          if (pp) pageIdx = pp.index;
        } catch (e) {}
        if (pageIdx !== params.page_index) { return false; }
      }

      // paragraph_style filter（テキストフレームのみ）
      if (params.paragraph_style) {
        if (itemType !== "TextFrame") { return false; }
        try {
          var tf = item;
          if (tf.paragraphs.length === 0) { return false; }
          var styleName = "";
          if (tf.paragraphs[0].appliedParagraphStyle) {
            styleName = tf.paragraphs[0].appliedParagraphStyle.name || "";
          }
          if (styleName.indexOf(params.paragraph_style) < 0) { return false; }
        } catch (e) { return false; }
      }

      // has_overflow filter
      if (params.has_overflow === true) {
        if (itemType !== "TextFrame") { return false; }
        try {
          if (!item.overflows) { return false; }
        } catch (e) { return false; }
      }

      return true;
    }

    var allItems = doc.allPageItems;
    for (var i = 0; i < allItems.length; i++) {
      var item = allItems[i];
      if (!matchesFilters(item)) { continue; }

      var pageIndex = -1;
      try {
        var pp = item.parentPage;
        if (pp) pageIndex = pp.index;
      } catch (e) {}

      var boundsObj = null;
      try {
        boundsObj = getBoundsOnPage(item, pageIndex);
      } catch (e) {
        try {
          var gb = item.geometricBounds;
          boundsObj = { top: gb[0], left: gb[1], bottom: gb[2], right: gb[3],
                        width: gb[3] - gb[1], height: gb[2] - gb[0] };
        } catch (e2) {}
      }

      var info = {
        uuid: ensureUUID(item),
        name: "",
        type: getItemType(item),
        pageIndex: pageIndex,
        bounds: boundsObj,
        layerName: getParentLayerName(item)
      };
      try { info.name = item.name || ""; } catch (e) {}

      // テキストフレームの追加情報
      if (info.type === "TextFrame") {
        try {
          var preview = item.contents || "";
          info.contentsPreview = preview.length > 80 ? preview.substring(0, 80) + "..." : preview;
        } catch (e) {}
        try { info.overflows = item.overflows; } catch (e) {}
      }

      results.push(info);
    }

    writeResultFile(RESULT_PATH, {
      coordinateSystem: coordSystem,
      count: results.length,
      objects: results
    });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "find_objects: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'find_objects',
    {
      title: 'Find Objects',
      description: 'Search InDesign page items by name (partial match), type, layer name, page index, paragraph style, or overflow status.',
      inputSchema: {
        name: z.string().optional().describe('Object name (partial match)'),
        type: z
          .enum(['Rectangle', 'Oval', 'Polygon', 'GraphicLine', 'TextFrame', 'Group', 'Image', 'EPS'])
          .optional()
          .describe('Object type'),
        layer_name: z.string().optional().describe('Layer name (exact match)'),
        page_index: z.number().int().min(0).optional().describe('Page index (0-based)'),
        paragraph_style: z.string().optional().describe('Paragraph style name of first paragraph (partial match, TextFrame only)'),
        has_overflow: z.boolean().optional().describe('Filter to only overflowing text frames'),
        coordinate_system: coordinateSystemSchema,
      },
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      const resolvedParams = {
        ...params,
        coordinate_system: await resolveCoordinateSystem(params.coordinate_system),
      };
      const result = await executeJsx(jsxCode, resolvedParams);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
