try {
  var err = preflightChecks();
  if (err) {
    writeResultFile(RESULT_PATH, err);
  } else {
    var fonts = [];
    for (var i = 0; i < app.textFonts.length && i < 20; i++) {
      var font = app.textFonts[i];
      fonts.push({ name: font.name, family: font.family });
    }
    writeResultFile(RESULT_PATH, { fonts: fonts });
  }
} catch (e) {
  writeResultFile(RESULT_PATH, { error: true, message: e.message, line: e.line });
}
