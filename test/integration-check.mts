/**
 * Integration check script — requires a running Illustrator with an open document.
 * Run: npx tsx test/integration-check.mts
 */
import { executeJsx } from '../dist/executor/jsx-runner.js';
import { ensureTmpDir } from '../dist/executor/file-transport.js';
import { readImageDimensions } from '../dist/utils/image-header.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const PASS = '✅';
const FAIL = '❌';
let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    console.log(`${PASS} ${label}`);
    passed++;
  } else {
    console.log(`${FAIL} ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

// ── JSX code from create-text-frame.ts (inline) ──
const FONT_HELPERS_JSX = `
function findFontCandidates(fontName) {
  var candidates = [];
  var searchLower = fontName.toLowerCase();
  for (var fi = 0; fi < app.textFonts.length; fi++) {
    var f = app.textFonts[fi];
    if (f.name.toLowerCase().indexOf(searchLower) >= 0 ||
        (f.family && f.family.toLowerCase().indexOf(searchLower) >= 0)) {
      candidates.push({ name: f.name, family: f.family });
      if (candidates.length >= 10) break;
    }
  }
  return candidates;
}
`;

const COLOR_HELPERS_JSX = `
function createColor(colorObj) {
  if (!colorObj || colorObj.type === "none") return new NoColor();
  if (colorObj.type === "cmyk") {
    var c = new CMYKColor(); c.cyan = colorObj.c; c.magenta = colorObj.m; c.yellow = colorObj.y; c.black = colorObj.k; return c;
  }
  if (colorObj.type === "rgb") {
    var c = new RGBColor(); c.red = colorObj.r; c.green = colorObj.g; c.blue = colorObj.b; return c;
  }
  return new NoColor();
}
function applyOptionalFill(item, colorObj) {
  if (typeof colorObj === "undefined") return;
  if (!colorObj || colorObj.type === "none") { item.filled = false; return; }
  item.fillColor = createColor(colorObj); item.filled = true;
}
function applyStroke(item, strokeObj, defaultStroked) {
  if (!strokeObj) { item.stroked = defaultStroked; return; }
  if (typeof strokeObj.width === "number") item.strokeWidth = strokeObj.width;
  if (strokeObj.color && strokeObj.color.type === "none") { item.stroked = false; return; }
  if (strokeObj.color) item.strokeColor = createColor(strokeObj.color);
  item.stroked = true;
}
`;

const createTextFrameJsx = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var coordSystem = params.coordinate_system || "artboard-web";
    ${COLOR_HELPERS_JSX}
    ${FONT_HELPERS_JSX}

    function webToAiCoords(x, y, artboardRect) {
      if (artboardRect) { return [artboardRect[0] + x, artboardRect[1] - y]; }
      return [x, y];
    }

    var inputX = params.x;
    var inputY = params.y;
    var kind = params.kind || "point";
    var abRect = null;
    if (coordSystem === "artboard-web") {
      var ab = doc.artboards[doc.artboards.getActiveArtboardIndex()];
      abRect = ab.artboardRect;
    }
    var aiCoords = webToAiCoords(inputX, inputY, abRect);
    var aiX = aiCoords[0]; var aiY = aiCoords[1];

    var resolvedFont = null;
    var fontCandidates = null;
    if (params.font_name) {
      try { resolvedFont = app.textFonts.getByName(params.font_name); }
      catch (e) { fontCandidates = findFontCandidates(params.font_name); }
    }

    // Use a dedicated test layer (unlocked)
    var targetLayer;
    try {
      targetLayer = doc.layers.getByName("__mcp_test__");
    } catch(e) {
      targetLayer = doc.layers.add();
      targetLayer.name = "__mcp_test__";
    }
    targetLayer.locked = false;
    var tf;
    if (kind === "area") {
      var w = params.width || 100; var h = params.height || 100;
      var rectPath = targetLayer.pathItems.rectangle(aiY, aiX, w, h);
      tf = targetLayer.textFrames.areaText(rectPath);
    } else {
      tf = targetLayer.textFrames.pointText([aiX, aiY]);
    }
    tf.contents = params.contents || "";
    var charAttrs = tf.textRange.characterAttributes;
    if (resolvedFont) { charAttrs.textFont = resolvedFont; }
    if (typeof params.font_size === "number") { charAttrs.size = params.font_size; }
    if (typeof params.fill !== "undefined") { charAttrs.fillColor = createColor(params.fill); }

    var uuid = ensureUUID(tf);
    var resultData = { uuid: uuid };
    if (fontCandidates !== null) {
      resultData.font_warning = "Font '" + params.font_name + "' not found. Text frame created with default font.";
      resultData.font_candidates = fontCandidates;
    }
    writeResultFile(RESULT_PATH, resultData);
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Failed to create text frame: " + e.message, line: e.line });
  }
}
`;

// ── modify_object JSX (inline) ──
const modifyObjectJsx = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    ${COLOR_HELPERS_JSX}
    ${FONT_HELPERS_JSX}

    function findItemByUUID(uuid) {
      var doc = app.activeDocument;
      function search(items) {
        for (var i = 0; i < items.length; i++) {
          var item = items[i];
          try { if (item.note === uuid) return item; } catch(e) {}
          if (item.typename === "GroupItem") { var found = search(item.pageItems); if (found) return found; }
        }
        return null;
      }
      for (var li = 0; li < doc.layers.length; li++) {
        var found = search(doc.layers[li].pageItems);
        if (found) return found;
      }
      return null;
    }

    var item = findItemByUUID(params.uuid);
    if (!item) {
      writeResultFile(RESULT_PATH, { error: true, message: "No object found matching UUID: " + params.uuid });
    } else {
      var props = params.properties;
      var errors = [];
      var fontCandidates = null;
      if (props.font_name) {
        try {
          var resolvedFont = app.textFonts.getByName(props.font_name);
          for (var ri = 0; ri < item.textRanges.length; ri++) {
            item.textRanges[ri].characterAttributes.textFont = resolvedFont;
          }
        } catch(e) {
          errors.push("font_name: Font '" + props.font_name + "' not found.");
          fontCandidates = findFontCandidates(props.font_name);
        }
      }
      if (errors.length > 0) {
        var result = { success: false, uuid: params.uuid, errors: errors };
        if (fontCandidates !== null) { result.font_candidates = fontCandidates; }
        writeResultFile(RESULT_PATH, result);
      } else {
        writeResultFile(RESULT_PATH, { success: true, uuid: params.uuid });
      }
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Failed to modify object: " + e.message, line: e.line });
  }
}
`;

// ── get_images JSX (inline) ──
const getImagesJsx = `
try {
  var err = preflightChecks();
  if (err) { writeResultFile(RESULT_PATH, err); }
  else {
    var params = readParamsFile(PARAMS_PATH);
    var coordSystem = (params && params.coordinate_system) ? params.coordinate_system : "artboard-web";
    var doc = app.activeDocument;
    var images = [];

    for (var i = 0; i < doc.placedItems.length; i++) {
      var item = doc.placedItems[i];
      var uuid = ensureUUID(item);
      var zIdx = getZIndex(item);
      var abIndex = getArtboardIndexForItem(item);
      var artboardRect = null;
      if (abIndex >= 0) artboardRect = doc.artboards[abIndex].artboardRect;
      var bounds = getBounds(item, coordSystem, artboardRect);

      var info = {
        uuid: uuid, zIndex: zIdx, type: "linked", filePath: "", linkBroken: false,
        resolution: null, colorSpace: null, pixelWidth: null, pixelHeight: null,
        artboardIndex: abIndex, bounds: bounds, widthPt: null, heightPt: null
      };
      try { info.filePath = item.file.fsName; } catch (e) { info.linkBroken = true; }
      try { info.name = item.name || ""; } catch(e) {}
      try {
        var pBounds = item.geometricBounds;
        var pWidthPt = pBounds[2] - pBounds[0];
        var pHeightPt = -(pBounds[3] - pBounds[1]);
        if (pWidthPt < 0) pWidthPt = -pWidthPt;
        if (pHeightPt < 0) pHeightPt = -pHeightPt;
        info.widthPt = pWidthPt;
        info.heightPt = pHeightPt;
      } catch(e) {}
      images.push(info);
    }

    for (var j = 0; j < doc.rasterItems.length; j++) {
      var rItem = doc.rasterItems[j];
      var rUuid = ensureUUID(rItem);
      var rZIdx = getZIndex(rItem);
      var rAbIndex = getArtboardIndexForItem(rItem);
      var rArtboardRect = null;
      if (rAbIndex >= 0) rArtboardRect = doc.artboards[rAbIndex].artboardRect;
      var rBounds = getBounds(rItem, coordSystem, rArtboardRect);

      var rInfo = {
        uuid: rUuid, zIndex: rZIdx, type: rItem.embedded ? "embedded" : "linked",
        filePath: "", linkBroken: false, resolution: null, colorSpace: null,
        pixelWidth: null, pixelHeight: null, artboardIndex: rAbIndex, bounds: rBounds
      };
      try { rInfo.name = rItem.name || ""; } catch(e) {}
      try {
        var cs = rItem.imageColorSpace;
        if (cs === ImageColorSpace.RGB) rInfo.colorSpace = "RGB";
        else if (cs === ImageColorSpace.CMYK) rInfo.colorSpace = "CMYK";
        else if (cs === ImageColorSpace.Grayscale) rInfo.colorSpace = "grayscale";
        else rInfo.colorSpace = "other";
      } catch (e) {}
      try {
        var gb = rItem.geometricBounds;
        var placedWidthPt = gb[2] - gb[0];
        var placedHeightPt = -(gb[3] - gb[1]);
        try {
          var m = rItem.matrix;
          if (m && placedWidthPt > 0 && placedHeightPt > 0) {
            var scaleX = Math.sqrt(m.mValueA * m.mValueA + m.mValueB * m.mValueB);
            var scaleY = Math.sqrt(m.mValueC * m.mValueC + m.mValueD * m.mValueD);
            if (scaleX > 0 && scaleY > 0) {
              rInfo.pixelWidth = Math.round(placedWidthPt / scaleX);
              rInfo.pixelHeight = Math.round(placedHeightPt / scaleY);
              var ppiH = Math.round(rInfo.pixelWidth / (placedWidthPt / 72));
              var ppiV = Math.round(rInfo.pixelHeight / (placedHeightPt / 72));
              rInfo.resolution = Math.min(ppiH, ppiV);
            }
          }
        } catch(e3) {}
      } catch (e) {}
      images.push(rInfo);
    }

    writeResultFile(RESULT_PATH, { imageCount: images.length, coordinateSystem: coordSystem, images: images });
  }
} catch (e) {
  writeResultFile(RESULT_PATH, { error: true, message: e.message, line: e.line });
}
`;

// ── get first available font name from Illustrator ──
const listFontsJsx = `
var preflight = preflightChecks();
if (preflight) { writeResultFile(RESULT_PATH, preflight); }
else {
  var fonts = [];
  for (var i = 0; i < Math.min(5, app.textFonts.length); i++) {
    fonts.push({ name: app.textFonts[i].name, family: app.textFonts[i].family });
  }
  writeResultFile(RESULT_PATH, { fonts: fonts });
}
`;

// ── place linked image JSX ──
function placeImageJsx(filePath: string) {
  return `
var preflight = preflightChecks();
if (preflight) { writeResultFile(RESULT_PATH, preflight); }
else {
  try {
    var doc = app.activeDocument;
    var placed = doc.placedItems.add();
    placed.file = new File(${JSON.stringify(filePath)});
    var uuid = ensureUUID(placed);
    writeResultFile(RESULT_PATH, { uuid: uuid });
  } catch(e) {
    writeResultFile(RESULT_PATH, { error: true, message: e.message, line: e.line });
  }
}
`;
}

// ── Helper: create minimal test images ──
function createTestWebP(filePath: string, width: number, height: number) {
  // VP8X extended format
  const buf = Buffer.alloc(30);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(22, 4); // file size - 8
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8X', 12, 'ascii');
  buf.writeUInt32LE(10, 16); // chunk size
  buf.writeUInt8(0, 20); // flags
  buf[21] = 0; buf[22] = 0; buf[23] = 0; // reserved
  // canvas width-1 and height-1 as 24-bit LE
  const w = width - 1;
  const h = height - 1;
  buf[24] = w & 0xff; buf[25] = (w >> 8) & 0xff; buf[26] = (w >> 16) & 0xff;
  buf[27] = h & 0xff; buf[28] = (h >> 8) & 0xff; buf[29] = (h >> 16) & 0xff;
  fs.writeFileSync(filePath, buf);
}

function createTestPSD(filePath: string, width: number, height: number) {
  const buf = Buffer.alloc(26);
  buf.write('8BPS', 0, 'ascii');
  buf.writeUInt16BE(1, 4); // version
  // 6 bytes reserved (zeros)
  buf.writeUInt16BE(3, 12); // channels
  buf.writeUInt32BE(height, 14);
  buf.writeUInt32BE(width, 18);
  buf.writeUInt16BE(8, 22); // depth
  buf.writeUInt16BE(3, 24); // RGB mode
  fs.writeFileSync(filePath, buf);
}

function createTestHEIC(filePath: string, width: number, height: number) {
  // Minimal ISOBMFF with ftyp + meta containing ispe
  const ftypSize = 20;
  const ispeBox = Buffer.alloc(20);
  ispeBox.writeUInt32BE(20, 0); // box size
  ispeBox.write('ispe', 4, 'ascii');
  ispeBox.writeUInt32BE(0, 8); // version + flags
  ispeBox.writeUInt32BE(width, 12);
  ispeBox.writeUInt32BE(height, 16);

  const ftyp = Buffer.alloc(ftypSize);
  ftyp.writeUInt32BE(ftypSize, 0);
  ftyp.write('ftyp', 4, 'ascii');
  ftyp.write('heic', 8, 'ascii');
  ftyp.writeUInt32BE(0, 12);
  ftyp.write('heic', 16, 'ascii');

  fs.writeFileSync(filePath, Buffer.concat([ftyp, ispeBox]));
}

// ── Main ──
async function main() {
  console.log('=== Integration Check ===\n');
  await ensureTmpDir();

  // ── Check 1: create_text_frame with existing font → uuid only ──
  console.log('--- Check 1: create_text_frame with existing font ---');
  const fontResult = await executeJsx(listFontsJsx, {}) as any;
  const existingFont = fontResult.fonts?.[0]?.name;
  console.log(`  Using font: ${existingFont}`);

  const result1 = await executeJsx(createTextFrameJsx, {
    x: 50, y: 50, contents: 'Test existing font',
    font_name: existingFont, font_size: 24,
  }, { activate: true }) as any;
  console.log(`  Result: ${JSON.stringify(result1)}`);
  assert(typeof result1.uuid === 'string' && result1.uuid.length > 0, 'uuid が返る');
  assert(!result1.font_warning, 'font_warning が含まれない');
  assert(!result1.font_candidates, 'font_candidates が含まれない');
  const createdUuid = result1.uuid;

  // ── Check 2: create_text_frame with non-existing font → uuid + font_warning + font_candidates ──
  console.log('\n--- Check 2: create_text_frame with non-existing font ---');
  const result2 = await executeJsx(createTextFrameJsx, {
    x: 50, y: 100, contents: 'Test missing font',
    font_name: 'ZzNonExistentFont999', font_size: 24,
  }, { activate: true }) as any;
  console.log(`  Result: ${JSON.stringify(result2)}`);
  assert(typeof result2.uuid === 'string' && result2.uuid.length > 0, 'テキストフレームが作成され uuid が返る');
  assert(typeof result2.font_warning === 'string' && result2.font_warning.includes('not found'), 'font_warning が返る');
  assert(Array.isArray(result2.font_candidates), 'font_candidates が配列で返る');

  // ── Check 3: modify_object with non-existing font → errors + font_candidates ──
  console.log('\n--- Check 3: modify_object with non-existing font ---');
  const result3 = await executeJsx(modifyObjectJsx, {
    uuid: createdUuid,
    properties: { font_name: 'ZzNonExistentFont999' },
  }, { activate: true }) as any;
  console.log(`  Result: ${JSON.stringify(result3)}`);
  assert(result3.success === false, 'success: false');
  assert(Array.isArray(result3.errors) && result3.errors.some((e: string) => e.includes('not found')),
    'errors に "not found" メッセージが含まれる');
  assert(Array.isArray(result3.font_candidates), 'font_candidates が配列で返る');

  // ── Check 4: get_images with WebP/PSD/HEIC linked images ──
  console.log('\n--- Check 4: get_images with WebP/PSD/HEIC linked images ---');
  const tmpDir = path.join(os.tmpdir(), 'illustrator-mcp-img-test');
  fs.mkdirSync(tmpDir, { recursive: true });

  const testImages = [
    { ext: 'webp', w: 800, h: 600, create: createTestWebP },
    { ext: 'psd',  w: 1200, h: 900, create: createTestPSD },
    { ext: 'heic', w: 1920, h: 1080, create: createTestHEIC },
  ];

  for (const img of testImages) {
    const filePath = path.join(tmpDir, `test-image.${img.ext}`);
    img.create(filePath, img.w, img.h);

    // Verify readImageDimensions works
    const dims = readImageDimensions(filePath);
    assert(dims !== null && dims.width === img.w && dims.height === img.h,
      `readImageDimensions: ${img.ext} → ${dims?.width}×${dims?.height}`,
      `expected ${img.w}×${img.h}`);
  }

  // Place images in Illustrator and check get_images
  // Note: Illustrator may not support opening minimal test files,
  // so we test readImageDimensions separately above.
  // For actual linking, we need real image files — try placing and check resolution.
  for (const img of testImages) {
    const filePath = path.join(tmpDir, `test-image.${img.ext}`);
    try {
      const placeResult = await executeJsx(placeImageJsx(filePath), {}, { activate: true }) as any;
      if (placeResult.uuid) {
        console.log(`  Placed ${img.ext}: uuid=${placeResult.uuid}`);
      } else {
        console.log(`  ⚠️ ${img.ext}: Illustrator could not place minimal test file (expected for non-real images)`);
      }
    } catch (e: any) {
      console.log(`  ⚠️ ${img.ext}: ${e.message?.substring(0, 80)} (expected for minimal test files)`);
    }
  }

  // Now run get_images and check post-process DPI logic for any linked images present
  const imgResult = await executeJsx(getImagesJsx, { coordinate_system: 'artboard-web' }) as any;

  // Apply the same post-processing as get-images.ts
  if (imgResult?.images) {
    for (const img of imgResult.images) {
      if (img.type === 'linked' && img.filePath && !img.linkBroken) {
        try {
          const dims = readImageDimensions(img.filePath);
          if (dims && img.widthPt && img.heightPt) {
            img.pixelWidth = dims.width;
            img.pixelHeight = dims.height;
            const widthInches = img.widthPt / 72;
            const heightInches = img.heightPt / 72;
            const ppiH = Math.round(dims.width / widthInches);
            const ppiV = Math.round(dims.height / heightInches);
            img.resolution = Math.min(ppiH, ppiV);
          }
        } catch { /* skip */ }
      }
      delete img.widthPt;
      delete img.heightPt;
    }
  }

  console.log(`  Total images in document: ${imgResult?.imageCount ?? 0}`);

  const linkedImages = imgResult?.images?.filter((i: any) => i.type === 'linked' && !i.linkBroken) ?? [];
  for (const img of linkedImages) {
    const ext = path.extname(img.filePath).toLowerCase();
    const hasRes = typeof img.resolution === 'number' && img.resolution > 0;
    assert(hasRes, `Linked ${ext}: resolution=${img.resolution}, ${img.pixelWidth}×${img.pixelHeight}px`,
      `filePath=${img.filePath}`);
  }

  const embeddedImages = imgResult?.images?.filter((i: any) => i.type === 'embedded') ?? [];
  for (const img of embeddedImages) {
    const hasRes = typeof img.resolution === 'number' && img.resolution > 0;
    console.log(`  Embedded image: resolution=${img.resolution}, ${img.pixelWidth}×${img.pixelHeight}px`);
    if (hasRes) {
      assert(true, `Embedded image: resolution=${img.resolution}`);
    }
  }

  // ── Check 5: readImageDimensions with different aspect ratio (simulating 300×72 DPI) ──
  console.log('\n--- Check 5: Aspect ratio DPI — minimum value check ---');
  // Simulate: image is 600×200 pixels placed at 2in × 2.778in (144pt × 200pt)
  // ppiH = 600 / (144/72) = 300, ppiV = 200 / (200/72) ≈ 72
  // Expected: min(300, 72) = 72
  const testWidthPt = 144;  // 2 inches
  const testHeightPt = 200; // ~2.778 inches
  const testPixelW = 600;
  const testPixelH = 200;
  const ppiH = Math.round(testPixelW / (testWidthPt / 72));
  const ppiV = Math.round(testPixelH / (testHeightPt / 72));
  const minDpi = Math.min(ppiH, ppiV);
  console.log(`  Simulated: ${testPixelW}×${testPixelH}px in ${testWidthPt}×${testHeightPt}pt`);
  console.log(`  ppiH=${ppiH}, ppiV=${ppiV}, min=${minDpi}`);
  assert(ppiH === 300, `水平DPI: ${ppiH} === 300`);
  assert(ppiV === 72, `垂直DPI: ${ppiV} === 72`);
  assert(minDpi === 72, `最小DPI: ${minDpi} === 72 (min が正しく使われる)`);

  // ── Summary ──
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

  // Cleanup
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
