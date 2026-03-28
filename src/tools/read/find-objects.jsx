var err = preflightChecks();
if (err) {
  writeResultFile(RESULT_PATH, err);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var coordSystem = params.coordinate_system || "artboard-web";
    var doc = app.activeDocument;
    var results = [];

    function getArtboardRect(item) {
      var abIdx = getArtboardIndexForItem(item);
      if (abIdx >= 0) {
        return doc.artboards[abIdx].artboardRect;
      }
      return null;
    }

    function getParentLayerName(item) {
      var obj = item;
      try {
        while (obj) {
          if (obj.typename === "Layer") { return obj.name; }
          obj = obj.parent;
        }
      } catch (e) {}
      return "";
    }

    function colorsMatch(actual, expected) {
      var tol = (expected.tolerance !== undefined) ? expected.tolerance : 5;
      if (expected.type === "cmyk") {
        try {
          if (actual.typename !== "CMYKColor") { return false; }
          if (Math.abs(actual.cyan - expected.c) > tol) { return false; }
          if (Math.abs(actual.magenta - expected.m) > tol) { return false; }
          if (Math.abs(actual.yellow - expected.y) > tol) { return false; }
          if (Math.abs(actual.black - expected.k) > tol) { return false; }
          return true;
        } catch (e) { return false; }
      } else if (expected.type === "rgb") {
        try {
          if (actual.typename !== "RGBColor") { return false; }
          if (Math.abs(actual.red - expected.r) > tol) { return false; }
          if (Math.abs(actual.green - expected.g) > tol) { return false; }
          if (Math.abs(actual.blue - expected.b) > tol) { return false; }
          return true;
        } catch (e) { return false; }
      }
      return false;
    }

    function matchesFilters(item) {
      // name filter
      if (params.name) {
        var itemName = "";
        try { itemName = item.name || ""; } catch (e) {}
        if (itemName.indexOf(params.name) < 0) { return false; }
      }

      // type filter
      var itemType = getItemType(item);
      if (params.type) {
        if (itemType !== params.type) { return false; }
      }

      // layer_name filter
      if (params.layer_name) {
        var layerName = getParentLayerName(item);
        if (layerName !== params.layer_name) { return false; }
      }

      // artboard_index filter
      if (params.artboard_index !== undefined) {
        var abIdx = getArtboardIndexForItem(item);
        if (abIdx !== params.artboard_index) { return false; }
      }

      // fill_color filter
      if (params.fill_color) {
        try {
          if (item.typename !== "PathItem" && item.typename !== "CompoundPathItem") { return false; }
          if (!item.filled) { return false; }
          if (!colorsMatch(item.fillColor, params.fill_color)) { return false; }
        } catch (e) { return false; }
      }

      // stroke_color filter
      if (params.stroke_color) {
        try {
          if (item.typename !== "PathItem" && item.typename !== "CompoundPathItem") { return false; }
          if (!item.stroked) { return false; }
          if (!colorsMatch(item.strokeColor, params.stroke_color)) { return false; }
        } catch (e) { return false; }
      }

      // font_name filter
      if (params.font_name) {
        if (item.typename !== "TextFrame") { return false; }
        try {
          var fontFound = false;
          for (var t = 0; t < item.textRanges.length; t++) {
            var tf = item.textRanges[t].characterAttributes.textFont;
            var familyName = tf.family || "";
            var fontName = tf.name || "";
            if (familyName.indexOf(params.font_name) >= 0 || fontName.indexOf(params.font_name) >= 0) {
              fontFound = true;
              break;
            }
          }
          if (!fontFound) { return false; }
        } catch (e) { return false; }
      }

      // font_size filter
      if (params.font_size) {
        if (item.typename !== "TextFrame") { return false; }
        try {
          var size = item.textRanges[0].characterAttributes.size;
          if (params.font_size.min !== undefined && size < params.font_size.min) { return false; }
          if (params.font_size.max !== undefined && size > params.font_size.max) { return false; }
        } catch (e) { return false; }
      }

      return true;
    }

    function collectItems(container) {
      for (var i = 0; i < container.pageItems.length; i++) {
        var item = container.pageItems[i];
        if (matchesFilters(item)) {
          var abRect = getArtboardRect(item);
          var info = {
            uuid: ensureUUID(item),
            zIndex: getZIndex(item),
            name: "",
            type: getItemType(item),
            bounds: getBounds(item, coordSystem, abRect),
            layerName: getParentLayerName(item)
          };
          try { info.name = item.name || ""; } catch (e) {}
          results.push(info);
        }
        // Recurse into groups
        if (item.typename === "GroupItem") {
          try { collectItems(item); } catch (e) {}
        }
      }
    }

    for (var i = 0; i < doc.layers.length; i++) {
      collectItems(doc.layers[i]);
    }

    writeResultFile(RESULT_PATH, {
      coordinateSystem: coordSystem,
      count: results.length,
      objects: results
    });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "find_objects: " + e.message, line: e.line });
  }
}
