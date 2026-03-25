import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeJsx } from '../../executor/jsx-runner.js';

const jsxCode = `
try {
  var err = preflightChecks();
  if (err) {
    writeResultFile(RESULT_PATH, err);
  } else {
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
        if (sk === SpotColorKind.SPOTCMYK) spotInfo.spotKind = "CMYK";
        else if (sk === SpotColorKind.SPOTRGB) spotInfo.spotKind = "RGB";
        else if (sk === SpotColorKind.SPOTLAB) spotInfo.spotKind = "LAB";
        else spotInfo.spotKind = sk.toString();
      } catch(e) { spotInfo.spotKind = "unknown"; }
      separations.push(spotInfo);
    }

    // Count usage by iterating pathItems
    for (var pi = 0; pi < doc.pathItems.length; pi++) {
      var item = doc.pathItems[pi];
      // Check fill
      try {
        if (item.filled) {
          var fc = item.fillColor;
          if (fc.typename === "CMYKColor" && isCMYKDoc) {
            if (fc.cyan > 0) separations[0].usageCount++;
            if (fc.magenta > 0) separations[1].usageCount++;
            if (fc.yellow > 0) separations[2].usageCount++;
            if (fc.black > 0) separations[3].usageCount++;
          } else if (fc.typename === "SpotColor") {
            var spName = fc.spot.name;
            for (var ssi = 0; ssi < separations.length; ssi++) {
              if (separations[ssi].name === spName) {
                separations[ssi].usageCount++;
                break;
              }
            }
          }
        }
      } catch(e) {}
      // Check stroke
      try {
        if (item.stroked) {
          var sc = item.strokeColor;
          if (sc.typename === "CMYKColor" && isCMYKDoc) {
            if (sc.cyan > 0) separations[0].usageCount++;
            if (sc.magenta > 0) separations[1].usageCount++;
            if (sc.yellow > 0) separations[2].usageCount++;
            if (sc.black > 0) separations[3].usageCount++;
          } else if (sc.typename === "SpotColor") {
            var spName2 = sc.spot.name;
            for (var ssi2 = 0; ssi2 < separations.length; ssi2++) {
              if (separations[ssi2].name === spName2) {
                separations[ssi2].usageCount++;
                break;
              }
            }
          }
        }
      } catch(e) {}
    }

    writeResultFile(RESULT_PATH, {
      documentColorSpace: isCMYKDoc ? "CMYK" : "RGB",
      separationCount: separations.length,
      separations: separations
    });
  }
} catch (e) {
  writeResultFile(RESULT_PATH, { error: true, message: e.message, line: e.line });
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
