# run-diag.ps1 - Windows COM Diagnostic for Illustrator MCP Server
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File run-diag.ps1
#
# Prerequisites:
#   - Adobe Illustrator must be running
#   - A document should be open in Illustrator
#
# This script tests the exact same COM automation code path used by the MCP server.

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "======================================"
Write-Host " Illustrator MCP - Windows Diagnostic"
Write-Host "======================================"
Write-Host ""

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# --------------------------------------------------
# Test 1: COM Connection
# --------------------------------------------------
Write-Host "[Test 1] COM Connection..."
try {
    $ai = New-Object -ComObject "Illustrator.Application" -ErrorAction Stop
    Write-Host "  PASS: Connected to Illustrator"
    Write-Host "  Version: $($ai.Version)"
    Write-Host "  Visible: $($ai.Visible)"
} catch {
    Write-Host "  FAIL: Cannot connect to Illustrator via COM"
    Write-Host "  Error: $_"
    Write-Host ""
    Write-Host "Make sure Illustrator is running."
    exit 1
}

# --------------------------------------------------
# Test 2: DoJavaScript - inline simple read
# --------------------------------------------------
Write-Host ""
Write-Host "[Test 2] DoJavaScript - inline read..."
try {
    $result2 = $ai.DoJavaScript("app.version")
    Write-Host "  PASS: DoJavaScript returned: $result2"
} catch {
    Write-Host "  FAIL: DoJavaScript inline read failed"
    Write-Host "  Error: $_"
}

# --------------------------------------------------
# Test 3: DoJavaScript - inline write
# --------------------------------------------------
Write-Host ""
Write-Host "[Test 3] DoJavaScript - inline write (create + remove rect)..."
try {
    $script3 = @"
(function() {
    if (app.documents.length === 0) return 'SKIP: no document open';
    var doc = app.activeDocument;
    var rect = doc.pathItems.rectangle(100, 100, 50, 50);
    var msg = 'created: ' + rect.typename;
    rect.position = [200, -100];
    msg += ', moved';
    rect.opacity = 50;
    msg += ', opacity=' + rect.opacity;
    rect.remove();
    msg += ', removed';
    return msg;
})();
"@
    $result3 = $ai.DoJavaScript($script3)
    Write-Host "  PASS: $result3"
} catch {
    Write-Host "  FAIL: DoJavaScript inline write failed"
    Write-Host "  Error: $_"
}

