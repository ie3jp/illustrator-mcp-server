/**
 * diag-mcp.ts - MCP server code path diagnostic
 *
 * Tests the actual MCP server's PowerShell → COM → Illustrator pipeline.
 * Run on Windows with Illustrator open:
 *
 *   npx tsx test/windows-diag/diag-mcp.ts
 *
 * This uses the same executeJsx() code path as the MCP server,
 * giving us exact reproduction of the read-works-but-write-fails issue.
 */
import { ensureTmpDir } from '../../src/executor/file-transport.js';
import { executeJsx } from '../../src/executor/jsx-runner.js';

const PASS = '\x1b[32mPASS\x1b[0m';
const FAIL = '\x1b[31mFAIL\x1b[0m';
const SKIP = '\x1b[33mSKIP\x1b[0m';

async function main() {
  console.log('');
  console.log('=== Illustrator MCP Server - Windows Diagnostic ===');
  console.log('');
  console.log('This runs the EXACT same code path as the MCP server.');
  console.log('Transport: PowerShell COM (file-based I/O)');
  console.log(`Platform: ${process.platform}`);
  console.log('');

  // Initialize temp directory (same as MCP server startup)
  await ensureTmpDir();

  // ── Test 1: Read - get document info ──────────────────────────────
  console.log('[Test 1] Read: get document info');
  try {
    const result = await executeJsx(`
      var preflight = preflightChecks();
      if (preflight) {
        writeResultFile(RESULT_PATH, preflight);
      } else {
        var doc = app.activeDocument;
        writeResultFile(RESULT_PATH, {
          success: true,
          name: doc.name,
          colorSpace: String(doc.documentColorSpace),
          artboards: doc.artboards.length,
          layers: doc.layers.length,
          pageItems: doc.pageItems.length
        });
      }
    `);
    if (result.error) {
      console.log(`  ${FAIL}: ${result.message}`);
    } else {
      console.log(`  ${PASS}: ${JSON.stringify(result)}`);
    }
  } catch (e) {
    console.log(`  ${FAIL}: ${(e as Error).message}`);
  }

  // ── Test 2: Read - list page items ────────────────────────────────
  console.log('');
  console.log('[Test 2] Read: list page items');
  try {
    const result = await executeJsx(`
      var preflight = preflightChecks();
      if (preflight) {
        writeResultFile(RESULT_PATH, preflight);
      } else {
        var doc = app.activeDocument;
        var items = [];
        var count = Math.min(doc.pageItems.length, 5);
        for (var i = 0; i < count; i++) {
          var item = doc.pageItems[i];
          items.push({
            index: i,
            typename: item.typename,
            name: item.name || "",
            note: item.note || "",
            bounds: item.geometricBounds
          });
        }
        writeResultFile(RESULT_PATH, { success: true, items: items });
      }
    `);
    if (result.error) {
      console.log(`  ${FAIL}: ${result.message}`);
    } else {
      console.log(`  ${PASS}: found ${(result as any).items?.length ?? 0} items`);
    }
  } catch (e) {
    console.log(`  ${FAIL}: ${(e as Error).message}`);
  }

  // ── Test 3: Write - create rectangle (NO activate) ────────────────
  console.log('');
  console.log('[Test 3] Write: create rectangle (activate=false)');
  try {
    const result = await executeJsx(`
      var preflight = preflightChecks();
      if (preflight) {
        writeResultFile(RESULT_PATH, preflight);
      } else {
        try {
          var doc = app.activeDocument;
          var rect = doc.pathItems.rectangle(100, 100, 60, 40);
          rect.name = "diag-test-3";
          rect.note = "diag-uuid-3";
          var bounds = rect.geometricBounds;
          rect.remove();
          writeResultFile(RESULT_PATH, {
            success: true,
            created: true,
            typename: "PathItem",
            bounds: bounds
          });
        } catch(e) {
          writeResultFile(RESULT_PATH, { error: true, message: e.message, line: e.line });
        }
      }
    `, undefined, { activate: false });
    if (result.error) {
      console.log(`  ${FAIL}: ${result.message}`);
    } else {
      console.log(`  ${PASS}: ${JSON.stringify(result)}`);
    }
  } catch (e) {
    console.log(`  ${FAIL}: ${(e as Error).message}`);
  }

  // ── Test 4: Write - create rectangle (WITH activate) ──────────────
  console.log('');
  console.log('[Test 4] Write: create rectangle (activate=true) [same as modify_object]');
  try {
    const result = await executeJsx(`
      var preflight = preflightChecks();
      if (preflight) {
        writeResultFile(RESULT_PATH, preflight);
      } else {
        try {
          var doc = app.activeDocument;
          var rect = doc.pathItems.rectangle(100, 100, 60, 40);
          rect.name = "diag-test-4";
          rect.note = "diag-uuid-4";
          rect.position = [200, -100];
          rect.opacity = 75;
          var bounds = rect.geometricBounds;
          rect.remove();
          writeResultFile(RESULT_PATH, {
            success: true,
            created: true,
            moved: true,
            bounds: bounds,
            opacity: 75
          });
        } catch(e) {
          writeResultFile(RESULT_PATH, { error: true, message: e.message, line: e.line });
        }
      }
    `, undefined, { activate: true });
    if (result.error) {
      console.log(`  ${FAIL}: ${result.message}`);
    } else {
      console.log(`  ${PASS}: ${JSON.stringify(result)}`);
    }
  } catch (e) {
    console.log(`  ${FAIL}: ${(e as Error).message}`);
  }

  // ── Test 5: Write with params (simulates modify_object) ───────────
  console.log('');
  console.log('[Test 5] Write with params file (simulates modify_object pipeline)');
  try {
    const result = await executeJsx(`
      var preflight = preflightChecks();
      if (preflight) {
        writeResultFile(RESULT_PATH, preflight);
      } else {
        try {
          var params = readParamsFile(PARAMS_PATH);
          var doc = app.activeDocument;

          // Create test object
          var rect = doc.pathItems.rectangle(100, 100, 60, 40);
          rect.name = params.name || "diag-test-5";

          // Apply modifications from params
          if (params.position) {
            rect.position = [params.position.x, params.position.y];
          }
          if (typeof params.opacity === "number") {
            rect.opacity = params.opacity;
          }
          if (params.fill) {
            var c = new RGBColor();
            c.red = params.fill.r || 0;
            c.green = params.fill.g || 0;
            c.blue = params.fill.b || 0;
            rect.fillColor = c;
            rect.filled = true;
          }

          var snapshot = {
            success: true,
            name: rect.name,
            position: rect.position,
            bounds: rect.geometricBounds,
            opacity: rect.opacity,
            filled: rect.filled
          };

          rect.remove();
          writeResultFile(RESULT_PATH, snapshot);
        } catch(e) {
          writeResultFile(RESULT_PATH, { error: true, message: e.message, line: e.line });
        }
      }
    `, {
      name: 'diag-test-5',
      position: { x: 150, y: -80 },
      opacity: 60,
      fill: { r: 255, g: 128, b: 0 },
    }, { activate: true });
    if (result.error) {
      console.log(`  ${FAIL}: ${result.message}`);
    } else {
      console.log(`  ${PASS}: ${JSON.stringify(result)}`);
    }
  } catch (e) {
    console.log(`  ${FAIL}: ${(e as Error).message}`);
  }

  // ── Summary ───────────────────────────────────────────────────────
  console.log('');
  console.log('==============================');
  console.log(' Diagnostic Complete');
  console.log('==============================');
  console.log('');
  console.log('Key findings:');
  console.log('- If Tests 1-2 PASS but 3-5 FAIL -> Write operations broken');
  console.log('- If Test 3 PASSES but 4 FAILS -> $ai.Visible = $true causes issues');
  console.log('- If Tests 3-4 PASS but 5 FAILS -> Param file I/O issue');
  console.log('- If all FAIL with "no result file" -> $.evalFile or file I/O problem');
  console.log('');
  console.log('Please share this output with the developer.');
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
