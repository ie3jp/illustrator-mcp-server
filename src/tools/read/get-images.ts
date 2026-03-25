import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import {
  coordinateSystemSchema,
  resolveCoordinateSystem,
} from '../session.js';
import { readImageDimensions } from '../../utils/image-header.js';

const jsxCode = `
try {
  var err = preflightChecks();
  if (err) {
    writeResultFile(RESULT_PATH, err);
  } else {
    var params = readParamsFile(PARAMS_PATH);
    var coordSystem = (params && params.coordinate_system) ? params.coordinate_system : "artboard-web";
    var includePrintInfo = (params && typeof params.include_print_info === "boolean") ? params.include_print_info : false;
    var doc = app.activeDocument;
    var docColorSpace = doc.documentColorSpace;
    var isCMYKDoc = (docColorSpace === DocumentColorSpace.CMYK);
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
        bounds: bounds,
        widthPt: null,
        heightPt: null
      };

      try {
        info.filePath = item.file.fsName;
      } catch (e) {
        info.linkBroken = true;
      }

      try { info.name = item.name || ""; } catch(e) {}

      // Store placed dimensions in points for Node.js-side DPI calculation
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
            // Use vector magnitude to handle rotation correctly
            // mValueA/mValueB form horizontal basis vector, mValueC/mValueD form vertical
            var scaleX = Math.sqrt(m.mValueA * m.mValueA + m.mValueB * m.mValueB);
            var scaleY = Math.sqrt(m.mValueC * m.mValueC + m.mValueD * m.mValueD);
            if (scaleX > 0 && scaleY > 0) {
              rInfo.pixelWidth = Math.round(placedWidthPt / scaleX);
              rInfo.pixelHeight = Math.round(placedHeightPt / scaleY);
              // PPI = pixels / (points / 72); use minimum of H and V
              var ppiH = Math.round(rInfo.pixelWidth / (placedWidthPt / 72));
              var ppiV = Math.round(rInfo.pixelHeight / (placedHeightPt / 72));
              rInfo.resolution = Math.min(ppiH, ppiV);
            }
          }
        } catch(e3) {}
      } catch (e) {}

      // Print diagnostics
      if (includePrintInfo) {
        rInfo.colorSpaceMismatch = false;
        if (rInfo.colorSpace) {
          if (isCMYKDoc && rInfo.colorSpace === "RGB") rInfo.colorSpaceMismatch = true;
          if (!isCMYKDoc && rInfo.colorSpace === "CMYK") rInfo.colorSpaceMismatch = true;
        }
        if (rInfo.pixelWidth && rInfo.pixelHeight && placedWidthPt > 0) {
          rInfo.scaleFactor = Math.round((placedWidthPt / rInfo.pixelWidth) * 100);
        }
      }

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
        coordinate_system: coordinateSystemSchema,
        include_print_info: z
          .boolean()
          .optional()
          .default(false)
          .describe('Include print diagnostics: color space mismatch flag, scale factor (%). Only available for embedded raster images.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const resolvedParams = { ...params, coordinate_system: resolveCoordinateSystem(params.coordinate_system) };
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
              if (dims && img.widthPt && img.heightPt) {
                img.pixelWidth = dims.width;
                img.pixelHeight = dims.height;
                const widthInches = img.widthPt / 72;
                const heightInches = img.heightPt / 72;
                const ppiH = Math.round(dims.width / widthInches);
                const ppiV = Math.round(dims.height / heightInches);
                img.resolution = Math.min(ppiH, ppiV);
                // Print diagnostics for linked images
                if (resolvedParams.include_print_info) {
                  img.scaleFactor = Math.round((img.widthPt / dims.width) * 100);
                }
              }
            } catch {
              // Skip unreadable files
            }
          }
          // Clean up internal fields
          delete img.widthPt;
          delete img.heightPt;
        }
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
