import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';

const jsxCode = `
try {
  var err = preflightChecks();
  if (err) {
    writeResultFile(RESULT_PATH, err);
  } else {
    var params = readParamsFile(PARAMS_PATH);
    var coordSystem = (params && params.coordinate_system) ? params.coordinate_system : "artboard-web";
    var doc = app.activeDocument;
    var images = [];

    // Linked images (PlacedItems)
    for (var i = 0; i < doc.placedItems.length; i++) {
      var item = doc.placedItems[i];
      var uuid = ensureUUID(item);
      var zIdx = getZIndex(item);
      var abIndex = getArtboardIndexForItem(item);
      var artboardRect = null;
      if (abIndex >= 0) {
        artboardRect = doc.artboards[abIndex].artboardRect;
      }
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
        bounds: bounds
      };

      try {
        info.filePath = item.file.fsName;
      } catch (e) {
        info.linkBroken = true;
      }

      try { info.name = item.name || ""; } catch(e) {}

      images.push(info);
    }

    // Embedded / raster images (RasterItems)
    for (var j = 0; j < doc.rasterItems.length; j++) {
      var rItem = doc.rasterItems[j];
      var rUuid = ensureUUID(rItem);
      var rZIdx = getZIndex(rItem);
      var rAbIndex = getArtboardIndexForItem(rItem);
      var rArtboardRect = null;
      if (rAbIndex >= 0) {
        rArtboardRect = doc.artboards[rAbIndex].artboardRect;
      }
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
      try {
        // geometricBounds: [left, top, right, bottom] in points
        var gb = rItem.geometricBounds;
        var placedWidthPt = gb[2] - gb[0];
        var placedHeightPt = -(gb[3] - gb[1]); // top > bottom in AI coords

        // RasterItem exposes matrix; columns/rows not directly available
        // but we can try to access them
        try {
          // Some versions expose these
          var pw = rItem.artworkKnockout; // dummy access to keep try block
        } catch(e2) {}

        // Attempt to get pixel size from the item's internal properties
        try {
          var m = rItem.matrix;
          if (m && placedWidthPt > 0 && placedHeightPt > 0) {
            // matrix.mValueA and mValueD give scale factors from pixels to points
            var scaleX = Math.abs(m.mValueA);
            var scaleY = Math.abs(m.mValueD);
            if (scaleX > 0 && scaleY > 0) {
              rInfo.pixelWidth = Math.round(placedWidthPt / scaleX);
              rInfo.pixelHeight = Math.round(placedHeightPt / scaleY);
              // PPI = pixels / (points / 72)
              rInfo.resolution = Math.round(rInfo.pixelWidth / (placedWidthPt / 72));
            }
          }
        } catch(e3) {}
      } catch (e) {}

      images.push(rInfo);
    }

    writeResultFile(RESULT_PATH, {
      imageCount: images.length,
      coordinateSystem: coordSystem,
      images: images
    });
  }
} catch (e) {
  writeResultFile(RESULT_PATH, { error: true, message: e.message, line: e.line });
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'get_images',
    {
      title: 'Get Images',
      description: 'Get embedded and linked image information',
      inputSchema: {
        coordinate_system: z
          .enum(['artboard-web', 'document'])
          .optional()
          .default('artboard-web'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
