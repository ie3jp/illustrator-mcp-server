/**
 * 作成・配置系ツール（修正計画 T11）の JSX ロジックを Node 上で検証する。
 * executeJsx をモックして各ツールが渡す JSX を捕まえ、fake-illustrator で実行する。
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/executor/jsx-runner.js', () => ({
  executeJsx: vi.fn().mockResolvedValue({}),
  executeJsxHeavy: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../src/tools/session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/tools/session.js')>();
  return {
    ...actual,
    // CMYK 文書の自動判定（document）を模す
    resolveCoordinateSystem: vi.fn(async (explicit?: string) => explicit ?? 'document'),
  };
});

import { executeJsx, executeJsxHeavy } from '../../src/executor/jsx-runner.js';
import { register as registerCreateRectangle } from '../../src/tools/modify/create-rectangle.js';
import { register as registerCreateTextFrame } from '../../src/tools/modify/create-text-frame.js';
import { register as registerCreatePathText } from '../../src/tools/modify/create-path-text.js';
import { register as registerCreateGradient } from '../../src/tools/modify/create-gradient.js';
import { register as registerDuplicateObjects } from '../../src/tools/modify/duplicate-objects.js';
import { register as registerPlaceSymbol } from '../../src/tools/modify/place-symbol.js';
import { register as registerPlaceImage } from '../../src/tools/modify/place-image.js';
import { register as registerImportSvg } from '../../src/tools/modify/import-svg-as-editable.js';
import { register as registerPlaceColorChips } from '../../src/tools/modify/place-color-chips.js';
import { register as registerPlaceStyleGuide } from '../../src/tools/modify/place-style-guide.js';
import { colorSchema } from '../../src/tools/modify/shared.js';
import { captureInputSchema } from './helpers/tool-schema.js';
import {
  type Fake,
  makeApp,
  makeDoc,
  makeGroup,
  makeItem,
  makeLayer,
  makeTextFrame,
  runToolJsx,
} from './helpers/fake-illustrator.js';

type ToolHandler = (params: Record<string, unknown>) => Promise<unknown>;

function captureToolHandler(register: (server: McpServer) => void): ToolHandler {
  let handler: ToolHandler | undefined;
  const server = {
    registerTool: vi.fn((_n: string, _c: unknown, h: ToolHandler) => {
      handler = h;
    }),
  } as unknown as McpServer;
  register(server);
  if (!handler) throw new Error('Tool handler was not registered');
  return handler;
}

const mockExecuteJsx = vi.mocked(executeJsx);
const mockExecuteJsxHeavy = vi.mocked(executeJsxHeavy);

/** ハンドラを呼んで、executeJsx / executeJsxHeavy に渡された JSX と params を返す */
async function captureCall(register: (server: McpServer) => void, params: Record<string, unknown>) {
  mockExecuteJsx.mockClear();
  mockExecuteJsxHeavy.mockClear();
  await captureToolHandler(register)(params);
  const call = mockExecuteJsx.mock.calls[0] ?? mockExecuteJsxHeavy.mock.calls[0];
  if (!call) throw new Error('executeJsx was not called');
  return {
    jsx: call[0] as string,
    params: call[1] as Record<string, unknown>,
    heavy: mockExecuteJsxHeavy.mock.calls.length > 0,
  };
}

/** register → JSX 捕捉 → fake app 上で実行 */
async function runTool(
  register: (server: McpServer) => void,
  params: Record<string, unknown>,
  app: ReturnType<typeof makeApp>,
) {
  const { jsx, params: resolved } = await captureCall(register, params);
  return runToolJsx(jsx, resolved, app);
}

const UUID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UUID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const UUID_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const UUID_MISSING = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── shared.ts: 色 ───────────────────────────────────────────────

