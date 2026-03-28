var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var coordSystem = params.coordinate_system || "artboard-web";
    __COLOR_HELPERS_JSX__

    var ix1 = params.x1;
    var iy1 = params.y1;
    var ix2 = params.x2;
    var iy2 = params.y2;

    var px1, py1, px2, py2;
    if (coordSystem === "artboard-web") {
      var ab = doc.artboards[doc.artboards.getActiveArtboardIndex()];
      var abRect = ab.artboardRect;
      px1 = abRect[0] + ix1;
      py1 = abRect[1] + (-iy1);
      px2 = abRect[0] + ix2;
      py2 = abRect[1] + (-iy2);
    } else {
      px1 = ix1;
      py1 = iy1;
      px2 = ix2;
      py2 = iy2;
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

    var line = targetLayer.pathItems.add();
    line.setEntirePath([[px1, py1], [px2, py2]]);
    line.filled = false;

    if (params.stroke) {
      applyStroke(line, params.stroke, true);
      if (params.stroke.cap) {
        if (params.stroke.cap === "round") {
          line.strokeCap = StrokeCap.ROUNDENDCAP;
        } else if (params.stroke.cap === "projecting") {
          line.strokeCap = StrokeCap.PROJECTINGENDCAP;
        } else {
          line.strokeCap = StrokeCap.BUTTENDCAP;
        }
      }
    } else {
      line.stroked = true;
    }

    if (params.name) {
      line.name = params.name;
    }

    var uuid = ensureUUID(line);
    writeResultFile(RESULT_PATH, { uuid: uuid });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Failed to create line: " + e.message, line: e.line });
  }
}
