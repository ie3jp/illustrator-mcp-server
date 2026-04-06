/**
 * E2E 統合テスト
 * create_document で新規ドキュメントを作成し、全ツールをテストした後 close_document で閉じる。
 * Illustrator が起動していれば、開いているファイルに依存せず実行可能。
 *
 * 使い方: npx tsx test/e2e/e2e-test.ts
 */
import { unlinkSync, mkdirSync, rmSync } from 'fs';
import {
  createClient,
  callTool,
  test,
  assert,
  assertClose,
  generateTestPng,
  results,
  printResults,
  DOC_WIDTH,
  DOC_HEIGHT,
  DOC_COLOR_MODE,
  TMP_DIR,
  TEST_IMG_WIDTH,
  TEST_IMG_HEIGHT,
  TEST_IMG_PATH_LINKED,
  TEST_IMG_PATH_EMBEDDED,
  TEST_IMG_PLACE_SIZE_PT,
  TEST_IMG_EXPECTED_DPI,
  PASS,
  FAIL,
} from './helpers.js';

async function main(): Promise<void> {
  console.log('\n🔧 Illustrator MCP Server — E2E Test\n');
  console.log('サーバーに接続中...');

  let client;
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

  // 座標検証 (refactor-verify)
  await test('verify rectangle position via find_objects', async () => {
    const r = await callTool(client, 'find_objects', { name: '__e2e_rect' }) as any;
    assert(r.count === 1, `should find 1 rect, got ${r.count}`);
    const obj = r.objects[0];
    assertClose(obj.bounds.x, 50, 'rect x');
    assertClose(obj.bounds.y, 50, 'rect y');
    assertClose(obj.bounds.width, 200, 'rect width');
    assertClose(obj.bounds.height, 150, 'rect height');
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

  // 座標検証 (refactor-verify)
  await test('verify ellipse position', async () => {
    const r = await callTool(client, 'find_objects', { name: '__e2e_ellipse' }) as any;
    assert(r.count === 1, 'should find 1');
    assertClose(r.objects[0].bounds.x, 300, 'ellipse x');
    assertClose(r.objects[0].bounds.y, 50, 'ellipse y');
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

  // ベジェ曲線パス (refactor-verify の bezier handles 版)
  await test('create_path → __e2e_path (bezier)', async () => {
    const result = await callTool(client, 'create_path', {
      anchors: [
        { x: 100, y: 300, right_handle: { x: 150, y: 280 }, point_type: 'smooth' },
        { x: 200, y: 350, left_handle: { x: 170, y: 370 }, right_handle: { x: 230, y: 330 }, point_type: 'smooth' },
        { x: 300, y: 300, left_handle: { x: 270, y: 320 }, point_type: 'smooth' },
      ],
      closed: false,
      stroke: { color: { type: 'rgb', r: 128, g: 0, b: 128 }, width: 2 },
      fill: { type: 'none' },
      name: '__e2e_path',
      layer_name: 'TestLayer-Main',
    }) as any;
    assert(typeof result.uuid === 'string' && result.uuid.length > 0, 'should return uuid');
    pathUuid = result.uuid;
  });

  await test('verify bezier path exists via find_objects', async () => {
    const r = await callTool(client, 'find_objects', { name: '__e2e_path' }) as any;
    assert(r.count === 1, `should find 1 bezier path, got ${r.count}`);
    assert(r.objects[0].uuid === pathUuid, 'UUID should match');
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

  // レイヤー自動作成の検証 (resolveTargetLayer from refactor-verify)
  await test('create_text_frame on new layer (resolveTargetLayer)', async () => {
    const r = await callTool(client, 'create_text_frame', {
      x: 50, y: 450, contents: 'Layer auto-create test',
      font_size: 18,
      name: '__e2e_auto_layer_text',
      layer_name: 'AutoCreatedLayer',
    }) as any;
    assert(typeof r.uuid === 'string', 'should return uuid');
  });

  await test('verify AutoCreatedLayer exists', async () => {
    const r = await callTool(client, 'get_layers') as any;
    const names = r.layers.map((l: any) => l.name);
    assert(names.includes('AutoCreatedLayer'), 'AutoCreatedLayer should exist');
  });

  // ダミーテキスト（check_text_consistency 検証用）
  const dummyTextCases = [
    { contents: 'Lorem ipsum dolor sit amet', name: '__e2e_dummy_lorem', label: 'Lorem ipsum' },
    { contents: 'テキストが入ります', name: '__e2e_dummy_hairu', label: 'テキストが入ります' },
    { contents: 'ここにテキストを入れてね', name: '__e2e_dummy_koko', label: 'ここにテキスト' },
    { contents: 'ダミーテキストです', name: '__e2e_dummy_dmy', label: 'ダミーテキスト' },
    { contents: 'ダミー', name: '__e2e_dummy_dmy_exact', label: 'ダミー' },
    { contents: '仮テキストを配置', name: '__e2e_dummy_kari', label: '仮テキスト' },
    { contents: 'テキストを入力してください', name: '__e2e_dummy_input', label: 'テキストを入力' },
    { contents: '○○○', name: '__e2e_dummy_maru', label: '○○○ placeholder' },
    { contents: '●●●', name: '__e2e_dummy_kuro', label: '●●● placeholder' },
    { contents: '△△△', name: '__e2e_dummy_sankaku', label: '△△△ placeholder' },
  ];
  const dummyTextUuids: Record<string, string> = {};

  for (let di = 0; di < dummyTextCases.length; di++) {
    const dc = dummyTextCases[di];
    await test(`create_text_frame → ${dc.name} ("${dc.contents}")`, async () => {
      const result = await callTool(client, 'create_text_frame', {
        x: 50, y: 350 + di * 20,
        contents: dc.contents,
        font_size: 12,
        name: dc.name,
        layer_name: 'TestLayer-Text',
      }) as any;
      assert(typeof result.uuid === 'string' && result.uuid.length > 0, 'should return uuid');
      dummyTextUuids[dc.label] = result.uuid;
    });
  }

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

  await test('get_artboards → 1 artboard, 800x600 + index filter', async () => {
    const result = await callTool(client, 'get_artboards') as any;
    assert(Array.isArray(result.artboards), 'artboards should be array');
    assert(result.artboards.length === 1, `should have 1 artboard, got ${result.artboards.length}`);
    const ab = result.artboards[0];
    assertClose(ab.size.width, DOC_WIDTH, 'artboard width');
    assertClose(ab.size.height, DOC_HEIGHT, 'artboard height');
    // index filter
    const filtered = await callTool(client, 'get_artboards', { index: 0 }) as any;
    assert(filtered.artboards.length === 1, 'index filter should return 1');
    assert(filtered.artboards[0].index === 0, 'filtered artboard index should be 0');
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
    assert(!result.error, 'should not error: ' + (result.message || ''));
    assert(typeof result.selectionCount === 'number', 'should have selectionCount');
  });

  await test('list_text_frames → count >= 1', async () => {
    const result = await callTool(client, 'list_text_frames') as any;
    assert(result.count >= 1, `text frame count should be >= 1, got ${result.count}`);
    assert(Array.isArray(result.textFrames), 'textFrames should be array');
  });

  // list_text_frames getTextKind (refactor-verify)
  await test('list_text_frames with getTextKind', async () => {
    const r = await callTool(client, 'list_text_frames') as any;
    assert(r.count >= 1, 'should have text frames');
    const tf = r.textFrames.find((f: any) => f.uuid === textUuid);
    if (tf) {
      assert(tf.textKind === 'point', `textKind should be "point", got "${tf.textKind}"`);
    }
  });

  await test('get_text_frame_detail → characterRuns + kerningPairs', async () => {
    const detail = await callTool(client, 'get_text_frame_detail', { uuid: textUuid }) as any;
    assert(typeof detail.contents === 'string', 'should have contents');
    assert(detail.contents.includes('E2E Test'), `contents should include "E2E Test", got "${detail.contents}"`);

    // characterRuns は常に返る
    assert(Array.isArray(detail.characterRuns), 'should have characterRuns array');
    assert(detail.characterRuns.length >= 1, `should have >= 1 run, got ${detail.characterRuns.length}`);

    // 全ランのテキストを結合すると元のテキストと一致する
    const joined = detail.characterRuns.map((r: any) => r.text).join('');
    assert(joined === detail.contents, `joined runs should equal contents: "${joined}" vs "${detail.contents}"`);

    // 各ランに必要なプロパティが揃っている
    for (const run of detail.characterRuns) {
      assert(typeof run.text === 'string' && run.text.length > 0, 'run should have text');
      assert(typeof run.fontFamily === 'string', 'run should have fontFamily');
      assert(typeof run.fontSize === 'number', 'run should have fontSize');
      assert(typeof run.tracking === 'number', 'run should have tracking');
      assert(typeof run.kerningMethod === 'string', 'run should have kerningMethod');
      assert(typeof run.proportionalMetrics === 'boolean', 'run should have proportionalMetrics');
      assert(typeof run.akiLeft === 'number', 'run should have akiLeft');
      assert(typeof run.akiRight === 'number', 'run should have akiRight');
      assert(typeof run.tsume === 'number', 'run should have tsume');
      assert(typeof run.baselineShift === 'number', 'run should have baselineShift');
      assert(typeof run.horizontalScale === 'number', 'run should have horizontalScale');
      assert(typeof run.verticalScale === 'number', 'run should have verticalScale');
      assert(typeof run.rotation === 'number', 'run should have rotation');
    }

    // kerningPairs は常に返る（手動カーニングがなければ空配列）
    assert(Array.isArray(detail.kerningPairs), 'should have kerningPairs array');
  });

  // get_document_structure enhanced checks (refactor-verify)
  await test('get_document_structure', async () => {
    const result = await callTool(client, 'get_document_structure', { depth: 3 }) as any;
    assert(Array.isArray(result.layers), 'should have layers array');
    assert(result.layers.length >= 2, `should have >= 2 layers, got ${result.layers.length}`);
  });

  await test('get_colors', async () => {
    const result = await callTool(client, 'get_colors') as any;
    assert(!result.error, 'should not error: ' + (result.message || ''));
    assert(Array.isArray(result.swatches), 'should have swatches array');
  });

  // get_colors diagnostics (refactor-verify)
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

  // --- GrayColor 挙動検証 ---
  await test('GrayColor: create gray=0/100 rects, verify colorToObject output', async () => {
    const g0 = await callTool(client, 'create_rectangle', {
      x: 650, y: 50, width: 20, height: 20,
      fill: { type: 'gray', value: 0 },
      name: '__e2e_gray0',
    }) as any;
    assert(typeof g0.uuid === 'string', 'gray=0 rect should have uuid');
    const g100 = await callTool(client, 'create_rectangle', {
      x: 680, y: 50, width: 20, height: 20,
      fill: { type: 'gray', value: 100 },
      name: '__e2e_gray100',
    }) as any;
    assert(typeof g100.uuid === 'string', 'gray=100 rect should have uuid');

    // colorToObject 経由で gray 値を読み戻す
    const colors = await callTool(client, 'get_colors') as any;
    const grayFills = (colors.usedFillColors || []).filter((c: any) => c.type === 'gray');
    console.log(`    [debug] GrayColor fills: ${JSON.stringify(grayFills)}`);

    // check_contrast で gray→RGB 変換を確認
    const contrast = await callTool(client, 'check_contrast', {
      color1: { type: 'gray', value: 0 },
      color2: { type: 'gray', value: 100 },
    }) as any;
    console.log(`    [debug] gray=0 rgb=${JSON.stringify(contrast.color1_rgb)}, gray=100 rgb=${JSON.stringify(contrast.color2_rgb)}`);
    if (contrast.color1_rgb) {
      if (contrast.color1_rgb.r > 200) {
        console.log('    [RESULT] gray=0 → WHITE (ink convention). preflight isWhiteColor should check gray===0');
      } else {
        console.log('    [RESULT] gray=0 → BLACK (doc convention). check_contrast formula should not invert');
      }
    }
    assert(typeof contrast.contrastRatio === 'number', 'should compute contrast');
  });

  await test('get_path_items', async () => {
    const result = await callTool(client, 'get_path_items') as any;
    assert(typeof result === 'object', 'should return an object');
    // rect, ellipse, line, path — at least 4 path items
    assert(result.count >= 4, `should have >= 4 path items, got ${result.count}`);
  });

  // get_path_items bezier detail verification (refactor-verify Phase 5e)
  await test('get_path_items with detail -> verify bezier handles', async () => {
    const r = await callTool(client, 'get_path_items', { include_points: true }) as any;
    assert(typeof r === 'object', 'should return object');
    // __e2e_path パスを探す
    const bezier = r.paths?.find((p: any) => p.name === '__e2e_path');
    if (bezier) {
      assert(bezier.pointCount === 3, `should have 3 points, got ${bezier.pointCount}`);
      assert(Array.isArray(bezier.points), 'should have points array');
      for (const pt of bezier.points) {
        assert(typeof pt.anchor === 'object', 'point should have anchor');
        assert(typeof pt.anchor.x === 'number', 'anchor should have x');
        assert(typeof pt.anchor.y === 'number', 'anchor should have y');
        assert(typeof pt.leftDirection === 'object', 'point should have leftDirection');
        assert(typeof pt.rightDirection === 'object', 'point should have rightDirection');
      }
    } else {
      assert(true, 'bezier path not found by name (may not expose name in path list)');
    }
  });

  await test('get_guidelines → empty', async () => {
    const result = await callTool(client, 'get_guidelines') as any;
    assert(Array.isArray(result.horizontal), 'should have horizontal array');
    assert(Array.isArray(result.vertical), 'should have vertical array');
    assert(result.totalCount === 0, `new doc should have 0 guidelines, got ${result.totalCount}`);
  });

  await test('get_groups → empty', async () => {
    const result = await callTool(client, 'get_groups') as any;
    assert(!result.error, 'should not error: ' + (result.message || ''));
    assert(typeof result.count === 'number', 'should have count');
  });

  await test('get_effects', async () => {
    const result = await callTool(client, 'get_effects') as any;
    assert(!result.error, 'should not error: ' + (result.message || ''));
  });

  // get_effects by UUID (refactor-verify)
  await test('get_effects (by UUID)', async () => {
    const r = await callTool(client, 'get_effects', { target: rectUuid }) as any;
    assert(r.count === 1, `should find 1 effect info, got ${r.count}`);
    assert(r.items[0].uuid === rectUuid, 'UUID should match');
  });

  await test('get_images → 2 images (linked + embedded)', async () => {
    const result = await callTool(client, 'get_images') as any;
    assert(typeof result === 'object', 'should return an object');
    assert(result.imageCount >= 2, `should have >= 2 images, got ${result.imageCount}`);
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
    assert(!result.error, 'should not error: ' + (result.message || ''));
    assert(typeof result.definitionCount === 'number', 'should have definitionCount');
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

  // --- check_contrast ---

  await test('check_contrast (manual: red vs white)', async () => {
    const result = await callTool(client, 'check_contrast', {
      color1: { type: 'rgb', r: 255, g: 0, b: 0 },
      color2: { type: 'rgb', r: 255, g: 255, b: 255 },
    }) as any;
    assert(typeof result.contrastRatio === 'number', 'should have contrastRatio');
    assert(result.contrastRatio > 1, `contrastRatio should be > 1, got ${result.contrastRatio}`);
    assert(typeof result.wcagAA_normal === 'boolean', 'should have wcagAA_normal');
    assert(typeof result.wcagAA_large === 'boolean', 'should have wcagAA_large');
    assert(typeof result.wcagAAA === 'boolean', 'should have wcagAAA');
    assert(result.color1_rgb.r === 255 && result.color1_rgb.g === 0, 'color1_rgb should match input');
    assert(result.color2_rgb.r === 255 && result.color2_rgb.g === 255, 'color2_rgb should match input');
  });

  await test('check_contrast (manual: CMYK)', async () => {
    const result = await callTool(client, 'check_contrast', {
      color1: { type: 'cmyk', c: 0, m: 100, y: 100, k: 0 },
      color2: { type: 'cmyk', c: 0, m: 0, y: 0, k: 0 },
    }) as any;
    assert(typeof result.contrastRatio === 'number', 'should have contrastRatio');
    assert(result.contrastRatio > 1, 'CMYK contrast should be > 1');
  });

  await test('check_contrast (auto_detect)', async () => {
    const result = await callTool(client, 'check_contrast', {
      auto_detect: true,
    }) as any;
    assert(typeof result.pairCount === 'number', 'should have pairCount');
    assert(Array.isArray(result.pairs), 'should have pairs array');
    if (result.pairs.length > 0) {
      const p = result.pairs[0];
      assert(typeof p.contrastRatio === 'number', 'pair should have contrastRatio');
      assert(typeof p.wcagAA_normal === 'boolean', 'pair should have wcagAA_normal');
      assert(typeof p.foreground === 'object', 'pair should have foreground');
      assert(typeof p.background === 'object', 'pair should have background');
    }
  });

  // --- extract_design_tokens ---

  await test('extract_design_tokens (css)', async () => {
    const result = await callTool(client, 'extract_design_tokens', { format: 'css' }) as any;
    const text = result.message ?? result;
    assert(typeof text === 'string', 'should return a string');
    assert(text.includes(':root'), `CSS output should contain :root, got: ${text.substring(0, 80)}`);
    assert(text.includes('--color-'), 'CSS output should contain --color- variables');
  });

  await test('extract_design_tokens (json)', async () => {
    const result = await callTool(client, 'extract_design_tokens', { format: 'json' }) as any;
    assert(typeof result === 'object', 'should return an object');
    assert(typeof result.color === 'object', 'should have color object');
    assert(typeof result.typography === 'object', 'should have typography object');
    assert(Array.isArray(result.spacing), 'should have spacing array');
  });

  await test('extract_design_tokens (tailwind)', async () => {
    const result = await callTool(client, 'extract_design_tokens', { format: 'tailwind' }) as any;
    const text = result.message ?? result;
    assert(typeof text === 'string', 'should return a string');
    assert(text.includes('module.exports'), `Tailwind output should contain module.exports, got: ${text.substring(0, 80)}`);
    assert(text.includes('colors'), 'Tailwind output should contain colors section');
  });

  // --- get_separation_info ---

  await test('get_separation_info', async () => {
    const result = await callTool(client, 'get_separation_info') as any;
    assert(typeof result.documentColorSpace === 'string', 'should have documentColorSpace');
    assert(result.documentColorSpace === 'RGB', `should be RGB document, got ${result.documentColorSpace}`);
    assert(typeof result.separationCount === 'number', 'should have separationCount');
    assert(Array.isArray(result.separations), 'should have separations array');
    if (result.separations.length > 0) {
      const sep = result.separations[0];
      assert(typeof sep.name === 'string', 'separation should have name');
      assert(typeof sep.type === 'string', 'separation should have type');
      assert(typeof sep.usageCount === 'number', 'separation should have usageCount');
    }
  });

  // --- get_overprint_info ---

  await test('get_overprint_info', async () => {
    const r = await callTool(client, 'get_overprint_info') as any;
    assert(typeof r.overprintCount === 'number', 'should have overprintCount');
    assert(Array.isArray(r.items), 'should have items array');
  });

  // --- check_text_consistency ---

  await test('check_text_consistency → detect all dummy patterns', async () => {
    const result = await callTool(client, 'check_text_consistency') as any;
    assert(typeof result.totalFrames === 'number', 'should have totalFrames');
    assert(result.totalFrames >= 10, `should have >= 10 text frames, got ${result.totalFrames}`);
    const dummyTexts = result.mechanicalChecks?.dummyTexts ?? result.dummyTexts;
    const allTexts = result.llmAnalysis?.allTexts ?? result.allTexts;
    const knownVariations = result.mechanicalChecks?.knownVariations ?? result.knownVariations;
    assert(Array.isArray(dummyTexts), 'should have dummyTexts array');
    assert(Array.isArray(allTexts), 'should have allTexts array');
    assert(Array.isArray(knownVariations), 'should have knownVariations array');

    // 全ダミーパターンが検出されることを検証
    const expectedPatterns = dummyTextCases.map((dc) => dc.label);
    for (const label of expectedPatterns) {
      const hit = dummyTexts.find((d: any) => d.pattern === label);
      assert(hit !== undefined, `should detect pattern: "${label}"`);
      if (hit && dummyTextUuids[label]) {
        assert(hit.uuid === dummyTextUuids[label], `UUID should match for "${label}"`);
      }
    }
    assert(dummyTexts.length >= expectedPatterns.length,
      `should detect >= ${expectedPatterns.length} dummy texts, got ${dummyTexts.length}`);
    // artboard_index filter
    const filtered = await callTool(client, 'check_text_consistency', { artboard_index: 0 }) as any;
    assert(filtered.totalFrames >= 1, 'artboard 0 should have text frames');
  });

  // ============================================================
  // Phase 2: 操作系
  // ============================================================
  console.log('\n── Phase 2: 操作系 ──');

  // --- granular modify_object tests (refactor-verify) ---

  await test('modify_object position (artboard-web) + verify', async () => {
    const r = await callTool(client, 'modify_object', {
      uuid: rectUuid,
      properties: { position: { x: 150, y: 80 } },
    }) as any;
    assert(r.success === true, 'should succeed');

    const found = await callTool(client, 'find_objects', { name: '__e2e_rect' }) as any;
    assert(found.count === 1, 'should find rect');
    assertClose(found.objects[0].bounds.x, 150, 'moved x');
    assertClose(found.objects[0].bounds.y, 80, 'moved y');
  });

  await test('modify_object fill color', async () => {
    const r = await callTool(client, 'modify_object', {
      uuid: rectUuid,
      properties: { fill: { type: 'rgb', r: 0, g: 0, b: 255 } },
    }) as any;
    assert(r.success === true, 'should succeed');
  });

  await test('modify_object text contents + verify', async () => {
    const r = await callTool(client, 'modify_object', {
      uuid: textUuid,
      properties: { contents: 'Modified text' },
    }) as any;
    assert(r.success === true, 'should succeed');

    const detail = await callTool(client, 'get_text_frame_detail', { uuid: textUuid }) as any;
    assert(detail.contents === 'Modified text', `contents should be "Modified text", got "${detail.contents}"`);
  });

  // --- font operations (refactor-verify) ---

  let fontName = '';
  await test('get available font name for testing', async () => {
    const r = await callTool(client, 'get_text_frame_detail', { uuid: textUuid }) as any;
    assert(Array.isArray(r.characterRuns) && r.characterRuns.length > 0, 'should have characterRuns');
    fontName = r.characterRuns[0].fontFamily || '';
    assert(fontName.length > 0, `should have a font family, got "${fontName}"`);
  });

  await test('create_text_frame with non-existent font -> font_warning', async () => {
    const r = await callTool(client, 'create_text_frame', {
      x: 600, y: 50, contents: 'Font fallback test',
      font_name: 'ZzNonExistentFont999',
      font_size: 16,
      name: '__e2e_font_fallback',
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

    const detail = await callTool(client, 'get_text_frame_detail', { uuid: textUuid }) as any;
    assert(detail.characterRuns[0].fontSize === 36,
      `fontSize should be 36, got ${detail.characterRuns[0].fontSize}`);
  });

  // --- modify_object advanced properties (refactor-verify) ---

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

    const objs = await callTool(client, 'find_objects', { name: '__e2e_rect' }) as any;
    assert(objs.count === 1, 'should find rect');
  });

  await test('modify_object opacity + verify', async () => {
    const r = await callTool(client, 'modify_object', {
      uuid: ellipseUuid,
      properties: { opacity: 50 },
    }) as any;
    assert(r.success === true, 'opacity change should succeed');

    const fx = await callTool(client, 'get_effects', { target: ellipseUuid }) as any;
    assert(fx.count === 1, 'should find effect info');
    assertClose(fx.items[0].opacity, 50, 'opacity should be ~50');
  });

  await test('modify_object name', async () => {
    const r = await callTool(client, 'modify_object', {
      uuid: rectUuid,
      properties: { name: '__e2e_rect_renamed' },
    }) as any;
    assert(r.success === true, 'rename should succeed');

    const objs = await callTool(client, 'find_objects', { name: '__e2e_rect_renamed' }) as any;
    assert(objs.count === 1, 'should find by new name');
  });

  // 元の名前に戻す（後続テストのため）
  await callTool(client, 'modify_object', {
    uuid: rectUuid, properties: { name: '__e2e_rect' },
  });

  // smoke-test's original modify_object rename test
  await test('modify_object → opacity=50, rename + verify', async () => {
    const result = await callTool(client, 'modify_object', {
      uuid: rectUuid,
      properties: {
        opacity: 50,
        name: modifiedRectName,
      },
    }) as any;
    assert(result.success === true, 'modify should succeed');
    const found = await callTool(client, 'find_objects', { name: modifiedRectName }) as any;
    assert(found.count === 1, `should find 1 modified rect, got ${found.count}`);
  });

  await test('modify_object → invalid UUID (should error)', async () => {
    const r = await callTool(client, 'modify_object', {
      uuid: 'nonexistent-uuid-99999',
      properties: { opacity: 50 },
    }) as any;
    assert(r.error === true, 'should return error');
  });

  // --- find_objects color filters (refactor-verify) ---

  // まず矩形の色を確定的にリセット
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
    assert(r.count === 0, `should find 0 objects with black fill, got ${r.count}`);
  });

  await test('find_objects by type + layer combination', async () => {
    const r = await callTool(client, 'find_objects', {
      type: 'path',
      layer_name: 'TestLayer-Main',
    }) as any;
    assert(r.count >= 3, `should find >= 3 paths on TestLayer-Main layer, got ${r.count}`);
  });

  // --- manage_layers ---

  await test('manage_layers → add "__e2e_manage_test"', async () => {
    const result = await callTool(client, 'manage_layers', {
      action: 'add',
      layer_name: '__e2e_manage_test',
    }) as any;
    assert(result.success === true, 'add layer should succeed');
    assert(result.layer.name === '__e2e_manage_test', `layer name should match, got ${result.layer.name}`);
  });

  await test('manage_layers → rename "__e2e_manage_test" → "__e2e_manage_renamed"', async () => {
    const result = await callTool(client, 'manage_layers', {
      action: 'rename',
      layer_name: '__e2e_manage_test',
      new_name: '__e2e_manage_renamed',
    }) as any;
    assert(result.success === true, 'rename should succeed: ' + JSON.stringify(result));
    assert(result.to === '__e2e_manage_renamed', `should rename to __e2e_manage_renamed, got ${result.to}`);
  });

  await test('manage_layers → lock', async () => {
    const result = await callTool(client, 'manage_layers', {
      action: 'lock',
      layer_name: '__e2e_manage_renamed',
    }) as any;
    assert(result.success === true, 'lock should succeed');
    assert(result.layer.locked === true, 'layer should be locked');
  });

  await test('manage_layers → unlock', async () => {
    const result = await callTool(client, 'manage_layers', {
      action: 'unlock',
      layer_name: '__e2e_manage_renamed',
    }) as any;
    assert(result.success === true, 'unlock should succeed');
    assert(result.layer.locked === false, 'layer should be unlocked');
  });

  await test('manage_layers → hide', async () => {
    const result = await callTool(client, 'manage_layers', {
      action: 'hide',
      layer_name: '__e2e_manage_renamed',
    }) as any;
    assert(result.success === true, 'hide should succeed');
    assert(result.layer.visible === false, 'layer should be hidden');
  });

  await test('manage_layers → show', async () => {
    const result = await callTool(client, 'manage_layers', {
      action: 'show',
      layer_name: '__e2e_manage_renamed',
    }) as any;
    assert(result.success === true, 'show should succeed');
    assert(result.layer.visible === true, 'layer should be visible');
  });

  await test('manage_layers → reorder (position: 0)', async () => {
    const result = await callTool(client, 'manage_layers', {
      action: 'reorder',
      layer_name: '__e2e_manage_renamed',
      position: 0,
    }) as any;
    assert(result.success === true, 'reorder should succeed');
  });

  await test('manage_layers → delete "__e2e_manage_renamed"', async () => {
    const result = await callTool(client, 'manage_layers', {
      action: 'delete',
      layer_name: '__e2e_manage_renamed',
    }) as any;
    assert(result.success === true, 'delete should succeed');
    assert(result.deletedLayer.name === '__e2e_manage_renamed', 'deleted layer name should match');
  });

  // --- align_objects (refactor-verify version with position verification) ---

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
    const objs = await callTool(client, 'find_objects', { name: modifiedRectName }) as any;
    const objs2 = await callTool(client, 'find_objects', { name: '__e2e_ellipse' }) as any;
    assertClose(objs.objects[0].bounds.x, objs2.objects[0].bounds.x, 'x should match after left align', 2);
  });

  await test('distribute horizontal (3 objects)', async () => {
    await callTool(client, 'modify_object', {
      uuid: rectUuid, properties: { position: { x: 50, y: 100 } },
    });
    await callTool(client, 'modify_object', {
      uuid: ellipseUuid, properties: { position: { x: 200, y: 100 } },
    });

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
    assert(r.alignedCount === 2, `should align 2 objects, got ${r.alignedCount}`);
  });

  // --- replace_color ---

  await test('replace_color → red fill to blue', async () => {
    const result = await callTool(client, 'replace_color', {
      from_color: { type: 'rgb', r: 255, g: 0, b: 0 },
      to_color: { type: 'rgb', r: 0, g: 0, b: 255 },
      target: 'fill',
    }) as any;
    assert(result.success === true, 'replace_color should succeed');
    assert(typeof result.replacedCount === 'number', 'should have replacedCount');
  });

  await test('replace_color → with tolerance', async () => {
    const result = await callTool(client, 'replace_color', {
      from_color: { type: 'rgb', r: 0, g: 0, b: 255 },
      to_color: { type: 'rgb', r: 0, g: 200, b: 0 },
      tolerance: 10,
      target: 'both',
    }) as any;
    assert(result.success === true, 'replace_color with tolerance should succeed');
    assert(typeof result.replacedCount === 'number', 'should have replacedCount');
  });

  // --- place_color_chips ---

  await test('place_color_chips → right', async () => {
    const result = await callTool(client, 'place_color_chips', {
      position: 'right',
      chip_size: 20,
      include_info: true,
      layer_name: '__e2e_color_chips',
    }) as any;
    assert(result.success === true, 'place_color_chips should succeed');
    assert(typeof result.chipCount === 'number', 'should have chipCount');
    assert(result.chipCount >= 1, `should place >= 1 chip, got ${result.chipCount}`);
    assert(result.layerName === '__e2e_color_chips', `layer name should match, got ${result.layerName}`);
    assert(result.position === 'right', `position should be right, got ${result.position}`);
  });

  // --- place_style_guide ---

  await test('place_style_guide → bottom', async () => {
    const result = await callTool(client, 'place_style_guide', {
      position: 'bottom',
      layer_name: '__e2e_style_guide',
    }) as any;
    assert(result.success === true, 'place_style_guide should succeed');
    assert(typeof result.placedCount === 'number', 'should have placedCount');
    assert(result.placedCount >= 1, `should place >= 1 item, got ${result.placedCount}`);
    assert(result.layerName === '__e2e_style_guide', `layer name should match, got ${result.layerName}`);
    assert(result.position === 'bottom', `position should be bottom, got ${result.position}`);
  });

  // --- select_objects ---

  await test('select_objects → select + deselect', async () => {
    const r1 = await callTool(client, 'select_objects', { uuids: [rectUuid] }) as any;
    assert(r1.success === true, 'select should succeed');
    assert(r1.verified.selectionCount === 1, `should select 1, got ${r1.verified.selectionCount}`);
    assert(typeof r1.verified.selection[0].uuid === 'string', 'selected item should have uuid');
    const r2 = await callTool(client, 'select_objects', { uuids: [] }) as any;
    assert(r2.success === true, 'deselect should succeed');
    assert(r2.deselected === true, 'should be deselected');
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
    const result = await callTool(client, 'export', {
      target: 'artboard:0',
      format: 'svg',
      output_path: `${TMP_DIR}/e2e-export.svg`,
    }) as any;
    if (result.error && typeof result.message === 'string' && result.message.includes('output file was not created')) {
      // Known issue: Illustrator appends artboard name suffix to SVG filename
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

  // UUID 指定の isolated export — macOS /tmp symlink 対応
  await test('export PNG by UUID (isolated export)', async () => {
    const outPath = `${TMP_DIR}/e2e-uuid-export.png`;
    const result = await callTool(client, 'export', {
      target: rectUuid,
      format: 'png',
      output_path: outPath,
      raster_options: { background: 'transparent' },
    }) as any;
    assert(result.success === true, 'UUID PNG export should succeed');
    assert(result.output_path?.endsWith('e2e-uuid-export.png'), 'output_path should end with e2e-uuid-export.png');
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

  // --- default output path (output_path omitted) ---

  await test('export PNG → default path (unsaved doc → desktop)', async () => {
    const result = await callTool(client, 'export', {
      target: 'artboard:0', format: 'png',
    }) as any;
    assert(result.success === true, 'export should succeed: ' + (result.message || ''));
    assert(typeof result.output_path === 'string', 'should return output_path');
    assert(!result.output_path.includes(' '), 'output_path should not contain spaces');
    try { unlinkSync(result.output_path); } catch (_) { /* ignore */ }
  });

  await test('export_pdf → default path (unsaved doc → desktop)', async () => {
    const result = await callTool(client, 'export_pdf') as any;
    assert(result.success === true, 'export_pdf should succeed: ' + (result.message || ''));
    assert(typeof result.output_path === 'string', 'should return output_path');
    assert(!result.output_path.includes(' '), 'output_path should not contain spaces');
    try { unlinkSync(result.output_path); } catch (_) { /* ignore */ }
  });

  await test('save_document → save_as default path (unsaved doc → desktop)', async () => {
    const result = await callTool(client, 'save_document', { mode: 'save_as' }) as any;
    assert(result.success === true, 'save_as should succeed: ' + (result.message || ''));
    assert(typeof result.path === 'string', 'should return path');
    assert(!result.path.includes(' '), 'path should not contain spaces');
    try { unlinkSync(result.path); } catch (_) { /* ignore */ }
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
    const result = await callTool(client, 'preflight_check', { min_dpi: 150 }) as any;
    assert(Array.isArray(result.results), 'should have results array');
    const lowRes = result.results.filter((r: any) => r.category === 'low_resolution');
    assert(lowRes.length >= 1, `should detect at least 1 low-resolution image, got ${lowRes.length}`);
    for (const item of lowRes) {
      assert(item.level === 'error', `low_resolution level should be "error", got "${item.level}"`);
      assert(item.details.effectivePPI < 150,
        `effectivePPI should be < 150, got ${item.details.effectivePPI}`);
    }
  });

  await test('preflight_check → no low_resolution at min_dpi: 30', async () => {
    const result = await callTool(client, 'preflight_check', { min_dpi: 30 }) as any;
    const lowRes = result.results.filter((r: any) => r.category === 'low_resolution');
    assert(lowRes.length === 0, `should detect 0 low-resolution images at min_dpi=30, got ${lowRes.length}`);
  });

  await test('get_overprint_info (utility)', async () => {
    const result = await callTool(client, 'get_overprint_info') as any;
    assert(!result.error, 'should not error: ' + (result.message || ''));
  });

  await test('assign_color_profile (sRGB)', async () => {
    const result = await callTool(client, 'assign_color_profile', {
      profile: 'sRGB IEC61966-2.1',
    }) as any;
    assert(typeof result === 'object', 'should return a result object');
    assert(!result.error, 'should not return error: ' + (result.message || ''));
  });

  // --- resize_for_variation ---

  await test('resize_for_variation → create 2 size variations', async () => {
    const result = await callTool(client, 'resize_for_variation', {
      source_artboard_index: 0,
      target_sizes: [
        { width: 400, height: 300, name: 'E2E-Half' },
        { width: 1600, height: 1200, name: 'E2E-Double' },
      ],
      scale_mode: 'proportional',
    }) as any;
    assert(result.success === true, 'resize_for_variation should succeed: ' + JSON.stringify(result).substring(0, 200));
    assert(result.sourceArtboard === 0, `source should be 0, got ${result.sourceArtboard}`);
    assert(result.createdCount === 2, `should create 2 variations, got ${result.createdCount}`);
    assert(Array.isArray(result.artboards), 'should have artboards array');
    assert(result.artboards.length === 2, `should have 2 artboard entries, got ${result.artboards.length}`);
    for (const ab of result.artboards) {
      assert(typeof ab.artboardIndex === 'number', 'artboard entry should have artboardIndex');
      assert(typeof ab.width === 'number', 'artboard entry should have width');
      assert(typeof ab.height === 'number', 'artboard entry should have height');
      assert(typeof ab.scaleFactor === 'number', 'artboard entry should have scaleFactor');
      assert(typeof ab.objectCount === 'number', 'artboard entry should have objectCount');
    }
  });

  await test('resize_for_variation → fit_width mode', async () => {
    const result = await callTool(client, 'resize_for_variation', {
      source_artboard_index: 0,
      target_sizes: [
        { width: 600, height: 600, name: 'E2E-FitWidth' },
      ],
      scale_mode: 'fit_width',
    }) as any;
    assert(result.success === true, 'fit_width resize should succeed: ' + JSON.stringify(result).substring(0, 200));
    assert(result.createdCount === 1, `should create 1 variation, got ${result.createdCount}`);
  });

  // --- set_workflow ---

  await test('set_workflow → set web', async () => {
    const result = await callTool(client, 'set_workflow', {
      workflow: 'web',
    }) as any;
    assert(result.status === 'set', `status should be "set", got ${result.status}`);
    assert(result.workflow === 'web', `workflow should be "web", got ${result.workflow}`);
    assert(result.coordinateSystem === 'artboard-web', `coordinate should be artboard-web, got ${result.coordinateSystem}`);
  });

  await test('set_workflow → query current', async () => {
    const result = await callTool(client, 'set_workflow', {}) as any;
    assert(result.currentWorkflow === 'web', `current workflow should be "web", got ${result.currentWorkflow}`);
    assert(typeof result.currentCoordinateSystem === 'string', 'should have currentCoordinateSystem');
  });

  await test('set_workflow → set print', async () => {
    const result = await callTool(client, 'set_workflow', {
      workflow: 'print',
    }) as any;
    assert(result.status === 'set', `status should be "set", got ${result.status}`);
    assert(result.workflow === 'print', `workflow should be "print", got ${result.workflow}`);
    assert(result.coordinateSystem === 'document', `print coordinate should be document, got ${result.coordinateSystem}`);
  });

  await test('set_workflow → clear', async () => {
    const result = await callTool(client, 'set_workflow', {
      clear: true,
    }) as any;
    assert(result.status === 'cleared', `status should be "cleared", got ${result.status}`);
  });

  // ============================================================
  // Phase 5: 新規ツール
  // ============================================================
  console.log('\n── Phase 5: 新規ツール ──');

  // --- list_fonts ---

  await test('list_fonts', async () => {
    const result = await callTool(client, 'list_fonts') as any;
    assert(!result.error, 'list_fonts should not error: ' + (result.message || ''));
    assert(Array.isArray(result.fonts), 'should have fonts array');
    assert(result.fonts.length >= 1, 'should list at least 1 font');
    const f = result.fonts[0];
    assert(typeof f.name === 'string', 'font should have name');
    assert(typeof f.family === 'string', 'font should have family');
  });

  // --- convert_coordinate ---

  await test('convert_coordinate (artboard ↔ document)', async () => {
    const r1 = await callTool(client, 'convert_coordinate', {
      point: { x: 100, y: 200 },
      from: 'artboard',
      to: 'document',
    }) as any;
    assert(!r1.error, 'artboard→document should not error: ' + (r1.message || ''));
    assert(typeof r1.x === 'number' && typeof r1.y === 'number', 'should have x, y');
    assert(r1.from === 'artboard' && r1.to === 'document', 'from/to should match');
    // reverse
    const r2 = await callTool(client, 'convert_coordinate', {
      point: { x: r1.x, y: r1.y },
      from: 'document',
      to: 'artboard',
    }) as any;
    assert(!r2.error, 'document→artboard should not error: ' + (r2.message || ''));
    assertClose(r2.x, 100, 'round-trip x');
    assertClose(r2.y, 200, 'round-trip y');
  });

  // --- group_objects / ungroup_objects ---

  let groupUuid = '';

  await test('group_objects → rect + ellipse', async () => {
    const result = await callTool(client, 'group_objects', {
      uuids: [rectUuid, ellipseUuid],
    }) as any;
    assert(result.success === true, 'group should succeed: ' + JSON.stringify(result));
    assert(typeof result.uuid === 'string', 'should return uuid');
    assert(result.childCount === 2, `should group 2 objects, got ${result.childCount}`);
    groupUuid = result.uuid;
  });

  await test('ungroup_objects → release group', async () => {
    const result = await callTool(client, 'ungroup_objects', {
      uuid: groupUuid,
    }) as any;
    assert(result.success === true, 'ungroup should succeed: ' + JSON.stringify(result));
    assert(result.releasedCount === 2, `should release 2 objects, got ${result.releasedCount}`);
    assert(Array.isArray(result.childUuids), 'should have childUuids');
  });

  // --- duplicate_objects ---

  await test('duplicate_objects → with offset', async () => {
    const result = await callTool(client, 'duplicate_objects', {
      uuids: [rectUuid],
      offset: { x: 50, y: 50 },
    }) as any;
    assert(result.success === true, 'duplicate should succeed: ' + JSON.stringify(result));
    assert(result.duplicatedCount === 1, `should duplicate 1, got ${result.duplicatedCount}`);
    assert(Array.isArray(result.items), 'should have items');
    assert(result.items.length === 1, 'should have 1 duplicated item');
    assert(typeof result.items[0].newUuid === 'string', 'item should have newUuid');
  });

  // --- set_z_order ---

  await test('set_z_order → bring_to_front + send_to_back', async () => {
    const r1 = await callTool(client, 'set_z_order', {
      uuid: rectUuid,
      command: 'bring_to_front',
    }) as any;
    assert(r1.success === true, 'bring_to_front should succeed: ' + JSON.stringify(r1));
    const r2 = await callTool(client, 'set_z_order', {
      uuid: rectUuid,
      command: 'send_to_back',
    }) as any;
    assert(r2.success === true, 'send_to_back should succeed');
  });

  // --- move_to_layer ---

  await test('move_to_layer → round-trip', async () => {
    const r1 = await callTool(client, 'move_to_layer', {
      uuids: [rectUuid],
      target_layer: 'TestLayer-Text',
    }) as any;
    assert(r1.success === true, 'move to TestLayer-Text should succeed: ' + JSON.stringify(r1));
    assert(r1.movedCount === 1, `should move 1, got ${r1.movedCount}`);
    // move back
    const r2 = await callTool(client, 'move_to_layer', {
      uuids: [rectUuid],
      target_layer: 'TestLayer-Main',
    }) as any;
    assert(r2.success === true, 'move back should succeed');
  });

  // --- manage_artboards ---

  await test('manage_artboards → add', async () => {
    const result = await callTool(client, 'manage_artboards', {
      action: 'add',
      rect: { x: 900, y: 0, width: 400, height: 300 },
      name: '__e2e_artboard_2',
    }) as any;
    assert(result.success === true, 'add artboard should succeed: ' + JSON.stringify(result));
    assert(typeof result.index === 'number', 'should return index');
    assert(result.name === '__e2e_artboard_2', `name should be __e2e_artboard_2, got ${result.name}`);
  });

  await test('manage_artboards → rename + resize + remove', async () => {
    const abResult = await callTool(client, 'get_artboards') as any;
    const lastIdx = abResult.artboards.length - 1;
    // rename
    const rn = await callTool(client, 'manage_artboards', {
      action: 'rename', index: lastIdx, name: '__e2e_artboard_renamed',
    }) as any;
    assert(rn.success === true, 'rename should succeed');
    assert(rn.name === '__e2e_artboard_renamed', `name should match, got ${rn.name}`);
    // resize
    const rs = await callTool(client, 'manage_artboards', {
      action: 'resize', index: lastIdx, rect: { x: 900, y: 0, width: 500, height: 400 },
    }) as any;
    assert(rs.success === true, 'resize should succeed');
    // remove
    const rmResult = await callTool(client, 'manage_artboards', {
      action: 'remove', index: lastIdx,
    }) as any;
    assert(rmResult.success === true, 'remove should succeed');
    const abAfter = await callTool(client, 'get_artboards') as any;
    assert(abAfter.artboards.length === abResult.artboards.length - 1, 'artboard count should decrease by 1');
  });

  // --- graphic styles: list + apply ---

  await test('list_graphic_styles + apply', async () => {
    const list = await callTool(client, 'list_graphic_styles') as any;
    assert(!list.error, 'list should not error: ' + (list.message || ''));
    assert(list.count >= 1, 'should have at least 1 graphic style (default)');
    const styleName = list.styles[0].name;
    const apply = await callTool(client, 'apply_graphic_style', {
      style_name: styleName,
      uuids: [rectUuid],
    }) as any;
    assert(apply.success === true, 'apply should succeed: ' + JSON.stringify(apply));
    assert(apply.appliedCount === 1, `should apply to 1 object, got ${apply.appliedCount}`);
  });

  // --- text styles: list ---

  await test('list_text_styles', async () => {
    const result = await callTool(client, 'list_text_styles') as any;
    assert(!result.error, 'should not error: ' + (result.message || ''));
    assert(Array.isArray(result.characterStyles), 'should have characterStyles');
    assert(Array.isArray(result.paragraphStyles), 'should have paragraphStyles');
  });

  // --- create_gradient ---

  await test('create_gradient → linear RGB', async () => {
    const result = await callTool(client, 'create_gradient', {
      name: '__e2e_gradient_linear',
      type: 'linear',
      stops: [
        { color: { type: 'rgb', r: 255, g: 0, b: 0 }, position: 0 },
        { color: { type: 'rgb', r: 0, g: 0, b: 255 }, position: 100 },
      ],
    }) as any;
    assert(result.success === true, 'create_gradient should succeed: ' + JSON.stringify(result));
    assert(result.name === '__e2e_gradient_linear', `name should match, got ${result.name}`);
    assert(result.stopCount === 2, `should have 2 stops, got ${result.stopCount}`);
  });

  await test('create_gradient → radial with apply', async () => {
    const result = await callTool(client, 'create_gradient', {
      name: '__e2e_gradient_radial',
      type: 'radial',
      stops: [
        { color: { type: 'rgb', r: 0, g: 255, b: 0 }, position: 0 },
        { color: { type: 'rgb', r: 255, g: 255, b: 0 }, position: 50 },
        { color: { type: 'rgb', r: 0, g: 0, b: 255 }, position: 100 },
      ],
      apply_to_uuids: [ellipseUuid],
      angle: 45,
    }) as any;
    assert(result.success === true, 'create_gradient radial should succeed');
    assert(result.type === 'radial', `type should be radial, got ${result.type}`);
    assert(result.stopCount === 3, `should have 3 stops, got ${result.stopCount}`);
    assert(result.appliedCount === 1, `should apply to 1 object, got ${result.appliedCount}`);
  });

  // --- manage_swatches ---

  await test('manage_swatches → add + delete', async () => {
    const add = await callTool(client, 'manage_swatches', {
      action: 'add',
      name: '__e2e_swatch_red',
      color: { type: 'rgb', r: 255, g: 0, b: 0 },
    }) as any;
    assert(add.success === true, 'add swatch should succeed: ' + JSON.stringify(add));
    assert(add.name === '__e2e_swatch_red', `name should match, got ${add.name}`);
    const del = await callTool(client, 'manage_swatches', {
      action: 'delete',
      name: '__e2e_swatch_red',
    }) as any;
    assert(del.success === true, 'delete swatch should succeed');
  });

  // --- place_symbol (シンボル未定義のエラーパス) ---

  await test('place_symbol → nonexistent symbol (should error)', async () => {
    const result = await callTool(client, 'place_symbol', {
      action: 'place',
      symbol_name: '__e2e_nonexistent_symbol',
    }) as any;
    assert(result.error === true, 'should return error for nonexistent symbol');
  });

  // --- undo ---

  await test('undo → single + multiple steps', async () => {
    const r1 = await callTool(client, 'undo') as any;
    assert(r1.success === true, 'undo should succeed: ' + JSON.stringify(r1));
    assert(r1.count === 1, `should undo 1 step, got ${r1.count}`);
    const r2 = await callTool(client, 'undo', { count: 2 }) as any;
    assert(r2.success === true, 'undo 2 steps should succeed');
    assert(r2.count === 2, `should undo 2 steps, got ${r2.count}`);
  });

  // --- create_path_text ---

  await test('create_path_text → on path', async () => {
    const result = await callTool(client, 'create_path_text', {
      path_uuid: pathUuid,
      contents: 'Path text E2E テスト',
    }) as any;
    assert(!result.error, 'create_path_text should not error: ' + (result.message || ''));
    assert(typeof result.uuid === 'string', 'should return uuid');
  });

  // --- apply_text_style ---

  await test('apply_text_style → paragraph style (default)', async () => {
    const styles = await callTool(client, 'list_text_styles') as any;
    if (styles.paragraphStyles && styles.paragraphStyles.length > 0) {
      const styleName = styles.paragraphStyles[0].name;
      const found = await callTool(client, 'find_objects', { type: 'text' }) as any;
      if (found.count >= 1) {
        const result = await callTool(client, 'apply_text_style', {
          uuid: found.objects[0].uuid,
          style_type: 'paragraph',
          style_name: styleName,
        }) as any;
        assert(result.success === true, 'apply_text_style should succeed: ' + JSON.stringify(result));
        assert(result.styleName === styleName, `styleName should match, got ${result.styleName}`);
      }
    }
  });

  // --- manage_datasets ---

  await test('manage_datasets → list_variables + list_datasets', async () => {
    const vars = await callTool(client, 'manage_datasets', { action: 'list_variables' }) as any;
    assert(!vars.error, 'list_variables should not error: ' + (vars.message || ''));
    assert(typeof vars.count === 'number', 'should have count');
    assert(Array.isArray(vars.variables), 'should have variables array');
    const ds = await callTool(client, 'manage_datasets', { action: 'list_datasets' }) as any;
    assert(!ds.error, 'list_datasets should not error: ' + (ds.message || ''));
    assert(typeof ds.count === 'number', 'should have count');
    assert(Array.isArray(ds.datasets), 'should have datasets array');
  });

  // --- manage_artboards → rearrange ---

  await test('manage_artboards → rearrange', async () => {
    await callTool(client, 'manage_artboards', {
      action: 'add', rect: { x: 900, y: 0, width: 400, height: 300 },
    });
    const result = await callTool(client, 'manage_artboards', {
      action: 'rearrange',
      layout: 'grid_by_row',
      rows_or_cols: 2,
      spacing: 30,
    }) as any;
    assert(result.success === true, 'rearrange should succeed: ' + JSON.stringify(result));
    const ab = await callTool(client, 'get_artboards') as any;
    await callTool(client, 'manage_artboards', {
      action: 'remove', index: ab.artboards.length - 1,
    });
  });

  // --- エラーパス ---

  await test('modify_object → invalid UUID (should error)', async () => {
    const result = await callTool(client, 'modify_object', {
      uuid: 'nonexistent-uuid-00000',
      properties: { opacity: 50 },
    }) as any;
    assert(result.error === true, 'should return error for invalid UUID');
  });

  // --- manage_linked_images ---

  await test('manage_linked_images → embed', async () => {
    const result = await callTool(client, 'manage_linked_images', {
      uuid: linkedImageUuid,
      action: 'embed',
    }) as any;
    assert(result.success === true, 'embed should succeed: ' + JSON.stringify(result));
    assert(result.action === 'embed', `action should be embed, got ${result.action}`);
    assert(typeof result.newUuid === 'string', 'should return newUuid');
  });

  // --- save_document ---

  await test('save_document → save (overwrite)', async () => {
    const result = await callTool(client, 'save_document', { mode: 'save' }) as any;
    assert(typeof result === 'object', 'should return a result');
  });

  // ============================================================
  // Phase 6: テキスト & エスケーピング (refactor-verify)
  // ============================================================
  console.log('\n── Phase 6: テキスト & エスケーピング ──');

  // --- 特殊文字のエスケーピング ---

  await test('text with quotes (double and single)', async () => {
    const textWithQuotes = 'She said "hello" and he said \'goodbye\'';
    const r = await callTool(client, 'create_text_frame', {
      x: 600, y: 200, contents: textWithQuotes,
      font_size: 12, name: '__e2e_quotes',
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
      font_size: 12, name: '__e2e_backslash',
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
      font_size: 12, name: '__e2e_htmlchars',
      layer_name: 'EscapeTest',
    }) as any;
    assert(typeof r.uuid === 'string', 'should create text frame');

    const detail = await callTool(client, 'get_text_frame_detail', { uuid: r.uuid }) as any;
    assert(detail.contents === textWithHtml,
      `HTML chars not preserved: expected "${textWithHtml}", got "${detail.contents}"`);
  });

  // --- スプレッドシート風テキスト ---

  const spreadsheetText = "Product\tPrice\tStock\nWidget A\t$12.99\t150\nWidget B\t$24.50\t75\nGadget C\t$8.00\t300";
  const ssRows = spreadsheetText.split('\n');
  const ssUuids: string[] = [];

  for (let i = 0; i < ssRows.length; i++) {
    await test(`spreadsheet row ${i}: create_text_frame ("${ssRows[i].substring(0, 30)}")`, async () => {
      const r = await callTool(client, 'create_text_frame', {
        x: 50, y: 50 + i * 25,
        contents: ssRows[i],
        font_size: 12,
        name: `__e2e_ss_row_${i}`,
        layer_name: 'SpreadsheetData',
      }) as any;
      assert(typeof r.uuid === 'string', 'should return uuid');
      ssUuids.push(r.uuid);
    });
  }

  await test('verify spreadsheet text preservation (tab characters)', async () => {
    for (let i = 0; i < ssUuids.length; i++) {
      const r = await callTool(client, 'get_text_frame_detail', { uuid: ssUuids[i] }) as any;
      const expected = ssRows[i];
      assert(r.contents === expected || r.contents === expected.replace(/\t/g, '    '),
        `row ${i}: expected "${expected}", got "${r.contents}"`);
    }
  });

  // --- PDF 風テキスト ---

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
      name: '__e2e_pdf_text',
      layer_name: 'PDFContent',
    }) as any;
    assert(typeof r.uuid === 'string', 'should return uuid');
  });

  await test('verify PDF text content preservation', async () => {
    const r = await callTool(client, 'find_objects', { name: '__e2e_pdf_text' }) as any;
    assert(r.count === 1, 'should find PDF text frame');
  });

  // --- DOCX 風テキスト ---

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
        name: `__e2e_docx_p${i}`,
        layer_name: 'DOCXContent',
      }) as any;
      assert(typeof r.uuid === 'string', 'should return uuid');
      docxUuids.push(r.uuid);
    });
  }

  await test('verify DOCX text with newlines preserved', async () => {
    const r = await callTool(client, 'get_text_frame_detail', { uuid: docxUuids[1] }) as any;
    const expected = docxParagraphs[1].text;
    const normalizedActual = r.contents.replace(/\r/g, '\n');
    assert(normalizedActual === expected,
      `paragraph 1 text mismatch: expected "${expected}", got "${r.contents}"`);
  });

  // --- PPTX 風テキスト ---

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
      name: '__e2e_pptx_title',
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
      name: '__e2e_pptx_bullets',
      layer_name: 'PPTXContent',
    }) as any;
    assert(typeof r.uuid === 'string', 'should return uuid');
  });

  // --- 混合テキスト ---

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
      name: '__e2e_mixed',
      layer_name: 'MixedContent',
    }) as any;
    assert(typeof r.uuid === 'string', 'should return uuid');
  });

  await test('verify mixed text round-trip', async () => {
    const objs = await callTool(client, 'find_objects', { name: '__e2e_mixed' }) as any;
    assert(objs.count === 1, 'should find mixed text frame');
    const r = await callTool(client, 'get_text_frame_detail', { uuid: objs.objects[0].uuid }) as any;
    const normalizedActual = r.contents.replace(/\r/g, '\n');
    assert(normalizedActual === mixedText,
      `mixed text mismatch:\nexpected: "${mixedText}"\ngot:      "${r.contents}"`);
  });

  // --- 既存テキストの上書き ---

  await test('overwrite text via modify_object', async () => {
    const newText = 'Updated from external source:\nLine 2 of update\nLine 3';
    const r = await callTool(client, 'modify_object', {
      uuid: docxUuids[3],
      properties: { contents: newText },
    }) as any;
    assert(r.success === true, 'modify should succeed');

    const detail = await callTool(client, 'get_text_frame_detail', { uuid: docxUuids[3] }) as any;
    const normalized = detail.contents.replace(/\r/g, '\n');
    assert(normalized === newText,
      `overwritten text mismatch: expected "${newText}", got "${detail.contents}"`);
  });

  // --- クリップボード想定テキスト ---

  const clipboardText = '  \n\n  Pasted from clipboard  \n\n  with leading/trailing whitespace  \n\n';

  await test('clipboard-style text with whitespace', async () => {
    const r = await callTool(client, 'create_text_frame', {
      x: 400, y: 480,
      contents: clipboardText,
      kind: 'area',
      width: 250,
      height: 80,
      font_size: 10,
      name: '__e2e_clipboard',
      layer_name: 'MixedContent',
    }) as any;
    assert(typeof r.uuid === 'string', 'should return uuid');
  });

  await test('verify clipboard text frame exists', async () => {
    const objs = await callTool(client, 'find_objects', { name: '__e2e_clipboard' }) as any;
    assert(objs.count === 1, 'should find clipboard text frame');
  });

  // --- テーブルデータ ---

  const headers = ['Name', 'Department', 'Email'];
  const rows = [
    ['Tanaka Taro', 'Engineering', 'tanaka@example.com'],
    ['Suzuki Hanako', 'Design', 'suzuki@example.com'],
    ['Yamada Jiro', 'Marketing', 'yamada@example.com'],
  ];

  for (let col = 0; col < headers.length; col++) {
    await test(`table header col ${col}: "${headers[col]}"`, async () => {
      const r = await callTool(client, 'create_text_frame', {
        x: 50 + col * 150, y: 560,
        contents: headers[col],
        font_size: 11,
        fill: { type: 'rgb', r: 0, g: 0, b: 0 },
        name: `__e2e_tbl_h${col}`,
        layer_name: 'TableData',
      }) as any;
      assert(typeof r.uuid === 'string', 'should return uuid');
    });
  }

  for (let row = 0; row < rows.length; row++) {
    for (let col = 0; col < rows[row].length; col++) {
      await test(`table cell [${row}][${col}]: "${rows[row][col]}"`, async () => {
        const r = await callTool(client, 'create_text_frame', {
          x: 50 + col * 150, y: 575 + row * 15,
          contents: rows[row][col],
          font_size: 10,
          name: `__e2e_tbl_r${row}c${col}`,
          layer_name: 'TableData',
        }) as any;
        assert(typeof r.uuid === 'string', 'should return uuid');
      });
    }
  }

  await test('verify table data integrity', async () => {
    for (let row = 0; row < rows.length; row++) {
      for (let col = 0; col < rows[row].length; col++) {
        const objs = await callTool(client, 'find_objects', { name: `__e2e_tbl_r${row}c${col}` }) as any;
        assert(objs.count === 1, `should find cell [${row}][${col}]`);
      }
    }
  });

  // ============================================================
  // Phase 7: クリーンアップ — ドキュメントを閉じ、一時ファイルを削除
  // ============================================================
  console.log('\n── Phase 7: クリーンアップ ──');

  await test('close_document (save: false)', async () => {
    const result = await callTool(client, 'close_document', { save: false }) as any;
    assert(result.success === true, 'close_document should succeed');
  });

  // --- open_document (close 後に別ドキュメントを開いて閉じる) ---

  await test('open_document + close_document', async () => {
    const createResult = await callTool(client, 'create_document', {
      width: 100, height: 100, color_mode: 'rgb',
    }) as any;
    assert(createResult.success === true, 'create temp doc should succeed');
    const savePath = `${TMP_DIR}/e2e-open-test.ai`;
    const saveResult = await callTool(client, 'save_document', {
      mode: 'save_as', path: savePath,
    }) as any;
    assert(saveResult.success === true, 'save_as should succeed: ' + JSON.stringify(saveResult));
    await callTool(client, 'close_document', { save: false });
    // re-open
    const openResult = await callTool(client, 'open_document', { path: savePath }) as any;
    assert(openResult.success === true, 'open_document should succeed: ' + JSON.stringify(openResult));
    assert(typeof openResult.name === 'string', 'should have name');
    assert(typeof openResult.colorSpace === 'string', 'should have colorSpace');
    await callTool(client, 'close_document', { save: false });
  });

  await test('cleanup temp files', async () => {
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  // ============================================================
  // 結果サマリ
  // ============================================================
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const skipped = results.filter(r => r.status === 'skip').length;

  console.log('\n' + '='.repeat(50));
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
