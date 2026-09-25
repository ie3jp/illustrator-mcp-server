import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { formatToolResult } from '../tool-executor.js';
import {
  coordinateSystemSchema,
  resolveCoordinateSystem,
} from '../session.js';
import { readImageDimensions } from '../../utils/image-header.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';
/**
 * get_images — 配置画像（リンク/埋め込み）の情報取得
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/PlacedItem/ — file, matrix, contentVariable
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/RasterItem/ — colorSpace, transparent, imageColorSpace
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var coordSystem = (params && params.coordinate_system) ? params.coordinate_system : "artboard-web";
    var includePrintInfo = (params && typeof params.include_print_info === "boolean") ? params.include_print_info : false;
    var doc = app.activeDocument;
    var docColorSpace = doc.documentColorSpace;
    var isCMYKDoc = (docColorSpace === DocumentColorSpace.CMYK);
    var images = [];

    // リンクファイルのパスと実在チェック。file の取得自体が失敗する場合もリンク切れとみなす
    function readLinkFile(target, info) {
      var f = null;
      try { f = target.file; } catch (e) {}
      if (!f) { info.linkBroken = true; return; }
      try { info.filePath = f.fsName; } catch (e) {}
      try { if (!f.exists) info.linkBroken = true; } catch (e) {}
    }

    // 変形行列（画像 1px あたりの pt）と回転前の配置サイズからピクセル数を求める。
    // geometricBounds は回転で膨らむ外接矩形（AABB）なので、そのまま割るとピクセル数を誤る。
    // AABB 幅 = W*|a| + H*|c|、AABB 高さ = W*|b| + H*|d|（W,H はピクセル数）を解く。
    // 45° 付近など解けない場合は null
    function pixelSizeFromMatrix(m, aabbW, aabbH) {
      var a = Math.abs(m.mValueA), b = Math.abs(m.mValueB);
      var c = Math.abs(m.mValueC), d = Math.abs(m.mValueD);
      var det = a * d - c * b;
      var scale = Math.max(a * d, c * b);
      if (scale <= 0 || Math.abs(det) < scale * 1e-3) return null;
      var w = (aabbW * d - c * aabbH) / det;
      var h = (a * aabbH - b * aabbW) / det;
      if (!(w > 0) || !(h > 0)) return null;
      return { width: Math.round(w), height: Math.round(h) };
    }

    // Linked images (PlacedItems)
    for (var i = 0; i < doc.placedItems.length; i++) {
      var item = doc.placedItems[i];
      var uuid = ensureUUID(item);
      var zIdx = getZIndex(item);
      var abIndex = getArtboardIndexForItem(item);
      var artboardRect = getArtboardRectByIndex(abIndex);
      var bounds = getBounds(item, coordSystem, artboardRect);

      var info = {
        uuid: uuid,
        zIndex: zIdx,
        type: "linked",
        filePath: "",
        linkBroken: false,
        resolution: null,
        colorSpace: null,
        pixelWidth: null,
        pixelHeight: null,
        artboardIndex: abIndex,
        bounds: bounds,
        widthPt: null,
        heightPt: null
      };

      readLinkFile(item, info);

      try { info.name = item.name || ""; } catch(e) {}

      // Store matrix scale factors for Node.js-side DPI calculation
      // Using matrix vector magnitude instead of geometricBounds to handle rotation correctly
      // (geometricBounds returns AABB which is larger when rotated, giving incorrect PPI)
      try {
        var pm = item.matrix;
        if (pm) {
          var psX = Math.sqrt(pm.mValueA * pm.mValueA + pm.mValueB * pm.mValueB);
          var psY = Math.sqrt(pm.mValueC * pm.mValueC + pm.mValueD * pm.mValueD);
          info.matrixScaleX = psX;
          info.matrixScaleY = psY;
        }
      } catch(e) {}
      // Fallback: also store geometricBounds dimensions
      try {
        var pBounds = item.geometricBounds;
        var pWidthPt = pBounds[2] - pBounds[0];
        var pHeightPt = -(pBounds[3] - pBounds[1]);
        if (pWidthPt < 0) pWidthPt = -pWidthPt;
        if (pHeightPt < 0) pHeightPt = -pHeightPt;
        info.widthPt = pWidthPt;
        info.heightPt = pHeightPt;
      } catch(e) {}

      images.push(info);
    }

    // Embedded / raster images (RasterItems)
    for (var j = 0; j < doc.rasterItems.length; j++) {
      var rItem = doc.rasterItems[j];
      var rUuid = ensureUUID(rItem);
      var rZIdx = getZIndex(rItem);
      var rAbIndex = getArtboardIndexForItem(rItem);
      var rArtboardRect = getArtboardRectByIndex(rAbIndex);
      var rBounds = getBounds(rItem, coordSystem, rArtboardRect);

      var rInfo = {
        uuid: rUuid,
        zIndex: rZIdx,
        type: rItem.embedded ? "embedded" : "linked",
        filePath: "",
        linkBroken: false,
        resolution: null,
        colorSpace: null,
        pixelWidth: null,
        pixelHeight: null,
        artboardIndex: rAbIndex,
        bounds: rBounds
      };

      try { rInfo.name = rItem.name || ""; } catch(e) {}

      // 非埋め込み（リンク）のラスタはファイルの実在を確認する
      if (!rItem.embedded) {
        readLinkFile(rItem, rInfo);
      }

      // colorSpace detection
      try {
        var cs = rItem.imageColorSpace;
        if (cs === ImageColorSpace.RGB) {
          rInfo.colorSpace = "RGB";
        } else if (cs === ImageColorSpace.CMYK) {
          rInfo.colorSpace = "CMYK";
        } else if (cs === ImageColorSpace.Grayscale) {
          rInfo.colorSpace = "grayscale";
        } else {
          rInfo.colorSpace = "other";
        }
      } catch (e) {}

      // pixel dimensions and resolution
      var ppiH = null;
      var ppiV = null;
      try {
        // geometricBounds: [left, top, right, bottom] in points（回転時は外接矩形）
        var gb = rItem.geometricBounds;
        var aabbWidthPt = Math.abs(gb[2] - gb[0]);
        var aabbHeightPt = Math.abs(gb[1] - gb[3]);
        var m = rItem.matrix;
        if (m) {
          // mValueA/mValueB が横方向、mValueC/mValueD が縦方向の基底ベクトル（1px あたりの pt）
          var scaleX = Math.sqrt(m.mValueA * m.mValueA + m.mValueB * m.mValueB);
          var scaleY = Math.sqrt(m.mValueC * m.mValueC + m.mValueD * m.mValueD);
          if (scaleX > 0 && scaleY > 0) {
            // 実効解像度 = 72 / (1px あたりの pt)。短辺側（低い方）を代表値にする
            ppiH = Math.round(72 / scaleX);
            ppiV = Math.round(72 / scaleY);
            rInfo.resolution = Math.min(ppiH, ppiV);
            var px = pixelSizeFromMatrix(m, aabbWidthPt, aabbHeightPt);
            if (px) {
              rInfo.pixelWidth = px.width;
              rInfo.pixelHeight = px.height;
            }
          }
        }
      } catch (e) {}

      // Print diagnostics
      if (includePrintInfo) {
        rInfo.colorSpaceMismatch = false;
        if (rInfo.colorSpace) {
          if (isCMYKDoc && rInfo.colorSpace === "RGB") rInfo.colorSpaceMismatch = true;
          if (!isCMYKDoc && rInfo.colorSpace === "CMYK") rInfo.colorSpaceMismatch = true;
        }
        // 縦横別の実効解像度（非等方に拡大縮小されている場合に差が出る）
        if (ppiH !== null && ppiV !== null) {
          rInfo.resolutionH = ppiH;
          rInfo.resolutionV = ppiV;
        }
      }

      images.push(rInfo);
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
      description:
        'Get embedded and linked image information: file path, broken-link status (linkBroken: file missing on disk), pixel size, and effective resolution (ppi at the placed size; rotation-safe).',
      inputSchema: {
        coordinate_system: coordinateSystemSchema,
        include_print_info: z
          .boolean()
          .optional()
          .default(false)
          .describe('Include print diagnostics: resolutionH/resolutionV (effective ppi per axis; they differ when scaled non-uniformly) and, for embedded raster images, a colorSpaceMismatch flag.'),
      },
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      const resolvedParams = { ...params, coordinate_system: await resolveCoordinateSystem(params.coordinate_system) };
      const result = (await executeJsx(jsxCode, resolvedParams)) as {
        imageCount: number;
        coordinateSystem: string;
        images: Array<{
          type: string;
          filePath: string;
          linkBroken: boolean;
          pixelWidth: number | null;
          pixelHeight: number | null;
          resolution: number | null;
          widthPt?: number | null;
          heightPt?: number | null;
          [key: string]: unknown;
        }>;
        [key: string]: unknown;
      };

      // Post-process: compute pixel dimensions and DPI for linked images
      if (result?.images) {
        for (const img of result.images) {
          if (img.type === 'linked' && img.filePath && !img.linkBroken) {
            try {
              const dims = readImageDimensions(img.filePath);
              if (dims) {
                img.pixelWidth = dims.width;
                img.pixelHeight = dims.height;
                // Use matrix scale factors for PPI calculation (rotation-safe)
                // Matrix scale = pt per pixel, so PPI = 72 / scale
                const matrixScaleX = img.matrixScaleX as number | undefined;
                const matrixScaleY = img.matrixScaleY as number | undefined;
                if (matrixScaleX && matrixScaleY && matrixScaleX > 0 && matrixScaleY > 0) {
                  const ppiH = Math.round(72 / matrixScaleX);
                  const ppiV = Math.round(72 / matrixScaleY);
                  img.resolution = Math.min(ppiH, ppiV);
                  if (resolvedParams.include_print_info) {
                    img.resolutionH = ppiH;
                    img.resolutionV = ppiV;
                  }
                } else if (img.widthPt && img.heightPt) {
                  // Fallback to geometricBounds (inaccurate for rotated images)
                  const widthInches = img.widthPt / 72;
                  const heightInches = img.heightPt / 72;
                  const ppiH = Math.round(dims.width / widthInches);
                  const ppiV = Math.round(dims.height / heightInches);
                  img.resolution = Math.min(ppiH, ppiV);
                  if (resolvedParams.include_print_info) {
                    img.resolutionH = ppiH;
                    img.resolutionV = ppiV;
                  }
                }
              }
            } catch {
              // Skip unreadable files
            }
          }
          // Clean up internal fields
          delete img.widthPt;
          delete img.heightPt;
          delete img.matrixScaleX;
          delete img.matrixScaleY;
        }
      }

      return formatToolResult(result);
    },
  );
}
