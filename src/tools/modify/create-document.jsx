try {
  var verErr = checkIllustratorVersion();
  if (verErr) {
    writeResultFile(RESULT_PATH, verErr);
  } else {
    var params = readParamsFile(PARAMS_PATH);
    var w = params.width || 595.28;
    var h = params.height || 841.89;
    var colorMode = (params.color_mode === "cmyk")
      ? DocumentColorSpace.CMYK
      : DocumentColorSpace.RGB;

    var doc = app.documents.add(colorMode, w, h);

    // Set artboard to match requested size
    doc.artboards[0].artboardRect = [0, h, w, 0];

    writeResultFile(RESULT_PATH, {
      success: true,
      fileName: doc.name,
      width: w,
      height: h,
      colorMode: (colorMode === DocumentColorSpace.CMYK) ? "CMYK" : "RGB"
    });
  }
} catch (e) {
  writeResultFile(RESULT_PATH, { error: true, message: "Failed to create document: " + e.message, line: e.line });
}
