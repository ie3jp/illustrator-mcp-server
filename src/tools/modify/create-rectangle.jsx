var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var coordSystem = params.coordinate_system || "artboard-web";
    __COLOR_HELPERS_JSX__

    var inputX = params.x;
    var inputY = params.y;
    var w = params.width;
    var h = params.height;
    var cornerRadius = params.corner_radius || 0;

    var left = inputX;
    var top;
    if (coordSystem === "artboard-web") {
      var ab = doc.artboards[doc.artboards.getActiveArtboardIndex()];
      var abRect = ab.artboardRect;
      left = abRect[0] + inputX;
      top = abRect[1] + (-inputY);
    } else {
      top = inputY;
    }

    var targetLayer = doc.activeLayer;
    if (params.layer_name) {
      try {
        targetLayer = doc.layers.getByName(params.layer_name);
      } catch (e) {
        targetLayer = doc.layers.add();
        targetLayer.name = params.layer_name;
      }
    }

    var rect;
    if (cornerRadius > 0) {
      rect = targetLayer.pathItems.roundedRectangle(top, left, w, h, cornerRadius, cornerRadius);
    } else {
      rect = targetLayer.pathItems.rectangle(top, left, w, h);
    }

    applyOptionalFill(rect, params.fill);
    applyStroke(rect, params.stroke, rect.stroked);

    if (params.name) {
      rect.name = params.name;
    }

    var uuid = ensureUUID(rect);
    writeResultFile(RESULT_PATH, { uuid: uuid });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Failed to create rectangle: " + e.message, line: e.line });
  }
}
