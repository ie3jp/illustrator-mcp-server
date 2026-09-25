/**
 * get_overprint_info / get_separation_info の埋め込み JSX を偽の Document で実行し、
 * 走査範囲（テキスト・ラスタ・サブレイヤー・グラデーション）と判定ロジックを検証する。
 */
import { describe, it, expect } from 'vitest';
import { runToolJsx } from './helpers/run-tool-jsx.js';

// --- Illustrator 列挙定数のモック ---
const ENUMS = {
  DocumentColorSpace: { CMYK: 'DCS_CMYK', RGB: 'DCS_RGB' },
  ColorModel: { PROCESS: 'CM_PROCESS', REGISTRATION: 'CM_REG', SPOT: 'CM_SPOT' },
  SpotColorKind: { SpotCMYK: 'SK_CMYK', SpotRGB: 'SK_RGB', SpotLAB: 'SK_LAB' },
  ImageColorSpace: {
    CMYK: 'ICS_CMYK', DeviceN: 'ICS_DEVICEN', Grayscale: 'ICS_GRAY', Indexed: 'ICS_INDEXED',
    LAB: 'ICS_LAB', RGB: 'ICS_RGB', Separation: 'ICS_SEP',
  },
  InkType: { CYANINK: 'IT_C', MAGENTAINK: 'IT_M', YELLOWINK: 'IT_Y', BLACKINK: 'IT_K', CUSTOMINK: 'IT_CUSTOM' },
  InkPrintStatus: { ENABLEINK: 'IPS_EN', DISABLEINK: 'IPS_DIS', CONVERTINK: 'IPS_CONV' },
};

type Obj = Record<string, unknown>;

const cmyk = (c: number, m: number, y: number, k: number): Obj => ({
  typename: 'CMYKColor', cyan: c, magenta: m, yellow: y, black: k,
});
const NO_COLOR: Obj = { typename: 'NoColor' };
const spot = (name: string, colorType: string, color: Obj = cmyk(0, 100, 0, 0)): Obj => ({
  name, colorType, color, spotKind: 'SK_CMYK',
});
const spotColor = (s: Obj, tint = 100): Obj => ({ typename: 'SpotColor', spot: s, tint });
const gradient = (...colors: Obj[]): Obj => ({
  typename: 'GradientColor',
  gradient: {
    name: 'g', type: 'linear',
    gradientStops: colors.map((color, i) => ({ color, midPoint: 50, rampPoint: i * 100 })),
  },
});

function path(props: Obj): Obj {
  return {
    typename: 'PathItem', name: '', note: '', hidden: false,
    filled: false, stroked: false, fillOverprint: false, strokeOverprint: false,
    ...props,
  };
}

function text(ranges: Obj[]): Obj {
  return {
    typename: 'TextFrame', name: '', note: '', hidden: false,
    textRanges: ranges.map((ca) => ({ length: (ca.length as number) ?? 1, characterAttributes: ca })),
  };
}

function layer(name: string, items: Obj[], subLayers: Obj[] = [], visible = true): Obj {
  const l: Obj = { typename: 'Layer', name, visible, pageItems: items, layers: subLayers };
  for (const it of items) it.parent = l;
  return l;
}

function makeDoc(layers: Obj[], extra: Obj = {}): Obj {
  const doc: Obj = {
    typename: 'Document',
    documentColorSpace: 'DCS_CMYK',
    layers,
    spots: [],
    ...extra,
  };
  const setParent = (ls: Obj[], parent: Obj) => {
    for (const l of ls) {
      l.parent = parent;
      setParent(l.layers as Obj[], l);
    }
  };
  setParent(layers, doc);
  return doc;
}

function run(tool: string, doc: Obj): Obj {
  return runToolJsx(tool, { ...ENUMS, app: { activeDocument: doc } });
}

type OverprintItem = Obj & { heuristic: string; itemType: string };

describe('get_overprint_info', () => {
  const TOOL = 'read/get-overprint-info.ts';

  it('テキストの文字単位オーバープリントを検出し、同じ組み合わせをまとめて数える', () => {
    const white = cmyk(0, 0, 0, 0);
    const doc = makeDoc([
      layer('L1', [
        text([
          { overprintFill: true, overprintStroke: false, fillColor: white, strokeColor: NO_COLOR, length: 3 },
          { overprintFill: false, overprintStroke: false, fillColor: white, strokeColor: NO_COLOR, length: 2 },
          { overprintFill: true, overprintStroke: false, fillColor: white, strokeColor: NO_COLOR, length: 4 },
        ]),
      ]),
    ]);
    const result = run(TOOL, doc);
    const items = result.items as OverprintItem[];
    expect(result.overprintCount).toBe(1);
    expect(items[0]).toMatchObject({
      itemType: 'text', fillOverprint: true, characterCount: 7, heuristic: 'likely_accidental',
    });
  });

  it('ラスタ画像の overprint を検出する', () => {
    const doc = makeDoc([layer('L1', [{ typename: 'RasterItem', name: 'img', note: '', overprint: true }])]);
    const items = run(TOOL, doc).items as OverprintItem[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ itemType: 'raster', overprint: true, heuristic: 'raster_overprint' });
  });

  it('K100 の線のオーバープリントを likely_accidental にしない', () => {
    const doc = makeDoc([
      layer('L1', [
        path({ stroked: true, strokeColor: cmyk(0, 0, 0, 100), strokeOverprint: true }),
      ]),
    ]);
    const items = run(TOOL, doc).items as OverprintItem[];
    expect(items[0]).toMatchObject({ strokeKind: 'k100', heuristic: 'k100_overprint' });
    expect(items[0]).not.toHaveProperty('intent');
  });

  it('K100 の塗り + 白の線のオーバープリントは likely_accidental', () => {
    const doc = makeDoc([
      layer('L1', [
        path({
          filled: true, fillColor: cmyk(0, 0, 0, 100), fillOverprint: true,
          stroked: true, strokeColor: cmyk(0, 0, 0, 0), strokeOverprint: true,
        }),
      ]),
    ]);
    const items = run(TOOL, doc).items as OverprintItem[];
    expect(items[0].heuristic).toBe('likely_accidental');
  });

  it('サブレイヤーと複合パス内部も走査し、未検査の種類を scope に載せる', () => {
    const compound: Obj = {
      typename: 'CompoundPathItem', name: '', note: '',
      pathItems: [path({ filled: true, fillColor: cmyk(0, 0, 0, 100), fillOverprint: true })],
    };
    (compound.pathItems as Obj[])[0].parent = compound;
    const doc = makeDoc([
      layer('Top', [{ typename: 'PlacedItem', name: 'linked', note: '' }], [
        layer('Sub', [compound, path({ filled: true, fillColor: cmyk(50, 0, 0, 0), fillOverprint: true })]),
      ]),
    ]);
    const result = run(TOOL, doc);
    const items = result.items as OverprintItem[];
    expect(items.map((i) => i.heuristic).sort()).toEqual(['k100_overprint', 'likely_accidental']);
    expect(items.every((i) => i.layerName === 'Sub')).toBe(true);
    const scope = result.scope as { scanned: Obj; skippedItems: Obj };
    expect(scope.scanned).toMatchObject({ pathItems: 2 });
    expect(scope.skippedItems).toEqual({ PlacedItem: 1 });
  });
});

