import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeToolJsx } from '../tool-executor.js';
import { coordinateSystemSchema } from '../session.js';
import { WRITE_ANNOTATIONS } from './shared.js';

/**
 * place_image — 画像の配置（リンク/埋め込み）
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/PlacedItems/ — PlacedItems.add()
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/PlacedItem/ — file, embed()
 *
 * 注意: PlacedItem.file はリファレンスで read-only と記載されているが、
 * PlacedItems.add() 後に設定する方法が PlacedItems のドキュメントで推奨されている。
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var coordSystem = params.coordinate_system || "artboard-web";

    var filePath = params.file_path;
    var imgFile = new File(filePath);
    if (!imgFile.exists) {
      writeResultFile(RESULT_PATH, { error: true, message: "Image file not found: " + filePath });
    } else {
      var targetLayer = resolveTargetLayer(doc, params.layer_name);

      var placed = targetLayer.placedItems.add();
      placed.file = imgFile;

      // Position
      if (typeof params.x === "number" && typeof params.y === "number") {
        var abRect = (coordSystem === "artboard-web") ? getActiveArtboardRect() : null;
        var pos = webToAiPoint(params.x, params.y, coordSystem, abRect);
        placed.left = pos[0];
        placed.top = pos[1];
      }

      if (params.name) {
        placed.name = params.name;
      }

      // Embed if requested — embed() transforms PlacedItem into RasterItem
      var resultItem = placed;
      if (params.embed === true) {
        // Mark with a temporary tag before embed so we can find the resulting RasterItem
        var tag = "__place_image_embed_" + (new Date()).getTime();
        placed.name = tag;
        placed.embed();
        // After embed(), 'placed' is no longer valid. Find the RasterItem by name.
        var foundEmbedded = false;
        for (var ri = 0; ri < doc.rasterItems.length; ri++) {
          if (doc.rasterItems[ri].name === tag) {
            resultItem = doc.rasterItems[ri];
            foundEmbedded = true;
            break;
          }
        }
        if (!foundEmbedded) {
          writeResultFile(RESULT_PATH, { error: true, message: "embed() succeeded but resulting RasterItem could not be found" });
          return;
        }
        // タグ名をクリア（ユーザー指定名があれば復元、なければ空文字に）
        resultItem.name = params.name || "";
      }

      var uuid = ensureUUID(resultItem);
      var bounds = resultItem.geometricBounds;
      var widthPt = bounds[2] - bounds[0];
      var heightPt = -(bounds[3] - bounds[1]);
      if (widthPt < 0) widthPt = -widthPt;
      if (heightPt < 0) heightPt = -heightPt;

      writeResultFile(RESULT_PATH, {
        uuid: uuid,
        type: params.embed ? "embedded" : "linked",
        filePath: filePath,
        widthPt: widthPt,
        heightPt: heightPt,
        verified: verifyItem(resultItem)
      });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Failed to place image: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'place_image',
    {
      title: 'Place Image',
      description:
        'Place an image file (PNG, JPG, TIFF, PSD, etc.) into the document as a linked or embedded image. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        file_path: z.string().describe('Absolute path to the image file'),
        x: z.number().optional().describe('X position'),
        y: z.number().optional().describe('Y position'),
        embed: z
          .boolean()
          .optional()
          .default(false)
          .describe('Embed the image instead of linking (default: false)'),
        layer_name: z.string().optional().describe('Target layer name'),
        name: z.string().optional().describe('Object name'),
        coordinate_system: coordinateSystemSchema,
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      return executeToolJsx(jsxCode, params, { activate: true, resolveCoordinate: true });
    },
  );
}
