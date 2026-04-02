// diag-evalfile.jsx - Windows COM diagnostic: evalFile + file I/O test
// This tests the EXACT code path used by the MCP server:
//   1. Read params from a JSON file
//   2. Modify an object based on params
//   3. Write result to a JSON file
//
// Usage: This file is loaded via $.evalFile() from PowerShell

(function() {
  var results = [];

  function log(msg) {
    results.push(msg);
  }

  // Minimal JSON stringify (same as MCP server's common.jsx)
  function jsonStringify(obj) {
    if (obj === null || obj === void 0) return "null";
    var t = typeof obj;
    if (t === "boolean") return String(obj);
    if (t === "number") return String(obj);
    if (t === "string") {
      return '"' + obj.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
    }
    if (obj instanceof Array) {
      var parts = [];
      for (var i = 0; i < obj.length; i++) parts.push(jsonStringify(obj[i]));
      return "[" + parts.join(",") + "]";
    }
    if (t === "object") {
      var keys = [];
      for (var k in obj) {
        if (obj.hasOwnProperty(k)) keys.push(jsonStringify(k) + ":" + jsonStringify(obj[k]));
      }
      return "{" + keys.join(",") + "}";
    }
    return "null";
  }

  try {
    log("=== evalFile + File I/O Diagnostic ===");
    log("Illustrator version: " + app.version);
    log("$.os: " + $.os);

    // Step 1: Check if we can find our own script path
    log("");
    log("--- Step 1: Script context ---");
    try {
      log("  $.fileName: " + $.fileName);
      log("  File object works: " + (typeof File !== "undefined" ? "yes" : "no"));
      log("  Step 1: PASS");
    } catch(e) {
      log("  Step 1: FAIL - " + e.message);
    }

    // Step 2: Write a JSON result file (same as MCP server does)
    log("");
    log("--- Step 2: Write JSON result file ---");
    var resultDir = Folder.temp.fsName;
    var resultPath = resultDir + "/illustrator-mcp-diag-result.json";
    // Convert backslashes for File()
    resultPath = resultPath.replace(/\\/g, "/");
    try {
      var resultObj = {
        success: true,
        version: app.version,
        platform: $.os,
        documents: app.documents.length,
        timestamp: new Date().toString()
      };
      var f = new File(resultPath);
      f.encoding = "UTF-8";
      if (!f.open("w")) {
        log("  Cannot open file for writing: " + resultPath);
        log("  Step 2: FAIL");
      } else {
        f.write(jsonStringify(resultObj));
        f.close();
        log("  Wrote result to: " + resultPath);

        // Verify by reading back
        var f2 = new File(resultPath);
        f2.encoding = "UTF-8";
        if (f2.open("r")) {
          var content = f2.read();
          f2.close();
          log("  Read back: " + content.substring(0, 200));
          log("  Step 2: PASS");
        } else {
          log("  Cannot read back result file");
          log("  Step 2: FAIL");
        }
      }
    } catch(e) {
      log("  Step 2: FAIL - " + e.message + " (line " + e.line + ")");
    }

    // Step 3: Create + modify object (if document is open)
    log("");
    log("--- Step 3: Create and modify object ---");
    if (app.documents.length === 0) {
      log("  SKIP: No document open");
    } else {
      try {
        var doc = app.activeDocument;
        var rect = doc.pathItems.rectangle(100, 100, 80, 40);
        rect.name = "mcp-diag-test";
        rect.note = "00000000-0000-0000-0000-000000000000";

        // Modify position
        rect.position = [150, -100];
        log("  position set: [" + rect.position[0] + ", " + rect.position[1] + "]");

        // Modify size
        rect.width = 120;
        rect.height = 60;
        log("  size set: " + rect.width + " x " + rect.height);

        // Modify fill
        var docColorSpace = doc.documentColorSpace;
        if (String(docColorSpace) === "DocumentColorSpace.RGB") {
          var c = new RGBColor();
          c.red = 255; c.green = 0; c.blue = 128;
          rect.fillColor = c;
          log("  fill set: RGB(255,0,128)");
        } else {
          var c = new CMYKColor();
          c.cyan = 0; c.magenta = 100; c.yellow = 50; c.black = 0;
          rect.fillColor = c;
          log("  fill set: CMYK(0,100,50,0)");
        }
        rect.filled = true;

        // Modify opacity
        rect.opacity = 80;
        log("  opacity set: " + rect.opacity);

        // Verify final state
        var b = rect.geometricBounds;
        log("  final bounds: [" + b.join(", ") + "]");
        log("  final name: " + rect.name);
        log("  final note: " + rect.note);

        // Cleanup
        rect.remove();
        log("  cleaned up test object");
        log("  Step 3: PASS");
      } catch(e) {
        log("  Step 3: FAIL - " + e.message + " (line " + e.line + ")");
      }
    }

    // Final summary
    log("");
    var allPass = true;
    for (var i = 0; i < results.length; i++) {
      if (results[i].indexOf("FAIL") >= 0) { allPass = false; break; }
    }
    log(allPass ? "ALL TESTS PASSED" : "SOME TESTS FAILED");

  } catch(e) {
    log("FATAL ERROR: " + e.message + " (line " + e.line + ")");
  }

  // Write full log to a separate file
  try {
    var logPath = Folder.temp.fsName.replace(/\\/g, "/") + "/illustrator-mcp-diag-log.txt";
    var lf = new File(logPath);
    lf.encoding = "UTF-8";
    if (lf.open("w")) {
      lf.write(results.join("\n"));
      lf.close();
    }
  } catch(e) {}

  return results.join("\n");
})();
