try {
  var verErr = checkIllustratorVersion();
  if (verErr) {
    writeResultFile(RESULT_PATH, verErr);
  } else {
    var params = readParamsFile(PARAMS_PATH);
    var save = params.save === true;

    if (app.documents.length === 0) {
      writeResultFile(RESULT_PATH, { error: true, message: "No document is open" });
    } else {
      var saveOpt = save ? SaveOptions.SAVECHANGES : SaveOptions.DONOTSAVECHANGES;
      app.activeDocument.close(saveOpt);
      writeResultFile(RESULT_PATH, { success: true });
    }
  }
} catch (e) {
  writeResultFile(RESULT_PATH, { error: true, message: "Failed to close document: " + e.message, line: e.line });
}
