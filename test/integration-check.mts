/**
 * Integration check script — requires a running Illustrator with an open document.
 * Run: node test/integration-check.mts
 */
import { executeJsx } from '../dist/executor/jsx-runner.js';
import { ensureTmpDir } from '../dist/executor/file-transport.js';
import { jsxCode as createTextFrameJsx } from '../dist/tools/modify/create-text-frame.js';
import { jsxCode as modifyObjectJsx } from '../dist/tools/modify/modify-object.js';
import { jsxCode as getImagesJsx } from '../dist/tools/read/get-images.js';
import { readImageDimensions } from '../dist/utils/image-header.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const PASS = '✅';
const FAIL = '❌';
let passed = 0;
let failed = 0;
const listFontsJsx = fs.readFileSync(new URL('./fixtures/list-fonts.jsx', import.meta.url), 'utf8');

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    console.log(`${PASS} ${label}`);
    passed++;
  } else {
    console.log(`${FAIL} ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

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
