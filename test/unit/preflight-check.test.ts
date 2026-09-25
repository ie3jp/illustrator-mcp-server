import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  jsxCode as preflightJsx,
  postProcessPreflightResult,
  MAX_RESULTS_PER_CATEGORY,
  type PreflightRawResult,
  type PreflightEntry,
} from '../../src/tools/utility/preflight-check.js';
import { throwOnRead } from './helpers/fake-illustrator.js';

// preflight_check の JSX を common.jsx と一緒にフェイク DOM 上で評価する（動的評価はテスト専用）
const commonJsx = fs.readFileSync(
  path.resolve(__dirname, '../../src/jsx/helpers/common.jsx'),
  'utf-8',
);

type Fake = Record<string, unknown>;

function runPreflightJsx(doc: Fake, params: Fake = {}, missingFonts: string[] = []): Record<string, any> {
  const wrapped = `
  var DocumentColorSpace = { CMYK: 1, RGB: 2 };
  var BlendModes = { NORMAL: 0, MULTIPLY: 1 };
  var ImageColorSpace = { RGB: 1, CMYK: 2, Grayscale: 3 };
  var TextType = { POINTTEXT: 1, AREATEXT: 2, PATHTEXT: 3 };
  var app = {
    version: "30.0",
    documents: { length: 1 },
    activeDocument: __doc,
    textFonts: { getByName: function(n) { if (__missing.indexOf(n) >= 0) throw new Error("no font"); return {}; } }
  };
  var __files = { "params.json": __params };
  function File(p) {
    this.encoding = "";
    this.open = function() { return true; };
    this.read = function() { return __files[p]; };
    this.write = function(c) { __files[p] = c; };
    this.close = function() {};
  }
  ${commonJsx}
  var PARAMS_PATH = "params.json";
  var RESULT_PATH = "result.json";
  ${preflightJsx}
  return jsonParse(__files["result.json"]);
  `;
  // eslint-disable-next-line no-new-func -- test-only: evaluating ES3 ExtendScript in Node.js (same pattern as common-helpers.test.ts)
  const factory = new Function('__doc', '__params', '__missing', wrapped); // NOSONAR
  return factory(doc, JSON.stringify(params), missingFonts) as Record<string, any>;
}

const cmyk = (k = 100) => ({ typename: 'CMYKColor', cyan: 0, magenta: 0, yellow: 0, black: k });
const rgb = () => ({ typename: 'RGBColor', red: 255, green: 0, blue: 0 });
const noColor = () => ({ typename: 'NoColor' });

function base(typename: string, extra: Fake = {}): Fake {
  return { typename, name: '', note: '', opacity: 100, blendingMode: 0, ...extra };
}
function pathItem(extra: Fake = {}): Fake {
  return base('PathItem', {
    filled: true, fillColor: cmyk(), stroked: false, strokeColor: noColor(),
    fillOverprint: false, strokeOverprint: false, ...extra,
  });
}
function textFrame(ranges: Fake[], extra: Fake = {}): Fake {
  return base('TextFrame', { textRanges: ranges, contents: 'x'.repeat(ranges.length), ...extra });
}
function charRange(fill: Fake, font = 'Font-A', stroke: Fake = noColor()): Fake {
  return { characterAttributes: { textFont: { name: font }, fillColor: fill, strokeColor: stroke } };
}
// 親参照を張ってレイヤーを組み立てる
function layer(items: Fake[]): Fake {
  const l: Fake = { typename: 'Layer', name: 'Layer 1', pageItems: items, layers: [] };
  const link = (parent: Fake, children: Fake[]) => {
    for (const c of children) {
      c.parent = parent;
      if (c.typename === 'GroupItem') link(c, c.pageItems as Fake[]);
      if (c.typename === 'CompoundPathItem') link(c, c.pathItems as Fake[]);
    }
  };
  link(l, items);
  return l;
}
function makeDoc(items: Fake[], extra: Fake = {}): Fake {
  const l = layer(items);
  const textFrames: Fake[] = [];
  const rasterItems: Fake[] = [];
  const collect = (list: Fake[]) => {
    for (const it of list) {
      if (it.typename === 'TextFrame') textFrames.push(it);
      if (it.typename === 'RasterItem') rasterItems.push(it);
      if (it.typename === 'GroupItem') collect(it.pageItems as Fake[]);
    }
  };
  collect(items);
  return {
    documentColorSpace: 1,
    layers: [l],
    placedItems: [],
    rasterItems,
    textFrames,
    spots: [{ name: '[Registration]' }],
    colorProfileName: 'Japan Color 2001 Coated',
    ...extra,
  };
}
const byCategory = (r: Record<string, any>, cat: string) =>
  (r.results as PreflightEntry[]).filter((e) => e.category === cat);

