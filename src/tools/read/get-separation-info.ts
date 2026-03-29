import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeJsx } from '../../executor/jsx-runner.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';

const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var doc = app.activeDocument;
    var isCMYKDoc = (doc.documentColorSpace === DocumentColorSpace.CMYK);
    var separations = [];

    // Process colors (CMYK)
    if (isCMYKDoc) {
      separations.push({ name: "Cyan", type: "process", usageCount: 0 });
      separations.push({ name: "Magenta", type: "process", usageCount: 0 });
      separations.push({ name: "Yellow", type: "process", usageCount: 0 });
      separations.push({ name: "Black", type: "process", usageCount: 0 });
    }

    // Spot colors (spots[0] is registration, skip it)
    for (var si = 1; si < doc.spots.length; si++) {
      var spot = doc.spots[si];
      var spotInfo = {
        name: spot.name,
        type: "spot",
        usageCount: 0,
        color: null
      };
      try { spotInfo.color = colorToObject(spot.color); } catch(e) {}
      try {
        var sk = spot.spotKind;
        if (sk === SpotColorKind.SpotCMYK) spotInfo.spotKind = "CMYK";
        else if (sk === SpotColorKind.SpotRGB) spotInfo.spotKind = "RGB";
        else if (sk === SpotColorKind.SpotLAB) spotInfo.spotKind = "LAB";
        else spotInfo.spotKind = sk.toString();
      } catch(e) { spotInfo.spotKind = "unknown"; }
      separations.push(spotInfo);
    }

    // スポットカラー名→インデックスのマップを構築（O(1)ルックアップ）
    var spotIndex = {};
    for (var si2 = 0; si2 < separations.length; si2++) {
      spotIndex[separations[si2].name] = si2;
    }

    function countColorUsage(color) {
      if (color.typename === "CMYKColor" && isCMYKDoc) {
        if (color.cyan > 0) separations[0].usageCount++;
        if (color.magenta > 0) separations[1].usageCount++;
        if (color.yellow > 0) separations[2].usageCount++;
        if (color.black > 0) separations[3].usageCount++;
      } else if (color.typename === "SpotColor") {
        var idx = spotIndex[color.spot.name];
        if (idx !== undefined) separations[idx].usageCount++;
      }
    }

    // Count usage by iterating pathItems
    for (var pi = 0; pi < doc.pathItems.length; pi++) {
      var item = doc.pathItems[pi];
      try { if (item.filled) countColorUsage(item.fillColor); } catch(e) {}
      try { if (item.stroked) countColorUsage(item.strokeColor); } catch(e) {}
    }

    writeResultFile(RESULT_PATH, {
      documentColorSpace: isCMYKDoc ? "CMYK" : "RGB",
      separationCount: separations.length,
      separations: separations
    });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'get_separation_info',
    {
      title: 'Get Separation Info',
      description:
        'Get color separation information: CMYK process plates and spot color plates with usage counts',
      inputSchema: {},
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
