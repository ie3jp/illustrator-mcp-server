import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';

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
      var targetLayer = doc.activeLayer;
      if (params.layer_name) {
        try {
          targetLayer = doc.layers.getByName(params.layer_name);
        } catch (e) {
          targetLayer = doc.layers.add();
          targetLayer.name = params.layer_name;
        }
      }

      var placed = targetLayer.placedItems.add();
      placed.file = imgFile;

      // Position
      if (typeof params.x === "number" && typeof params.y === "number") {
        var inputX = params.x;
        var inputY = params.y;
        if (coordSystem === "artboard-web") {
          var ab = doc.artboards[doc.artboards.getActiveArtboardIndex()];
          var abRect = ab.artboardRect;
          placed.left = abRect[0] + inputX;
          placed.top = abRect[1] + (-inputY);
        } else {
          placed.left = inputX;
          placed.top = inputY;
        }
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
        for (var ri = 0; ri < doc.rasterItems.length; ri++) {
          if (doc.rasterItems[ri].name === tag) {
            resultItem = doc.rasterItems[ri];
            break;
          }
        }
        // Restore the requested name
        if (params.name) {
          resultItem.name = params.name;
        }
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
        heightPt: heightPt
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
        coordinate_system: z
          .enum(['artboard-web', 'document'])
          .optional()
          .default('artboard-web')
          .describe(
            'Coordinate system (artboard-web: artboard-relative Y-down, document: native Illustrator coordinates)',
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
