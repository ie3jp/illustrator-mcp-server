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

    var ellipse = targetLayer.pathItems.ellipse(top, left, w, h);

    applyOptionalFill(ellipse, params.fill);
    applyStroke(ellipse, params.stroke, ellipse.stroked);

    if (params.name) {
      ellipse.name = params.name;
    }

    var uuid = ensureUUID(ellipse);
    writeResultFile(RESULT_PATH, { uuid: uuid });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Failed to create ellipse: " + e.message, line: e.line });
  }
}
