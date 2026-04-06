// diag-read.jsx - Windows COM diagnostic: READ test
// Tests reading document info from Illustrator
// This script is executed via DoJavaScript through PowerShell COM

(function() {
  var results = [];

  function log(msg) {
    results.push(msg);
  }

  try {
    log("=== Illustrator Read Diagnostic ===");
    log("Illustrator version: " + app.version);
    log("Platform: " + $.os);
    log("Documents open: " + app.documents.length);

    if (app.documents.length === 0) {
      log("ERROR: No document open. Please open a file in Illustrator first.");
    } else {
      var doc = app.activeDocument;
      log("Document name: " + doc.name);
      log("Color mode: " + doc.documentColorSpace);
      log("Artboards: " + doc.artboards.length);
      log("Layers: " + doc.layers.length);
      log("Total pageItems: " + doc.pageItems.length);

      // Read first few items
      var count = Math.min(doc.pageItems.length, 5);
      for (var i = 0; i < count; i++) {
        var item = doc.pageItems[i];
        log("  Item[" + i + "]: typename=" + item.typename + " name=" + (item.name || "(none)") + " note=" + (item.note || "(none)"));
        var b = item.geometricBounds;
        log("    bounds: [" + b[0] + ", " + b[1] + ", " + b[2] + ", " + b[3] + "]");
      }
      log("READ TEST: PASS");
    }
  } catch (e) {
    log("READ TEST: FAIL - " + e.message + " (line " + e.line + ")");
  }

  // Write result to file
  try {
    var resultPath = Folder.temp.fsName.replace(/\\/g, "/") + "/illustrator-mcp-diag-read.txt";
    var f = new File(resultPath);
    f.encoding = "UTF-8";
    if (f.open("w")) {
      f.write(results.join("\n"));
      f.close();
    }
  } catch(e) {}

  return results.join("\n");
})();
