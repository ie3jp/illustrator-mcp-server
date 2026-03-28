var err = preflightChecks();
if (err) {
  writeResultFile(RESULT_PATH, err);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var maxDepth = (params.depth !== undefined) ? params.depth : 999;
    var filterArtboard = (params.artboard_index !== undefined) ? params.artboard_index : -1;
    var coordSystem = params.coordinate_system || "artboard-web";
    var doc = app.activeDocument;

    function getArtboardRect(item) {
      var abIdx = getArtboardIndexForItem(item);
      if (abIdx >= 0) {
        return doc.artboards[abIdx].artboardRect;
      }
      return null;
    }

    function shouldIncludeItem(item) {
      if (filterArtboard < 0) { return true; }
      var abIdx = getArtboardIndexForItem(item);
      return abIdx === filterArtboard;
    }

    function traverseItems(container, currentDepth) {
      var children = [];
      if (currentDepth >= maxDepth) { return children; }
      for (var i = 0; i < container.pageItems.length; i++) {
        var item = container.pageItems[i];
        if (!shouldIncludeItem(item)) { continue; }
        var itemType = getItemType(item);
        var abRect = getArtboardRect(item);
        var child = {
          uuid: ensureUUID(item),
          name: "",
          type: itemType,
          zIndex: getZIndex(item),
          bounds: getBounds(item, coordSystem, abRect)
        };
        try { child.name = item.name || ""; } catch (e) {}
        if (itemType === "group") {
          try {
            child.children = traverseItems(item, currentDepth + 1);
          } catch (e) {
            child.children = [];
          }
        }
        children.push(child);
      }
      return children;
    }

    function traverseLayer(layer, currentDepth) {
      var info = {
        name: layer.name,
        visible: layer.visible,
        locked: layer.locked,
        zIndex: 0,
        children: []
      };
      try { info.zIndex = layer.zOrderPosition; } catch (e) {}

      if (currentDepth < maxDepth) {
        info.children = traverseItems(layer, currentDepth);

        // Include sublayers as nested layers
        for (var s = 0; s < layer.layers.length; s++) {
          info.children.push(traverseLayer(layer.layers[s], currentDepth + 1));
        }
      }

      return info;
    }

    var layers = [];
    for (var i = 0; i < doc.layers.length; i++) {
      layers.push(traverseLayer(doc.layers[i], 0));
    }

    writeResultFile(RESULT_PATH, {
      coordinateSystem: coordSystem,
      layers: layers
    });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "get_document_structure: " + e.message, line: e.line });
  }
}