describe('color schema ranges (T11-6)', () => {
  it('rejects out-of-range RGB / CMYK components', () => {
    expect(colorSchema.safeParse({ type: 'rgb', r: -1, g: 0, b: 0 }).success).toBe(false);
    expect(colorSchema.safeParse({ type: 'rgb', r: 0, g: 0, b: 256 }).success).toBe(false);
    expect(colorSchema.safeParse({ type: 'cmyk', c: 0, m: 0, y: 0, k: 101 }).success).toBe(false);
    expect(colorSchema.safeParse({ type: 'cmyk', c: -5, m: 0, y: 0, k: 0 }).success).toBe(false);
  });

  it('accepts boundary values', () => {
    expect(colorSchema.safeParse({ type: 'rgb', r: 0, g: 128, b: 255 }).success).toBe(true);
    expect(colorSchema.safeParse({ type: 'cmyk', c: 0, m: 0, y: 0, k: 100 }).success).toBe(true);
  });
});

describe('createColor color-mode mismatch (T11-7)', () => {
  it('warns when an RGB color is given to a CMYK document', async () => {
    const doc = makeDoc({ colorSpace: 'cmyk' });
    const r = await runTool(registerCreateRectangle, {
      x: 0, y: 0, width: 10, height: 10, fill: { type: 'rgb', r: 0, g: 0, b: 0 },
    }, makeApp(doc));
    expect(r.uuid).toBeTruthy();
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('rgb(0,0,0)');
    expect(r.warnings[0]).toContain('CMYK document');
  });

  it('does not warn when the color matches the document mode', async () => {
    const doc = makeDoc({ colorSpace: 'cmyk' });
    const r = await runTool(registerCreateRectangle, {
      x: 0, y: 0, width: 10, height: 10, fill: { type: 'cmyk', c: 0, m: 0, y: 0, k: 100 },
    }, makeApp(doc));
    expect(r.warnings).toBeUndefined();
  });
});

// ─── create_text_frame / create_path_text ───────────────────────

describe('create_text_frame (T11-5, B, C)', () => {
  it('returns an error and creates nothing when the font is not found', async () => {
    const doc = makeDoc();
    const layer = doc.layers[0];
    const r = await runTool(registerCreateTextFrame, {
      x: 0, y: 0, contents: 'Hello', font_name: 'Helvetica',
    }, makeApp(doc, [{ name: 'Helvetica-Bold', family: 'Helvetica' }]));
    expect(r.error).toBe(true);
    expect(r.uuid).toBeUndefined();
    expect(r.message).toContain('not found');
    expect(r.font_candidates).toEqual([{ name: 'Helvetica-Bold', family: 'Helvetica' }]);
    expect(layer.pageItems).toHaveLength(0);
  });

  it('applies an exact font, justification and fixed leading', async () => {
    const doc = makeDoc();
    const r = await runTool(registerCreateTextFrame, {
      x: 0, y: 0, contents: 'A\nB', font_name: 'Helvetica-Bold', justification: 'right', leading: 14,
    }, makeApp(doc, [{ name: 'Helvetica-Bold', family: 'Helvetica' }]));
    expect(r.error).toBeUndefined();
    const tf = doc.layers[0].pageItems[0];
    expect(tf.textRange.characterAttributes.textFont.name).toBe('Helvetica-Bold');
    expect(tf.textRange.paragraphAttributes.justification).toBe('RIGHT');
    expect(tf.textRange.characterAttributes.autoLeading).toBe(false);
    expect(tf.textRange.characterAttributes.leading).toBe(14);
  });

  it('leaves auto leading alone when leading is omitted', async () => {
    const doc = makeDoc();
    await runTool(registerCreateTextFrame, { x: 0, y: 0, contents: 'A' }, makeApp(doc));
    const tf = doc.layers[0].pageItems[0];
    expect(tf.textRange.characterAttributes.autoLeading).toBe(true);
    expect(tf.textRange.paragraphAttributes.justification).toBeUndefined();
  });

  it('schema: justification enum, positive leading, baseline wording', () => {
    const schema = captureInputSchema(registerCreateTextFrame);
    const base = { x: 0, y: 0, contents: 'x' };
    expect(schema.safeParse({ ...base, justification: 'justify_left', leading: 12 }).success).toBe(true);
    expect(schema.safeParse({ ...base, justification: 'middle' }).success).toBe(false);
    expect(schema.safeParse({ ...base, leading: 0 }).success).toBe(false);
    expect(schema.shape.y.description).toContain('BASELINE');
  });
});

