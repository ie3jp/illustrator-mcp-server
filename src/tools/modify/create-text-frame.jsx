var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var coordSystem = params.coordinate_system || "artboard-web";
    __COLOR_HELPERS_JSX__
    __FONT_HELPERS_JSX__

    function webToAiCoords(x, y, artboardRect) {
      if (artboardRect) {
        return [artboardRect[0] + x, artboardRect[1] - y];
      }
      return [x, y];
    }

    var inputX = params.x;
    var inputY = params.y;
    var kind = params.kind || "point";

    var abRect = null;
    if (coordSystem === "artboard-web") {
      var ab = doc.artboards[doc.artboards.getActiveArtboardIndex()];
      abRect = ab.artboardRect;
    }

    var aiCoords = webToAiCoords(inputX, inputY, abRect);
    var aiX = aiCoords[0];
    var aiY = aiCoords[1];

    var resolvedFont = null;
    var fontCandidates = null;
    if (params.font_name) {
      try {
        resolvedFont = app.textFonts.getByName(params.font_name);
      } catch (e) {
        fontCandidates = findFontCandidates(params.font_name);
      }
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

    var tf;
    if (kind === "area") {
      var w = params.width || 100;
      var h = params.height || 100;
      var rectPath = targetLayer.pathItems.rectangle(aiY, aiX, w, h);
      tf = targetLayer.textFrames.areaText(rectPath);
    } else {
      tf = targetLayer.textFrames.pointText([aiX, aiY]);
    }

    tf.contents = params.contents || "";

    if (params.name) {
      tf.name = params.name;
    }

    var charAttrs = tf.textRange.characterAttributes;

    if (resolvedFont) {
      charAttrs.textFont = resolvedFont;
    }

    if (typeof params.font_size === "number") {
      charAttrs.size = params.font_size;
    }

    if (typeof params.fill !== "undefined") {
      charAttrs.fillColor = createColor(params.fill);
    }

    var uuid = ensureUUID(tf);
    var resultData = { uuid: uuid };
    if (fontCandidates !== null) {
      resultData.font_warning = "Font '" + params.font_name + "' not found. Text frame created with default font.";
      resultData.font_candidates = fontCandidates;
    }
    writeResultFile(RESULT_PATH, resultData);
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Failed to create text frame: " + e.message, line: e.line });
  }
}
