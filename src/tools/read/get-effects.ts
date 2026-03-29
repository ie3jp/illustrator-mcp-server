import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import {
  coordinateSystemSchema,
  resolveCoordinateSystem,
} from '../session.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';

const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var coordSystem = (params && params.coordinate_system) ? params.coordinate_system : "artboard-web";
    var targetUuid = (params && params.target) ? params.target : null;
    var selectionOnly = (params && params.selection_only === true) ? true : false;
    var doc = app.activeDocument;

    function blendModeToString(mode) {
      if (mode === BlendModes.NORMAL) return "normal";
      if (mode === BlendModes.MULTIPLY) return "multiply";
      if (mode === BlendModes.SCREEN) return "screen";
      if (mode === BlendModes.OVERLAY) return "overlay";
      if (mode === BlendModes.SOFTLIGHT) return "softLight";
      if (mode === BlendModes.HARDLIGHT) return "hardLight";
      if (mode === BlendModes.COLORDODGE) return "colorDodge";
      if (mode === BlendModes.COLORBURN) return "colorBurn";
      if (mode === BlendModes.DARKEN) return "darken";
      if (mode === BlendModes.LIGHTEN) return "lighten";
      if (mode === BlendModes.DIFFERENCE) return "difference";
      if (mode === BlendModes.EXCLUSION) return "exclusion";
      if (mode === BlendModes.HUE) return "hue";
      if (mode === BlendModes.SATURATIONBLEND) return "saturationBlend";
      if (mode === BlendModes.COLOR) return "colorBlend";
      if (mode === BlendModes.LUMINOSITY) return "luminosity";
      return "unknown";
    }

    function getEffectInfo(item, coordSys) {
      var uuid = ensureUUID(item);
      var zIdx = getZIndex(item);
      var itemType = getItemType(item);
      var abIndex = getArtboardIndexForItem(item);
      var abRect = getArtboardRectByIndex(abIndex);
      var bounds = getBounds(item, coordSys, abRect);

      var info = {
        uuid: uuid,
        zIndex: zIdx,
        name: "",
        type: itemType,
        bounds: bounds,
        opacity: 100,
        blendingMode: "normal",
        fill: null,
        stroke: null,
        limitations: "ExtendScript DOM cannot access: multiple fills/strokes (only first), live effects parameters, full appearance stack. Only opacity, blendingMode, and primary fill/stroke are returned."
      };

      try { info.name = item.name || ""; } catch(e) {}
      try { info.opacity = item.opacity; } catch(e) {}
      try { info.blendingMode = blendModeToString(item.blendingMode); } catch(e) {}

      // Fill and stroke info for path-like items
      try {
        if (itemType === "path") {
          info.fill = { filled: item.filled };
          if (item.filled) {
            info.fill.color = colorToObject(item.fillColor);
          }
          info.stroke = { stroked: item.stroked };
          if (item.stroked) {
            info.stroke.color = colorToObject(item.strokeColor);
            info.stroke.width = item.strokeWidth;
          }
        } else if (itemType === "compound-path") {
          if (item.pathItems.length > 0) {
            var fp = item.pathItems[0];
            info.fill = { filled: fp.filled };
            if (fp.filled) {
              info.fill.color = colorToObject(fp.fillColor);
            }
            info.stroke = { stroked: fp.stroked };
            if (fp.stroked) {
              info.stroke.color = colorToObject(fp.strokeColor);
              info.stroke.width = fp.strokeWidth;
            }
          }
        } else if (itemType === "text") {
          // TextFrameItem does not expose fill/stroke directly in the same way
          // but we can try character attributes
          try {
            if (item.textRanges.length > 0) {
              var tr = item.textRanges[0];
              var ca = tr.characterAttributes;
              info.fill = { filled: true, color: colorToObject(ca.fillColor) };
              if (ca.strokeWeight > 0) {
                info.stroke = { stroked: true, color: colorToObject(ca.strokeColor), width: ca.strokeWeight };
              } else {
                info.stroke = { stroked: false };
              }
            }
          } catch(e) {}
        }
      } catch(e) {}

      return info;
    }

    var items = [];

    if (targetUuid) {
      // Find specific item by UUID
      var targetItem = findItemByUUID(targetUuid);
      if (targetItem) {
        items.push(getEffectInfo(targetItem, coordSystem));
      } else {
        writeResultFile(RESULT_PATH, { error: true, message: "Item not found with UUID: " + targetUuid });
      }
    } else if (selectionOnly) {
      var sel = doc.selection;
      if (sel && sel.length > 0) {
        for (var si = 0; si < sel.length; si++) {
          items.push(getEffectInfo(sel[si], coordSystem));
        }
      }
    } else {
      function collectEffectItems(container) {
        for (var j = 0; j < container.pageItems.length; j++) {
          var pi = container.pageItems[j];
          items.push(getEffectInfo(pi, coordSystem));
          if (pi.typename === "GroupItem") {
            try { collectEffectItems(pi); } catch (e) {}
          }
        }
      }
      for (var li = 0; li < doc.layers.length; li++) {
        collectEffectItems(doc.layers[li]);
      }
    }

    if (!targetUuid || items.length > 0) {
      writeResultFile(RESULT_PATH, {
        coordinateSystem: coordSystem,
        count: items.length,
        items: items
      });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'get_effects',
    {
      title: 'Get Effects',
      description: 'Get effect and appearance information',
      inputSchema: {
        target: z.string().optional().describe('Filter by UUID for a specific object'),
        selection_only: z.boolean().optional().default(false).describe('Selected objects only'),
        coordinate_system: coordinateSystemSchema,
      },
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      const resolvedParams = { ...params, coordinate_system: await resolveCoordinateSystem(params.coordinate_system) };
      const result = await executeJsx(jsxCode, resolvedParams);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