describe('create_path_text (T11-5, C)', () => {
  it('returns an error before creating anything when the font is not found', async () => {
    const doc = makeDoc();
    const layer = doc.layers[0];
    const path = layer.addItem(makeItem('PathItem', { note: UUID_A }));
    const r = await runTool(registerCreatePathText, {
      path_uuid: UUID_A, contents: 'Hi', font_name: 'NoSuchFont',
    }, makeApp(doc));
    expect(r.error).toBe(true);
    expect(r.font_candidates).toEqual([]);
    expect(layer.pageItems).toEqual([path]);
  });

  it('resolves the coordinate system and applies justification', async () => {
    const { params } = await captureCall(registerCreatePathText, { path_uuid: UUID_A, contents: 'Hi' });
    expect(params.coordinate_system).toBe('document');

    const doc = makeDoc();
    doc.layers[0].addItem(makeItem('PathItem', { note: UUID_A }));
    const r = await runTool(registerCreatePathText, {
      path_uuid: UUID_A, contents: 'Hi', justification: 'center',
    }, makeApp(doc));
    expect(r.success).toBe(true);
    const tf = doc.layers[0].pageItems[1];
    expect(tf.textRange.paragraphAttributes.justification).toBe('CENTER');
  });
});

// ─── create_gradient ───────────────────────────────────────────

describe('create_gradient (A)', () => {
  const stops = [
    { color: { type: 'rgb', r: 255, g: 0, b: 0 }, position: 0 },
    { color: { type: 'rgb', r: 0, g: 0, b: 255 }, position: 100 },
  ];

  it('reports verified bounds relative to the artboard and lists missing UUIDs', async () => {
    const doc = makeDoc({ artboardRect: [100, 1000, 600, 0] });
    doc.layers[0].addItem(makeItem('PathItem', { note: UUID_A, geometricBounds: [110, 990, 160, 940] }));
    const r = await runTool(registerCreateGradient, {
      name: 'g', stops, apply_to_uuids: [UUID_A, UUID_MISSING], coordinate_system: 'artboard-web',
    }, makeApp(doc));
    expect(r.coordinateSystem).toBe('artboard-web');
    expect(r.verified[0].bounds).toMatchObject({ x: 10, y: 10, width: 50, height: 50 });
    expect(r.verified[0].bounds.artboardRelative).toBeUndefined();
    expect(r.appliedCount).toBe(1);
    expect(r.notFound).toEqual([UUID_MISSING]);
    expect(r.success).toBe(false);
  });

  it('resolves the coordinate system when omitted', async () => {
    const { params } = await captureCall(registerCreateGradient, { name: 'g', stops });
    expect(params.coordinate_system).toBe('document');
  });
});

// ─── duplicate_objects ─────────────────────────────────────────

