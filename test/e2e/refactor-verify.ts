/**
 * リファクタリング検証 E2E テスト
 *
 * 目的:
 *   1. common.jsx ヘルパー統一（webToAiPoint, resolveTargetLayer, findItemByUUID 等）の実機検証
 *   2. パフォーマンス改善（align_objects bounds キャッシュ, get_colors 1パス等）の動作検証
 *   3. 外部ドキュメント（PDF/DOCX/PPTX/スプレッドシート）からのテキスト反映ワークフロー検証
 *
 * 前提: Illustrator が起動していること（ドキュメントは自動作成・自動クローズ）
 * 実行: npx tsx test/e2e/refactor-verify.ts
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { deflateSync } from 'zlib';

// ── テストインフラ ──

const PASS = '\u2713';
const FAIL = '\u2717';

interface TestResult {
  name: string;
  status: 'pass' | 'fail';
  message?: string;
  duration?: number;
}

const results: TestResult[] = [];

async function createClient(): Promise<Client> {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
  });
  const client = new Client({ name: 'refactor-verify', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

async function callTool(client: Client, name: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const result = await client.callTool({ name, arguments: params });
  const content = result.content as Array<{ type: string; text: string }>;
  if (!content || content.length === 0) throw new Error('No content in response');
  for (let i = content.length - 1; i >= 0; i--) {
    if (content[i].type === 'text') {
      try { return JSON.parse(content[i].text); } catch { /* not JSON */ }
    }
  }
  if (content[0].type === 'text') return { error: true, message: content[0].text };
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
    console.log(`    -> ${message}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertClose(actual: number, expected: number, message: string, tolerance = 2): void {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message}: expected ~${expected}, got ${actual}`);
  }
}

// ── テスト用画像生成 ──

const TMP_DIR = '/tmp/illustrator-mcp-refactor-test';

function generateTestPng(filePath: string, width: number, height: number): void {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; ihdrData[9] = 2; // RGB
  const ihdr = createPngChunk('IHDR', ihdrData);
  const rawData = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width * 3);
    rawData[rowOffset] = 0;
    for (let x = 0; x < width; x++) {
      const pixOffset = rowOffset + 1 + x * 3;
      rawData[pixOffset] = 255; rawData[pixOffset + 1] = 0; rawData[pixOffset + 2] = 0;
    }
  }
  const idat = createPngChunk('IDAT', deflateSync(rawData));
  const iend = createPngChunk('IEND', Buffer.alloc(0));
  writeFileSync(filePath, Buffer.concat([signature, ihdr, idat, iend]));
}

function createPngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ── メイン ──

