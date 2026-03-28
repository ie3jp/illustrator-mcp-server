var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var coordSystem = params.coordinate_system || "artboard-web";
    __COLOR_HELPERS_JSX__

    function webToAiCoords(x, y, artboardRect) {
      if (artboardRect) {
        return [artboardRect[0] + x, artboardRect[1] - y];
      }
      return [x, y];
    }

    var abRect = null;
    if (coordSystem === "artboard-web") {
      var ab = doc.artboards[doc.artboards.getActiveArtboardIndex()];
      abRect = ab.artboardRect;
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

    var anchors = params.anchors;
    var closed = params.closed || false;

    // まずアンカーポイントの座標を変換
    var anchorPositions = [];
    for (var i = 0; i < anchors.length; i++) {
      var pt = anchors[i];
      var aiCoords = webToAiCoords(pt.x, pt.y, abRect);
      anchorPositions.push(aiCoords);
    }

    var path = targetLayer.pathItems.add();
    path.closed = closed;

    // setEntirePathでアンカー位置を設定
    path.setEntirePath(anchorPositions);

    // ハンドルやポイントタイプの設定
    for (var i = 0; i < anchors.length; i++) {
      var pt = anchors[i];
      var pp = path.pathPoints[i];

      if (pt.point_type === "smooth") {
        pp.pointType = PointType.SMOOTH;
      } else {
        pp.pointType = PointType.CORNER;
      }

      if (pt.left_handle) {
        var lh = webToAiCoords(pt.left_handle.x, pt.left_handle.y, abRect);
        pp.leftDirection = lh;
      }

      if (pt.right_handle) {
        var rh = webToAiCoords(pt.right_handle.x, pt.right_handle.y, abRect);
        pp.rightDirection = rh;
      }
    }

    applyOptionalFill(path, params.fill);
    applyStroke(path, params.stroke, path.stroked);

    if (params.name) {
      path.name = params.name;
    }

    var uuid = ensureUUID(path);
    writeResultFile(RESULT_PATH, { uuid: uuid });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Failed to create path: " + e.message, line: e.line });
  }
}