describe('duplicate_objects (T11-3, T11-9, E)', () => {
  function cloneTree(item: Fake): Fake {
    if (item.typename === 'GroupItem') {
      return makeGroup(item.pageItems.map(cloneTree), { note: item.note });
    }
    return makeItem(item.typename, { note: item.note, geometricBounds: [...item.geometricBounds] });
  }

  function makeDuplicable(item: Fake, layer: Fake) {
    item.duplicate = () => layer.addItem(cloneTree(item));
    return item;
  }

  it('gives the copy and its tagged descendants new UUIDs, keeping memos', async () => {
    const doc = makeDoc();
    const layer = doc.layers[0];
    const child1 = makeItem('PathItem', { note: `${UUID_B} designer memo` });
    const child2 = makeItem('PathItem', { note: 'plain memo without uuid' });
    const group = makeDuplicable(makeGroup([child1, child2], { note: UUID_A }), layer);
    layer.addItem(group);

    const r = await runTool(registerDuplicateObjects, { uuids: [UUID_A] }, makeApp(doc));
    expect(r.success).toBe(true);
    const copy = layer.pageItems[1];
    expect(copy.note).not.toBe(UUID_A);
    expect(copy.note.slice(0, 36)).toBe(r.items[0].newUuid);
    expect(copy.pageItems[0].note).not.toContain(UUID_B);
    expect(copy.pageItems[0].note.endsWith(' designer memo')).toBe(true);
    expect(copy.pageItems[1].note).toBe('plain memo without uuid');
    // 元は変わらない
    expect(group.note).toBe(UUID_A);
    expect(child1.note).toBe(`${UUID_B} designer memo`);
  });

  it('keeps successful copies and reports failures and missing UUIDs', async () => {
    const doc = makeDoc();
    const layer = doc.layers[0];
    layer.addItem(makeDuplicable(makeItem('PathItem', { note: UUID_A }), layer));
    const broken = makeItem('PathItem', { note: UUID_C });
    broken.duplicate = () => {
      throw new Error('boom');
    };
    layer.addItem(broken);

    const r = await runTool(registerDuplicateObjects, { uuids: [UUID_A, UUID_C, UUID_MISSING] }, makeApp(doc));
    expect(r.success).toBe(false);
    expect(r.duplicatedCount).toBe(1);
    expect(r.items[0].sourceUuid).toBe(UUID_A);
    expect(r.failed).toEqual([{ sourceUuid: UUID_C, message: 'boom' }]);
    expect(r.notFound).toEqual([UUID_MISSING]);
  });

  it('resolves the coordinate system and offsets Y-up in document coordinates', async () => {
    const { params } = await captureCall(registerDuplicateObjects, { uuids: [UUID_A], offset: { x: 5, y: 7 } });
    expect(params.coordinate_system).toBe('document');

    const doc = makeDoc();
    const layer = doc.layers[0];
    layer.addItem(makeDuplicable(makeItem('PathItem', { note: UUID_A }), layer));
    await runTool(registerDuplicateObjects, { uuids: [UUID_A], offset: { x: 5, y: 7 } }, makeApp(doc));
    expect(layer.pageItems[1].translated).toEqual([[5, 7]]);
  });
});

// ─── place_symbol ─────────────────────────────────────────────

describe('place_symbol (T11-3)', () => {
  it('resolves the coordinate system instead of falling back to artboard-web', async () => {
    const { params } = await captureCall(registerPlaceSymbol, { action: 'place', symbol_name: 's', x: 1, y: 2 });
    expect(params.coordinate_system).toBe('document');
  });

  it('places at document coordinates without artboard offset', async () => {
    const doc = makeDoc({ artboardRect: [100, 1000, 600, 0] });
    doc.symbols.push({ name: 's' });
    const r = await runTool(registerPlaceSymbol, {
      action: 'place', symbol_name: 's', x: 1, y: 2, coordinate_system: 'document',
    }, makeApp(doc));
    expect(r.success).toBe(true);
    expect(doc.layers[0].pageItems[0].position).toEqual([1, 2]);
  });
});

// ─── place_image ──────────────────────────────────────────────

