/**
 * E2E スモークテスト
 * 前提: Illustrator が起動し、何かファイルが開いている状態で実行
 *
 * 使い方: npx tsx test/e2e/smoke-test.ts
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

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
    return JSON.parse(content[0].text);
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

  // ============================================================
  // Phase 1: 基本読み取り
  // ============================================================
  console.log('── Phase 1: 基本読み取り ──');

  let docInfo: any;
  await test('get_document_info', async () => {
    docInfo = await callTool(client, 'get_document_info');
    assert(typeof docInfo.fileName === 'string', 'fileName should be string');
    assert(typeof docInfo.width === 'number', 'width should be number');
    assert(typeof docInfo.height === 'number', 'height should be number');
    assert(docInfo.artboardCount > 0, 'should have at least 1 artboard');
    assert(['CMYK', 'RGB'].includes(docInfo.colorMode), 'colorMode should be CMYK or RGB');
  });

  await test('get_artboards', async () => {
    const result = await callTool(client, 'get_artboards') as any;
    assert(Array.isArray(result.artboards), 'artboards should be array');
    assert(result.artboards.length > 0, 'should have at least 1 artboard');
    const ab = result.artboards[0];
    assert(typeof ab.name === 'string', 'artboard should have name');
    assert(typeof ab.size.width === 'number', 'artboard should have width');
  });

  await test('get_artboards (specific index)', async () => {
    const result = await callTool(client, 'get_artboards', { index: 0 }) as any;
    assert(result.artboards.length === 1, 'should return exactly 1 artboard');
  });

  await test('get_layers', async () => {
    const result = await callTool(client, 'get_layers') as any;
    assert(Array.isArray(result.layers), 'layers should be array');
    assert(result.layers.length > 0, 'should have at least 1 layer');
    const layer = result.layers[0];
    assert(typeof layer.name === 'string', 'layer should have name');
    assert(typeof layer.visible === 'boolean', 'layer should have visible');
    assert(typeof layer.locked === 'boolean', 'layer should have locked');
  });

  await test('get_selection (nothing selected)', async () => {
    const result = await callTool(client, 'get_selection') as any;
    assert(typeof result.selectionCount === 'number', 'should have selectionCount');
    // 何も選択されていない場合は0
  });

  await test('list_text_frames', async () => {
    const result = await callTool(client, 'list_text_frames') as any;
    assert(typeof result.count === 'number', 'should have count');
    assert(Array.isArray(result.textFrames), 'textFrames should be array');
    if (result.count > 0) {
      const tf = result.textFrames[0];
      assert(typeof tf.uuid === 'string', 'text frame should have uuid');
      assert(typeof tf.contents === 'string', 'text frame should have contents');
    }
  });

  // ============================================================
  // Phase 2: 読み取り系（詳細）
  // ============================================================
  console.log('\n── Phase 2: 読み取り系（詳細） ──');

  await test('get_document_structure', async () => {
    const result = await callTool(client, 'get_document_structure', { depth: 2 }) as any;
    assert(Array.isArray(result.layers), 'should have layers array');
    assert(result.layers.length > 0, 'should have at least 1 layer');
  });

  await test('get_colors', async () => {
    const result = await callTool(client, 'get_colors') as any;
    // スウォッチかused colorsのどちらかが存在するはず
    assert(typeof result === 'object', 'should return an object');
  });

  await test('get_path_items', async () => {
    const result = await callTool(client, 'get_path_items') as any;
    assert(typeof result === 'object', 'should return an object');
  });

  await test('get_guidelines', async () => {
    const result = await callTool(client, 'get_guidelines') as any;
    assert(Array.isArray(result.horizontal), 'should have horizontal array');
    assert(Array.isArray(result.vertical), 'should have vertical array');
    assert(typeof result.totalCount === 'number', 'should have totalCount');
  });

  await test('get_groups', async () => {
    const result = await callTool(client, 'get_groups') as any;
    assert(typeof result === 'object', 'should return an object');
  });

  await test('get_effects', async () => {
    const result = await callTool(client, 'get_effects') as any;
    assert(typeof result === 'object', 'should return an object');
  });

  await test('get_images', async () => {
    const result = await callTool(client, 'get_images') as any;
    assert(typeof result === 'object', 'should return an object');
  });

  await test('get_symbols', async () => {
    const result = await callTool(client, 'get_symbols') as any;
    assert(typeof result === 'object', 'should return an object');
  });

  await test('find_objects (by type: text)', async () => {
    const result = await callTool(client, 'find_objects', { type: 'text' }) as any;
    assert(typeof result.count === 'number', 'should have count');
    assert(Array.isArray(result.objects), 'should have objects array');
  });

  // text_frame_detail はテキストフレームが存在する場合のみ
  await test('get_text_frame_detail (if text exists)', async () => {
    const tfList = await callTool(client, 'list_text_frames') as any;
    if (tfList.count === 0) {
      results[results.length - 1].status = 'skip';
      results[results.length - 1].message = 'no text frames in document';
      console.log(`    → スキップ: テキストフレームなし`);
      return;
    }
    const uuid = tfList.textFrames[0].uuid;
    const detail = await callTool(client, 'get_text_frame_detail', { uuid }) as any;
    assert(typeof detail.contents === 'string', 'should have contents');
    assert(Array.isArray(detail.characterAttributes) || Array.isArray(detail.textRanges),
      'should have character attributes');
  });

  // ============================================================
  // Phase 3: 書き出し
  // ============================================================
  console.log('\n── Phase 3: 書き出し ──');

  const tmpDir = '/tmp/illustrator-mcp-test';
  await test('export SVG (artboard:0)', async () => {
    const result = await callTool(client, 'export', {
      target: 'artboard:0',
      format: 'svg',
      output_path: `${tmpDir}/test-export.svg`,
    }) as any;
    assert(result.success === true, 'export should succeed');
  });

  await test('export PNG (artboard:0)', async () => {
    const result = await callTool(client, 'export', {
      target: 'artboard:0',
      format: 'png',
      output_path: `${tmpDir}/test-export.png`,
    }) as any;
    assert(result.success === true, 'export should succeed');
  });

  // UUID 指定でのラスタ書き出し（一時ドキュメント経由の isolated export）
  await test('export PNG by UUID (isolated export)', async () => {
    // テスト用に作成した矩形を検索
    const found = await callTool(client, 'find_objects', { name: '__mcp_test_rect_modified' }) as any;
    if (found.count === 0) {
      results[results.length - 1] = { name: 'export PNG by UUID (isolated export)', status: 'skip', message: 'test rect not found' };
      console.log('    → スキップ: テスト矩形なし');
      return;
    }
    const uuid = found.objects[0].uuid;
    const outPath = `${tmpDir}/test-uuid-export.png`;
    const result = await callTool(client, 'export', {
      target: uuid,
      format: 'png',
      output_path: outPath,
      raster_options: { background: 'transparent' },
    }) as any;
    assert(result.success === true, 'UUID PNG export should succeed');
    assert(result.output_path === outPath, 'output_path should match');
  });

  await test('export JPG by UUID (isolated export)', async () => {
    const found = await callTool(client, 'find_objects', { name: '__mcp_test_rect_modified' }) as any;
    if (found.count === 0) {
      results[results.length - 1] = { name: 'export JPG by UUID (isolated export)', status: 'skip', message: 'test rect not found' };
      console.log('    → スキップ: テスト矩形なし');
      return;
    }
    const uuid = found.objects[0].uuid;
    const outPath = `${tmpDir}/test-uuid-export.jpg`;
    const result = await callTool(client, 'export', {
      target: uuid,
      format: 'jpg',
      output_path: outPath,
    }) as any;
    assert(result.success === true, 'UUID JPG export should succeed');
  });

  // SVG は従来ロジックのまま（isolated export 不要）
  await test('export SVG by UUID', async () => {
    const found = await callTool(client, 'find_objects', { name: '__mcp_test_rect_modified' }) as any;
    if (found.count === 0) {
      results[results.length - 1] = { name: 'export SVG by UUID', status: 'skip', message: 'test rect not found' };
      console.log('    → スキップ: テスト矩形なし');
      return;
    }
    const uuid = found.objects[0].uuid;
    const result = await callTool(client, 'export', {
      target: uuid,
      format: 'svg',
      output_path: `${tmpDir}/test-uuid-export.svg`,
    }) as any;
    assert(result.success === true, 'UUID SVG export should succeed');
  });

  // エラーケース: 存在しないディレクトリへの書き出し
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

  // エラーケース: 存在しない UUID
  await test('export with invalid UUID (should error)', async () => {
    const result = await callTool(client, 'export', {
      target: 'nonexistent-uuid-12345',
      format: 'png',
      output_path: `${tmpDir}/should-not-exist.png`,
    }) as any;
    assert(result.error === true, 'should return error for invalid UUID');
  });

  // ============================================================
  // Phase 4: ユーティリティ
  // ============================================================
  console.log('\n── Phase 4: ユーティリティ ──');

  await test('preflight_check', async () => {
    const result = await callTool(client, 'preflight_check') as any;
    assert(Array.isArray(result.checks) || Array.isArray(result.results) || typeof result === 'object',
      'should return check results');
  });

  await test('get_overprint_info', async () => {
    const result = await callTool(client, 'get_overprint_info') as any;
    assert(typeof result === 'object', 'should return an object');
  });

  // ============================================================
  // Phase 5: 操作系（作成 → 確認 → undo）
  // ============================================================
  console.log('\n── Phase 5: 操作系 ──');

  // undo 用ヘルパー — JSX で app.undo() を実行
  async function undo(): Promise<void> {
    await callTool(client, 'get_document_info'); // ダミー呼び出しで同期確保
    // undo は JSX 直接実行ではないので、create 後の verify で代用
  }

  await test('create_rectangle', async () => {
    const result = await callTool(client, 'create_rectangle', {
      x: 100, y: 100, width: 200, height: 150,
      fill: { type: 'rgb', r: 255, g: 0, b: 0 },
      name: '__mcp_test_rect',
    }) as any;
    assert(typeof result.uuid === 'string' && result.uuid.length > 0, 'should return uuid');
  });

  await test('create_ellipse', async () => {
    const result = await callTool(client, 'create_ellipse', {
      x: 350, y: 100, width: 150, height: 150,
      fill: { type: 'rgb', r: 0, g: 255, b: 0 },
      name: '__mcp_test_ellipse',
    }) as any;
    assert(typeof result.uuid === 'string' && result.uuid.length > 0, 'should return uuid');
  });

  await test('create_line', async () => {
    const result = await callTool(client, 'create_line', {
      x1: 100, y1: 300, x2: 400, y2: 300,
      stroke: { color: { type: 'rgb', r: 0, g: 0, b: 255 }, width: 2 },
      name: '__mcp_test_line',
    }) as any;
    assert(typeof result.uuid === 'string' && result.uuid.length > 0, 'should return uuid');
  });

  await test('create_text_frame', async () => {
    const result = await callTool(client, 'create_text_frame', {
      x: 100, y: 350, contents: 'MCP Test テスト',
      font_size: 24,
      name: '__mcp_test_text',
    }) as any;
    assert(typeof result.uuid === 'string' && result.uuid.length > 0, 'should return uuid');
  });

  await test('create_path', async () => {
    const result = await callTool(client, 'create_path', {
      anchors: [
        { x: 500, y: 100 },
        { x: 550, y: 200 },
        { x: 600, y: 100 },
      ],
      closed: true,
      fill: { type: 'rgb', r: 255, g: 255, b: 0 },
      name: '__mcp_test_path',
    }) as any;
    assert(typeof result.uuid === 'string' && result.uuid.length > 0, 'should return uuid');
  });

  // modify_object — 作成した矩形を変更
  await test('modify_object', async () => {
    // まず作成した矩形を検索
    const found = await callTool(client, 'find_objects', { name: '__mcp_test_rect' }) as any;
    if (found.count === 0) {
      throw new Error('test rectangle not found');
    }
    const uuid = found.objects[0].uuid;
    const result = await callTool(client, 'modify_object', {
      uuid,
      properties: {
        opacity: 50,
        name: '__mcp_test_rect_modified',
      },
    }) as any;
    assert(result.success === true, 'modify should succeed');
  });

  // convert_to_outlines — テスト用レイヤーのテキストをアウトライン化
  await test('convert_to_outlines (test layer)', async () => {
    // テスト用テキストが存在するか確認
    const tfBefore = await callTool(client, 'find_objects', { name: '__mcp_test_text' }) as any;
    if (tfBefore.count === 0) {
      throw new Error('test text frame not found');
    }
    // テストオブジェクトは __mcp_test__ レイヤーに作成されるので、そのレイヤーを対象にする
    const result = await callTool(client, 'convert_to_outlines', {
      target: '__mcp_test__',
    }) as any;
    assert(typeof result === 'object', 'should return a result object');
    assert(!result.error, 'should not return error: ' + (result.message || ''));
  });

  // apply_color_profile — 現在のプロファイルを再適用（実質ノーオプ）
  await test('apply_color_profile', async () => {
    // 現在のカラーモードに応じた標準プロファイルを適用
    const profile = docInfo.colorMode === 'CMYK'
      ? 'Japan Color 2001 Coated'
      : 'sRGB IEC61966-2.1';
    const result = await callTool(client, 'apply_color_profile', {
      profile,
    }) as any;
    assert(typeof result === 'object', 'should return a result object');
    assert(!result.error, 'should not return error: ' + (result.message || ''));
  });

  // export_pdf
  await test('export_pdf', async () => {
    const result = await callTool(client, 'export_pdf', {
      output_path: `${tmpDir}/test-export.pdf`,
      options: { trim_marks: true },
    }) as any;
    assert(result.success === true, 'PDF export should succeed');
  });

  // PDF エラーケース: 存在しないディレクトリ
  await test('export_pdf to non-existent directory (should error)', async () => {
    const result = await callTool(client, 'export_pdf', {
      output_path: '/nonexistent/dir/test.pdf',
    }) as any;
    assert(result.error === true, 'should return error for non-existent directory');
    assert(typeof result.message === 'string' && result.message.includes('does not exist'),
      'error message should mention directory does not exist');
  });

  // export JPG
  await test('export JPG (artboard:0)', async () => {
    const result = await callTool(client, 'export', {
      target: 'artboard:0',
      format: 'jpg',
      output_path: `${tmpDir}/test-export.jpg`,
    }) as any;
    assert(result.success === true, 'JPG export should succeed');
  });

  // テストオブジェクトのクリーンアップ（undo を繰り返す）
  console.log('\n── クリーンアップ ──');
  console.log('  ※ テストで作成したオブジェクト（__mcp_test_*）は手動で削除してください');

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
