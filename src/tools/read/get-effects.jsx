try {
  var err = preflightChecks();
  if (err) {
    writeResultFile(RESULT_PATH, err);
  } else {
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
      if (mode === BlendModes.SATURATION) return "saturationBlend";
      if (mode === BlendModes.COLOR) return "colorBlend";
      if (mode === BlendModes.LUMINOSITY) return "luminosity";
      return "unknown";
    }

    function getEffectInfo(item, coordSys) {
      var uuid = ensureUUID(item);
      var zIdx = getZIndex(item);
      var itemType = getItemType(item);
      var abIndex = getArtboardIndexForItem(item);
      var abRect = null;
      if (abIndex >= 0) { abRect = doc.artboards[abIndex].artboardRect; }
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

    function findByNote(items, uuid) {
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        try { if (item.note === uuid) return item; } catch(e) {}
        if (item.typename === "GroupItem") {
          try {
            var child = findByNote(item.pageItems, uuid);
            if (child) return child;
          } catch(e2) {}
        }
      }
      return null;
    }

    if (targetUuid) {
      // Find specific item by UUID
      var targetItem = null;
      for (var li = 0; li < doc.layers.length; li++) {
        targetItem = findByNote(doc.layers[li].pageItems, targetUuid);
        if (targetItem) break;
      }
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
      for (var j = 0; j < doc.pageItems.length; j++) {
        items.push(getEffectInfo(doc.pageItems[j], coordSystem));
      }
    }

    if (!targetUuid || items.length > 0) {
      writeResultFile(RESULT_PATH, {
        coordinateSystem: coordSystem,
        count: items.length,
        items: items
      });
    }
  }
} catch (e) {
  writeResultFile(RESULT_PATH, { error: true, message: e.message, line: e.line });
}