describe('place_image (T11-4, T11-10)', () => {
  it('reports artboard-relative bounds even when x/y are omitted', async () => {
    const doc = makeDoc({ artboardRect: [100, 1000, 600, 0] });
    const layer = doc.layers[0];
    layer.placedItems.add = () => layer.addItem(makeItem('PlacedItem', { geometricBounds: [150, 900, 250, 800] }));
    const r = await runTool(registerPlaceImage, {
      file_path: '/tmp/a.png', coordinate_system: 'artboard-web',
    }, makeApp(doc));
    expect(r.verified.bounds).toMatchObject({ x: 50, y: 100, width: 100, height: 100 });
    expect(r.verified.bounds.artboardRelative).toBeUndefined();
  });

  it('runs with the heavy timeout', async () => {
    const { heavy } = await captureCall(registerPlaceImage, { file_path: '/tmp/a.png' });
    expect(heavy).toBe(true);
  });
});

// ─── import_svg_as_editable ───────────────────────────────────

describe('import_svg_as_editable (T11-2, T11-10, D)', () => {
  function setupSvgImport(colorSpace: 'rgb' | 'cmyk') {
    const doc = makeDoc({ colorSpace, artboardRect: [0, 1000, 500, 0] });
    const layer = doc.layers[0];
    const rgb = (r: number) => ({ typename: 'RGBColor', red: r, green: 0, blue: 0 });
    const src = [
      makeItem('PathItem', { filled: true, fillColor: rgb(255), stroked: true, strokeColor: rgb(10), geometricBounds: [0, 100, 50, 50] }),
      makeItem('PathItem', { filled: true, fillColor: { typename: 'CMYKColor' }, geometricBounds: [60, 100, 100, 60] }),
    ];
    for (const s of src) {
      s.duplicate = (target: Fake) => target.addItem(makeItem(s.typename, {
        filled: s.filled, fillColor: s.fillColor, stroked: s.stroked, strokeColor: s.strokeColor,
        geometricBounds: [...s.geometricBounds],
      }));
    }
    const app = makeApp(doc);
    app.open = () => ({ pageItems: src, close: () => {} });
    return { doc, layer, app };
  }

  it('fits to the artboard in document coordinates too', async () => {
    const { layer, app } = setupSvgImport('rgb');
    const r = await runTool(registerImportSvg, {
      file_path: '/tmp/a.svg', fit_to_artboard: true, coordinate_system: 'document',
    }, app);
    expect(r.success).toBe(true);
    const root = layer.pageItems[0];
    expect(root.typename).toBe('GroupItem');
    expect(root.resized.length).toBe(1);
    expect(r.warnings).toBeUndefined();
  });

  it('warns with the RGB color count when importing into a CMYK document', async () => {
    const { app } = setupSvgImport('cmyk');
    const r = await runTool(registerImportSvg, { file_path: '/tmp/a.svg' }, app);
    expect(r.success).toBe(true);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('2 RGB');
    expect(r.warnings[0]).toContain('replace_color');
  });

  it('runs with the heavy timeout', async () => {
    const { heavy } = await captureCall(registerImportSvg, { file_path: '/tmp/a.svg' });
    expect(heavy).toBe(true);
  });
});

// ─── place_color_chips / place_style_guide ────────────────────

function textWithColor(color: Fake) {
  const tf = makeTextFrame();
  tf.textRange.characterAttributes.fillColor = color;
  return tf;
}

