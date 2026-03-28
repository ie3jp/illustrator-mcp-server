try {
  var err = preflightChecks();
  if (err) {
    writeResultFile(RESULT_PATH, err);
  } else {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var coordSystem = (params && params.coordinate_system) ? params.coordinate_system : "artboard-web";

    // ファイル名・パス
    var fileName = doc.name;
    var filePath = "";
    try {
      filePath = doc.fullName.fsName;
    } catch (e) {
      // 未保存ドキュメントの場合 fullName がエラーになる
      filePath = "";
    }

    // ドキュメントサイズ（pt）
    var docWidth = doc.width;
    var docHeight = doc.height;

    // カラーモード
    var colorSpace = doc.documentColorSpace;
    var colorMode = "unknown";
    if (colorSpace === DocumentColorSpace.CMYK) {
      colorMode = "CMYK";
    } else if (colorSpace === DocumentColorSpace.RGB) {
      colorMode = "RGB";
    }

    // カラープロファイル
    var colorProfile = "";
    try {
      colorProfile = doc.colorProfileName;
    } catch (e) {
      colorProfile = "";
    }

    // 裁ち落とし設定
    // Illustrator ExtendScript API はドキュメントの裁ち落とし（bleed）設定を
    // 直接公開していないため、取得不可
    var bleed = {
      note: "Illustrator ExtendScript API does not expose bleed settings directly. Use File > Document Setup to check bleed values.",
      top: null,
      bottom: null,
      left: null,
      right: null
    };

    // ラスタライズ解像度
    var rasterResolution = 0;
    try {
      rasterResolution = doc.rasterEffectSettings.resolution;
    } catch (e) {
      rasterResolution = 0;
    }

    // アートボード数・情報
    var artboardCount = doc.artboards.length;
    var artboards = [];
    for (var i = 0; i < doc.artboards.length; i++) {
      var ab = doc.artboards[i];
      var rect = ab.artboardRect; // [left, top, right, bottom]
      var abWidth = rect[2] - rect[0];
      var abHeight = rect[1] - rect[3]; // top - bottom (Illustrator座標)

      var abInfo = {
        index: i,
        name: ab.name
      };

      if (coordSystem === "document") {
        abInfo.x = rect[0];
        abInfo.y = rect[1];
      } else {
        // artboard-web: 各アートボードは自身の原点(0,0)を持つ
        abInfo.x = 0;
        abInfo.y = 0;
      }
      abInfo.width = abWidth;
      abInfo.height = abHeight;

      artboards.push(abInfo);
    }

    var result = {
      fileName: fileName,
      filePath: filePath,
      width: docWidth,
      height: docHeight,
      colorMode: colorMode,
      colorProfile: colorProfile,
      bleed: bleed,
      rasterEffectResolution: rasterResolution,
      artboardCount: artboardCount,
      artboards: artboards,
      coordinateSystem: coordSystem
    };

    writeResultFile(RESULT_PATH, result);
  }
} catch (e) {
  writeResultFile(RESULT_PATH, { error: true, message: e.message, line: e.line });
}