describe('preflight_check JSX: RGB detection', () => {
  it('flags RGB path inside a group, RGB text characters, gradient RGB stops and RGB embedded images', () => {
    const inGroup = pathItem({ fillColor: rgb() });
    const group = base('GroupItem', { pageItems: [inGroup] });
    // 2文字目だけ RGB（先頭文字だけ見る実装では見逃す）
    const tf = textFrame([charRange(cmyk()), charRange(rgb())]);
    const grad = pathItem({
      fillColor: {
        typename: 'GradientColor',
        gradient: { gradientStops: [{ color: cmyk(0), opacity: 100 }, { color: rgb(), opacity: 100 }] },
      },
    });
    const raster = base('RasterItem', {
      imageColorSpace: 1, transparent: false,
      geometricBounds: [0, 100, 100, 0],
      matrix: { mValueA: 0.24, mValueB: 0, mValueC: 0, mValueD: 0.24 },
    });
    const r = runPreflightJsx(makeDoc([group, tf, grad, raster]));
    const rgbResults = byCategory(r, 'rgb_in_cmyk');
    const attrs = rgbResults.map((e) => e.details.attribute).sort();
    expect(attrs).toEqual(['fill', 'fill', 'image', 'text_fill']);
    expect(rgbResults.find((e) => e.details.colorType === 'gradient')).toBeTruthy();
    expect(r.coverage.rgb_in_cmyk.status).toBe('checked');
  });

  it('reports a compound path once (not once per sub-path) under the compound path UUID', () => {
    const p1 = pathItem({ fillColor: rgb() });
    const p2 = pathItem({ fillColor: rgb() });
    const compound = base('CompoundPathItem', { pathItems: [p1, p2], pageItems: [] });
    const r = runPreflightJsx(makeDoc([compound]));
    const rgbResults = byCategory(r, 'rgb_in_cmyk');
    expect(rgbResults).toHaveLength(1);
    expect(rgbResults[0].uuid).toBe((compound.note as string).substring(0, 36));
  });

  it('marks RGB check partial when contents cannot be inspected (symbols etc.)', () => {
    const r = runPreflightJsx(makeDoc([base('SymbolItem'), pathItem()]));
    expect(byCategory(r, 'rgb_in_cmyk')).toHaveLength(0);
    expect(r.coverage.rgb_in_cmyk.status).toBe('partial');
    expect(r.coverage.rgb_in_cmyk.note).toContain('symbol');
  });

  it('is not_applicable in an RGB document', () => {
    const r = runPreflightJsx(makeDoc([pathItem({ fillColor: rgb() })], { documentColorSpace: 2 }));
    expect(byCategory(r, 'rgb_in_cmyk')).toHaveLength(0);
    expect(r.coverage.rgb_in_cmyk.status).toBe('not_applicable');
  });
});

describe('preflight_check JSX: transparency', () => {
  it('detects gradient stop opacity and transparent rasters', () => {
    const grad = pathItem({
      fillColor: {
        typename: 'GradientColor',
        gradient: { gradientStops: [{ color: cmyk(), opacity: 100 }, { color: cmyk(), opacity: 40 }] },
      },
    });
    const raster = base('RasterItem', { imageColorSpace: 2, transparent: true });
    const r = runPreflightJsx(makeDoc([grad, raster]));
    const reasons = byCategory(r, 'transparency').map((e) => e.details.reason as string);
    expect(reasons.some((s) => s.includes('gradient stop opacity (fill): 40%'))).toBe(true);
    expect(reasons.some((s) => s.includes('transparent areas'))).toBe(true);
    expect(r.pdfxSummary.hasTransparencyItems).toBe(true);
  });

  it('reports a transparent compound path once', () => {
    const p1 = pathItem({ opacity: 50 });
    const p2 = pathItem({ opacity: 50 });
    const compound = base('CompoundPathItem', { pathItems: [p1, p2], pageItems: [], opacity: 50 });
    const r = runPreflightJsx(makeDoc([compound]));
    expect(byCategory(r, 'transparency')).toHaveLength(1);
  });
});