type Plate = { name: string; type: string; usageCount: number; hiddenUsageCount: number };

describe('get_separation_info', () => {
  const TOOL = 'read/get-separation-info.ts';

  it('CMYK 文書でも使っていないプロセス版は separations に載せない', () => {
    const doc = makeDoc([layer('L1', [path({ filled: true, fillColor: cmyk(0, 0, 0, 100) })])]);
    const result = run(TOOL, doc);
    const seps = result.separations as Plate[];
    expect(seps.map((s) => s.name)).toEqual(['Black']);
    expect((result.unusedInks as Plate[]).map((s) => s.name)).toEqual(['Cyan', 'Magenta', 'Yellow']);
  });

  it('spots[0] を捨てず、colorType で登録色・グローバルプロセスを除外する', () => {
    const spotA = spot('PANTONE A', 'CM_SPOT');
    const reg = spot('[Registration]', 'CM_REG');
    const globalCyan = spot('Global Cyan', 'CM_PROCESS', cmyk(100, 0, 0, 0));
    const spotB = spot('PANTONE B', 'CM_SPOT');
    const doc = makeDoc(
      [
        layer('L1', [
          // テキストだけに使った特色
          text([{ fillColor: spotColor(spotA), strokeColor: NO_COLOR }]),
          // グローバルプロセスカラー → プロセス版に数える
          path({ filled: true, fillColor: spotColor(globalCyan) }),
          // グラデーションの分岐点
          path({ filled: true, fillColor: gradient(spotColor(spotB), cmyk(0, 0, 100, 0)) }),
          // 登録色（トンボ等）
          path({ stroked: true, strokeColor: spotColor(reg) }),
        ]),
      ],
      { spots: [spotA, reg, globalCyan, spotB] },
    );
    const result = run(TOOL, doc);
    const seps = result.separations as Plate[];
    const byName = Object.fromEntries(seps.map((s) => [s.name, s]));
    expect(byName['PANTONE A']).toMatchObject({ type: 'spot', usageCount: 1 });
    expect(byName['PANTONE B']).toMatchObject({ type: 'spot', usageCount: 1 });
    expect(byName.Cyan).toMatchObject({ usageCount: 1 });
    expect(byName.Yellow).toMatchObject({ usageCount: 1 });
    expect(byName['Global Cyan']).toBeUndefined();
    expect(byName['[Registration]']).toBeUndefined();
    expect(result.globalProcessColors).toEqual(['Global Cyan']);
    expect(result.registrationUsageCount).toBe(1);
  });

  it('ラスタ（グレースケール → K 版）と非表示オブジェクトを数える', () => {
    const doc = makeDoc([
      layer('L1', [{ typename: 'RasterItem', note: '', imageColorSpace: 'ICS_GRAY', colorants: ['Gray'] }]),
      layer('Hidden', [path({ filled: true, fillColor: cmyk(0, 100, 0, 0) })], [], false),
    ]);
    const seps = run(TOOL, doc).separations as Plate[];
    const byName = Object.fromEntries(seps.map((s) => [s.name, s]));
    expect(byName.Black).toMatchObject({ usageCount: 1, hiddenUsageCount: 0 });
    expect(byName.Magenta).toMatchObject({ usageCount: 1, hiddenUsageCount: 1 });
  });

  it('Document.inkList を documentInks として返す', () => {
    const doc = makeDoc([layer('L1', [])], {
      inkList: [
        { name: 'Process Cyan', inkInfo: { kind: 'IT_C', printingStatus: 'IPS_EN' } },
        { name: 'PANTONE A', inkInfo: { kind: 'IT_CUSTOM', printingStatus: 'IPS_CONV' } },
      ],
    });
    expect(run(TOOL, doc).documentInks).toEqual([
      { name: 'Process Cyan', kind: 'cyan', printingStatus: 'enabled' },
      { name: 'PANTONE A', kind: 'custom', printingStatus: 'convert_to_process' },
    ]);
  });
});