describe('place_color_chips (T11-8)', () => {
  it('collects text colors, gradient stops and spot tints, skipping patterns and the chip layer', async () => {
    const art = makeLayer('Art');
    const chips = makeLayer('Color Chips');
    const doc = makeDoc({ layers: [art, chips] });
    const spot = { name: 'PANTONE 185 C', color: { typename: 'CMYKColor', cyan: 0, magenta: 90, yellow: 80, black: 0 } };
    const cmyk = (k: number) => ({ typename: 'CMYKColor', cyan: 0, magenta: 0, yellow: 0, black: k });
    art.addItem(makeItem('PathItem', { filled: true, fillColor: { typename: 'SpotColor', spot, tint: 100 } }));
    art.addItem(makeItem('PathItem', { filled: true, fillColor: { typename: 'SpotColor', spot, tint: 50 } }));
    art.addItem(makeItem('PathItem', {
      filled: true,
      fillColor: {
        typename: 'GradientColor',
        gradient: { name: 'g', type: 'LINEAR', gradientStops: [{ color: cmyk(20) }, { color: cmyk(40) }] },
      },
    }));
    art.addItem(makeItem('PathItem', { filled: true, fillColor: { typename: 'PatternColor', pattern: { name: 'p' } } }));
    art.addItem(textWithColor(cmyk(100)));
    // 前回実行時のチップ（除外される）
    chips.addItem(makeItem('PathItem', { filled: true, fillColor: cmyk(55) }));

    const r = await runTool(registerPlaceColorChips, { include_info: true }, makeApp(doc));
    expect(r.success).toBe(true);
    // spot 100% / spot 50% / K20 / K40 / K100
    expect(r.chipCount).toBe(5);
    expect(r.skippedColors).toEqual({ PatternColor: 1 });
    const labels = chips.pageItems.filter((i: Fake) => i.typename === 'TextFrame').map((t: Fake) => t.contents);
    expect(labels).toContain('PANTONE 185 C');
    expect(labels).toContain('PANTONE 185 C 50%');
    expect(labels).not.toContain('C0 M0 Y0 K55');
  });
});

describe('place_style_guide (T11-1)', () => {
  function docWithRepeatedGaps() {
    const art = makeLayer('Art');
    const doc = makeDoc({ layers: [art], artboardRect: [0, 1000, 500, 0] });
    // 横に 10pt 間隔で 3 つ並べる（同じ間隔が 2 回 → 注釈対象）
    for (const left of [100, 120, 140]) {
      art.addItem(makeItem('PathItem', {
        filled: true,
        fillColor: { typename: 'CMYKColor', cyan: 0, magenta: 0, yellow: 0, black: 100 },
        geometricBounds: [left, 500, left + 10, 490],
      }));
    }
    doc.layers.add = () => {
      const l = makeLayer('');
      l.parent = doc;
      doc.layers.push(l);
      return l;
    };
    return doc;
  }

  function annotationBars(layer: Fake): Fake[] {
    const out: Fake[] = [];
    const walk = (c: Fake) => {
      for (const i of c.pageItems) {
        if (i.typename === 'GroupItem') walk(i);
        else if (i.typename === 'PathItem' && i.opacity < 100) out.push(i);
      }
    };
    walk(layer);
    return out;
  }

  it('creates a non-printing layer and draws nothing on the artboard by default', async () => {
    const doc = docWithRepeatedGaps();
    const r = await runTool(registerPlaceStyleGuide, {}, makeApp(doc));
    expect(r.success).toBe(true);
    const guide = doc.layers.find((l: Fake) => l.name === 'Style Guide');
    expect(guide.printable).toBe(false);
    expect(r.nonPrintingLayer).toBe(true);
    expect(r.artboardAnnotations).toBe(false);
    expect(r.sections.horizontalSpacings).toBe(1);
    expect(annotationBars(guide)).toHaveLength(0);
    expect(r.warnings).toBeUndefined();
  });

  it('draws on-artboard bars only when annotate_artboard is true', async () => {
    const doc = docWithRepeatedGaps();
    await runTool(registerPlaceStyleGuide, { annotate_artboard: true }, makeApp(doc));
    const guide = doc.layers.find((l: Fake) => l.name === 'Style Guide');
    expect(annotationBars(guide).length).toBeGreaterThan(0);
  });

  it('keeps an existing printable layer as is and warns', async () => {
    const doc = docWithRepeatedGaps();
    const existing = makeLayer('Style Guide');
    existing.parent = doc;
    doc.layers.push(existing);
    const r = await runTool(registerPlaceStyleGuide, {}, makeApp(doc));
    expect(existing.printable).toBe(true);
    expect(r.nonPrintingLayer).toBe(false);
    expect(r.warnings[0]).toContain('printable');
  });
});
