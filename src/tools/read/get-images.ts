import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import {
  coordinateSystemSchema,
  resolveCoordinateSystem,
} from '../session.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';

/**
 * get_images — 配置画像（リンク/埋め込み）の情報取得
 * doc.allGraphics + graphic.itemLink for link info. Show status, filePath, dimensions.
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var coordSystem = (params && params.coordinate_system) ? params.coordinate_system : "page-relative";
    var filterPage = (params && typeof params.page_index === "number") ? params.page_index : null;
    var doc = app.activeDocument;
    var images = [];

    // doc.allGraphics: Image, EPS, PDF, WMF, PICT, などのグラフィックアイテム
    var graphics = doc.allGraphics;

    for (var i = 0; i < graphics.length; i++) {
      var gfx = graphics[i];

      // 親フレーム（コンテナ）
      var container = null;
      try { container = gfx.parent; } catch (e) {}
      if (!container) continue;

      // ページフィルタ
      var pageIndex = -1;
      try {
        var pp = container.parentPage;
        if (pp) pageIndex = pp.index;
      } catch (e) {}

      if (filterPage !== null && pageIndex !== filterPage) continue;

      var uuid = ensureUUID(container);

      var info = {
        uuid: uuid,
        containerType: getItemType(container),
        pageIndex: pageIndex,
        linkStatus: "embedded",
        linkName: "",
        filePath: "",
        linkBroken: false,
        colorSpace: "",
        resolution: null,
        actualWidth: null,
        actualHeight: null,
        effectiveWidth: null,
        effectiveHeight: null,
        bounds: null,
        layerName: getParentLayerName(container)
      };

      try { info.name = container.name || ""; } catch (e) {}

      // リンク情報
      try {
        var lnk = gfx.itemLink;
        if (lnk) {
          info.linkName = lnk.name || "";
          try { info.filePath = lnk.filePath || ""; } catch (e2) {}

          var ls = lnk.status;
          if (ls === LinkStatus.NORMAL) info.linkStatus = "normal";
          else if (ls === LinkStatus.LINK_MISSING) { info.linkStatus = "missing"; info.linkBroken = true; }
          else if (ls === LinkStatus.LINK_OUT_OF_DATE) info.linkStatus = "out-of-date";
          else if (ls === LinkStatus.LINK_INACCESSIBLE) { info.linkStatus = "inaccessible"; info.linkBroken = true; }
          else info.linkStatus = "unknown";
        }
      } catch (e) {}

      // 画像のカラースペース
      try {
        var imgCS = gfx.imageTypeName || "";
        info.colorSpace = imgCS;
      } catch (e) {}

      // 実際の解像度とサイズ（リンク情報から）
      try {
        var lnk2 = gfx.itemLink;
        if (lnk2) {
          try { info.actualWidth = lnk2.width || null; } catch (e2) {}
          try { info.actualHeight = lnk2.height || null; } catch (e2) {}
          try { info.resolution = lnk2.horizontalResolution || null; } catch (e2) {}
        }
      } catch (e) {}

      // コンテナのバウンズ（ページ相対）
      try {
        var cb = getBoundsOnPage(container, pageIndex);
        info.bounds = cb;
        info.effectiveWidth = cb.width;
        info.effectiveHeight = cb.height;
      } catch (e) {
        try {
          var cgb = container.geometricBounds;
          info.bounds = { top: cgb[0], left: cgb[1], bottom: cgb[2], right: cgb[3],
                          width: cgb[3] - cgb[1], height: cgb[2] - cgb[0] };
          info.effectiveWidth = info.bounds.width;
          info.effectiveHeight = info.bounds.height;
        } catch (e2) {}
      }

      // スケール率
      try {
        info.scaleX = gfx.horizontalScale || 100;
        info.scaleY = gfx.verticalScale || 100;
      } catch (e) {}

      images.push(info);
    }

    writeResultFile(RESULT_PATH, {
      imageCount: images.length,
      coordinateSystem: coordSystem,
      images: images
    });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'get_images',
    {
      title: 'Get Images',
      description: 'Get all placed graphics in InDesign document via doc.allGraphics. Shows link status, file path, color space, resolution, dimensions, and scale.',
      inputSchema: {
        page_index: z.number().int().min(0).optional().describe('Filter by page index (0-based)'),
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
