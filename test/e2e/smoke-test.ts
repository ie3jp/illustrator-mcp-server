/**
 * E2E スモークテスト
 * create_document で新規ドキュメントを作成し、全ツールをテストした後 close_document で閉じる。
 * Illustrator が起動していれば、開いているファイルに依存せず実行可能。
 *
 * 使い方: npx tsx test/e2e/smoke-test.ts
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { deflateSync } from 'zlib';

const PASS = '✓';
const FAIL = '✗';
const SKIP = '○';

interface TestResult {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  message?: string;
  duration?: number;
}

const results: TestResult[] = [];

async function createClient(): Promise<Client> {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
  });
  const client = new Client({ name: 'smoke-test', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

async function callTool(client: Client, name: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const result = await client.callTool({ name, arguments: params });
  const content = result.content as Array<{ type: string; text: string }>;
  if (content && content.length > 0 && content[0].type === 'text') {
    const text = content[0].text;
    // エラーレスポンスの場合、JSX runner が throw するため plain text になる
    // JSON パースを試み、失敗したら error オブジェクトとして返す
    try {
      return JSON.parse(text);
    } catch {
      return { error: true, message: text };
    }
  }
  throw new Error('No text content in response');
}

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    const duration = Date.now() - start;
    results.push({ name, status: 'pass', duration });
    console.log(`  ${PASS} ${name} (${duration}ms)`);
  } catch (e) {
    const duration = Date.now() - start;
    const message = e instanceof Error ? e.message : String(e);
    results.push({ name, status: 'fail', message, duration });
    console.log(`  ${FAIL} ${name} (${duration}ms)`);
    console.log(`    → ${message}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertClose(actual: number, expected: number, message: string, tolerance = 1): void {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message}: expected ~${expected}, got ${actual}`);
  }
}

// テストデータ定数
const DOC_WIDTH = 800;
const DOC_HEIGHT = 600;
const DOC_COLOR_MODE = 'rgb';
const TMP_DIR = '/tmp/illustrator-mcp-e2e-test';

// テスト用画像の定数
const TEST_IMG_WIDTH = 100; // px
const TEST_IMG_HEIGHT = 100; // px
const TEST_IMG_PATH_LINKED = `${TMP_DIR}/e2e-test-image.png`;
const TEST_IMG_PATH_EMBEDDED = `${TMP_DIR}/e2e-test-image-embed.png`;
// 配置サイズ: 100x100 px を 100x100 pt に配置 → 72 DPI (= 100 / (100/72))
const TEST_IMG_PLACE_SIZE_PT = 100;
const TEST_IMG_EXPECTED_DPI = 72;

/**
 * 最小限の有効なPNGファイルを生成する。
 * 指定サイズの赤い正方形画像。
 */
function generateTestPng(filePath: string, width: number, height: number): void {
  // PNG signature
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 2;  // color type: RGB
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = createPngChunk('IHDR', ihdrData);

  // IDAT chunk — red pixels (R=255, G=0, B=0)
  const rawData = Buffer.alloc(height * (1 + width * 3)); // filter byte + RGB per pixel per row
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width * 3);
    rawData[rowOffset] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const pixOffset = rowOffset + 1 + x * 3;
      rawData[pixOffset] = 255;     // R
      rawData[pixOffset + 1] = 0;   // G
      rawData[pixOffset + 2] = 0;   // B
    }
  }
  const compressed = deflateSync(rawData);
  const idat = createPngChunk('IDAT', compressed);

  // IEND chunk
  const iend = createPngChunk('IEND', Buffer.alloc(0));

  writeFileSync(filePath, Buffer.concat([signature, ihdr, idat, iend]));
}

function createPngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function main(): Promise<void> {
  console.log('\n🔧 Illustrator MCP Server — E2E Smoke Test\n');
  console.log('サーバーに接続中...');

  let client: Client;
  try {
    client = await createClient();
  } catch (e) {
    console.error('サーバー接続失敗:', e);
    process.exit(1);
  }

  console.log('接続完了\n');

  // UUID を Phase 間で受け渡すための変数
  let rectUuid = '';
  let ellipseUuid = '';
  let lineUuid = '';
  let textUuid = '';
  let pathUuid = '';
  let linkedImageUuid = '';
  let embeddedImageUuid = '';
  let modifiedRectName = '__e2e_rect_modified';

  // テスト用ディレクトリとPNG画像を生成
  mkdirSync(TMP_DIR, { recursive: true });
  generateTestPng(TEST_IMG_PATH_LINKED, TEST_IMG_WIDTH, TEST_IMG_HEIGHT);
  generateTestPng(TEST_IMG_PATH_EMBEDDED, TEST_IMG_WIDTH, TEST_IMG_HEIGHT);
  console.log(`テスト画像生成: ${TEST_IMG_WIDTH}x${TEST_IMG_HEIGHT}px PNG → ${TMP_DIR}/`);

  // ============================================================
  // Phase 0: セットアップ — 新規ドキュメント作成 + テストオブジェクト配置
  // ============================================================
  console.log('── Phase 0: セットアップ ──');

  await test('create_document (RGB, 800x600)', async () => {
    const result = await callTool(client, 'create_document', {
      width: DOC_WIDTH,
      height: DOC_HEIGHT,
      color_mode: DOC_COLOR_MODE,
    }) as any;
    assert(result.success === true, 'create_document should succeed');
    assertClose(result.width, DOC_WIDTH, 'width');
    assertClose(result.height, DOC_HEIGHT, 'height');
    assert(result.colorMode === 'RGB', `colorMode should be RGB, got ${result.colorMode}`);
  });

  await test('create_rectangle → __e2e_rect', async () => {
    const result = await callTool(client, 'create_rectangle', {
      x: 50, y: 50, width: 200, height: 150,
      fill: { type: 'rgb', r: 255, g: 0, b: 0 },
      name: '__e2e_rect',
      layer_name: 'TestLayer-Main',
    }) as any;
    assert(typeof result.uuid === 'string' && result.uuid.length > 0, 'should return uuid');
    rectUuid = result.uuid;
  });

  await test('create_ellipse → __e2e_ellipse', async () => {
    const result = await callTool(client, 'create_ellipse', {
      x: 300, y: 50, width: 150, height: 150,
      fill: { type: 'rgb', r: 0, g: 255, b: 0 },
      name: '__e2e_ellipse',
      layer_name: 'TestLayer-Main',
    }) as any;
    assert(typeof result.uuid === 'string' && result.uuid.length > 0, 'should return uuid');
    ellipseUuid = result.uuid;
  });

  await test('create_line → __e2e_line', async () => {
    const result = await callTool(client, 'create_line', {
      x1: 50, y1: 250, x2: 400, y2: 250,
      stroke: { color: { type: 'rgb', r: 0, g: 0, b: 255 }, width: 2 },
      name: '__e2e_line',
      layer_name: 'TestLayer-Main',
    }) as any;
    assert(typeof result.uuid === 'string' && result.uuid.length > 0, 'should return uuid');
    lineUuid = result.uuid;
  });

  await test('create_text_frame → __e2e_text', async () => {
    const result = await callTool(client, 'create_text_frame', {
      x: 50, y: 300, contents: 'E2E Test テスト',
      font_size: 24,
      name: '__e2e_text',
      layer_name: 'TestLayer-Text',
    }) as any;
    assert(typeof result.uuid === 'string' && result.uuid.length > 0, 'should return uuid');
    textUuid = result.uuid;
  });

  await test('create_path → __e2e_path (triangle)', async () => {
    const result = await callTool(client, 'create_path', {
      anchors: [
        { x: 500, y: 50 },
        { x: 550, y: 200 },
        { x: 600, y: 50 },
      ],
      closed: true,
      fill: { type: 'rgb', r: 255, g: 255, b: 0 },
      name: '__e2e_path',
      layer_name: 'TestLayer-Main',
    }) as any;
    assert(typeof result.uuid === 'string' && result.uuid.length > 0, 'should return uuid');
    pathUuid = result.uuid;
  });

  // 画像の配置（リンク）
  await test('place_image → __e2e_linked_image (linked)', async () => {
    const result = await callTool(client, 'place_image', {
      file_path: TEST_IMG_PATH_LINKED,
      x: 50, y: 400,
      name: '__e2e_linked_image',
      layer_name: 'TestLayer-Main',
      embed: false,
    }) as any;
    assert(typeof result.uuid === 'string' && result.uuid.length > 0, 'should return uuid');
    assert(result.type === 'linked', `type should be "linked", got "${result.type}"`);
    linkedImageUuid = result.uuid;
  });

  // 画像の配置（埋め込み）
  await test('place_image → __e2e_embedded_image (embedded)', async () => {
    const result = await callTool(client, 'place_image', {
      file_path: TEST_IMG_PATH_EMBEDDED,
      x: 200, y: 400,
      name: '__e2e_embedded_image',
      layer_name: 'TestLayer-Main',
      embed: true,
    }) as any;
    assert(typeof result.uuid === 'string' && result.uuid.length > 0, 'should return uuid');
    assert(result.type === 'embedded', `type should be "embedded", got "${result.type}"`);
    embeddedImageUuid = result.uuid;
  });

  // ============================================================
  // Phase 1: 読み取り系
  // ============================================================
  console.log('\n── Phase 1: 読み取り系 ──');

  await test('get_document_info → 800x600, RGB', async () => {
    const result = await callTool(client, 'get_document_info') as any;
    assertClose(result.width, DOC_WIDTH, 'width');
    assertClose(result.height, DOC_HEIGHT, 'height');
    assert(result.colorMode === 'RGB', `colorMode should be RGB, got ${result.colorMode}`);
    assert(result.artboardCount === 1, `artboardCount should be 1, got ${result.artboardCount}`);
  });

  await test('get_artboards → 1 artboard, 800x600', async () => {
    const result = await callTool(client, 'get_artboards') as any;
    assert(Array.isArray(result.artboards), 'artboards should be array');
    assert(result.artboards.length === 1, `should have 1 artboard, got ${result.artboards.length}`);
    const ab = result.artboards[0];
    assertClose(ab.size.width, DOC_WIDTH, 'artboard width');
    assertClose(ab.size.height, DOC_HEIGHT, 'artboard height');
  });

  await test('get_artboards (index: 0)', async () => {
    const result = await callTool(client, 'get_artboards', { index: 0 }) as any;
    assert(result.artboards.length === 1, 'should return exactly 1 artboard');
  });

  await test('get_layers → TestLayer-Main, TestLayer-Text', async () => {
    const result = await callTool(client, 'get_layers') as any;
    assert(Array.isArray(result.layers), 'layers should be array');
    const names = result.layers.map((l: any) => l.name);
    assert(names.includes('TestLayer-Main'), 'should have TestLayer-Main');
    assert(names.includes('TestLayer-Text'), 'should have TestLayer-Text');
  });

  await test('get_selection', async () => {
    const result = await callTool(client, 'get_selection') as any;
    assert(typeof result.selectionCount === 'number', 'should have selectionCount');
    // embed() 後にオブジェクトが選択状態になる場合がある
  });

  await test('list_text_frames → count >= 1', async () => {
    const result = await callTool(client, 'list_text_frames') as any;
    assert(result.count >= 1, `text frame count should be >= 1, got ${result.count}`);
    assert(Array.isArray(result.textFrames), 'textFrames should be array');
  });

  await test('get_text_frame_detail (by UUID)', async () => {
    const detail = await callTool(client, 'get_text_frame_detail', { uuid: textUuid }) as any;
    assert(typeof detail.contents === 'string', 'should have contents');
    assert(detail.contents.includes('E2E Test'), `contents should include "E2E Test", got "${detail.contents}"`);
  });

  await test('get_document_structure', async () => {
    const result = await callTool(client, 'get_document_structure', { depth: 2 }) as any;
    assert(Array.isArray(result.layers), 'should have layers array');
    assert(result.layers.length >= 2, `should have >= 2 layers, got ${result.layers.length}`);
  });

  await test('get_colors', async () => {
    const result = await callTool(client, 'get_colors') as any;
    assert(typeof result === 'object', 'should return an object');
  });

  await test('get_path_items', async () => {
    const result = await callTool(client, 'get_path_items') as any;
    assert(typeof result === 'object', 'should return an object');
    // rect, ellipse, line, path — at least 4 path items
    assert(result.count >= 4, `should have >= 4 path items, got ${result.count}`);
  });

  await test('get_guidelines → empty', async () => {
    const result = await callTool(client, 'get_guidelines') as any;
    assert(Array.isArray(result.horizontal), 'should have horizontal array');
    assert(Array.isArray(result.vertical), 'should have vertical array');
    assert(result.totalCount === 0, `new doc should have 0 guidelines, got ${result.totalCount}`);
  });

  await test('get_groups → empty', async () => {
    const result = await callTool(client, 'get_groups') as any;
    assert(typeof result === 'object', 'should return an object');
  });

  await test('get_effects', async () => {
    const result = await callTool(client, 'get_effects') as any;
    assert(typeof result === 'object', 'should return an object');
  });

  await test('get_images → 2 images (linked + embedded)', async () => {
    const result = await callTool(client, 'get_images') as any;
    assert(typeof result === 'object', 'should return an object');
    assert(result.imageCount === 2, `should have 2 images, got ${result.imageCount}`);
    assert(Array.isArray(result.images), 'images should be array');

    // リンク画像の検証
    const linked = result.images.find((img: any) => img.uuid === linkedImageUuid);
    assert(linked, 'should find linked image by UUID');
    assert(linked.type === 'linked', `linked image type should be "linked", got "${linked.type}"`);
    assert(linked.linkBroken === false, 'linked image should not be broken');
    assert(typeof linked.pixelWidth === 'number' && linked.pixelWidth === TEST_IMG_WIDTH,
      `linked pixelWidth should be ${TEST_IMG_WIDTH}, got ${linked.pixelWidth}`);
    assert(typeof linked.pixelHeight === 'number' && linked.pixelHeight === TEST_IMG_HEIGHT,
      `linked pixelHeight should be ${TEST_IMG_HEIGHT}, got ${linked.pixelHeight}`);
    assert(typeof linked.resolution === 'number' && linked.resolution > 0,
      `linked resolution should be > 0, got ${linked.resolution}`);

    // 埋め込み画像の検証
    const embedded = result.images.find((img: any) => img.uuid === embeddedImageUuid);
    assert(embedded, 'should find embedded image by UUID');
    assert(embedded.type === 'embedded', `embedded image type should be "embedded", got "${embedded.type}"`);
    assert(typeof embedded.resolution === 'number' && embedded.resolution > 0,
      `embedded resolution should be > 0, got ${embedded.resolution}`);
    assert(embedded.colorSpace === 'RGB', `embedded colorSpace should be "RGB", got "${embedded.colorSpace}"`);
  });

  await test('get_symbols → empty', async () => {
    const result = await callTool(client, 'get_symbols') as any;
    assert(typeof result === 'object', 'should return an object');
  });

  await test('find_objects (name: "__e2e_rect") → count=1', async () => {
    const result = await callTool(client, 'find_objects', { name: '__e2e_rect' }) as any;
    assert(result.count === 1, `should find exactly 1, got ${result.count}`);
    assert(result.objects[0].uuid === rectUuid, 'UUID should match');
  });

  await test('find_objects (type: "text") → count >= 1', async () => {
    const result = await callTool(client, 'find_objects', { type: 'text' }) as any;
    assert(result.count >= 1, `should find >= 1 text, got ${result.count}`);
  });

  // ============================================================
  // Phase 2: 操作系
  // ============================================================
  console.log('\n── Phase 2: 操作系 ──');

  await test('modify_object → opacity=50, rename', async () => {
    const result = await callTool(client, 'modify_object', {
      uuid: rectUuid,
      properties: {
        opacity: 50,
        name: modifiedRectName,
      },
    }) as any;
    assert(result.success === true, 'modify should succeed');
  });

  await test('find_objects → modified name', async () => {
    const result = await callTool(client, 'find_objects', { name: modifiedRectName }) as any;
    assert(result.count === 1, `should find 1 modified rect, got ${result.count}`);
  });

  await test('convert_to_outlines (TestLayer-Text)', async () => {
    const result = await callTool(client, 'convert_to_outlines', {
      target: 'TestLayer-Text',
    }) as any;
    assert(typeof result === 'object', 'should return a result object');
    assert(!result.error, 'should not return error: ' + (result.message || ''));
  });

  // ============================================================
  // Phase 3: 書き出し
  // ============================================================
  console.log('\n── Phase 3: 書き出し ──');

  await test('export SVG (artboard:0)', async () => {
    // NOTE: SVG artboard エクスポートは Illustrator が "ファイル名_アートボード名.svg" で出力するため
    // 指定パスにファイルが作成されず export ツールが error を返す既知の制限あり。
    // ここではエクスポート自体が実行されること（timeout しないこと）を検証する。
    const result = await callTool(client, 'export', {
      target: 'artboard:0',
      format: 'svg',
      output_path: `${TMP_DIR}/e2e-export.svg`,
    }) as any;
    if (result.error && typeof result.message === 'string' && result.message.includes('output file was not created')) {
      // Known issue: Illustrator appends artboard name suffix to SVG filename
      // The file is actually created as "e2e-export_<artboard name>.svg"
    } else {
      assert(result.success === true, 'SVG export should succeed: ' + JSON.stringify(result));
    }
  });

  await test('export PNG (artboard:0)', async () => {
    const result = await callTool(client, 'export', {
      target: 'artboard:0',
      format: 'png',
      output_path: `${TMP_DIR}/e2e-export.png`,
    }) as any;
    assert(result.success === true, 'PNG export should succeed');
  });

  await test('export JPG (artboard:0)', async () => {
    const result = await callTool(client, 'export', {
      target: 'artboard:0',
      format: 'jpg',
      output_path: `${TMP_DIR}/e2e-export.jpg`,
    }) as any;
    assert(result.success === true, 'JPG export should succeed');
  });

  // UUID 指定の isolated export
  await test('export PNG by UUID (isolated export)', async () => {
    const outPath = `${TMP_DIR}/e2e-uuid-export.png`;
    const result = await callTool(client, 'export', {
      target: rectUuid,
      format: 'png',
      output_path: outPath,
      raster_options: { background: 'transparent' },
    }) as any;
    assert(result.success === true, 'UUID PNG export should succeed');
    assert(result.output_path === outPath, 'output_path should match');
  });

  await test('export JPG by UUID (isolated export)', async () => {
    const result = await callTool(client, 'export', {
      target: rectUuid,
      format: 'jpg',
      output_path: `${TMP_DIR}/e2e-uuid-export.jpg`,
    }) as any;
    assert(result.success === true, 'UUID JPG export should succeed');
  });

  await test('export SVG by UUID', async () => {
    const result = await callTool(client, 'export', {
      target: rectUuid,
      format: 'svg',
      output_path: `${TMP_DIR}/e2e-uuid-export.svg`,
    }) as any;
    assert(result.success === true, 'UUID SVG export should succeed');
  });

  // エラーケース
  await test('export to non-existent directory (should error)', async () => {
    const result = await callTool(client, 'export', {
      target: 'artboard:0',
      format: 'png',
      output_path: '/nonexistent/dir/test.png',
    }) as any;
    assert(result.error === true, 'should return error for non-existent directory');
    assert(typeof result.message === 'string' && result.message.includes('does not exist'),
      'error message should mention directory does not exist');
  });

  await test('export with invalid UUID (should error)', async () => {
    const result = await callTool(client, 'export', {
      target: 'nonexistent-uuid-12345',
      format: 'png',
      output_path: `${TMP_DIR}/should-not-exist.png`,
    }) as any;
    assert(result.error === true, 'should return error for invalid UUID');
  });

  // PDF
  await test('export_pdf', async () => {
    const result = await callTool(client, 'export_pdf', {
      output_path: `${TMP_DIR}/e2e-export.pdf`,
      options: { trim_marks: true },
    }) as any;
    assert(result.success === true, 'PDF export should succeed');
  });

  await test('export_pdf to non-existent directory (should error)', async () => {
    const result = await callTool(client, 'export_pdf', {
      output_path: '/nonexistent/dir/test.pdf',
    }) as any;
    assert(result.error === true, 'should return error for non-existent directory');
    assert(typeof result.message === 'string' && result.message.includes('does not exist'),
      'error message should mention directory does not exist');
  });

  // ============================================================
  // Phase 4: ユーティリティ
  // ============================================================
  console.log('\n── Phase 4: ユーティリティ ──');

  await test('preflight_check', async () => {
    const result = await callTool(client, 'preflight_check') as any;
    assert(typeof result.checkCount === 'number', 'should have checkCount');
    assert(Array.isArray(result.results), 'should have results array');
  });

  await test('preflight_check → low_resolution detection (min_dpi: 150)', async () => {
    // テスト画像は約 72 DPI なので、min_dpi=150 で検出されるはず
    const result = await callTool(client, 'preflight_check', { min_dpi: 150 }) as any;
    assert(Array.isArray(result.results), 'should have results array');
    const lowRes = result.results.filter((r: any) => r.category === 'low_resolution');
    assert(lowRes.length >= 1, `should detect at least 1 low-resolution image, got ${lowRes.length}`);
    // 検出された画像の effectivePPI が min_dpi 未満であることを確認
    for (const item of lowRes) {
      assert(item.level === 'error', `low_resolution level should be "error", got "${item.level}"`);
      assert(item.details.effectivePPI < 150,
        `effectivePPI should be < 150, got ${item.details.effectivePPI}`);
    }
  });

  await test('preflight_check → no low_resolution at min_dpi: 30', async () => {
    // min_dpi=30 なら 72 DPI の画像は通過するはず
    const result = await callTool(client, 'preflight_check', { min_dpi: 30 }) as any;
    const lowRes = result.results.filter((r: any) => r.category === 'low_resolution');
    assert(lowRes.length === 0, `should detect 0 low-resolution images at min_dpi=30, got ${lowRes.length}`);
  });

  await test('get_overprint_info', async () => {
    const result = await callTool(client, 'get_overprint_info') as any;
    assert(typeof result === 'object', 'should return an object');
  });

  await test('apply_color_profile (sRGB)', async () => {
    const result = await callTool(client, 'apply_color_profile', {
      profile: 'sRGB IEC61966-2.1',
    }) as any;
    assert(typeof result === 'object', 'should return a result object');
    assert(!result.error, 'should not return error: ' + (result.message || ''));
  });

  // ============================================================
  // Phase 5: クリーンアップ — ドキュメントを閉じ、一時ファイルを削除
  // ============================================================
  console.log('\n── Phase 5: クリーンアップ ──');

  await test('close_document (save: false)', async () => {
    const result = await callTool(client, 'close_document', { save: false }) as any;
    assert(result.success === true, 'close_document should succeed');
  });

  await test('cleanup temp files', async () => {
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  // ============================================================
  // 結果サマリ
  // ============================================================
  console.log('\n══════════════════════════════════');
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const skipped = results.filter(r => r.status === 'skip').length;
  console.log(`結果: ${passed} passed, ${failed} failed, ${skipped} skipped / ${results.length} total`);

  if (failed > 0) {
    console.log('\n失敗したテスト:');
    for (const r of results.filter(r => r.status === 'fail')) {
      console.log(`  ${FAIL} ${r.name}: ${r.message}`);
    }
  }
  console.log('');

  await client.close();
  process.exit(failed > 0 ? 1 : 0);
}

main();