describe('preflight_check JSX: text scan', () => {
  it('records sampling of long text frames as partial instead of silently skipping', () => {
    const ranges = Array.from({ length: 1200 }, () => charRange(cmyk()));
    const r = runPreflightJsx(makeDoc([textFrame(ranges)]));
    expect(r.coverage.missing_font.status).toBe('partial');
    expect(r.coverage.missing_font.note).toContain('sampled');
    expect(r.coverage.rgb_in_cmyk.status).toBe('partial');
  });

  it('reports a missing font even if its name is an Object property name', () => {
    const r = runPreflightJsx(makeDoc([textFrame([charRange(cmyk(), 'toString')])]), {}, ['toString']);
    expect(byCategory(r, 'missing_font').map((e) => e.details.font)).toEqual(['toString']);
  });

  it('reports missing fonts found in any character', () => {
    const r = runPreflightJsx(makeDoc([textFrame([charRange(cmyk()), charRange(cmyk(), 'Gone')])]), {}, ['Gone']);
    expect(byCategory(r, 'missing_font').map((e) => e.details.font)).toEqual(['Gone']);
    expect(r.coverage.missing_font.status).toBe('checked');
  });
});

describe('preflight_check JSX: white overprint', () => {
  it('flags white text characters with overprint fill (like get_overprint_info)', () => {
    const white = cmyk(0);
    const range = charRange(white);
    (range.characterAttributes as Fake).overprintFill = true;
    const r = runPreflightJsx(makeDoc([textFrame([charRange(cmyk()), range])]));
    const hits = byCategory(r, 'white_overprint');
    expect(hits.map((e) => e.details.attribute)).toEqual(['text_fill']);
    expect(r.coverage.white_overprint.status).toBe('checked');
  });

  it('marks white overprint partial when text frames were sampled', () => {
    const ranges = Array.from({ length: 1200 }, () => charRange(cmyk()));
    const r = runPreflightJsx(makeDoc([textFrame(ranges)]));
    expect(r.coverage.white_overprint.status).toBe('partial');
  });
});

describe('preflight_check JSX: inspection failures are not clean results', () => {
  it('a gradient whose stops cannot be read makes RGB and transparency partial', () => {
    const gradient = throwOnRead({}, 'gradientStops');
    const p = pathItem({ fillColor: { typename: 'GradientColor', gradient } });
    const r = runPreflightJsx(makeDoc([p]));
    expect(r.coverage.rgb_in_cmyk.status).toBe('partial');
    expect(r.coverage.transparency.status).toBe('partial');
  });

  it('text colors that cannot be read make RGB partial (not only missing_font)', () => {
    const range = charRange(cmyk());
    throwOnRead(range.characterAttributes as Fake, 'fillColor');
    const r = runPreflightJsx(makeDoc([textFrame([range])]));
    expect(r.coverage.rgb_in_cmyk.status).toBe('partial');
    expect(r.coverage.missing_font.status).toBe('checked');
  });

  it('overprint flags that cannot be read make white overprint partial', () => {
    const p = throwOnRead(pathItem({ fillColor: cmyk(0) }), 'fillOverprint');
    const r = runPreflightJsx(makeDoc([p]));
    expect(r.coverage.white_overprint.status).toBe('partial');
  });

  it('a linked image that cannot be read for the DPI check makes low_resolution partial', () => {
    const placed = throwOnRead({ typename: 'PlacedItem', name: 'photo', note: '' }, 'file');
    const r = runPreflightJsx(makeDoc([], { placedItems: [placed] }));
    expect(r.coverage.low_resolution.status).toBe('partial');
  });
});

describe('preflight_check JSX: low resolution', () => {
  it('reports the real pixel size of a rotated embedded image (not the bounding box divided by scale)', () => {
    // 1000x500px を 0.36pt/px（200ppi）で配置し 30° 回転。外接矩形は回転で膨らむ
    const s = 0.36;
    const t = Math.PI / 6;
    const [W, H] = [1000, 500];
    const aabbW = W * s * Math.cos(t) + H * s * Math.sin(t);
    const aabbH = W * s * Math.sin(t) + H * s * Math.cos(t);
    const raster = base('RasterItem', {
      imageColorSpace: 2, transparent: false,
      geometricBounds: [0, aabbH, aabbW, 0],
      matrix: { mValueA: s * Math.cos(t), mValueB: s * Math.sin(t), mValueC: -s * Math.sin(t), mValueD: s * Math.cos(t) },
    });
    const r = runPreflightJsx(makeDoc([raster]), { min_dpi: 300 });
    const [low] = byCategory(r, 'low_resolution');
    expect(low.details.effectivePPI).toBe(200);
    expect(low.details.pixelWidth).toBe(1000);
    expect(low.details.pixelHeight).toBe(500);
  });
});

