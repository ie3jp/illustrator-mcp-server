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
    var target = params.target;
    var count = 0;
    var hasError = false;

    function createColor(colorObj) {
      if (!colorObj || colorObj.type === "none") return new NoColor();
      if (colorObj.type === "cmyk") {
        var c = new CMYKColor();
        c.cyan = (typeof colorObj.c === "number") ? colorObj.c : 0;
        c.magenta = (typeof colorObj.m === "number") ? colorObj.m : 0;
        c.yellow = (typeof colorObj.y === "number") ? colorObj.y : 0;
        c.black = (typeof colorObj.k === "number") ? colorObj.k : 0;
        return c;
      }
      if (colorObj.type === "rgb") {
        var c = new RGBColor();
        c.red = (typeof colorObj.r === "number") ? colorObj.r : 0;
        c.green = (typeof colorObj.g === "number") ? colorObj.g : 0;
        c.blue = (typeof colorObj.b === "number") ? colorObj.b : 0;
        return c;
      }
      return new NoColor();
    }

    function findItemByUUID(uuid) {
      var doc = app.activeDocument;
      function search(items) {
        for (var i = 0; i < items.length; i++) {
          var item = items[i];
          try {
            if (item.note === uuid) return item;
          } catch(e) {}
          if (item.typename === "GroupItem") {
            var found = search(item.pageItems);
            if (found) return found;
          }
        }
        return null;
      }
      for (var li = 0; li < doc.layers.length; li++) {
        var found = search(doc.layers[li].pageItems);
        if (found) return found;
      }
      return null;
    }

    if (target === "selection") {
      var sel = doc.selection;
      if (sel && sel.length > 0) {
        for (var i = sel.length - 1; i >= 0; i--) {
          try {
            if (sel[i].typename === "TextFrame") {
              sel[i].createOutline();
              count++;
            }
          } catch(e) {}
        }
      }
    } else if (target === "all") {
      var frames = doc.textFrames;
      for (var i = frames.length - 1; i >= 0; i--) {
        try {
          frames[i].createOutline();
          count++;
        } catch(e) {}
      }
    } else {
      // target is a layer name
      try {
        var layer = doc.layers.getByName(target);
        var frames = layer.textFrames;
        for (var i = frames.length - 1; i >= 0; i--) {
          try {
            frames[i].createOutline();
            count++;
          } catch(e) {}
        }
      } catch(e) {
        hasError = true;
        writeResultFile(RESULT_PATH, { error: true, message: "Layer not found: " + target });
      }
    }

    if (!hasError) {
      writeResultFile(RESULT_PATH, { success: true, convertedCount: count });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Failed to convert to outlines: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'convert_to_outlines',
    {
      title: 'Convert to Outlines',
      description: 'Convert text to outlines. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        target: z
          .string()
          .describe('Target: "selection" (selected), "all" (all text), or layer name'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
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
