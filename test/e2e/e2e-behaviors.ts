/**
 * 挙動 E2E テスト（修正計画 T1〜T14 の回帰確認）
 *
 * 修正計画（docs/fix-plan.md）で直した「成功と返るのに実際は違う」系の挙動を、
 * 実機の Illustrator で 1 つずつ確かめる。e2e-test.ts が「各ツールが動くこと」を見るのに対し、
 * こちらは「直した挙動が実機で本当にそうなっているか」を見る。
 *
 * - 領域（Phase）ごとに専用のドキュメントを作り、終了時に save: false で閉じる
 * - ツールで作れない前提状態（ユーザーのメモ・サブレイヤー・複合パス・縦組み・スレッド・
 *   文字選択・オーバープリント・特色など）は「フィクスチャ JSX」で直接作る。
 *   フィクスチャはテストが作ったドキュメントがアクティブなときだけ動く（名前で照合）
 * - E2E_PHASES=1,3 のように指定すると、その Phase だけ実行する
 *
 * 使い方: npm run build && npx tsx test/e2e/e2e-behaviors.ts
 */
import { execFileSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { readImageDimensions } from '../../src/utils/image-header.js';
import {
  createClient,
  callTool,
  test,
  skip,
  assert,
  assertClose,
  generateTestPng,
  printHeader,
  printPhase,
  printStatus,
  printResults,
} from './helpers.js';

const TMP = '/tmp/illustrator-mcp-e2e-behaviors';
const PNG_100 = `${TMP}/img-100.png`;
const ILLUSTRATOR_APP = process.env.E2E_ILLUSTRATOR_APP ?? '/Applications/Adobe Illustrator 2025/Adobe Illustrator.app';
const COMMON_JSX = readFileSync(resolve('src/jsx/helpers/common.jsx'), 'utf-8');
const PKG_VERSION = (JSON.parse(readFileSync(resolve('package.json'), 'utf-8')) as { version: string }).version;

const onlyPhases = process.env.E2E_PHASES
  ? new Set(process.env.E2E_PHASES.split(',').map((s) => Number(s.trim())))
  : null;

let client: Client;
/** 現在テストが操作しているドキュメント名（フィクスチャの照合用） */
let currentDocName = '';
/** このスイートが作ったドキュメント名（最後の後始末用） */
const createdDocNames: string[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const J = (v: unknown): string => JSON.stringify(v);
const brief = (v: unknown): string => {
  const s = JSON.stringify(v);
  return s.length > 600 ? `${s.slice(0, 600)}…` : s;
};

/** リトライなし（作成系を二重実行しないため） */
function t(name: string, fn: () => Promise<void>): Promise<void> {
  return test(name, fn, 0);
}

async function call(name: string, params: Record<string, unknown> = {}): Promise<Any> {
  return callTool(client, name, params);
}

// ─────────────────────────────────────────────────────────────
// フィクスチャ JSX（テスト専用）
//
// MCP サーバーを経由せず、osascript で Illustrator に小さな ExtendScript を直接実行する。
// ツールでは作れない前提状態を作る／ツールが返さない内部状態を読むためだけに使う。
// common.jsx を前置するので findItemByUUID / ensureUUID / jsonStringify が使える。
// アクティブドキュメントがこのテストの作ったもの（currentDocName）でなければ何もしない。
// ─────────────────────────────────────────────────────────────

const FIXTURE_PRELUDE = `
    function F_ab() { return doc.artboards[0].artboardRect; }
    // アートボード 0 の左上を原点、Y 下向きの座標で矩形を作る
    function F_rect(container, x, y, w, h) {
      var ab = F_ab();
      return container.pathItems.rectangle(ab[1] - y, ab[0] + x, w, h);
    }
    function F_rgb(r, g, b) { var c = new RGBColor(); c.red = r; c.green = g; c.blue = b; return c; }
    function F_cmyk(c, m, y, k) { var x = new CMYKColor(); x.cyan = c; x.magenta = m; x.yellow = y; x.black = k; return x; }
    function F_item(uuid) {
      var it = findItemByUUID(uuid);
      if (!it) throw new Error("fixture: item not found: " + uuid);
      return it;
    }
`;

function fixtureJsx(body: string): Any {
  const script = `${COMMON_JSX}
(function () {
  try {
    if (app.documents.length === 0) return jsonStringify({ __fixtureError: "no open document" });
    var doc = app.activeDocument;
    if (doc.name !== ${J(currentDocName)}) {
      return jsonStringify({ __fixtureError: "active document is '" + doc.name + "', not the test document" });
    }
    ${FIXTURE_PRELUDE}
    var __r = (function () {
${body}
    })();
    return jsonStringify(__r === undefined ? null : __r);
  } catch (e) {
    return jsonStringify({ __fixtureError: e.message + " (line " + e.line + ")" });
  }
})();`;
  const file = `${TMP}/fixture-${process.pid}.jsx`;
  writeFileSync(file, script, 'utf-8');
  const out = execFileSync('osascript', [
    '-e', 'with timeout of 120 seconds',
    '-e', `tell application ${J(ILLUSTRATOR_APP)} to do javascript of file (POSIX file ${J(file)})`,
    '-e', 'end timeout',
  ], { encoding: 'utf-8' }).trim();
  let parsed: Any;
  try {
    parsed = JSON.parse(out);
  } catch {
    throw new Error(`fixture returned non-JSON: ${out.slice(0, 300)}`);
  }
  if (parsed && typeof parsed === 'object' && '__fixtureError' in parsed) {
    throw new Error(`fixture failed: ${parsed.__fixtureError}`);
  }
  return parsed;
}

/** テストが作ったドキュメントのうち、まだ開いているものを保存せずに閉じる（異常終了時の保険） */
function closeLeftoverTestDocs(): void {
  if (createdDocNames.length === 0) return;
  const file = `${TMP}/cleanup-${process.pid}.jsx`;
  writeFileSync(file, `
(function () {
  var names = ${J(createdDocNames)};
  var closed = 0;
  for (var i = app.documents.length - 1; i >= 0; i--) {
    var d = app.documents[i];
    for (var n = 0; n < names.length; n++) {
      if (d.name === names[n]) { d.close(SaveOptions.DONOTSAVECHANGES); closed++; break; }
    }
  }
  return closed;
})();`, 'utf-8');
  try {
    const out = execFileSync('osascript', [
      '-e', 'with timeout of 60 seconds',
      '-e', `tell application ${J(ILLUSTRATOR_APP)} to do javascript of file (POSIX file ${J(file)})`,
      '-e', 'end timeout',
    ], { encoding: 'utf-8' }).trim();
    if (out !== '0') printStatus(`cleanup: closed ${out} leftover test document(s)`);
  } catch (e) {
    printStatus(`cleanup failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ─────────────────────────────────────────────────────────────
// ドキュメント単位の実行
// ─────────────────────────────────────────────────────────────

async function withDoc(
  label: string,
  opts: { color_mode: 'rgb' | 'cmyk'; width?: number; height?: number },
  fn: () => Promise<void>,
): Promise<void> {
  const width = opts.width ?? (opts.color_mode === 'cmyk' ? 595 : 800);
  const height = opts.height ?? (opts.color_mode === 'cmyk' ? 842 : 600);
  let created = false;
  await t(`${label}: create_document (${opts.color_mode.toUpperCase()} ${width}x${height})`, async () => {
    const r = await call('create_document', { width, height, color_mode: opts.color_mode });
    assert(r.success === true && typeof r.fileName === 'string', `create_document failed: ${brief(r)}`);
    currentDocName = r.fileName;
    createdDocNames.push(r.fileName);
    created = true;
  });
  if (!created) return;
  try {
    await fn();
  } finally {
    await t(`${label}: close test document (save: false)`, async () => {
      const info = await call('get_document_info');
      assert(info.fileName === currentDocName, `active document is ${info.fileName}, expected ${currentDocName}; not closing it`);
      const r = await call('close_document', { save: false });
      assert(r.success === true, `close_document failed: ${brief(r)}`);
    });
    currentDocName = '';
  }
}

function phaseEnabled(num: number): boolean {
  return !onlyPhases || onlyPhases.has(num);
}

// ── 小物 ──

async function findOne(name: string, extra: Record<string, unknown> = {}): Promise<Any> {
  const r = await call('find_objects', { name, ...extra });
  assert(r.count === 1, `find_objects "${name}" should find exactly 1, got ${r.count}: ${brief(r)}`);
  return r.objects[0];
}

async function rect(params: Record<string, unknown>): Promise<string> {
  const r = await call('create_rectangle', {
    fill: { type: 'rgb', r: 200, g: 200, b: 200 },
    ...params,
  });
  assert(typeof r.uuid === 'string', `create_rectangle failed: ${brief(r)}`);
  return r.uuid;
}

function uniqueCheck(uuids: string[], label: string): void {
  const seen = new Map<string, number>();
  for (const u of uuids) seen.set(u, (seen.get(u) ?? 0) + 1);
  const dups = [...seen.entries()].filter(([, n]) => n > 1);
  assert(dups.length === 0, `${label}: duplicate UUIDs ${J(dups)}`);
}

async function allUuids(): Promise<string[]> {
  const r = await call('find_objects', {});
  return (r.objects as Any[]).map((o) => o.uuid);
}

function groupUuidsDeep(groups: Any[]): string[] {
  const out: string[] = [];
  const walk = (n: Any): void => {
    out.push(n.uuid);
    for (const c of n.children ?? []) walk(c);
  };
  for (const g of groups) walk(g);
  return out;
}

function rectsOverlap(a: number[], b: number[]): boolean {
  // [left, top, right, bottom]（document 座標: top > bottom）
  return a[0] < b[2] && b[0] < a[2] && a[3] < b[1] && b[3] < a[1];
}

// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const startTime = Date.now();
  printHeader();
  console.log('  \x1b[33mBehavior regression suite (fix plan T1–T14)\x1b[0m\n');

  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  generateTestPng(PNG_100, 100, 100);

  printStatus('Connecting to server...');
  try {
    client = await createClient();
  } catch (e) {
    console.error('  \x1b[31mConnection failed:\x1b[0m', e);
    process.exit(1);
  }
  printStatus('Connected');

  try {
    await runPhases();
  } finally {
    closeLeftoverTestDocs();
    await client.close();
  }
  printResults(startTime);
}

async function runPhases(): Promise<void> {
  // ═══════════════════════════════════════════════════════════
  // T1: 共通ヘルパー（メモ・UUID 解決・z 順・visible・境界判定）
  // ═══════════════════════════════════════════════════════════
  if (phaseEnabled(1)) {
    printPhase(1, 'T1 common helpers (note / UUID / z-order / visibility / bounds)');
    await withDoc('T1', { color_mode: 'rgb' }, async () => {
      await t('user note survives read tools and modify_object (UUID is prepended, memo kept)', async () => {
        fixtureJsx(`
          var r = F_rect(doc.activeLayer, 20, 20, 40, 40);
          r.name = "__t1_memo";
          r.note = "designer memo: keep this";
          return true;`);
        const uuid = (await findOne('__t1_memo')).uuid;
        await call('get_layers', { include_items: true });
        await call('get_document_structure', {});
        await call('get_path_items', {});
        const m = await call('modify_object', { uuid, properties: { opacity: 80, rotation: 10 } });
        assert(m.success === true, `modify_object failed: ${brief(m)}`);
        const note: string = fixtureJsx(`return F_item(${J(uuid)}).note;`);
        assert(note.startsWith(`${uuid} designer memo: keep this`), `note should keep the memo after the UUID, got ${J(note)}`);
        assert(note.includes('::ai-mcp:rot='), `rotation meta should be namespaced (::ai-mcp:rot=), got ${J(note)}`);
      });

      let cpUuid = '';
      await t('compound path inner path: get_groups UUID resolves in modify_object', async () => {
        fixtureJsx(`
          var cp = doc.activeLayer.compoundPathItems.add();
          cp.name = "__t1_cp";
          F_rect(cp, 100, 100, 80, 80);
          F_rect(cp, 120, 120, 40, 40);
          return cp.pathItems.length;`);
        const g = await call('get_groups', {});
        const cp = (g.groups as Any[]).find((x) => x.name === '__t1_cp');
        assert(cp && cp.type === 'compound-path', `compound path not listed: ${brief(g)}`);
        assert(cp.children.length === 2, `compound path should list 2 children, got ${cp.children.length}`);
        cpUuid = cp.uuid;
        const innerUuid = cp.children[1].uuid;
        const m = await call('modify_object', { uuid: innerUuid, properties: { name: '__t1_cp_inner' } });
        assert(m.success === true, `modify_object on inner path failed: ${brief(m)}`);
        const chk = fixtureJsx(`var it = F_item(${J(innerUuid)}); return { name: it.name, parent: it.parent.typename };`);
        assert(chk.name === '__t1_cp_inner' && chk.parent === 'CompoundPathItem', `inner path not renamed in place: ${J(chk)}`);
      });

      await t('sublayer item: resolvable by UUID (modify_object) and found by find_objects', async () => {
        const uuid: string = fixtureJsx(`
          var top = doc.layers.add(); top.name = "__t1_parent";
          var sub = top.layers.add(); sub.name = "__t1_sub";
          var r = F_rect(sub, 300, 100, 50, 50); r.name = "__t1_sub_rect";
          doc.activeLayer = doc.layers[doc.layers.length - 1];
          return ensureUUID(r);`);
        const m = await call('modify_object', { uuid, properties: { opacity: 60 } });
        assert(m.success === true, `modify_object on sublayer item failed: ${brief(m)}`);
        const f = await call('find_objects', { name: '__t1_sub_rect' });
        assert(f.count === 1 && f.objects[0].uuid === uuid, `find_objects should find the sublayer item: ${brief(f)}`);
      });

      await t('duplicate UUID (copied note) → warnings on resolution', async () => {
        const uuid = await rect({ x: 500, y: 50, width: 30, height: 30, name: '__t1_dup_src' });
        const copyUuid: string = fixtureJsx(`
          var d = F_item(${J(uuid)}).duplicate();
          d.name = "__t1_dup_copy";
          return extractUUIDFromNote(d.note);`);
        assert(copyUuid === uuid, `precondition: duplicate() should inherit the note (got ${copyUuid})`);
        const m = await call('modify_object', { uuid, properties: { opacity: 90 } });
        const warnings: string[] = m.warnings ?? [];
        assert(warnings.some((w) => w.includes('shared by 2')), `should warn that the UUID is shared: ${brief(m)}`);
        fixtureJsx(`
          for (var i = doc.pageItems.length - 1; i >= 0; i--) {
            if (doc.pageItems[i].name === "__t1_dup_copy") doc.pageItems[i].remove();
          }
          return true;`);
      });

      await t('zIndex follows stacking order, and set_z_order moves it', async () => {
        await call('manage_layers', { action: 'add', layer_name: '__t1_z' });
        const z1 = await rect({ x: 50, y: 300, width: 40, height: 40, layer_name: '__t1_z' });
        const z2 = await rect({ x: 60, y: 310, width: 40, height: 40, layer_name: '__t1_z' });
        const z3 = await rect({ x: 70, y: 320, width: 40, height: 40, layer_name: '__t1_z' });
        const zOf = async (): Promise<Map<string, number>> => {
          const r = await call('find_objects', { layer_name: '__t1_z' });
          return new Map((r.objects as Any[]).map((o) => [o.uuid, o.zIndex]));
        };
        const before = await zOf();
        assert(before.get(z1)! < before.get(z2)! && before.get(z2)! < before.get(z3)!,
          `zIndex should increase with creation order: ${J([...before])}`);
        const s = await call('set_z_order', { uuid: z1, command: 'bring_to_front' });
        assert(s.success === true, `set_z_order failed: ${brief(s)}`);
        const after = await zOf();
        assert(after.get(z1)! > after.get(z3)!, `z1 should be frontmost after bring_to_front: ${J([...after])}`);
        assert(s.newZIndex === after.get(z1), `newZIndex (${s.newZIndex}) should equal find_objects zIndex (${after.get(z1)})`);
      });

      await t('verified.visible is false for an item on a hidden layer', async () => {
        await call('manage_layers', { action: 'add', layer_name: '__t1_hidden' });
        const uuid = await rect({ x: 600, y: 300, width: 30, height: 30, layer_name: '__t1_hidden' });
        await call('manage_layers', { action: 'hide', layer_name: '__t1_hidden' });
        try {
          const m = await call('modify_object', { uuid, properties: { opacity: 50 } });
          assert(m.verified?.visible === false, `verified.visible should be false: ${brief(m)}`);
        } finally {
          // 追加したレイヤーはアクティブのまま。非表示のままだと以降の作成が "layer is locked" で失敗する
          await call('manage_layers', { action: 'show', layer_name: '__t1_hidden' });
        }
      });

      await t('verified.visible is false for a child of a hidden group', async () => {
        const a = await rect({ x: 600, y: 400, width: 30, height: 30 });
        const b = await rect({ x: 650, y: 400, width: 30, height: 30 });
        const g = await call('group_objects', { uuids: [a, b], name: '__t1_hidden_group' });
        assert(g.success === true, `group_objects failed: ${brief(g)}`);
        const h = await call('modify_object', { uuid: g.uuid, properties: { hidden: true } });
        assert(h.success === true, `hide group failed: ${brief(h)}`);
        const m = await call('modify_object', { uuid: a, properties: { opacity: 70 } });
        assert(m.verified?.visible === false, `child of hidden group should be verified.visible false: ${brief(m)}`);
      });

      await t('text verified.fill is the character color', async () => {
        const r = await call('create_text_frame', {
          x: 50, y: 450, contents: 'Fill check', font_size: 18,
          fill: { type: 'rgb', r: 10, g: 120, b: 200 },
        });
        const f = r.verified?.fill;
        assert(f && f.type === 'rgb', `verified.fill should be rgb: ${brief(r)}`);
        assertClose(f.r, 10, 'fill.r', 1);
        assertClose(f.g, 120, 'fill.g', 1);
        assertClose(f.b, 200, 'fill.b', 1);
      });

      await t('object fully off every artboard → artboardRelative: false (find_objects)', async () => {
        const r = await call('create_rectangle', { x: 2000, y: 2000, width: 50, height: 50, name: '__t1_off' });
        assert(String(r.verified?.warning ?? '').includes('completely outside'), `create should warn completely outside: ${brief(r)}`);
        const o = await findOne('__t1_off');
        assert(o.bounds.artboardRelative === false, `bounds.artboardRelative should be false: ${brief(o)}`);
        assert(typeof o.bounds.coordinateNote === 'string', 'bounds.coordinateNote should explain the fallback');
      });

      await t('thick stroke that reaches onto the artboard is not "completely outside"', async () => {
        // 幾何形状は左端の外（右端 x = -10）だが、線幅 40（外側 20）で x = +10 まで見えている
        const r = await call('create_rectangle', {
          x: -60, y: 100, width: 50, height: 50,
          fill: { type: 'none' },
          stroke: { color: { type: 'rgb', r: 0, g: 0, b: 0 }, width: 40 },
        });
        const w = String(r.verified?.warning ?? '');
        assert(!w.includes('completely outside'), `should not report completely outside: ${w}`);
        assert(w.includes('extends beyond'), `should report partially outside: ${brief(r)}`);
      });
      void cpUuid;
    });
  }

  // ═══════════════════════════════════════════════════════════
  // T2: 実行基盤
  // ═══════════════════════════════════════════════════════════
  if (phaseEnabled(2)) {
    printPhase(2, 'T2 infrastructure (line separators / version / color profile)');

    await t('serverInfo.version equals package.json version', async () => {
      const v = client.getServerVersion();
      assert(v?.version === PKG_VERSION, `serverInfo.version ${v?.version} !== package.json ${PKG_VERSION}`);
    });

    await withDoc('T2', { color_mode: 'rgb' }, async () => {
      await t('U+2028 / U+2029 in text contents do not break the JSX and round-trip', async () => {
        const r = await call('create_text_frame', { x: 50, y: 100, contents: 'Alpha\u2028Beta\u2029Gamma', font_size: 14 });
        assert(typeof r.uuid === 'string', `create_text_frame failed: ${brief(r)}`);
        const d = await call('get_text_frame_detail', { uuid: r.uuid });
        const normalized = String(d.contents).replace(/[\u2028\u2029\r\n\u0003]/g, '|');
        assert(normalized === 'Alpha|Beta|Gamma', `contents should keep all three parts, got ${J(d.contents)}`);
      });

      await t('assign_color_profile: a profile Illustrator ignores is an error, a matching one is applied', async () => {
        // RGB 文書への CMYK プロファイルは例外なしで無視される（実機確認）→ 読み戻しでエラーにする
        const bad = await call('assign_color_profile', { profile: 'Japan Color 2001 Coated' });
        assert(bad.error === true, `CMYK profile on RGB doc should be an error: ${brief(bad)}`);
        assert(!/japan color/i.test(String(bad.verified?.actualProfile ?? '')), `profile should be unchanged: ${brief(bad)}`);
        const ok = await call('assign_color_profile', { profile: 'Adobe RGB (1998)' });
        assert(ok.assigned === true && ok.verified?.actualProfile === 'Adobe RGB (1998)', `RGB profile should be applied: ${brief(ok)}`);
        const info = await call('get_document_info', {});
        assert(info.colorProfile === 'Adobe RGB (1998)', `document should report the new profile, got ${info.colorProfile}`);
      });
    });
  }

  // ═══════════════════════════════════════════════════════════
  // T3: 変形・管理系のデータ損失／失敗の隠蔽
  // ═══════════════════════════════════════════════════════════
  if (phaseEnabled(3)) {
    printPhase(3, 'T3 partial failures / layers / outlines / undo');
    const FAKE = '00000000-0000-4000-8000-000000000000';

    await withDoc('T3', { color_mode: 'rgb' }, async () => {
      await t('delete_objects with an unknown UUID → success: false + notFound (known one still deleted)', async () => {
        const a = await rect({ x: 10, y: 10, width: 20, height: 20 });
        const r = await call('delete_objects', { uuids: [a, FAKE] });
        assert(r.success === false, `success should be false: ${brief(r)}`);
        assert(J(r.notFound) === J([FAKE]), `notFound should list the fake UUID: ${brief(r)}`);
        assert(r.deletedCount === 1, `the existing object should still be deleted: ${brief(r)}`);
        const only = await call('delete_objects', { uuids: [FAKE] });
        assert(only.success === false && only.deletedCount === 0, `all-missing should be success: false: ${brief(only)}`);
      });

      let a = '';
      let b = '';
      await t('group_objects with a missing UUID → error, nothing grouped', async () => {
        a = await rect({ x: 10, y: 100, width: 40, height: 40, name: '__t3_a' });
        b = await rect({ x: 200, y: 150, width: 40, height: 40, name: '__t3_b' });
        const before = (await call('get_groups', {})).count;
        const r = await call('group_objects', { uuids: [a, b, FAKE] });
        assert(r.error === true && J(r.notFound) === J([FAKE]), `should be an error with notFound: ${brief(r)}`);
        const after = (await call('get_groups', {})).count;
        assert(after === before, `group count changed ${before} → ${after}`);
        const parent = fixtureJsx(`return F_item(${J(a)}).parent.typename;`);
        assert(parent === 'Layer', `object should not be grouped (parent ${parent})`);
      });

      await t('align_objects with a missing UUID → error, nothing moved', async () => {
        const r = await call('align_objects', { uuids: [a, b, FAKE], alignment: 'left' });
        assert(r.error === true && J(r.notFound) === J([FAKE]), `should be an error with notFound: ${brief(r)}`);
        assertClose((await findOne('__t3_a')).bounds.x, 10, '__t3_a x unchanged');
        assertClose((await findOne('__t3_b')).bounds.x, 200, '__t3_b x unchanged');
      });

      await t('move_to_layer partial → moves the found ones, success: false + notFound', async () => {
        await call('manage_layers', { action: 'add', layer_name: '__t3_dest' });
        const r = await call('move_to_layer', { uuids: [a, FAKE], target_layer: '__t3_dest' });
        assert(r.success === false && J(r.notFound) === J([FAKE]), `should report notFound: ${brief(r)}`);
        assert((await findOne('__t3_a')).layerName === '__t3_dest', 'found object should be moved');
      });

      await t('manage_layers reorder downwards lands exactly at the requested index (and back up)', async () => {
        for (const n of ['__t3_L1', '__t3_L2', '__t3_L3', '__t3_L4']) {
          await call('manage_layers', { action: 'add', layer_name: n });
        }
        const names = async (): Promise<string[]> => ((await call('get_layers', {})).layers as Any[]).map((l) => l.name);
        const start = await names();
        assert(start[0] === '__t3_L4', `precondition: newest layer on top, got ${J(start)}`);
        const down = await call('manage_layers', { action: 'reorder', layer_name: '__t3_L4', position: 2 });
        assert(down.success === true, `reorder failed: ${brief(down)}`);
        const afterDown = await names();
        assert(afterDown.indexOf('__t3_L4') === 2, `L4 should be at index 2, got ${J(afterDown)}`);
        await call('manage_layers', { action: 'reorder', layer_name: '__t3_L4', position: 0 });
        assert((await names()).indexOf('__t3_L4') === 0, 'L4 should be back at index 0');
      });

      await t('duplicate layer names → add/hide warn, delete is refused', async () => {
        await call('manage_layers', { action: 'add', layer_name: '__t3_dup' });
        const second = await call('manage_layers', { action: 'add', layer_name: '__t3_dup' });
        assert(second.success === true && (second.warnings ?? []).length > 0, `second add should warn: ${brief(second)}`);
        const hide = await call('manage_layers', { action: 'hide', layer_name: '__t3_dup' });
        assert((hide.warnings ?? []).length > 0, `hide on a duplicate name should warn: ${brief(hide)}`);
        const before = ((await call('get_layers', {})).layers as Any[]).length;
        const del = await call('manage_layers', { action: 'delete', layer_name: '__t3_dup' });
        assert(del.error === true && (del.positions ?? []).length === 2, `delete should be refused: ${brief(del)}`);
        const after = ((await call('get_layers', {})).layers as Any[]).length;
        assert(after === before, `layer count changed ${before} → ${after}`);
      });

      await t('convert_to_outlines with a locked text frame → failed[] reported, success: false', async () => {
        await call('manage_layers', { action: 'add', layer_name: '__t3_outl' });
        const t1 = await call('create_text_frame', { x: 50, y: 400, contents: 'Convert me', layer_name: '__t3_outl' });
        const t2 = await call('create_text_frame', { x: 50, y: 450, contents: 'Locked', layer_name: '__t3_outl' });
        const lock = await call('modify_object', { uuid: t2.uuid, properties: { locked: true } });
        assert(lock.success === true, `lock failed: ${brief(lock)}`);
        const r = await call('convert_to_outlines', { target: '__t3_outl' });
        assert(r.success === false, `success should be false: ${brief(r)}`);
        assert(r.convertedCount === 1 && r.failedCount === 1, `1 converted / 1 failed expected: ${brief(r)}`);
        assert(r.failed[0].uuid === t2.uuid && typeof r.failed[0].reason === 'string', `failed[] should name the locked frame: ${brief(r)}`);
        void t1;
      });

      await t('undo / redo return the number of steps performed', async () => {
        await rect({ x: 400, y: 400, width: 20, height: 20 });
        await rect({ x: 430, y: 400, width: 20, height: 20 });
        const u = await call('undo', { action: 'undo', count: 2 });
        assert(u.success === true && u.count === 2 && u.requestedCount === 2, `undo counts: ${brief(u)}`);
        const r = await call('undo', { action: 'redo', count: 2 });
        assert(r.success === true && r.count === 2, `redo counts: ${brief(r)}`);
      });
    });
  }

  // ═══════════════════════════════════════════════════════════
  // T4: 複製系（データセット・バリエーション）
  // ═══════════════════════════════════════════════════════════
  if (phaseEnabled(4)) {
    printPhase(4, 'T4 import_csv / resize_for_variation');

    await withDoc('T4a', { color_mode: 'rgb', width: 400, height: 300 }, async () => {
      const csvPath = `${TMP}/t4.csv`;
      writeFileSync(csvPath, 'title,unused\nAlpha,x\nBeta,y\nGamma,z\n', 'utf-8');
      let templateTextUuid = '';
      await t('import_csv: template (artboard 0) untouched, N new artboards, no overlap, unique UUIDs', async () => {
        const tt = await call('create_text_frame', { x: 30, y: 60, contents: 'TEMPLATE', name: 'title', font_size: 20 });
        templateTextUuid = tt.uuid;
        await rect({ x: 20, y: 100, width: 150, height: 60, name: '__t4_bg' });
        const r = await call('manage_datasets', { action: 'import_csv', file_path: csvPath });
        assert(r.success === true && r.artboards.length === 3, `import_csv failed: ${brief(r)}`);

        const d = await call('get_text_frame_detail', { uuid: templateTextUuid });
        assert(d.contents === 'TEMPLATE', `template text was changed to ${J(d.contents)}`);

        const ab = await call('get_artboards', { coordinate_system: 'document' });
        assert(ab.artboards.length === 4, `expected 4 artboards, got ${ab.artboards.length}`);
        const rects = (ab.artboards as Any[]).map((x) => [x.position.x, x.position.y, x.position.x + x.size.width, x.position.y - x.size.height]);
        for (let i = 0; i < rects.length; i++) {
          for (let j = i + 1; j < rects.length; j++) {
            assert(!rectsOverlap(rects[i], rects[j]), `artboards ${i} and ${j} overlap: ${J([rects[i], rects[j]])}`);
          }
        }
        const got: string[] = [];
        for (let i = 1; i <= 3; i++) {
          const lf = await call('list_text_frames', { artboard_index: i });
          got.push(...(lf.textFrames as Any[]).map((f) => f.contents));
        }
        assert(J(got.sort()) === J(['Alpha', 'Beta', 'Gamma']), `row values on new artboards: ${J(got)}`);
        uniqueCheck(await allUuids(), 'after import_csv');
      });
    });

    await withDoc('T4b', { color_mode: 'rgb', width: 400, height: 300 }, async () => {
      await t('resize_for_variation restores active artboard & selection; copies get unique UUIDs', async () => {
        const a = await rect({ x: 20, y: 20, width: 100, height: 100, name: '__t4_a' });
        const g1 = await rect({ x: 200, y: 150, width: 60, height: 40 });
        const g2 = await rect({ x: 280, y: 150, width: 60, height: 40 });
        await call('group_objects', { uuids: [g1, g2], name: '__t4_group' });
        await call('get_groups', {}); // 子にも UUID を振っておく（複製で継承されうる状態にする）
        fixtureJsx(`
          var r = F_ab();
          doc.artboards.add([r[2] + 100, r[1], r[2] + 300, r[1] - 200]);
          doc.artboards.setActiveArtboardIndex(1);
          return doc.artboards.getActiveArtboardIndex();`);
        const sel = await call('select_objects', { uuids: [a] });
        assert(sel.success === true, `select failed: ${brief(sel)}`);
        const before = await allUuids();

        const r = await call('resize_for_variation', {
          source_artboard_index: 0,
          target_sizes: [{ width: 200, height: 150, name: 'half' }],
        });
        assert(r.success === true, `resize_for_variation failed: ${brief(r)}`);
        const active = fixtureJsx('return doc.artboards.getActiveArtboardIndex();');
        assert(active === 1, `active artboard should be restored to 1, got ${active}`);
        const s = await call('get_selection', {});
        assert(s.selectionCount === 1 && s.items[0].uuid === a, `selection should be restored to __t4_a: ${brief(s)}`);
        const after = await allUuids();
        assert(after.length === before.length * 2, `copies expected (${before.length} → ${after.length})`);
        uniqueCheck(after, 'after resize_for_variation');

        const ab = await call('get_artboards', { coordinate_system: 'document' });
        const rects = (ab.artboards as Any[]).map((x) => [x.position.x, x.position.y, x.position.x + x.size.width, x.position.y - x.size.height]);
        const created = rects[rects.length - 1];
        for (let i = 0; i < rects.length - 1; i++) {
          assert(!rectsOverlap(created, rects[i]), `new artboard overlaps artboard ${i}`);
        }
      });
    });
  }

  // ═══════════════════════════════════════════════════════════
  // T5: トンボ・PDF 書き出しがユーザーのアートワークを壊さない
  // ═══════════════════════════════════════════════════════════
  if (phaseEnabled(5)) {
    printPhase(5, 'T5 crop marks / export_pdf');
    await withDoc('T5', { color_mode: 'cmyk' }, async () => {
      let groupUuid = '';
      let groupBounds: Any = null;
      const groupState = async (): Promise<{ count: number; mine: Any }> => {
        const g = await call('get_groups', { coordinate_system: 'document' });
        return { count: g.count, mine: (g.groups as Any[]).find((x) => x.uuid === groupUuid) };
      };

      await t('setup: user group on the top layer, active layer is another one', async () => {
        await call('manage_layers', { action: 'add', layer_name: '__t5_top' });
        const r1 = await rect({ x: 100, y: 700, width: 80, height: 40, layer_name: '__t5_top', fill: { type: 'cmyk', c: 0, m: 60, y: 90, k: 0 } });
        const r2 = await rect({ x: 200, y: 700, width: 80, height: 40, layer_name: '__t5_top', fill: { type: 'cmyk', c: 60, m: 0, y: 20, k: 0 } });
        const g = await call('group_objects', { uuids: [r1, r2], name: '__t5_usergroup' });
        assert(g.success === true, `group failed: ${brief(g)}`);
        groupUuid = g.uuid;
        const active = fixtureJsx('doc.activeLayer = doc.layers[doc.layers.length - 1]; return doc.activeLayer.name;');
        assert(active !== '__t5_top', 'active layer should not be the top layer');
        groupBounds = (await groupState()).mine.bounds;
      });

      await t('export_pdf japanese trim marks (single artboard) keeps user groups intact', async () => {
        const before = await groupState();
        const out = `${TMP}/t5-japanese.pdf`;
        const r = await call('export_pdf', { output_path: out, options: { trim_marks: true, marks_style: 'japanese' } });
        assert(r.success === true, `export_pdf failed: ${brief(r)}`);
        assert(existsSync(out), 'PDF should exist');
        const after = await groupState();
        assert(after.mine && after.mine.children.length === 2, `user group lost or changed: ${brief(after.mine)}`);
        assert(after.count === before.count, `group count changed ${before.count} → ${after.count} (temporary marks left or user group deleted)`);
      });

      await t('create_crop_marks does not delete or alter the user group on the top layer', async () => {
        const before = await groupState();
        const r = await call('create_crop_marks', { style: 'japanese' });
        assert(r.success === true, `create_crop_marks failed: ${brief(r)}`);
        assert(Array.isArray(r.original_artboard_rect) || typeof r.original_artboard_rect === 'object',
          `original_artboard_rect should be returned: ${brief(r)}`);
        const after = await groupState();
        assert(after.mine && after.mine.children.length === 2, `user group lost: ${brief(after.mine)}`);
        assertClose(after.mine.bounds.x, groupBounds.x, 'user group x');
        assertClose(after.mine.bounds.y, groupBounds.y, 'user group y');
        assert(after.count >= before.count + 1, `crop marks should add a group (${before.count} → ${after.count})`);
      });

      await t('export_pdf japanese marks on a multi-artboard doc → error, no file', async () => {
        fixtureJsx('var r = F_ab(); doc.artboards.add([r[2] + 200, r[1], r[2] + 400, r[1] - 200]); return doc.artboards.length;');
        const out = `${TMP}/t5-multi.pdf`;
        const r = await call('export_pdf', { output_path: out, options: { trim_marks: true, marks_style: 'japanese' } });
        assert(r.error === true && /multiple artboards/i.test(r.message), `should refuse: ${brief(r)}`);
        assert(!existsSync(out), 'no PDF should be written');
      });

      await t('export_pdf unknown preset → error listing available presets', async () => {
        const r = await call('export_pdf', { output_path: `${TMP}/t5-preset.pdf`, preset: '__no such preset__' });
        assert(r.error === true && /Available presets/.test(r.message), `should list presets: ${brief(r)}`);
      });
    });
  }

  // ═══════════════════════════════════════════════════════════
  // T6: preflight の偽陰性
  // ═══════════════════════════════════════════════════════════
  if (phaseEnabled(6)) {
    printPhase(6, 'T6 preflight (RGB text / gradient in CMYK, coverage)');
    const svgPath = `${TMP}/t6-rgb.svg`;
    writeFileSync(svgPath, `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120">
  <defs>
    <linearGradient id="g1" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ff0000"/>
      <stop offset="1" stop-color="#0000ff"/>
    </linearGradient>
  </defs>
  <rect x="10" y="10" width="120" height="40" fill="url(#g1)"/>
  <text x="10" y="90" font-family="Helvetica" font-size="20" fill="#00c000">RGB text</text>
</svg>
`, 'utf-8');

    await withDoc('T6a', { color_mode: 'cmyk' }, async () => {
      await t('preflight flags RGB text fill and RGB gradient stops (SVG imported into CMYK)', async () => {
        const imp = await call('import_svg_as_editable', { file_path: svgPath });
        assert(imp.success === true, `import failed: ${brief(imp)}`);
        const r = await call('preflight_check', {});
        const rgb = (r.results as Any[]).filter((x) => x.category === 'rgb_in_cmyk');
        assert(rgb.some((x) => x.details?.attribute === 'text_fill'), `RGB text fill not flagged: ${brief(rgb)}`);
        assert(rgb.some((x) => x.details?.colorType === 'gradient'), `RGB gradient stop not flagged: ${brief(rgb)}`);
        assert(r.coverage && r.coverage.rgb_in_cmyk?.status === 'checked', `coverage.rgb_in_cmyk should be checked: ${brief(r.coverage)}`);
        assert(r.categoryCounts && r.categoryCounts.rgb_in_cmyk >= 2, `categoryCounts: ${brief(r.categoryCounts)}`);
      });
    });

    await withDoc('T6b', { color_mode: 'cmyk' }, async () => {
      await t('preflight _note says incomplete when a check is only partial (x1a transparency)', async () => {
        await rect({ x: 100, y: 700, width: 100, height: 60, fill: { type: 'cmyk', c: 0, m: 0, y: 0, k: 50 } });
        const r = await call('preflight_check', { target_pdf_profile: 'x1a' });
        const bad = (r.results as Any[]).filter((x) => x.level === 'error' || x.level === 'warning');
        assert(bad.length === 0, `precondition: no errors/warnings expected: ${brief(bad)}`);
        assert(r.coverage?.transparency?.status === 'partial', `transparency should be partial under x1a: ${brief(r.coverage)}`);
        assert(typeof r._note === 'string' && /incomplete/.test(r._note) && /transparency/.test(r._note),
          `_note should say the checks were incomplete: ${J(r._note)}`);
      });
    });
  }

  // ═══════════════════════════════════════════════════════════
  // T7: export の対象範囲とパス
  // ═══════════════════════════════════════════════════════════
  if (phaseEnabled(7)) {
    printPhase(7, 'T7 export scope and output paths');
    await withDoc('T7', { color_mode: 'rgb' }, async () => {
      let a = '';
      await t('export target "selection" exports only the selection (image size)', async () => {
        a = await rect({ x: 50, y: 50, width: 100, height: 50, fill: { type: 'rgb', r: 255, g: 0, b: 0 } });
        await rect({ x: 400, y: 300, width: 200, height: 200, fill: { type: 'rgb', r: 0, g: 0, b: 255 } });
        await call('select_objects', { uuids: [a] });
        const out = `${TMP}/t7-selection.png`;
        const r = await call('export', { target: 'selection', format: 'png', output_path: out, raster_options: { dpi: 72 } });
        assert(r.success === true, `export failed: ${brief(r)}`);
        const dims = readImageDimensions(out);
        assert(dims !== null, 'image header unreadable');
        assertClose(dims!.width, 100, 'selection png width', 2);
        assertClose(dims!.height, 50, 'selection png height', 2);
      });

      await t('relative output paths are rejected (export / export_pdf / save_document)', async () => {
        const e1 = await call('export', { target: a, format: 'png', output_path: 'relative-out.png' });
        assert(e1.error === true && /absolute/.test(e1.message), `export should reject: ${brief(e1)}`);
        const e2 = await call('export_pdf', { output_path: 'relative-out.pdf' });
        assert(e2.error === true && /absolute/.test(e2.message), `export_pdf should reject: ${brief(e2)}`);
        const e3 = await call('save_document', { mode: 'save_as', path: 'relative-out.ai' });
        assert(e3.error === true && /absolute/.test(e3.message), `save_document should reject: ${brief(e3)}`);
        assert(!existsSync(resolve('relative-out.png')) && !existsSync(resolve('relative-out.pdf')), 'nothing written relative to cwd');
      });

      skip('export artboard:"all" partial failure → success: false / partial: true',
        'no reliable way to make a single artboard export fail on a healthy document');
    });
  }

  // ═══════════════════════════════════════════════════════════
  // T8 / T10: 印刷情報・トークン・コントラスト
  // ═══════════════════════════════════════════════════════════
  if (phaseEnabled(8)) {
    printPhase(8, 'T8/T10 overprint / separations / tokens / contrast');
    await withDoc('T8', { color_mode: 'cmyk' }, async () => {
      let textUuid = '';
      let strokeUuid = '';
      let cyanUuid = '';
      await t('get_overprint_info reports overprinting text and K100 stroke heuristics', async () => {
        const tf = await call('create_text_frame', { x: 60, y: 760, contents: 'Overprint text', font_size: 24, fill: { type: 'cmyk', c: 0, m: 0, y: 0, k: 100 } });
        textUuid = tf.uuid;
        strokeUuid = await rect({ x: 60, y: 650, width: 120, height: 60, fill: { type: 'none' }, stroke: { color: { type: 'cmyk', c: 0, m: 0, y: 0, k: 100 }, width: 4 } });
        cyanUuid = await rect({ x: 250, y: 650, width: 120, height: 60, fill: { type: 'cmyk', c: 100, m: 0, y: 0, k: 0 } });
        fixtureJsx(`
          F_item(${J(textUuid)}).textRange.characterAttributes.overprintFill = true;
          F_item(${J(strokeUuid)}).strokeOverprint = true;
          F_item(${J(cyanUuid)}).fillOverprint = true;
          return true;`);
        const r = await call('get_overprint_info', {});
        const list: Any[] = r.items ?? r.results ?? r.overprintItems ?? [];
        const byUuid = (u: string): Any => list.find((x) => x.uuid === u);
        assert(byUuid(textUuid)?.itemType === 'text' && byUuid(textUuid)?.heuristic === 'k100_overprint', `text overprint: ${brief(r)}`);
        assert(byUuid(strokeUuid)?.strokeKind === 'k100' && byUuid(strokeUuid)?.heuristic === 'k100_overprint', `K100 stroke: ${brief(byUuid(strokeUuid))}`);
        assert(byUuid(cyanUuid)?.heuristic === 'likely_accidental', `cyan fill overprint: ${brief(byUuid(cyanUuid))}`);
        assert(r.scope && typeof r.scope === 'object', 'scope should be reported');
      });

      await t('get_separation_info lists only used process plates and counts a spot used only by text', async () => {
        fixtureJsx(`
          var sp = doc.spots.add();
          sp.name = "__E2E Spot";
          sp.colorType = ColorModel.SPOT;
          sp.color = F_cmyk(0, 40, 100, 0);
          var sc = new SpotColor(); sc.spot = sp; sc.tint = 100;
          var tf = doc.activeLayer.textFrames.add();
          tf.contents = "Spot only text";
          tf.position = [F_ab()[0] + 60, F_ab()[1] - 300];
          tf.textRange.characterAttributes.fillColor = sc;
          return true;`);
        const r = await call('get_separation_info', {});
        const names = (r.separations as Any[]).map((s) => s.name);
        assert(names.includes('Cyan') && names.includes('Black'), `Cyan/Black should be listed: ${J(names)}`);
        assert(!names.includes('Magenta') && !names.includes('Yellow'), `unused Magenta/Yellow must not be listed: ${J(names)}`);
        const unused = (r.unusedInks as Any[]).map((s) => s.name);
        assert(unused.includes('Magenta') && unused.includes('Yellow'), `unusedInks: ${J(unused)}`);
        const spot = (r.separations as Any[]).find((s) => s.name === '__E2E Spot');
        assert(spot && spot.usageCount >= 1, `text-only spot should be counted: ${brief(r.separations)}`);
      });

      await t('extract_design_tokens: existing file is protected, overwrite works, json is parseable', async () => {
        const out = `${TMP}/t8-tokens.json`;
        writeFileSync(out, 'KEEP', 'utf-8');
        const refused = await client.callTool({ name: 'extract_design_tokens', arguments: { format: 'json', output_path: out } });
        assert(refused.isError === true, `should refuse to overwrite: ${brief(refused.content)}`);
        assert(readFileSync(out, 'utf-8') === 'KEEP', 'existing file must be untouched');
        const ok = await client.callTool({ name: 'extract_design_tokens', arguments: { format: 'json', output_path: out, overwrite: true } });
        assert(!ok.isError, `overwrite should succeed: ${brief(ok.content)}`);
        const first = (ok.content as Any[])[0].text;
        JSON.parse(first);
        JSON.parse(readFileSync(out, 'utf-8'));
        const rel = await client.callTool({ name: 'extract_design_tokens', arguments: { format: 'json', output_path: 'tokens-rel.json' } });
        assert(rel.isError === true, 'relative output_path should be rejected');
      });

      await t('check_contrast with CMYK colors → approximate: true, WCAG pass/fail null', async () => {
        const r = await call('check_contrast', {
          color1: { type: 'cmyk', c: 0, m: 0, y: 0, k: 100 },
          color2: { type: 'cmyk', c: 0, m: 0, y: 0, k: 0 },
        });
        const p = r.pairs?.[0] ?? r.results?.[0] ?? r;
        assert(p.approximate === true, `approximate should be true: ${brief(r)}`);
        assert(p.wcagAA_normal === null, `wcagAA_normal should be null: ${brief(r)}`);
      });
    });
  }

  // ═══════════════════════════════════════════════════════════
  // T9: 読み取り系
  // ═══════════════════════════════════════════════════════════
  if (phaseEnabled(9)) {
    printPhase(9, 'T9 read tools (text selection / text attrs / images / nesting)');
    await withDoc('T9', { color_mode: 'rgb' }, async () => {
      // スクリプトの select() は文字範囲でもフレームごとの選択になり（実機確認）、テキスト編集中の
      // TextRange 選択を作れない。挙動はユニットテスト（read-tools-jsx.test.ts）で担保する
      skip('get_selection while characters are selected returns the parent frame',
        'a text-editing (TextRange) selection cannot be created from a script');
      await t('get_text_frame_detail reports leading / autoLeading correctly', async () => {
        const fixed = await call('create_text_frame', { x: 50, y: 120, contents: 'Fixed leading', font_size: 12, leading: 30 });
        const auto = await call('create_text_frame', { x: 300, y: 120, contents: 'Auto leading', font_size: 12 });
        const f = await call('get_text_frame_detail', { uuid: fixed.uuid });
        assertClose(f.paragraphAttributes[0].leading, 30, 'fixed leading', 0.01);
        assert(f.paragraphAttributes[0].autoLeading === false, `autoLeading should be false: ${brief(f.paragraphAttributes[0])}`);
        const a = await call('get_text_frame_detail', { uuid: auto.uuid });
        assert(a.paragraphAttributes[0].autoLeading === true, `autoLeading should be true: ${brief(a.paragraphAttributes[0])}`);
      });

      await t('vertical text → orientation "vertical" (list_text_frames / get_text_frame_detail)', async () => {
        const uuid: string = fixtureJsx(`
          var ab = F_ab();
          var tf = doc.activeLayer.textFrames.pointText([ab[0] + 700, ab[1] - 50], TextOrientation.VERTICAL);
          tf.contents = "\\u7E26\\u7D44\\u307F";
          return ensureUUID(tf);`);
        const l = await call('list_text_frames', {});
        const item = (l.textFrames as Any[]).find((x) => x.uuid === uuid);
        assert(item?.orientation === 'vertical', `list_text_frames orientation: ${brief(item)}`);
        const d = await call('get_text_frame_detail', { uuid });
        assert(d.orientation === 'vertical', `get_text_frame_detail orientation: ${d.orientation}`);
      });

      await t('threaded frames → nextFrameUUID / previousFrameUUID', async () => {
        const ids = fixtureJsx(`
          var L = doc.activeLayer;
          var t1 = L.textFrames.areaText(F_rect(L, 400, 200, 120, 30));
          var t2 = L.textFrames.areaText(F_rect(L, 400, 260, 120, 30), TextOrientation.HORIZONTAL, t1);
          t1.contents = "This sentence is long enough to overflow the first small frame and continue into the second one.";
          return { first: ensureUUID(t1), second: ensureUUID(t2) };`);
        const l = await call('list_text_frames', {});
        const first = (l.textFrames as Any[]).find((x) => x.uuid === ids.first);
        const second = (l.textFrames as Any[]).find((x) => x.uuid === ids.second);
        assert(first?.nextFrameUUID === ids.second, `first.nextFrameUUID: ${brief(first)}`);
        assert(second?.previousFrameUUID === ids.first, `second.previousFrameUUID: ${brief(second)}`);
        const d = await call('get_text_frame_detail', { uuid: ids.first });
        assert(d.nextFrameUUID === ids.second, `detail nextFrameUUID: ${d.nextFrameUUID}`);
      });

      await t('get_images: rotated embedded raster keeps its pixel size', async () => {
        const p = await call('place_image', { file_path: PNG_100, x: 100, y: 300, embed: true });
        assert(typeof p.uuid === 'string', `place_image failed: ${brief(p)}`);
        const m = await call('modify_object', { uuid: p.uuid, properties: { rotation: 30 } });
        assert(m.success === true, `rotate failed: ${brief(m)}`);
        const r = await call('get_images', {});
        const img = (r.images as Any[]).find((x) => x.uuid === p.uuid);
        assert(img, `rotated image not listed: ${brief(r)}`);
        assertClose(img.pixelWidth, 100, 'pixelWidth', 1);
        assertClose(img.pixelHeight, 100, 'pixelHeight', 1);
      });

      await t('get_path_items layer_name includes paths inside groups', async () => {
        await call('manage_layers', { action: 'add', layer_name: '__t9_nest' });
        const a = await rect({ x: 500, y: 300, width: 30, height: 30, layer_name: '__t9_nest' });
        const b = await rect({ x: 540, y: 300, width: 30, height: 30, layer_name: '__t9_nest' });
        await call('group_objects', { uuids: [a, b] });
        const r = await call('get_path_items', { layer_name: '__t9_nest' });
        const got = (r.pathItems as Any[]).map((x) => x.uuid);
        assert(got.includes(a) && got.includes(b), `grouped paths missing: ${brief(r)}`);
      });

      await t('get_guidelines finds a guide inside a group', async () => {
        const before = (await call('get_guidelines', {})).totalCount;
        fixtureJsx(`
          var ab = F_ab();
          var g = doc.activeLayer.groupItems.add();
          g.name = "__t9_guide_group";
          F_rect(g, 600, 500, 20, 20);
          var p = g.pathItems.add();
          p.setEntirePath([[ab[0] + 10, ab[1] - 222], [ab[0] + 500, ab[1] - 222]]);
          p.guides = true;
          return true;`);
        const after = await call('get_guidelines', {});
        assert(after.totalCount === before + 1, `guide in group not found (${before} → ${after.totalCount}): ${brief(after)}`);
      });

      await t('get_groups: compound path children and truncation flags at the depth limit', async () => {
        fixtureJsx(`
          var cp = doc.activeLayer.compoundPathItems.add();
          cp.name = "__t9_cp";
          F_rect(cp, 600, 100, 60, 60);
          F_rect(cp, 615, 115, 30, 30);
          var outer = doc.activeLayer.groupItems.add(); outer.name = "__t9_outer";
          var inner = outer.groupItems.add(); inner.name = "__t9_inner";
          F_rect(inner, 700, 100, 20, 20);
          return true;`);
        const g = await call('get_groups', { depth: 1 });
        const cp = (g.groups as Any[]).find((x) => x.name === '__t9_cp');
        assert(cp && cp.children.length === 2, `compound path children: ${brief(cp)}`);
        const outer = (g.groups as Any[]).find((x) => x.name === '__t9_outer');
        const inner = outer?.children?.find((x: Any) => x.name === '__t9_inner');
        assert(inner && inner.childrenTruncated === true && inner.childCount === 1, `inner group should be truncated: ${brief(outer)}`);
        const s = await call('get_document_structure', { depth: 1 });
        assert(J(s).includes('"childrenTruncated":true'), 'get_document_structure should flag truncation at depth 1');
      });

      await t('broken link detection (linked image whose file was deleted)', async () => {
        const linkPath = `${TMP}/t9-link.png`;
        copyFileSync(PNG_100, linkPath);
        const p = await call('place_image', { file_path: linkPath, x: 300, y: 300 });
        assert(typeof p.uuid === 'string', `place_image failed: ${brief(p)}`);
        const ok = (await call('get_images', {})).images.find((x: Any) => x.uuid === p.uuid);
        assert(ok && ok.linkBroken === false, `link should be healthy first: ${brief(ok)}`);
        unlinkSync(linkPath);
        try {
          const r = await call('get_images', {});
          const img = (r.images as Any[]).find((x) => x.uuid === p.uuid);
          assert(img && img.linkBroken === true, `linkBroken should be true: ${brief(img)}`);
        } finally {
          // 欠落リンクを残すと Illustrator がアクティブ化時にダイアログを出しうるので、すぐ消す
          fixtureJsx(`F_item(${J(p.uuid)}).remove(); return true;`);
        }
      });
    });
  }

  // ═══════════════════════════════════════════════════════════
  // T11: 作成・配置系
  // ═══════════════════════════════════════════════════════════
  if (phaseEnabled(10)) {
    printPhase(10, 'T11 create / place tools');

    await withDoc('T11a', { color_mode: 'rgb' }, async () => {
      await t('place_image without x/y → verified bounds are artboard-relative', async () => {
        const p = await call('place_image', { file_path: PNG_100, embed: true });
        const b = p.verified?.bounds;
        assert(b && b.artboardRelative !== false, `bounds should be artboard-relative: ${brief(p)}`);
        assert(b.x >= 0 && b.x <= 800 && b.y >= 0 && b.y <= 600, `bounds should be inside the 800x600 artboard: ${brief(b)}`);
      });

      await t('color schema rejects out-of-range values (nothing created)', async () => {
        const before = (await allUuids()).length;
        const r = await call('create_rectangle', { x: 10, y: 10, width: 10, height: 10, fill: { type: 'rgb', r: 300, g: 0, b: 0 } });
        assert(r.error === true, `rgb 300 should be rejected: ${brief(r)}`);
        const c = await call('create_rectangle', { x: 10, y: 10, width: 10, height: 10, fill: { type: 'cmyk', c: 0, m: 0, y: 0, k: 120 } });
        assert(c.error === true, `cmyk k 120 should be rejected: ${brief(c)}`);
        assert((await allUuids()).length === before, 'nothing should be created');
      });

      await t('create_text_frame justification / leading are applied', async () => {
        const r = await call('create_text_frame', {
          x: 400, y: 200, contents: 'Right aligned\nsecond line', font_size: 14, leading: 22, justification: 'right',
        });
        const d = await call('get_text_frame_detail', { uuid: r.uuid });
        for (const p of d.paragraphAttributes as Any[]) {
          assert(p.justification === 'right', `justification: ${brief(p)}`);
          assertClose(p.leading, 22, 'leading', 0.01);
          assert(p.autoLeading === false, 'autoLeading should be false');
        }
        // 右揃えのポイント文字は x が右端になる
        assertClose(r.verified.bounds.x + r.verified.bounds.width, 400, 'right edge at x', 2);
      });
    });

    await withDoc('T11b', { color_mode: 'cmyk' }, async () => {
      await t('RGB color in a CMYK document → color-space warning', async () => {
        const r = await call('create_rectangle', { x: 50, y: 800, width: 40, height: 20, fill: { type: 'rgb', r: 0, g: 0, b: 0 } });
        assert((r.warnings ?? []).some((w: string) => /RGB|color mode|color space/i.test(w)), `should warn: ${brief(r)}`);
      });

      await t('import_svg_as_editable fit_to_artboard works in a CMYK (document-coords) doc and warns about RGB', async () => {
        const svg = `${TMP}/t11-square.svg`;
        writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 50 50"><rect x="0" y="0" width="50" height="50" fill="#ff0000"/></svg>', 'utf-8');
        const r = await call('import_svg_as_editable', { file_path: svg, fit_to_artboard: true });
        assert(r.success === true, `import failed: ${brief(r)}`);
        assertClose(r.widthPt, 595, 'fitted width', 2);
        assert((r.warnings ?? []).some((w: string) => /RGB/.test(w)), `should warn about RGB colors: ${brief(r)}`);
        const del = await call('delete_objects', { uuids: [r.rootUuid ?? r.items[0].uuid] });
        assert(del.success === true, 'cleanup delete failed');
      });

      await t('duplicate_objects offset sign is correct in document coords; group children get unique UUIDs', async () => {
        const src = await call('create_rectangle', { x: 100, y: 500, width: 50, height: 50, fill: { type: 'cmyk', c: 0, m: 0, y: 100, k: 0 } });
        const d = await call('duplicate_objects', { uuids: [src.uuid], offset: { x: 10, y: 20 } });
        assert(d.success === true && d.coordinateSystem === 'document', `duplicate failed: ${brief(d)}`);
        assertClose(d.items[0].verified.bounds.x, 110, 'dup x');
        assertClose(d.items[0].verified.bounds.y, 520, 'dup y (document coords: +y is up)');

        const a = await rect({ x: 300, y: 500, width: 30, height: 30 });
        const b = await rect({ x: 340, y: 500, width: 30, height: 30 });
        const g = await call('group_objects', { uuids: [a, b] });
        await call('get_groups', {});
        const dg = await call('duplicate_objects', { uuids: [g.uuid], offset: { x: 0, y: -100 } });
        assert(dg.success === true, `group duplicate failed: ${brief(dg)}`);
        const groups = (await call('get_groups', {})).groups as Any[];
        uniqueCheck(groupUuidsDeep(groups), 'groups after duplicate');
      });

      await t('place_style_guide: non-printing layer, nothing on the artboard unless annotate_artboard', async () => {
        await call('create_text_frame', { x: 100, y: 300, contents: 'Style guide text', font_size: 16 });
        const r = await call('place_style_guide', {});
        assert(r.success === true && r.nonPrintingLayer === true && r.artboardAnnotations === false, `place_style_guide: ${brief(r)}`);
        const printable = fixtureJsx(`return doc.layers.getByName(${J(r.layerName)}).printable;`);
        assert(printable === false, 'style guide layer should be non-printing');
        const ab = (await call('get_artboards', { coordinate_system: 'document' })).artboards[0];
        const abRect = [ab.position.x, ab.position.y, ab.position.x + ab.size.width, ab.position.y - ab.size.height];
        const onBoard = async (layer: string): Promise<number> => {
          const f = await call('find_objects', { layer_name: layer, coordinate_system: 'document' });
          return (f.objects as Any[]).filter((o) => rectsOverlap(abRect, [o.bounds.x, o.bounds.y, o.bounds.x + o.bounds.width, o.bounds.y - o.bounds.height])).length;
        };
        assert((await onBoard(r.layerName)) === 0, 'no style guide item should overlap the artboard');
        const r2 = await call('place_style_guide', { layer_name: '__t11_sg_annot', annotate_artboard: true });
        assert(r2.success === true && r2.artboardAnnotations === true, `annotate run: ${brief(r2)}`);
        assert((await onBoard('__t11_sg_annot')) > 0, 'annotate_artboard should draw on the artboard');
      });
    });
  }

  // ═══════════════════════════════════════════════════════════
  // T14: 色の適用・置換・集計
  // ═══════════════════════════════════════════════════════════
  if (phaseEnabled(11)) {
    printPhase(11, 'T14 group fill / replace_color / get_colors / select_objects');
    await withDoc('T14', { color_mode: 'rgb' }, async () => {
      await t('modify_object fill on a group recolors all descendants', async () => {
        const a = await rect({ x: 10, y: 10, width: 30, height: 30, fill: { type: 'rgb', r: 255, g: 255, b: 0 } });
        const b = await rect({ x: 50, y: 10, width: 30, height: 30, fill: { type: 'rgb', r: 0, g: 255, b: 255 } });
        const c = await rect({ x: 90, y: 10, width: 30, height: 30, fill: { type: 'rgb', r: 255, g: 0, b: 255 } });
        const inner = await call('group_objects', { uuids: [b, c] });
        const g = await call('group_objects', { uuids: [a, inner.uuid] });
        const m = await call('modify_object', { uuid: g.uuid, properties: { fill: { type: 'rgb', r: 0, g: 128, b: 0 } } });
        assert(m.success === true, `modify_object failed: ${brief(m)}`);
        assert(m.verified?.descendantCount === 3, `descendantCount: ${brief(m.verified)}`);
        const f = await call('find_objects', { fill_color: { type: 'rgb', r: 0, g: 128, b: 0, tolerance: 0 } });
        const got = (f.objects as Any[]).map((o) => o.uuid);
        assert([a, b, c].every((u) => got.includes(u)), `all 3 descendants should be green: ${brief(f)}`);
      });

      await t('replace_color RGB → CMYK replaces path and text colors', async () => {
        const r1 = await rect({ x: 10, y: 100, width: 30, height: 30, fill: { type: 'rgb', r: 255, g: 0, b: 0 } });
        const tf = await call('create_text_frame', { x: 10, y: 200, contents: 'Red text', font_size: 18, fill: { type: 'rgb', r: 255, g: 0, b: 0 } });
        const r = await call('replace_color', {
          from_color: { type: 'rgb', r: 255, g: 0, b: 0 },
          to_color: { type: 'cmyk', c: 0, m: 100, y: 100, k: 0 },
          tolerance: 0,
        });
        assert(r.success === true && r.replacedCount >= 1 && r.textFramesChanged === 1, `replace_color: ${brief(r)}`);
        const again = await call('replace_color', {
          from_color: { type: 'rgb', r: 255, g: 0, b: 0 },
          to_color: { type: 'rgb', r: 0, g: 0, b: 0 },
          tolerance: 0,
        });
        assert(again.replacedCount === 0 && again.textFramesChanged === 0, `pure red should be gone (incl. text): ${brief(again)}`);
        void r1; void tf;
      });

      await t('get_colors dedupes used colors with counts', async () => {
        for (let i = 0; i < 3; i++) {
          await rect({ x: 200 + i * 40, y: 300, width: 30, height: 30, fill: { type: 'rgb', r: 12, g: 34, b: 56 } });
        }
        const r = await call('get_colors', {});
        const matches = (r.usedFillColors as Any[]).filter((e) => {
          const col = e.color ?? e;
          return col.r === 12 && col.g === 34 && col.b === 56;
        });
        assert(matches.length === 1, `color should appear once: ${brief(r.usedFillColors)}`);
        assert(matches[0].count === 3, `count should be 3: ${brief(matches[0])}`);
      });

      await t('select_objects returns only the UUID for an object with a user memo', async () => {
        fixtureJsx(`
          var r = F_rect(doc.activeLayer, 400, 400, 30, 30);
          r.name = "__t14_memo";
          r.note = "memo for the printer";
          return true;`);
        const uuid = (await findOne('__t14_memo')).uuid;
        const s = await call('select_objects', { uuids: [uuid] });
        const got = s.verified?.selection?.[0]?.uuid;
        assert(got === uuid && got.length === 36, `selection uuid should be the bare UUID: ${J(got)}`);
      });
    });
  }

  // ═══════════════════════════════════════════════════════════
  // 構造化エラー（JsxToolError）
  // ═══════════════════════════════════════════════════════════
  if (phaseEnabled(12)) {
    printPhase(12, 'Structured error results');
    await withDoc('ERR', { color_mode: 'rgb' }, async () => {
      await t('create_text_frame unknown font → error with font_candidates, nothing created', async () => {
        const before = (await allUuids()).length;
        const r = await call('create_text_frame', { x: 10, y: 10, contents: 'x', font_name: 'NoSuchFont-E2E' });
        assert(r.error === true && Array.isArray(r.font_candidates), `font_candidates missing: ${brief(r)}`);
        assert((await allUuids()).length === before, 'nothing should be created');
      });

      await t('modify_object unknown font → error with font_candidates, other properties untouched', async () => {
        const tf = await call('create_text_frame', { x: 10, y: 100, contents: 'Keep size', font_size: 12 });
        const r = await call('modify_object', { uuid: tf.uuid, properties: { font_name: 'NoSuchFont-E2E', font_size: 40 } });
        assert(r.error === true && Array.isArray(r.font_candidates), `font_candidates missing: ${brief(r)}`);
        const d = await call('get_text_frame_detail', { uuid: tf.uuid });
        assertClose(d.characterRuns[0].fontSize ?? d.characterRuns[0].size, 12, 'font size should be unchanged', 0.01);
      });

      await t('export onto an existing file → error with existing_files, file untouched', async () => {
        const target = await rect({ x: 10, y: 200, width: 20, height: 20 });
        const out = `${TMP}/err-existing.png`;
        writeFileSync(out, 'KEEP', 'utf-8');
        const r = await call('export', { target, format: 'png', output_path: out });
        assert(r.error === true && Array.isArray(r.existing_files) && r.existing_files.length === 1, `existing_files missing: ${brief(r)}`);
        assert(readFileSync(out, 'utf-8') === 'KEEP', 'existing file must be untouched');
      });

      await t('save_document save_as onto an existing file → error with fileExists', async () => {
        const out = `${TMP}/err-existing.ai`;
        writeFileSync(out, 'KEEP', 'utf-8');
        const r = await call('save_document', { mode: 'save_as', path: out });
        assert(r.error === true && r.fileExists === true, `fileExists missing: ${brief(r)}`);
        assert(readFileSync(out, 'utf-8') === 'KEEP', 'existing file must be untouched');
      });

      await t('close_document without save on a modified doc → error with unsavedChanges, doc stays open', async () => {
        const r = await call('close_document', {});
        assert(r.error === true && r.unsavedChanges === true, `unsavedChanges missing: ${brief(r)}`);
        const info = await call('get_document_info');
        assert(info.fileName === currentDocName, 'document should still be open');
      });
    });
  }
}

main();
