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
