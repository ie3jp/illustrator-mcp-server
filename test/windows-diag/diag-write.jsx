// diag-write.jsx - Windows COM diagnostic: WRITE test
// Tests creating and modifying objects in Illustrator
// This script is executed via DoJavaScript through PowerShell COM

(function() {
  var results = [];

  function log(msg) {
    results.push(msg);
  }

  try {
    log("=== Illustrator Write Diagnostic ===");
    log("Illustrator version: " + app.version);

    if (app.documents.length === 0) {
      log("ERROR: No document open. Please open a file in Illustrator first.");
    } else {
      var doc = app.activeDocument;
      log("Document: " + doc.name);

      // Test 1: Create a rectangle
      log("");
      log("--- Test 1: Create PathItem (rectangle) ---");
      try {
        var rect = doc.pathItems.rectangle(100, 100, 50, 50);
        log("  Created rectangle: typename=" + rect.typename);
        log("  Bounds: [" + rect.geometricBounds.join(", ") + "]");
        log("  Test 1: PASS");
      } catch (e) {
        log("  Test 1: FAIL - " + e.message + " (line " + e.line + ")");
      }

      // Test 2: Modify position
      log("");
      log("--- Test 2: Modify position ---");
      try {
        if (rect) {
          rect.position = [200, -50];
          var newBounds = rect.geometricBounds;
          log("  New bounds: [" + newBounds.join(", ") + "]");
          log("  Test 2: PASS");
        }
      } catch (e) {
        log("  Test 2: FAIL - " + e.message + " (line " + e.line + ")");
      }

      // Test 3: Modify fill color
      log("");
      log("--- Test 3: Modify fill color ---");
      try {
        if (rect) {
          var color = new RGBColor();
          color.red = 0;
          color.green = 128;
          color.blue = 255;
          rect.fillColor = color;
          rect.filled = true;
          log("  Fill applied: R=0 G=128 B=255");
          log("  Test 3: PASS");
        }
      } catch (e) {
        log("  Test 3: FAIL - " + e.message + " (line " + e.line + ")");
      }

      // Test 4: Set name/note
      log("");
      log("--- Test 4: Set name and note ---");
      try {
        if (rect) {
          rect.name = "diag-test-rect";
          rect.note = "diag-test-note";
          log("  name=" + rect.name + " note=" + rect.note);
          log("  Test 4: PASS");
        }
      } catch (e) {
        log("  Test 4: FAIL - " + e.message + " (line " + e.line + ")");
      }

      // Test 5: Modify opacity
      log("");
      log("--- Test 5: Modify opacity ---");
      try {
        if (rect) {
          rect.opacity = 75;
          log("  opacity=" + rect.opacity);
          log("  Test 5: PASS");
        }
      } catch (e) {
        log("  Test 5: FAIL - " + e.message + " (line " + e.line + ")");
      }

      // Test 6: Create text frame
      log("");
      log("--- Test 6: Create TextFrame ---");
      try {
        var tf = doc.textFrames.add();
        tf.contents = "Diagnostic Test";
        tf.position = [100, -200];
        log("  Created text: contents=" + tf.contents);
        log("  Test 6: PASS");
      } catch (e) {
        log("  Test 6: FAIL - " + e.message + " (line " + e.line + ")");
      }

      // Cleanup: remove test objects
      log("");
      log("--- Cleanup ---");
      try {
        if (rect) rect.remove();
        if (tf) tf.remove();
        log("  Removed test objects");
      } catch (e) {
        log("  Cleanup failed: " + e.message);
      }

      log("");
      log("WRITE TEST: COMPLETE");
    }
  } catch (e) {
    log("WRITE TEST: FAIL - " + e.message + " (line " + e.line + ")");
  }

  // Write result to file
  try {
    var resultPath = Folder.temp.fsName.replace(/\\/g, "/") + "/illustrator-mcp-diag-write.txt";
    var f = new File(resultPath);
    f.encoding = "UTF-8";
    if (f.open("w")) {
      f.write(results.join("\n"));
      f.close();
    }
  } catch(e) {}

  return results.join("\n");
})();
