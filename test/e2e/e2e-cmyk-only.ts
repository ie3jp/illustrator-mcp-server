/**
 * CMYK Print E2E テスト（単独実行用）
 * 使い方: npx tsx test/e2e/e2e-cmyk-only.ts
 */
import {
  createClient,
  callTool,
  test,
  assert,
  assertClose,
  printHeader,
  printPhase,
  printResults,
} from './helpers.js';

async function main(): Promise<void> {
  const startTime = Date.now();
  printHeader();
  console.log('  \x1b[33mCMYK-only test\x1b[0m\n');

  const client = await createClient();

  printPhase(0, 'CMYK Print');

  const CMYK_W = 595;
  const CMYK_H = 842;

  await test('create_document (CMYK, A4)', async () => {
    const result = await callTool(client, 'create_document', {
      width: CMYK_W, height: CMYK_H, color_mode: 'cmyk',
    }) as any;
    assert(result.success === true, 'create_document should succeed');
    assert(result.colorMode === 'CMYK', `colorMode should be CMYK, got ${result.colorMode}`);
  });

  await test('get_document_info → CMYK + document coordinate system', async () => {
    const info = await callTool(client, 'get_document_info') as any;
    assert(info.colorMode === 'CMYK', `colorMode should be CMYK, got ${info.colorMode}`);
    assert(
      info.workflowHint?.recommendedCoordinateSystem === 'document',
      `should recommend document, got ${info.workflowHint?.recommendedCoordinateSystem}`,
    );
  });

  await test('get_artboards → coordinateSystem is document', async () => {
    const ab = await callTool(client, 'get_artboards') as any;
    assert(ab.coordinateSystem === 'document', `should be document, got ${ab.coordinateSystem}`);
  });

  const cmykRectX = 50;
  const cmykRectY = 700;
  const cmykRectW = 200;
  const cmykRectH = 100;
  let cmykRectUuid = '';

  await test('create_rectangle (document coords, CMYK fill)', async () => {
    const r = await callTool(client, 'create_rectangle', {
      x: cmykRectX, y: cmykRectY, width: cmykRectW, height: cmykRectH,
      fill: { type: 'cmyk', c: 0, m: 100, y: 100, k: 0 },
      name: '__e2e_cmyk_rect',
    }) as any;
    assert(typeof r.uuid === 'string', 'should return uuid');
    assert(r.coordinateSystem === 'document', `should be document, got ${r.coordinateSystem}`);
    cmykRectUuid = r.uuid;
  });

  await test('verify CMYK rect position (document coords)', async () => {
    const r = await callTool(client, 'find_objects', { name: '__e2e_cmyk_rect' }) as any;
    assert(r.count === 1, `should find 1 rect, got ${r.count}`);
    assert(r.coordinateSystem === 'document', `should be document, got ${r.coordinateSystem}`);
    assertClose(r.objects[0].bounds.x, cmykRectX, 'rect x');
    assertClose(r.objects[0].bounds.y, cmykRectY, 'rect y');
    assertClose(r.objects[0].bounds.width, cmykRectW, 'rect width');
    assertClose(r.objects[0].bounds.height, cmykRectH, 'rect height');
  });

  await test('modify_object position (document coords) + verify', async () => {
    const r = await callTool(client, 'modify_object', {
      uuid: cmykRectUuid,
      properties: { position: { x: 100, y: 600 } },
    }) as any;
    assert(r.success === true, 'should succeed');
    assert(r.coordinateSystem === 'document', `should be document, got ${r.coordinateSystem}`);

    const found = await callTool(client, 'find_objects', { name: '__e2e_cmyk_rect' }) as any;
    assertClose(found.objects[0].bounds.x, 100, 'moved x');
    assertClose(found.objects[0].bounds.y, 600, 'moved y');
  });

  await test('create_text_frame (CMYK, document coords)', async () => {
    const r = await callTool(client, 'create_text_frame', {
      x: 50, y: 500, contents: 'CMYK Print Test', font_size: 24,
      fill: { type: 'cmyk', c: 100, m: 0, y: 0, k: 0 },
      name: '__e2e_cmyk_text',
    }) as any;
    assert(typeof r.uuid === 'string', 'should return uuid');
    assert(r.coordinateSystem === 'document', `should be document, got ${r.coordinateSystem}`);
  });

  await test('create_crop_marks → bleed note includes document', async () => {
    const r = await callTool(client, 'create_crop_marks', { style: 'japanese' }) as any;
    assert(r.success === true, 'should succeed');
    assert(r.activeCoordinateSystem === 'document', `should be document, got ${r.activeCoordinateSystem}`);
    assert(
      typeof r.bleed_required === 'string' && r.bleed_required.includes('document'),
      'bleed_required should mention document',
    );
  });

  await test('set_workflow override → clear → auto-detect', async () => {
    const r = await callTool(client, 'set_workflow', { workflow: 'web' }) as any;
    assert(r.coordinateSystem === 'artboard-web', `should override to artboard-web, got ${r.coordinateSystem}`);

    await callTool(client, 'set_workflow', { clear: true });
    const ab = await callTool(client, 'get_artboards') as any;
    assert(ab.coordinateSystem === 'document', `should revert to document, got ${ab.coordinateSystem}`);
  });

  await test('close CMYK document', async () => {
    const result = await callTool(client, 'close_document', { save: false }) as any;
    assert(result.success === true, 'close should succeed');
  });

  await client.close();
  printResults(startTime);
}

main();