# --------------------------------------------------
# Test 4: DoJavaScript with $.evalFile (MCP server code path)
# --------------------------------------------------
Write-Host ""
Write-Host "[Test 4] DoJavaScript + `$.evalFile (read test)..."
$readJsx = Join-Path $scriptDir "diag-read.jsx"
if (-not (Test-Path $readJsx)) {
    Write-Host "  SKIP: diag-read.jsx not found at $readJsx"
} else {
    try {
        $resultFile4 = Join-Path $env:TEMP "illustrator-mcp-diag-read.txt"
        $jsxPath = $readJsx.Replace('\', '/')
        $resultFilePath = $resultFile4.Replace('\', '/')

        # This is the EXACT pattern used by the MCP server
        $evalCmd = "`$.evalFile(new File('$jsxPath'))"
        Write-Host "  Command: `$ai.DoJavaScript(`"$evalCmd`")"

        $result4 = $ai.DoJavaScript($evalCmd)
        if ($result4) {
            Write-Host "  PASS: evalFile returned output"
            Write-Host "  --- Output ---"
            $result4 -split "`n" | ForEach-Object { Write-Host "  $_" }
            Write-Host "  --- End ---"
        } else {
            Write-Host "  WARNING: evalFile returned empty/null"
            # Check if result was written to file instead
            if (Test-Path $resultFile4) {
                $content = Get-Content $resultFile4 -Raw
                Write-Host "  File output: $content"
            }
        }
    } catch {
        Write-Host "  FAIL: evalFile read test failed"
        Write-Host "  Error: $_"
        Write-Host "  Error type: $($_.Exception.GetType().FullName)"
    }
}

# --------------------------------------------------
# Test 5: DoJavaScript with $.evalFile (write test)
# --------------------------------------------------
Write-Host ""
Write-Host "[Test 5] DoJavaScript + `$.evalFile (write test)..."
$writeJsx = Join-Path $scriptDir "diag-write.jsx"
if (-not (Test-Path $writeJsx)) {
    Write-Host "  SKIP: diag-write.jsx not found at $writeJsx"
} else {
    try {
        $resultFile5 = Join-Path $env:TEMP "illustrator-mcp-diag-write.txt"
        $jsxPath = $writeJsx.Replace('\', '/')
        $resultFilePath = $resultFile5.Replace('\', '/')

        $evalCmd = "`$.evalFile(new File('$jsxPath'))"
        Write-Host "  Command: `$ai.DoJavaScript(`"$evalCmd`")"

        $result5 = $ai.DoJavaScript($evalCmd)
        if ($result5) {
            Write-Host "  --- Output ---"
            $result5 -split "`n" | ForEach-Object { Write-Host "  $_" }
            Write-Host "  --- End ---"
        } else {
            Write-Host "  WARNING: evalFile returned empty/null"
        }
    } catch {
        Write-Host "  FAIL: evalFile write test failed"
        Write-Host "  Error: $_"
        Write-Host "  Error type: $($_.Exception.GetType().FullName)"
    }
}

# --------------------------------------------------
# Test 6: Full MCP server code path (evalFile + file I/O)
# --------------------------------------------------
Write-Host ""
Write-Host "[Test 6] Full MCP code path (evalFile + JSON file I/O)..."
$evalJsx = Join-Path $scriptDir "diag-evalfile.jsx"
if (-not (Test-Path $evalJsx)) {
    Write-Host "  SKIP: diag-evalfile.jsx not found at $evalJsx"
} else {
    try {
        $jsxPath = $evalJsx.Replace('\', '/')
        $evalCmd = "`$.evalFile(new File('$jsxPath'))"
        Write-Host "  Command: `$ai.DoJavaScript(`"$evalCmd`")"

        $result6 = $ai.DoJavaScript($evalCmd)
        if ($result6) {
            Write-Host "  --- Output ---"
            $result6 -split "`n" | ForEach-Object { Write-Host "  $_" }
            Write-Host "  --- End ---"
        } else {
            Write-Host "  WARNING: evalFile returned empty/null"
        }

        # Check if JSON result file was created
        $diagResult = Join-Path $env:TEMP "illustrator-mcp-diag-result.json"
        if (Test-Path $diagResult) {
            $jsonContent = Get-Content $diagResult -Raw
            Write-Host "  JSON result file: $jsonContent"
        } else {
            Write-Host "  WARNING: JSON result file was not created"
        }

        # Check log file
        $diagLog = Join-Path $env:TEMP "illustrator-mcp-diag-log.txt"
        if (Test-Path $diagLog) {
            Write-Host "  Full log at: $diagLog"
        }
    } catch {
        Write-Host "  FAIL: Full MCP code path failed"
        Write-Host "  Error: $_"
        Write-Host "  Error type: $($_.Exception.GetType().FullName)"
    }
}

# --------------------------------------------------
# Test 7: Alternative - DoJavaScript with file path argument
# --------------------------------------------------
Write-Host ""
Write-Host "[Test 7] DoJavaScript alternative approaches..."
try {
    # Try passing script as file path string (not evalFile)
    Write-Host "  7a: DoJavaScript with multiline write script..."
    $writeScript = @"
(function() {
    if (app.documents.length === 0) return 'no document';
    var doc = app.activeDocument;
    try {
        var rect = doc.pathItems.rectangle(50, 50, 30, 30);
        rect.name = 'diag-test-7';
        var c = new RGBColor();
        c.red = 0; c.green = 255; c.blue = 0;
        rect.fillColor = c;
        rect.filled = true;
        var result = 'created: ' + rect.name + ' filled: ' + rect.filled;
        rect.remove();
        return result + ' removed';
    } catch(e) {
        return 'ERROR: ' + e.message + ' line:' + e.line;
    }
})();
"@
    $result7a = $ai.DoJavaScript($writeScript)
    Write-Host "  7a Result: $result7a"
} catch {
    Write-Host "  7a FAIL: $_"
}

# --------------------------------------------------
# Summary
# --------------------------------------------------
Write-Host ""
Write-Host "======================================"
Write-Host " Diagnostic Complete"
Write-Host "======================================"
Write-Host ""
Write-Host "If Tests 2-3 PASS but Tests 4-6 FAIL:"
Write-Host "  -> Problem is with `$.evalFile() or file I/O"
Write-Host "  -> The MCP server's file-based approach may not work on this system"
Write-Host ""
Write-Host "If Test 3 FAILS (inline write) but Test 2 PASSES (inline read):"
Write-Host "  -> Problem is with COM write permissions"
Write-Host "  -> Check if Illustrator is in a restricted mode"
Write-Host ""
Write-Host "If all tests PASS:"
Write-Host "  -> COM automation works correctly"
Write-Host "  -> The issue may be specific to MCP server integration"
Write-Host ""
Write-Host "Please share the full output of this script with the developer."