function raw(results: PreflightEntry[], extra: Partial<PreflightRawResult> = {}): PreflightRawResult {
  return {
    checkCount: results.length,
    results,
    coverage: {
      rgb_in_cmyk: { status: 'checked' },
      missing_font: { status: 'checked' },
      transparency: { status: 'checked' },
    },
    placedImageData: [],
    minDPI: 300,
    targetPdfProfile: null,
    pdfxSummary: {
      hasRGBItems: false, hasTransparencyItems: false, hasSpotColors: false,
      colorProfileName: 'x', isCMYKDoc: true,
    },
    ...extra,
  };
}
const entry = (category: string, level = 'error', uuid: string | null = 'u'): PreflightEntry =>
  ({ level, category, message: 'm', uuid, details: {} });

describe('postProcessPreflightResult', () => {
  it('caps entries per category and summarizes the rest with counts and UUIDs', () => {
    const many = Array.from({ length: 1000 }, (_, i) => entry('rgb_in_cmyk', 'error', `id-${i}`));
    const out = postProcessPreflightResult(raw([...many, entry('bleed', 'info', null)]), 300);
    const results = out.results as PreflightEntry[];
    const rgbEntries = results.filter((e) => e.category === 'rgb_in_cmyk');
    expect(rgbEntries).toHaveLength(MAX_RESULTS_PER_CATEGORY + 1);
    const summary = rgbEntries[rgbEntries.length - 1];
    expect(summary.uuid).toBeNull();
    expect(summary.level).toBe('error');
    expect(summary.details.omittedCount).toBe(1000 - MAX_RESULTS_PER_CATEGORY);
    expect(summary.details.totalCount).toBe(1000);
    expect((summary.details.omittedUuids as string[]).length).toBe(100);
    expect(out.checkCount).toBe(1001);
    expect((out.categoryCounts as Record<string, number>).rgb_in_cmyk).toBe(1000);
    expect(out.truncated).toBe(true);
  });

  it('does not emit an x1a font warning just because live text exists', () => {
    const out = postProcessPreflightResult(
      raw([entry('non_outlined_text', 'warning')], { targetPdfProfile: 'x1a' }),
      300,
    );
    const pdfx = (out.results as PreflightEntry[]).filter((e) => e.category === 'pdfx_compliance');
    expect(pdfx.some((e) => e.message.includes('fonts'))).toBe(false);
  });

  it('flags x1a font embedding only for missing fonts', () => {
    const missing = { ...entry('missing_font'), details: { font: 'Gone' } };
    const out = postProcessPreflightResult(raw([missing], { targetPdfProfile: 'x1a' }), 300);
    const pdfx = (out.results as PreflightEntry[]).filter((e) => e.category === 'pdfx_compliance');
    expect(pdfx.some((e) => e.level === 'error' && e.message.includes('fonts'))).toBe(true);
  });

  it('says "No issues detected" only when every check completed', () => {
    const clean = postProcessPreflightResult(raw([entry('bleed', 'info', null)]), 300);
    expect(clean._note).toMatch(/^No issues detected/);

    const partial = raw([entry('bleed', 'info', null)]);
    partial.coverage!.missing_font = { status: 'partial', note: 'sampled' };
    const out = postProcessPreflightResult(partial, 300);
    expect(out._note).not.toMatch(/^No issues detected/);
    expect(out._note).toContain('missing_font');
  });

  it('treats x1a transparency as incomplete because live effects are invisible to scripting', () => {
    const out = postProcessPreflightResult(raw([], { targetPdfProfile: 'x1a' }), 300);
    const coverage = out.coverage as Record<string, { status: string; note?: string }>;
    expect(coverage.transparency.status).toBe('partial');
    expect(out._note).not.toMatch(/^No issues detected/);
  });

  it('records linked files whose pixel size cannot be read instead of skipping silently', () => {
    const out = postProcessPreflightResult(
      raw([], {
        placedImageData: [{
          uuid: 'p', name: 'logo', filePath: '/nonexistent/logo.ai',
          widthPt: 100, heightPt: 100, matrixScaleX: 1, matrixScaleY: 1,
        }],
      }),
      300,
    );
    const coverage = out.coverage as Record<string, { status: string; note?: string }>;
    expect(coverage.low_resolution.status).toBe('partial');
    expect(coverage.low_resolution.note).toContain('/nonexistent/logo.ai');
    expect(out).not.toHaveProperty('placedImageData');
  });
});