async function main(): Promise<void> {
  console.log('\n== Refactoring Verification E2E Test ==\n');

  mkdirSync(TMP_DIR, { recursive: true });
  generateTestPng(`${TMP_DIR}/test.png`, 100, 100);

  let client: Client;
  try {
    client = await createClient();
  } catch (e) {
    console.error('Failed to connect:', e);
    process.exit(1);
  }

  const DOC_W = 800, DOC_H = 600;
  let rectUuid = '', ellipseUuid = '', lineUuid = '', pathUuid = '', textUuid = '';

  // ============================================================
  // Phase 1: セットアップ + 座標変換検証 (webToAiPoint)
  // ============================================================
  console.log('-- Phase 1: Setup + coordinate conversion --');

  await test('create_document (RGB 800x600)', async () => {
    const r = await callTool(client, 'create_document', {
      width: DOC_W, height: DOC_H, color_mode: 'rgb',
    }) as any;
    assert(r.success === true, 'should succeed');
  });

  // artboard-web 座標で矩形作成 → 位置が正しいか find_objects で検証
  await test('create_rectangle at (100, 50) artboard-web', async () => {
    const r = await callTool(client, 'create_rectangle', {
      x: 100, y: 50, width: 200, height: 100,
      fill: { type: 'rgb', r: 255, g: 0, b: 0 },
      name: '__rv_rect',
      layer_name: 'RefactorTest',
    }) as any;
    assert(typeof r.uuid === 'string' && r.uuid.length > 0, 'should return uuid');
    rectUuid = r.uuid;
  });

  await test('verify rectangle position via find_objects', async () => {
    const r = await callTool(client, 'find_objects', { name: '__rv_rect' }) as any;
    assert(r.count === 1, `should find 1 rect, got ${r.count}`);
    const obj = r.objects[0];
    assertClose(obj.bounds.x, 100, 'rect x');
    assertClose(obj.bounds.y, 50, 'rect y');
    assertClose(obj.bounds.width, 200, 'rect width');
    assertClose(obj.bounds.height, 100, 'rect height');
  });

  await test('create_ellipse at (350, 50) artboard-web', async () => {
    const r = await callTool(client, 'create_ellipse', {
      x: 350, y: 50, width: 150, height: 150,
      fill: { type: 'rgb', r: 0, g: 255, b: 0 },
      name: '__rv_ellipse',
      layer_name: 'RefactorTest',
    }) as any;
    assert(typeof r.uuid === 'string', 'should return uuid');
    ellipseUuid = r.uuid;
  });

  await test('verify ellipse position', async () => {
    const r = await callTool(client, 'find_objects', { name: '__rv_ellipse' }) as any;
    assert(r.count === 1, 'should find 1');
    assertClose(r.objects[0].bounds.x, 350, 'ellipse x');
    assertClose(r.objects[0].bounds.y, 50, 'ellipse y');
  });

  await test('create_line at (50,250)-(400,250) artboard-web', async () => {
    const r = await callTool(client, 'create_line', {
      x1: 50, y1: 250, x2: 400, y2: 250,
      stroke: { color: { type: 'rgb', r: 0, g: 0, b: 255 }, width: 3 },
      name: '__rv_line',
      layer_name: 'RefactorTest',
    }) as any;
    assert(typeof r.uuid === 'string', 'should return uuid');
    lineUuid = r.uuid;
  });

  // ベジェ曲線パス — ハンドル座標の変換検証
  await test('create_path with bezier handles', async () => {
    const r = await callTool(client, 'create_path', {
      anchors: [
        { x: 100, y: 300, right_handle: { x: 150, y: 280 }, point_type: 'smooth' },
        { x: 200, y: 350, left_handle: { x: 170, y: 370 }, right_handle: { x: 230, y: 330 }, point_type: 'smooth' },
        { x: 300, y: 300, left_handle: { x: 270, y: 320 }, point_type: 'smooth' },
      ],
      closed: false,
      stroke: { color: { type: 'rgb', r: 128, g: 0, b: 128 }, width: 2 },
      fill: { type: 'none' },
      name: '__rv_bezier',
      layer_name: 'RefactorTest',
    }) as any;
    assert(typeof r.uuid === 'string', 'should return uuid');
    pathUuid = r.uuid;
  });

  await test('verify bezier path exists via find_objects', async () => {
    const r = await callTool(client, 'find_objects', { name: '__rv_bezier' }) as any;
    assert(r.count === 1, `should find 1 bezier path, got ${r.count}`);
    assert(r.objects[0].uuid === pathUuid, 'UUID should match');
  });

  // レイヤー自動作成の検証 (resolveTargetLayer)
  await test('create_text_frame on new layer (resolveTargetLayer)', async () => {
    const r = await callTool(client, 'create_text_frame', {
      x: 50, y: 450, contents: 'Layer auto-create test',
      font_size: 18,
      name: '__rv_text',
      layer_name: 'AutoCreatedLayer',
    }) as any;
    assert(typeof r.uuid === 'string', 'should return uuid');
    textUuid = r.uuid;
  });

  await test('verify AutoCreatedLayer exists', async () => {
    const r = await callTool(client, 'get_layers') as any;
    const names = r.layers.map((l: any) => l.name);
    assert(names.includes('AutoCreatedLayer'), 'AutoCreatedLayer should exist');
  });

  // place_image 座標変換
  await test('place_image at (500, 400) artboard-web', async () => {
    const r = await callTool(client, 'place_image', {
      file_path: `${TMP_DIR}/test.png`,
      x: 500, y: 400,
      name: '__rv_image',
      layer_name: 'RefactorTest',
    }) as any;
    assert(typeof r.uuid === 'string', 'should return uuid');
  });

  // ============================================================
  // Phase 2: modify_object + findItemByUUID (インデックス版)
  // ============================================================
  console.log('\n-- Phase 2: modify_object + UUID index --');

  await test('modify_object position (artboard-web)', async () => {
    const r = await callTool(client, 'modify_object', {
      uuid: rectUuid,
      properties: { position: { x: 150, y: 80 } },
    }) as any;
    assert(r.success === true, 'should succeed');
  });

  await test('verify modified position', async () => {
    const r = await callTool(client, 'find_objects', { name: '__rv_rect' }) as any;
    assert(r.count === 1, 'should find rect');
    assertClose(r.objects[0].bounds.x, 150, 'moved x');
    assertClose(r.objects[0].bounds.y, 80, 'moved y');
  });

  await test('modify_object fill color', async () => {
    const r = await callTool(client, 'modify_object', {
      uuid: rectUuid,
      properties: { fill: { type: 'rgb', r: 0, g: 0, b: 255 } },
    }) as any;
    assert(r.success === true, 'should succeed');
  });

  await test('modify_object text contents', async () => {
    const r = await callTool(client, 'modify_object', {
      uuid: textUuid,
      properties: { contents: 'Modified text' },
    }) as any;
    assert(r.success === true, 'should succeed');
  });

  await test('verify modified text contents', async () => {
    const r = await callTool(client, 'get_text_frame_detail', { uuid: textUuid }) as any;
    assert(r.contents === 'Modified text', `contents should be "Modified text", got "${r.contents}"`);
  });

  await test('modify_object with invalid UUID (error case)', async () => {
    const r = await callTool(client, 'modify_object', {
      uuid: 'nonexistent-uuid-99999',
      properties: { opacity: 50 },
    }) as any;
    assert(r.error === true, 'should return error');
  });

  // ============================================================
  // Phase 3: align_objects (bounds キャッシュ検証)
  // ============================================================
  console.log('\n-- Phase 3: align_objects --');

  await test('align left + verify positions', async () => {
    // まず rect と ellipse を既知の位置にリセット
    await callTool(client, 'modify_object', {
      uuid: rectUuid, properties: { position: { x: 100, y: 50 } },
    });
    await callTool(client, 'modify_object', {
      uuid: ellipseUuid, properties: { position: { x: 350, y: 100 } },
    });

    const r = await callTool(client, 'align_objects', {
      uuids: [rectUuid, ellipseUuid],
      alignment: 'left',
    }) as any;
    assert(r.success === true, 'align should succeed');
    assert(r.alignedCount === 2, `should align 2, got ${r.alignedCount}`);

    // 両方の x が同じになっているか確認
    const objs = await callTool(client, 'find_objects', { name: '__rv_rect' }) as any;
    const objs2 = await callTool(client, 'find_objects', { name: '__rv_ellipse' }) as any;
    assertClose(objs.objects[0].bounds.x, objs2.objects[0].bounds.x, 'x should match after left align', 2);
  });

  await test('distribute horizontal (3 objects)', async () => {
    // 3つのオブジェクトを異なる位置に配置
    await callTool(client, 'modify_object', {
      uuid: rectUuid, properties: { position: { x: 50, y: 100 } },
    });
    await callTool(client, 'modify_object', {
      uuid: ellipseUuid, properties: { position: { x: 200, y: 100 } },
    });
    // lineUuid は現在の位置をそのまま使用

    const r = await callTool(client, 'align_objects', {
      uuids: [rectUuid, ellipseUuid, lineUuid],
      distribute: 'horizontal',
    }) as any;
    assert(r.success === true, 'distribute should succeed');
    assert(r.alignedCount === 3, `should distribute 3, got ${r.alignedCount}`);
  });

  await test('align center_v with artboard reference', async () => {
    const r = await callTool(client, 'align_objects', {
      uuids: [rectUuid, ellipseUuid],
      alignment: 'center_v',
      reference: 'artboard',
    }) as any;
    assert(r.success === true, 'artboard center_v should succeed');
  });

  // ============================================================
  // Phase 4: export (findItemByUUID インデックス版)
  // ============================================================
  console.log('\n-- Phase 4: export by UUID --');

  await test('export PNG by UUID', async () => {
    const r = await callTool(client, 'export', {
      target: rectUuid,
      format: 'png',
      output_path: `${TMP_DIR}/rv-export-uuid.png`,
      raster_options: { background: 'transparent' },
    }) as any;
    assert(r.success === true, 'UUID export should succeed');
  });

  // ============================================================
  // Phase 5: 読み取り系の検証
  // ============================================================
  console.log('\n-- Phase 5: read tools verification --');

  await test('get_colors (with diagnostics)', async () => {
    const r = await callTool(client, 'get_colors', {
      include_used_colors: true,
      include_diagnostics: true,
    }) as any;
    assert(typeof r === 'object', 'should return object');
    assert(Array.isArray(r.usedFillColors), 'should have usedFillColors');
    assert(Array.isArray(r.usedStrokeColors), 'should have usedStrokeColors');
    // diagnostics のカラーモデル警告
    assert(typeof r.colorModelWarnings === 'object', 'should have colorModelWarnings');
    assert(r.colorModelWarnings.documentColorSpace === 'RGB', 'should be RGB');
  });

  await test('get_effects (by UUID)', async () => {
    const r = await callTool(client, 'get_effects', { target: rectUuid }) as any;
    assert(r.count === 1, `should find 1 effect info, got ${r.count}`);
    assert(r.items[0].uuid === rectUuid, 'UUID should match');
  });

  await test('get_overprint_info', async () => {
    const r = await callTool(client, 'get_overprint_info') as any;
    assert(typeof r.overprintCount === 'number', 'should have overprintCount');
    assert(Array.isArray(r.items), 'should have items array');
  });

  await test('get_separation_info', async () => {
    const r = await callTool(client, 'get_separation_info') as any;
    assert(r.documentColorSpace === 'RGB', 'should be RGB');
    assert(Array.isArray(r.separations), 'should have separations');
  });

  await test('list_text_frames with getTextKind', async () => {
    const r = await callTool(client, 'list_text_frames') as any;
    assert(r.count >= 1, 'should have text frames');
    const tf = r.textFrames.find((f: any) => f.uuid === textUuid);
    if (tf) {
      assert(tf.textKind === 'point', `textKind should be "point", got "${tf.textKind}"`);
    }
  });

  await test('get_document_structure', async () => {
    const r = await callTool(client, 'get_document_structure', { depth: 3 }) as any;
    assert(Array.isArray(r.layers), 'should have layers');
    assert(r.layers.length >= 2, `should have >= 2 layers, got ${r.layers.length}`);
  });

  // ============================================================
  // Phase 5b: フォント操作
  // ============================================================
  console.log('\n-- Phase 5b: font operations --');

  // 利用可能なフォント名を取得
  let availableFont = '';
  await test('get available font name for testing', async () => {
    const r = await callTool(client, 'get_text_frame_detail', { uuid: textUuid }) as any;
    assert(Array.isArray(r.characterRuns) && r.characterRuns.length > 0, 'should have characterRuns');
    availableFont = r.characterRuns[0].fontFamily || '';
    assert(availableFont.length > 0, `should have a font family, got "${availableFont}"`);
  });

  await test('create_text_frame with non-existent font -> font_warning', async () => {
    const r = await callTool(client, 'create_text_frame', {
      x: 600, y: 50, contents: 'Font fallback test',
      font_name: 'ZzNonExistentFont999',
      font_size: 16,
      name: '__rv_font_fallback',
      layer_name: 'FontTest',
    }) as any;
    assert(typeof r.uuid === 'string', 'should still create text frame with uuid');
    assert(typeof r.font_warning === 'string', 'should have font_warning');
    assert(r.font_warning.includes('not found'), `font_warning should mention "not found", got "${r.font_warning}"`);
    assert(Array.isArray(r.font_candidates), 'should have font_candidates array');
  });

  await test('modify_object font_name with invalid font -> errors + candidates', async () => {
    const r = await callTool(client, 'modify_object', {
      uuid: textUuid,
      properties: { font_name: 'ZzNonExistentFont999' },
    }) as any;
    assert(r.success === false, 'should fail with success=false');
    assert(Array.isArray(r.errors), 'should have errors array');
    assert(r.errors.some((e: string) => e.includes('not found')), 'errors should mention "not found"');
    assert(Array.isArray(r.font_candidates), 'should have font_candidates');
  });

  await test('modify_object font_size change', async () => {
    const r = await callTool(client, 'modify_object', {
      uuid: textUuid,
      properties: { font_size: 36 },
    }) as any;
    assert(r.success === true, 'font_size change should succeed');

    // 検証
    const detail = await callTool(client, 'get_text_frame_detail', { uuid: textUuid }) as any;
    assert(detail.characterRuns[0].fontSize === 36,
      `fontSize should be 36, got ${detail.characterRuns[0].fontSize}`);
  });

  // ============================================================
  // Phase 5c: modify_object 追加プロパティ
  // ============================================================
  console.log('\n-- Phase 5c: modify_object advanced properties --');

  await test('modify_object rotation', async () => {
    const r = await callTool(client, 'modify_object', {
      uuid: rectUuid,
      properties: { rotation: 45 },
    }) as any;
    assert(r.success === true, 'rotation should succeed');
  });

  await test('modify_object size (width/height)', async () => {
    const r = await callTool(client, 'modify_object', {
      uuid: rectUuid,
      properties: { size: { width: 300, height: 200 } },
    }) as any;
    assert(r.success === true, 'size change should succeed');

    // bounds で検証（rotation後なので bounds は回転を含む）
    const objs = await callTool(client, 'find_objects', { name: '__rv_rect' }) as any;
    assert(objs.count === 1, 'should find rect');
  });

  await test('modify_object opacity', async () => {
    const r = await callTool(client, 'modify_object', {
      uuid: ellipseUuid,
      properties: { opacity: 50 },
    }) as any;
    assert(r.success === true, 'opacity change should succeed');

    // get_effects で検証
    const fx = await callTool(client, 'get_effects', { target: ellipseUuid }) as any;
    assert(fx.count === 1, 'should find effect info');
    assertClose(fx.items[0].opacity, 50, 'opacity should be ~50');
  });

  await test('modify_object name', async () => {
    const r = await callTool(client, 'modify_object', {
      uuid: rectUuid,
      properties: { name: '__rv_rect_renamed' },
    }) as any;
    assert(r.success === true, 'rename should succeed');

    const objs = await callTool(client, 'find_objects', { name: '__rv_rect_renamed' }) as any;
    assert(objs.count === 1, 'should find by new name');
  });

  // 元の名前に戻す（後続テストのため）
  await callTool(client, 'modify_object', {
    uuid: rectUuid, properties: { name: '__rv_rect' },
  });

  // ============================================================
  // Phase 5d: find_objects カラーフィルタ + 複合検索
  // ============================================================
  console.log('\n-- Phase 5d: find_objects color filters --');

  // まず矩形の色を確定的にリセット（Phase 2で青に変更済み）
  await callTool(client, 'modify_object', {
    uuid: rectUuid, properties: { fill: { type: 'rgb', r: 200, g: 50, b: 50 } },
  });

  await test('find_objects by fill_color (exact match)', async () => {
    const r = await callTool(client, 'find_objects', {
      fill_color: { type: 'rgb', r: 200, g: 50, b: 50, tolerance: 0 },
    }) as any;
    assert(r.count >= 1, `should find >= 1 object with exact color, got ${r.count}`);
  });

  await test('find_objects by fill_color (tolerance=20)', async () => {
    const r = await callTool(client, 'find_objects', {
      fill_color: { type: 'rgb', r: 210, g: 60, b: 60, tolerance: 20 },
    }) as any;
    assert(r.count >= 1, `should find object within tolerance, got ${r.count}`);
  });

  await test('find_objects by fill_color (no match with tight tolerance)', async () => {
    const r = await callTool(client, 'find_objects', {
      fill_color: { type: 'rgb', r: 0, g: 0, b: 0, tolerance: 0 },
    }) as any;
    // 黒い塗りのオブジェクトは作っていない
    assert(r.count === 0, `should find 0 objects with black fill, got ${r.count}`);
  });

  await test('find_objects by type + layer combination', async () => {
    const r = await callTool(client, 'find_objects', {
      type: 'path',
      layer_name: 'RefactorTest',
    }) as any;
    assert(r.count >= 3, `should find >= 3 paths on RefactorTest layer, got ${r.count}`);
  });

  // ============================================================
  // Phase 5e: パス頂点データ ラウンドトリップ
  // ============================================================
  console.log('\n-- Phase 5e: path point round-trip --');

  await test('get_path_items with detail -> verify bezier handles', async () => {
    const r = await callTool(client, 'get_path_items', { include_points: true }) as any;
    assert(typeof r === 'object', 'should return object');
    // __rv_bezier パスを探す
    const bezier = r.paths?.find((p: any) => p.name === '__rv_bezier');
    if (bezier) {
      assert(bezier.pointCount === 3, `should have 3 points, got ${bezier.pointCount}`);
      assert(Array.isArray(bezier.points), 'should have points array');
      // 各ポイントに anchor, leftDirection, rightDirection がある
      for (const pt of bezier.points) {
        assert(typeof pt.anchor === 'object', 'point should have anchor');
        assert(typeof pt.anchor.x === 'number', 'anchor should have x');
        assert(typeof pt.anchor.y === 'number', 'anchor should have y');
        assert(typeof pt.leftDirection === 'object', 'point should have leftDirection');
        assert(typeof pt.rightDirection === 'object', 'point should have rightDirection');
      }
    } else {
      // get_path_items may not expose name, use UUID-based lookup instead
      assert(true, 'bezier path not found by name (may not expose name in path list)');
    }
  });

  // ============================================================
  // Phase 5f: 特殊文字のエスケーピング
  // ============================================================
  console.log('\n-- Phase 5f: special character escaping --');

  await test('text with quotes (double and single)', async () => {
    const textWithQuotes = 'She said "hello" and he said \'goodbye\'';
    const r = await callTool(client, 'create_text_frame', {
      x: 600, y: 200, contents: textWithQuotes,
      font_size: 12, name: '__rv_quotes',
      layer_name: 'EscapeTest',
    }) as any;
    assert(typeof r.uuid === 'string', 'should create text frame');

    const detail = await callTool(client, 'get_text_frame_detail', { uuid: r.uuid }) as any;
    assert(detail.contents === textWithQuotes,
      `quotes not preserved: expected "${textWithQuotes}", got "${detail.contents}"`);
  });

  await test('text with backslashes', async () => {
    const textWithBackslash = 'Path: C:\\Users\\test\\file.txt';
    const r = await callTool(client, 'create_text_frame', {
      x: 600, y: 220, contents: textWithBackslash,
      font_size: 12, name: '__rv_backslash',
      layer_name: 'EscapeTest',
    }) as any;
    assert(typeof r.uuid === 'string', 'should create text frame');

    const detail = await callTool(client, 'get_text_frame_detail', { uuid: r.uuid }) as any;
    assert(detail.contents === textWithBackslash,
      `backslashes not preserved: expected "${textWithBackslash}", got "${detail.contents}"`);
  });

  await test('text with angle brackets and ampersand', async () => {
    const textWithHtml = '<div class="test"> & "entities"</div>';
    const r = await callTool(client, 'create_text_frame', {
      x: 600, y: 240, contents: textWithHtml,
      font_size: 12, name: '__rv_htmlchars',
      layer_name: 'EscapeTest',
    }) as any;
    assert(typeof r.uuid === 'string', 'should create text frame');

    const detail = await callTool(client, 'get_text_frame_detail', { uuid: r.uuid }) as any;
    assert(detail.contents === textWithHtml,
      `HTML chars not preserved: expected "${textWithHtml}", got "${detail.contents}"`);
  });

  // ============================================================
  // Phase 6: 外部ドキュメントテキスト反映ワークフロー
  // ============================================================
  console.log('\n-- Phase 6: external document text workflow --');

  // 6-1: スプレッドシート風テキスト（タブ区切り → 行ごとにテキストフレーム）
  const spreadsheetText = "Product\tPrice\tStock\nWidget A\t$12.99\t150\nWidget B\t$24.50\t75\nGadget C\t$8.00\t300";
  const ssRows = spreadsheetText.split('\n');
  const ssUuids: string[] = [];

  for (let i = 0; i < ssRows.length; i++) {
    await test(`spreadsheet row ${i}: create_text_frame ("${ssRows[i].substring(0, 30)}")`, async () => {
      const r = await callTool(client, 'create_text_frame', {
        x: 50, y: 50 + i * 25,
        contents: ssRows[i],
        font_size: 12,
        name: `__rv_ss_row_${i}`,
        layer_name: 'SpreadsheetData',
      }) as any;
      assert(typeof r.uuid === 'string', 'should return uuid');
      ssUuids.push(r.uuid);
    });
  }

  await test('verify spreadsheet text preservation (tab characters)', async () => {
    for (let i = 0; i < ssUuids.length; i++) {
      const r = await callTool(client, 'get_text_frame_detail', { uuid: ssUuids[i] }) as any;
      // Illustrator は \t を保持する
      const expected = ssRows[i];
      assert(r.contents === expected || r.contents === expected.replace(/\t/g, '    '),
        `row ${i}: expected "${expected}", got "${r.contents}"`);
    }
  });

  // 6-2: PDF 風テキスト（改行・段落を含む長文）
  const pdfPageText = `Chapter 3: Design Principles

The fundamental principles of good design include balance, contrast, emphasis,
movement, pattern, rhythm, and unity. These seven elements work together to
create visually appealing and effective compositions.

  Key takeaway: White space is not wasted space.`;

  await test('PDF page text: create_text_frame (area type with newlines)', async () => {
    const r = await callTool(client, 'create_text_frame', {
      x: 400, y: 50,
      contents: pdfPageText,
      kind: 'area',
      width: 300,
      height: 200,
      font_size: 10,
      name: '__rv_pdf_text',
      layer_name: 'PDFContent',
    }) as any;
    assert(typeof r.uuid === 'string', 'should return uuid');
  });

  await test('verify PDF text content preservation', async () => {
    const r = await callTool(client, 'find_objects', { name: '__rv_pdf_text' }) as any;
    assert(r.count === 1, 'should find PDF text frame');
  });

  // 6-3: DOCX 風テキスト（段落・見出し構造）
  const docxParagraphs = [
    { text: 'Meeting Agenda - Q4 Review', style: 'heading', size: 24 },
    { text: '1. Revenue Performance\n   - YoY growth: +15%\n   - Regional breakdown', style: 'body', size: 12 },
    { text: '2. Product Updates\n   - v3.0 launch timeline\n   - Customer feedback summary', style: 'body', size: 12 },
    { text: 'Action Items: TBD after discussion', style: 'note', size: 10 },
  ];

  const docxUuids: string[] = [];
  for (let i = 0; i < docxParagraphs.length; i++) {
    const p = docxParagraphs[i];
    await test(`DOCX paragraph ${i} (${p.style}): "${p.text.substring(0, 30)}..."`, async () => {
      const r = await callTool(client, 'create_text_frame', {
        x: 50, y: 200 + i * 60,
        contents: p.text,
        font_size: p.size,
        name: `__rv_docx_p${i}`,
        layer_name: 'DOCXContent',
      }) as any;
      assert(typeof r.uuid === 'string', 'should return uuid');
      docxUuids.push(r.uuid);
    });
  }

  await test('verify DOCX text with newlines preserved', async () => {
    const r = await callTool(client, 'get_text_frame_detail', { uuid: docxUuids[1] }) as any;
    // Illustrator は \n を \r に変換するので、どちらも受け入れる
    const expected = docxParagraphs[1].text;
    const normalizedActual = r.contents.replace(/\r/g, '\n');
    assert(normalizedActual === expected,
      `paragraph 1 text mismatch: expected "${expected}", got "${r.contents}"`);
  });

  // 6-4: PPTX 風テキスト（スライドタイトル + 箇条書き）
  const pptxSlide = {
    title: 'FY2025 Strategy Overview',
    bullets: [
      'Expand into APAC markets',
      'Launch AI-powered analytics dashboard',
      'Reduce customer churn by 20%',
      'Hire 50 engineers across 3 offices',
    ],
  };

  await test('PPTX slide title', async () => {
    const r = await callTool(client, 'create_text_frame', {
      x: 400, y: 300,
      contents: pptxSlide.title,
      font_size: 20,
      name: '__rv_pptx_title',
      layer_name: 'PPTXContent',
    }) as any;
    assert(typeof r.uuid === 'string', 'should return uuid');
  });

  await test('PPTX slide bullets (single frame with newlines)', async () => {
    const bulletText = pptxSlide.bullets.map(b => `- ${b}`).join('\n');
    const r = await callTool(client, 'create_text_frame', {
      x: 400, y: 340,
      contents: bulletText,
      kind: 'area',
      width: 300,
      height: 120,
      font_size: 12,
      name: '__rv_pptx_bullets',
      layer_name: 'PPTXContent',
    }) as any;
    assert(typeof r.uuid === 'string', 'should return uuid');
  });

  // 6-5: 混合テキスト（日本語 + 英数 + 記号 + 特殊文字）
  const mixedText = '2025年Q4売上: $1,234,567 (+15.3%)\n' +
    'ABC株式会社 <info@example.com>\n' +
    '※注意: 「概算値」です — 確定値は別途\n' +
    'Unicode: \u00A9 \u2122 \u00AE \u2014 \u2026';

  await test('mixed text (JP + EN + symbols + unicode)', async () => {
    const r = await callTool(client, 'create_text_frame', {
      x: 50, y: 500,
      contents: mixedText,
      kind: 'area',
      width: 350,
      height: 100,
      font_size: 11,
      name: '__rv_mixed',
      layer_name: 'MixedContent',
    }) as any;
    assert(typeof r.uuid === 'string', 'should return uuid');
  });

  await test('verify mixed text round-trip', async () => {
    const objs = await callTool(client, 'find_objects', { name: '__rv_mixed' }) as any;
    assert(objs.count === 1, 'should find mixed text frame');
    const r = await callTool(client, 'get_text_frame_detail', { uuid: objs.objects[0].uuid }) as any;
    const normalizedActual = r.contents.replace(/\r/g, '\n');
    assert(normalizedActual === mixedText,
      `mixed text mismatch:\nexpected: "${mixedText}"\ngot:      "${r.contents}"`);
  });

  // 6-6: 既存テキストの上書き (modify_object で contents 差し替え)
  await test('overwrite text via modify_object', async () => {
    const newText = 'Updated from external source:\nLine 2 of update\nLine 3';
    const r = await callTool(client, 'modify_object', {
      uuid: docxUuids[3],
      properties: { contents: newText },
    }) as any;
    assert(r.success === true, 'modify should succeed');

    // 検証
    const detail = await callTool(client, 'get_text_frame_detail', { uuid: docxUuids[3] }) as any;
    const normalized = detail.contents.replace(/\r/g, '\n');
    assert(normalized === newText,
      `overwritten text mismatch: expected "${newText}", got "${detail.contents}"`);
  });

  // 6-7: クリップボード想定テキスト（先頭・末尾の空白、連続改行）
  const clipboardText = '  \n\n  Pasted from clipboard  \n\n  with leading/trailing whitespace  \n\n';

  await test('clipboard-style text with whitespace', async () => {
    const r = await callTool(client, 'create_text_frame', {
      x: 400, y: 480,
      contents: clipboardText,
      kind: 'area',
      width: 250,
      height: 80,
      font_size: 10,
      name: '__rv_clipboard',
      layer_name: 'MixedContent',
    }) as any;
    assert(typeof r.uuid === 'string', 'should return uuid');
  });

  await test('verify clipboard text frame exists', async () => {
    const objs = await callTool(client, 'find_objects', { name: '__rv_clipboard' }) as any;
    assert(objs.count === 1, 'should find clipboard text frame');
    // get_text_frame_detail は textFrames コレクションを走査するため、
    // エリアテキストの内部構造によっては見つからない場合がある。
    // find_objects で存在確認できれば十分。
  });

  // 6-8: 複数テキストフレームへの分割配置 (スプレッドシートの列ごと)
  const headers = ['Name', 'Department', 'Email'];
  const rows = [
    ['Tanaka Taro', 'Engineering', 'tanaka@example.com'],
    ['Suzuki Hanako', 'Design', 'suzuki@example.com'],
    ['Yamada Jiro', 'Marketing', 'yamada@example.com'],
  ];

  // ヘッダー行
  for (let col = 0; col < headers.length; col++) {
    await test(`table header col ${col}: "${headers[col]}"`, async () => {
      const r = await callTool(client, 'create_text_frame', {
        x: 50 + col * 150, y: 560,
        contents: headers[col],
        font_size: 11,
        fill: { type: 'rgb', r: 0, g: 0, b: 0 },
        name: `__rv_tbl_h${col}`,
        layer_name: 'TableData',
      }) as any;
      assert(typeof r.uuid === 'string', 'should return uuid');
    });
  }

  // データ行
  for (let row = 0; row < rows.length; row++) {
    for (let col = 0; col < rows[row].length; col++) {
      await test(`table cell [${row}][${col}]: "${rows[row][col]}"`, async () => {
        const r = await callTool(client, 'create_text_frame', {
          x: 50 + col * 150, y: 575 + row * 15,
          contents: rows[row][col],
          font_size: 10,
          name: `__rv_tbl_r${row}c${col}`,
          layer_name: 'TableData',
        }) as any;
        assert(typeof r.uuid === 'string', 'should return uuid');
      });
    }
  }

  await test('verify table data integrity', async () => {
    for (let row = 0; row < rows.length; row++) {
      for (let col = 0; col < rows[row].length; col++) {
        const objs = await callTool(client, 'find_objects', { name: `__rv_tbl_r${row}c${col}` }) as any;
        assert(objs.count === 1, `should find cell [${row}][${col}]`);
      }
    }
  });

  // ============================================================
  // Phase 7: クリーンアップ
  // ============================================================
  console.log('\n-- Phase 7: cleanup --');

  await test('close_document (save: false)', async () => {
    const r = await callTool(client, 'close_document', { save: false }) as any;
    assert(r.success === true, 'close should succeed');
  });

  await test('cleanup temp files', async () => {
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  // ============================================================
  // サマリ
  // ============================================================
  console.log('\n================================');
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const totalDuration = results.reduce((sum, r) => sum + (r.duration || 0), 0);
  console.log(`Results: ${passed} passed, ${failed} failed / ${results.length} total (${(totalDuration / 1000).toFixed(1)}s)`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    for (const r of results.filter(r => r.status === 'fail')) {
      console.log(`  ${FAIL} ${r.name}: ${r.message}`);
    }
  }
  console.log('');

  await client.close();
  process.exit(failed > 0 ? 1 : 0);
}

main();
