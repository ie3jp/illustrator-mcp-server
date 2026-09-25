/**
 * 特色・シンボル名などユーザーが付けた名前をキーにした辞書が、"hasOwnProperty" や "toString" のような
 * Object のプロパティ名と衝突しても壊れないこと（ES3 には Map がないため接頭辞付きのキーで引く）
 */
import { describe, expect, it } from 'vitest';
import { runToolJsx } from './helpers/run-tool-jsx.js';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ENUMS = {
  DocumentColorSpace: { CMYK: 'DCS_CMYK', RGB: 'DCS_RGB' },
  ColorModel: { PROCESS: 'CM_PROCESS', REGISTRATION: 'CM_REG', SPOT: 'CM_SPOT' },
  SpotColorKind: { SpotCMYK: 'SK_CMYK', SpotRGB: 'SK_RGB', SpotLAB: 'SK_LAB' },
  ImageColorSpace: { CMYK: 'ICS_CMYK', DeviceN: 'ICS_DEVICEN', Grayscale: 'ICS_GRAY', RGB: 'ICS_RGB', Separation: 'ICS_SEP' },
  InkType: {},
  InkPrintStatus: {},
  GradientType: { LINEAR: 'LINEAR', RADIAL: 'RADIAL' },
};

const cmyk = (c: number, m: number, y: number, k: number) => ({ typename: 'CMYKColor', cyan: c, magenta: m, yellow: y, black: k });
const spot = (name: string, colorType = 'CM_SPOT') => ({ name, colorType, color: cmyk(0, 100, 0, 0), spotKind: 'SK_CMYK' });
const spotColor = (s: Obj) => ({ typename: 'SpotColor', spot: s, tint: 100 });
const path = (props: Obj): Obj => ({ typename: 'PathItem', name: '', note: '', hidden: false, filled: false, stroked: false, ...props });

function docWith(items: Obj[], extra: Obj = {}): Obj {
  const layer: Obj = { typename: 'Layer', name: 'L', visible: true, pageItems: items, layers: [] };
  const doc: Obj = { typename: 'Document', documentColorSpace: 'DCS_CMYK', layers: [layer], spots: [], ...extra };
  layer.parent = doc;
  for (const it of items) it.parent = layer;
  return doc;
}

function run(tool: string, doc: Obj, params: Obj = {}): Obj {
  return runToolJsx(tool, { ...ENUMS, app: { version: '30.0', documents: { length: 1 }, activeDocument: doc } }, params);
}

describe('get_separation_info', () => {
  it('特色名が hasOwnProperty / __registration でも版として数える', () => {
    const own = spot('hasOwnProperty');
    const reg = spot('__registration');
    const doc = docWith(
      [
        path({ filled: true, fillColor: spotColor(own) }),
        path({ filled: true, fillColor: spotColor(reg) }),
        path({ filled: true, fillColor: cmyk(0, 0, 0, 100) }),
      ],
      { spots: [own, reg] },
    );
    const r = run('read/get-separation-info.ts', doc);
    const byName = Object.fromEntries((r.separations as Obj[]).map((s) => [s.name, s]));
    expect(byName.hasOwnProperty).toMatchObject({ type: 'spot', usageCount: 1 });
    expect(byName.__registration).toMatchObject({ type: 'spot', usageCount: 1 });
    expect(byName.Black).toMatchObject({ usageCount: 1 });
    expect(r.registrationUsageCount).toBe(0);
  });
});

describe('get_colors', () => {
  it('特色名が toString でも使用数を数える', () => {
    const s = spot('toString');
    const doc = docWith([], {
      swatches: [], gradients: [], patterns: [], spots: [s], meshItems: [], textFrames: [],
      pathItems: [path({ filled: true, fillColor: spotColor(s) }), path({ stroked: true, strokeColor: spotColor(s) })],
    });
    const r = run('read/get-colors.ts', doc, { include_swatches: false });
    expect(r.spots[0]).toMatchObject({ name: 'toString', usageCount: 2 });
  });
});

describe('get_symbols', () => {
  it('シンボル名が constructor でもインスタンス数を数える', () => {
    const sym = { name: 'constructor' };
    const inst = { typename: 'SymbolItem', note: '', name: '', symbol: sym, geometricBounds: [0, 10, 10, 0], zOrderPosition: 1 };
    const doc = docWith([inst], {
      symbols: [sym],
      symbolItems: [inst],
      artboards: Object.assign([{ artboardRect: [0, 100, 100, 0] }], { getActiveArtboardIndex: () => 0 }),
    });
    const r = run('read/get-symbols.ts', doc, { coordinate_system: 'document' });
    expect(r.definitions[0]).toEqual({ name: 'constructor', instanceCount: 1 });
  });
});
